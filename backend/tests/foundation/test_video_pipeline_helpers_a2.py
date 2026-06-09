"""A2 — Replica-safe privacy-job input resolution (foundation).

Proves the consume-path cross-replica race closure in
``server._run_video_privacy_job``: a job enqueued by ANOTHER replica carries an
absolute ``file_path`` that does not exist on THIS replica's disk. The worker
must resolve its input for this replica via ``STORAGE_GATEWAY.localize`` (reuse a
local copy by relative path if present, else download by ``s3_key`` from the
object store) from the canonical video doc — not blindly trust the foreign
absolute path and FileNotFound.

Runs fully offline: real gateway over the ``mock`` backend (no disk/network),
an in-memory fake ``db``, and ``import server`` (the established foundation
convention; boto3 is a real dev dep so the import is clean).
"""

from __future__ import annotations

from pathlib import Path

import pytest

import server


def _async_return(value):
    async def _coro(*a, **k):
        return value
    return _coro()


@pytest.mark.asyncio
async def test_run_video_privacy_job_localizes_from_object_store_cross_replica(monkeypatch, tmp_path):
    """A2: a job enqueued by another replica carries an absolute file_path that
    does not exist on THIS replica's disk. The worker must resolve its input via
    STORAGE_GATEWAY.localize (download by s3_key from R2) instead of FileNotFound."""
    import types as _types
    from app.services.storage_gateway import build_gateway

    video_id = "video_a2"
    teacher_id = "teacher_a2"
    user_id = "user_a2"
    s3_key = "uploads/videos/processed/teacher_a2/video_a2.mp4"
    relative_path = "processed/teacher_a2/video_a2.mp4"
    # The path the (other) enqueuing replica wrote — guaranteed absent here.
    foreign_abs_path = str(tmp_path / "other_replica_disk" / "video_a2.mp4")

    scratch = tmp_path / "uploads"
    scratch.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "UPLOAD_DIR", scratch, raising=False)

    # Real gateway, mock backend; seed the object as if it lives in R2.
    gateway = build_gateway(
        _types.SimpleNamespace(storage_backend="mock", upload_dir=scratch,
                               backend_public_base_url="https://api.example.com",
                               s3_bucket="", s3_region="", s3_endpoint="",
                               s3_public_base_url="", aws_access_key_id="",
                               aws_secret_access_key=""),
    )
    gateway.backend.objects[s3_key] = b"mock-video-bytes"
    monkeypatch.setattr(server, "STORAGE_GATEWAY", gateway, raising=False)

    job_doc = {
        "video_id": video_id, "teacher_id": teacher_id, "user_id": user_id,
        "file_path": foreign_abs_path, "status": server.PrivacyProcessingStatus.QUEUED.value,
        "attempts": 0,
    }
    video_doc = {
        "id": video_id, "teacher_id": teacher_id, "uploaded_by": user_id,
        "processed_file_path": relative_path, "processed_s3_key": s3_key,
        "privacy_manual_override": None,
    }

    localized_inputs = []

    def _fake_analyze(input_path, *a, **k):
        localized_inputs.append(input_path)
        return {"frames_analyzed": 1, "teacher_track_id": None, "review_reason": None,
                "candidate_tracks": [], "fallback_mode": "blur_all", "manifest_tracks": [],
                "runtime_fallback": None}

    def _fake_render(input_path, out_path, thumb_path, *a, **k):
        localized_inputs.append(input_path)
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(b"redacted")
        Path(thumb_path).parent.mkdir(parents=True, exist_ok=True)
        Path(thumb_path).write_bytes(b"thumb")
        return {"frames": 1}

    monkeypatch.setattr(server, "analyze_video_privacy", _fake_analyze, raising=False)
    monkeypatch.setattr(server, "render_redacted_video", _fake_render, raising=False)
    monkeypatch.setattr(server, "materialize_privacy_references",
                        lambda *a, **k: _types.SimpleNamespace(
                            usable_local_paths=lambda: ["/tmp/ref.jpg"],
                            failure_codes=[], usable_count=1, usable=[], total=1, notes=[]),
                        raising=False)

    class _Coll:
        def __init__(self, doc=None): self._doc = doc; self.updates = []
        async def find_one(self, *a, **k): return dict(self._doc) if self._doc else None
        async def update_one(self, flt, upd, **k):
            self.updates.append((flt, upd))
            class _R: modified_count = 1
            return _R()
        async def update_many(self, *a, **k):
            class _R: modified_count = 0
            return _R()
        def find(self, *a, **k):
            class _C:
                async def to_list(self, *_a, **_k): return []
            return _C()

    fake_db = _types.SimpleNamespace(
        video_privacy_jobs=_Coll(job_doc),
        videos=_Coll(video_doc),
        teacher_face_references=_Coll(None),
        video_evidence=_Coll(None),
    )
    monkeypatch.setattr(server, "db", fake_db, raising=False)
    monkeypatch.setattr(server, "_require_canonical_video_source",
                        lambda *a, **k: _async_return(dict(video_doc)), raising=False)
    monkeypatch.setattr(server, "_log_privacy_audit_event",
                        lambda *a, **k: _async_return(None), raising=False)
    # Minimal added stub (beyond the task scaffold): _run_video_privacy_job records
    # a source-chain incident on its FAILED branch / except handler, which would
    # otherwise hit a collection absent from the fake db. No-op it.
    monkeypatch.setattr(server, "_record_video_source_chain_incident",
                        lambda *a, **k: _async_return(None), raising=False)

    await server._run_video_privacy_job(video_id)

    # The race-closing assertion: the worker ran against a localized path under
    # the gateway scratch _gw_cache (downloaded from the object store), NOT the
    # foreign absolute path the other replica wrote.
    assert localized_inputs, "worker never reached the analyze/render stage"
    for p in localized_inputs:
        assert p != foreign_abs_path
        assert "_gw_cache" in p.replace("\\", "/")
        assert s3_key in p.replace("\\", "/")


