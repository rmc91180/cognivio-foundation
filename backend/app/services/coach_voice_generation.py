"""Evidence-grounded LLM coach-voice generation (PR C9).

C1–C8 made the canonical TeacherLessonCoachingArtifact safe, typed, and
navigationally intelligent. C9 layers an LLM-generated coach voice on top,
behind strict gates:

  * Sufficiency gate (`evaluate_coach_voice_sufficiency`): refuses to call
    the provider when source / safety / evidence / admin-review gates
    already block the artifact or when transcript/moment evidence is too
    thin to justify the call.
  * Bounded, privacy-safe input builder (`build_coach_voice_input`):
    extracts ONLY the teacher-safe lesson metadata, safe moment metadata,
    safe transcript excerpts, and rubric-to-practice hints. Never includes
    rubric labels, scores, confidence, admin notes, or private reflections.
  * Provider abstraction (`generate_teacher_coach_voice`): defaults to
    ``status="skipped_no_provider"`` when ``COACH_VOICE_LLM_ENABLED`` is
    not true or the OpenAI key is missing — every existing teacher
    endpoint continues to work via the C4/C8 deterministic artifact.
  * Validation (`validate_generated_coach_voice`): strict JSON parsing,
    C2 banned-string scan on every teacher-visible string, recursive
    timestamp containment, language check, no-duplicate deep-dive
    moments. Failed validations are returned as
    ``status="failed_validation"`` and the artifact falls back to the
    deterministic shape.
  * Cache (`load_cached_coach_voice` / `cache_or_persist_coach_voice`):
    keyed by ``(assessment_id, language, coach_voice_version,
    artifact_version, evidence_hash)``. Invalidates when the moment set,
    analysis_quality, transcript, or admin review changes.
  * Integration (`apply_coach_voice_to_artifact`): when validation
    passes, the generator replaces summary / primary action / highlight /
    deep-dive moments inside the artifact while preserving the C8
    navigator, action taxonomy, and source/admin metadata.

Nothing in this module makes a network call unless the operator has
explicitly enabled ``COACH_VOICE_LLM_ENABLED=true`` AND an OpenAI client
is configured. Tests mock the provider; nothing here calls a real
endpoint during pytest.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.services.teacher_artifact_quarantine import (
    find_teacher_visible_text_issues,
    is_teacher_visible_text_safe,
)
from app.services.lesson_moment_quality import (
    TEACHER_VISIBLE_MIN_CONFIDENCE,
    assessment_quality_blocks_teacher_feedback,
    detect_fallback_text,
)


logger = logging.getLogger(__name__)


COACH_VOICE_VERSION = "coach_voice_v1"

# Defaults — operators override via env. Kept conservative so the feature
# stays off in production until explicitly enabled.
DEFAULT_MIN_USABLE_MOMENTS = 2
DEFAULT_MIN_TRANSCRIPT_SEGMENTS = 6
DEFAULT_MIN_TRANSCRIPT_SIGNAL = 0.45
DEFAULT_MAX_INPUT_CHARS = 8_000
DEFAULT_MAX_OUTPUT_TOKENS = 700
DEFAULT_MAX_TRANSCRIPT_EXCERPT_CHARS = 240
DEFAULT_TIMEOUT_SECONDS = 30


# ---------------------------------------------------------------------------
# Sufficiency evaluation
# ---------------------------------------------------------------------------


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        return default


def coach_voice_enabled() -> bool:
    """True iff the operator has explicitly enabled LLM coach voice."""

    return _bool_env("COACH_VOICE_LLM_ENABLED", False)


def evaluate_coach_voice_sufficiency(
    *,
    artifact: Mapping[str, Any],
    assessment: Mapping[str, Any],
    transcript_doc: Optional[Mapping[str, Any]] = None,
    moments: Optional[Sequence[Mapping[str, Any]]] = None,
    admin_review: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Return ``{eligible, reason, signals}`` for the sufficiency gate.

    The gate intentionally errs on the side of NOT calling the LLM. It
    refuses for any of:

      * artifact is blocked (any blocked_reason).
      * source/evidence/safety gates failed.
      * admin review is admin_hidden or revision_requested.
      * fewer than ``COACH_VOICE_MIN_USABLE_MOMENTS`` usable moments AND
        no strong transcript signal.
      * fallback_text_used true.
    """

    signals: Dict[str, Any] = {}
    review = dict(admin_review or {})
    review_status = (review.get("status") or "").lower().strip()
    if review_status in {"admin_hidden", "revision_requested"}:
        return {"eligible": False, "reason": "admin_blocked", "signals": signals}

    if not artifact.get("teacher_feedback_allowed"):
        return {
            "eligible": False,
            "reason": "blocked_artifact",
            "signals": {"blocked_reason": artifact.get("blocked_reason")},
        }
    if assessment_quality_blocks_teacher_feedback(assessment):
        return {"eligible": False, "reason": "evidence_blocked", "signals": signals}

    analysis_quality = assessment.get("analysis_quality") or {}
    if analysis_quality.get("fallback_text_used"):
        return {"eligible": False, "reason": "fallback_text_used", "signals": signals}

    moments_list = list(moments or [])
    usable_moments = [
        m
        for m in moments_list
        if isinstance(m, Mapping)
        and (m.get("quality") or {}).get("teacher_visible_candidate")
    ]
    signals["usable_moment_count"] = len(usable_moments)

    transcript_segments: List[Mapping[str, Any]] = list(
        (transcript_doc or {}).get("segments") or []
    )
    transcript_segment_count = len(transcript_segments)
    signals["transcript_segment_count"] = transcript_segment_count
    transcript_status = str((transcript_doc or {}).get("transcript_status") or "").lower()
    signals["transcript_status"] = transcript_status or None
    # Aggregate transcript_signal_score across usable moments.
    transcript_signals = [
        float((m.get("quality") or {}).get("transcript_signal_score") or 0.0)
        for m in usable_moments
    ]
    signals["transcript_signal_score_avg"] = (
        sum(transcript_signals) / len(transcript_signals)
        if transcript_signals
        else 0.0
    )

    min_moments = _int_env("COACH_VOICE_MIN_USABLE_MOMENTS", DEFAULT_MIN_USABLE_MOMENTS)
    min_segments = _int_env("COACH_VOICE_MIN_TRANSCRIPT_SEGMENTS", DEFAULT_MIN_TRANSCRIPT_SEGMENTS)
    min_signal = _float_env("COACH_VOICE_MIN_TRANSCRIPT_SIGNAL", DEFAULT_MIN_TRANSCRIPT_SIGNAL)

    transcript_strong = (
        transcript_status == "completed"
        and transcript_segment_count >= min_segments
        and signals["transcript_signal_score_avg"] >= min_signal
    )
    moments_strong = len(usable_moments) >= min_moments

    if not moments_strong and not transcript_strong:
        return {
            "eligible": False,
            "reason": "insufficient_evidence",
            "signals": signals,
        }
    if len(usable_moments) < 1:
        return {"eligible": False, "reason": "insufficient_moments", "signals": signals}

    signals["transcript_strong"] = transcript_strong
    signals["moments_strong"] = moments_strong
    return {"eligible": True, "reason": "eligible", "signals": signals}


