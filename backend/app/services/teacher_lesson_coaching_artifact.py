"""Canonical TeacherLessonCoachingArtifact builder (PR C4).

This module is the single source of truth for what teacher-facing endpoints
render. It composes the existing C1/C2/C3 helpers into one structured
artifact so the dashboard, coaching page, latest-lesson card, and
teacher-view of an assessment cannot disagree with each other.

Architecture
============

  build_teacher_lesson_coaching_artifact(...)
      │
      ├─ build_source_validity(...)            # C1/C2 source-chain gate
      ├─ assessment_quality_blocks_teacher_feedback(...)  # C3 evidence gate
      ├─ build_teacher_coaching_intelligence(...)         # legacy projection
      ├─ reject_unsafe_teacher_payload(...)    # C2 unsafe-text gate
      ├─ filter_deep_dive_moments(...)         # C2 deep-dive quality gate
      ├─ <C4 rubric-to-practice translator>
      ├─ <C4 action-item generator>
      ├─ <C4 highlight generator + Gold-Star separation>
      └─ <truthful guardrails block>

The output is always a dict with the same top-level keys. When evidence is
insufficient, the artifact returns ``teacher_feedback_allowed: False``,
empty content sections, and an honest ``empty_state``. The C2 negative
assertions still apply: no known bad strings can appear anywhere in the
artifact's teacher-visible text.

Design notes
============

* No DB I/O in this module — the caller passes the assessment, video,
  coaching tasks, reflections, comments, badges, and lesson history.
* No LLM calls. The artifact uses the pre-computed projection plus
  evidence-grounded heuristics. Richer generation belongs to C5.
* No frontend-visible-only fields are duplicated; everything teacher-safe
  the dashboard needs is in this artifact.
* The legacy ``teacher_feedback`` projection shape is still exposed under
  ``legacy_projection`` for endpoints that need backwards-compatible
  fields during the migration window.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.analysis.teacher_feedback_projection import (
    build_teacher_coaching_intelligence,
    sanitize_teacher_feedback_projection,
    validate_teacher_feedback_projection,
)
from app.services.lesson_moment_quality import (
    ASSESSMENT_QUALITY_VERSION,
    assessment_quality_blocks_teacher_feedback,
    detect_fallback_text,
)
from app.services.teacher_artifact_quarantine import (
    GENERIC_FALLBACK_PHRASES,
    RUBRIC_ELEMENT_LABELS,
    build_source_validity,
    filter_deep_dive_moments,
    filter_teacher_visible_coaching_tasks,
    find_teacher_visible_text_issues,
    find_unsafe_text_issues,
    honest_next_best_action_for_record,
    is_action_item_teacher_eligible,
    is_teacher_visible_text_safe,
    reject_unsafe_teacher_payload,
)


TEACHER_LESSON_COACHING_ARTIFACT_VERSION = "teacher_lesson_coaching_artifact_v1"

# Maximum teacher-visible action items + highlights. The product rule is
# "one primary, optionally two more". We never inflate this list.
TEACHER_ACTION_ITEM_MAX = 3
TEACHER_HIGHLIGHT_MAX = 2
TEACHER_DEEP_DIVE_MAX = 4


# ---------------------------------------------------------------------------
# Rubric-to-practice translation
# ---------------------------------------------------------------------------

# Mapping of admin rubric element names → teacher-friendly practice phrasing.
# These phrases are *NEVER* shown verbatim as teacher-facing text; they only
# guide the generator's word choices when the rubric element is the only
# signal we have. The teacher actually sees the action item phrasing below.
RUBRIC_TO_PRACTICE: Dict[str, Dict[str, Dict[str, str]]] = {
    "demonstrating knowledge of students": {
        "en": {
            "practice": "learn more about how students are thinking",
            "next_step": "Pick one moment to ask a student to explain their reasoning before you respond.",
            "reflection": "Who surprised you with how they explained their thinking?",
        },
        "he": {
            "practice": "להבין טוב יותר איך התלמידים חושבים",
            "next_step": "בחרו רגע אחד שבו תבקשו מתלמיד להסביר איך הוא חשב, לפני שתגיבו.",
            "reflection": "מי הפתיע אתכם בהסבר שלו על אופן החשיבה?",
        },
    },
    "demonstrating knowledge of content and pedagogy": {
        "en": {
            "practice": "make one teaching move clearer for students",
            "next_step": "Choose one concept in the next lesson and plan how you'll model it step by step.",
            "reflection": "What did students do once you modeled the step you planned?",
        },
        "he": {
            "practice": "להבהיר מהלך הוראה אחד עבור התלמידים",
            "next_step": "בחרו מושג אחד בשיעור הבא ותכננו כיצד תדגימו אותו צעד-אחר-צעד.",
            "reflection": "מה התלמידים עשו אחרי שהדגמתם את הצעד שתכננתם?",
        },
    },
    "creating an environment of respect and rapport": {
        "en": {
            "practice": "build more student trust and participation",
            "next_step": "Invite one quieter student into the conversation by name in the next lesson.",
            "reflection": "Who joined the conversation in a way you noticed?",
        },
        "he": {
            "practice": "לחזק אמון והשתתפות של תלמידים",
            "next_step": "הזמינו בשיעור הבא תלמיד שקט אחד לשיחה, בפנייה אישית בשמו.",
            "reflection": "מי הצטרף לשיחה באופן ששמתם לב אליו?",
        },
    },
    "using questioning and discussion techniques": {
        "en": {
            "practice": "ask questions that open up student thinking",
            "next_step": "After one student answers, pause and ask, 'Who can build on that?'",
            "reflection": "What changed when you asked someone to build on a peer's answer?",
        },
        "he": {
            "practice": "לשאול שאלות שפותחות את החשיבה של התלמידים",
            "next_step": "אחרי שתלמיד עונה, עצרו ושאלו: 'מי יכול להוסיף על מה שנאמר?'",
            "reflection": "מה השתנה כשביקשתם מתלמיד להוסיף על תשובה של חבר?",
        },
    },
    "engaging students in learning": {
        "en": {
            "practice": "give students more ways to show their thinking",
            "next_step": "Plan one moment where students explain their thinking to a partner before sharing with the class.",
            "reflection": "Who explained more when they spoke with a partner first?",
        },
        "he": {
            "practice": "לתת לתלמידים עוד דרכים להראות את החשיבה שלהם",
            "next_step": "תכננו רגע אחד שבו התלמידים מסבירים את החשיבה שלהם לחבר לפני שמשתפים בכיתה.",
            "reflection": "מי הסביר יותר אחרי שהזדמן לו לדבר עם חבר קודם?",
        },
    },
    "using assessment in instruction": {
        "en": {
            "practice": "check who is with you in real time",
            "next_step": "Before moving on, ask one student to restate the goal in their own words.",
            "reflection": "What did the student's restatement tell you about what stuck?",
        },
        "he": {
            "practice": "לבדוק בזמן אמת מי מבין אתכם",
            "next_step": "לפני שתמשיכו, בקשו מתלמיד לחזור על המטרה במילים שלו.",
            "reflection": "מה לימדה אתכם הניסוח של התלמיד לגבי מה שהבין?",
        },
    },
    "managing classroom procedures": {
        "en": {
            "practice": "smooth one transition in the lesson",
            "next_step": "Pick the one transition that slowed you down and rehearse it briefly with students.",
            "reflection": "How long did that transition take after you rehearsed it?",
        },
        "he": {
            "practice": "לשפר מעבר אחד בתוך השיעור",
            "next_step": "בחרו את המעבר שעיכב אתכם הכי הרבה והתאמנו עליו בקצרה עם התלמידים.",
            "reflection": "כמה זמן לקח המעבר הזה אחרי שתרגלתם אותו?",
        },
    },
    "managing student behavior": {
        "en": {
            "practice": "set one clear expectation that students can repeat back",
            "next_step": "Name one expectation at the start of the next lesson and ask a student to restate it.",
            "reflection": "Who showed they remembered the expectation later in the lesson?",
        },
        "he": {
            "practice": "להציב ציפייה אחת ברורה שהתלמידים יכולים לחזור עליה",
            "next_step": "ציינו ציפייה אחת בתחילת השיעור הבא ובקשו מתלמיד לחזור עליה במילים שלו.",
            "reflection": "מי הראה שזכר את הציפייה גם בהמשך השיעור?",
        },
    },
    "organizing physical space": {
        "en": {
            "practice": "use the room setup to support participation",
            "next_step": "Adjust where you stand at one point in the lesson so more students can join in.",
            "reflection": "Who joined in differently because of where you stood?",
        },
        "he": {
            "practice": "להשתמש בארגון המרחב כדי לתמוך בהשתתפות",
            "next_step": "בחרו רגע אחד בשיעור ושנו את המקום שבו אתם עומדים, כדי שיותר תלמידים יוכלו להצטרף.",
            "reflection": "מי הצטרף אחרת בגלל המקום שבו עמדתם?",
        },
    },
    "setting instructional outcomes": {
        "en": {
            "practice": "make the learning target clearer for students",
            "next_step": "Open the next lesson by sharing the goal in plain language and asking a student to repeat it.",
            "reflection": "How did the lesson change once students said the goal in their own words?",
        },
        "he": {
            "practice": "להבהיר לתלמידים את מטרת הלמידה",
            "next_step": "פתחו את השיעור הבא בשיתוף המטרה בשפה פשוטה, ובקשו מתלמיד לחזור עליה.",
            "reflection": "איך השיעור השתנה אחרי שהתלמידים אמרו את המטרה במילים שלהם?",
        },
    },
    "establishing a culture for learning": {
        "en": {
            "practice": "help students see the value of the work",
            "next_step": "Spend 30 seconds at the start of the next lesson connecting the work to something students care about.",
            "reflection": "Who showed more interest because of the connection you made?",
        },
        "he": {
            "practice": "לעזור לתלמידים לראות את הערך בעבודה",
            "next_step": "הקדישו 30 שניות בתחילת השיעור כדי לקשר את העבודה למשהו שחשוב לתלמידים.",
            "reflection": "מי הראה יותר עניין בגלל הקשר שיצרתם?",
        },
    },
    "growing and developing professionally": {
        "en": {
            "practice": "choose one practice move to keep improving",
            "next_step": "Pick one specific teaching move from this lesson to refine in your next attempt.",
            "reflection": "What changed when you refined that move?",
        },
        "he": {
            "practice": "לבחור מהלך אחד שתרצו להמשיך לשפר",
            "next_step": "בחרו מהלך הוראה ספציפי אחד מהשיעור הזה ושפרו אותו בניסיון הבא.",
            "reflection": "מה השתנה כששיפרתם את המהלך הזה?",
        },
    },
    "reflecting on teaching": {
        "en": {
            "practice": "notice what worked and what to try differently",
            "next_step": "Write one quick note after the next lesson about who joined the conversation and who didn't.",
            "reflection": "What pattern did you notice across the lesson?",
        },
        "he": {
            "practice": "לשים לב למה שעבד ולמה שכדאי לנסות אחרת",
            "next_step": "כתבו פתק קצר אחרי השיעור הבא על מי שהצטרף לשיחה ומי לא.",
            "reflection": "איזה דפוס שמתם לב אליו לאורך השיעור?",
        },
    },
}


def _language_key(language: Optional[str]) -> str:
    return "he" if (language or "en").lower().startswith(("he", "iw")) else "en"


def translate_rubric_label_to_practice(
    label: Optional[str],
    *,
    language: Optional[str] = "en",
) -> Optional[Dict[str, str]]:
    """Return ``{"practice", "next_step", "reflection"}`` for a rubric label.

    PR C5: returns the language-appropriate variant. ``language`` starting
    with ``he`` returns Hebrew; everything else returns English. If the rubric
    is not in the table, or the requested language is not available, the
    function returns ``None`` so the caller falls back to the safe Hebrew /
    English empty state rather than mixing languages.
    """

    if not label:
        return None
    key = re.sub(r"\s+", " ", str(label).strip().lower())
    entry = RUBRIC_TO_PRACTICE.get(key)
    if not entry:
        return None
    lang = _language_key(language)
    variant = entry.get(lang)
    if not variant:
        return None
    return dict(variant)


# ---------------------------------------------------------------------------
# Teacher-visible text safety wrapper
# ---------------------------------------------------------------------------


def _is_clean_teacher_text(text: Any) -> bool:
    """Return True iff text passes the C2 unsafe-text gate AND is non-empty."""

    if not text:
        return False
    cleaned = str(text).strip()
    if not cleaned:
        return False
    if not is_teacher_visible_text_safe(cleaned):
        return False
    if detect_fallback_text(cleaned):
        return False
    lowered = cleaned.lower()
    for rubric in RUBRIC_ELEMENT_LABELS:
        if rubric in lowered:
            return False
    return True


# ---------------------------------------------------------------------------
# Action item evidence-grounded generator
# ---------------------------------------------------------------------------


def _generate_action_item_from_rubric(
    *,
    score: Mapping[str, Any],
    assessment_id: Optional[str],
    video_id: Optional[str],
    moment: Optional[Mapping[str, Any]],
    index: int,
    language: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Build a teacher-safe action item from a rubric-flagged growth element.

    Returns ``None`` when the rubric label is unknown, or when the resulting
    text would fail the unsafe-text gate.
    """

    label = (
        score.get("element_name")
        or score.get("name")
        or score.get("label")
    )
    translation = translate_rubric_label_to_practice(label, language=language)
    if not translation:
        return None
    next_step = translation["next_step"]
    practice = translation["practice"]
    reflection = translation.get("reflection")
    if not _is_clean_teacher_text(next_step):
        return None
    if not _is_clean_teacher_text(practice):
        return None
    start_sec = end_sec = None
    if moment:
        try:
            if moment.get("start_sec") is not None:
                start_sec = float(moment.get("start_sec"))
            if moment.get("end_sec") is not None:
                end_sec = float(moment.get("end_sec"))
        except (TypeError, ValueError):
            start_sec = end_sec = None
    item_id = f"action-{assessment_id or video_id or 'lesson'}-rubric-{index}"
    is_he = _language_key(language) == "he"
    return {
        "id": item_id,
        "title": "Try one small move next lesson" if not is_he else "מהלך קטן אחד לשיעור הבא",
        "body": next_step,
        "try_next_lesson": next_step,
        "why_it_matters": (
            f"This keeps your next practice move focused on one thing you can {practice}."
            if not is_he
            else f"כך תרכזו את התרגול במהלך אחד שמטרתו {practice}."
        ),
        "status": "open",
        "source": "analysis",
        "start_sec": start_sec,
        "end_sec": end_sec,
        "video_href": (
            f"/videos/{video_id}?t={int(max(0, start_sec))}"
            if video_id and start_sec is not None
            else f"/videos/{video_id}" if video_id else None
        ),
        "reflection_prompt": reflection or _action_reflection_prompt(next_step, language=language),
    }


