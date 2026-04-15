import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest


def _load_server_module():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub
    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub
    module_path = Path(__file__).resolve().parents[1] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_video_helpers", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


def test_normalize_video_status_maps_legacy_and_unknown_values():
    assert server._normalize_video_status("processing") == "processing"
    assert server._normalize_video_status("cancelled") == "cancelled"
    assert server._normalize_video_status("error") == "failed"
    assert server._normalize_video_status("errored") == "failed"
    assert server._normalize_video_status("mystery") == "queued"
    assert server._normalize_video_status(None) == "queued"


def test_normalize_video_transcode_status_maps_legacy_and_unknown_values():
    assert server._normalize_video_transcode_status("processing") == "processing"
    assert server._normalize_video_transcode_status("completed") == "completed"
    assert server._normalize_video_transcode_status("error") == "failed"
    assert server._normalize_video_transcode_status("mystery") == "not_required"
    assert server._normalize_video_transcode_status(None) == "not_required"


def test_parse_optional_iso_datetime_normalizes_to_utc():
    normalized = server._parse_optional_iso_datetime("2026-02-25T12:00:00-05:00", "recorded_at")
    assert normalized.endswith("+00:00")
    assert normalized.startswith("2026-02-25T17:00:00")


def test_parse_optional_iso_datetime_rejects_invalid_value():
    with pytest.raises(server.HTTPException) as exc:
        server._parse_optional_iso_datetime("not-a-date", "recorded_at")
    assert exc.value.status_code == 400


def test_resolve_video_playback_url_prefers_file_url_then_local_path():
    assert (
        server._resolve_video_playback_url({"file_url": "https://cdn.example.com/video.mp4"})
        == "https://cdn.example.com/video.mp4"
    )
    local = server._resolve_video_playback_url({"file_path": "videos/t1/abc.mp4"})
    assert local.endswith("/uploads/videos/t1/abc.mp4")


def test_resolve_video_playback_url_prefers_processed_asset_before_raw():
    resolved = server._resolve_video_playback_url(
        {
            "privacy_status": "completed",
            "processed_file_url": "https://cdn.example.com/processed.mp4",
            "file_url": "https://cdn.example.com/raw.mp4",
        }
    )
    assert resolved == "https://cdn.example.com/processed.mp4"


def test_build_video_visibility_query_by_role():
    admin_query = server._build_video_visibility_query({"id": "u1", "role": "admin"})
    assert admin_query == {"uploaded_by": "u1"}

    teacher_query = server._build_video_visibility_query(
        {"id": "u2", "role": "teacher"},
        teacher_ids_for_user=["t1", "t2"],
    )
    assert teacher_query == {"teacher_id": {"$in": ["t1", "t2"]}}

    fallback_query = server._build_video_visibility_query({"id": "u3", "role": "teacher"})
    assert fallback_query == {"uploaded_by": "u3"}


def test_apply_video_response_defaults_adds_playback_and_thumbnail_urls():
    video = {
        "status": "error",
        "privacy_status": "completed",
        "analysis_status": "processing",
        "transcode_status": "processing",
        "file_path": "videos/t1/v1.mp4",
        "thumbnail_path": "thumbnails/t1/v1.jpg",
    }
    normalized = server._apply_video_response_defaults(video)
    assert normalized["status"] == "failed"
    assert normalized["privacy_status"] == "completed"
    assert normalized["analysis_status"] == "processing"
    assert normalized["transcode_status"] == "processing"
    assert normalized["playback_url"].endswith("/uploads/videos/t1/v1.mp4")
    assert normalized["thumbnail_url"].endswith("/uploads/thumbnails/t1/v1.jpg")


def test_normalize_privacy_status_maps_unknown_and_errors():
    assert server._normalize_privacy_status("review_required") == "review_required"
    assert server._normalize_privacy_status("error") == "failed"
    assert server._normalize_privacy_status("mystery") == "queued"
    assert server._normalize_privacy_status(None) == "queued"


