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
    spec = importlib.util.spec_from_file_location("backend_server_audio_debug", module_path)
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
async def test_get_admin_video_audio_transcript_returns_doc(monkeypatch):
    async def _allow_video(video_id, current_user):
        return {"id": video_id, "teacher_id": "teacher_1", "uploaded_by": current_user["id"]}

    monkeypatch.setattr(server, "_get_admin_owned_video_or_404", _allow_video)
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            video_audio_transcripts=_FakeCollection(
                {
                    "video_id": "video_1",
                    "transcript_status": "completed",
                    "model": "gpt-4o-mini-transcribe",
                    "language": "en",
                    "text": "Let's compare these two approaches.",
                    "segments": [
                        {
                            "segment_id": "segment_001",
                            "start_sec": 1.0,
                            "end_sec": 4.0,
                            "speaker": "unknown",
                            "text": "Let's compare these two approaches.",
                        }
                    ],
                    "retention_expires_at": "2026-04-20T10:00:00Z",
                    "created_at": "2026-03-20T10:00:00Z",
                }
            )
        ),
    )

    response = await server.get_admin_video_audio_transcript("video_1", {"id": "admin_1", "role": "admin"})

    assert response.video_id == "video_1"
    assert response.transcript_status == "completed"
    assert response.segments[0].text.startswith("Let's compare")


@pytest.mark.asyncio
async def test_get_admin_video_audio_features_returns_doc(monkeypatch):
    async def _allow_video(video_id, current_user):
        return {"id": video_id, "teacher_id": "teacher_1", "uploaded_by": current_user["id"]}

    monkeypatch.setattr(server, "_get_admin_owned_video_or_404", _allow_video)
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            video_analysis_features=_FakeCollection(
                {
                    "video_id": "video_1",
                    "teacher_talk_ratio": 1.0,
                    "turn_count": 5,
                    "question_count": 3,
                    "open_question_count": 2,
                    "directive_density": 0.14,
                    "pause_density": 0.22,
                    "transition_markers": 2,
                    "modalities_used": ["audio"],
                    "created_at": "2026-03-20T10:01:00Z",
                }
            )
        ),
    )

    response = await server.get_admin_video_audio_features("video_1", {"id": "admin_1", "role": "admin"})

    assert response.video_id == "video_1"
    assert response.question_count == 3
    assert response.modalities_used == ["audio"]