# ---------------------------------------------------------------------------
# Privacy-safe input builder
# ---------------------------------------------------------------------------


_NAME_PATTERN = re.compile(r"\b([A-Z][a-z]{2,15})\b")  # naive proper-noun heuristic


def _redact_excerpt(text: str, *, max_chars: int) -> str:
    """Strip newlines, collapse whitespace, and truncate."""

    cleaned = re.sub(r"\s+", " ", str(text or "").strip())
    if len(cleaned) > max_chars:
        cleaned = cleaned[: max_chars - 1].rstrip() + "…"
    return cleaned


def _safe_moment_for_prompt(
    moment: Mapping[str, Any], *, max_excerpt_chars: int
) -> Optional[Dict[str, Any]]:
    """Return the subset of a moment that is safe to pass to the LLM."""

    if not isinstance(moment, Mapping):
        return None
    quality = moment.get("quality") or {}
    if not quality.get("teacher_visible_candidate"):
        return None
    summary = moment.get("summary") or moment.get("what_happened") or moment.get("body") or ""
    if detect_fallback_text(summary):
        summary = ""
    if summary and not is_teacher_visible_text_safe(summary):
        summary = ""
    transcript_excerpt = _redact_excerpt(
        moment.get("transcript_excerpt") or "", max_chars=max_excerpt_chars
    )
    if transcript_excerpt and not is_teacher_visible_text_safe(transcript_excerpt):
        transcript_excerpt = ""
    return {
        "moment_id": moment.get("moment_id") or moment.get("id"),
        "start_sec": moment.get("start_sec"),
        "end_sec": moment.get("end_sec"),
        "phase": moment.get("phase"),
        "summary": _redact_excerpt(summary, max_chars=max_excerpt_chars),
        "transcript_excerpt": transcript_excerpt,
        "quality": {
            "visual_signal_score": quality.get("visual_signal_score"),
            "transcript_signal_score": quality.get("transcript_signal_score"),
            "audio_signal_score": quality.get("audio_signal_score"),
            "specificity_score": quality.get("specificity_score"),
            "has_transcript_window": quality.get("has_transcript_window"),
        },
    }


