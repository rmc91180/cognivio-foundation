from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.analysis.voice_gate import validate_payload_text, rewrite_payload_deterministically


TEACHER_FEEDBACK_REQUIRED_VERSION = "teacher_feedback_projection_v1"
GOLD_STAR_DEFAULT_THRESHOLD = 9.0

LEAKAGE_RE = re.compile(
    r"("
    r"\boverall performance\b|"
    r"\bdeveloping\b|"
    r"\bproficient\b|"
    r"\b(?:score|confidence|weighted average)s?\b|"
    r"\b\d+(?:\.\d+)?\s*/\s*10\b|"
    r"\bsampled frames?\b|"
    r"\bevidence was limited\b|"
    r"\brubric(?: element)?\b|"
    r"\bdomain\b|"
    r"\belement\b|"
    r"\bthe teacher (?:demonstrated|used|showed|displayed)\b|"
    r"\bcoach\s+d\d+[a-z]?\b|"
    r"\b(?:[1-4][a-f]|d[1-4][a-f]?|m[1-6][a-j]?)\b"
    r")",
    re.IGNORECASE,
)

INTERNAL_REASON_KEYS = {
    "selected_from",
    "source_assessment_id",
    "source_video_id",
    "support",
    "raw_source",
    "selection_reason",
    "admin_focus_weighted",
}


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _is_hebrew(language: Optional[str]) -> bool:
    normalized = str(language or "").strip().lower()
    return normalized.startswith("he") or normalized in {"iw", "heb", "hebrew", "עברית"}


def _first_nonempty(*values: Any) -> str:
    for value in values:
        text = _clean(value)
        if text:
            return text
    return ""


def _split_sentences(text: str) -> List[str]:
    text = _clean(text)
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [_clean(part) for part in parts if _clean(part)]


def _strip_leakage(text: str, *, language: Optional[str] = "en") -> str:
    text = _clean(text)
    if not text:
        return ""
    hebrew = _is_hebrew(language)
    replacements = {
        "overall performance": "this lesson",
        "weighted average": "pattern",
        "confidence score": "review signal",
        "confidence value": "review signal",
        "sampled frames": "clip",
        "evidence was limited": "the clip was brief",
        "rubric element": "teaching move",
        "rubric": "teaching",
        "domain": "area",
        "element": "move",
        "The teacher demonstrated": "You showed",
        "the teacher demonstrated": "you showed",
        "The teacher used": "You used",
        "the teacher used": "you used",
        "The teacher showed": "You showed",
        "the teacher showed": "you showed",
        "The teacher displayed": "You showed",
        "the teacher displayed": "you showed",
        "based on the evidence": "from what was visible",
        "evidence": "moment",
        "this segment": "this moment",
    }
    for old, new in replacements.items():
        text = re.sub(re.escape(old), new, text, flags=re.IGNORECASE)
    text = re.sub(r"\bOverall performance:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Developing|Proficient|Distinguished|Needs Improvement)\b\s*(?:\(\d+(?:\.\d+)?/10\))?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:score|confidence|rated)\s*(?:of|at|=|:)?\s*\d+(?:\.\d+)?(?:/10|%)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b\d+\.\d+\b", "", text)
    text = re.sub(r"\bcoach\s+d\d+[a-z]?\b", "try this coaching move", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:[1-4][a-f]|d[1-4][a-f]?|m[1-6][a-j]?)\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).replace(" .", ".").replace(" ,", ",").strip(" -:;")
    if not text:
        return "בחרו מהלך קטן אחד לנסות בשיעור הבא." if hebrew else "Choose one small move to try in your next lesson."
    return text


def _teacher_voice(text: str, *, language: Optional[str] = "en", path: str = "summary") -> str:
    text = _strip_leakage(text, language=language)
    text = rewrite_payload_deterministically({"value": text}, language=language, visible_only=False)["value"]
    text = _strip_leakage(text, language=language)
    hebrew = _is_hebrew(language)
    if not hebrew:
        text = re.sub(r"\bTeacher\b", "You", text)
        text = re.sub(r"\bteacher\b", "you", text)
        lowered = text.lower()
        if path in {"summary", "highlight", "moment"} and not any(token in f" {lowered} " for token in (" you ", " your ")):
            text = f"You can revisit this moment: {text[0].lower() + text[1:] if text else text}"
        if path == "action" and not lowered.startswith(("try ", "next lesson", "before ", "when ", "after ", "choose ")):
            text = f"Try this next lesson: {text[0].lower() + text[1:] if text else text}"
    elif path == "action" and not any(marker in text for marker in ("בשיעור הבא", "נסו", "נסה", "נסי", "כדאי", "אפשר")):
        text = f"בשיעור הבא, {text}"
    return _clean(text)