@pytest.mark.asyncio
async def test_run_video_privacy_job_fails_closed_when_input_unavailable(monkeypatch, tmp_path):
    """A2 fail-closed: when neither a local copy nor the R2 object exists, the
    worker must NOT run analyze/render against a missing path. It raises the
    structured video_input_unavailable error (routed to the worker's existing
    failure handling) rather than letting a raw FileNotFound escape mid-pipeline."""
    import types as _types
    from app.services.storage_gateway import build_gateway

    video_id = "video_a2_missing"
    teacher_id = "teacher_a2"
    user_id = "user_a2"
    # Object NOT seeded into the mock backend → R2 download will fail-closed.
    s3_key = "uploads/videos/processed/teacher_a2/video_a2_missing.mp4"
    relative_path = "processed/teacher_a2/video_a2_missing.mp4"
    foreign_abs_path = str(tmp_path / "other_replica_disk" / "video_a2_missing.mp4")

    scratch = tmp_path / "uploads"
    scratch.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "UPLOAD_DIR", scratch, raising=False)

    gateway = build_gateway(
        _types.SimpleNamespace(storage_backend="mock", upload_dir=scratch,
                               backend_public_base_url="https://api.example.com",
                               s3_bucket="", s3_region="", s3_endpoint="",
                               s3_public_base_url="", aws_access_key_id="",
                               aws_secret_access_key=""),
    )
    # Intentionally do NOT seed gateway.backend.objects[s3_key].
    monkeypatch.setattr(server, "STORAGE_GATEWAY", gateway, raising=False)

    job_doc = {
        "video_id": video_id, "teacher_id": teacher_id, "user_id": user_id,
        "file_path": foreign_abs_path, "status": server.PrivacyProcessingStatus.QUEUED.value,
        "attempts": 0,
    }
    video_doc = {
        "id": video_id, "teacher_id": teacher_id, "uploaded_by": user_id,
        "processed_file_path": relative_path, "processed_s3_key": s3_key,
        "privacy_manual_override": None,
    }

    ran_stages = []

    def _must_not_run(input_path, *a, **k):
        ran_stages.append(input_path)
        raise AssertionError("analyze/render reached with unavailable input")

    monkeypatch.setattr(server, "analyze_video_privacy", _must_not_run, raising=False)
    monkeypatch.setattr(server, "render_redacted_video", _must_not_run, raising=False)
    monkeypatch.setattr(server, "_render_degraded_privacy_assets", _must_not_run, raising=False)
    monkeypatch.setattr(server, "materialize_privacy_references",
                        lambda *a, **k: _types.SimpleNamespace(
                            usable_local_paths=lambda: ["/tmp/ref.jpg"],
                            failure_codes=[], usable_count=1, usable=[], total=1, notes=[]),
                        raising=False)

    class _Coll:
        def __init__(self, doc=None): self._doc = doc; self.updates = []
        async def find_one(self, *a, **k): return dict(self._doc) if self._doc else None
        async def update_one(self, flt, upd, **k):
            self.updates.append((flt, upd))
            class _R: modified_count = 1
            return _R()
        async def update_many(self, *a, **k):
            class _R: modified_count = 0
            return _R()
        def find(self, *a, **k):
            class _C:
                async def to_list(self, *_a, **_k): return []
            return _C()

    jobs_coll = _Coll(job_doc)
    fake_db = _types.SimpleNamespace(
        video_privacy_jobs=jobs_coll,
        videos=_Coll(video_doc),
        teacher_face_references=_Coll(None),
        video_evidence=_Coll(None),
    )
    monkeypatch.setattr(server, "db", fake_db, raising=False)
    monkeypatch.setattr(server, "_require_canonical_video_source",
                        lambda *a, **k: _async_return(dict(video_doc)), raising=False)
    monkeypatch.setattr(server, "_log_privacy_audit_event",
                        lambda *a, **k: _async_return(None), raising=False)
    monkeypatch.setattr(server, "_record_video_source_chain_incident",
                        lambda *a, **k: _async_return(None), raising=False)

    # The worker catches the RuntimeError internally and records FAILED; it must
    # NOT propagate a raw FileNotFound and must NOT reach analyze/render. Whether
    # _run_video_privacy_job re-raises or swallows-and-records depends on the
    # existing failure handling — accept either, but the hard guarantees below
    # must hold.
    try:
        await server._run_video_privacy_job(video_id)
    except RuntimeError as exc:
        assert "video_input_unavailable" in str(exc)
    except FileNotFoundError:
        raise AssertionError("raw FileNotFoundError escaped — fail-closed contract broken")

    # Hard guarantees:
    assert not ran_stages, "analyze/render must never run on unavailable input"
    # The job must have been moved off QUEUED into a terminal/failed state by the
    # worker's failure handling (a status-bearing update_one fired).
    status_writes = [
        upd for (_flt, upd) in jobs_coll.updates
        if isinstance(upd, dict) and "$set" in upd and "status" in upd["$set"]
    ]
    assert status_writes, "no terminal status write recorded for the failed job"
