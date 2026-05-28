"""Backend tests for PR C8 teacher navigation intelligence.

Covers:

  * review-pending / admin_hidden / revision_requested navigators are
    typed, disabled, and carry no href / cta_label / upload link.
  * no-lesson (artifact absent, setup OK) navigator is upload_required
    with /record href.
  * setup-incomplete readiness wins over the artifact-block state and
    links to the exact blocker href, not /record.
  * valid coaching artifact returns coaching_action navigator with a
    coaching CTA.
  * watch_moment navigator surfaces specific moment CTA labels when
    phase/keywords match.
  * specific_moment_cta_label keyword and phase coverage.
  * "A coach will continue from here" is absent from every artifact
    empty-state path.
  * next_best_action is None for blocked artifacts (no clickable record
    CTA).
  * Hebrew labels are produced for the navigator types.
"""

from __future__ import annotations

import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

from app.services.teacher_lesson_coaching_artifact import (
    build_artifact_navigator,
    build_teacher_lesson_coaching_artifact,
    specific_moment_cta_label,
)


def _allowed_assessment(**overrides):
    base = {
        "id": "a-good",
        "teacher_id": "t-good",
        "video_id": "v-good",
        "framework_type": "danielson",
        "summary": "You opened the lesson with a clear question and gave students time to think.",
        "recommendations": [
            "After one student answers, pause and ask a peer to add on before moving forward.",
        ],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 80, "summary": "You paused after the prompt and waited."},
        ],
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
        "analyzed_at": "2026-05-27T00:00:00+00:00",
    }
    base.update(overrides)
    return base


def _allowed_video():
    return {"id": "v-good", "teacher_id": "t-good", "lesson_title": "Fractions"}


# ---------------------------------------------------------------------------
# Review-pending family
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("review_status,expected_type", [
    ("admin_hidden", "admin_hidden"),
    ("revision_requested", "revision_requested"),
])
def test_admin_review_block_states_have_disabled_navigator(review_status, expected_type):
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=_allowed_assessment(),
        video=_allowed_video(),
        admin_review={"status": review_status},
    )
    nav = artifact["navigator"]
    assert nav["type"] == expected_type
    assert nav["disabled"] is True
    assert nav["href"] is None
    assert nav["cta_label"] is None
    assert artifact["next_best_action"] is None
    assert "/record" not in str(artifact).lower()


def test_evidence_insufficient_artifact_is_review_pending_no_record_cta():
    assessment = _allowed_assessment(analysis_quality={
        "version": "assessment_quality_v1",
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "usable_moment_count": 0,
        "quality_reasons": ["no_usable_moments"],
    })
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=assessment,
        video=_allowed_video(),
    )
    nav = artifact["navigator"]
    assert nav["type"] == "review_pending"
    assert nav["disabled"] is True
    assert nav["href"] is None
    assert artifact["next_best_action"] is None
    # PR C8 negative assertion: the misleading review-pending sentence
    # must not appear anywhere on the artifact.
    serialized = str(artifact).lower()
    assert "a coach will continue from here" not in serialized


# ---------------------------------------------------------------------------
# No-lesson + setup paths
# ---------------------------------------------------------------------------


def test_no_lesson_yields_upload_required_with_record_href():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=None,
    )
    nav = artifact["navigator"]
    assert nav["type"] == "upload_required"
    assert nav["href"] == "/record"
    assert nav["cta_label"]
    assert artifact["next_best_action"] is not None
    assert artifact["next_best_action"]["href"] == "/record"


def test_setup_required_wins_over_upload_and_links_to_blocker_href():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=None,
        readiness={
            "setup_next_step": {
                "id": "consent",
                "code": "PRIVACY_CONSENT_REQUIRED",
                "label": "Review privacy consent",
                "href": "/consent",
                "message": "Sign consent so coaching can connect.",
            }
        },
    )
    nav = artifact["navigator"]
    assert nav["type"] == "setup_required"
    # Must NOT link to /record when setup is incomplete.
    assert nav["href"] == "/consent"
    assert nav["cta_label"]
    assert artifact["next_best_action"]["href"] == "/consent"


def test_setup_required_also_wins_when_artifact_is_review_pending():
    """Setup beats review-pending; admins still need the teacher to
    finish setup before any coaching action surfaces."""

    assessment = _allowed_assessment(analysis_quality={
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "quality_reasons": ["no_usable_moments"],
    })
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=assessment,
        video=_allowed_video(),
        readiness={"setup_next_step": {"id": "profile", "label": "Finish profile", "href": "/my-profile"}},
    )
    assert artifact["navigator"]["type"] == "setup_required"
    assert artifact["navigator"]["href"] == "/my-profile"


# ---------------------------------------------------------------------------
# Coaching action + watch moment + reflection navigators
# ---------------------------------------------------------------------------