def _action_reflection_prompt(action_text: Optional[str], *, language: Optional[str]) -> str:
    """Connect a teacher action to a short reflection prompt."""

    is_he = (language or "en").lower().startswith("he")
    if not action_text:
        return (
            "מה תרצה.י לזכור משיעור זה לקראת הבא?"
            if is_he
            else "What do you want to remember from this lesson before you teach it again?"
        )
    if is_he:
        return "כשניסיתם את המהלך הזה, מה שמתם לב שקרה עם התלמידים?"
    return "When you try this move, what do you notice about who joins the conversation?"


def _build_action_items(
    *,
    projection: Mapping[str, Any],
    assessment: Mapping[str, Any],
    video: Mapping[str, Any],
    language: Optional[str],
) -> List[Dict[str, Any]]:
    """Build a teacher-safe action item list grounded in valid evidence.

    Inputs in priority order:

      1. Projection action_items (from C2-cleaned ``build_teacher_coaching_intelligence``)
      2. Rubric-translated action item from growth-focus element_scores

    Each candidate is filtered through ``is_action_item_teacher_eligible``
    and rubric/fallback-phrase checks. Items must not duplicate each other
    or the summary.
    """

    items: List[Dict[str, Any]] = []
    seen_bodies: set = set()

    summary = projection.get("latest_summary") or {}
    summary_lowered = {
        str(summary.get(k) or "").strip().lower()
        for k in ("opening", "strength", "growth_focus", "next_step")
    }
    summary_lowered.discard("")

    for raw in projection.get("action_items") or []:
        if not isinstance(raw, Mapping):
            continue
        body = str(raw.get("try_next_lesson") or raw.get("body") or "").strip()
        if not _is_clean_teacher_text(body):
            continue
        if not _is_clean_teacher_text(raw.get("title")):
            continue
        if body.lower() in seen_bodies:
            continue
        if body.lower() in summary_lowered:
            continue
        if not is_action_item_teacher_eligible(raw):
            continue
        items.append(
            {
                "id": raw.get("id"),
                "title": raw.get("title"),
                "body": body,
                "try_next_lesson": body,
                "why_it_matters": raw.get("why_it_matters")
                or "This keeps your next practice move small enough to notice what changes.",
                "status": str(raw.get("status") or "open"),
                "source": str(raw.get("source") or "analysis"),
                "start_sec": raw.get("start_sec"),
                "end_sec": raw.get("end_sec"),
                "video_href": raw.get("video_href"),
                "reflection_prompt": _action_reflection_prompt(body, language=language),
            }
        )
        seen_bodies.add(body.lower())
        if len(items) >= TEACHER_ACTION_ITEM_MAX:
            return items

    # Second pass: rubric-translated action items, only for elements that have
    # NOT already been covered. We pick growth-focus element scores (low score
    # or marked priority) and translate them.
    if len(items) < 1:
        moments = (
            assessment.get("evidence_segments")
            or assessment.get("moments")
            or []
        )
        growth_scores = [
            score for score in (assessment.get("element_scores") or [])
            if isinstance(score, Mapping)
            and (
                (score.get("priority") is True)
                or (
                    score.get("score") is not None
                    and float(score.get("score") or 0) < 7.0
                )
            )
        ]
        for index, score in enumerate(growth_scores):
            if len(items) >= TEACHER_ACTION_ITEM_MAX:
                break
            moment = moments[0] if moments else None
            candidate = _generate_action_item_from_rubric(
                score=score,
                assessment_id=assessment.get("id"),
                video_id=assessment.get("video_id") or video.get("id"),
                moment=moment,
                index=index,
                language=language,
            )
            if not candidate:
                continue
            body = candidate["body"].strip().lower()
            if body in seen_bodies or body in summary_lowered:
                continue
            items.append(candidate)
            seen_bodies.add(body)
    return items


