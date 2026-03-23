import importlib.util
import os
import sys
import types
import wave
from pathlib import Path

import pytest


def _load_audio_pipeline_module():
    module_path = Path(__file__).resolve().parents[1] / "audio_pipeline.py"
    spec = importlib.util.spec_from_file_location("backend_audio_pipeline", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


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
    spec = importlib.util.spec_from_file_location("backend_server_audio_tests", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


audio_pipeline = _load_audio_pipeline_module()
server = _load_server_module()


def test_compute_audio_features_counts_questions_and_directives():
    features = audio_pipeline.compute_audio_features(
        [
            {"start_sec": 0.0, "end_sec": 5.0, "text": "Let's compare these ideas. Why do you think that?", "speaker": "unknown"},
            {"start_sec": 7.0, "end_sec": 10.0, "text": "Please share your answer with a partner.", "speaker": "unknown"},
        ]
    )

    assert features["turn_count"] == 2
    assert features["question_count"] >= 1
    assert features["open_question_count"] >= 1
    assert features["directive_density"] > 0
    assert features["pause_density"] > 0


def test_transcribe_audio_file_falls_back_to_json_and_builds_segment(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    with wave.open(str(audio_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 16000)

    class _Response:
        def __init__(self, text):
            self.text = text
            self.segments = None

    class _Transcriptions:
        def __init__(self):
            self.calls = []

        def create(self, **kwargs):
            self.calls.append(kwargs)
            if kwargs.get("response_format") == "verbose_json":
                raise RuntimeError("response_format 'verbose_json' is not compatible with model 'gpt-4o-mini-transcribe'")
            return _Response("שלום כיתה, בואו נתחיל.")

    transcriptions = _Transcriptions()

    class _Audio:
        def __init__(self, transcriptions_obj):
            self.transcriptions = transcriptions_obj

    class _Client:
        def __init__(self, api_key):
            self.audio = _Audio(transcriptions)

    monkeypatch.setattr(audio_pipeline, "OpenAI", _Client)

    result = audio_pipeline.transcribe_audio_file(str(audio_path), "test-key", "gpt-4o-mini-transcribe", "he")

    assert result["text"] == "שלום כיתה, בואו נתחיל."
    assert len(result["segments"]) == 1
    assert result["segments"][0]["text"] == "שלום כיתה, בואו נתחיל."
    assert result["segments"][0]["end_sec"] > 0
    assert transcriptions.calls[0]["response_format"] == "verbose_json"
    assert transcriptions.calls[1]["response_format"] == "json"


def test_should_run_audio_analysis_requires_flags_and_policy(monkeypatch):
    monkeypatch.setattr(server, "AUDIO_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@example.com"})

    assert server._should_run_audio_analysis({"email": "teacher@example.com"}) is True

    monkeypatch.setattr(server, "AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", False)
    assert server._should_run_audio_analysis({"email": "teacher@example.com"}) is False


@pytest.mark.asyncio
async def test_build_audio_artifacts_returns_transcript_and_features(monkeypatch):
    monkeypatch.setattr(server, "AUDIO_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", True)
    monkeypatch.setattr(server, "AUDIO_TRANSCRIPTION_ENABLED", True)
    monkeypatch.setattr(server, "AUDIO_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@example.com"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "UPLOAD_DIR", Path(__file__).resolve().parents[1] / "tmp_audio")
    monkeypatch.setattr(
        server,
        "extract_audio_track",
        lambda video_path, output_path, max_seconds=None: {
            "audio_path": output_path,
            "file_size_bytes": 100,
            "content_type": "audio/wav",
        },
    )
    monkeypatch.setattr(
        server,
        "transcribe_audio_file",
        lambda audio_path, api_key, model, language: {
            "text": "Let's compare these ideas. Why do you think that?",
            "segments": [
                {
                    "segment_id": "segment_001",
                    "start_sec": 0.0,
                    "end_sec": 4.0,
                    "speaker": "unknown",
                    "text": "Let's compare these ideas. Why do you think that?",
                }
            ],
            "model": model,
        },
    )
    monkeypatch.setattr(server.os.path, "exists", lambda path: False)

    transcript_doc, feature_doc = await server.build_audio_artifacts(
        "video_123",
        "dummy.mp4",
        {"email": "teacher@example.com"},
    )

    assert transcript_doc["video_id"] == "video_123"
    assert transcript_doc["transcript_status"] == "completed"
    assert transcript_doc["segments"][0]["text"].startswith("Let's compare")
    assert feature_doc["video_id"] == "video_123"
    assert feature_doc["question_count"] >= 1
