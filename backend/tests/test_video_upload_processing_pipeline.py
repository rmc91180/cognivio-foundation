"""Integration tests for PR C9.1 video upload pipeline gates.

These tests are unit-flavored — they exercise the server-level helpers that
are deterministic (no DB) so the harness stays fast. Pipeline behavior that
requires the live FastAPI app is covered by separate API tests in
``test_tenant_upload_privacy_flow.py``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

import server


@pytest.fixture
def teacher_face_references_collection(monkeypatch):
    """Stub the ``teacher_face_references`` motor collection with a memory store."""
    items = []

    class _Cursor:
        def __init__(self, docs):
            self._docs = docs

        def sort(self, *_args, **_kwargs):
            return self

        async def to_list(self, _limit):
            return list(self._docs)

    class _Collection:
        async def find_one(self, *_args, **_kwargs):
            return items[0] if items else None

        def find(self, query, projection=None):
            filtered = items
            status_filter = (query.get("status") or {}).get("$nin")
            if status_filter:
                filtered = [d for d in items if d.get("status") not in status_filter]
            return _Cursor(filtered)

        async def insert_one(self, doc):
            items.append(doc)

    coll = _Collection()
    monkeypatch.setattr(server.db, "teacher_face_references", coll, raising=False)
    return items


def test_summarize_teacher_privacy_references_disagrees_when_local_missing(tmp_path: Path):
    references = [
        {
            "id": "ref-1",
            "teacher_id": "t1",
            "status": "ready",
            "file_url": "https://pub.example.com/r.jpg",
            "file_path": "missing.jpg",
        }
    ]
    monkeypatched_upload_dir = tmp_path
    summary_ui = server.summarize_privacy_references(
        references,
        upload_dir=monkeypatched_upload_dir,
        allow_url_fetch=True,
    )
    summary_worker = server.summarize_privacy_references(
        references,
        upload_dir=monkeypatched_upload_dir,
        allow_url_fetch=False,
    )
    assert summary_ui.usable_count == 1
    assert summary_worker.usable_count == 0
    assert summary_worker.primary_failure_code == "no_local_file_and_no_fetchable_url"


def test_summarize_teacher_privacy_references_helper(tmp_path: Path, monkeypatch):
    # _summarize_teacher_privacy_references defaults allow_url_fetch=True.
    monkeypatch.setattr(server, "UPLOAD_DIR", tmp_path)
    local = tmp_path / "good.jpg"
    local.write_bytes(b"\x00")
    references = [
        {
            "id": "ref-good",
            "status": "ready",
            "file_path": "good.jpg",
            "file_url": "https://pub.example.com/good.jpg",
        }
    ]
    summary = server._summarize_teacher_privacy_references(references)
    assert summary.usable_count == 1


def test_decide_transcode_for_upload_large_video_pending_when_pipeline_off():
    """The production bug: 60 MB videos used to be silently marked not_required."""
    decision = server.decide_transcode_for_upload(
        60 * 1024 * 1024,
        transcode_enabled=False,
        pipeline_enabled=False,
        min_bytes=25 * 1024 * 1024,
    )
    assert decision.decision == "pending"


def test_resolve_teacher_video_playback_url_refuses_raw():
    url = server._resolve_teacher_video_playback_url(
        {
            "privacy_status": "completed",
            "raw_file_url": "https://cdn.example.com/raw.mp4",
        }
    )
    assert url is None


def test_resolve_teacher_video_playback_url_returns_redacted():
    url = server._resolve_teacher_video_playback_url(
        {
            "privacy_status": "completed",
            "redacted_file_url": "https://cdn.example.com/redacted.mp4",
        }
    )
    assert url == "https://cdn.example.com/redacted.mp4"


def test_resolve_video_playback_url_still_normalizes_legacy_urls():
    url = server._resolve_video_playback_url(
        {"file_url": "S3_PUBLIC_BASE_URL=https://cdn.example.com/legacy.mp4"}
    )
    assert url == "https://cdn.example.com/legacy.mp4"


def test_get_s3_public_url_normalizes_misconfigured_base(monkeypatch):
    monkeypatch.setattr(server, "S3_PUBLIC_BASE_URL", "S3_PUBLIC_BASE_URL=https://pub.example.com")
    monkeypatch.setattr(server, "S3_BUCKET", "cognivio")
    url = server._get_s3_public_url("uploads/x.jpg")
    assert url == "https://pub.example.com/uploads/x.jpg"


def test_teacher_readiness_reports_usable_count_and_failure_codes(monkeypatch, tmp_path: Path):
    """Readiness must surface the structured worker-usability data."""
    monkeypatch.setattr(server, "UPLOAD_DIR", tmp_path)
    teacher = {
        "id": "teacher-1",
        "organization_id": "org-1",
        "consent_complete": True,
        "name": "Alice",
        "email": "alice@example.com",
        "subject": "Math",
        "language": "en",
    }
    current_user = {
        "id": "user-1",
        "role": "teacher",
        "teacher_id": "teacher-1",
        "consent_complete": True,
        "privacy_consent_complete": True,
        "organization_id": "org-1",
    }
    references = [
        {
            "id": "r-1",
            "teacher_id": "teacher-1",
            "status": "ready",
            "file_url": "S3_PUBLIC_BASE_URL=https://pub.example.com/x.jpg",
            "file_path": "missing.jpg",
        }
    ]

    async def fake_get_references(teacher_id, workspace_id):
        assert teacher_id == "teacher-1"
        return references

    async def fake_consent(*_args, **_kwargs):
        return {"complete": True, "policy_version": "v1"}

    monkeypatch.setattr(server, "get_teacher_reference_images_for_blur", fake_get_references)
    monkeypatch.setattr(server, "_teacher_consent_completion", fake_consent)
    monkeypatch.setattr(server, "_teacher_profile_complete", lambda *_a, **_k: True)
    monkeypatch.setattr(server, "_teacher_missing_profile_fields", lambda *_a, **_k: [])

    readiness = asyncio.run(server._teacher_readiness(teacher, current_user))
    assert readiness["privacy_reference_images_usable_count"] == 1
    assert "reference_url_malformed" in (readiness.get("privacy_reference_failure_codes") or [])