# ---------------------------------------------------------------------------
# Highlight generator (personal highlights vs Gold-Star)
# ---------------------------------------------------------------------------


def _build_personal_highlights(
    *,
    projection: Mapping[str, Any],
    video_id: Optional[str],
) -> List[Dict[str, Any]]:
    highlights: List[Dict[str, Any]] = []
    seen_bodies: set = set()
    for raw in projection.get("highlights") or []:
        if not isinstance(raw, Mapping):
            continue
        body = str(raw.get("body") or "").strip()
        title = str(raw.get("title") or "").strip()
        if not _is_clean_teacher_text(body) or not _is_clean_teacher_text(title):
            continue
        if body.lower() in seen_bodies:
            continue
        highlights.append(
            {
                "id": raw.get("id"),
                "title": title,
                "body": body,
                "start_sec": raw.get("start_sec"),
                "end_sec": raw.get("end_sec"),
                "video_href": raw.get("video_href"),
                "source": "analysis",
            }
        )
        seen_bodies.add(body.lower())
        if len(highlights) >= TEACHER_HIGHLIGHT_MAX:
            break
    return highlights


def _build_gold_star_recognition(
    *,
    projection: Mapping[str, Any],
    recognition_badges: Optional[Sequence[Mapping[str, Any]]],
    valid_video_ids: Iterable[str],
) -> Optional[Dict[str, Any]]:
    """Return the first Gold-Star recognition that survives the C2 gates.

    Gold-Star recognition must:
      * be tied to a valid video for this teacher (caller filters by
        teacher already; we just check the video id matches the artifact)
      * be of type ``gold_star``
      * have a teacher-safe title + body
    """

    valid_video_set = {str(v) for v in (valid_video_ids or []) if v}
    for badge in recognition_badges or []:
        if not isinstance(badge, Mapping):
            continue
        badge_video_id = badge.get("video_id")
        if badge_video_id and valid_video_set and str(badge_video_id) not in valid_video_set:
            continue
        badge_type = str(
            badge.get("recognition_type") or badge.get("badge_type") or ""
        ).lower()
        if badge_type and badge_type != "gold_star":
            continue
        title = (
            badge.get("title")
            or badge.get("recognition_type")
            or "Gold-Star moment"
        )
        body = (
            badge.get("description")
            or badge.get("awarded_for")
            or "A reviewed lesson highlighted a teaching move worth celebrating."
        )
        if not _is_clean_teacher_text(title) or not _is_clean_teacher_text(body):
            continue
        return {
            "id": badge.get("id"),
            "title": title,
            "body": body,
            "video_id": badge_video_id,
            "timestamp_seconds": badge.get("timestamp_seconds"),
            "awarded_at": badge.get("awarded_at") or badge.get("earned_at") or badge.get("created_at"),
            "share_url": badge.get("share_url"),
            "source": "gold_star",
        }

    # Also try Gold-Star embedded in the projection.recognition list.
    for raw in projection.get("recognition") or []:
        if not isinstance(raw, Mapping):
            continue
        badge_type = str(raw.get("type") or "").lower()
        if badge_type and badge_type != "gold_star":
            continue
        title = raw.get("title") or "Gold-Star moment"
        body = raw.get("body") or ""
        if not _is_clean_teacher_text(title) or not _is_clean_teacher_text(body):
            continue
        return {
            "id": raw.get("id"),
            "title": title,
            "body": body,
            "awarded_at": raw.get("awarded_at"),
            "share_url": raw.get("share_url"),
            "source": "gold_star",
        }
    return None


# ---------------------------------------------------------------------------
# Empty state copy
# ---------------------------------------------------------------------------


def _empty_state_for_no_evidence(language: Optional[str]) -> Dict[str, Any]:
    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "no_reviewed_lesson",
            "title": "ההקלטה מוכנה.",
            "message": "אחרי שיעור עם בדיקה מלאה יוצגו כאן רגעים ספציפיים והצעדים הבאים.",
        }
    return {
        "code": "no_reviewed_lesson",
        "title": "Your recording setup is ready.",
        "message": "After a lesson has a complete review, you’ll see specific coaching moments and next steps here.",
    }


def _empty_state_for_evidence_insufficient(language: Optional[str]) -> Dict[str, Any]:
    """PR C8: review-pending teacher copy that does NOT promise next steps.

    Previous copy ended with "you'll see specific coaching moments and next
    steps here" — which read as if a teacher action was coming. The lesson
    is in review; there is no teacher action. Match the navigator language.
    """

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "evidence_insufficient",
            "title": "ההערות לשיעור הזה בבדיקה.",
            "message": "אין מה לעשות עכשיו. הסיכום יופיע כאן אחרי שהבדיקה תהיה מוכנה.",
        }
    return {
        "code": "evidence_insufficient",
        "title": "Feedback is being reviewed.",
        "message": "No action needed right now. Your coaching summary will appear here when the review is ready.",
    }


def _empty_state_for_unsafe_content(language: Optional[str]) -> Dict[str, Any]:
    """PR C8: review-pending unsafe-text fallback.

    Previous copy was "A coach will continue from here as soon as the review
    is verified." which was reported as misleading. Replace with the same
    "no action needed right now" framing the navigator uses.
    """

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "review_under_check",
            "title": "ההערות לשיעור הזה בבדיקה.",
            "message": "אין מה לעשות עכשיו. הסיכום יופיע כאן אחרי שהבדיקה תהיה מוכנה.",
        }
    return {
        "code": "review_under_check",
        "title": "Feedback is being reviewed.",
        "message": "No action needed right now. Your coaching summary will appear here when the review is ready.",
    }


def _empty_state_for_admin_hidden(language: Optional[str]) -> Dict[str, Any]:
    """PR C6/C8: admin chose to hide this lesson's teacher feedback."""

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "admin_review_pending",
            "title": "ההערות לשיעור הזה בבדיקה.",
            "message": "אין מה לעשות עכשיו. הסיכום יופיע כאן אחרי שהבדיקה תהיה מוכנה.",
        }
    return {
        "code": "admin_review_pending",
        "title": "Feedback is being reviewed.",
        "message": "No action needed right now. Your coaching summary will appear here when the review is ready.",
    }


def _empty_state_for_revision_requested(language: Optional[str]) -> Dict[str, Any]:
    """PR C6/C8: admin requested a revision before showing teacher feedback."""

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "admin_revision_requested",
            "title": "ההערות לשיעור הזה בבדיקה.",
            "message": "אין מה לעשות עכשיו. הסיכום יופיע כאן אחרי שהבדיקה תהיה מוכנה.",
        }
    return {
        "code": "admin_revision_requested",
        "title": "Feedback is being reviewed.",
        "message": "No action needed right now. Your coaching summary will appear here when the review is ready.",
    }


# ---------------------------------------------------------------------------
# Honest next_best_action
# ---------------------------------------------------------------------------


def _next_best_action_from_artifact(
    *,
    action_items: Sequence[Mapping[str, Any]],
    empty_state: Optional[Mapping[str, Any]],
    language: Optional[str],
) -> Optional[Dict[str, Any]]:
    if action_items:
        primary = action_items[0]
        return {
            "id": primary.get("id"),
            "title": "Try one coaching move",
            "description": primary.get("try_next_lesson") or primary.get("body"),
            "href": (
                f"/my-coaching?task_id={primary.get('id')}"
                if primary.get("id")
                else "/my-coaching"
            ),
            "cta_label": "Open coaching",
        }
    return honest_next_best_action_for_record(language=language)


# ---------------------------------------------------------------------------
# PR C8: typed navigator + moment CTA labeling
# ---------------------------------------------------------------------------


NAVIGATOR_TYPES = (
    "coaching_action",
    "reflection",
    "watch_moment",
    "setup_required",
    "upload_required",
    "review_pending",
    "admin_hidden",
    "revision_requested",
    "admin_message",
    "no_action",
)


ACTION_CATEGORIES = (
    "instructional_practice",
    "reflection",
    "operational",
    "admin_review",
    "recording",
)


ACTION_KINDS = (
    "try_next_lesson",
    "reflect",
    "watch_moment",
    "complete_setup",
    "upload_lesson",
    "wait_for_review",
    "no_action",
)


# Specific moment CTA labels by inferred phase / category. The lookup is
# case-insensitive on phase, title, and body. Falls back to "Watch this
# coaching moment".
_MOMENT_CTA_PHASE_LABELS_EN: Dict[str, str] = {
    "check_for_understanding": "Watch the check-for-understanding moment",
    "guided_practice": "Watch the guided practice moment",
    "modeling": "Watch the modeling moment",
    "student_work": "Watch the student work moment",
    "discussion": "Watch the discussion moment",
    "transition": "Watch the transition moment",
    "lesson_launch": "Watch the lesson opening",
    "closure": "Watch the lesson closure",
}


_MOMENT_CTA_PHASE_LABELS_HE: Dict[str, str] = {
    "check_for_understanding": "צפו ברגע הבדיקה להבנה",
    "guided_practice": "צפו ברגע התרגול המודרך",
    "modeling": "צפו ברגע ההדגמה",
    "student_work": "צפו ברגע עבודת התלמידים",
    "discussion": "צפו ברגע הדיון",
    "transition": "צפו במעבר",
    "lesson_launch": "צפו בפתיחת השיעור",
    "closure": "צפו בסיכום השיעור",
}


