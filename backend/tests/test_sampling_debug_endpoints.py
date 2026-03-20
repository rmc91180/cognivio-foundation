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
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.append(str(backend_root))
    module_path = backend_root / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_sampling_debug", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


class _FakeCollection:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, *args, **kwargs):
        return self.doc


@pytest.mark.asyncio
async def test_get_admin_owned_video_or_404_rejects_foreign_admin(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(videos=_FakeCollection({"id": "video_1", "teacher_id": "teacher_1", "uploaded_by": "other_admin"})),
    )

    with pytest.raises(server.HTTPException) as exc:
        await server._get_admin_owned_video_or_404("video_1", {"id": "admin_1", "role": "admin"})

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_admin_video_sampling_manifest_returns_latest_doc(monkeypatch):
    async def _allow_video(video_id, current_user):
        return {"id": video_id, "teacher_id": "teacher_1", "uploaded_by": current_user["id"]}

    monkeypatch.setattr(server, "_get_admin_owned_video_or_404", _allow_video)
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            video_sampling_manifests=_FakeCollection(
                {
                    "video_id": "video_1",
                    "strategy_version": "smart_frames_v1",
                    "scan_fps": 1.0,
                    "max_frames": 12,
                    "selected_frames": [
                        {
                            "timestamp_sec": 12.5,
                            "reason": "board_content_change",
                            "score": 0.88,
                            "features": {"board_text_density_score": 0.82},
                        }
                    ],
                    "created_at": "2026-03-20T12:00:00Z",
                }
            )
        ),
    )

    response = await server.get_admin_video_sampling_manifest("video_1", {"id": "admin_1", "role": "admin"})

    assert response.video_id == "video_1"
    assert response.strategy_version == "smart_frames_v1"
    assert response.selected_frames[0].reason == "board_content_change"


@pytest.mark.asyncio
async def test_get_admin_video_analysis_moments_returns_latest_doc(monkeypatch):
    async def _allow_video(video_id, current_user):
        return {"id": video_id, "teacher_id": "teacher_1", "uploaded_by": current_user["id"]}

    monkeypatch.setattr(server, "_get_admin_owned_video_or_404", _allow_video)
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            video_analysis_moments=_FakeCollection(
                {
                    "video_id": "video_1",
                    "strategy_version": "lesson_moments_v1",
                    "window_sec": 20.0,
                    "max_moments": 6,
                    "moments": [
                        {
                            "moment_id": "moment_01",
                            "start_sec": 0.0,
                            "end_sec": 20.0,
                            "phase": "lesson_launch",
                            "selection_reason": "timeline_coverage",
                            "representative_frame_sec": 6.0,
                            "supporting_features": {},
                            "score": 0.42,
                        }
                    ],
                    "created_at": "2026-03-20T12:05:00Z",
                }
            )
        ),
    )

    response = await server.get_admin_video_analysis_moments("video_1", {"id": "admin_1", "role": "admin"})

    assert response.video_id == "video_1"
    assert response.strategy_version == "lesson_moments_v1"
    assert response.moments[0].phase == "lesson_launch"
