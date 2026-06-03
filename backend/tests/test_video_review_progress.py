"""Unit tests for PR C9.3 deterministic review-progress model.

These are pure (no DB, no FastAPI). They lock in the brief's rules: degraded
analysis resolves to ``completed_degraded`` (never a stuck spinner), disabled
audio is ``skipped`` (never pending), analysis is ``blocked`` until privacy
completes, and analysis-complete-without-assessment is a ``failed`` /
needs-admin inconsistency.
"""

from __future__ import annotations

import pytest

from app.services.video_review_progress import (
    REVIEW_PROGRESS_STATUSES,
    REVIEW_STAGE_KEYS,
    build_video_review_progress,
)


def _stage_status(progress, key):
    for stage in progress["stages"]:
        if stage["key"] == key:
            return stage["status"]
    raise AssertionError(f"stage {key} not present")


def _completed_video(**overrides):
    video = {
        "status": "completed",
        "transcode_status": "completed",
        "privacy_status": "completed",
        "analysis_status": "completed",
        "assessment_id": "assess-1",
        "audio_analysis_enabled": False,
        "audio_transcript_status": None,
        "feedback_release_status": "released",
        "analysis_confidence": {"overall": 80.0, "by_modality": {}, "degradation_reasons": []},
    }
    video.update(overrides)
    return video


class TestStructure:
    def test_all_stages_present_and_ordered(self) -> None:
        progress = build_video_review_progress(_completed_video())
        keys = [s["key"] for s in progress["stages"]]
        assert keys == list(REVIEW_STAGE_KEYS)

    def test_status_in_vocabulary(self) -> None:
        progress = build_video_review_progress(_completed_video())
        assert progress["status"] in REVIEW_PROGRESS_STATUSES

    def test_contract_keys_present(self) -> None:
        progress = build_video_review_progress(_completed_video())
        for key in (
            "status",
            "percent",
            "current_stage",
            "teacher_message",
            "admin_message",
            "stages",
            "retry",
            "needs_admin_attention",
            "failure_code",
        ):
            assert key in progress
        assert set(progress["retry"].keys()) == {"eligible", "action"}


class TestCompletion:
    def test_completed_review(self) -> None:
        progress = build_video_review_progress(_completed_video())
        assert progress["status"] == "completed"
        assert progress["percent"] == 100
        assert progress["retry"]["eligible"] is False
        assert _stage_status(progress, "analysis") == "completed"
        assert _stage_status(progress, "feedback") == "completed"

    def test_completed_with_assessment_object_instead_of_id(self) -> None:
        video = _completed_video(assessment_id=None)
        progress = build_video_review_progress(video, assessment={"id": "a-9"})
        assert progress["status"] == "completed"


class TestDegraded:
    def test_vision_only_mode_is_completed_degraded(self) -> None:
        video = _completed_video(
            analysis_confidence={
                "overall": 70.0,
                "by_modality": {},
                "degradation_reasons": ["vision_only_mode"],
            }
        )
        progress = build_video_review_progress(video)
        assert progress["status"] == "completed_degraded"
        assert progress["percent"] == 100
        # Degraded is NOT a stuck spinner.
        assert progress["status"] != "processing"

    def test_fallback_paid_analysis_is_completed_degraded(self) -> None:
        video = _completed_video(analysis_mode="fallback_paid_analysis_not_allowed")
        progress = build_video_review_progress(video)
        assert progress["status"] == "completed_degraded"
        assert "fallback_paid_analysis_not_allowed" in progress["degradation_reasons"]


class TestAudioStage:
    def test_audio_disabled_is_skipped_not_pending(self) -> None:
        video = _completed_video(audio_analysis_enabled=False, audio_transcript_status=None)
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "audio") == "skipped"
        # Must not promise audio review.
        assert "audio" not in progress["teacher_message"].lower()

    def test_audio_enabled_completed(self) -> None:
        video = _completed_video(
            audio_analysis_enabled=True, audio_transcript_status="completed"
        )
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "audio") == "completed"

    def test_audio_enabled_processing(self) -> None:
        video = _completed_video(
            status="processing",
            analysis_status="processing",
            assessment_id=None,
            feedback_release_status=None,
            audio_analysis_enabled=True,
            audio_transcript_status="processing",
        )
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "audio") == "processing"

    def test_audio_enabled_failed_makes_completed_degraded(self) -> None:
        video = _completed_video(
            audio_analysis_enabled=True, audio_transcript_status="failed"
        )
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "audio") == "failed"
        assert progress["status"] == "completed_degraded"