def _is_hebrew(language: Optional[str]) -> bool:
    return (language or "en").lower().startswith(("he", "iw"))


def _moment_keyword_label(text: str, *, language: Optional[str]) -> Optional[str]:
    lowered = (text or "").lower()
    if not lowered:
        return None
    is_he = _is_hebrew(language)
    if any(token in lowered for token in ("question", "asked", "prompt", "שאלה", "שאל")):
        return "צפו בחילופי השאלה" if is_he else "Watch the question exchange"
    if any(token in lowered for token in ("student response", "student answer", "extended", "תשובה")):
        return "צפו ברגע התגובה של התלמידים" if is_he else "Watch the student-response moment"
    if any(token in lowered for token in ("check for understanding", "restate", "in your own words", "בדיקת הבנה")):
        return (
            "צפו ברגע הבדיקה להבנה"
            if is_he
            else "Watch the check-for-understanding moment"
        )
    if any(token in lowered for token in ("transition", "move to", "next activity", "מעבר")):
        return "צפו ברגע המעבר" if is_he else "Watch the transition moment"
    if any(token in lowered for token in ("room", "space", "setup", "circulate", "מרחב", "סידור")):
        return "צפו ברגע סידור החלל" if is_he else "Watch the room-setup moment"
    return None


def specific_moment_cta_label(
    moment_or_action: Optional[Mapping[str, Any]],
    *,
    language: Optional[str] = "en",
) -> str:
    """PR C8: derive a specific 'Watch the ...' label from moment metadata.

    Tries, in order:

      1. ``moment.moment_label`` if present and teacher-safe.
      2. Keyword matches on the moment title / body / what_happened.
      3. ``phase`` lookup against the predefined English/Hebrew table.
      4. Fallback "Watch this coaching moment".
    """

    moment = dict(moment_or_action or {})
    is_he = _is_hebrew(language)
    fallback = "צפו ברגע הזה" if is_he else "Watch this coaching moment"
    explicit = (moment.get("moment_label") or "").strip()
    if explicit and is_teacher_visible_text_safe(explicit):
        return explicit

    text_pool = " ".join(
        str(value or "")
        for value in (
            moment.get("title"),
            moment.get("what_happened"),
            moment.get("body"),
            moment.get("description"),
            moment.get("try_next_lesson"),
            moment.get("summary"),
        )
        if value
    )
    keyword_label = _moment_keyword_label(text_pool, language=language)
    if keyword_label and is_teacher_visible_text_safe(keyword_label):
        return keyword_label

    phase = (moment.get("phase") or "").strip().lower()
    table = _MOMENT_CTA_PHASE_LABELS_HE if is_he else _MOMENT_CTA_PHASE_LABELS_EN
    if phase and phase in table:
        return table[phase]
    return fallback


def _navigator_labels(language: Optional[str]) -> Dict[str, str]:
    if _is_hebrew(language):
        return {
            "coaching_action": "מוקד אימון",
            "reflection": "רפלקציה",
            "watch_moment": "רגע לחזור אליו",
            "setup_required": "נדרשת השלמת הגדרות",
            "upload_required": "הקלטה",
            "review_pending": "סטטוס בדיקה",
            "admin_hidden": "סטטוס בדיקה",
            "revision_requested": "סטטוס בדיקה",
            "admin_message": "הודעת מאמן",
            "no_action": "הכול מסודר",
        }
    return {
        "coaching_action": "Coaching focus",
        "reflection": "Reflection",
        "watch_moment": "Moment to revisit",
        "setup_required": "Setup needed",
        "upload_required": "Recording",
        "review_pending": "Review status",
        "admin_hidden": "Review status",
        "revision_requested": "Review status",
        "admin_message": "Coach message",
        "no_action": "All set",
    }


def _build_review_pending_navigator(
    *, navigator_type: str, language: Optional[str]
) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    return {
        "type": navigator_type,
        "label": labels[navigator_type],
        "title": (
            "ההערות לשיעור הזה בבדיקה."
            if is_he
            else "Feedback is being reviewed."
        ),
        "body": (
            "אין מה לעשות עכשיו. הסיכום יופיע כאן אחרי שהבדיקה תהיה מוכנה."
            if is_he
            else "No action needed right now. Your coaching summary will appear here when the review is ready."
        ),
        "cta_label": None,
        "href": None,
        "disabled": True,
        "priority": 60,
        "source": "admin_review" if navigator_type in {"admin_hidden", "revision_requested"} else "artifact",
        "action_item_id": None,
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": navigator_type,
    }


def _build_no_lesson_navigator(language: Optional[str]) -> Dict[str, Any]:
    """No reviewed lesson AND readiness is OK → upload_required."""

    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    return {
        "type": "upload_required",
        "label": labels["upload_required"],
        "title": (
            "מוכנים להקליט או להעלות שיעור."
            if is_he
            else "Your recording setup is ready."
        ),
        "body": (
            "אחרי שיעור עם בדיקה מלאה יוצגו כאן רגעים ספציפיים."
            if is_he
            else "After a lesson has a complete review, you’ll see specific coaching moments here."
        ),
        "cta_label": "הקליטו או העלו שיעור" if is_he else "Record or upload a lesson",
        "href": "/record",
        "disabled": False,
        "priority": 30,
        "source": "recording",
        "action_item_id": None,
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": "no_reviewed_lesson",
    }


def _build_no_action_navigator(language: Optional[str]) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    return {
        "type": "no_action",
        "label": labels["no_action"],
        "title": (
            "אין צורך בפעולה כרגע."
            if is_he
            else "No action needed right now."
        ),
        "body": (
            "פעולות אימון חדשות יופיעו כאן אחרי השיעור הבדוק הבא."
            if is_he
            else "You’re all set. New coaching actions will appear here after your next reviewed lesson."
        ),
        "cta_label": None,
        "href": None,
        "disabled": True,
        "priority": 90,
        "source": "artifact",
        "action_item_id": None,
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": "no_action",
    }


def _build_setup_navigator(readiness: Mapping[str, Any], language: Optional[str]) -> Optional[Dict[str, Any]]:
    """If the teacher's setup is incomplete, return a setup_required navigator.

    Only the *first* missing readiness item is surfaced — the workspace
    page already lists the others separately. ``href`` comes from the
    readiness blocker so we link to the exact setup screen (consent /
    profile / privacy reference images) rather than a generic "next step".
    """

    if not readiness or readiness.get("setup_next_step") is None and not readiness.get("missing_items"):
        return None
    blocker = readiness.get("setup_next_step") or (readiness.get("missing_items") or [{}])[0]
    if not isinstance(blocker, Mapping) or not blocker:
        return None
    href = blocker.get("href") or blocker.get("route") or "/my-profile"
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    title = str(blocker.get("label") or blocker.get("title") or ("השלימו את ההגדרות" if is_he else "Finish setup")).strip()
    body = str(blocker.get("message") or ("השלימו את ההגדרות כדי לאפשר אימון אישי." if is_he else "Finish this setup step so coaching can connect.")).strip()
    if not _is_clean_teacher_text(title) or not _is_clean_teacher_text(body):
        return None
    return {
        "type": "setup_required",
        "label": labels["setup_required"],
        "title": title,
        "body": body,
        "cta_label": "המשך הגדרות" if is_he else "Continue setup",
        "href": href,
        "disabled": False,
        "priority": 10,
        "source": "readiness",
        "action_item_id": blocker.get("id"),
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": blocker.get("code"),
    }


def _build_coaching_action_navigator(
    primary_action: Mapping[str, Any], language: Optional[str]
) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    body = (
        primary_action.get("try_next_lesson")
        or primary_action.get("body")
        or ""
    )
    return {
        "type": "coaching_action",
        "label": labels["coaching_action"],
        "title": (
            "נסו את המהלך הזה בשיעור הבא" if is_he else "Try this in your next lesson"
        ),
        "body": body,
        "cta_label": "פתחו את מהלך האימון" if is_he else "Open coaching action",
        "href": (
            f"/my-coaching?task_id={primary_action.get('id')}"
            if primary_action.get("id")
            else "/my-coaching"
        ),
        "disabled": False,
        "priority": 20,
        "source": "artifact",
        "action_item_id": primary_action.get("id"),
        "start_sec": primary_action.get("start_sec"),
        "end_sec": primary_action.get("end_sec"),
        "video_href": primary_action.get("video_href"),
        "reason": None,
    }


def _build_watch_moment_navigator(
    moment: Mapping[str, Any], video_id: Optional[str], language: Optional[str]
) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    cta_label = specific_moment_cta_label(moment, language=language)
    start_sec = moment.get("start_sec")
    href = moment.get("video_href")
    if not href and video_id and start_sec is not None:
        try:
            href = f"/videos/{video_id}?t={int(max(0, float(start_sec)))}"
        except (TypeError, ValueError):
            href = f"/videos/{video_id}"
    title = moment.get("title") or ("רגע ששווה לחזור אליו" if _is_hebrew(language) else "A moment worth revisiting")
    body = moment.get("what_happened") or moment.get("body") or ""
    return {
        "type": "watch_moment",
        "label": labels["watch_moment"],
        "title": title,
        "body": body,
        "cta_label": cta_label,
        "href": href,
        "disabled": not href,
        "priority": 25,
        "source": "artifact",
        "action_item_id": None,
        "start_sec": start_sec,
        "end_sec": moment.get("end_sec"),
        "video_href": href,
        "reason": None,
    }


