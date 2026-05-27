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
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

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
    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "evidence_insufficient",
            "title": "ההערה הזו עוד לא מוכנה.",
            "message": "כשהבדיקה הבאה תהיה מוכנה, יופיעו כאן רגעים ספציפיים והצעדים הבאים.",
        }
    return {
        "code": "evidence_insufficient",
        "title": "This lesson’s feedback isn’t ready yet.",
        "message": "Once a complete review is ready, you’ll see specific coaching moments and next steps here.",
    }


def _empty_state_for_unsafe_content(language: Optional[str]) -> Dict[str, Any]:
    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "review_under_check",
            "title": "ההערה הזו ממתינה לבדיקה.",
            "message": "המאמן ימשיך מכאן ברגע שהבדיקה תושלם.",
        }
    return {
        "code": "review_under_check",
        "title": "This lesson’s review is being checked.",
        "message": "A coach will continue from here as soon as the review is verified.",
    }


def _empty_state_for_admin_hidden(language: Optional[str]) -> Dict[str, Any]:
    """PR C6: admin chose to hide this lesson's teacher feedback.

    The teacher must not see the admin's internal note. The empty state
    reads as "review pending" so the teacher sees an honest signal that
    the lesson is in human review.
    """

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "admin_review_pending",
            "title": "המאמן ממשיך לבדוק את השיעור.",
            "message": "תוכלו לחזור לכאן אחרי שהבדיקה תושלם.",
        }
    return {
        "code": "admin_review_pending",
        "title": "A coach is still reviewing this lesson.",
        "message": "Come back here once the review is complete.",
    }


def _empty_state_for_revision_requested(language: Optional[str]) -> Dict[str, Any]:
    """PR C6: admin requested a revision before showing teacher feedback."""

    is_he = (language or "en").lower().startswith("he")
    if is_he:
        return {
            "code": "admin_revision_requested",
            "title": "המאמן ביקש עוד התאמות לפני שמציגים את ההערות.",
            "message": "תוכלו לחזור לכאן אחרי שהמאמן יסיים את ההתאמות.",
        }
    return {
        "code": "admin_revision_requested",
        "title": "A coach asked for one more adjustment before sharing feedback.",
        "message": "Come back here once the coach has finished the adjustments.",
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
        "next_best_action": honest_next_best_action_for_record(language=language),
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
        )

    return artifact


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
    return admin_payload


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
