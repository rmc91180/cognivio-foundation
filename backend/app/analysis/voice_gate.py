from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, asdict
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple
import re


BANNED_PHRASES: Tuple[str, ...] = (
    "evidence was limited",
    "in the sampled frames",
    "sampled frames",
    "analysis mode",
    "confidence score",
    "confidence value",
    "the teacher demonstrated",
    "the teacher used",
    "the teacher showed",
    "the teacher displayed",
    "rubric element",
    "score of",
    "rated at",
    "data suggests",
    "based on the evidence",
    "this segment",
    "sampled moment",
    "no summary data available",
    "no data available",
    "timestamped evidence",
    "evidence segment",
)

SYSTEM_LANGUAGE_RE = re.compile(
    r"\b("
    r"evidence|sampled frames?|analysis mode|confidence score|confidence value|"
    r"rubric element|data suggests|based on the evidence|this segment|"
    r"sampled moment|no summary data available|no data available|"
    r"timestamped evidence|evidence segment"
    r")\b",
    re.IGNORECASE,
)

THIRD_PERSON_TEACHER_RE = re.compile(
    r"\b(the teacher|teacher)\s+"
    r"(demonstrated|used|showed|displayed|asked|provided|moved|explained|"
    r"redirected|managed|supported|modeled|created|introduced|responded|"
    r"transitioned|facilitated|implemented|encouraged|maintained)\b",
    re.IGNORECASE,
)

RUBRIC_CODE_RE = re.compile(
    r"\b(?:[1-4][a-f]|d[1-4][a-f]?|m[1-6][a-j]?)\b",
    re.IGNORECASE,
)

SCORE_TEXT_RE = re.compile(
    r"\b(?:score|confidence|rated)\s*(?:of|at|=|:)?\s*\d+(?:\.\d+)?(?:/10|%)?",
    re.IGNORECASE,
)

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

TECHNICAL_PATH_PARTS = {
    "id",
    "element_id",
    "linked_element_id",
    "teacher_id",
    "video_id",
    "assessment_id",
    "session_id",
    "workspace_id",
    "user_id",
    "observer_id",
    "score",
    "confidence",
    "start_sec",
    "end_sec",
    "timestamp",
    "created_at",
    "updated_at",
    "generated_at",
    "raw",
    "source_snapshot",
    "metadata",
    "guardrails",
}

TEACHER_VISIBLE_TEXT_KEYS = {
    "summary",
    "text",
    "title",
    "description",
    "rationale",
    "observation",
    "observations",
    "recommendation",
    "recommendations",
    "growth_area",
    "growth_areas",
    "strength",
    "strengths",
    "next_step",
    "next_steps",
    "teacher_prompt",
    "teacher_prompt_body",
    "observer_prompt",
    "admin_prompt",
    "admin_prompt_body",
    "opening_note_for_observer",
    "teacher_reflection_prompts",
    "observer_next_steps",
    "conference_prep",
    "evidence_moments",
}


@dataclass
class VoiceGateIssue:
    path: str
    issue_type: str
    message: str
    value: str
    severity: str = "warning"


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def _is_hebrew(language: Optional[str]) -> bool:
    normalized = str(language or "").strip().lower()
    return normalized.startswith("he") or normalized in {"iw", "heb", "hebrew", "עברית"}


def _path_parts(path: str) -> List[str]:
    if not path:
        return []
    cleaned = path.replace("[", ".").replace("]", "")
    return [part for part in cleaned.split(".") if part]


def _last_path_part(path: str) -> str:
    parts = _path_parts(path)
    return parts[-1] if parts else ""


def _is_technical_path(path: str) -> bool:
    parts = set(_path_parts(path))
    return bool(parts & TECHNICAL_PATH_PARTS)


def _is_visible_text_path(path: str) -> bool:
    parts = set(_path_parts(path))
    if parts & TECHNICAL_PATH_PARTS:
        return False
    return bool(parts & TEACHER_VISIBLE_TEXT_KEYS) or _last_path_part(path) in TEACHER_VISIBLE_TEXT_KEYS


def _sentence_count(text: str) -> int:
    cleaned = _clean(text)
    if not cleaned:
        return 0
    return len([piece for piece in SENTENCE_SPLIT_RE.split(cleaned) if piece.strip()])