def _build_reflection_navigator(
    prompt: str, language: Optional[str]
) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    return {
        "type": "reflection",
        "label": labels["reflection"],
        "title": "רפלקציה" if is_he else "Add a reflection",
        "body": prompt,
        "cta_label": "הוסיפו רפלקציה" if is_he else "Add reflection",
        "href": "/my-coaching",
        "disabled": False,
        "priority": 50,
        "source": "reflection",
        "action_item_id": None,
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": None,
    }


def _build_admin_message_navigator(language: Optional[str]) -> Dict[str, Any]:
    labels = _navigator_labels(language)
    is_he = _is_hebrew(language)
    return {
        "type": "admin_message",
        "label": labels["admin_message"],
        "title": "המאמן השיב לכם" if is_he else "Your coach replied",
        "body": "פתחו את שיחת האימון כדי לראות את ההודעה." if is_he else "Open the coaching thread to read it.",
        "cta_label": "קראו את התגובה" if is_he else "Read coach reply",
        "href": "/my-coaching",
        "disabled": False,
        "priority": 40,
        "source": "thread",
        "action_item_id": None,
        "start_sec": None,
        "end_sec": None,
        "video_href": None,
        "reason": None,
    }


def _attach_action_taxonomy(
    item: Mapping[str, Any], *, language: Optional[str]
) -> Dict[str, Any]:
    """Annotate an artifact action item with category/action_kind/cta."""

    enriched = dict(item)
    is_he = _is_hebrew(language)
    enriched.setdefault("category", "instructional_practice")
    enriched.setdefault("action_kind", "try_next_lesson")
    enriched.setdefault("disabled", False)
    enriched.setdefault(
        "cta_label",
        "פתחו את מהלך האימון" if is_he else "Open coaching action",
    )
    href = enriched.get("href")
    if not href:
        href = (
            f"/my-coaching?task_id={enriched.get('id')}"
            if enriched.get("id")
            else "/my-coaching"
        )
        enriched["href"] = href
    if enriched.get("video_href"):
        enriched.setdefault("moment_cta_label", specific_moment_cta_label(enriched, language=language))
    enriched.setdefault("moment_label", None)
    return enriched


def build_artifact_navigator(
    artifact: Mapping[str, Any],
    *,
    readiness: Optional[Mapping[str, Any]] = None,
    language: Optional[str] = "en",
    has_unread_admin_message: bool = False,
) -> Dict[str, Any]:
    """Top-level dispatcher that picks the right typed navigator state.

    Order of precedence:

      1. Setup incomplete → ``setup_required``.
      2. Artifact blocked (admin_hidden / revision_requested / source_invalid
         / evidence_insufficient / unsafe_text) → ``review_pending`` family.
      3. Unread admin message → ``admin_message``.
      4. Allowed artifact with a coaching action item → ``coaching_action``.
      5. Allowed artifact with a deep-dive moment but no action → ``watch_moment``.
      6. Allowed artifact with a reflection prompt only → ``reflection``.
      7. No reviewed lesson but setup is OK → ``upload_required``.
      8. Otherwise → ``no_action``.

    Review-pending / no-action navigators NEVER carry an ``href`` and have
    ``disabled: True``. Upload/setup CTAs only appear when their state
    actually applies.
    """

    setup_navigator = _build_setup_navigator(readiness or {}, language)
    if setup_navigator:
        return setup_navigator

    artifact = dict(artifact or {})
    blocked_reason = (artifact.get("blocked_reason") or "").lower()
    if not artifact.get("teacher_feedback_allowed"):
        if blocked_reason == "admin_hidden":
            return _build_review_pending_navigator(navigator_type="admin_hidden", language=language)
        if blocked_reason == "revision_requested":
            return _build_review_pending_navigator(
                navigator_type="revision_requested", language=language
            )
        if blocked_reason in {"source_invalid", "evidence_insufficient", "unsafe_text", "unsafe_text_post_compose"}:
            return _build_review_pending_navigator(
                navigator_type="review_pending", language=language
            )
        if blocked_reason in {"no_reviewed_lesson", ""} and not artifact.get("lesson", {}).get("lesson_id"):
            return _build_no_lesson_navigator(language)
        return _build_review_pending_navigator(navigator_type="review_pending", language=language)

    if has_unread_admin_message:
        return _build_admin_message_navigator(language)

    action_items = list(artifact.get("action_items") or [])
    if action_items:
        return _build_coaching_action_navigator(action_items[0], language)

    deep_dive = artifact.get("deep_dive") or {}
    moments = list(deep_dive.get("moments") or []) if deep_dive.get("available") else []
    if moments:
        return _build_watch_moment_navigator(
            moments[0], artifact.get("lesson", {}).get("video_id"), language
        )

    reflection_prompts = list(artifact.get("reflection", {}).get("prompts") or [])
    if reflection_prompts:
        return _build_reflection_navigator(reflection_prompts[0], language)

    return _build_no_action_navigator(language)


# ---------------------------------------------------------------------------
# Empty artifact factory
# ---------------------------------------------------------------------------


