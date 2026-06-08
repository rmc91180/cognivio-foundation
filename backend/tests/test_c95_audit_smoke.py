"""PR C9.5 audit + smoke tests — privacy-policy truth, playback clearance,
override audit completeness, and corrective-action availability (contracts
A/B/D/E).

Covers:

- ``scripts.audit_video_processing_pipeline._scan_privacy_policy_truth``
- ``scripts.audit_video_processing_pipeline._scan_privacy_overrides_audit``
- ``scripts.audit_video_processing_pipeline._scan_corrective_actions``
- ``scripts.run_pilot_smoke_checks.check_privacy_policy_truth``
- ``scripts.run_pilot_smoke_checks.check_privacy_override_audit_complete``
- ``scripts.run_pilot_smoke_checks.check_corrective_actions_available``
"""

from __future__ import annotations

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import types
from datetime import datetime, timedelta, timezone

from app.services.privacy_policy import (
    build_effective_privacy_policy,
    evaluate_privacy_readiness,
    override_is_active,
    teacher_playback_policy_allows,
)
from app.services.video_actions import build_video_action_states
from app.services.video_assets import select_playback_asset
from scripts.audit_video_processing_pipeline import (
    _scan_corrective_actions,
    _scan_privacy_overrides_audit,
    _scan_privacy_policy_truth,
)
from scripts.run_pilot_smoke_checks import (
    check_corrective_actions_available,
    check_privacy_override_audit_complete,
    check_privacy_policy_truth,
)


# --------------------------------------------------------------------------- #
# Async fake collection / cursor (mirrors the C9.4 audit harness).
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


