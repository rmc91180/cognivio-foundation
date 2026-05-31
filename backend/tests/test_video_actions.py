"""PR C9.5 PART 3 — corrective-action availability (contract D).

Locks the eligibility predicates that drive the teacher/admin Retry controls so a
button the UI renders as enabled is one the live endpoint will actually accept,
and a disabled button always carries a specific machine-readable reason.
"""

from __future__ import annotations

from app.services.video_actions import (
    ACTION_RETRY_ANALYSIS,
    ACTION_RETRY_FEEDBACK_PROJECTION,
    ACTION_RETRY_PRIVACY,
    ACTION_RUN_AUDIO_ANALYSIS,
    REASON_ANALYSIS_ALREADY_COMPLETE,
    REASON_ANALYSIS_IN_PROGRESS,
    REASON_ANALYSIS_NOT_COMPLETE,
    REASON_ANALYSIS_NOT_FAILED,
    REASON_AUDIO_DISABLED,
    REASON_AUDIO_IN_PROGRESS,
    REASON_NO_LOCAL_SOURCE,
    REASON_PRIVACY_IN_PROGRESS,
    REASON_PRIVACY_NOT_COMPLETE,
    build_retry_analysis_state,
    build_retry_feedback_projection_state,
    build_retry_privacy_state,
    build_run_audio_analysis_state,
    build_video_action_states,
)


def _video(**overrides):
    base = {
        "id": "v1",
        "status": "failed",
        "analysis_status": "failed",
        "privacy_status": "completed",
        "processed_file_path": "processed/teacher/v1.mp4",
    }
    base.update(overrides)
    return base