def _admin_review_public_block(admin_review: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Return the admin_review snapshot to publish on the artifact.

    Teacher-visible fields ONLY include the status code (so the frontend
    can choose its empty-state copy). Internal admin notes / hidden_reason
    / review_note are NOT included — they live in ``admin_review_internal``
    which only the admin path consults.
    """

    review = dict(admin_review or {})
    status = str(review.get("status") or "").lower().strip() or None
    return {
        "status": status,
        "reviewed_at": review.get("reviewed_at"),
        "has_admin_review": bool(status),
    }


def _next_best_action_from_navigator(navigator: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """PR C8: only render ``next_best_action`` when the navigator carries a
    real CTA. Review-pending / no-action navigators return ``None`` so the
    frontend does not show a generic "Open next step" button."""

    if not navigator:
        return None
    if navigator.get("disabled"):
        return None
    cta = navigator.get("cta_label")
    href = navigator.get("href")
    if not cta or not href:
        return None
    return {
        "id": navigator.get("action_item_id") or navigator.get("type"),
        "title": navigator.get("title"),
        "description": navigator.get("body"),
        "href": href,
        "cta_label": cta,
        "type": navigator.get("type"),
        "label": navigator.get("label"),
        "reason": navigator.get("reason"),
    }


def _navigator_for_empty_artifact(
    *,
    blocked_reason: str,
    assessment: Optional[Mapping[str, Any]],
    readiness: Optional[Mapping[str, Any]],
    language: Optional[str],
) -> Dict[str, Any]:
    """Pick the navigator for a blocked / empty artifact.

    Setup beats the artifact-block state — the teacher cannot upload until
    setup completes, so we tell them about setup first regardless of why
    the artifact is empty.
    """

    setup_nav = _build_setup_navigator(readiness or {}, language)
    if setup_nav:
        return setup_nav
    reason = (blocked_reason or "").lower()
    if reason == "admin_hidden":
        return _build_review_pending_navigator(navigator_type="admin_hidden", language=language)
    if reason == "revision_requested":
        return _build_review_pending_navigator(navigator_type="revision_requested", language=language)
    if reason in {"source_invalid", "unsafe_text", "unsafe_text_post_compose", "evidence_insufficient"}:
        return _build_review_pending_navigator(navigator_type="review_pending", language=language)
    if reason in {"no_reviewed_lesson", ""} and not (assessment or {}).get("id"):
        return _build_no_lesson_navigator(language)
    # Fall through: assessment exists but blocked for some other reason — still
    # describe it as review status, never as a teacher action.
    return _build_review_pending_navigator(navigator_type="review_pending", language=language)


def _next_best_action_for_empty_artifact(
    *,
    blocked_reason: str,
    assessment: Optional[Mapping[str, Any]],
    readiness: Optional[Mapping[str, Any]],
    language: Optional[str],
) -> Optional[Dict[str, Any]]:
    """next_best_action for empty artifacts.

    Reuses ``_next_best_action_from_navigator`` so review-pending /
    no-action states cannot accidentally surface a clickable upload CTA.
    """

    navigator = _navigator_for_empty_artifact(
        blocked_reason=blocked_reason,
        assessment=assessment,
        readiness=readiness,
        language=language,
    )
    return _next_best_action_from_navigator(navigator)


def _empty_artifact(
    *,
    assessment: Optional[Mapping[str, Any]],
    video: Optional[Mapping[str, Any]],
    teacher: Optional[Mapping[str, Any]],
    language: Optional[str],
    empty_state: Mapping[str, Any],
    source_validity: Optional[Mapping[str, Any]],
    analysis_quality: Optional[Mapping[str, Any]],
    blocked_reason: str,
    admin_review: Optional[Mapping[str, Any]] = None,
    readiness: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    video_id = (assessment or {}).get("video_id") or (video or {}).get("id")
    return {
        "artifact_version": TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
        "lesson": {
            "lesson_id": (assessment or {}).get("id"),
            "video_id": video_id,
            "assessment_id": (assessment or {}).get("id"),
            "title": (video or {}).get("lesson_title")
            or (video or {}).get("title")
            or (video or {}).get("filename")
            or (assessment or {}).get("subject")
            or (teacher or {}).get("subject"),
            "subject": (assessment or {}).get("subject")
            or (video or {}).get("subject")
            or (teacher or {}).get("subject"),
            "recorded_at": (assessment or {}).get("recorded_at")
            or (video or {}).get("recorded_at"),
            "reviewed_at": (assessment or {}).get("analyzed_at"),
            "status": "pending" if not assessment else "review_blocked",
        },
        "source_validity": dict(source_validity or {}),
        "analysis_quality": dict(analysis_quality or {}),
        "teacher_feedback_allowed": False,
        "blocked_reason": blocked_reason,
        "summary": {
            "headline": None,
            "opening": None,
            "what_worked": None,
            "growth_focus": None,
            "next_step": None,
        },
        "highlights": [],
        "action_items": [],
        "deep_dive": {
            "available": False,
            "moments": [],
            "empty_state": empty_state.get("message"),
        },
        "recognition": {"gold_star": None, "personal_highlights": []},
        "reflection": {
            "private_by_default": True,
            "prompts": [],
        },
        "admin_connection": {
            "has_admin_feedback": False,
            "shared_reflection_count": 0,
            "admin_response_count": 0,
        },
        "admin_review": _admin_review_public_block(admin_review),
        "navigator": _navigator_for_empty_artifact(
            blocked_reason=blocked_reason,
            assessment=assessment,
            readiness=readiness,
            language=language,
        ),
        "next_best_action": _next_best_action_for_empty_artifact(
            blocked_reason=blocked_reason,
            assessment=assessment,
            readiness=readiness,
            language=language,
        ),
        "empty_state": empty_state,
        "guardrails": {
            "teacher_visible": False,
            "rubric_removed": True,
            "scores_removed": True,
            "evidence_grounded": False,
            "language": language or "en",
        },
        "language": language or "en",
        "legacy_projection": None,
    }


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------


def build_teacher_lesson_coaching_artifact(
    *,
    teacher: Mapping[str, Any],
    current_user: Optional[Mapping[str, Any]] = None,
    assessment: Optional[Mapping[str, Any]] = None,
    video: Optional[Mapping[str, Any]] = None,
    coaching_tasks: Optional[Sequence[Mapping[str, Any]]] = None,
    reflections: Optional[Sequence[Mapping[str, Any]]] = None,
    admin_comments: Optional[Sequence[Mapping[str, Any]]] = None,
    recognition_badges: Optional[Sequence[Mapping[str, Any]]] = None,
    lesson_history: Optional[Sequence[Mapping[str, Any]]] = None,
    readiness: Optional[Mapping[str, Any]] = None,
    language: Optional[str] = "en",
    admin_review: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Compose the canonical teacher-facing coaching artifact.

    Returns a dict whose top-level keys are stable across all teacher
    endpoints. Always teacher-safe: when any gate fails the returned
    artifact has ``teacher_feedback_allowed: False`` and empty content
    sections.

    PR C6: an optional ``admin_review`` dict is consulted in addition to
    the C1/C2/C3 gates. Status values:

      * ``admin_hidden`` — block teacher feedback even if other gates pass.
      * ``revision_requested`` — block teacher feedback (admin asked for an
        adjustment first).
      * ``admin_approved`` — informational. Does NOT override missing
        source, insufficient evidence, or unsafe text. Marked on the
        artifact so the admin UI can show "admin-approved" badge once the
        teacher-facing artifact is actually allowed.
      * anything else (or missing) — fall through to the auto-computed
        gates.
    """

    teacher = teacher or {}
    language = (language or "en").lower()
    review = dict(admin_review or {})
    review_status = str(review.get("status") or "").lower().strip()

    # 0. No assessment at all → honest "no reviewed lesson" empty state.
    if not assessment:
        return _empty_artifact(
            assessment=None,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_no_evidence(language),
            source_validity=None,
            analysis_quality=None,
            blocked_reason="no_reviewed_lesson",
            admin_review=review,
            readiness=readiness,
        )

    # 0a. PR C6: admin-side blocks (admin_hidden / revision_requested) win
    #     over the auto-computed gates. They never allow leaking the admin
    #     note to the teacher — the empty state is generic "review pending".
    if review_status == "admin_hidden":
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_admin_hidden(language),
            source_validity=None,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="admin_hidden",
            admin_review=review,
            readiness=readiness,
        )
    if review_status == "revision_requested":
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_revision_requested(language),
            source_validity=None,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="revision_requested",
            admin_review=review,
            readiness=readiness,
        )

    # 1. C1/C2 source-validity gate. Admin approval CANNOT override missing
    #    source.
    source_validity = build_source_validity(
        artifact=assessment,
        video=video,
        assessment=assessment,
        teacher_id=teacher.get("id"),
    )
    if not source_validity.get("valid_for_teacher_display"):
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_no_evidence(language),
            source_validity=source_validity,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="source_invalid",
            admin_review=review,
            readiness=readiness,
        )

    # 2. C3 evidence-quality gate. Admin approval CANNOT override
    #    insufficient evidence.
    if assessment_quality_blocks_teacher_feedback(assessment):
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_evidence_insufficient(language),
            source_validity=source_validity,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="evidence_insufficient",
            admin_review=review,
            readiness=readiness,
        )

    # 3. Build the legacy projection (already C2-cleaned via
    #    ``reject_unsafe_teacher_payload``), then layer the C4 artifact on
    #    top of it.
    raw_tasks = list(coaching_tasks or [])
    valid_video_ids = {video.get("id")} if video and video.get("id") else None
    valid_assessment_ids = {assessment.get("id")} if assessment and assessment.get("id") else None
    safe_tasks, _quarantined = filter_teacher_visible_coaching_tasks(
        raw_tasks,
        valid_video_ids=valid_video_ids,
        valid_assessment_ids=valid_assessment_ids,
    )

    projection = build_teacher_coaching_intelligence(
        assessment=assessment,
        video=video or {},
        teacher=teacher,
        readiness=readiness,
        coaching_tasks=safe_tasks,
        reflections=reflections,
        admin_comments=admin_comments,
        recognition_badges=recognition_badges,
        lesson_history=lesson_history,
        language=language,
    )

    cleaned_projection = reject_unsafe_teacher_payload(projection, language=language)
    if cleaned_projection is None:
        # The text was so polluted with rubric/admin language that the
        # recursive scan refused to mark it teacher-safe. Hide it.
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_unsafe_content(language),
            source_validity=source_validity,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="unsafe_text",
            admin_review=review,
            readiness=readiness,
        )

    # 4. Compose the C4 artifact sections.
    video_id = assessment.get("video_id") or (video or {}).get("id")
    lesson_title = (
        (video or {}).get("lesson_title")
        or (video or {}).get("title")
        or (video or {}).get("filename")
        or assessment.get("subject")
        or teacher.get("subject")
        or "Lesson recording"
    )
    subject = assessment.get("subject") or (video or {}).get("subject") or teacher.get("subject")

    summary_block = cleaned_projection.get("latest_summary") or {}

    def _safe_or_none(value: Any) -> Optional[str]:
        if not value:
            return None
        text = str(value).strip()
        if not text:
            return None
        if not _is_clean_teacher_text(text):
            return None
        return text

    summary = {
        "headline": _safe_or_none(summary_block.get("opening"))
        or _safe_or_none(summary_block.get("strength")),
        "opening": _safe_or_none(summary_block.get("opening")),
        "what_worked": _safe_or_none(summary_block.get("strength")),
        "growth_focus": _safe_or_none(summary_block.get("growth_focus")),
        "next_step": _safe_or_none(summary_block.get("next_step")),
    }

    personal_highlights = _build_personal_highlights(
        projection=cleaned_projection,
        video_id=video_id,
    )

    action_items = _build_action_items(
        projection=cleaned_projection,
        assessment=assessment,
        video=video or {},
        language=language,
    )
    # PR C8: attach action taxonomy (category, action_kind, cta_label) so the
    # frontend can render state-specific labels rather than generic "next step".
    action_items = [_attach_action_taxonomy(item, language=language) for item in action_items]

    deep_dive_input = (cleaned_projection.get("deep_dive") or {}).get("moments") or []
    deep_dive = filter_deep_dive_moments(deep_dive_input, language=language)
    # Cap at TEACHER_DEEP_DIVE_MAX and ensure each moment has a video_href.
    deep_dive_moments: List[Dict[str, Any]] = []
    for moment in deep_dive.get("moments") or []:
        if not isinstance(moment, Mapping):
            continue
        start_sec = moment.get("start_sec")
        moment_dict = dict(moment)
        if video_id and start_sec is not None and not moment_dict.get("video_href"):
            try:
                moment_dict["video_href"] = f"/videos/{video_id}?t={int(max(0, float(start_sec)))}"
            except (TypeError, ValueError):
                moment_dict["video_href"] = f"/videos/{video_id}"
        deep_dive_moments.append(moment_dict)
        if len(deep_dive_moments) >= TEACHER_DEEP_DIVE_MAX:
            break
    deep_dive = {
        "available": bool(deep_dive_moments) and deep_dive.get("available", False),
        "moments": deep_dive_moments,
        "empty_state": (
            deep_dive.get("empty_state")
            if not deep_dive_moments
            else None
        ),
    }

    gold_star = _build_gold_star_recognition(
        projection=cleaned_projection,
        recognition_badges=recognition_badges,
        valid_video_ids=[video_id] if video_id else [],
    )

    reflection_prompts: List[str] = []
    seen_prompts: set = set()
    for raw_prompt in cleaned_projection.get("reflection_prompts") or []:
        prompt = str(raw_prompt or "").strip()
        if not prompt or not _is_clean_teacher_text(prompt):
            continue
        if prompt.lower() in seen_prompts:
            continue
        reflection_prompts.append(prompt)
        seen_prompts.add(prompt.lower())
    # Always attach an action-tied prompt if we have an action item.
    if action_items:
        primary_prompt = action_items[0].get("reflection_prompt")
        if primary_prompt and primary_prompt.lower() not in seen_prompts:
            reflection_prompts.insert(0, primary_prompt)
            seen_prompts.add(primary_prompt.lower())

    admin_connection = {
        "has_admin_feedback": bool(admin_comments),
        "shared_reflection_count": sum(
            1
            for ref in (reflections or [])
            if isinstance(ref, Mapping) and ref.get("visibility") == "shared_with_admin"
        ),
        "admin_response_count": sum(
            1
            for comment in (admin_comments or [])
            if isinstance(comment, Mapping) and comment.get("visibility") == "shared_with_teacher"
        ),
    }

    # 5. Truthful guardrails. ``teacher_visible`` is only true after the
    #    recursive scan on the final artifact passes.
    artifact = {
        "artifact_version": TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
        "lesson": {
            "lesson_id": assessment.get("id"),
            "video_id": video_id,
            "assessment_id": assessment.get("id"),
            "title": lesson_title,
            "subject": subject,
            "recorded_at": assessment.get("recorded_at")
            or (video or {}).get("recorded_at")
            or (video or {}).get("upload_date"),
            "reviewed_at": assessment.get("analyzed_at"),
            "status": "reviewed",
        },
        "source_validity": dict(source_validity),
        "analysis_quality": dict(assessment.get("analysis_quality") or {}),
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "summary": summary,
        "highlights": personal_highlights,
        "action_items": action_items,
        "deep_dive": deep_dive,
        "recognition": {
            "gold_star": gold_star,
            "personal_highlights": personal_highlights,
        },
        "reflection": {
            "private_by_default": True,
            "prompts": reflection_prompts,
        },
        "admin_connection": admin_connection,
        "admin_review": _admin_review_public_block(review),
        "navigator": None,  # filled in below after action_items are taxonomy-annotated
        "next_best_action": _next_best_action_from_artifact(
            action_items=action_items,
            empty_state=None,
            language=language,
        ),
        "empty_state": None,
        "language": language or "en",
        "legacy_projection": cleaned_projection,
        "guardrails": {
            "teacher_visible": True,
            "rubric_removed": True,
            "scores_removed": True,
            "evidence_grounded": True,
            "language": language or "en",
        },
    }

    # PR C8: compute the typed navigator + override next_best_action so the
    # frontend renders state-specific copy / CTA. Navigator wins over the
    # legacy honest_next_best_action_for_record fallback used earlier.
    navigator = build_artifact_navigator(
        artifact,
        readiness=readiness,
        language=language,
        has_unread_admin_message=bool(admin_connection.get("admin_response_count")),
    )
    artifact["navigator"] = navigator
    derived_nba = _next_best_action_from_navigator(navigator)
    if derived_nba is not None:
        artifact["next_best_action"] = derived_nba

    # 6. Final recursive scan. If any unsafe string slipped past the
    #    component-level filters, downgrade guardrails and replace the
    #    leaking sections with empty + empty_state.
    teacher_visible_paths_to_scan = {
        "lesson": artifact["lesson"],
        "summary": artifact["summary"],
        "highlights": artifact["highlights"],
        "action_items": artifact["action_items"],
        "deep_dive": artifact["deep_dive"],
        "recognition": artifact["recognition"],
        "reflection": artifact["reflection"],
        "next_best_action": artifact["next_best_action"],
    }
    issues = find_teacher_visible_text_issues(teacher_visible_paths_to_scan)
    if issues:
        # Refuse to claim teacher_visible. Collapse to safe empty.
        return _empty_artifact(
            assessment=assessment,
            video=video,
            teacher=teacher,
            language=language,
            empty_state=_empty_state_for_unsafe_content(language),
            source_validity=source_validity,
            analysis_quality=assessment.get("analysis_quality"),
            blocked_reason="unsafe_text_post_compose",
            admin_review=review,
            readiness=readiness,
        )

    return artifact


