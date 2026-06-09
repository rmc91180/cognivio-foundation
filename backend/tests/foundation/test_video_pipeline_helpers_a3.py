"""A3 — Replica-safe input resolution for the video ANALYSIS worker.

Mirrors the A2 harness. Proves the same cross-replica race closure A2 gave the
privacy worker, now for ``server._run_video_job``: a job enqueued by ANOTHER
replica carries an absolute ``file_path`` that does not exist on THIS replica.
The worker must resolve its input via the shared ``_resolve_replica_local_input``
helper (reuse local copy by relative path, else download by ``s3_key`` from the
object store) from the canonical video doc — never blindly trust the foreign
absolute path, and fail-closed when bytes cannot be made local.

Runs fully offline: real ``build_gateway`` over the ``mock`` backend as the
cross-replica simulator, an in-memory fake ``db``, monkeypatched server globals.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import server


def _async_return(value):
    async def _coro(*a, **k):
        return value
    return _coro()


class _Coll:
    def __init__(self, doc=None):
        self._doc = doc
        self.updates = []

    async def find_one(self, *a, **k):
        return dict(self._doc) if self._doc else None

    async def update_one(self, flt, upd, **k):
        self.updates.append((flt, upd))
        class _R:
            modified_count = 1
        return _R()

    async def update_many(self, *a, **k):
        class _R:
            modified_count = 0
        return _R()

    def find(self, *a, **k):
        class _C:
            async def to_list(self, *_a, **_k):
                return []
        return _C()


def _build_mock_gateway(scratch):
    import types as _types
    from app.services.storage_gateway import build_gateway

    return build_gateway(
        _types.SimpleNamespace(storage_backend="mock", upload_dir=scratch,
                               backend_public_base_url="https://api.example.com",
                               s3_bucket="", s3_region="", s3_endpoint="",
                               s3_public_base_url="", aws_access_key_id="",
                               aws_secret_access_key=""),
    )


@pytest.mark.asyncio
async def test_run_video_job_localizes_from_object_store_cross_replica(monkeypatch, tmp_path):
    """A3 happy path: the job's file_path points at another replica's disk (does
    not exist here); the canonical video doc carries a valid s3_key seeded into
    the object store. The analysis worker must run analyze_video against the
    gateway-localized _gw_cache path, NOT the foreign absolute path."""
    import types as _types

    video_id = "video_a3"
    teacher_id = "teacher_a3"
    user_id = "user_a3"
    s3_key = "uploads/videos/raw/t/x.mp4"
    relative_path = "videos/t/x.mp4"
    foreign_abs_path = "/app/uploads/tmp/other-replica/does-not-exist/sample.mp4"

    scratch = tmp_path / "uploads"
    scratch.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "UPLOAD_DIR", scratch, raising=False)

    gateway = _build_mock_gateway(scratch)
    gateway.backend.objects[s3_key] = b"mock-video-bytes"
    monkeypatch.setattr(server, "STORAGE_GATEWAY", gateway, raising=False)

    job_doc = {
        "video_id": video_id, "teacher_id": teacher_id, "user_id": user_id,
        "file_path": foreign_abs_path, "retry_count": 0,
    }
    video_doc = {
        "id": video_id, "teacher_id": teacher_id, "uploaded_by": user_id,
        "raw_s3_key": s3_key, "raw_file_path": relative_path,
        "processed_s3_key": None, "processed_file_path": None, "file_path": None,
    }

    analyze_calls = []
    heartbeat_starts = []

    async def _fake_analyze(*, video_id, file_path, teacher_id, user_id, analysis_run_id=None):
        analyze_calls.append(file_path)
        return True, None

    monkeypatch.setattr(server, "analyze_video", _fake_analyze, raising=False)
    monkeypatch.setattr(server, "_claim_video_processing_job",
                        lambda *a, **k: _async_return(dict(job_doc)), raising=False)
    monkeypatch.setattr(server, "_require_canonical_video_source",
                        lambda *a, **k: _async_return(dict(video_doc)), raising=False)
    monkeypatch.setattr(server, "_write_worker_heartbeat",
                        lambda *a, **k: _async_return(None), raising=False)
    monkeypatch.setattr(server, "_record_video_source_chain_incident",
                        lambda *a, **k: _async_return(None), raising=False)

    def _track_heartbeat(*a, **k):
        heartbeat_starts.append(a)
        return _async_return(None)
    monkeypatch.setattr(server, "_heartbeat_during_job", _track_heartbeat, raising=False)

    jobs_coll = _Coll(job_doc)
    fake_db = _types.SimpleNamespace(
        video_processing_jobs=jobs_coll,
        worker_heartbeats=_Coll(None),
        videos=_Coll(video_doc),
    )
    monkeypatch.setattr(server, "db", fake_db, raising=False)

    await server._run_video_job(video_id, "test-worker")

    # analyze_video ran exactly once, against the gateway-localized object-store
    # path — NOT the foreign absolute path the other replica wrote.
    assert len(analyze_calls) == 1, f"analyze_video called {len(analyze_calls)} times"
    used = analyze_calls[0].replace("\\", "/")
    assert used != foreign_abs_path
    assert "_gw_cache" in used
    assert s3_key in used

    # The job was marked COMPLETED.
    completed = [
        upd for (_flt, upd) in jobs_coll.updates
        if isinstance(upd, dict) and "$set" in upd
        and upd["$set"].get("status") == server.VideoProcessingStatus.COMPLETED.value
    ]
    assert completed, "job was not marked COMPLETED"


@pytest.mark.asyncio
async def test_run_video_job_fails_closed_when_input_unavailable(monkeypatch, tmp_path):
    """A3 fail-closed: when neither a local copy nor the object-store key yields
    a local file, _resolve_replica_local_input raises RuntimeError before the
    heartbeat task and before analyze_video. _run_video_job does NOT catch it
    (the worker loop records the failure); analyze_video must never run and no
    COMPLETED status may be written."""
    import types as _types

    video_id = "video_a3_missing"
    teacher_id = "teacher_a3"
    user_id = "user_a3"
    # Key NOT seeded into the mock backend → download fails; relative local copy
    # absent → localize returns None → fail-closed.
    s3_key = "uploads/videos/raw/t/missing.mp4"
    relative_path = "videos/t/missing.mp4"
    foreign_abs_path = "/app/uploads/tmp/other-replica/does-not-exist/missing.mp4"

    scratch = tmp_path / "uploads"
    scratch.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "UPLOAD_DIR", scratch, raising=False)

    gateway = _build_mock_gateway(scratch)
    # Intentionally do NOT seed gateway.backend.objects[s3_key].
    monkeypatch.setattr(server, "STORAGE_GATEWAY", gateway, raising=False)

    job_doc = {
        "video_id": video_id, "teacher_id": teacher_id, "user_id": user_id,
        "file_path": foreign_abs_path, "retry_count": 0,
    }
    video_doc = {
        "id": video_id, "teacher_id": teacher_id, "uploaded_by": user_id,
        "raw_s3_key": s3_key, "raw_file_path": relative_path,
        "processed_s3_key": None, "processed_file_path": None, "file_path": None,
    }

    analyze_calls = []
    heartbeat_starts = []

    async def _must_not_run(*, video_id, file_path, teacher_id, user_id, analysis_run_id=None):
        analyze_calls.append(file_path)
        raise AssertionError("analyze_video reached with unavailable input")

    monkeypatch.setattr(server, "analyze_video", _must_not_run, raising=False)
    monkeypatch.setattr(server, "_claim_video_processing_job",
                        lambda *a, **k: _async_return(dict(job_doc)), raising=False)
    monkeypatch.setattr(server, "_require_canonical_video_source",
                        lambda *a, **k: _async_return(dict(video_doc)), raising=False)
    monkeypatch.setattr(server, "_write_worker_heartbeat",
                        lambda *a, **k: _async_return(None), raising=False)
    monkeypatch.setattr(server, "_record_video_source_chain_incident",
                        lambda *a, **k: _async_return(None), raising=False)

    def _track_heartbeat(*a, **k):
        heartbeat_starts.append(a)
        return _async_return(None)
    monkeypatch.setattr(server, "_heartbeat_during_job", _track_heartbeat, raising=False)

    jobs_coll = _Coll(job_doc)
    fake_db = _types.SimpleNamespace(
        video_processing_jobs=jobs_coll,
        worker_heartbeats=_Coll(None),
        videos=_Coll(video_doc),
    )
    monkeypatch.setattr(server, "db", fake_db, raising=False)

    # EDIT 3 deliberately does NOT catch this — it propagates to the worker loop.
    with pytest.raises(RuntimeError) as excinfo:
        await server._run_video_job(video_id, "test-worker")
    assert "video_input_unavailable" in str(excinfo.value)

    # Hard guarantees:
    assert not analyze_calls, "analyze_video must never run on unavailable input"
    assert not heartbeat_starts, "no heartbeat task may be spawned before resolution"
    completed = [
        upd for (_flt, upd) in jobs_coll.updates
        if isinstance(upd, dict) and "$set" in upd
        and upd["$set"].get("status") == server.VideoProcessingStatus.COMPLETED.value
    ]
    assert not completed, "no COMPLETED status may be written on fail-closed"