def build_coach_voice_input(
    *,
    artifact: Mapping[str, Any],
    assessment: Mapping[str, Any],
    teacher: Optional[Mapping[str, Any]] = None,
    transcript_doc: Optional[Mapping[str, Any]] = None,
    moments: Optional[Sequence[Mapping[str, Any]]] = None,
    language: Optional[str] = "en",
    max_input_chars: Optional[int] = None,
    max_excerpt_chars: Optional[int] = None,
) -> Dict[str, Any]:
    """Compose the bounded, privacy-safe LLM input payload.

    The returned dict is what we hash, persist, and send to the model.
    """

    max_input_chars = max_input_chars or _int_env(
        "COACH_VOICE_MAX_INPUT_CHARS", DEFAULT_MAX_INPUT_CHARS
    )
    max_excerpt_chars = max_excerpt_chars or _int_env(
        "COACH_VOICE_MAX_TRANSCRIPT_EXCERPT_CHARS",
        DEFAULT_MAX_TRANSCRIPT_EXCERPT_CHARS,
    )

    safe_moments: List[Dict[str, Any]] = []
    for moment in moments or []:
        safe = _safe_moment_for_prompt(moment, max_excerpt_chars=max_excerpt_chars)
        if safe:
            safe_moments.append(safe)

    # Existing artifact action items are teacher-safe by construction (C4/C8).
    safe_actions: List[Dict[str, Any]] = []
    for item in artifact.get("action_items") or []:
        if not isinstance(item, Mapping):
            continue
        body = item.get("try_next_lesson") or item.get("body") or ""
        title = item.get("title") or ""
        if not is_teacher_visible_text_safe(body) or not is_teacher_visible_text_safe(title):
            continue
        safe_actions.append(
            {
                "id": item.get("id"),
                "title": title,
                "body": body,
                "why_it_matters": item.get("why_it_matters"),
            }
        )

    payload = {
        "language": "he" if (language or "en").lower().startswith(("he", "iw")) else "en",
        "lesson": {
            "lesson_id": (artifact.get("lesson") or {}).get("lesson_id"),
            "video_id": (artifact.get("lesson") or {}).get("video_id"),
            "subject": (artifact.get("lesson") or {}).get("subject"),
            "title": (artifact.get("lesson") or {}).get("title"),
        },
        "teacher": {
            # Intentionally narrow — we do NOT pass the teacher's name or
            # email. Grade/subject context only.
            "grade_level": (teacher or {}).get("grade_level"),
            "subject": (teacher or {}).get("subject"),
        },
        "moments": safe_moments,
        "prior_action_items": safe_actions[:2],
        "transcript_available": bool(
            (transcript_doc or {}).get("segments")
            and str((transcript_doc or {}).get("transcript_status") or "").lower()
            == "completed"
        ),
        "output_schema": {
            "language": "en | he",
            "summary": {
                "headline": "short, warm coach voice — 1 sentence",
                "opening": "1 sentence",
                "what_worked": "1 sentence",
                "growth_focus": "1 sentence",
                "next_step": "1 actionable sentence",
            },
            "primary_action": {
                "title": "short coach voice title",
                "body": "1 specific action sentence",
                "try_next_lesson": "1 sentence",
                "why_it_matters": "1 sentence",
                "reflection_prompt": "1 question to the teacher",
                "moment_start_sec": "number from supplied moments",
                "moment_end_sec": "number from supplied moments",
            },
            "highlight": {
                "title": "short title",
                "body": "1 sentence",
                "start_sec": "number from supplied moments",
                "end_sec": "number from supplied moments",
            },
            "deep_dive_moments": "0-2 entries; each must reference a supplied moment timestamp",
            "quality": {
                "used_transcript": "bool",
                "used_moment_ids": "list of strings from supplied moments",
                "limitations": "list of short strings",
            },
        },
    }

    serialized = json.dumps(payload, sort_keys=True, default=str)
    if len(serialized) > max_input_chars:
        # If the payload is too large, drop transcript excerpts first.
        for moment in payload["moments"]:
            moment["transcript_excerpt"] = ""
        serialized = json.dumps(payload, sort_keys=True, default=str)
        if len(serialized) > max_input_chars:
            payload["moments"] = payload["moments"][:3]

    return payload