class TestPrivacyGating:
    def test_analysis_not_blocked_by_privacy(self) -> None:
        # WS1 decouple: analysis reflects its OWN state; privacy in flight must
        # NOT block it (in-flight analysis is never reported as "blocked").
        video = _completed_video(
            status="processing",
            privacy_status="processing",
            analysis_status="queued",
            assessment_id=None,
            feedback_release_status=None,
        )
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "privacy") == "processing"
        assert _stage_status(progress, "analysis") != "blocked"
        assert progress["status"] == "processing"

        # A COMPLETED analysis is reported complete even while privacy is still
        # in flight / failed (the live 5def541d case): analysis + feedback done,
        # overall not failed.
        completed = _completed_video(
            status="completed",
            privacy_status="failed",
            analysis_status="completed",
            assessment_id="assess-1",
            feedback_release_status="released",
            privacy_error="visual_redaction:unblurred_face_detected",
        )
        done = build_video_review_progress(completed)
        assert _stage_status(done, "analysis") == "completed"
        assert _stage_status(done, "feedback") == "completed"
        assert done["status"] in {"completed", "completed_degraded"}

    def test_privacy_review_required_is_blocked(self) -> None:
        video = _completed_video(
            status="processing",
            privacy_status="review_required",
            analysis_status="queued",
            assessment_id=None,
            feedback_release_status=None,
            privacy_review_reason="ambiguous_teacher_match",
        )
        progress = build_video_review_progress(video)
        assert progress["status"] == "blocked"
        assert progress["failure_code"] == "privacy_review_required"
        assert _stage_status(progress, "privacy") == "blocked"

    def test_privacy_failure_is_non_fatal_but_surfaced(self) -> None:
        # WS1 decouple: a privacy failure no longer fails the overall review.
        # It surfaces as its OWN "failed" stage (error in the stage detail) plus
        # a retry_privacy action, while analysis/feedback proceed on their own.
        video = _completed_video(
            status="completed",
            privacy_status="failed",
            analysis_status="completed",
            assessment_id="assess-1",
            feedback_release_status="released",
            privacy_error="redacted_video_not_browser_playable:unsupported_video_codec",
        )
        progress = build_video_review_progress(video)
        assert progress["status"] != "failed"
        assert _stage_status(progress, "privacy") == "failed"
        privacy_stage = next(s for s in progress["stages"] if s["key"] == "privacy")
        assert "unsupported_video_codec" in str(privacy_stage.get("detail"))
        assert progress["retry"]["eligible"] is True
        assert progress["retry"]["action"] == "retry_privacy"


class TestInconsistency:
    def test_analysis_completed_without_assessment_is_failed_needs_admin(self) -> None:
        video = _completed_video(assessment_id=None, feedback_release_status=None)
        progress = build_video_review_progress(video)
        assert progress["status"] == "failed"
        assert progress["needs_admin_attention"] is True
        assert progress["failure_code"] == "analysis_completed_without_assessment"
        assert _stage_status(progress, "analysis") == "failed"


class TestFeedback:
    def test_feedback_blocked_is_blocked(self) -> None:
        video = _completed_video(feedback_release_status="blocked")
        progress = build_video_review_progress(video)
        assert progress["status"] == "blocked"
        assert progress["failure_code"] == "feedback_pending_review"
        assert _stage_status(progress, "feedback") == "blocked"

    def test_feedback_human_review_required_flag_blocks(self) -> None:
        video = _completed_video(
            feedback_release_status=None, feedback_human_review_required=True
        )
        progress = build_video_review_progress(video)
        assert progress["status"] == "blocked"


class TestProcessing:
    def test_analysis_in_progress(self) -> None:
        video = _completed_video(
            status="processing",
            analysis_status="processing",
            assessment_id=None,
            feedback_release_status=None,
        )
        progress = build_video_review_progress(video)
        assert progress["status"] == "processing"
        assert progress["current_stage"] == "analysis"
        assert 0 < progress["percent"] < 100

    def test_transcode_in_progress(self) -> None:
        video = _completed_video(
            status="processing",
            transcode_status="processing",
            privacy_status="queued",
            analysis_status="queued",
            assessment_id=None,
            feedback_release_status=None,
        )
        progress = build_video_review_progress(video)
        assert _stage_status(progress, "video_preparation") == "processing"
        assert progress["status"] == "processing"


class TestRobustness:
    def test_empty_video_does_not_crash(self) -> None:
        progress = build_video_review_progress({})
        assert progress["status"] in REVIEW_PROGRESS_STATUSES
        assert isinstance(progress["stages"], list)

    def test_none_video_does_not_crash(self) -> None:
        progress = build_video_review_progress(None)  # type: ignore[arg-type]
        assert progress["status"] in REVIEW_PROGRESS_STATUSES