def test_apply_video_response_defaults_prefers_redacted_assets():
    video = {
        "status": "completed",
        "privacy_status": "completed",
        "analysis_status": "completed",
        "file_url": "https://cdn.example.com/raw.mp4",
        "redacted_file_url": "https://cdn.example.com/redacted.mp4",
        "thumbnail_url": "https://cdn.example.com/raw.jpg",
        "redacted_thumbnail_url": "https://cdn.example.com/redacted.jpg",
    }
    normalized = server._apply_video_response_defaults(video)
    assert normalized["playback_url"] == "https://cdn.example.com/redacted.mp4"
    assert normalized["thumbnail_url"] == "https://cdn.example.com/redacted.jpg"


def test_apply_video_response_defaults_hides_playback_until_privacy_complete():
    video = {
        "status": "processing",
        "privacy_status": "processing",
        "analysis_status": "queued",
        "file_url": "https://cdn.example.com/raw.mp4",
        "thumbnail_url": "https://cdn.example.com/raw.jpg",
    }
    normalized = server._apply_video_response_defaults(video)
    assert normalized["playback_url"] is None
    assert normalized["thumbnail_url"] is None


def test_sanitize_video_response_removes_raw_and_storage_fields():
    sanitized = server._sanitize_video_response(
        {
            "id": "vid_1",
            "playback_url": "https://cdn.example.com/redacted.mp4",
            "thumbnail_url": "https://cdn.example.com/redacted.jpg",
            "raw_file_url": "https://cdn.example.com/raw.mp4",
            "file_url": "https://cdn.example.com/internal.mp4",
            "file_path": "videos/t1/raw.mp4",
            "raw_file_path": "videos/t1/raw.mp4",
            "s3_key": "uploads/videos/internal.mp4",
            "processed_file_url": "https://cdn.example.com/processed.mp4",
            "processed_file_path": "videos/processed/t1/processed.mp4",
            "processed_s3_key": "uploads/videos/processed/t1/processed.mp4",
        }
    )
    assert sanitized["playback_url"] == "https://cdn.example.com/redacted.mp4"
    assert "raw_file_url" not in sanitized
    assert "file_url" not in sanitized
    assert "file_path" not in sanitized
    assert "s3_key" not in sanitized
    assert "processed_file_url" not in sanitized
    assert "processed_file_path" not in sanitized
    assert "processed_s3_key" not in sanitized


def test_build_privacy_profile_summary_returns_missing_defaults():
    profile = server._build_privacy_profile_summary("teacher_1", None)
    assert profile.teacher_id == "teacher_1"
    assert profile.status == "missing"
    assert profile.reference_count == 0
    assert profile.needs_refresh is True


def test_render_degraded_privacy_assets_prefers_mp4_transcode(monkeypatch, tmp_path):
    source = tmp_path / "source.mov"
    source.write_bytes(b"raw-video-bytes")
    output = tmp_path / "redacted.mp4"
    thumbnail = tmp_path / "thumb.jpg"

    def _fake_transcode(input_path, output_path):
        Path(output_path).write_bytes(b"mp4-video-bytes")
        return {"output_path": output_path, "content_type": "video/mp4"}

    monkeypatch.setattr(server, "transcode_video_asset", _fake_transcode)

    written_thumbs = []

    def _fake_thumbnail(path):
        target = Path(path)
        target.write_bytes(b"thumb")
        written_thumbs.append(str(target))

    monkeypatch.setattr(server, "_write_placeholder_thumbnail", _fake_thumbnail)

    stats = server._render_degraded_privacy_assets(str(source), str(output), str(thumbnail))

    assert stats["runtime_fallback"] == "worker_transcode_only"
    assert stats["transcode_error"] is None
    assert output.read_bytes() == b"mp4-video-bytes"
    assert written_thumbs == [str(thumbnail)]


def test_render_degraded_privacy_assets_falls_back_to_copy_when_transcode_fails(monkeypatch, tmp_path):
    source = tmp_path / "source.mov"
    source.write_bytes(b"raw-video-bytes")
    output = tmp_path / "redacted.mp4"
    thumbnail = tmp_path / "thumb.jpg"

    def _failing_transcode(input_path, output_path):
        raise RuntimeError("ffmpeg unavailable")

    monkeypatch.setattr(server, "transcode_video_asset", _failing_transcode)
    monkeypatch.setattr(
        server,
        "_write_placeholder_thumbnail",
        lambda path: Path(path).write_bytes(b"thumb"),
    )

    stats = server._render_degraded_privacy_assets(str(source), str(output), str(thumbnail))

    assert stats["runtime_fallback"] == "worker_copy_only"
    assert "ffmpeg unavailable" in (stats.get("transcode_error") or "")
    assert output.read_bytes() == b"raw-video-bytes"
    assert thumbnail.exists()