def _contains_direct_address(text: str, *, hebrew: bool = False) -> bool:
    cleaned = _clean(text)
    lowered = cleaned.lower()

    if hebrew:
        markers = (
            "את ",
            "אתה ",
            "אתם ",
            "שלך",
            "שלכם",
            "ראית",
            "עשית",
            "שאלת",
            "נתת",
            "הובלת",
            "עברת",
            "יצרת",
            "הזמנת",
            "אפשר",
            "כדאי",
            "נסו",
            "נסה",
            "נסי",
        )
        return any(marker in cleaned for marker in markers)

    return (
        " you " in f" {lowered} "
        or " your " in f" {lowered} "
        or lowered.startswith(("you ", "your "))
    )


def _starts_with_the_teacher(text: str) -> bool:
    return _clean(text).lower().startswith("the teacher")


def _has_banned_phrase(text: str) -> bool:
    lowered = _clean(text).lower()
    return any(phrase in lowered for phrase in BANNED_PHRASES)


def _has_system_language(text: str) -> bool:
    return bool(SYSTEM_LANGUAGE_RE.search(_clean(text)))


def _has_third_person_teacher_voice(text: str) -> bool:
    return bool(THIRD_PERSON_TEACHER_RE.search(_clean(text)))


def _has_score_or_confidence_leak(text: str) -> bool:
    return bool(SCORE_TEXT_RE.search(_clean(text)))


def _has_rubric_code_leak(text: str) -> bool:
    return bool(RUBRIC_CODE_RE.search(_clean(text)))


def _is_observation_path(path: str) -> bool:
    parts = set(_path_parts(path))
    return bool(parts & {"observation", "observations", "evidence_moments", "evidence_segments"})


def _is_recommendation_path(path: str) -> bool:
    parts = set(_path_parts(path))
    return bool(parts & {"recommendation", "recommendations", "next_step", "next_steps"})


def _is_summary_path(path: str) -> bool:
    parts = set(_path_parts(path))
    return "summary" in parts or _last_path_part(path) == "summary"