def _stable_id(prefix: str, *parts: Any) -> str:
    raw = "-".join(_clean(part) for part in parts if _clean(part))
    raw = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw).strip("-").lower()
    return f"{prefix}-{raw[:80]}" if raw else prefix


def _timestamp(item: Mapping[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    start = item.get("start_sec")
    if start is None:
        start = item.get("timestamp_seconds")
    if start is None:
        start = item.get("start")
    end = item.get("end_sec")
    if end is None:
        end = item.get("end")
    try:
        start_value = float(start) if start is not None else None
    except (TypeError, ValueError):
        start_value = None
    try:
        end_value = float(end) if end is not None else None
    except (TypeError, ValueError):
        end_value = None
    return start_value, end_value


def _video_href(video_id: Optional[str], start_sec: Optional[float] = None) -> Optional[str]:
    if not video_id:
        return None
    href = f"/videos/{video_id}"
    if start_sec is not None:
        href += f"?t={int(max(0, start_sec))}"
    return href


def _moment_candidates(assessment: Mapping[str, Any]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    summary = assessment.get("observation_summary") if isinstance(assessment.get("observation_summary"), Mapping) else {}
    for key in ("moments", "evidence_moments", "highlight_moments", "deep_dive_moments"):
        for item in summary.get(key) or []:
            if isinstance(item, Mapping):
                candidates.append(dict(item))
    for key in ("evidence_segments", "moments", "multimodal_moments", "lesson_moments"):
        for item in assessment.get(key) or []:
            if isinstance(item, Mapping):
                candidates.append(dict(item))
    for score in assessment.get("element_scores") or []:
        if not isinstance(score, Mapping):
            continue
        for segment in score.get("evidence_segments") or []:
            if isinstance(segment, Mapping):
                candidates.append(dict(segment))
    return candidates


def _recommendation_candidates(assessment: Mapping[str, Any]) -> List[Any]:
    summary = assessment.get("observation_summary") if isinstance(assessment.get("observation_summary"), Mapping) else {}
    values: List[Any] = []
    for key in ("actionable_next_steps_structured", "coaching_actions", "recommendations", "next_steps"):
        values.extend(summary.get(key) or [])
    values.extend(assessment.get("recommendations") or [])
    return values


def _item_text(item: Any) -> str:
    if isinstance(item, str):
        return _clean(item)
    if isinstance(item, Mapping):
        return _first_nonempty(
            item.get("try_next_lesson"),
            item.get("text"),
            item.get("body"),
            item.get("summary"),
            item.get("recommendation"),
            item.get("title"),
            item.get("description"),
        )
    return ""


def _reflection_prompts(language: Optional[str]) -> List[str]:
    if _is_hebrew(language):
        return [
            "מה עבד טוב ברגע הזה?",
            "מה תרצו לנסות אחרת בשיעור הבא?",
            "אם ניסיתם את המהלך, מה שמתם לב שקרה?",
        ]
    return [
        "What do you think went well?",
        "What would you try differently?",
        "If you tried this move, what did you notice?",
    ]


def _readiness_payload(readiness: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    readiness = readiness or {}
    blockers = list(readiness.get("blockers") or readiness.get("missing_items") or [])
    next_step = readiness.get("setup_next_step") or (blockers[0] if blockers else None)
    return {
        "ready_to_record": bool(readiness.get("upload_ready") or readiness.get("ready_to_record")),
        "blockers": blockers,
        "next_step": next_step,
    }


def _growth_payload(lesson_history: Optional[Sequence[Mapping[str, Any]]], language: Optional[str]) -> Dict[str, Any]:
    history = list(lesson_history or [])
    if len(history) < 2:
        return {
            "available": False,
            "items": [],
            "empty_state": (
                "אחרי כמה שיעורים שנבדקו, יוצגו כאן דפוסים במה שאתם מתרגלים ומה שמתחזק."
                if _is_hebrew(language)
                else "After a few reviewed lessons, this space will show patterns in what you are practicing and what is getting stronger."
            ),
        }
    return {
        "available": True,
        "items": [
            {
                "id": "practice-rhythm",
                "title": "Practice pattern" if not _is_hebrew(language) else "דפוס תרגול",
                "body": (
                    "You have more than one reviewed lesson now, so this space can track what you keep practicing."
                    if not _is_hebrew(language)
                    else "יש כבר יותר משיעור אחד שנבדק, ולכן אפשר לעקוב כאן אחרי מה שאתם מתרגלים לאורך זמן."
                ),
            }
        ],
        "empty_state": "",
    }


def validate_teacher_feedback_projection(payload: Mapping[str, Any], language: Optional[str] = "en") -> List[Dict[str, str]]:
    visible_payload = deepcopy(dict(payload or {}))
    visible_payload.pop("_internal_metadata", None)
    visible_payload.pop("to_dos", None)
    issues = validate_payload_text(visible_payload, language=language, require_direct_address=False, visible_only=False)
    for path, value in _iter_visible_strings(payload):
        if _is_internal_path(path) or path.startswith("to_dos"):
            continue
        if LEAKAGE_RE.search(value):
            issues.append(
                {
                    "path": path,
                    "issue_type": "teacher_feedback_leakage",
                    "message": "Teacher-visible feedback contains score, rubric, band, or system language.",
                    "value": value,
                    "severity": "error",
                }
            )
    normalized = {}
    for path, value in _iter_visible_strings(payload):
        if _is_internal_path(path) or path.startswith("to_dos") or path.startswith("deep_dive") or path.endswith("why_it_matters"):
            continue
        if not (
            path in {"latest_summary.opening", "latest_summary.strength", "latest_summary.growth_focus", "latest_summary.next_step"}
            or path.endswith(".body")
        ):
            continue
        cleaned = _clean(value).lower()
        if len(cleaned) < 32:
            continue
        if cleaned in normalized:
            issues.append(
                {
                    "path": path,
                    "issue_type": "duplicate_teacher_visible_text",
                    "message": "Teacher-visible cards should not reuse the same full paragraph.",
                    "value": value,
                    "severity": "warning",
                }
            )
        normalized[cleaned] = path
    return issues


def sanitize_teacher_feedback_projection(payload: Mapping[str, Any], language: Optional[str] = "en") -> Dict[str, Any]:
    cleaned = deepcopy(dict(payload or {}))

    def visit(value: Any, path: str = "") -> Any:
        if isinstance(value, dict):
            return {key: visit(child, f"{path}.{key}" if path else str(key)) for key, child in value.items()}
        if isinstance(value, list):
            return [visit(child, f"{path}[{index}]") for index, child in enumerate(value)]
        if isinstance(value, str) and not _is_internal_path(path):
            if _is_visible_text_key(path):
                return _teacher_voice(value, language=language, path=_path_kind(path))
            return _strip_leakage(value, language=language)
        return value

    cleaned = visit(cleaned)
    cleaned["guardrails"] = {
        **(cleaned.get("guardrails") or {}),
        "teacher_visible": True,
        "scores_removed": True,
        "rubric_removed": True,
        "language": language or "en",
        "projection_version": TEACHER_FEEDBACK_REQUIRED_VERSION,
    }
    issues = validate_teacher_feedback_projection(cleaned, language=language)
    if issues:
        cleaned.setdefault("_internal_metadata", {})["voice_gate_issues"] = issues
    return cleaned


def _is_internal_path(path: str) -> bool:
    return any(part in path for part in ("_internal_metadata", "metadata", "selection_reason", "raw_source"))


def _is_visible_text_key(path: str) -> bool:
    last = re.split(r"[.\[\]]+", path)[-1]
    return last in {
        "opening",
        "strength",
        "growth_focus",
        "next_step",
        "title",
        "body",
        "try_next_lesson",
        "why_it_matters",
        "what_happened",
        "empty_state",
        "description",
    }


def _path_kind(path: str) -> str:
    if "action_items" in path or "to_dos" in path:
        return "action"
    if "highlights" in path:
        return "highlight"
    if "moments" in path or "deep_dive" in path:
        return "moment"
    return "summary"


def _iter_visible_strings(value: Any, path: str = "") -> Iterable[Tuple[str, str]]:
    if isinstance(value, Mapping):
        for key, child in value.items():
            next_path = f"{path}.{key}" if path else str(key)
            yield from _iter_visible_strings(child, next_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_visible_strings(child, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value


def build_teacher_coaching_intelligence(
    *,
    assessment: Optional[Mapping[str, Any]] = None,
    video: Optional[Mapping[str, Any]] = None,
    teacher: Optional[Mapping[str, Any]] = None,
    readiness: Optional[Mapping[str, Any]] = None,
    coaching_tasks: Optional[Sequence[Mapping[str, Any]]] = None,
    reflections: Optional[Sequence[Mapping[str, Any]]] = None,
    admin_comments: Optional[Sequence[Mapping[str, Any]]] = None,
    recognition_badges: Optional[Sequence[Mapping[str, Any]]] = None,
    lesson_history: Optional[Sequence[Mapping[str, Any]]] = None,
    language: Optional[str] = "en",
) -> Dict[str, Any]:
    assessment = assessment or {}
    video = video or {}
    teacher = teacher or {}
    video_id = assessment.get("video_id") or video.get("id")
    lesson_title = _first_nonempty(video.get("lesson_title"), video.get("title"), video.get("filename"), assessment.get("subject"), teacher.get("subject"), "Lesson recording")
    subject = _first_nonempty(assessment.get("subject"), video.get("subject"), teacher.get("subject"))
    moments = _moment_candidates(assessment)
    recommendations = _recommendation_candidates(assessment)
    summary = assessment.get("observation_summary") if isinstance(assessment.get("observation_summary"), Mapping) else {}
    raw_summary = _first_nonempty(
        summary.get("teacher_summary"),
        summary.get("coaching_summary"),
        summary.get("executive_summary"),
        assessment.get("teacher_summary"),
        assessment.get("summary"),
    )
    summary_sentences = _split_sentences(_teacher_voice(raw_summary, language=language, path="summary"))[:2]

    first_moment = moments[0] if moments else {}
    first_moment_text = _first_nonempty(
        first_moment.get("what_happened"),
        first_moment.get("summary"),
        first_moment.get("description"),
        first_moment.get("text"),
    )
    first_action_text = _item_text(recommendations[0]) if recommendations else ""

    opening = " ".join(summary_sentences) if summary_sentences else (
        "בחרו רגע אחד מהשיעור וחזרו אליו לפני התכנון הבא." if _is_hebrew(language) else "Choose one moment from this lesson to revisit before planning the next one."
    )
    strength = _teacher_voice(
        _first_nonempty(first_moment_text, summary.get("strength"), "You gave students something concrete to respond to."),
        language=language,
        path="highlight",
    )
    growth_focus = _teacher_voice(
        _first_nonempty(summary.get("growth_focus"), first_action_text, "Keep the next move small enough to try right away."),
        language=language,
        path="action",
    )
    next_step = _teacher_voice(
        _first_nonempty(first_action_text, "Pick one question or pause you can try in the next lesson."),
        language=language,
        path="action",
    )
    if growth_focus.lower() == next_step.lower():
        growth_focus = (
            "שמרו על מהלך תרגול אחד ברור כדי שתוכלו לשים לב להשפעה שלו."
            if _is_hebrew(language)
            else "Keep the practice focus to one move so you can notice what changes."
        )
    if next_step.lower() == _teacher_voice(first_action_text, language=language, path="action").lower():
        next_step = (
            "קחו את המהלך הזה לשיעור הבא ושימו לב מי מצטרף לשיחה."
            if _is_hebrew(language)
            else "Carry that move into your next lesson and notice who joins the conversation."
        )

    highlights: List[Dict[str, Any]] = []
    seen_text = {opening.lower()}
    for index, moment in enumerate(moments):
        text = _teacher_voice(_first_nonempty(moment.get("positive"), moment.get("what_happened"), moment.get("summary"), moment.get("description"), moment.get("text")), language=language, path="highlight")
        if not text or text.lower() in seen_text:
            continue
        start_sec, end_sec = _timestamp(moment)
        highlights.append(
            {
                "id": _stable_id("highlight", assessment.get("id"), index),
                "title": "Moment worth keeping" if not _is_hebrew(language) else "רגע שכדאי לשמר",
                "body": text,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "video_href": _video_href(video_id, start_sec),
                "source": "analysis",
            }
        )
        seen_text.add(text.lower())
        if len(highlights) >= 2:
            break
    if highlights and strength.lower() == str(highlights[0].get("body") or "").lower():
        strength = (
            "החוזקה המרכזית היא שנתתם מקום לתגובה נוספת בכיתה."
            if _is_hebrew(language)
            else "The strength to keep is the space you created for another student voice."
        )

    action_items: List[Dict[str, Any]] = []
    action_seen = set()
    for index, item in enumerate(list(coaching_tasks or []) + list(recommendations or [])):
        text = _teacher_voice(_item_text(item), language=language, path="action")
        if not text or text.lower() in action_seen:
            continue
        if isinstance(item, Mapping):
            start_sec, end_sec = _timestamp(item)
            item_id = item.get("id") or _stable_id("action", assessment.get("id"), index)
            status = str(item.get("status") or "open").lower()
            reflection_count = int(item.get("reflection_count") or 0)
            shared_reflection_count = int(item.get("shared_reflection_count") or 0)
        else:
            start_sec, end_sec = None, None
            item_id = _stable_id("action", assessment.get("id"), index)
            status = "open"
            reflection_count = 0
            shared_reflection_count = 0
        if status not in {"open", "tried", "reflected"}:
            status = "reflected" if status in {"completed", "done"} else "open"
        action_items.append(
            {
                "id": item_id,
                "title": _teacher_voice(_first_nonempty((item or {}).get("title") if isinstance(item, Mapping) else "", text.split(".")[0], "Next-lesson move"), language=language, path="action"),
                "body": text,
                "try_next_lesson": text,
                "why_it_matters": "This keeps your next practice move small enough to notice what changes." if not _is_hebrew(language) else "כך אפשר לתרגל מהלך קטן ולראות מה משתנה.",
                "start_sec": start_sec,
                "end_sec": end_sec,
                "status": status,
                "reflection_count": reflection_count,
                "shared_reflection_count": shared_reflection_count,
                "video_href": _video_href(video_id, start_sec),
            }
        )
        action_seen.add(text.lower())
        if len(action_items) >= 3:
            break

    deep_moments: List[Dict[str, Any]] = []
    for index, moment in enumerate(moments[:4]):
        text = _teacher_voice(_first_nonempty(moment.get("what_happened"), moment.get("summary"), moment.get("description"), moment.get("text")), language=language, path="moment")
        if not text:
            continue
        start_sec, end_sec = _timestamp(moment)
        deep_moments.append(
            {
                "id": _stable_id("moment", assessment.get("id"), index),
                "start_sec": start_sec,
                "end_sec": end_sec,
                "title": "Watch this moment" if not _is_hebrew(language) else "חזרו לרגע הזה",
                "what_happened": text,
                "why_it_matters": "This moment can help you choose one move to repeat or adjust." if not _is_hebrew(language) else "הרגע הזה יכול לעזור לבחור מה לשמר או לכוונן.",
                "video_href": _video_href(video_id, start_sec),
            }
        )

    recognition = []
    for badge in recognition_badges or []:
        recognition.append(
            {
                "id": badge.get("id") or _stable_id("recognition", video_id),
                "type": badge.get("recognition_type") or badge.get("badge_type") or "gold_star",
                "title": _strip_leakage(_first_nonempty(badge.get("title"), "Gold-Star moment"), language=language),
                "body": _teacher_voice(_first_nonempty(badge.get("description"), badge.get("awarded_for"), "A reviewed lesson highlighted a teaching move worth celebrating."), language=language, path="highlight"),
                "awarded_at": badge.get("awarded_at") or badge.get("earned_at") or badge.get("created_at"),
                "share_url": badge.get("share_url"),
            }
        )

    payload = {
        "lesson_id": assessment.get("id") or video.get("id"),
        "video_id": video_id,
        "lesson_title": lesson_title,
        "subject": subject,
        "recorded_at": assessment.get("recorded_at") or video.get("recorded_at") or video.get("upload_date"),
        "reviewed_at": assessment.get("analyzed_at") or assessment.get("reviewed_at"),
        "status": "reviewed" if assessment else video.get("status") or "uploaded",
        "language": language or "en",
        "recording_compliance": _readiness_payload(readiness),
        "latest_summary": {
            "opening": opening,
            "strength": strength,
            "growth_focus": growth_focus,
            "next_step": next_step,
        },
        "highlights": highlights,
        "action_items": action_items,
        "to_dos": action_items,
        "recognition": recognition,
        "deep_dive": {"available": bool(deep_moments), "moments": deep_moments},
        "reflection_prompts": _reflection_prompts(language),
        "growth_over_time": _growth_payload(lesson_history, language),
        "guardrails": {
            "teacher_visible": True,
            "scores_removed": True,
            "rubric_removed": True,
            "language": language or "en",
        },
        "_internal_metadata": {
            "projection_version": TEACHER_FEEDBACK_REQUIRED_VERSION,
            "selected_from": {
                "assessment": bool(assessment),
                "moments": len(moments),
                "recommendations": len(recommendations),
                "coaching_tasks": len(coaching_tasks or []),
                "recognition": len(recognition_badges or []),
            },
            "source_assessment_id": assessment.get("id"),
            "source_video_id": video_id,
        },
    }
    return sanitize_teacher_feedback_projection(payload, language=language)