def test_build_transcoded_raw_cleanup_fields_shortens_retention_when_processed_asset_exists(monkeypatch):
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED", True)
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_RAW_RETENTION_HOURS", 24)

    fields = server._build_transcoded_raw_cleanup_fields(
        {
            "transcode_status": "completed",
            "processed_file_path": "processed/t1/v1.mp4",
            "raw_file_path": "videos/t1/v1.mov",
            "raw_retention_expires_at": "2026-05-01T00:00:00+00:00",
        },
        "2026-04-12T10:00:00+00:00",
    )

    assert fields["raw_retention_expires_at"] == "2026-04-13T10:00:00+00:00"
    assert fields["raw_cleanup_policy"] == "processed_after_privacy"
    assert fields["raw_cleanup_scheduled_at"] == "2026-04-12T10:00:00+00:00"


def test_build_transcoded_raw_cleanup_fields_skips_non_transcoded_videos(monkeypatch):
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED", True)
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_RAW_RETENTION_HOURS", 24)

    fields = server._build_transcoded_raw_cleanup_fields(
        {
            "transcode_status": "not_required",
            "processed_file_path": None,
            "raw_file_path": "videos/t1/v1.mov",
        },
        "2026-04-12T10:00:00+00:00",
    )

    assert fields == {}


@pytest.mark.asyncio
async def test_rehydrate_video_privacy_queue_waits_for_transcode_and_prefers_processed_asset(monkeypatch):
    class _Cursor:
        def __init__(self, items):
            self.items = items

        async def to_list(self, _limit):
            return list(self.items)

    class _Collection:
        def __init__(self, find_results):
            self.find_results = list(find_results)
            self.find_calls = []
            self.update_many_calls = []

        async def update_many(self, filter_doc, update_doc):
            self.update_many_calls.append((filter_doc, update_doc))

        def find(self, filter_doc, projection):
            self.find_calls.append((filter_doc, projection))
            index = len(self.find_calls) - 1
            return _Cursor(self.find_results[index] if index < len(self.find_results) else [])

    privacy_jobs = _Collection([[]])
    videos = _Collection(
        [[
            {
                "id": "video_1",
                "teacher_id": "teacher_1",
                "uploaded_by": "user_1",
                "processed_file_path": "processed/teacher_1/video_1.mp4",
                "raw_file_path": "videos/teacher_1/video_1.mov",
                "file_path": "videos/teacher_1/video_1.mov",
            }
        ]]
    )

    enqueued = []

    async def _enqueue_video_privacy_job(**kwargs):
        enqueued.append(kwargs)

    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(video_privacy_jobs=privacy_jobs, videos=videos),
    )
    monkeypatch.setattr(server, "UPLOAD_DIR", Path("/tmp/cognivio-test-uploads"))
    monkeypatch.setattr(server, "_enqueue_video_privacy_job", _enqueue_video_privacy_job)
    queue = server.asyncio.Queue()
    monkeypatch.setattr(server, "VIDEO_PRIVACY_JOB_QUEUE", queue)

    await server._rehydrate_video_privacy_queue()

    assert len(videos.find_calls) == 1
    query_filter, _projection = videos.find_calls[0]
    assert query_filter["privacy_status"] == {"$in": ["queued", "processing"]}
    assert query_filter["$or"] == [
        {"transcode_status": {"$exists": False}},
        {"transcode_status": "not_required"},
        {"transcode_status": "completed"},
        {"transcode_status": "failed"},
    ]
    assert enqueued == [
        {
            "video_id": "video_1",
            "teacher_id": "teacher_1",
            "user_id": "user_1",
            "file_path": str(Path("/tmp/cognivio-test-uploads") / "processed/teacher_1/video_1.mp4"),
        }
    ]
