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
    assert server._normalize_video_status("error") == "failed"
    assert server._normalize_video_status("errored") == "failed"
    assert server._normalize_video_status("mystery") == "queued"
    assert server._normalize_video_status(None) == "queued"


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
        "analysis_status": "processing",
        "file_path": "videos/t1/v1.mp4",
        "thumbnail_path": "thumbnails/t1/v1.jpg",
    }
    normalized = server._apply_video_response_defaults(video)
    assert normalized["status"] == "failed"
    assert normalized["analysis_status"] == "processing"
    assert normalized["playback_url"].endswith("/uploads/videos/t1/v1.mp4")
    assert normalized["thumbnail_url"].endswith("/uploads/thumbnails/t1/v1.jpg")
