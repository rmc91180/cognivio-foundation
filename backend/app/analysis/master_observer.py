from __future__ import annotations

from typing import Any, Dict, List, Optional


_SECTION_TITLES_EN = [
    "Instructional Snapshot",
    "Strengths to Keep and Build On",
    "Primary Growth Focus",
    "Evidence-Based Observation Highlights",
    "Try This Next (Actionable, Near-Term)",
    "Rubric-Aligned Interpretation (Light)",
]

_SECTION_TITLES_HE = [
    "תמונת הוראה קצרה",
    "חוזקות לשימור ולהעמקה",
    "מוקד צמיחה מרכזי",
    "הדגשות תצפית מבוססות ראיות",
    "מה לנסות עכשיו (צעדים קרובים וישימים)",
    "פרשנות מותאמת רובריקה (קלה)",
]


def _is_hebrew(language: Optional[str]) -> bool:
    return str(language or "").strip().lower().startswith("he")


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _format_time(seconds: Optional[float]) -> str:
    try:
        total = max(0, int(round(float(seconds or 0.0))))
    except (TypeError, ValueError):
        total = 0
    minutes = total // 60
    remainder = total % 60
    return f"{minutes:02d}:{remainder:02d}"


def _format_time_range(start_sec: Optional[float], end_sec: Optional[float]) -> str:
    start = _format_time(start_sec)
    end = _format_time(end_sec)
    if start == end:
        return start
    return f"{start}-{end}"


def _top_observation(item: Dict[str, Any]) -> str:
    observations = [str(obs or "").strip() for obs in list(item.get("observations") or []) if str(obs or "").strip()]
    if observations:
        return observations[0]
    segments = list(item.get("evidence_segments") or [])
    for segment in segments:
        summary = _safe_text(segment.get("summary"))
        if summary:
            return summary
    name = _safe_text(item.get("element_name") or item.get("element_id") or "instruction")
    return f"You made a visible move in {name.lower()}."


def _build_strengths(
    ranked_scores: List[Dict[str, Any]],
    *,
    language: str,
) -> List[str]:
    strengths: List[str] = []
    for item in ranked_scores[:2]:
        element_name = _safe_text(item.get("element_name") or item.get("element_id") or "instruction")
        observed = _top_observation(item).rstrip(".")
        if _is_hebrew(language):
            strengths.append(
                f"{element_name}: {observed}. למה זה חשוב: המהלך הזה מחזק בהירות ומעודד חשיבה תלמידית גלויה."
            )
        else:
            strengths.append(
                f"{element_name}: {observed}. Why this matters: this move supports clarity and helps student thinking become visible."
            )
    return strengths[:2]


def _build_primary_growth_focus(
    focus_item: Dict[str, Any],
    *,
    language: str,
) -> str:
    element_name = _safe_text(focus_item.get("element_name") or focus_item.get("element_id") or "discussion")
    if _is_hebrew(language):
        return f"לבנות שגרת {element_name} שמרחיבה מי משתתף בחשיבה בזמן אמת במהלך השיעור."
    return f"Build a consistent {element_name} routine that broadens who does the thinking work during discussion."


def _build_evidence_highlights(
    ranked_scores: List[Dict[str, Any]],
    *,
    language: str,
) -> List[str]:
    highlights: List[str] = []
    for item in ranked_scores[:3]:
        segments = list(item.get("evidence_segments") or [])
        if segments:
            segment = segments[0]
            range_text = _format_time_range(segment.get("start_sec"), segment.get("end_sec"))
            summary = _safe_text(segment.get("summary")) or _top_observation(item)
        else:
            range_text = ""
            summary = _top_observation(item)
        if _is_hebrew(language):
            prefix = f"סביב {range_text}, " if range_text else ""
            highlights.append(
                f"{prefix}{summary.rstrip('.')}. זה חשוב כי הרגע הזה מראה איך מהלך הוראה משפיע על נראות החשיבה של תלמידים."
            )
        else:
            prefix = f"Around {range_text}, " if range_text else ""
            highlights.append(
                f"{prefix}{summary.rstrip('.')}. This matters because it shows how an instructional move shapes visible student thinking."
            )
    return highlights[:3]


def _build_action_steps(
    focus_item: Dict[str, Any],
    *,
    language: str,
) -> List[Dict[str, str]]:
    focus_name = _safe_text(focus_item.get("element_name") or focus_item.get("element_id") or "discussion")
    if _is_hebrew(language):
        return [
            {
                "try_this": f"לפני שאלה כיתתית, תנו 20-30 שניות של חשיבה וכתיבה קצרה, ואז הזמינו שתי תשובות מאזורים שונים בכיתה סביב {focus_name}.",
                "look_for": "יותר תלמידים מסתמכים על הרשימות שלהם ומשתתפים באופן מגוון יותר.",
                "evidence_of_success": "במהלך שיעור אחד נשמעות לפחות 4-5 תגובות מדויקות מתלמידים מאזורים שונים בכיתה.",
            },
            {
                "try_this": f"בחרו מקטע אחד בשיעור ועקבו בסימון פשוט אחרי מי משתתף בדיון סביב {focus_name}.",
                "look_for": "פחות דוברים חוזרים ויותר קולות חדשים בשיח.",
                "evidence_of_success": "עד סוף המקטע לכל קבוצה בכיתה יש לפחות תרומה אחת שמקושרת למטרת השיעור.",
            },
        ]
    return [
        {
            "try_this": f"Before each whole-class question, use 20-30 seconds of think-and-jot, then invite two responses from different parts of the room around {focus_name}.",
            "look_for": "More students reference notes and a wider spread of voices enters the discussion.",
            "evidence_of_success": "Within one lesson, at least 4-5 accurate responses come from different parts of the room.",
        },
        {
            "try_this": f"For one discussion segment, track participation with a quick checkmark routine tied to {focus_name}.",
            "look_for": "Fewer repeat responders and more first-time contributors.",
            "evidence_of_success": "By the end of the segment, each table or group has contributed at least one response tied to the lesson target.",
        },
    ]


