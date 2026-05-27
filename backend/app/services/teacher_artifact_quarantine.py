"""Source-validity and unsafe-text gating for teacher-facing coaching artifacts.

PR C2 follow-on to the source-chain hardening introduced in PR C1
(``backend/scripts/audit_video_source_chain.py``). C1 hardened the upload
pipeline so canonical ``videos`` rows are always present, but historical
deployments still have derived artifacts (coaching tasks, moments, transcripts)
whose source video/assessment have been deleted by older cleanup paths. This
module provides the read-side guard rails that keep those orphans (and any
fake/low-quality teacher-visible text the legacy pipeline emitted) from
reaching teacher endpoints.

The module is intentionally narrow:

* ``validate_teacher_artifact_source_chain`` and ``build_source_validity`` run
  cheap async checks against MongoDB to verify a teacher-facing artifact has
  both its canonical video AND assessment, and that they belong to the
  requesting teacher.
* ``is_teacher_visible_text_safe`` and ``find_teacher_visible_text_issues``
  scan every string in a teacher payload for the known bad strings emitted by
  the legacy projection (see ``KNOWN_BAD_TEACHER_TEXT_PATTERNS``).
* ``reject_unsafe_teacher_payload`` removes (does not just sanitize) action
  items, highlights, deep-dive moments, and recognition entries that fail
  either gate, and downgrades the ``guardrails`` block so callers cannot claim
  ``teacher_visible: true`` over unsafe content.
* ``filter_teacher_visible_coaching_tasks`` returns the subset of coaching
  tasks whose text passes the unsafe-text gate, keeping orphan/legacy tasks
  out of the teacher dashboard/coaching responses.

All functions are pure helpers; nothing in this module deletes records. The
non-destructive ``--repair-safe`` mode in the audit script attaches diagnostic
markers using the same vocabulary defined here.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Known bad strings observed in production teacher dashboards/coaching pages.
# These appeared in /api/teachers/me/dashboard and /api/teachers/me/coaching
# before C2 and must never appear in any teacher-facing endpoint.
KNOWN_BAD_TEACHER_TEXT_PATTERNS: Tuple[str, ...] = (
    "try this next lesson: rafi:",
    "rafi:",
    "coach d",
    "d1a",
    "d1b",
    "d1c",
    "d2b",
    "d3b",
    "d4e",
    "after moment",
    "after 5.6 evidence",
    "score",
    "rubric",
    "element",
    "evidence",
    "based on the observed moment",
    "plan a targeted coaching cycle",
    "the clip gave us a brief window into your lesson — here is what stood out.",
    "the clip gave us a brief window into your lesson - here is what stood out.",
    "brief window into your lesson",
    "demonstrating knowledge of students",
    "demonstrating knowledge of content and pedagogy",
    "creating an environment of respect and rapport",
    "using questioning and discussion techniques",
    "organizing physical space",
    "setting instructional outcomes",
    "establishing a culture for learning",
    "growing and developing professionally",
)

# Reasons emitted by build_source_validity / quarantine logic. Kept stable so
# tests + admin audit script share a single vocabulary.
SOURCE_INVALID_REASONS: Dict[str, str] = {
    "missing_source_video": "Canonical video record is missing.",
    "missing_source_assessment": "Canonical assessment record is missing.",
    "video_teacher_mismatch": "Source video belongs to a different teacher.",
    "assessment_teacher_mismatch": "Source assessment belongs to a different teacher.",
    "assessment_video_mismatch": "Assessment references a different video than the artifact.",
    "missing_video_id": "Artifact has no video_id to validate.",
    "explicitly_hidden": "Artifact is marked hidden_from_teacher.",
    "marked_orphaned": "Artifact is marked source_integrity=orphaned.",
}

# Rubric / admin-only labels. Allowed in admin payloads, rejected from
# teacher-visible payloads. Kept as a separate list so future rubric vocabulary
# (Danielson / Marshall) can be appended without touching the deeper logic.
RUBRIC_ELEMENT_LABELS: Tuple[str, ...] = (
    "demonstrating knowledge of students",
    "demonstrating knowledge of content and pedagogy",
    "creating an environment of respect and rapport",
    "using questioning and discussion techniques",
    "organizing physical space",
    "setting instructional outcomes",
    "establishing a culture for learning",
    "growing and developing professionally",
    "engaging students in learning",
    "using assessment in instruction",
    "managing classroom procedures",
    "managing student behavior",
    "reflecting on teaching",
)

# Phrases that the legacy AI fallback emitted when it had no evidence. We
# refuse to show any of these as teacher-facing content.
GENERIC_FALLBACK_PHRASES: Tuple[str, ...] = (
    "the clip gave us a brief window into your lesson",
    "brief window into your lesson",
    "here is what stood out",
    "plan a targeted coaching cycle",
    "based on the observed moment",
)

# Phrases that smell like the AI re-emitting the teacher's name as a label.
TEACHER_NAME_PREFIX_PATTERNS: Tuple[str, ...] = (
    "try this next lesson: rafi:",
    "rafi:",
)

# Rubric code shape: d1a..d4e and m1a..m9j. Reused for both unsafe-text gating
# and admin diagnostic surfacing.
_RUBRIC_CODE_RE = re.compile(r"\b[dm][1-9][a-j]?\b", re.IGNORECASE)

# Score-shaped tokens like "5.3", "5.3/10", "57%". Permissive on purpose — any
# of these on a teacher card means the rubric pipeline leaked.
_SCORE_TOKEN_RE = re.compile(r"\b\d+\.\d+(?:/10)?\b|\b\d+%\b")


# ---------------------------------------------------------------------------
# Source-validity helpers
# ---------------------------------------------------------------------------


def _coerce_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def is_teacher_visible_source_valid(source_validity: Optional[Mapping[str, Any]]) -> bool:
    """Quick boolean form of ``build_source_validity`` for callers."""

    if not source_validity:
        return False
    return bool(source_validity.get("valid_for_teacher_display"))


async def validate_teacher_artifact_source_chain(
    db: Any,
    artifact: Mapping[str, Any],
    *,
    teacher_id: Optional[str] = None,
    require_assessment: bool = False,
    require_transcript: bool = False,
    require_moments: bool = False,
) -> Dict[str, Any]:
    """Validate that a teacher-facing artifact still has a canonical source.

    This is the single-row variant used by teacher endpoints. The audit script
    runs an equivalent in-memory check against bulk-loaded collections.

    The artifact is expected to be a dict-shaped mongo document (coaching
    task, assessment, deep-dive moment, etc.). Whatever is present is what we
    check; missing video_id is treated as ``missing_video_id`` rather than as
    silently valid.
    """

    teacher_id = _coerce_str(teacher_id) or _coerce_str(artifact.get("teacher_id"))
    artifact_video_id = _coerce_str(artifact.get("video_id"))
    artifact_assessment_id = _coerce_str(artifact.get("assessment_id"))

    invalid_reasons: List[str] = []
    video_exists = False
    assessment_exists = False
    video_teacher_match = False
    assessment_teacher_match = False
    assessment_video_match = False
    has_transcript = False
    has_moments = False

    explicit_hidden = bool(
        artifact.get("hidden_from_teacher")
        or artifact.get("source_integrity") in {"orphaned", "invalid", "quarantined"}
    )
    if explicit_hidden:
        invalid_reasons.append(
            "marked_orphaned" if artifact.get("source_integrity") else "explicitly_hidden"
        )

    if not artifact_video_id:
        invalid_reasons.append("missing_video_id")

    video_doc: Optional[Mapping[str, Any]] = None
    if artifact_video_id and getattr(db, "videos", None) is not None:
        try:
            video_doc = await db.videos.find_one({"id": artifact_video_id}, {"_id": 0})
        except Exception:  # pragma: no cover - defensive against driver errors
            video_doc = None
    if artifact_video_id:
        if video_doc is None:
            invalid_reasons.append("missing_source_video")
        else:
            video_exists = True
            video_teacher_value = _coerce_str(video_doc.get("teacher_id"))
            if not teacher_id or not video_teacher_value:
                video_teacher_match = bool(video_teacher_value) and (not teacher_id or video_teacher_value == teacher_id)
            else:
                video_teacher_match = video_teacher_value == teacher_id
            if teacher_id and video_teacher_value and video_teacher_value != teacher_id:
                invalid_reasons.append("video_teacher_mismatch")

    assessment_doc: Optional[Mapping[str, Any]] = None
    if artifact_assessment_id and getattr(db, "assessments", None) is not None:
        try:
            assessment_doc = await db.assessments.find_one(
                {"id": artifact_assessment_id}, {"_id": 0}
            )
        except Exception:  # pragma: no cover
            assessment_doc = None
    if artifact_assessment_id:
        if assessment_doc is None:
            invalid_reasons.append("missing_source_assessment")
        else:
            assessment_exists = True
            assessment_teacher_value = _coerce_str(assessment_doc.get("teacher_id"))
            if teacher_id and assessment_teacher_value and assessment_teacher_value != teacher_id:
                invalid_reasons.append("assessment_teacher_mismatch")
            else:
                assessment_teacher_match = bool(assessment_teacher_value) and (
                    not teacher_id or assessment_teacher_value == teacher_id
                )
            assessment_video_value = _coerce_str(assessment_doc.get("video_id"))
            if artifact_video_id and assessment_video_value and artifact_video_id != assessment_video_value:
                invalid_reasons.append("assessment_video_mismatch")
            else:
                assessment_video_match = bool(assessment_video_value) and (
                    not artifact_video_id or assessment_video_value == artifact_video_id
                )
    elif require_assessment:
        invalid_reasons.append("missing_source_assessment")

    if require_transcript and artifact_video_id and getattr(db, "video_audio_transcripts", None) is not None:
        try:
            transcript_doc = await db.video_audio_transcripts.find_one(
                {"video_id": artifact_video_id}, {"_id": 0, "id": 1}
            )
            has_transcript = transcript_doc is not None
        except Exception:  # pragma: no cover
            has_transcript = False
        if not has_transcript:
            invalid_reasons.append("missing_transcript")

    if require_moments and artifact_video_id and getattr(db, "video_analysis_moments", None) is not None:
        try:
            moment_doc = await db.video_analysis_moments.find_one(
                {"video_id": artifact_video_id}, {"_id": 0, "id": 1}
            )
            has_moments = moment_doc is not None
        except Exception:  # pragma: no cover
            has_moments = False
        if not has_moments:
            invalid_reasons.append("missing_moments")

    valid_for_teacher_display = (
        not invalid_reasons
        and video_exists
        and (assessment_exists or not artifact_assessment_id and not require_assessment)
    )

    return {
        "video_id": artifact_video_id,
        "assessment_id": artifact_assessment_id,
        "teacher_id": teacher_id,
        "video_exists": video_exists,
        "assessment_exists": assessment_exists,
        "video_teacher_match": video_teacher_match,
        "assessment_teacher_match": assessment_teacher_match,
        "assessment_video_match": assessment_video_match,
        "has_transcript": has_transcript,
        "has_moments": has_moments,
        "valid_for_teacher_display": valid_for_teacher_display,
        "invalid_reasons": invalid_reasons,
    }


def build_source_validity(
    *,
    artifact: Optional[Mapping[str, Any]] = None,
    video: Optional[Mapping[str, Any]] = None,
    assessment: Optional[Mapping[str, Any]] = None,
    teacher_id: Optional[str] = None,
    require_assessment: bool = False,
) -> Dict[str, Any]:
    """Synchronous variant for callers that have already fetched the source rows.

    Mirrors ``validate_teacher_artifact_source_chain`` without async DB calls.
    Used by the teacher dashboard/coaching endpoints which already load
    ``videos`` and ``assessments`` collections in bulk.
    """

    artifact = dict(artifact or {})
    teacher_id = _coerce_str(teacher_id) or _coerce_str(artifact.get("teacher_id"))
    artifact_video_id = _coerce_str(artifact.get("video_id"))
    artifact_assessment_id = _coerce_str(artifact.get("assessment_id"))

    invalid_reasons: List[str] = []
    video_exists = bool(video)
    assessment_exists = bool(assessment)
    video_teacher_match = False
    assessment_teacher_match = False
    assessment_video_match = False

    if artifact.get("hidden_from_teacher") or artifact.get("source_integrity") in {
        "orphaned",
        "invalid",
        "quarantined",
    }:
        invalid_reasons.append("marked_orphaned" if artifact.get("source_integrity") else "explicitly_hidden")

    if not artifact_video_id:
        invalid_reasons.append("missing_video_id")
    elif not video_exists:
        invalid_reasons.append("missing_source_video")
    else:
        video_teacher_value = _coerce_str((video or {}).get("teacher_id"))
        if teacher_id and video_teacher_value and video_teacher_value != teacher_id:
            invalid_reasons.append("video_teacher_mismatch")
        else:
            video_teacher_match = bool(video_teacher_value) and (
                not teacher_id or video_teacher_value == teacher_id
            )

    if artifact_assessment_id:
        if not assessment_exists:
            invalid_reasons.append("missing_source_assessment")
        else:
            assessment_teacher_value = _coerce_str((assessment or {}).get("teacher_id"))
            if teacher_id and assessment_teacher_value and assessment_teacher_value != teacher_id:
                invalid_reasons.append("assessment_teacher_mismatch")
            else:
                assessment_teacher_match = bool(assessment_teacher_value) and (
                    not teacher_id or assessment_teacher_value == teacher_id
                )
            assessment_video_value = _coerce_str((assessment or {}).get("video_id"))
            if (
                artifact_video_id
                and assessment_video_value
                and artifact_video_id != assessment_video_value
            ):
                invalid_reasons.append("assessment_video_mismatch")
            else:
                assessment_video_match = bool(assessment_video_value) and (
                    not artifact_video_id or assessment_video_value == artifact_video_id
                )
    elif require_assessment:
        invalid_reasons.append("missing_source_assessment")

    valid_for_teacher_display = (
        not invalid_reasons
        and video_exists
        and (assessment_exists or not artifact_assessment_id and not require_assessment)
    )

    return {
        "video_id": artifact_video_id,
        "assessment_id": artifact_assessment_id,
        "teacher_id": teacher_id,
        "video_exists": video_exists,
        "assessment_exists": assessment_exists,
        "video_teacher_match": video_teacher_match,
        "assessment_teacher_match": assessment_teacher_match,
        "assessment_video_match": assessment_video_match,
        "has_transcript": False,
        "has_moments": False,
        "valid_for_teacher_display": valid_for_teacher_display,
        "invalid_reasons": invalid_reasons,
    }


# ---------------------------------------------------------------------------
# Unsafe-text detection
# ---------------------------------------------------------------------------


def _normalize(text: Any) -> str:
    if text is None:
        return ""
    return str(text).strip()


def _normalize_lower(text: Any) -> str:
    return _normalize(text).lower()


def find_unsafe_text_issues(text: Any) -> List[str]:
    """Return the list of unsafe markers found in a single string.

    Empty/missing strings return ``[]`` (no issues). The caller decides whether
    "empty body" is a problem in its own context — this function only flags
    *unsafe* content.
    """

    issues: List[str] = []
    if text is None:
        return issues
    if not isinstance(text, str):
        return issues

    lowered = text.lower()
    if not lowered.strip():
        return issues

    for pattern in KNOWN_BAD_TEACHER_TEXT_PATTERNS:
        needle = pattern.lower()
        if not needle:
            continue
        # Single bare alphanumeric tokens (score, rubric, element, evidence,
        # d1a..d4e) get word-boundary matching so we don't flag substrings like
        # "scoreboard" or "elementary". Anything else (spaces, punctuation,
        # dashes, colons) is matched as a substring.
        if needle.isalnum():
            if re.search(rf"\b{re.escape(needle)}\b", lowered):
                issues.append(f"bad_pattern:{pattern}")
        else:
            if needle in lowered:
                issues.append(f"bad_pattern:{pattern}")

    if _RUBRIC_CODE_RE.search(text):
        issues.append("rubric_code_token")

    if _SCORE_TOKEN_RE.search(text):
        # Ignore plain timestamps formatted as "12.3s" if present — but our
        # token regex deliberately accepts only bare decimals to match the
        # production leakage. Timestamps render via numeric ints elsewhere.
        issues.append("score_token")

    return issues


def is_teacher_visible_text_safe(text: Any) -> bool:
    """Return True iff ``text`` is acceptable to render to a teacher."""

    return not find_unsafe_text_issues(text)


def find_teacher_visible_text_issues(
    payload: Any,
    *,
    path: str = "",
    skip_paths: Sequence[str] = (),
) -> List[Dict[str, str]]:
    """Recursively scan a teacher payload for unsafe strings.

    Returns a list of issue dicts with ``path``, ``value``, and ``issues``
    keys. The default ``skip_paths`` is empty because teacher payloads should
    never contain rubric/admin strings even in nested metadata that happens to
    be returned to the client.
    """

    issues: List[Dict[str, str]] = []

    def visit(value: Any, current_path: str) -> None:
        if any(skip and current_path.startswith(skip) for skip in skip_paths):
            return
        if isinstance(value, Mapping):
            for key, child in value.items():
                next_path = f"{current_path}.{key}" if current_path else str(key)
                visit(child, next_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{current_path}[{index}]")
        elif isinstance(value, str):
            found = find_unsafe_text_issues(value)
            if found:
                issues.append({"path": current_path, "value": value, "issues": ",".join(found)})

    visit(payload, path)
    return issues


# ---------------------------------------------------------------------------
# Coaching task gating
# ---------------------------------------------------------------------------


def _coaching_task_text_fields(task: Mapping[str, Any]) -> List[str]:
    fields = (
        "teacher_title",
        "teacher_body",
        "title",
        "body",
        "summary",
        "suggested_action",
        "support_prompt",
        "try_next_lesson",
    )
    return [str(task.get(field) or "") for field in fields if task.get(field)]


def coaching_task_unsafe_text_issues(task: Mapping[str, Any]) -> List[str]:
    seen: List[str] = []
    for value in _coaching_task_text_fields(task):
        for issue in find_unsafe_text_issues(value):
            if issue not in seen:
                seen.append(issue)
    return seen


def is_coaching_task_teacher_safe(task: Mapping[str, Any]) -> bool:
    if task.get("hidden_from_teacher"):
        return False
    if task.get("source_integrity") in {"orphaned", "invalid", "quarantined"}:
        return False
    if task.get("teacher_visible") is False:
        return False
    return not coaching_task_unsafe_text_issues(task)


def filter_teacher_visible_coaching_tasks(
    tasks: Sequence[Mapping[str, Any]],
    *,
    valid_video_ids: Optional[Iterable[str]] = None,
    valid_assessment_ids: Optional[Iterable[str]] = None,
    allow_standalone_admin_goals: bool = True,
) -> Tuple[List[dict], List[dict]]:
    """Split coaching tasks into (teacher_visible, quarantined).

    A task is quarantined when:
      * ``hidden_from_teacher`` is truthy
      * its title/body contains an unsafe pattern
      * it references a video_id or assessment_id that isn't in the supplied
        valid sets (when those sets are provided)
      * its ``source_integrity`` is already marked as orphan/invalid

    Tasks with no ``video_id`` *and* no ``assessment_id`` are treated as
    standalone admin-created goals when ``allow_standalone_admin_goals`` is
    True. The caller still needs to ensure the text passes the safety gate.
    """

    valid_video_set = {str(v) for v in (valid_video_ids or []) if v}
    valid_assessment_set = {str(a) for a in (valid_assessment_ids or []) if a}

    visible: List[dict] = []
    quarantined: List[dict] = []
    for raw in tasks or []:
        task = dict(raw)
        reasons: List[str] = []

        if task.get("hidden_from_teacher"):
            reasons.append("explicitly_hidden")
        if task.get("source_integrity") in {"orphaned", "invalid", "quarantined"}:
            reasons.append("marked_orphaned")

        text_issues = coaching_task_unsafe_text_issues(task)
        if text_issues:
            reasons.append("unsafe_text")

        video_id = _coerce_str(task.get("video_id"))
        assessment_id = _coerce_str(task.get("assessment_id"))

        if video_id and valid_video_set and video_id not in valid_video_set:
            reasons.append("missing_source_video")
        if assessment_id and valid_assessment_set and assessment_id not in valid_assessment_set:
            reasons.append("missing_source_assessment")

        if not video_id and not assessment_id and not allow_standalone_admin_goals:
            reasons.append("missing_video_id")

        if reasons:
            task["source_integrity"] = task.get("source_integrity") or (
                "orphaned"
                if "missing_source_video" in reasons or "missing_source_assessment" in reasons
                else "invalid"
            )
            task["hidden_from_teacher"] = True
            task["hidden_reason"] = reasons[0]
            task["needs_admin_review"] = True
            task["unsafe_text_issues"] = text_issues or None
            quarantined.append(task)
        else:
            visible.append(task)

    return visible, quarantined


# ---------------------------------------------------------------------------
# Deep-dive quality gate
# ---------------------------------------------------------------------------


def is_deep_dive_moment_safe(moment: Mapping[str, Any]) -> bool:
    """Single-moment safety gate used by ``filter_deep_dive_moments``."""

    text_fields = (
        moment.get("what_happened"),
        moment.get("summary"),
        moment.get("description"),
        moment.get("text"),
        moment.get("body"),
        moment.get("title"),
    )
    for value in text_fields:
        if value and find_unsafe_text_issues(str(value)):
            return False
        if value:
            lowered = str(value).lower()
            for phrase in GENERIC_FALLBACK_PHRASES:
                if phrase in lowered:
                    return False
    return True


def filter_deep_dive_moments(
    moments: Sequence[Mapping[str, Any]],
    *,
    language: Optional[str] = "en",
) -> Dict[str, Any]:
    """Return a safe deep-dive payload, dropping fakes/duplicates/unsafe moments.

    The teacher-facing rules:
      * ``start_sec`` and ``end_sec`` must both be numeric and ``end > start``
      * no duplicate ``(start, end)`` pairs and no duplicate representative
        timestamps within 0.1s of each other
      * the visible text must pass the unsafe-text gate
      * the visible text must not be one of the generic fallback phrases
    """

    seen_pairs: set = set()
    seen_representative: List[float] = []
    safe: List[Dict[str, Any]] = []

    for raw in moments or []:
        moment = dict(raw)
        start = moment.get("start_sec")
        end = moment.get("end_sec")

        try:
            start_value = float(start) if start is not None else None
            end_value = float(end) if end is not None else None
        except (TypeError, ValueError):
            continue

        if start_value is None or end_value is None:
            continue
        if end_value <= start_value:
            continue

        pair = (round(start_value, 3), round(end_value, 3))
        if pair in seen_pairs:
            continue

        representative = round((start_value + end_value) / 2.0, 1)
        if any(abs(existing - representative) < 0.1 for existing in seen_representative):
            continue

        if not is_deep_dive_moment_safe(moment):
            continue

        seen_pairs.add(pair)
        seen_representative.append(representative)
        safe.append(moment)

    if safe:
        return {"available": True, "moments": safe, "empty_state": ""}

    return {
        "available": False,
        "moments": [],
        "empty_state": (
            "Detailed lesson moments will appear after a complete review is ready."
            if (language or "en").lower().startswith("en")
            else "פירוט רגעי השיעור יוצג אחרי שהבדיקה הבאה תהיה מוכנה."
        ),
    }


# ---------------------------------------------------------------------------
# Action item eligibility gate
# ---------------------------------------------------------------------------


def is_action_item_teacher_eligible(
    item: Mapping[str, Any],
    *,
    source_validity: Optional[Mapping[str, Any]] = None,
    allow_standalone_admin_goals: bool = True,
) -> bool:
    """Return True if the action item is safe to render to a teacher."""

    if not isinstance(item, Mapping):
        return False

    # Source-validity gate. Standalone admin goals (no video_id, no
    # assessment_id, explicitly marked admin_created) are allowed through when
    # the caller opts in.
    source_required = bool(item.get("video_id") or item.get("assessment_id"))
    if source_required and source_validity is not None and not source_validity.get(
        "valid_for_teacher_display"
    ):
        return False
    if not source_required and not allow_standalone_admin_goals and not source_validity:
        return False

    for key in ("title", "body", "try_next_lesson", "description", "why_it_matters"):
        value = item.get(key)
        if value and find_unsafe_text_issues(str(value)):
            return False
        if value and any(phrase in str(value).lower() for phrase in GENERIC_FALLBACK_PHRASES):
            return False
        if value and any(prefix in str(value).lower() for prefix in TEACHER_NAME_PREFIX_PATTERNS):
            return False

    body = _normalize(item.get("try_next_lesson") or item.get("body") or item.get("description"))
    if not body:
        return False

    return True


# ---------------------------------------------------------------------------
# Payload-level rejection
# ---------------------------------------------------------------------------


def _empty_deep_dive(language: Optional[str] = "en") -> Dict[str, Any]:
    return filter_deep_dive_moments([], language=language)


def reject_unsafe_teacher_payload(
    payload: Optional[Mapping[str, Any]],
    *,
    language: Optional[str] = "en",
    source_validity: Optional[Mapping[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Return a teacher-safe copy of ``payload`` or ``None`` if nothing salvageable.

    The function is intentionally aggressive:
      * if the source chain is invalid we drop the projection entirely
      * highlights/action_items/moments with unsafe text are removed (not
        sanitized into less-bad text)
      * guardrails cannot claim ``teacher_visible: true`` unless the recursive
        scan passes
    """

    if payload is None:
        return None

    if source_validity is not None and not source_validity.get("valid_for_teacher_display"):
        return None

    cleaned = dict(payload)

    # Latest summary
    latest_summary = dict(cleaned.get("latest_summary") or {})
    for key in ("opening", "strength", "growth_focus", "next_step"):
        value = latest_summary.get(key)
        if value and find_unsafe_text_issues(str(value)):
            latest_summary[key] = None
        if value and any(phrase in str(value).lower() for phrase in GENERIC_FALLBACK_PHRASES):
            latest_summary[key] = None
    cleaned["latest_summary"] = latest_summary

    # Highlights — drop any that fail unsafe-text gate
    safe_highlights: List[Dict[str, Any]] = []
    for highlight in cleaned.get("highlights") or []:
        if not isinstance(highlight, Mapping):
            continue
        text_values = [
            highlight.get("title"),
            highlight.get("body"),
            highlight.get("description"),
        ]
        if any(value and find_unsafe_text_issues(str(value)) for value in text_values):
            continue
        if any(
            value and any(phrase in str(value).lower() for phrase in GENERIC_FALLBACK_PHRASES)
            for value in text_values
        ):
            continue
        safe_highlights.append(dict(highlight))
    cleaned["highlights"] = safe_highlights

    # Action items + to_dos
    safe_actions: List[Dict[str, Any]] = []
    for item in cleaned.get("action_items") or []:
        if isinstance(item, Mapping) and is_action_item_teacher_eligible(item):
            safe_actions.append(dict(item))
    cleaned["action_items"] = safe_actions
    cleaned["to_dos"] = list(safe_actions)

    # Recognition — strip any tied to rubric/admin text or generic fallback
    safe_recognition: List[Dict[str, Any]] = []
    for entry in cleaned.get("recognition") or []:
        if not isinstance(entry, Mapping):
            continue
        values = [entry.get("title"), entry.get("body"), entry.get("description")]
        if any(value and find_unsafe_text_issues(str(value)) for value in values):
            continue
        if any(
            value and any(phrase in str(value).lower() for phrase in GENERIC_FALLBACK_PHRASES)
            for value in values
        ):
            continue
        safe_recognition.append(dict(entry))
    cleaned["recognition"] = safe_recognition

    # Deep dive — re-run quality gate
    deep_dive = cleaned.get("deep_dive") or {}
    cleaned["deep_dive"] = filter_deep_dive_moments(deep_dive.get("moments") or [], language=language)

    # Final recursive scan to confirm the projection is teacher-safe. Skip
    # internal metadata + to_dos (mirror of action_items) to avoid double
    # flagging.
    skip_paths = ("_internal_metadata", "to_dos")
    issues = find_teacher_visible_text_issues(cleaned, skip_paths=skip_paths)
    guardrails = dict(cleaned.get("guardrails") or {})
    if issues:
        # Mark guardrails as failed and stash diagnostics for admin visibility.
        guardrails.update(
            {
                "teacher_visible": False,
                "scores_removed": False,
                "rubric_removed": False,
                "source_integrity": "invalid",
                "needs_admin_review": True,
            }
        )
        cleaned.setdefault("_internal_metadata", {})["unsafe_text_issues"] = issues
        cleaned["guardrails"] = guardrails
        return None

    guardrails.update(
        {
            "teacher_visible": True,
            "scores_removed": True,
            "rubric_removed": True,
            "language": language or "en",
            "source_integrity": "ok",
        }
    )
    cleaned["guardrails"] = guardrails
    return cleaned


