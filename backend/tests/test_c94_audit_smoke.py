"""PR C9.4 audit + smoke + server-gate tests.

Covers the new fail-closed checks that surface privacy-completed-but-unverified
redaction and released-but-blocked feedback:

- ``scripts.audit_video_processing_pipeline._scan_visual_redaction``
- ``scripts.audit_video_processing_pipeline._scan_feedback_release_consistency``
- ``scripts.run_pilot_smoke_checks.check_visual_redaction_validation_present``
- ``scripts.run_pilot_smoke_checks.check_teacher_feedback_view_consistency``
- ``server._visual_redaction_verified`` / ``server._redacted_playback_ready``
"""

from __future__ import annotations

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import types

import pytest

import server
from scripts.audit_video_processing_pipeline import (
    _scan_feedback_release_consistency,
    _scan_visual_redaction,
)
from scripts.run_pilot_smoke_checks import (
    check_teacher_feedback_view_consistency,
    check_visual_redaction_validation_present,
)


# --------------------------------------------------------------------------- #
# Async fake collection / cursor for the audit scans.
# --------------------------------------------------------------------------- #
class _LimitCursor:
    def __init__(self, docs):
        self._docs = list(docs)
        self._i = 0

    def limit(self, n):
        return _LimitCursor(self._docs[: int(n)])

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i >= len(self._docs):
            raise StopAsyncIteration
        doc = self._docs[self._i]
        self._i += 1
        return doc


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        matched = [dict(d) for d in self.docs if self._matches(d, query)]
        return _LimitCursor(matched)

    @staticmethod
    def _matches(doc, query):
        for key, expected in query.items():
            if doc.get(key) != expected:
                return False
        return True


def _completed_redacted_video(**overrides):
    video = {
        "id": "video-1",
        "teacher_id": "teacher-1",
        "privacy_status": "completed",
        "redacted_file_path": "/uploads/redacted-videos/video-1.mp4",
    }
    video.update(overrides)
    return video


# --------------------------------------------------------------------------- #
# Audit: _scan_visual_redaction
# --------------------------------------------------------------------------- #
class TestScanVisualRedaction:
    def _run(self, videos):
        db = types.SimpleNamespace(videos=_Collection(videos))
        return asyncio.run(_scan_visual_redaction(db, limit=50, teacher_id=None))

    def test_missing_record_flagged(self) -> None:
        issues = self._run([_completed_redacted_video()])
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "visual_redaction_validation_missing"
        assert issues[0]["video_id"] == "video-1"

    def test_failed_record_flagged(self) -> None:
        issues = self._run(
            [
                _completed_redacted_video(
                    visual_redaction_validation={
                        "status": "failed",
                        "failure_code": "unblurred_face_detected",
                    }
                )
            ]
        )
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "visual_redaction_failed_but_privacy_completed"
        assert issues[0]["failure_code"] == "unblurred_face_detected"

    def test_skipped_record_is_inconclusive(self) -> None:
        issues = self._run(
            [
                _completed_redacted_video(
                    visual_redaction_validation={
                        "status": "skipped_unavailable",
                        "failure_code": "cv2_unavailable",
                    }
                )
            ]
        )
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "visual_redaction_inconclusive_but_privacy_completed"

    def test_passed_record_is_clean(self) -> None:
        issues = self._run(
            [_completed_redacted_video(visual_redaction_validation={"status": "passed"})]
        )
        assert issues == []

    def test_privacy_not_completed_is_skipped(self) -> None:
        issues = self._run([_completed_redacted_video(privacy_status="processing")])
        assert issues == []

    def test_no_redacted_asset_is_skipped(self) -> None:
        issues = self._run(
            [{"id": "video-2", "teacher_id": "teacher-1", "privacy_status": "completed"}]
        )
        assert issues == []