def _iso(delta_hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


def _verified_completed_video(**overrides):
    """A privacy-completed redacted video that passes both validations."""
    video = {
        "id": "video-ok",
        "teacher_id": "teacher-1",
        "privacy_status": "completed",
        "redacted_file_path": "redacted-videos/video-ok.mp4",
        "visual_redaction_validation": {"status": "passed"},
        "redacted_playback_validation": {"status": "passed"},
    }
    video.update(overrides)
    return video


# --------------------------------------------------------------------------- #
# Audit: _scan_privacy_policy_truth (contracts A/B/E)
# --------------------------------------------------------------------------- #
class TestScanPrivacyPolicyTruth:
    def _run(self, videos, overrides=None):
        db = types.SimpleNamespace(videos=_Collection(videos))
        return asyncio.run(
            _scan_privacy_policy_truth(
                db,
                build_effective_privacy_policy=build_effective_privacy_policy,
                evaluate_privacy_readiness=evaluate_privacy_readiness,
                teacher_playback_policy_allows=teacher_playback_policy_allows,
                select_playback_asset=select_playback_asset,
                active_overrides=list(overrides or []),
                limit=50,
                teacher_id=None,
            )
        )

    def test_blur_disabled_without_override_flagged(self) -> None:
        issues = self._run(
            [{"id": "v1", "teacher_id": "t1", "destructive_blurring_enabled": False}]
        )
        codes = {i["issue_code"] for i in issues}
        assert "privacy_blur_disabled_without_audited_override" in codes

    def test_blur_disabled_with_audited_override_is_clean(self) -> None:
        override = {
            "id": "ov1",
            "scope": "video",
            "scope_id": "v2",
            "face_blurring_required": False,
            "reason": "School consented to unblurred archival",
            "created_by": "admin-1",
            "created_at": _iso(-1),
            "is_active": True,
        }
        issues = self._run(
            [{"id": "v2", "teacher_id": "t1", "destructive_blurring_enabled": False}],
            overrides=[override],
        )
        codes = {i["issue_code"] for i in issues}
        assert "privacy_blur_disabled_without_audited_override" not in codes

    def test_completed_without_validation_is_not_ready_and_unclear_playback(self) -> None:
        # privacy completed + redacted asset present (http URL) but NO validation
        # records → readiness denies AND select_playback_asset still serves the
        # redacted url, so the audit must flag the unverified-but-served hole.
        # NOTE: post-A1 Edit 6 a /uploads path-only redacted is no longer served;
        # the hole remains real for http-URL assets, which this fixture exercises
        # (the gateway closes it at serve time, but this audits the raw selector).
        issues = self._run(
            [
                {
                    "id": "v3",
                    "teacher_id": "t1",
                    "privacy_status": "completed",
                    "redacted_file_url": "https://cdn.example.com/redacted-v3.mp4",
                    "redacted_asset_state": "stored",
                    "redacted_file_path": "redacted-videos/v3.mp4",
                }
            ]
        )
        codes = {i["issue_code"] for i in issues}
        assert "privacy_completed_but_readiness_unverified" in codes
        assert "teacher_playback_served_without_policy_clearance" in codes

    def test_verified_completed_video_is_clean(self) -> None:
        issues = self._run([_verified_completed_video()])
        assert issues == []


# --------------------------------------------------------------------------- #
# Audit: _scan_privacy_overrides_audit (contract E)
# --------------------------------------------------------------------------- #
class TestScanPrivacyOverridesAudit:
    def _run(self, overrides):
        db = types.SimpleNamespace(privacy_policy_overrides=_Collection(overrides))
        return asyncio.run(
            _scan_privacy_overrides_audit(db, override_is_active=override_is_active, limit=50)
        )

    def test_missing_reason_flagged(self) -> None:
        issues = self._run(
            [
                {
                    "id": "ov-bad",
                    "scope": "video",
                    "scope_id": "v1",
                    "created_by": "admin-1",
                    "created_at": _iso(-1),
                    "is_active": True,
                    # reason missing
                }
            ]
        )
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "privacy_override_missing_audit_fields"
        assert "reason" in issues[0]["missing_fields"]

    def test_missing_actor_flagged(self) -> None:
        issues = self._run(
            [
                {
                    "id": "ov-noactor",
                    "scope": "teacher",
                    "scope_id": "t1",
                    "reason": "consent on file",
                    "created_at": _iso(-1),
                    "is_active": True,
                    # no created_by / actor_id
                }
            ]
        )
        assert issues[0]["issue_code"] == "privacy_override_missing_audit_fields"
        assert "actor" in issues[0]["missing_fields"]

    def test_expired_but_active_flagged(self) -> None:
        issues = self._run(
            [
                {
                    "id": "ov-stale",
                    "scope": "video",
                    "scope_id": "v1",
                    "reason": "temporary grant",
                    "created_by": "admin-1",
                    "created_at": _iso(-48),
                    "expires_at": _iso(-1),  # already expired
                    "is_active": True,
                }
            ]
        )
        codes = {i["issue_code"] for i in issues}
        assert "privacy_override_expired_but_active" in codes

    def test_complete_active_override_is_clean(self) -> None:
        issues = self._run(
            [
                {
                    "id": "ov-good",
                    "scope": "video",
                    "scope_id": "v1",
                    "reason": "audited consent",
                    "created_by": "admin-1",
                    "created_at": _iso(-1),
                    "expires_at": _iso(48),
                    "is_active": True,
                }
            ]
        )
        assert issues == []


# --------------------------------------------------------------------------- #
# Audit: _scan_corrective_actions (contract D)
# --------------------------------------------------------------------------- #
class TestScanCorrectiveActions:
    def _run(self, videos):
        db = types.SimpleNamespace(videos=_Collection(videos))
        return asyncio.run(
            _scan_corrective_actions(
                db, build_video_action_states=build_video_action_states, limit=50, teacher_id=None
            )
        )

    def test_failed_video_without_source_is_dead_end(self) -> None:
        issues = self._run(
            [{"id": "v1", "teacher_id": "t1", "privacy_status": "failed"}]
        )
        assert len(issues) == 1
        assert issues[0]["issue_code"] == "blocked_video_without_eligible_action"

    def test_failed_privacy_with_local_source_can_retry(self) -> None:
        # A local source + failed privacy → retry_privacy is eligible → not stuck.
        issues = self._run(
            [
                {
                    "id": "v2",
                    "teacher_id": "t1",
                    "privacy_status": "failed",
                    "raw_file_path": "raw-videos/v2.mp4",
                }
            ]
        )
        assert issues == []

    def test_healthy_video_not_scanned(self) -> None:
        issues = self._run(
            [{"id": "v3", "teacher_id": "t1", "privacy_status": "completed", "status": "completed"}]
        )
        assert issues == []


# --------------------------------------------------------------------------- #
# Smoke: check_privacy_policy_truth
# --------------------------------------------------------------------------- #
class TestSmokePrivacyPolicyTruth:
    def test_blur_disabled_without_override_is_fail(self) -> None:
        result = check_privacy_policy_truth(
            [{"id": "v1", "destructive_blurring_enabled": False}], []
        )
        assert result.status == "fail"
        assert result.code == "privacy_policy_truth"

    def test_completed_without_validation_is_warn(self) -> None:
        result = check_privacy_policy_truth(
            [
                {
                    "id": "v2",
                    "privacy_status": "completed",
                    # no redacted asset, no validation → not ready, no playback url
                }
            ],
            [],
        )
        assert result.status == "warn"

    def test_verified_video_is_ok(self) -> None:
        result = check_privacy_policy_truth([_verified_completed_video()], [])
        assert result.status == "ok"


# --------------------------------------------------------------------------- #
# Smoke: check_privacy_override_audit_complete
# --------------------------------------------------------------------------- #
class TestSmokeOverrideAuditComplete:
    def test_incomplete_override_is_fail(self) -> None:
        result = check_privacy_override_audit_complete(
            [{"id": "ov", "scope": "video", "scope_id": "v1", "is_active": True}]
        )
        assert result.status == "fail"

    def test_no_overrides_is_ok(self) -> None:
        result = check_privacy_override_audit_complete([])
        assert result.status == "ok"

    def test_complete_override_is_ok(self) -> None:
        result = check_privacy_override_audit_complete(
            [
                {
                    "id": "ov",
                    "scope": "video",
                    "scope_id": "v1",
                    "reason": "audited",
                    "created_by": "admin-1",
                    "created_at": _iso(-1),
                    "expires_at": _iso(48),
                    "is_active": True,
                }
            ]
        )
        assert result.status == "ok"


# --------------------------------------------------------------------------- #
# Smoke: check_corrective_actions_available
# --------------------------------------------------------------------------- #
class TestSmokeCorrectiveActions:
    def test_dead_end_video_is_fail(self) -> None:
        result = check_corrective_actions_available(
            [{"id": "v1", "privacy_status": "failed"}]
        )
        assert result.status == "fail"
        assert result.code == "corrective_actions_available"

    def test_retryable_failed_video_is_ok(self) -> None:
        result = check_corrective_actions_available(
            [{"id": "v2", "privacy_status": "failed", "raw_file_path": "raw/v2.mp4"}]
        )
        assert result.status == "ok"

    def test_no_failed_videos_is_ok(self) -> None:
        result = check_corrective_actions_available(
            [{"id": "v3", "privacy_status": "completed", "status": "completed"}]
        )
        assert result.status == "ok"