def _iter_text_fields(value: Any, path: str = "") -> Iterable[Tuple[str, str]]:
    if isinstance(value, Mapping):
        for key, child in value.items():
            next_path = f"{path}.{key}" if path else str(key)
            yield from _iter_text_fields(child, next_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_text_fields(child, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value


def _add_issue(
    issues: List[VoiceGateIssue],
    *,
    path: str,
    issue_type: str,
    message: str,
    value: str,
    severity: str = "warning",
) -> None:
    issues.append(
        VoiceGateIssue(
            path=path,
            issue_type=issue_type,
            message=message,
            value=value,
            severity=severity,
        )
    )


def validate_text_field(
    text: str,
    *,
    path: str = "",
    language: Optional[str] = "en",
    require_direct_address: bool = True,
    max_recommendation_sentences: int = 3,
) -> List[Dict[str, str]]:
    """
    Validate one teacher/observer-facing text field against the Cognivio coach voice rules.

    This function does not mutate text. It returns issue dictionaries suitable for logs,
    tests, or API diagnostics.
    """
    hebrew = _is_hebrew(language)
    cleaned = _clean(text)
    issues: List[VoiceGateIssue] = []

    if not cleaned:
        return []

    if _has_banned_phrase(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="banned_phrase",
            message="Text contains a banned clinical/system phrase.",
            value=cleaned,
            severity="error",
        )

    if _has_system_language(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="system_language",
            message="Text uses system/report language instead of coaching language.",
            value=cleaned,
        )

    if _has_third_person_teacher_voice(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="third_person_teacher_voice",
            message="Text refers to the teacher in third person instead of using you/your.",
            value=cleaned,
            severity="error",
        )

    if _has_score_or_confidence_leak(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="score_or_confidence_leak",
            message="Text includes score/confidence language that belongs only in numeric fields.",
            value=cleaned,
            severity="error",
        )

    if _has_rubric_code_leak(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="rubric_code_leak",
            message="Text appears to include a rubric code; use human instructional language instead.",
            value=cleaned,
        )

    if require_direct_address and _is_observation_path(path) and not _contains_direct_address(cleaned, hebrew=hebrew):
        _add_issue(
            issues,
            path=path,
            issue_type="missing_direct_address",
            message="Observation text should address the teacher directly.",
            value=cleaned,
        )

    if _is_recommendation_path(path) and _sentence_count(cleaned) > max_recommendation_sentences:
        _add_issue(
            issues,
            path=path,
            issue_type="recommendation_too_long",
            message=f"Recommendation should be no more than {max_recommendation_sentences} sentences.",
            value=cleaned,
        )

    if _is_summary_path(path) and _starts_with_the_teacher(cleaned):
        _add_issue(
            issues,
            path=path,
            issue_type="summary_starts_with_the_teacher",
            message="Summary should not begin with 'The teacher'; open like a coaching conversation.",
            value=cleaned,
            severity="error",
        )

    return [asdict(issue) for issue in issues]


def validate_payload_text(
    payload: Any,
    *,
    language: Optional[str] = "en",
    require_direct_address: bool = True,
    visible_only: bool = True,
    max_recommendation_sentences: int = 3,
) -> List[Dict[str, str]]:
    """
    Validate all text fields in a payload.

    By default, only teacher/observer-facing text paths are checked. Technical fields
    such as IDs, timestamps, scores, and source snapshots are ignored.
    """
    issues: List[Dict[str, str]] = []

    for path, text in _iter_text_fields(payload):
        if _is_technical_path(path):
            continue
        if visible_only and not _is_visible_text_path(path):
            continue

        issues.extend(
            validate_text_field(
                text,
                path=path,
                language=language,
                require_direct_address=require_direct_address,
                max_recommendation_sentences=max_recommendation_sentences,
            )
        )

    return issues


def _replace_case_insensitive(text: str, old: str, new: str) -> str:
    return re.sub(re.escape(old), new, text, flags=re.IGNORECASE)


def _deterministic_rewrite(text: str, *, language: Optional[str] = "en", path: str = "") -> str:
    """
    Deterministic low-risk cleanup for known banned phrases.

    This is intentionally conservative. It does not invent new evidence or change
    timestamps, scores, element IDs, or structure.
    """
    hebrew = _is_hebrew(language)
    cleaned = _clean(text)

    if not cleaned:
        return cleaned

    if hebrew:
        replacements = {
            "Evidence was limited in the sampled frames.": "החלון שהיה לנו בסרטון היה קצר — הנה מה שבלט בתוכו.",
            "evidence was limited": "החלון בסרטון היה קצר",
            "in the sampled frames": "בסרטון",
            "sampled frames": "הסרטון",
            "analysis mode": "אופן הסקירה",
            "confidence score": "אות",
            "rubric element": "מהלך ההוראה",
            "based on the evidence": "ממה שנראה",
            "this segment": "הרגע הזה",
            "sampled moment": "הרגע הזה",
            "no summary data available": "סיכום השיעור יופיע כאן אחרי שההקלטה תיבדק",
            "no data available": "המידע יופיע כאן אחרי שההקלטה תיבדק",
            "the teacher demonstrated": "ראינו אצלך",
            "the teacher used": "השתמשת",
            "the teacher showed": "הראית",
            "the teacher displayed": "הראית",
        }
    else:
        replacements = {
            "Evidence was limited in the sampled frames.": "The clip gave us a brief window into this lesson — here is what stood out.",
            "evidence was limited": "the clip was brief",
            "in the sampled frames": "in the clip",
            "sampled frames": "the clip",
            "analysis mode": "review",
            "confidence score": "signal",
            "confidence value": "signal",
            "rubric element": "instructional move",
            "based on the evidence": "from what was visible",
            "this segment": "this moment",
            "sampled moment": "moment",
            "no summary data available": "Your lesson summary will appear here after the recording is reviewed",
            "no data available": "Your lesson information will appear here after the recording is reviewed",
            "timestamped evidence segment": "moment",
            "timestamped evidence": "moment",
            "evidence segment": "moment",
            "The teacher demonstrated": "You showed",
            "the teacher demonstrated": "you showed",
            "The teacher used": "You used",
            "the teacher used": "you used",
            "The teacher showed": "You showed",
            "the teacher showed": "you showed",
            "The teacher displayed": "You showed",
            "the teacher displayed": "you showed",
        }

    for old, new in replacements.items():
        cleaned = _replace_case_insensitive(cleaned, old, new)

    cleaned = SCORE_TEXT_RE.sub("", cleaned)

    if not hebrew:
        cleaned = re.sub(r"\bThe teacher\b", "You", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\bteacher\b", "you", cleaned, flags=re.IGNORECASE)

        if _is_observation_path(path) and not _contains_direct_address(cleaned):
            cleaned = f"You can see this moment clearly: {cleaned[0].lower() + cleaned[1:] if cleaned else cleaned}"

        if _is_recommendation_path(path):
            lowered = cleaned.lower()
            if not lowered.startswith(("next lesson", "try ", "one thing", "before ", "after ", "when ")):
                cleaned = f"Next lesson, {cleaned[0].lower() + cleaned[1:] if cleaned else cleaned}"
    else:
        if _is_recommendation_path(path) and not any(
            marker in cleaned for marker in ("בשיעור הבא", "נסו", "נסה", "נסי", "כדאי", "אפשר")
        ):
            cleaned = f"בשיעור הבא, {cleaned}"

    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.replace(" .", ".").replace(" ,", ",").strip()
    return cleaned


def rewrite_payload_deterministically(
    payload: Any,
    *,
    language: Optional[str] = "en",
    visible_only: bool = True,
) -> Any:
    """
    Return a copy of payload with conservative coach-voice cleanup applied to
    teacher/observer-facing text fields.

    This is safe for graceful degradation when an AI tone specialist is unavailable.
    """
    cloned = deepcopy(payload)

    def visit(value: Any, path: str = "") -> Any:
        if isinstance(value, MutableMapping):
            for key in list(value.keys()):
                next_path = f"{path}.{key}" if path else str(key)
                value[key] = visit(value[key], next_path)
            return value

        if isinstance(value, list):
            for index, item in enumerate(value):
                value[index] = visit(item, f"{path}[{index}]")
            return value

        if isinstance(value, str):
            if _is_technical_path(path):
                return value
            if visible_only and not _is_visible_text_path(path):
                return value
            return _deterministic_rewrite(value, language=language, path=path)

        return value

    return visit(cloned)


def validate_voice_gate(
    payload: Any = None,
    *args: Any,
    language: Optional[str] = "en",
    require_direct_address: bool = True,
    visible_only: bool = True,
    auto_rewrite: bool = False,
    mutate: bool = False,
    max_recommendation_sentences: int = 3,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Validate Cognivio AI feedback against the Coach Voice & Tone System.

    Flexible call shape:
    - validate_voice_gate(payload)
    - validate_voice_gate(analysis=payload)
    - validate_voice_gate(artifact=payload)
    - validate_voice_gate(payload, language="he", auto_rewrite=True)

    Returns:
    {
      "passed": bool,
      "ok": bool,
      "issue_count": int,
      "issues": [...],
      "payload": original_or_rewritten_payload,
      "rewritten": bool,
      ...
    }

    This function never raises for tone failures. It is intended to be safe in
    production pipelines: callers can log issues, block in tests, or proceed
    gracefully.
    """
    target = payload

    if target is None and args:
        target = args[0]

    if target is None:
        target = (
            kwargs.get("payload")
            or kwargs.get("analysis")
            or kwargs.get("artifact")
            or kwargs.get("assessment")
            or {}
        )

    working_payload = target if mutate else deepcopy(target)

    if auto_rewrite:
        working_payload = rewrite_payload_deterministically(
            working_payload,
            language=language,
            visible_only=visible_only,
        )

    issues = validate_payload_text(
        working_payload,
        language=language,
        require_direct_address=require_direct_address,
        visible_only=visible_only,
        max_recommendation_sentences=max_recommendation_sentences,
    )

    passed = len(issues) == 0

    return {
        "passed": passed,
        "ok": passed,
        "issue_count": len(issues),
        "issues": issues,
        "payload": working_payload,
        "rewritten": bool(auto_rewrite),
        "language": language or "en",
        "visible_only": visible_only,
        "banned_phrases_checked": list(BANNED_PHRASES),
    }


def assert_voice_gate(
    payload: Any,
    *,
    language: Optional[str] = "en",
    visible_only: bool = True,
) -> None:
    """
    Test helper: raise AssertionError if payload fails the voice gate.
    """
    result = validate_voice_gate(
        payload,
        language=language,
        visible_only=visible_only,
    )
    if not result["passed"]:
        details = "\n".join(
            f"{issue['path']}: {issue['issue_type']} — {issue['value']}"
            for issue in result["issues"]
        )
        raise AssertionError(f"Voice gate failed with {result['issue_count']} issue(s):\n{details}")


__all__ = [
    "BANNED_PHRASES",
    "validate_text_field",
    "validate_payload_text",
    "validate_voice_gate",
    "rewrite_payload_deterministically",
    "assert_voice_gate",
]