# --------------------------------------------------------------------------- #
# Audit: _scan_feedback_release_consistency
# --------------------------------------------------------------------------- #
class TestScanFeedbackReleaseConsistency:
    def _run(self, assessments):
        db = types.SimpleNamespace(assessments=_Collection(assessments))
        return asyncio.run(
            _scan_feedback_release_consistency(db, limit=50, teacher_id=None)
        )

    def test_released_but_safety_blocked_flagged(self) -> None:
        issues = self._run(
            [
                {
                    "id": "assessment-1",
                    "teacher_id": "teacher-1",
                    "video_id": "video-1",
                    "feedback_release_status": "released",
                    "analysis_quality": {
                        "teacher_feedback_allowed": False,
                        "block_reason": "unsafe_text",
                    },
                }
            ]
        )
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "feedback_released_but_safety_blocked"
        assert issues[0]["assessment_id"] == "assessment-1"

    def test_released_and_allowed_is_clean(self) -> None:
        issues = self._run(
            [
                {
                    "id": "assessment-2",
                    "feedback_release_status": "released",
                    "analysis_quality": {"teacher_feedback_allowed": True},
                }
            ]
        )
        assert issues == []

    def test_unreleased_assessment_ignored(self) -> None:
        issues = self._run(
            [
                {
                    "id": "assessment-3",
                    "feedback_release_status": "blocked",
                    "analysis_quality": {"teacher_feedback_allowed": False},
                }
            ]
        )
        assert issues == []


# --------------------------------------------------------------------------- #
# Smoke: check_visual_redaction_validation_present
# --------------------------------------------------------------------------- #
class TestSmokeVisualRedactionCheck:
    def test_failed_validation_is_fail(self) -> None:
        result = check_visual_redaction_validation_present(
            [
                _completed_redacted_video(
                    visual_redaction_validation={
                        "status": "failed",
                        "failure_code": "unblurred_face_detected",
                    }
                )
            ]
        )
        assert result.status == "fail"
        assert result.code == "visual_redaction_validation_present"

    def test_missing_validation_is_warn(self) -> None:
        result = check_visual_redaction_validation_present([_completed_redacted_video()])
        assert result.status == "warn"

    def test_passed_validation_is_ok(self) -> None:
        result = check_visual_redaction_validation_present(
            [_completed_redacted_video(visual_redaction_validation={"status": "passed"})]
        )
        assert result.status == "ok"


# --------------------------------------------------------------------------- #
# Smoke: check_teacher_feedback_view_consistency
# --------------------------------------------------------------------------- #
class TestSmokeFeedbackViewConsistency:
    def test_blocked_artifact_with_copy_is_ok(self) -> None:
        artifact = {"teacher_feedback_allowed": False, "blocked_reason": "evidence_insufficient"}
        result = check_teacher_feedback_view_consistency(artifact, {})
        assert result.status == "ok"
        assert result.code == "teacher_feedback_view_consistency"

    def test_allowed_released_is_ok_and_available(self) -> None:
        artifact = {
            "teacher_feedback_allowed": True,
            "summary": {"opening": "Nice wait time."},
            "action_items": [{"title": "Invite a second voice"}],
        }
        result = check_teacher_feedback_view_consistency(
            artifact, {"feedback_release_status": "released"}
        )
        assert result.status == "ok"

    def test_released_but_safety_blocked_warns(self) -> None:
        artifact = {"teacher_feedback_allowed": False, "blocked_reason": "unsafe_text"}
        result = check_teacher_feedback_view_consistency(
            artifact, {"feedback_release_status": "released"}
        )
        assert result.status == "warn"


# --------------------------------------------------------------------------- #
# Server gate helpers (PR C9.3 + C9.4 combined playback readiness)
# --------------------------------------------------------------------------- #
class TestServerVisualRedactionGate:
    def test_verified_only_when_status_passed(self) -> None:
        assert server._visual_redaction_verified(
            {"visual_redaction_validation": {"status": "passed"}}
        )
        assert not server._visual_redaction_verified(
            {"visual_redaction_validation": {"status": "failed"}}
        )
        assert not server._visual_redaction_verified(
            {"visual_redaction_validation": {"status": "skipped_unavailable"}}
        )
        assert not server._visual_redaction_verified({})

    def test_playback_ready_requires_both_gates(self) -> None:
        # Both gates passed → ready.
        ready = {
            "redacted_playback_validation": {"status": "passed"},
            "visual_redaction_validation": {"status": "passed"},
        }
        assert server._redacted_playback_ready(ready)

        # Browser-playable but visual redaction not verified → NOT ready.
        codec_only = {
            "redacted_playback_validation": {"status": "passed"},
            "visual_redaction_validation": {"status": "failed"},
        }
        assert not server._redacted_playback_ready(codec_only)

        # Visually verified but not browser-playable → NOT ready.
        visual_only = {
            "redacted_playback_validation": {"status": "failed"},
            "visual_redaction_validation": {"status": "passed"},
        }
        assert not server._redacted_playback_ready(visual_only)

        # Missing both records → NOT ready (fail-closed).
        assert not server._redacted_playback_ready({})
