"""PR C9.5 PART 4 — run/retry audio analysis endpoint.

Locks the contract-C truth property: the action never silently no-ops. A
disabled workspace returns an explicit ``disabled`` status + reason code, a
successful run upserts the transcript/feature docs and records ``completed``,
and a pipeline failure records ``failed`` and surfaces an error to the caller
(never a false "done").
"""

from __future__ import annotations

import asyncio
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

import server


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _matches(doc, query):
        return all(doc.get(k) == v for k, v in (query or {}).items())

    async def find_one(self, query, projection=None, sort=None):
        matches = [d for d in self.docs if self._matches(d, query or {})]
        if not matches:
            return None
        doc = dict(matches[0])
        doc.pop("_id", None)
        return doc

    async def update_one(self, query, update, upsert=False):
        set_fields = (update or {}).get("$set", {})
        for doc in self.docs:
            if self._matches(doc, query or {}):
                doc.update(set_fields)
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new_doc = dict(query or {})
            new_doc.update(set_fields)
            self.docs.append(new_doc)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id="x")
        return types.SimpleNamespace(matched_count=0, modified_count=0)


def _fake_db(video):
    return types.SimpleNamespace(
        videos=_FakeCollection([video]),
        video_audio_transcripts=_FakeCollection([]),
        video_analysis_features=_FakeCollection([]),
    )


def _video(**overrides):
    base = {
        "id": "v1",
        "teacher_id": "teacher-1",
        "privacy_status": "completed",
        "redacted_file_path": "redacted/teacher-1/v1.mp4",
    }
    base.update(overrides)
    return base


def _patch_common(monkeypatch, db, *, audio_enabled=True, source=Path("x.mp4")):
    monkeypatch.setattr(server, "db", db)

    async def fake_teacher(teacher_id, current_user):
        return {"id": teacher_id}

    async def fake_audit(*args, **kwargs):
        return None

    async def fake_audio_enabled(user):
        return audio_enabled

    monkeypatch.setattr(server, "_get_teacher_or_404", fake_teacher)
    monkeypatch.setattr(server, "_log_privacy_audit_event", fake_audit)
    monkeypatch.setattr(server, "_is_workspace_audio_analysis_enabled_for_user", fake_audio_enabled)
    monkeypatch.setattr(server, "_should_run_audio_analysis", lambda user: audio_enabled)
    monkeypatch.setattr(server, "_resolve_audio_analysis_source_path", lambda video: source)


def _admin():
    return {"id": "admin-1", "role": "admin"}


def test_disabled_workspace_returns_explicit_reason(monkeypatch):
    video = _video()
    db = _fake_db(video)
    _patch_common(monkeypatch, db, audio_enabled=False)

    async def fake_audio(*args, **kwargs):  # pragma: no cover - must NOT run
        raise AssertionError("audio pipeline must not run when disabled")

    monkeypatch.setattr(server, "build_audio_artifacts", fake_audio)

    result = asyncio.run(server.run_video_audio_analysis("v1", _admin()))
    assert result.audio_analysis_status == "disabled"
    assert result.reason_code == "audio_analysis_disabled"
    # The video record reflects the disabled outcome (not a false "completed").
    assert db.videos.docs[0]["audio_analysis_status"] == "disabled"
    # No transcript was fabricated.
    assert db.video_audio_transcripts.docs == []


def test_privacy_incomplete_blocks_run(monkeypatch):
    video = _video(privacy_status="processing")
    db = _fake_db(video)
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.run_video_audio_analysis("v1", _admin()))
    assert exc.value.status_code == 409
    assert exc.value.detail["reason_code"] == "privacy_not_complete"


def test_missing_source_blocks_run(monkeypatch):
    video = _video()
    db = _fake_db(video)
    _patch_common(monkeypatch, db, source=None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.run_video_audio_analysis("v1", _admin()))
    assert exc.value.status_code == 409
    assert exc.value.detail["reason_code"] == "no_local_source"


def test_successful_run_upserts_and_marks_completed(monkeypatch):
    video = _video()
    db = _fake_db(video)
    _patch_common(monkeypatch, db)

    async def fake_audio(video_id, source_path, current_user, analysis_language=None):
        transcript = {
            "id": f"transcript_{video_id}",
            "video_id": video_id,
            "transcript_status": "completed",
            "segments": [],
            "text": "hello",
        }
        feature = {"id": f"audio_features_{video_id}", "video_id": video_id, "teacher_talk_ratio": 0.6}
        return transcript, feature

    monkeypatch.setattr(server, "build_audio_artifacts", fake_audio)

    result = asyncio.run(server.run_video_audio_analysis("v1", _admin()))
    assert result.audio_analysis_status == "completed"
    assert result.transcript_status == "completed"
    assert result.features_available is True
    assert db.videos.docs[0]["audio_analysis_status"] == "completed"
    assert db.video_audio_transcripts.docs[0]["video_id"] == "v1"
    assert db.video_analysis_features.docs[0]["video_id"] == "v1"


def test_pipeline_failure_marks_failed_and_raises(monkeypatch):
    video = _video()
    db = _fake_db(video)
    _patch_common(monkeypatch, db)

    async def boom(*args, **kwargs):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr(server, "build_audio_artifacts", boom)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.run_video_audio_analysis("v1", _admin()))
    assert exc.value.status_code == 502
    assert exc.value.detail["reason_code"] == "audio_pipeline_error"
    # Never a false "completed": the failure is recorded.
    assert db.videos.docs[0]["audio_analysis_status"] == "failed"
