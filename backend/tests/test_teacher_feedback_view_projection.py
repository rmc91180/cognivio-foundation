"""Unit tests for PR C9.4 PART 4 canonical teacher feedback view.

``get_teacher_visible_lesson_feedback`` is the single projection that lesson and
dashboard cards render. It reconciles two independent gates:

- the artifact **safety gate** (``teacher_feedback_allowed`` + ``blocked_reason``)
- the admin **release gate** (``feedback_release_status``)

The invariants under test:

- The safety gate ALWAYS wins. A ``released`` flag can never surface unsafe /
  unverified feedback — every blocked reason maps to a SPECIFIC withheld status
  with non-empty headline + detail copy (cards never fall back to a generic
  "no action needed" placeholder).
- ``feedback_available`` is True only when allowed AND not release-blocked.
- Copy is bilingual (EN/HE) and the status vocabulary is stable.
"""

from __future__ import annotations

import pytest

from app.services.teacher_lesson_coaching_artifact import (
    TEACHER_FEEDBACK_VIEW_STATUSES,
    get_teacher_visible_lesson_feedback,
)


def _allowed_artifact(**overrides):
    artifact = {
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "summary": {"opening": "You gave students time to think."},
        "action_items": [{"title": "Invite a second voice"}],
        "highlights": [{"body": "Strong wait time."}],
        "deep_dive": {"available": True},
        "next_best_action": {"action": "review_lesson"},
        "navigator": {"primary": "open_lesson"},
        "lesson": {"id": "lesson-1"},
    }
    artifact.update(overrides)
    return artifact


def _blocked_artifact(reason, **overrides):
    artifact = {
        "teacher_feedback_allowed": False,
        "blocked_reason": reason,
        "next_best_action": {"action": "wait"},
        "navigator": {"primary": "dashboard"},
        "lesson": {"id": "lesson-1"},
    }
    artifact.update(overrides)
    return artifact


class TestSafetyGateMapping:
    @pytest.mark.parametrize(
        "reason,expected_status",
        [
            ("no_reviewed_lesson", "not_yet_reviewed"),
            ("admin_hidden", "admin_hidden"),
            ("revision_requested", "revision_requested"),
            ("source_invalid", "source_unavailable"),
            ("evidence_insufficient", "evidence_insufficient"),
            ("unsafe_text", "safety_withheld"),
            ("unsafe_text_post_compose", "safety_withheld"),
        ],
    )
    def test_blocked_reason_maps_to_specific_status(self, reason, expected_status) -> None:
        view = get_teacher_visible_lesson_feedback(_blocked_artifact(reason))
        assert view["status"] == expected_status
        assert view["feedback_available"] is False
        assert view["teacher_feedback_allowed"] is False
        assert view["headline"]
        assert view["detail"]
        assert view["summary"] is None
        assert view["action_items"] == []

    def test_unknown_blocked_reason_defaults_to_processing(self) -> None:
        view = get_teacher_visible_lesson_feedback(_blocked_artifact("something_new"))
        assert view["status"] == "processing"
        assert view["feedback_available"] is False
        assert view["headline"]
        assert view["detail"]

    def test_none_artifact_is_processing_and_safe(self) -> None:
        view = get_teacher_visible_lesson_feedback(None)
        assert view["status"] == "processing"
        assert view["feedback_available"] is False
        assert view["headline"]
        assert view["detail"]


class TestReleaseGate:
    def test_allowed_but_release_blocked_awaits_admin(self) -> None:
        view = get_teacher_visible_lesson_feedback(
            _allowed_artifact(), feedback_release_status="blocked"
        )
        assert view["status"] == "awaiting_admin_release"
        assert view["feedback_available"] is False
        assert view["teacher_feedback_allowed"] is True
        assert view["blocked_reason"] == "awaiting_admin_release"
        assert view["summary"] is None
        assert view["headline"]
        assert view["detail"]

    def test_allowed_and_released_is_ready(self) -> None:
        view = get_teacher_visible_lesson_feedback(
            _allowed_artifact(), feedback_release_status="released"
        )
        assert view["status"] == "ready"
        assert view["feedback_available"] is True
        assert view["feedback_release_status"] == "released"
        assert view["summary"] == {"opening": "You gave students time to think."}
        assert view["action_items"]
        assert view["highlights"]
        assert view["deep_dive"] == {"available": True}

    def test_allowed_with_no_release_record_defaults_to_released(self) -> None:
        view = get_teacher_visible_lesson_feedback(_allowed_artifact())
        assert view["status"] == "ready"
        assert view["feedback_available"] is True
        assert view["feedback_release_status"] == "released"

    def test_unrecognized_release_value_is_ignored(self) -> None:
        # Any value other than released/blocked normalizes to None → ready.
        view = get_teacher_visible_lesson_feedback(
            _allowed_artifact(), feedback_release_status="pending_review"
        )
        assert view["status"] == "ready"
        assert view["feedback_available"] is True


class TestSafetyWinsOverRelease:
    def test_released_flag_cannot_unblock_unsafe_feedback(self) -> None:
        # Admin marked the assessment released, but the artifact safety gate
        # still blocks (unsafe text). Safety wins: withheld, not shown.
        view = get_teacher_visible_lesson_feedback(
            _blocked_artifact("unsafe_text"), feedback_release_status="released"
        )
        assert view["status"] == "safety_withheld"
        assert view["feedback_available"] is False
        assert view["headline"]
        assert view["detail"]

    def test_released_flag_cannot_unblock_source_invalid(self) -> None:
        view = get_teacher_visible_lesson_feedback(
            _blocked_artifact("source_invalid"), feedback_release_status="released"
        )
        assert view["status"] == "source_unavailable"
        assert view["feedback_available"] is False


class TestCopyAndVocabulary:
    def test_status_is_always_in_vocabulary(self) -> None:
        for reason in (
            "no_reviewed_lesson",
            "admin_hidden",
            "revision_requested",
            "source_invalid",
            "evidence_insufficient",
            "unsafe_text",
            "unknown_reason",
        ):
            view = get_teacher_visible_lesson_feedback(_blocked_artifact(reason))
            assert view["status"] in TEACHER_FEEDBACK_VIEW_STATUSES
        assert (
            get_teacher_visible_lesson_feedback(_allowed_artifact())["status"]
            in TEACHER_FEEDBACK_VIEW_STATUSES
        )

    def test_hebrew_copy_differs_from_english(self) -> None:
        en = get_teacher_visible_lesson_feedback(
            _blocked_artifact("evidence_insufficient"), language="en"
        )
        he = get_teacher_visible_lesson_feedback(
            _blocked_artifact("evidence_insufficient"), language="he"
        )
        assert en["headline"] and he["headline"]
        assert en["headline"] != he["headline"]
        assert he["language"] == "he"

    def test_language_falls_back_to_artifact_language(self) -> None:
        view = get_teacher_visible_lesson_feedback(
            _blocked_artifact("admin_hidden", language="he"), language=None
        )
        assert view["language"] == "he"
        assert view["headline"]