# ---------------------------------------------------------------------------
# PR C9.4 PART 4 — canonical teacher-visible feedback selector
# ---------------------------------------------------------------------------

# The single decision point teachers' lesson / dashboard cards consume. It
# reconciles TWO signals that previously disagreed:
#   1. the artifact safety gates (``teacher_feedback_allowed`` / ``blocked_reason``)
#   2. the assessment's ``feedback_release_status`` (released / blocked)
# and maps the combination to a SPECIFIC, teacher-safe reason — never the
# generic "No action needed right now." copy that left teachers unsure whether a
# completed review had actually produced (or withheld) feedback.

TEACHER_FEEDBACK_VIEW_STATUSES: Tuple[str, ...] = (
    "ready",
    "awaiting_admin_release",
    "admin_hidden",
    "revision_requested",
    "evidence_insufficient",
    "source_unavailable",
    "safety_withheld",
    "not_yet_reviewed",
    "processing",
)

# Map an artifact ``blocked_reason`` to a feedback-view status.
_BLOCKED_REASON_TO_VIEW_STATUS: Dict[str, str] = {
    "no_reviewed_lesson": "not_yet_reviewed",
    "admin_hidden": "admin_hidden",
    "revision_requested": "revision_requested",
    "source_invalid": "source_unavailable",
    "evidence_insufficient": "evidence_insufficient",
    "unsafe_text": "safety_withheld",
    "unsafe_text_post_compose": "safety_withheld",
}


def _teacher_feedback_view_copy(status: str, language: Optional[str]) -> Dict[str, str]:
    """Specific, teacher-safe headline + detail for each feedback-view status."""
    is_he = (language or "en").lower().startswith("he")
    en = {
        "ready": {
            "headline": "Your coaching feedback is ready.",
            "detail": "Open your lesson to see what worked and your next coaching move.",
        },
        "awaiting_admin_release": {
            "headline": "Your feedback is ready and awaiting release.",
            "detail": "An administrator is doing a final check before sharing this lesson's coaching with you.",
        },
        "admin_hidden": {
            "headline": "An administrator paused this lesson's feedback.",
            "detail": "Your reviewer chose to hold this lesson's coaching for now. You'll be notified if it's shared.",
        },
        "revision_requested": {
            "headline": "Your reviewer is refining this feedback.",
            "detail": "An administrator asked for a revision before this lesson's coaching is shared with you.",
        },
        "evidence_insufficient": {
            "headline": "This recording didn't capture enough to coach on.",
            "detail": "We couldn't see enough clear classroom activity in this lesson to give reliable coaching feedback.",
        },
        "source_unavailable": {
            "headline": "We couldn't match feedback to this recording.",
            "detail": "This lesson's feedback couldn't be tied to its recording, so it isn't being shown.",
        },
        "safety_withheld": {
            "headline": "This feedback is getting a final quality check.",
            "detail": "Your coaching summary is being re-checked for quality before it's shared with you.",
        },
        "not_yet_reviewed": {
            "headline": "This lesson hasn't been reviewed yet.",
            "detail": "Once a complete review finishes, your coaching summary and next steps will appear here.",
        },
        "processing": {
            "headline": "This lesson's review is still in progress.",
            "detail": "Your coaching summary will appear here as soon as the review finishes.",
        },
    }
    he = {
        "ready": {
            "headline": "המשוב שלך מוכן.",
            "detail": "פתחו את השיעור כדי לראות מה עבד ומה הצעד הבא שלכם.",
        },
        "awaiting_admin_release": {
            "headline": "המשוב שלך מוכן וממתין לשחרור.",
            "detail": "מנהל עורך בדיקה אחרונה לפני שיתוף ההערות לשיעור הזה.",
        },
        "admin_hidden": {
            "headline": "מנהל השהה את ההערות לשיעור הזה.",
            "detail": "המנהל בחר להחזיק את ההערות לעת עתה. תקבלו עדכון אם הן ישותפו.",
        },
        "revision_requested": {
            "headline": "המנהל משפר את המשוב הזה.",
            "detail": "מנהל ביקש עדכון לפני שההערות לשיעור הזה ישותפו איתך.",
        },
        "evidence_insufficient": {
            "headline": "ההקלטה לא תיעדה מספיק כדי לתת משוב.",
            "detail": "לא ראינו מספיק פעילות כיתתית ברורה בשיעור הזה כדי לתת משוב אמין.",
        },
        "source_unavailable": {
            "headline": "לא הצלחנו לקשר את המשוב להקלטה.",
            "detail": "לא ניתן היה לקשר את ההערות לשיעור הזה להקלטה שלו, ולכן הן לא מוצגות.",
        },
        "safety_withheld": {
            "headline": "המשוב עובר בדיקת איכות אחרונה.",
            "detail": "הסיכום נבדק שוב לאיכות לפני שיתוף איתך.",
        },
        "not_yet_reviewed": {
            "headline": "השיעור הזה עדיין לא נבדק.",
            "detail": "כשבדיקה מלאה תסתיים, הסיכום והצעדים הבאים יופיעו כאן.",
        },
        "processing": {
            "headline": "הבדיקה של השיעור הזה עדיין מתבצעת.",
            "detail": "הסיכום יופיע כאן ברגע שהבדיקה תסתיים.",
        },
    }
    table = he if is_he else en
    return dict(table.get(status, table["processing"]))