def test_valid_artifact_returns_coaching_action_navigator():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good", "subject": "Math"},
        assessment=_allowed_assessment(),
        video=_allowed_video(),
    )
    nav = artifact["navigator"]
    assert nav["type"] == "coaching_action"
    assert nav["cta_label"]
    assert nav["href"]
    assert nav["disabled"] is False
    # The action-item array carries the C8 taxonomy fields.
    assert artifact["action_items"]
    item = artifact["action_items"][0]
    assert item["category"] == "instructional_practice"
    assert item["action_kind"] == "try_next_lesson"
    assert item["disabled"] is False


def test_navigator_for_artifact_with_only_a_deep_dive_moment_uses_watch_moment():
    """When the artifact has no action items but a real deep-dive moment,
    the navigator surfaces a watch_moment CTA, not generic next-step."""

    artifact_input = {
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "action_items": [],
        "deep_dive": {
            "available": True,
            "moments": [
                {
                    "id": "m1",
                    "start_sec": 60,
                    "end_sec": 80,
                    "title": "A moment worth keeping",
                    "what_happened": "You asked a quick question and a second student replied.",
                    "phase": "discussion",
                    "video_href": "/videos/v1?t=60",
                }
            ],
        },
        "reflection": {"prompts": []},
        "lesson": {"video_id": "v1"},
    }
    nav = build_artifact_navigator(artifact_input)
    assert nav["type"] == "watch_moment"
    assert nav["href"] == "/videos/v1?t=60"
    assert "Watch" in nav["cta_label"]
    assert nav["disabled"] is False


def test_navigator_reflection_only_artifact_returns_reflection_type():
    artifact_input = {
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "action_items": [],
        "deep_dive": {"available": False, "moments": []},
        "reflection": {"prompts": ["What did you notice about who joined the conversation?"]},
        "lesson": {},
    }
    nav = build_artifact_navigator(artifact_input)
    assert nav["type"] == "reflection"
    assert nav["cta_label"]
    assert nav["disabled"] is False


def test_navigator_no_action_when_allowed_but_empty():
    artifact_input = {
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "action_items": [],
        "deep_dive": {"available": False, "moments": []},
        "reflection": {"prompts": []},
        "lesson": {},
    }
    nav = build_artifact_navigator(artifact_input)
    assert nav["type"] == "no_action"
    assert nav["disabled"] is True
    assert nav["href"] is None
    assert nav["cta_label"] is None


# ---------------------------------------------------------------------------
# Specific moment CTA label helper
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("moment,expected_substring", [
    ({"what_happened": "You asked a quick prompt."}, "question"),
    ({"phase": "check_for_understanding"}, "check-for-understanding"),
    ({"phase": "transition"}, "transition"),
    ({"what_happened": "You moved between groups around the room."}, "room"),
])
def test_specific_moment_cta_label_picks_specific_english_labels(moment, expected_substring):
    label = specific_moment_cta_label(moment, language="en")
    assert "Watch" in label
    assert expected_substring.lower() in label.lower()


def test_specific_moment_cta_label_falls_back_when_no_signal():
    label = specific_moment_cta_label({}, language="en")
    assert label == "Watch this coaching moment"


def test_specific_moment_cta_label_returns_hebrew_for_he_language():
    label = specific_moment_cta_label({"phase": "transition"}, language="he")
    assert any("֐" <= c <= "׿" for c in label)


def test_hebrew_navigator_review_pending_has_no_record_href():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good", "language": "he"},
        assessment=_allowed_assessment(analysis_quality={
            "teacher_feedback_allowed": False,
            "evidence_sufficient": False,
            "quality_reasons": ["no_usable_moments"],
        }),
        video=_allowed_video(),
        language="he",
    )
    nav = artifact["navigator"]
    assert nav["type"] == "review_pending"
    assert nav["disabled"] is True
    assert nav["href"] is None
    # No misleading English review-pending sentence in the Hebrew artifact.
    assert "a coach will continue from here" not in str(artifact).lower()
    # Empty-state title is Hebrew.
    title = artifact["empty_state"]["title"]
    assert any("֐" <= c <= "׿" for c in title)


def test_hebrew_navigator_upload_required_has_hebrew_label_and_record_href():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good", "language": "he"},
        assessment=None,
        language="he",
    )
    nav = artifact["navigator"]
    assert nav["type"] == "upload_required"
    assert nav["href"] == "/record"
    assert any("֐" <= c <= "׿" for c in nav["cta_label"])


# ---------------------------------------------------------------------------
# Negative assertion across artifacts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario", [
    {"name": "admin_hidden", "kwargs": {"admin_review": {"status": "admin_hidden"}}},
    {"name": "revision_requested", "kwargs": {"admin_review": {"status": "revision_requested"}}},
    {"name": "evidence_insufficient", "kwargs": {"assessment_overrides": {"analysis_quality": {
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "quality_reasons": ["no_usable_moments"],
    }}}},
])
def test_review_pending_states_never_contain_a_coach_will_continue(scenario):
    overrides = scenario.get("kwargs", {})
    assessment = _allowed_assessment(**(overrides.get("assessment_overrides") or {}))
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=assessment,
        video=_allowed_video(),
        admin_review=overrides.get("admin_review"),
    )
    serialized = str(artifact).lower()
    assert "a coach will continue from here" not in serialized
    assert "/record" not in serialized