class TestRetryPrivacyState:
    def test_eligible_when_source_present_and_idle(self):
        state = build_retry_privacy_state(_video(privacy_status="failed"))
        assert state["action"] == ACTION_RETRY_PRIVACY
        assert state["eligible"] is True
        assert state["disabled_reason"] is None
        # Retry-privacy always advertises the provably-safe full-frame option.
        assert state["supports_full_frame"] is True

    def test_eligible_when_privacy_completed(self):
        # Re-running redaction on a completed video is allowed (e.g. re-blur).
        state = build_retry_privacy_state(_video(privacy_status="completed"))
        assert state["eligible"] is True

    def test_disabled_without_local_source(self):
        video = _video(privacy_status="failed")
        for field in ("processed_file_path", "raw_file_path", "file_path", "redacted_file_path"):
            video.pop(field, None)
        state = build_retry_privacy_state(video)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_NO_LOCAL_SOURCE

    def test_disabled_while_privacy_queued(self):
        state = build_retry_privacy_state(_video(privacy_status="queued"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_PRIVACY_IN_PROGRESS

    def test_disabled_while_privacy_processing(self):
        state = build_retry_privacy_state(_video(privacy_status="processing"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_PRIVACY_IN_PROGRESS

    def test_source_check_accepts_raw_or_redacted_path(self):
        video = _video(privacy_status="failed")
        video.pop("processed_file_path")
        video["redacted_file_path"] = "redacted/t/v1.mp4"
        assert build_retry_privacy_state(video)["eligible"] is True


class TestRetryAnalysisState:
    def test_eligible_when_failed_and_privacy_complete(self):
        state = build_retry_analysis_state(_video(status="failed", privacy_status="completed"))
        assert state["action"] == ACTION_RETRY_ANALYSIS
        assert state["eligible"] is True
        assert state["disabled_reason"] is None

    def test_disabled_without_local_source(self):
        video = _video(status="failed")
        for field in ("processed_file_path", "raw_file_path", "file_path", "redacted_file_path"):
            video.pop(field, None)
        state = build_retry_analysis_state(video)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_NO_LOCAL_SOURCE

    def test_disabled_when_privacy_not_complete(self):
        state = build_retry_analysis_state(_video(status="failed", privacy_status="review_required"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_PRIVACY_NOT_COMPLETE

    def test_disabled_while_analysis_running(self):
        state = build_retry_analysis_state(_video(status="processing"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_ANALYSIS_IN_PROGRESS

    def test_disabled_when_already_complete(self):
        state = build_retry_analysis_state(_video(status="completed"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_ANALYSIS_ALREADY_COMPLETE

    def test_disabled_when_cancelled(self):
        state = build_retry_analysis_state(_video(status="cancelled"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_ANALYSIS_NOT_FAILED


class TestRunAudioAnalysisState:
    def test_eligible_first_run(self):
        state = build_run_audio_analysis_state(_video(privacy_status="completed"))
        assert state["action"] == ACTION_RUN_AUDIO_ANALYSIS
        assert state["eligible"] is True
        assert state["disabled_reason"] is None
        assert state["mode"] == "run"

    def test_retry_mode_after_prior_run(self):
        state = build_run_audio_analysis_state(
            _video(privacy_status="completed", audio_analysis_status="completed")
        )
        assert state["eligible"] is True
        assert state["mode"] == "retry"

    def test_disabled_when_audio_off(self):
        state = build_run_audio_analysis_state(_video(), audio_enabled=False)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_AUDIO_DISABLED

    def test_disabled_without_local_source(self):
        video = _video(privacy_status="completed")
        for field in ("processed_file_path", "raw_file_path", "file_path", "redacted_file_path"):
            video.pop(field, None)
        state = build_run_audio_analysis_state(video)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_NO_LOCAL_SOURCE

    def test_disabled_when_privacy_incomplete(self):
        state = build_run_audio_analysis_state(_video(privacy_status="processing"))
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_PRIVACY_NOT_COMPLETE

    def test_disabled_while_audio_running(self):
        state = build_run_audio_analysis_state(
            _video(privacy_status="completed", audio_analysis_status="processing")
        )
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_AUDIO_IN_PROGRESS


class TestRetryFeedbackProjectionState:
    def test_eligible_when_analysis_complete_with_assessment(self):
        video = _video(status="completed", analysis_status="completed", assessment_id="a1")
        state = build_retry_feedback_projection_state(video)
        assert state["action"] == ACTION_RETRY_FEEDBACK_PROJECTION
        assert state["eligible"] is True
        assert state["disabled_reason"] is None
        # No teacher-visible feedback yet -> first "run".
        assert state["mode"] == "run"

    def test_retry_mode_when_feedback_already_available(self):
        video = _video(status="completed", analysis_status="completed", assessment_id="a1")
        state = build_retry_feedback_projection_state(
            video, feedback_view={"feedback_available": True, "status": "ready"}
        )
        assert state["eligible"] is True
        assert state["mode"] == "retry"

    def test_disabled_without_assessment(self):
        video = _video(status="completed", analysis_status="completed")
        video.pop("assessment_id", None)
        state = build_retry_feedback_projection_state(video)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_ANALYSIS_NOT_COMPLETE

    def test_disabled_while_analysis_incomplete(self):
        video = _video(status="processing", analysis_status="processing", assessment_id="a1")
        state = build_retry_feedback_projection_state(video)
        assert state["eligible"] is False
        assert state["disabled_reason"] == REASON_ANALYSIS_NOT_COMPLETE


class TestAggregate:
    def test_build_video_action_states_keys(self):
        states = build_video_action_states(_video())
        assert set(states) == {
            ACTION_RETRY_PRIVACY,
            ACTION_RETRY_ANALYSIS,
            ACTION_RUN_AUDIO_ANALYSIS,
            ACTION_RETRY_FEEDBACK_PROJECTION,
        }
        for key, state in states.items():
            assert state["action"] == key
            assert "eligible" in state
            assert "disabled_reason" in state

    def test_audio_enabled_flag_propagates(self):
        states = build_video_action_states(_video(privacy_status="completed"), audio_enabled=False)
        assert states[ACTION_RUN_AUDIO_ANALYSIS]["eligible"] is False
        assert states[ACTION_RUN_AUDIO_ANALYSIS]["disabled_reason"] == REASON_AUDIO_DISABLED

    def test_feedback_view_flag_sets_retry_mode(self):
        states = build_video_action_states(
            _video(status="completed", analysis_status="completed", assessment_id="a1"),
            feedback_view={"feedback_available": True, "status": "ready"},
        )
        assert states[ACTION_RETRY_FEEDBACK_PROJECTION]["eligible"] is True
        assert states[ACTION_RETRY_FEEDBACK_PROJECTION]["mode"] == "retry"
