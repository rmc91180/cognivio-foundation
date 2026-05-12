from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
import re
import uuid


BANNED_PHRASES: Tuple[str, ...] = (
    "evidence was limited",
    "in the sampled frames",
    "sampled frames",
    "analysis mode",
    "confidence score",
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
    "visible evidence",
    "timestamped evidence",
)

RUBRIC_CODE_RE = re.compile(
    r"\b(?:[1-4][a-f]|d[1-4][a-f]?|m[1-6][a-j]?)\b",
    re.IGNORECASE,
)

SCORE_TEXT_RE = re.compile(
    r"\b(?:score|confidence|rated)\s*(?:of|at|=|:)?\s*\d+(?:\.\d+)?(?:/10|%)?",
    re.IGNORECASE,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _as_dict(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _is_hebrew(language: Optional[str]) -> bool:
    normalized = str(language or "").strip().lower()
    return normalized.startswith("he") or normalized in {"iw", "heb", "hebrew", "עברית"}


def _format_time(seconds: Any, *, hebrew: bool = False) -> str:
    try:
        total = int(float(seconds))
    except Exception:
        total = 0

    total = max(total, 0)
    minutes = total // 60
    secs = total % 60

    if hebrew:
        if minutes:
            return f"סביב דקה {minutes}:{secs:02d}"
        return f"בתחילת הקטע, סביב {secs} שניות"

    if minutes:
        return f"around the {minutes}:{secs:02d} mark"
    return f"in the opening {secs} seconds"


def _teacher_name(teacher: Mapping[str, Any]) -> str:
    return (
        _clean(teacher.get("name"))
        or _clean(teacher.get("full_name"))
        or _clean(teacher.get("email")).split("@")[0]
        or "this teacher"
    )


def _element_label(
    element_id: Any,
    catalog: Optional[Mapping[str, str]] = None,
    element_score: Optional[Mapping[str, Any]] = None,
) -> str:
    key = _clean(element_id)
    if catalog and key in catalog:
        return _clean(catalog[key])

    if element_score:
        return (
            _clean(element_score.get("element_name"))
            or _clean(element_score.get("name"))
            or _clean(element_score.get("label"))
            or key
        )

    return key or "this area of practice"


def _instructional_move(label: str) -> str:
    raw = _clean(label)
    if not raw:
        return "your instruction"

    text = re.sub(
        r"^(domain\s*\d+|component|element|rubric)\s*[:\-]?\s*",
        "",
        raw,
        flags=re.IGNORECASE,
    )
    text = RUBRIC_CODE_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip(" -:—")
    return text or "your instruction"


def _strip_system_language(text: str, *, hebrew: bool = False) -> str:
    cleaned = _clean(text)
    if not cleaned:
        return ""

    replacements = {
        "Evidence was limited in the sampled frames.": (
            "החלון שהיה לנו בסרטון היה קצר — הנה מה שבלט בתוכו."
            if hebrew
            else "The clip gave us a brief window into this lesson — here is what stood out."
        ),
        "evidence was limited": "the clip was brief",
        "in the sampled frames": "in the clip",
        "sampled frames": "the clip",
        "visible evidence": "what was visible",
        "timestamped evidence segment": "moment",
        "timestamped evidence": "moment",
        "analysis mode": "review",
        "confidence score": "signal",
        "confidence value": "signal",
        "rubric element": "instructional move",
        "based on the evidence": "from what was visible",
        "this segment": "this moment",
        "sampled moment": "moment",
        "data suggests": "what stood out is",
        "The teacher demonstrated": "You showed",
        "the teacher demonstrated": "you showed",
        "The teacher used": "You used",
        "the teacher used": "you used",
        "The teacher showed": "You showed",
        "the teacher showed": "you showed",
        "The teacher displayed": "You showed",
        "the teacher displayed": "you showed",
    }

    for bad, good in replacements.items():
        cleaned = cleaned.replace(bad, good)

    cleaned = SCORE_TEXT_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.replace(" .", ".").replace(" ,", ",").strip()
    return cleaned


def _ensure_direct_address(text: str, *, hebrew: bool = False) -> str:
    text = _strip_system_language(text, hebrew=hebrew)
    if not text:
        return ""

    lowered = text.lower()

    if hebrew:
        direct_markers = (
            "את ",
            "אתה ",
            "שלך",
            "ראית",
            "עשית",
            "הובלת",
            "נתת",
            "שאלת",
            "אפשר",
        )
        if any(marker in text for marker in direct_markers):
            return text
        return f"במה שראינו, {text}"

    if (
        " you " in f" {lowered} "
        or " your " in f" {lowered} "
        or lowered.startswith(("you ", "your "))
    ):
        return text

    if lowered.startswith("around ") or lowered.startswith("at ") or lowered.startswith("when "):
        return f"{text} You can build on that moment in the next lesson."

    return f"You {text[0].lower() + text[1:] if text else text}"


def _sentence_limit(text: str, max_sentences: int = 3) -> str:
    cleaned = _clean(text)
    if not cleaned:
        return ""

    pieces = re.split(r"(?<=[.!?])\s+", cleaned)
    return " ".join(piece for piece in pieces[:max_sentences] if piece).strip()


def _first_nonempty(*values: Any) -> str:
    for value in values:
        cleaned = _clean(value)
        if cleaned:
            return cleaned
    return ""


def _safe_summary(analysis: Mapping[str, Any], *, hebrew: bool = False) -> str:
    raw = _first_nonempty(
        analysis.get("summary"),
        analysis.get("overall_summary"),
        analysis.get("feedback_summary"),
        analysis.get("observation_summary"),
    )

    if raw:
        return _sentence_limit(_ensure_direct_address(raw, hebrew=hebrew), 3)

    if hebrew:
        return (
            "ראינו שיעור שיש בו בסיס טוב לשיחה מקצועית. "
            "כדאי להתחיל ממה שעבד, ואז לבחור מהלך אחד קטן לנסות בשיעור הבא."
        )

    return (
        "You have a solid starting point for a useful coaching conversation. "
        "Start with what worked in the lesson, then choose one small move to try next time."
    )


def _collect_element_scores(analysis: Mapping[str, Any]) -> List[Dict[str, Any]]:
    scores = (
        analysis.get("element_scores")
        or analysis.get("scores")
        or analysis.get("elements")
        or []
    )
    return [dict(item) for item in scores if isinstance(item, Mapping)]


def _collect_recommendations(analysis: Mapping[str, Any]) -> List[Dict[str, Any]]:
    recommendations = analysis.get("recommendations") or analysis.get("next_steps") or []
    normalized: List[Dict[str, Any]] = []

    for item in _as_list(recommendations):
        if isinstance(item, Mapping):
            normalized.append(dict(item))
        elif _clean(item):
            normalized.append({"text": _clean(item)})

    return normalized


def _segment_text(segment: Mapping[str, Any], *, hebrew: bool = False) -> str:
    start = segment.get("start_sec", segment.get("start", segment.get("timestamp")))
    time_label = _format_time(start, hebrew=hebrew)

    raw = _first_nonempty(
        segment.get("summary"),
        segment.get("text"),
        segment.get("description"),
        segment.get("rationale"),
    )
    raw = _ensure_direct_address(raw, hebrew=hebrew) if raw else ""

    if hebrew:
        if raw:
            return f"{time_label}, {raw}"
        return f"{time_label}, היה רגע שכדאי לחזור אליו יחד ולבדוק מה עבד בו."

    if raw:
        return f"{time_label}, {raw}"

    return (
        f"{time_label}, there was a moment worth revisiting together because it can "
        "anchor the coaching conversation."
    )


def _extract_moments(
    element_scores: Sequence[Mapping[str, Any]],
    *,
    hebrew: bool = False,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    moments: List[Dict[str, Any]] = []

    for element in element_scores:
        element_id = element.get("element_id") or element.get("id")
        element_name = _instructional_move(_element_label(element_id, element_score=element))

        for segment in _as_list(element.get("evidence_segments") or element.get("segments")):
            if not isinstance(segment, Mapping):
                continue

            start = segment.get("start_sec", segment.get("start", segment.get("timestamp")))
            end = segment.get("end_sec", segment.get("end"))
            summary = _segment_text(segment, hebrew=hebrew)

            rationale_raw = _first_nonempty(
                segment.get("rationale"),
                segment.get("why_it_matters"),
            )
            if rationale_raw:
                rationale = _sentence_limit(_ensure_direct_address(rationale_raw, hebrew=hebrew), 2)
            else:
                rationale = (
                    f"הרגע הזה חשוב כי הוא מראה איך {element_name} נראה בפועל בשיעור."
                    if hebrew
                    else f"This matters because it shows what {element_name.lower()} looked like in the lesson."
                )

            moments.append(
                {
                    "element_id": element_id,
                    "element_name": element_name,
                    "start_sec": start,
                    "end_sec": end,
                    "timestamp_label": _format_time(start, hebrew=hebrew),
                    "summary": summary,
                    "rationale": rationale,
                }
            )

            if len(moments) >= limit:
                return moments

    return moments


def _observation_texts(element: Mapping[str, Any], *, hebrew: bool = False) -> List[str]:
    values = element.get("observations") or element.get("observation") or []
    texts: List[str] = []

    for item in _as_list(values):
        if isinstance(item, Mapping):
            raw = _first_nonempty(
                item.get("text"),
                item.get("summary"),
                item.get("observation"),
            )
        else:
            raw = _clean(item)

        if raw:
            texts.append(_sentence_limit(_ensure_direct_address(raw, hebrew=hebrew), 2))

    return [text for text in texts if text]


def _strengths_from_scores(
    element_scores: Sequence[Mapping[str, Any]],
    *,
    hebrew: bool = False,
    limit: int = 3,
) -> List[str]:
    ranked = sorted(
        element_scores,
        key=lambda item: float(item.get("score") or 0),
        reverse=True,
    )

    strengths: List[str] = []

    for element in ranked:
        label = _instructional_move(
            _element_label(element.get("element_id") or element.get("id"), element_score=element)
        )
        observations = _observation_texts(element, hebrew=hebrew)

        if observations:
            strengths.append(observations[0])
        else:
            strengths.append(
                f"ראינו בסיס חזק סביב {label}; כדאי לפתוח שם את השיחה."
                if hebrew
                else (
                    f"You had a useful moment around {label.lower()}; "
                    "that is a good place to begin the conversation."
                )
            )

        if len(strengths) >= limit:
            break

    return strengths


def _growth_from_scores(
    element_scores: Sequence[Mapping[str, Any]],
    *,
    hebrew: bool = False,
    limit: int = 3,
) -> List[str]:
    ranked = sorted(element_scores, key=lambda item: float(item.get("score") or 0))
    growth: List[str] = []

    for element in ranked:
        label = _instructional_move(
            _element_label(element.get("element_id") or element.get("id"), element_score=element)
        )
        observations = _observation_texts(element, hebrew=hebrew)

        if observations:
            if hebrew:
                growth.append(
                    f"אחרי שמזהים מה עבד, שווה לבדוק יחד איך להרחיב את {label} בשיעור הבא."
                )
            else:
                growth.append(
                    "After naming what worked, look together at how you can strengthen "
                    f"{label.lower()} in the next lesson."
                )
        else:
            growth.append(
                f"אחרי שמזהים מה כבר עובד, כדאי לבחור מהלך אחד קטן שיחזק את {label} בשיעור הבא."
                if hebrew
                else (
                    "After naming what is already working, choose one small next move "
                    f"to strengthen {label.lower()} in the next lesson."
                )
            )

        if len(growth) >= limit:
            break

    return growth


def _recommendation_text(item: Mapping[str, Any], *, hebrew: bool = False) -> str:
    raw = _first_nonempty(
        item.get("text"),
        item.get("recommendation"),
        item.get("action"),
        item.get("title"),
    )

    if raw:
        text = _ensure_direct_address(raw, hebrew=hebrew)
    else:
        text = (
            "בשיעור הבא, בחרו רגע אחד שבו עוצרים, נותנים זמן חשיבה קצר, ואז מזמינים עוד תלמיד אחד להשתתף."
            if hebrew
            else (
                "Next lesson, try choosing one moment to pause, give students a few seconds "
                "to think, and then invite one more student into the discussion."
            )
        )

    if hebrew:
        if not any(marker in text for marker in ("בשיעור הבא", "נסו", "אפשר", "כדאי")):
            text = f"בשיעור הבא, {text}"
    else:
        lowered = text.lower()
        if not lowered.startswith(("next lesson", "try ", "one thing", "before ", "after ", "when ")):
            text = f"Next lesson, {text[0].lower() + text[1:] if text else text}"

    return _sentence_limit(text, 3)


def _normalize_recommendations(
    recommendations: Sequence[Mapping[str, Any]],
    *,
    hebrew: bool = False,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []

    for item in recommendations:
        text = _recommendation_text(item, hebrew=hebrew)
        normalized.append(
            {
                **{
                    key: value
                    for key, value in dict(item).items()
                    if key not in {"text", "recommendation", "action"}
                },
                "text": text,
            }
        )

        if len(normalized) >= limit:
            break

    if not normalized:
        normalized.append(
            {
                "text": _recommendation_text({}, hebrew=hebrew),
                "linked_element_id": None,
            }
        )

    return normalized


def _teacher_reflection_prompts(*, hebrew: bool = False) -> List[str]:
    if hebrew:
        return [
            "מה לדעתך עבד טוב בשיעור הזה?",
            "איזה רגע היית רוצה לראות שוב לפני השיחה?",
            "מהלך אחד קטן שתרצה לנסות בשיעור הבא?",
        ]

    return [
        "What do you think went well in this lesson?",
        "Which moment would you want to watch again before the conversation?",
        "What is one small move you might try in the next lesson?",
    ]


def _observer_next_steps(
    teacher_name: str,
    recommendations: Sequence[Mapping[str, Any]],
    *,
    hebrew: bool = False,
) -> List[str]:
    first_action = _clean((recommendations[0] or {}).get("text")) if recommendations else ""

    if hebrew:
        steps = [
            f"פתחו את השיחה עם {teacher_name} במה שעבד לפני שעוברים לנקודת הפיתוח.",
            "בחרו רגע אחד מהסרטון וצפו בו יחד.",
        ]
        if first_action:
            steps.append("סיימו בהחלטה על מהלך אחד לשיעור הבא.")
        return steps

    steps = [
        f"Open the conversation with what worked for {teacher_name} before moving to the growth point.",
        "Choose one moment from the recording and watch it together.",
    ]
    if first_action:
        steps.append("End by agreeing on one move to try in the next lesson.")

    return steps


def _contains_banned_language(text: str) -> bool:
    lowered = _clean(text).lower()
    if not lowered:
        return False

    return any(phrase in lowered for phrase in BANNED_PHRASES) or bool(SCORE_TEXT_RE.search(lowered))


def _audit_texts(value: Any, path: str = "") -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []

    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            issues.extend(_audit_texts(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            issues.extend(_audit_texts(child, f"{path}[{idx}]"))
    elif isinstance(value, str):
        if _contains_banned_language(value):
            issues.append(
                {
                    "path": path,
                    "issue": "banned_or_system_language",
                    "text": value,
                }
            )

    return issues


def _infer_inputs(args: Tuple[Any, ...], kwargs: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(kwargs)

    # Common call-shape protection:
    # render_master_observer_feedback(assessment, session, teacher, video, observer)
    positional_names = ("assessment", "session", "teacher", "video", "observer")
    for name, value in zip(positional_names, args):
        data.setdefault(name, value)

    if "analysis" not in data:
        data["analysis"] = (
            data.get("analysis_payload")
            or data.get("assessment")
            or data.get("feedback")
            or data.get("result")
            or {}
        )

    return data


def render_master_observer_feedback(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    """
    Build a master-observer feedback artifact in Cognivio coach voice.

    Design contract:
    - Accepts broad positional/keyword call shapes so server.py can call it from
      observation, assessment, or admin flows without import-time coupling.
    - Does not import server.py, preventing circular imports during backend boot.
    - Preserves all numeric scores, timestamps, element IDs, and raw analysis
      fields by embedding a normalized copy under source_snapshot.
    - Rewrites only user-visible text into direct, warm, actionable coaching voice.
    - Never calls an external model; the later tone specialist can do AI cleanup
      when configured, while this renderer remains safe during imports/tests.
    """
    inputs = _infer_inputs(args, kwargs)

    teacher = _as_dict(inputs.get("teacher"))
    observer = _as_dict(inputs.get("observer") or inputs.get("current_user"))
    session = _as_dict(inputs.get("session") or inputs.get("observation_session"))
    video = _as_dict(inputs.get("video"))
    analysis = _as_dict(inputs.get("analysis"))
    assessment = _as_dict(inputs.get("assessment"))

    if assessment and not analysis:
        analysis = assessment

    language = (
        inputs.get("language")
        or analysis.get("analysis_language")
        or assessment.get("analysis_language")
        or "en"
    )
    hebrew = _is_hebrew(language)

    teacher_name = _teacher_name(teacher)
    observer_name = (
        _clean(observer.get("name") or observer.get("email"))
        or ("המלווה" if hebrew else "your observer")
    )

    element_catalog = inputs.get("element_catalog") or inputs.get("catalog") or {}
    if not isinstance(element_catalog, Mapping):
        element_catalog = {}

    element_scores = _collect_element_scores(analysis)
    recommendations = _normalize_recommendations(
        _collect_recommendations(analysis),
        hebrew=hebrew,
    )
    evidence_moments = _extract_moments(element_scores, hebrew=hebrew)
    strengths = _strengths_from_scores(element_scores, hebrew=hebrew)
    growth_areas = _growth_from_scores(element_scores, hebrew=hebrew)

    focus_note = _clean(
        inputs.get("focus_note")
        or session.get("focus_note")
        or analysis.get("focus_note")
    )
    focus_elements = _as_list(
        inputs.get("focus_elements")
        or session.get("focus_elements")
        or analysis.get("priority_elements")
    )
    focus_labels = [
        _instructional_move(_element_label(item, catalog=element_catalog))
        for item in focus_elements
        if _clean(item)
    ]

    summary = _safe_summary(analysis, hebrew=hebrew)
    if focus_note:
        if hebrew:
            summary = _sentence_limit(
                f"{summary} כדאי להחזיק בראש את מוקד הצפייה: {focus_note}",
                3,
            )
        else:
            summary = _sentence_limit(
                f"{summary} Keep the observation focus in view: {focus_note}",
                3,
            )

    if hebrew:
        opening = (
            f"השיחה עם {teacher_name} צריכה להתחיל במה שעבד, "
            "ואז לעבור למהלך אחד ברור לשיעור הבא."
        )
    else:
        opening = (
            f"Start the conversation with what worked for {teacher_name}, "
            "then move to one clear next step for the next lesson."
        )

    artifact: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "artifact_type": "master_observer_feedback",
        "schema_version": "coach_voice_v1",
        "generated_at": _utc_now(),
        "language": "he" if hebrew else "en",
        "teacher": {
            "id": teacher.get("id") or analysis.get("teacher_id") or assessment.get("teacher_id"),
            "name": teacher_name,
            "email": teacher.get("email"),
        },
        "observer": {
            "id": observer.get("id") or session.get("observer_id"),
            "name": observer_name,
            "email": observer.get("email"),
        },
        "session": {
            "id": (
                session.get("id")
                or analysis.get("observation_session_id")
                or assessment.get("observation_session_id")
            ),
            "focus_note": focus_note,
            "focus_elements": focus_elements,
            "focus_labels": focus_labels,
        },
        "video": {
            "id": (
                video.get("id")
                or analysis.get("video_id")
                or assessment.get("video_id")
                or session.get("linked_video_id")
            ),
            "filename": video.get("filename"),
        },
        "summary": summary,
        "opening_note_for_observer": opening,
        "strengths": strengths,
        "growth_areas": growth_areas,
        "evidence_moments": evidence_moments,
        "recommendations": recommendations,
        "teacher_reflection_prompts": _teacher_reflection_prompts(hebrew=hebrew),
        "observer_next_steps": _observer_next_steps(
            teacher_name,
            recommendations,
            hebrew=hebrew,
        ),
        "conference_prep": {
            "teacher_prompt": (
                f"השיעור האחרון שלך נצפה. לפני השיחה עם {observer_name}, "
                "כדאי לקחת כמה דקות לצפות ולסמן: מה עבד טוב? "
                "מה היית רוצה לנסות אחרת? ההתבוננות שלך חשובה — היא מעצבת את השיחה."
                if hebrew
                else (
                    "Your latest lesson has been reviewed. Before your next conversation "
                    f"with {observer_name}, take a few minutes to watch the recording and note: "
                    "What do you think went well? What would you try differently? "
                    "Your reflection matters — it shapes the conversation."
                )
            ),
            "observer_prompt": (
                f"צפו ברגע אחד עם {teacher_name}, התחילו במה שעבד, "
                "וסיימו במהלך אחד ברור לשיעור הבא."
                if hebrew
                else (
                    f"Watch one moment with {teacher_name}, start with what worked, "
                    "and end with one clear move for the next lesson."
                )
            ),
        },
        "source_snapshot": {
            "summary": analysis.get("summary") or assessment.get("summary"),
            "overall_score": analysis.get("overall_score") or assessment.get("overall_score"),
            "element_scores": element_scores,
            "recommendations": _collect_recommendations(analysis),
        },
        "guardrails": {
            "preserved_numeric_fields": True,
            "preserved_timestamps": True,
            "preserved_element_ids": True,
            "no_external_ai_call": True,
        },
    }

    audit_issues = _audit_texts(
        {
            "summary": artifact["summary"],
            "opening_note_for_observer": artifact["opening_note_for_observer"],
            "strengths": artifact["strengths"],
            "growth_areas": artifact["growth_areas"],
            "evidence_moments": artifact["evidence_moments"],
            "recommendations": artifact["recommendations"],
            "teacher_reflection_prompts": artifact["teacher_reflection_prompts"],
            "observer_next_steps": artifact["observer_next_steps"],
            "conference_prep": artifact["conference_prep"],
        }
    )

    artifact["tone_validation"] = {
        "passed": not audit_issues,
        "issues": audit_issues,
        "banned_phrases_checked": list(BANNED_PHRASES),
    }

    return artifact


__all__ = ["render_master_observer_feedback", "BANNED_PHRASES"]