def _normalize_feedback_release_status(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    if text in {"released", "blocked"}:
        return text
    return None


def get_teacher_visible_lesson_feedback(
    artifact: Optional[Mapping[str, Any]],
    *,
    feedback_release_status: Any = None,
    language: Optional[str] = "en",
) -> Dict[str, Any]:
    """Resolve what a teacher may actually see for one reviewed lesson.

    This is the canonical projection that lesson/dashboard cards render. It
    returns ``feedback_available`` (whether populated coaching is shown) plus a
    SPECIFIC ``status`` / ``headline`` / ``detail`` for every blocked state, so a
    completed-but-withheld review never shows generic "no action needed" copy.

    Decision order:

    1. Artifact safety gate. If ``teacher_feedback_allowed`` is False, the
       ``blocked_reason`` maps to a specific withheld status (source / evidence /
       safety / admin-hold / not-yet-reviewed). Safety always wins — a released
       flag can never surface unsafe / unverified feedback.
    2. Release gate. If the artifact is allowed but ``feedback_release_status``
       is ``"blocked"``, the feedback is ready but awaiting an administrator's
       release → ``awaiting_admin_release`` (NOT shown yet, specific copy).
    3. Otherwise (allowed and released, or allowed with no release record) the
       feedback is shown (``ready``).
    """
    artifact = dict(artifact or {})
    language = (language or artifact.get("language") or "en")
    allowed = bool(artifact.get("teacher_feedback_allowed"))
    blocked_reason = artifact.get("blocked_reason")
    release = _normalize_feedback_release_status(feedback_release_status)

    if not allowed:
        status = _BLOCKED_REASON_TO_VIEW_STATUS.get(str(blocked_reason or ""), "processing")
        copy = _teacher_feedback_view_copy(status, language)
        return {
            "status": status,
            "feedback_available": False,
            "teacher_feedback_allowed": False,
            "blocked_reason": blocked_reason or status,
            "feedback_release_status": release,
            "headline": copy["headline"],
            "detail": copy["detail"],
            "summary": None,
            "action_items": [],
            "next_best_action": artifact.get("next_best_action"),
            "navigator": artifact.get("navigator"),
            "lesson": artifact.get("lesson"),
            "language": language,
        }

    if release == "blocked":
        copy = _teacher_feedback_view_copy("awaiting_admin_release", language)
        return {
            "status": "awaiting_admin_release",
            "feedback_available": False,
            "teacher_feedback_allowed": True,
            "blocked_reason": "awaiting_admin_release",
            "feedback_release_status": release,
            "headline": copy["headline"],
            "detail": copy["detail"],
            "summary": None,
            "action_items": [],
            "next_best_action": artifact.get("next_best_action"),
            "navigator": artifact.get("navigator"),
            "lesson": artifact.get("lesson"),
            "language": language,
        }

    copy = _teacher_feedback_view_copy("ready", language)
    return {
        "status": "ready",
        "feedback_available": True,
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "feedback_release_status": release or "released",
        "headline": copy["headline"],
        "detail": copy["detail"],
        "summary": artifact.get("summary"),
        "action_items": list(artifact.get("action_items") or []),
        "highlights": list(artifact.get("highlights") or []),
        "deep_dive": artifact.get("deep_dive"),
        "next_best_action": artifact.get("next_best_action"),
        "navigator": artifact.get("navigator"),
        "lesson": artifact.get("lesson"),
        "language": language,
    }


# ---------------------------------------------------------------------------
# Admin / teacher view conversion
# ---------------------------------------------------------------------------


def admin_view_of_artifact(
    artifact: Mapping[str, Any],
    *,
    assessment: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Return an admin-facing copy of the artifact.

    Admin views may see rubric labels, element_scores, overall_score,
    analysis_quality, source_validity, unsafe text issues, and the legacy
    projection. The teacher view stays empty if blocked.
    """

    artifact = dict(artifact or {})
    admin_payload = dict(artifact)
    if assessment:
        admin_payload["element_scores"] = list(assessment.get("element_scores") or [])
        admin_payload["overall_score"] = assessment.get("overall_score")
        admin_payload["raw_summary"] = assessment.get("summary")
        admin_payload["raw_recommendations"] = list(assessment.get("recommendations") or [])
        admin_payload["analysis_confidence"] = assessment.get("analysis_confidence")
    admin_payload["teacher_preview"] = {
        "teacher_feedback_allowed": artifact.get("teacher_feedback_allowed"),
        "blocked_reason": artifact.get("blocked_reason"),
        "guardrails": artifact.get("guardrails"),
        "summary": artifact.get("summary"),
        "action_items_count": len(artifact.get("action_items") or []),
        "deep_dive_available": (artifact.get("deep_dive") or {}).get("available"),
    }
    # PR C9: surface the admin-only coach-voice diagnostics next to the
    # teacher_preview block. The teacher-visible artifact only exposes the
    # short coach_voice status; admins also see provider/model/token
    # estimates / validation issues / sufficiency reasons / used moments.
    coach_voice_admin = artifact.get("_coach_voice_admin")
    if coach_voice_admin:
        admin_payload["coach_voice_diagnostics"] = dict(coach_voice_admin)
    return admin_payload


def teacher_safe_artifact(artifact: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    """PR C9: strip admin-only diagnostics from an artifact before returning to a teacher.

    The C9 coach-voice integration writes ``_coach_voice_admin`` onto the
    artifact for admin consumption. The teacher view must never see those
    diagnostics (provider, model, token estimates, sufficiency signals,
    validation issues, evidence hash).
    """

    if not artifact:
        return artifact  # type: ignore[return-value]
    stripped = dict(artifact)
    stripped.pop("_coach_voice_admin", None)
    return stripped


def teacher_visible_summary_text(artifact: Mapping[str, Any]) -> str:
    """Concatenate the teacher-safe summary fields into a single short string."""

    if not artifact:
        return ""
    summary = artifact.get("summary") or {}
    parts = [
        summary.get("opening"),
        summary.get("what_worked"),
        summary.get("growth_focus"),
        summary.get("next_step"),
    ]
    return " ".join(str(p).strip() for p in parts if p).strip()


# ---------------------------------------------------------------------------
# Audit helper
# ---------------------------------------------------------------------------


def audit_teacher_artifact(artifact: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Return a list of artifact-level issues for an admin audit script.

    Issues surfaced:

      * unsafe visible text anywhere in the artifact
      * teacher_feedback_allowed=True with analysis_quality blocking it
      * action item that duplicates the summary
      * action item that fails the C2 eligibility gate
      * missing canonical artifact_version
      * gold_star recognition tied to invalid source chain
    """

    issues: List[Dict[str, Any]] = []
    if not artifact:
        return issues

    if artifact.get("artifact_version") != TEACHER_LESSON_COACHING_ARTIFACT_VERSION:
        issues.append({"code": "artifact_version_mismatch", "value": artifact.get("artifact_version")})

    visible_text_issues = find_teacher_visible_text_issues(
        {
            "summary": artifact.get("summary"),
            "highlights": artifact.get("highlights"),
            "action_items": artifact.get("action_items"),
            "deep_dive": artifact.get("deep_dive"),
            "recognition": artifact.get("recognition"),
            "reflection": artifact.get("reflection"),
            "next_best_action": artifact.get("next_best_action"),
        }
    )
    for entry in visible_text_issues:
        issues.append({"code": "unsafe_teacher_visible_text", **entry})

    analysis_quality = artifact.get("analysis_quality") or {}
    if (
        artifact.get("teacher_feedback_allowed")
        and analysis_quality.get("teacher_feedback_allowed") is False
    ):
        issues.append({"code": "teacher_feedback_allowed_contradicts_quality"})

    summary_lowered = {
        str((artifact.get("summary") or {}).get(k) or "").strip().lower()
        for k in ("opening", "what_worked", "growth_focus", "next_step")
    }
    summary_lowered.discard("")
    for index, item in enumerate(artifact.get("action_items") or []):
        if not isinstance(item, Mapping):
            continue
        body = str(item.get("body") or "").strip().lower()
        if body and body in summary_lowered:
            issues.append(
                {
                    "code": "action_item_duplicates_summary",
                    "index": index,
                    "body": body,
                }
            )
        if not is_action_item_teacher_eligible(item):
            issues.append({"code": "action_item_failed_eligibility", "index": index})

    gold_star = (artifact.get("recognition") or {}).get("gold_star")
    if gold_star and not (artifact.get("source_validity") or {}).get("valid_for_teacher_display"):
        issues.append({"code": "gold_star_with_invalid_source"})

    return issues


__all__ = [
    "TEACHER_LESSON_COACHING_ARTIFACT_VERSION",
    "RUBRIC_TO_PRACTICE",
    "translate_rubric_label_to_practice",
    "build_teacher_lesson_coaching_artifact",
    "admin_view_of_artifact",
    "teacher_visible_summary_text",
    "audit_teacher_artifact",
]