def _build_snapshot(
    ranked_scores: List[Dict[str, Any]],
    primary_growth_focus: str,
    *,
    language: str,
) -> str:
    strength_text = _top_observation(ranked_scores[0]) if ranked_scores else ""
    student_text = _top_observation(ranked_scores[1]) if len(ranked_scores) > 1 else strength_text
    if _is_hebrew(language):
        sentences = [
            "הובלת שיעור ברור ומסודר עם רצף הוראה יציב.",
            f"חוזקה בולטת הייתה: {strength_text.rstrip('.')}.",
            f"ברוב השיעור תלמידים היו במעקב אחר ההוראה, ובחלק מהרגעים ההשתתפות התמקדה במספר קטן של קולות ({student_text.rstrip('.')}).",
            "אקלים הכיתה נשאר רגוע וממוקד, וזה בסיס טוב להמשך צמיחה.",
            f"מנוף ההשפעה המרכזי לשלב הבא הוא: {primary_growth_focus.rstrip('.')}.",
        ]
    else:
        sentences = [
            "You led a clear, steady lesson with a consistent instructional flow.",
            f"A visible strength was this move: {strength_text.rstrip('.')}.",
            f"For most of the lesson, students stayed attentive, while participation narrowed at points ({student_text.rstrip('.')}).",
            "The class climate stayed calm and focused, giving you a strong base to build from.",
            f"The clearest next leverage point is: {primary_growth_focus.rstrip('.')}.",
        ]
    return " ".join(sentences)


def _build_rubric_lens(primary_growth_focus: str, *, language: str) -> str:
    if _is_hebrew(language):
        return f"מבט רובריקי קל: החוזקה ההוראתית ברורה, והצעד הבא הוא ליישם בעקביות את מוקד הצמיחה הבא - {primary_growth_focus.rstrip('.')}."
    return f"Light rubric lens: your instructional clarity is evident, and the highest-leverage next move is to consistently enact {primary_growth_focus.rstrip('.')}."


def render_master_observer_feedback(
    element_scores: List[Dict[str, Any]],
    *,
    priority_element_ids: Optional[List[str]] = None,
    language: str = "en",
) -> Dict[str, Any]:
    priority_set = set(priority_element_ids or [])
    ranked = sorted(
        element_scores or [],
        key=lambda item: (
            0 if (bool(item.get("priority")) or item.get("element_id") in priority_set) else 1,
            -float(item.get("score", 0.0) or 0.0),
        ),
    )
    if not ranked:
        ranked = [{"element_id": "instruction", "element_name": "Instruction", "observations": ["You sustained a coherent lesson flow."]}]

    focus_item = ranked[0]
    if len(ranked) > 1 and not (bool(focus_item.get("priority")) or focus_item.get("element_id") in priority_set):
        focus_item = ranked[-1]

    section_titles = _SECTION_TITLES_HE if _is_hebrew(language) else _SECTION_TITLES_EN
    strengths = _build_strengths(ranked, language=language)
    primary_growth_focus = _build_primary_growth_focus(focus_item, language=language)
    evidence_highlights = _build_evidence_highlights(ranked, language=language)
    action_steps = _build_action_steps(focus_item, language=language)[:2]
    snapshot = _build_snapshot(ranked, primary_growth_focus, language=language)
    rubric_lens = _build_rubric_lens(primary_growth_focus, language=language)

    lines: List[str] = []
    lines.append(f"1. {section_titles[0]}")
    lines.append(snapshot)
    lines.append("")
    lines.append(f"2. {section_titles[1]}")
    lines.extend([f"- {item}" for item in strengths])
    lines.append("")
    lines.append(f"3. {section_titles[2]}")
    lines.append(primary_growth_focus)
    lines.append("")
    lines.append(f"4. {section_titles[3]}")
    lines.extend([f"- {item}" for item in evidence_highlights])
    lines.append("")
    lines.append(f"5. {section_titles[4]}")
    for step in action_steps:
        if _is_hebrew(language):
            lines.append(f"- נסו זאת: {step['try_this']}")
            lines.append(f"  מה לחפש: {step['look_for']}")
            lines.append(f"  עדות להצלחה: {step['evidence_of_success']}")
        else:
            lines.append(f"- Try This: {step['try_this']}")
            lines.append(f"  Look For: {step['look_for']}")
            lines.append(f"  Evidence of Success: {step['evidence_of_success']}")
    lines.append("")
    lines.append(f"6. {section_titles[5]}")
    lines.append(rubric_lens)

    return {
        "instructional_snapshot": snapshot,
        "strengths_to_keep_and_build_on": strengths[:2],
        "primary_growth_focus": primary_growth_focus,
        "evidence_based_observation_highlights": evidence_highlights[:3],
        "actionable_next_steps_structured": action_steps[:2],
        "rubric_aligned_interpretation": rubric_lens,
        "output_order": section_titles,
        "full_review_text": "\n".join(lines).strip(),
    }