# ---------------------------------------------------------------------------
# Diagnostic helpers used by admin paths + audit script
# ---------------------------------------------------------------------------


def diagnostic_markers(
    *,
    integrity: str = "orphaned",
    hidden_reason: str = "missing_source_video",
    unsafe_text_issues: Optional[Sequence[str]] = None,
    audit_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the diagnostic marker dict the audit script + endpoints share."""

    return {
        "source_integrity": integrity,
        "hidden_from_teacher": True,
        "hidden_reason": hidden_reason,
        "needs_admin_review": True,
        "source_audited_at": datetime.now(timezone.utc).isoformat(),
        "source_audit_reason": audit_reason or hidden_reason,
        "unsafe_text_issues": list(unsafe_text_issues or []) or None,
    }


def honest_next_best_action_for_record(language: Optional[str] = "en") -> Dict[str, Any]:
    """The teacher-facing honest empty state when there is no reviewed lesson."""

    if (language or "en").lower().startswith("en"):
        return {
            "id": "record-lesson",
            "title": "Your recording setup is ready.",
            "description": "After a lesson has a complete review, you’ll see specific coaching moments and next steps here.",
            "href": "/record",
            "cta_label": "Record or upload a lesson",
        }
    return {
        "id": "record-lesson",
        "title": "ההקלטה מוכנה.",
        "description": "אחרי שיעור עם בדיקה מלאה יוצגו כאן רגעים ספציפיים והצעדים הבאים.",
        "href": "/record",
        "cta_label": "הקליטו או העלו שיעור",
    }


__all__ = [
    "KNOWN_BAD_TEACHER_TEXT_PATTERNS",
    "RUBRIC_ELEMENT_LABELS",
    "GENERIC_FALLBACK_PHRASES",
    "SOURCE_INVALID_REASONS",
    "validate_teacher_artifact_source_chain",
    "build_source_validity",
    "is_teacher_visible_source_valid",
    "is_teacher_visible_text_safe",
    "find_unsafe_text_issues",
    "find_teacher_visible_text_issues",
    "filter_teacher_visible_coaching_tasks",
    "coaching_task_unsafe_text_issues",
    "is_coaching_task_teacher_safe",
    "filter_deep_dive_moments",
    "is_deep_dive_moment_safe",
    "is_action_item_teacher_eligible",
    "reject_unsafe_teacher_payload",
    "diagnostic_markers",
    "honest_next_best_action_for_record",
]
