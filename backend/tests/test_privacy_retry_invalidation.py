"""PR C9.5 PART 3 — privacy retry invalidates stale redaction validations.

The dangerous failure this locks: a previous "passed" visual-redaction /
browser-playback validation must NEVER survive a privacy re-render. If it did,
the teacher-playback gate would keep serving the *old* asset's URL while a new
(possibly unblurred) render is in flight. The retry must reset both validation
records and the redacted-asset state so the gate fails closed until the new
render is re-validated — and a full-frame retry must set the worker flag.
"""

from __future__ import annotations

import asyncio
import types

import server
from app.repositories import teacher_repository, video_repository
from app.services import video_service


class TestInvalidationFields:
    def test_default_clears_validations(self):
        fields = server._privacy_retry_invalidation_fields()
        assert fields["visual_redaction_validation"] is None
        assert fields["redacted_playback_validation"] is None
        assert fields["redacted_asset_state"] == "not_created"
        assert fields["privacy_force_full_frame"] is False

    def test_force_full_frame_sets_flag(self):
        fields = server._privacy_retry_invalidation_fields(force_full_frame=True)
        assert fields["privacy_force_full_frame"] is True
        # Validations are still invalidated regardless of strategy.
        assert fields["visual_redaction_validation"] is None
        assert fields["redacted_playback_validation"] is None


def _patch_retry_dependencies(monkeypatch, tmp_path, *, video):
    """Stub the heavy worker/reference dependencies so we can drive the service.

    Writes a real source file so the ``UPLOAD_DIR / path`` existence check passes,
    and records what ``update_video_fields`` is asked to persist.
    """
    source = tmp_path / "src.mp4"
    source.write_bytes(b"video")
    video["processed_file_path"] = "src.mp4"
    monkeypatch.setattr(server, "UPLOAD_DIR", tmp_path)

    recorded = {"update": None, "enqueued": None, "audit": None}

    async def fake_find(video_id):
        return dict(video) if video_id == video["id"] else None

    async def fake_update(video_id, fields):
        recorded["update"] = (video_id, dict(fields))

    async def fake_teacher(teacher_id, current_user):
        return {"id": teacher_id, "organization_id": "org-1"}

    async def fake_refs(teacher_id, workspace_id):
        return [{"id": "ref-1", "local_path": "ok.jpg"}]

    def fake_summary(refs):
        return types.SimpleNamespace(
            usable_count=1,
            primary_failure_code=None,
            failure_codes=[],
            total=len(refs),
        )

    async def fake_enqueue(**kwargs):
        recorded["enqueued"] = kwargs

    async def fake_audit(event, target_type, target_id, **kwargs):
        recorded["audit"] = {"event": event, "target_id": target_id, **kwargs}

    monkeypatch.setattr(video_repository, "find_video_by_id", fake_find)
    monkeypatch.setattr(video_repository, "update_video_fields", fake_update)
    monkeypatch.setattr(teacher_repository, "get_teacher_or_404", fake_teacher)
    monkeypatch.setattr(server, "_list_teacher_reference_images", fake_refs)
    monkeypatch.setattr(server, "_summarize_teacher_privacy_references", fake_summary)
    monkeypatch.setattr(server, "_enqueue_video_privacy_job", fake_enqueue)
    monkeypatch.setattr(server, "_log_privacy_audit_event", fake_audit)
    return recorded


def _stale_passed_video():
    return {
        "id": "v-stale",
        "teacher_id": "teacher-1",
        "uploaded_by": "admin-1",
        "privacy_status": "completed",
        "status": "completed",
        "redacted_file_url": "https://cdn.example/redacted/v-stale.mp4",
        "redacted_asset_state": "stored",
        "visual_redaction_validation": {"status": "passed", "failure_code": None},
        "redacted_playback_validation": {"status": "passed", "failure_code": None},
    }


class TestRetryServiceInvalidation:
    def test_retry_clears_stale_passed_validations(self, monkeypatch, tmp_path):
        video = _stale_passed_video()
        recorded = _patch_retry_dependencies(monkeypatch, tmp_path, video=video)

        result = asyncio.run(
            video_service.retry_video_privacy("v-stale", {"id": "admin-1"})
        )

        assert recorded["update"] is not None
        _, fields = recorded["update"]
        # The stale "passed" validations are wiped — fail-closed until re-render.
        assert fields["visual_redaction_validation"] is None
        assert fields["redacted_playback_validation"] is None
        assert fields["redacted_asset_state"] == "not_created"
        assert fields["privacy_force_full_frame"] is False
        # Privacy is requeued and the worker job was enqueued.
        assert fields["privacy_status"] == server.PrivacyProcessingStatus.QUEUED.value
        assert recorded["enqueued"]["video_id"] == "v-stale"
        assert result["force_full_frame"] is False

    def test_retry_full_frame_sets_worker_flag_and_audits(self, monkeypatch, tmp_path):
        video = _stale_passed_video()
        recorded = _patch_retry_dependencies(monkeypatch, tmp_path, video=video)

        result = asyncio.run(
            video_service.retry_video_privacy(
                "v-stale", {"id": "admin-1"}, force_full_frame=True
            )
        )

        _, fields = recorded["update"]
        assert fields["privacy_force_full_frame"] is True
        assert result["force_full_frame"] is True
        # The audit trail records the strategy choice.
        assert recorded["audit"]["event"] == "privacy_retry_queued"
        assert recorded["audit"]["details"]["force_full_frame"] is True