def evidence_hash(input_payload: Mapping[str, Any]) -> str:
    """Stable hash of the bounded coach-voice input."""

    canonical = json.dumps(input_payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Provider abstraction (default: no-call)
# ---------------------------------------------------------------------------


# Type alias for a callable that takes the JSON payload + language and
# returns either a dict (already-parsed JSON) or a raw string. Tests
# inject a deterministic mock here.
CoachVoiceProvider = Callable[[Dict[str, Any], str], Awaitable[Any]]


_PROMPT_INSTRUCTIONS_EN = (
    "You are Cognivio's instructional coach. Use ONLY the supplied moments and "
    "transcript excerpts to produce teacher-facing coaching. Address the teacher "
    "as 'you'. Be warm, specific, and concise. Never write rubric labels, scores, "
    "confidence values, framework element names, or system language like 'evidence', "
    "'rubric', 'element', 'sampled', or 'overall performance'. Do not invent dialogue. "
    "Do not quote student names. Output STRICT JSON matching the supplied schema. "
    "Reference moments by start_sec / end_sec values that appear in the input. If "
    "the supplied evidence is not sufficient to coach safely, return "
    '{"blocked": true, "reason": "insufficient_evidence"}.'
)


_PROMPT_INSTRUCTIONS_HE = (
    "אתם המאמן המקצועי של Cognivio. השתמשו אך ורק ברגעים ובתמלילים שסיפקנו כדי "
    "ליצור התרשמות עבור המורה. פנו ישירות אל המורה בלשון 'אתם'. כתבו בעברית "
    "טבעית, חמה וקונקרטית. אל תזכירו רובריקה, ציון, ביטחון, אלמנט, ראיות, "
    "מסגרת, או שפת מערכת. אל תמציאו שיחה. אל תצטטו שמות תלמידים. החזירו JSON "
    "תקין בלבד לפי הסכמה שסיפקנו. הפנו לרגעים לפי start_sec / end_sec מהקלט. "
    'אם הראיות אינן מספקות להתרשמות בטוחה, החזירו {"blocked": true, "reason": "insufficient_evidence"}.'
)


def coach_voice_prompt(input_payload: Mapping[str, Any]) -> Tuple[str, str]:
    """Return ``(system_prompt, user_prompt)`` strings."""

    language = (input_payload.get("language") or "en").lower()
    system = _PROMPT_INSTRUCTIONS_HE if language.startswith("he") else _PROMPT_INSTRUCTIONS_EN
    user = json.dumps(input_payload, ensure_ascii=False, sort_keys=True, default=str)
    return system, user


async def _openai_provider(
    input_payload: Dict[str, Any],
    language: str,
) -> Any:
    """Default OpenAI provider call. Only used when COACH_VOICE_LLM_ENABLED=true
    AND a configured OpenAI key is available."""

    try:
        from openai import AsyncOpenAI  # type: ignore
    except Exception:  # pragma: no cover - depends on local environment
        return {"blocked": True, "reason": "provider_unavailable"}

    api_key = os.getenv("OPENAI_API_KEY") or ""
    if not api_key:
        return {"blocked": True, "reason": "provider_no_key"}

    model = os.getenv("COACH_VOICE_MODEL", "gpt-4o-mini")
    timeout = _float_env("COACH_VOICE_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)
    max_output = _int_env("COACH_VOICE_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS)

    client = AsyncOpenAI(api_key=api_key, timeout=timeout)
    system, user = coach_voice_prompt(input_payload)
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=max_output,
        )
        content = response.choices[0].message.content or "{}"
        return content
    except Exception as exc:  # pragma: no cover - network is mocked in tests
        logger.warning("coach_voice openai call failed: %s", exc)
        return {"blocked": True, "reason": "provider_error"}


# ---------------------------------------------------------------------------
# Output validation
# ---------------------------------------------------------------------------


_REQUIRED_SUMMARY_KEYS = ("opening", "what_worked", "growth_focus", "next_step")


def _parse_llm_output(output: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if output is None:
        return None, "empty_output"
    if isinstance(output, dict):
        return dict(output), None
    if isinstance(output, str):
        try:
            return json.loads(output), None
        except json.JSONDecodeError as exc:
            return None, f"invalid_json:{exc.msg}"
    return None, "unexpected_output_type"


def _moment_keys(moments: Sequence[Mapping[str, Any]]) -> List[Tuple[float, float, Optional[str]]]:
    keys: List[Tuple[float, float, Optional[str]]] = []
    for m in moments or []:
        if not isinstance(m, Mapping):
            continue
        try:
            start = float(m.get("start_sec")) if m.get("start_sec") is not None else None
            end = float(m.get("end_sec")) if m.get("end_sec") is not None else None
        except (TypeError, ValueError):
            continue
        if start is None or end is None:
            continue
        keys.append((round(start, 1), round(end, 1), m.get("moment_id") or m.get("id")))
    return keys


def _timestamps_supported(start: Any, end: Any, allowed: Sequence[Tuple[float, float, Optional[str]]]) -> bool:
    if start is None or end is None:
        return False
    try:
        s, e = round(float(start), 1), round(float(end), 1)
    except (TypeError, ValueError):
        return False
    return any(s == a_s and e == a_e for a_s, a_e, _ in allowed)


def validate_generated_coach_voice(
    raw_output: Any,
    *,
    input_payload: Mapping[str, Any],
) -> Dict[str, Any]:
    """Return ``{ok, issues, output}`` after running strict validation.

    Validates:

      * strict JSON parse
      * model didn't return ``{"blocked": true, ...}``
      * required summary keys present
      * every teacher-visible string passes the C2 banned-string scan
      * referenced timestamps appear in the input moments
      * language matches the requested language
      * deep_dive_moments do not duplicate timestamps
    """

    parsed, parse_error = _parse_llm_output(raw_output)
    if parse_error:
        return {"ok": False, "issues": [{"code": "invalid_json", "detail": parse_error}], "output": None}
    if not isinstance(parsed, Mapping):
        return {"ok": False, "issues": [{"code": "invalid_output_type"}], "output": None}
    if parsed.get("blocked"):
        return {
            "ok": False,
            "issues": [{"code": "model_blocked", "detail": parsed.get("reason")}],
            "output": None,
        }

    issues: List[Dict[str, Any]] = []
    moments_allowed = _moment_keys(input_payload.get("moments") or [])
    moment_ids_allowed = {key[2] for key in moments_allowed if key[2] is not None}

    summary = parsed.get("summary") or {}
    if not isinstance(summary, Mapping):
        issues.append({"code": "missing_summary"})
    else:
        for key in _REQUIRED_SUMMARY_KEYS:
            if not str(summary.get(key) or "").strip():
                issues.append({"code": "missing_summary_field", "field": key})

    primary_action = parsed.get("primary_action") or {}
    if isinstance(primary_action, Mapping):
        for key in ("title", "body", "try_next_lesson"):
            if not str(primary_action.get(key) or "").strip():
                issues.append({"code": "missing_primary_action_field", "field": key})
        if not _timestamps_supported(
            primary_action.get("moment_start_sec"),
            primary_action.get("moment_end_sec"),
            moments_allowed,
        ):
            issues.append({"code": "primary_action_unsupported_timestamp"})

    highlight = parsed.get("highlight") or {}
    if isinstance(highlight, Mapping):
        if not str(highlight.get("body") or "").strip():
            issues.append({"code": "missing_highlight_body"})
        if not _timestamps_supported(
            highlight.get("start_sec"), highlight.get("end_sec"), moments_allowed
        ):
            issues.append({"code": "highlight_unsupported_timestamp"})

    deep_dive_moments = parsed.get("deep_dive_moments") or []
    seen_pairs: set = set()
    if isinstance(deep_dive_moments, list):
        for index, item in enumerate(deep_dive_moments):
            if not isinstance(item, Mapping):
                issues.append({"code": "deep_dive_invalid_entry", "index": index})
                continue
            if not _timestamps_supported(
                item.get("start_sec"), item.get("end_sec"), moments_allowed
            ):
                issues.append({"code": "deep_dive_unsupported_timestamp", "index": index})
                continue
            try:
                pair = (round(float(item.get("start_sec")), 1), round(float(item.get("end_sec")), 1))
            except (TypeError, ValueError):
                continue
            if pair in seen_pairs:
                issues.append({"code": "deep_dive_duplicate_timestamp", "index": index})
                continue
            seen_pairs.add(pair)
            if not str(item.get("what_happened") or item.get("body") or "").strip():
                issues.append({"code": "deep_dive_missing_text", "index": index})

    quality = parsed.get("quality") or {}
    if isinstance(quality, Mapping):
        used = quality.get("used_moment_ids") or []
        if isinstance(used, list):
            for moment_id in used:
                if moment_id and moment_id not in moment_ids_allowed:
                    issues.append({"code": "quality_unknown_moment_id", "moment_id": moment_id})

    # C2 banned-string sweep on every teacher-visible string in the output.
    visible_scope = {
        "summary": parsed.get("summary"),
        "primary_action": parsed.get("primary_action"),
        "highlight": parsed.get("highlight"),
        "deep_dive_moments": parsed.get("deep_dive_moments"),
    }
    for entry in find_teacher_visible_text_issues(visible_scope):
        issues.append({"code": "unsafe_teacher_text", **entry})

    # Hebrew/English language check.
    target_language = (input_payload.get("language") or "en").lower()
    declared_language = str(parsed.get("language") or "").lower()
    if target_language.startswith("he") and not declared_language.startswith("he"):
        issues.append({"code": "language_mismatch", "expected": "he", "declared": declared_language})
    # Defensive: when target is Hebrew but the rendered text is ASCII-only,
    # treat as a Hebrew leak.
    if target_language.startswith("he"):
        for path, value in _walk_strings(visible_scope):
            if value and value.strip() and not any("֐" <= c <= "׿" for c in value):
                issues.append({"code": "hebrew_english_leak", "path": path, "value": value[:80]})
                break

    return {
        "ok": not issues,
        "issues": issues,
        "output": parsed if not issues else None,
    }


def _walk_strings(value: Any, path: str = "") -> Iterable[Tuple[str, str]]:
    if isinstance(value, Mapping):
        for key, child in value.items():
            yield from _walk_strings(child, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_strings(child, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value


# ---------------------------------------------------------------------------
# Cache helpers (DB-backed when available; otherwise no-op safe)
# ---------------------------------------------------------------------------


COACH_VOICE_COLLECTION = "teacher_coach_voice_generations"


async def load_cached_coach_voice(
    db: Any,
    *,
    assessment_id: Optional[str],
    language: str,
    artifact_version: Optional[str],
    evidence_hash_value: str,
) -> Optional[Dict[str, Any]]:
    if not assessment_id or not db:
        return None
    collection = getattr(db, COACH_VOICE_COLLECTION, None)
    if collection is None or not hasattr(collection, "find_one"):
        return None
    try:
        doc = await collection.find_one(
            {
                "assessment_id": assessment_id,
                "language": language,
                "artifact_version": artifact_version,
                "evidence_hash": evidence_hash_value,
                "coach_voice_version": COACH_VOICE_VERSION,
            },
            {"_id": 0},
        )
    except Exception:  # pragma: no cover - defensive
        return None
    return doc


async def cache_or_persist_coach_voice(
    db: Any,
    *,
    record: Mapping[str, Any],
) -> None:
    if not db:
        return
    collection = getattr(db, COACH_VOICE_COLLECTION, None)
    if collection is None or not hasattr(collection, "update_one"):
        return
    query = {
        "assessment_id": record.get("assessment_id"),
        "language": record.get("language"),
        "artifact_version": record.get("artifact_version"),
        "evidence_hash": record.get("evidence_hash"),
        "coach_voice_version": record.get("coach_voice_version") or COACH_VOICE_VERSION,
    }
    payload = dict(record)
    payload.setdefault("created_at", datetime.now(timezone.utc).isoformat())
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await collection.update_one(query, {"$set": payload}, upsert=True)
    except Exception:  # pragma: no cover
        return


# ---------------------------------------------------------------------------
# Top-level generation entrypoint
# ---------------------------------------------------------------------------


async def generate_teacher_coach_voice(
    *,
    db: Any,
    artifact: Mapping[str, Any],
    assessment: Mapping[str, Any],
    teacher: Optional[Mapping[str, Any]] = None,
    transcript_doc: Optional[Mapping[str, Any]] = None,
    moments: Optional[Sequence[Mapping[str, Any]]] = None,
    admin_review: Optional[Mapping[str, Any]] = None,
    language: Optional[str] = "en",
    provider: Optional[CoachVoiceProvider] = None,
    force_regenerate: bool = False,
) -> Dict[str, Any]:
    """Top-level entrypoint. Returns the cache record (status + output)."""

    language = (language or "en").lower()
    if language.startswith(("he", "iw")):
        language = "he"
    else:
        language = "en"

    sufficiency = evaluate_coach_voice_sufficiency(
        artifact=artifact,
        assessment=assessment,
        transcript_doc=transcript_doc,
        moments=moments,
        admin_review=admin_review,
    )
    base_record: Dict[str, Any] = {
        "assessment_id": (artifact.get("lesson") or {}).get("assessment_id") or assessment.get("id"),
        "video_id": (artifact.get("lesson") or {}).get("video_id") or assessment.get("video_id"),
        "teacher_id": assessment.get("teacher_id"),
        "language": language,
        "coach_voice_version": COACH_VOICE_VERSION,
        "artifact_version": artifact.get("artifact_version"),
        "evidence_hash": None,
        "status": None,
        "output": None,
        "validation_issues": [],
        "provider": None,
        "model": None,
        "input_token_estimate": None,
        "output_token_estimate": None,
        "sufficiency": sufficiency,
        "reason": sufficiency.get("reason"),
    }

    if not sufficiency.get("eligible"):
        base_record["status"] = "skipped_insufficient"
        return base_record

    if not coach_voice_enabled() and provider is None:
        base_record["status"] = "skipped_disabled"
        return base_record

    if provider is None and not os.getenv("OPENAI_API_KEY"):
        base_record["status"] = "skipped_no_provider"
        return base_record

    input_payload = build_coach_voice_input(
        artifact=artifact,
        assessment=assessment,
        teacher=teacher,
        transcript_doc=transcript_doc,
        moments=moments,
        language=language,
    )
    evidence_hash_value = evidence_hash(input_payload)
    base_record["evidence_hash"] = evidence_hash_value

    if not force_regenerate:
        cached = await load_cached_coach_voice(
            db,
            assessment_id=base_record["assessment_id"],
            language=language,
            artifact_version=base_record["artifact_version"],
            evidence_hash_value=evidence_hash_value,
        )
        if cached and cached.get("status") in {"generated", "blocked"}:
            return cached

    chosen_provider = provider or _openai_provider
    raw = await chosen_provider(input_payload, language)
    base_record["provider"] = os.getenv("COACH_VOICE_PROVIDER", "openai")
    base_record["model"] = os.getenv("COACH_VOICE_MODEL", "gpt-4o-mini")
    base_record["input_token_estimate"] = max(1, len(json.dumps(input_payload, default=str)) // 4)

    validated = validate_generated_coach_voice(raw, input_payload=input_payload)
    base_record["validation_issues"] = validated["issues"]
    if not validated["ok"]:
        base_record["status"] = (
            "blocked"
            if validated["issues"] and validated["issues"][0].get("code") == "model_blocked"
            else "failed_validation"
        )
    else:
        base_record["status"] = "generated"
        base_record["output"] = validated["output"]
        base_record["output_token_estimate"] = max(
            1, len(json.dumps(validated["output"], default=str, ensure_ascii=False)) // 4
        )

    await cache_or_persist_coach_voice(db, record=base_record)
    return base_record


# ---------------------------------------------------------------------------
# Apply generated output to the canonical artifact
# ---------------------------------------------------------------------------


def _ensure_safe(value: Optional[str]) -> Optional[str]:
    if not value or not is_teacher_visible_text_safe(value):
        return None
    if detect_fallback_text(value):
        return None
    return value


def apply_coach_voice_to_artifact(
    artifact: Dict[str, Any],
    cache_record: Optional[Mapping[str, Any]],
) -> Dict[str, Any]:
    """Merge a validated coach-voice generation into the canonical artifact.

    When the cache record is absent or not a successful generation, the
    artifact is returned unchanged (deterministic fallback preserved).
    A ``coach_voice`` block is always attached so admin views can render
    the diagnostic state.
    """

    if not artifact:
        return artifact
    artifact = dict(artifact)
    status = (cache_record or {}).get("status")
    coach_voice_admin: Dict[str, Any] = {
        "version": COACH_VOICE_VERSION,
        "status": status or "skipped_disabled",
        "source": "llm" if status == "generated" else "deterministic",
        "language": (cache_record or {}).get("language") or artifact.get("language", "en"),
        "validated": status == "generated",
        "used_transcript": bool(((cache_record or {}).get("output") or {}).get("quality", {}).get("used_transcript"))
        if status == "generated"
        else False,
        "used_moment_ids": list(
            ((cache_record or {}).get("output") or {}).get("quality", {}).get("used_moment_ids") or []
        )
        if status == "generated"
        else [],
        "reason": (cache_record or {}).get("reason"),
    }
    artifact["coach_voice"] = {
        # Teacher-visible block: status only (no provider/model/tokens).
        "status": coach_voice_admin["status"],
        "source": coach_voice_admin["source"],
        "language": coach_voice_admin["language"],
        "validated": coach_voice_admin["validated"],
    }
    # Admin-only diagnostics (consumed via admin_view_of_artifact).
    artifact["_coach_voice_admin"] = {
        **coach_voice_admin,
        "provider": (cache_record or {}).get("provider"),
        "model": (cache_record or {}).get("model"),
        "input_token_estimate": (cache_record or {}).get("input_token_estimate"),
        "output_token_estimate": (cache_record or {}).get("output_token_estimate"),
        "validation_issues": list((cache_record or {}).get("validation_issues") or []),
        "sufficiency": (cache_record or {}).get("sufficiency"),
        "evidence_hash": (cache_record or {}).get("evidence_hash"),
    }

    if status != "generated" or not artifact.get("teacher_feedback_allowed"):
        return artifact

    output = (cache_record or {}).get("output") or {}
    summary_out = output.get("summary") or {}
    summary = dict(artifact.get("summary") or {})
    safe_opening = _ensure_safe(summary_out.get("opening"))
    safe_what_worked = _ensure_safe(summary_out.get("what_worked"))
    safe_growth = _ensure_safe(summary_out.get("growth_focus"))
    safe_next = _ensure_safe(summary_out.get("next_step"))
    if safe_opening:
        summary["opening"] = safe_opening
        summary["headline"] = _ensure_safe(summary_out.get("headline")) or safe_opening
    if safe_what_worked:
        summary["what_worked"] = safe_what_worked
    if safe_growth:
        summary["growth_focus"] = safe_growth
    if safe_next:
        summary["next_step"] = safe_next
    artifact["summary"] = summary

    primary_out = output.get("primary_action") or {}
    safe_primary_body = _ensure_safe(primary_out.get("body") or primary_out.get("try_next_lesson"))
    if safe_primary_body and artifact.get("action_items"):
        primary = dict(artifact["action_items"][0])
        primary["body"] = safe_primary_body
        primary["try_next_lesson"] = _ensure_safe(primary_out.get("try_next_lesson")) or safe_primary_body
        primary["title"] = _ensure_safe(primary_out.get("title")) or primary.get("title")
        primary["why_it_matters"] = _ensure_safe(primary_out.get("why_it_matters")) or primary.get(
            "why_it_matters"
        )
        primary["reflection_prompt"] = _ensure_safe(primary_out.get("reflection_prompt")) or primary.get(
            "reflection_prompt"
        )
        artifact["action_items"][0] = primary

    highlight_out = output.get("highlight") or {}
    safe_highlight_body = _ensure_safe(highlight_out.get("body"))
    safe_highlight_title = _ensure_safe(highlight_out.get("title"))
    if safe_highlight_body and artifact.get("highlights"):
        h = dict(artifact["highlights"][0])
        h["body"] = safe_highlight_body
        if safe_highlight_title:
            h["title"] = safe_highlight_title
        artifact["highlights"][0] = h
        # Mirror into recognition.personal_highlights so the workspace
        # "Moments worth revisiting" panel uses the LLM phrasing too.
        recognition = dict(artifact.get("recognition") or {})
        recognition["personal_highlights"] = list(artifact["highlights"])
        artifact["recognition"] = recognition

    dd_out = output.get("deep_dive_moments") or []
    if dd_out and (artifact.get("deep_dive") or {}).get("moments"):
        deep_dive = dict(artifact["deep_dive"])
        moments = list(deep_dive.get("moments") or [])
        new_moments: List[Dict[str, Any]] = []
        for dd_moment in dd_out:
            if not isinstance(dd_moment, Mapping):
                continue
            safe_text = _ensure_safe(dd_moment.get("what_happened") or dd_moment.get("body"))
            if not safe_text:
                continue
            try:
                start = float(dd_moment.get("start_sec"))
                end = float(dd_moment.get("end_sec"))
            except (TypeError, ValueError):
                continue
            new_moments.append(
                {
                    "id": dd_moment.get("id") or f"coach-voice-{round(start, 1)}",
                    "start_sec": start,
                    "end_sec": end,
                    "title": _ensure_safe(dd_moment.get("title")) or "A moment worth revisiting",
                    "what_happened": safe_text,
                    "why_it_matters": _ensure_safe(dd_moment.get("why_it_matters")) or None,
                    "try_or_notice": _ensure_safe(dd_moment.get("try_or_notice")) or None,
                    "video_href": next(
                        (m.get("video_href") for m in moments if isinstance(m, Mapping) and m.get("start_sec") == start),
                        None,
                    ),
                    "source": "llm",
                }
            )
        if new_moments:
            deep_dive["moments"] = new_moments[: max(1, len(moments))]
            deep_dive["available"] = True
            artifact["deep_dive"] = deep_dive

    return artifact


__all__ = [
    "COACH_VOICE_VERSION",
    "COACH_VOICE_COLLECTION",
    "coach_voice_enabled",
    "evaluate_coach_voice_sufficiency",
    "build_coach_voice_input",
    "evidence_hash",
    "coach_voice_prompt",
    "validate_generated_coach_voice",
    "load_cached_coach_voice",
    "cache_or_persist_coach_voice",
    "generate_teacher_coach_voice",
    "apply_coach_voice_to_artifact",
]
