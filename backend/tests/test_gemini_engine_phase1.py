"""WS1 Phase 1 — Gemini engine tests (fully mocked, deterministic).

No live Gemini calls: every test injects a FakeGeminiClient through the engine's
``client`` seam, so the real google-genai SDK is never built and no network I/O
happens. Covers:

  * good payload -> passes the frozen contract (validate_payload ok)
  * each failure path -> a DISTINCT typed AnalysisError + the expected
    failures.py analysis_mode (parse / empty / all-dropped / timeout / rate-limit
    / unconfigured / file_api stub)
  * dispatch dormancy: with analysis_provider=="openai" the Gemini engine is NOT
    invoked and the OpenAI path runs (byte-for-byte-unchanged guard); with
    "gemini" the engine IS invoked and analysis_mode becomes gemini_multimodal
  * static no-live-network check (engine never imports google at module level)
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from types import SimpleNamespace

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from app.analysis.contracts import validate_payload
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED,
    ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
    ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
    ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
    ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
    ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
    ANALYSIS_MODE_GEMINI_MULTIMODAL,
    AnalysisContractError,
    AnalysisParseError,
    AnalysisProviderError,
    is_fallback_mode,
)
from app.analysis import gemini_engine
from app.analysis.gemini_engine import analyze_video_with_gemini


HERE = os.path.dirname(__file__)
ENGINE_PATH = os.path.abspath(os.path.join(HERE, "..", "app", "analysis", "gemini_engine.py"))

ELEMENTS = [
    {"id": "2b", "name": "Questioning and Discussion Techniques", "domain": "Instruction", "priority": True},
    {"id": "3c", "name": "Engaging Students in Learning", "domain": "Instruction", "priority": False},
]
ALLOWED_IDS = [e["id"] for e in ELEMENTS]
FAKE_VIDEO = b"\x00\x01\x02fake-mp4-bytes-for-testing"

GOOD_PAYLOAD = {
    "summary": "You opened with a strong question and built on what students offered.",
    "recommendations": [
        {"start_sec": 90, "end_sec": 120, "text": "Pause five seconds after the big question.", "linked_element_id": "2b"}
    ],
    "element_scores": [
        {
            "element_id": "2b",
            "score": 6.8,
            "confidence": 82,
            "observations": ["You asked students to explain their thinking."],
            "evidence_segments": [
                {"start_sec": 90, "end_sec": 120, "summary": "Open question posed.", "rationale": "Creates discussion space."}
            ],
        }
    ],
}
GOOD_PAYLOAD_JSON = json.dumps(GOOD_PAYLOAD)


# --------------------------------------------------------------------------- #
# Fake injected client — mirrors client.aio.models.generate_content(...)
# --------------------------------------------------------------------------- #
class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeModels:
    def __init__(self, *, text=None, raises=None):
        self._text = text
        self._raises = raises
        self.calls = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._raises is not None:
            raise self._raises
        return _FakeResponse(self._text)


class FakeGeminiClient:
    def __init__(self, *, text=None, raises=None):
        self.models = _FakeModels(text=text, raises=raises)
        self.aio = SimpleNamespace(models=self.models)


def _settings(*, model="gemini-test-flash", api_key="test-key", input_mode="inline"):
    return SimpleNamespace(
        ai=SimpleNamespace(
            gemini_model=model,
            gemini_api_key=api_key,
            gemini_video_input_mode=input_mode,
        )
    )


def _run(**overrides):
    kwargs = dict(
        video_path_or_bytes=FAKE_VIDEO,
        elements_to_analyze=ELEMENTS,
        focus_instruction="Focus on questioning depth.",
        language="en",
        settings=_settings(),
    )
    kwargs.update(overrides)
    return asyncio.run(analyze_video_with_gemini(**kwargs))


# =========================================================================== #
# STEP 5a — good payload
# =========================================================================== #
def test_good_payload_passes_contract():
    client = FakeGeminiClient(text=GOOD_PAYLOAD_JSON)
    payload = _run(client=client)
    result = validate_payload(payload, ALLOWED_IDS)
    assert result.ok is True, result.errors
    assert payload["element_scores"][0]["element_id"] == "2b"


def test_engine_uses_low_temperature_and_calls_client_once():
    client = FakeGeminiClient(text=GOOD_PAYLOAD_JSON)
    _run(client=client)
    assert len(client.models.calls) == 1
    call = client.models.calls[0]
    assert call["model"] == "gemini-test-flash"
    assert call["config"]["temperature"] == 0.0
    assert call["config"]["response_mime_type"] == "application/json"


def test_prompt_contains_allowed_ids_and_no_other_ids():
    client = FakeGeminiClient(text=GOOD_PAYLOAD_JSON)
    _run(client=client)
    parts = client.models.calls[0]["contents"][0]["parts"]
    prompt_text = parts[0]["text"]
    assert "2b" in prompt_text and "3c" in prompt_text
    # video part carries the raw bytes inline (SDK base64-encodes on the wire)
    assert parts[1]["inline_data"]["data"] == FAKE_VIDEO


def test_handles_markdown_fenced_json():
    fenced = "```json\n" + GOOD_PAYLOAD_JSON + "\n```"
    payload = _run(client=FakeGeminiClient(text=fenced))
    assert validate_payload(payload, ALLOWED_IDS).ok is True


# =========================================================================== #
# STEP 5b — failure paths (one per taxonomy mode)
# =========================================================================== #
def test_malformed_json_raises_parse_error():
    with pytest.raises(AnalysisParseError) as ei:
        _run(client=FakeGeminiClient(text="this is not json at all"))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR
    assert is_fallback_mode(ei.value.analysis_mode) is True


def test_empty_element_scores_raises_contract_error():
    text = json.dumps({"summary": "ok", "recommendations": [], "element_scores": []})
    with pytest.raises(AnalysisContractError) as ei:
        _run(client=FakeGeminiClient(text=text))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES
    assert is_fallback_mode(ei.value.analysis_mode) is True


def test_all_unknown_ids_raises_all_dropped():
    text = json.dumps(
        {
            "summary": "ok summary",
            "recommendations": [],
            "element_scores": [
                {
                    "element_id": "zzz-not-allowed",
                    "score": 5,
                    "confidence": 50,
                    "observations": ["x"],
                    "evidence_segments": [{"start_sec": 1, "end_sec": 2, "summary": "s", "rationale": "r"}],
                }
            ],
        }
    )
    with pytest.raises(AnalysisContractError) as ei:
        _run(client=FakeGeminiClient(text=text))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED
    assert is_fallback_mode(ei.value.analysis_mode) is True


def test_other_contract_violation_maps_to_gemini_parse_error():
    # Missing summary but valid scores -> generic contract violation bucket.
    text = json.dumps(
        {
            "recommendations": [],
            "element_scores": [
                {
                    "element_id": "2b",
                    "score": 6,
                    "confidence": 70,
                    "observations": ["ok"],
                    "evidence_segments": [{"start_sec": 1, "end_sec": 2, "summary": "s", "rationale": "r"}],
                }
            ],
        }
    )
    with pytest.raises(AnalysisContractError) as ei:
        _run(client=FakeGeminiClient(text=text))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR


def test_timeout_raises_provider_timeout():
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=FakeGeminiClient(raises=asyncio.TimeoutError()))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT
    assert is_fallback_mode(ei.value.analysis_mode) is True


def test_rate_limit_raises_provider_rate_limited():
    class _RateLimited(Exception):
        code = 429

    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=FakeGeminiClient(raises=_RateLimited("429 RESOURCE_EXHAUSTED")))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED
    assert is_fallback_mode(ei.value.analysis_mode) is True


def test_rate_limit_detected_by_message_only():
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=FakeGeminiClient(raises=RuntimeError("Quota exceeded: rate limit hit")))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED


# =========================================================================== #
# STEP 5c — unconfigured (no network attempted)
# =========================================================================== #
def test_unconfigured_model_id_raises_without_calling_client():
    client = FakeGeminiClient(text=GOOD_PAYLOAD_JSON)
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=client, settings=_settings(model=""))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED
    assert client.models.calls == []  # short-circuited before any call


def test_unconfigured_api_key_with_real_client_path_raises_no_sdk_build():
    # client=None + empty api key -> must raise BEFORE building the real client,
    # so the google-genai SDK is never constructed and no network happens.
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=None, settings=_settings(api_key=""))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED


# =========================================================================== #
# STEP 5e — file_api stub
# =========================================================================== #
def test_file_api_mode_without_file_support_raises_typed_upload_error():
    # WS1 Phase 3 implemented the File API path. With a client that lacks file
    # support (this Phase-1 fake has only .aio.models), config "file_api" now
    # attempts an upload and fails with a typed, distinct fallback mode — never
    # silent, and the generate step is never reached. (The real File API path is
    # covered by test_gemini_robustness_phase3.py.)
    client = FakeGeminiClient(text=GOOD_PAYLOAD_JSON)
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=client, settings=_settings(input_mode="file_api"))
    assert is_fallback_mode(ei.value.analysis_mode) is True
    assert client.models.calls == []


def test_missing_video_source_raises_provider_error():
    with pytest.raises(AnalysisProviderError):
        _run(client=FakeGeminiClient(text=GOOD_PAYLOAD_JSON), video_path_or_bytes=None)


# =========================================================================== #
# STEP 5f — static no-live-network guard
# =========================================================================== #
def test_engine_has_no_module_level_google_import():
    with open(ENGINE_PATH, encoding="utf-8") as fh:
        src = fh.read()
    # Any `import google` / `from google import ...` must be indented (inside a
    # function), never at column 0 — so importing the engine never loads the SDK.
    module_level = re.findall(r"(?m)^(?:import|from)\s+google\b", src)
    assert module_level == [], f"engine must import google lazily, found: {module_level}"


def test_engine_module_imports_without_sdk():
    import importlib

    mod = importlib.reload(gemini_engine)
    assert hasattr(mod, "analyze_video_with_gemini")


# =========================================================================== #
# STEP 5d — dispatch dormancy / no-regression (server.py)
# =========================================================================== #
import server  # noqa: E402  (imported after env setdefault above)


_FRAMEWORK = {"domains": [{"name": "Instruction", "elements": [{"id": "2b", "name": "Questioning"}]}]}


def test_dispatch_does_not_invoke_gemini_when_provider_is_openai(monkeypatch):
    # OpenAI configured + allowed; provider stays the default "openai".
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "AsyncOpenAI", object())
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(ai=SimpleNamespace(analysis_provider="openai", gemini_api_key="present-but-ignored")),
    )

    async def _fake_openai(frames, elements, focus_instruction=None, language="en"):
        return GOOD_PAYLOAD

    monkeypatch.setattr(server, "_analyze_frames_with_openai", _fake_openai)

    called = {"gemini": 0}

    async def _spy(**kwargs):
        called["gemini"] += 1
        return GOOD_PAYLOAD

    monkeypatch.setattr(gemini_engine, "analyze_video_with_gemini", _spy)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 12.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
        )
    )

    assert called["gemini"] == 0  # DORMANT: gemini engine never invoked
    assert result["analysis_mode"] in {"openai", "openai_multimodal"}


def test_dispatch_invokes_gemini_when_provider_is_gemini(monkeypatch):
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(
            ai=SimpleNamespace(
                analysis_provider="gemini",
                gemini_api_key="k",
                gemini_model="m",
                gemini_video_input_mode="inline",
            )
        ),
    )

    seen = {}

    async def _spy(**kwargs):
        seen.update(kwargs)
        return GOOD_PAYLOAD

    monkeypatch.setattr(gemini_engine, "analyze_video_with_gemini", _spy)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 12.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
        )
    )

    assert seen, "gemini engine should have been invoked"
    assert seen["video_path_or_bytes"] == "/tmp/source.mp4"  # source threaded through
    assert result["analysis_mode"] == "gemini_multimodal"


def test_dispatch_gemini_failure_falls_through_to_openai(monkeypatch):
    # Gemini selected but raises -> must fall through to the live OpenAI path,
    # never silently serving mock as success.
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "AsyncOpenAI", object())
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(
            ai=SimpleNamespace(
                analysis_provider="gemini",
                gemini_api_key="k",
                gemini_model="m",
                gemini_video_input_mode="inline",
            )
        ),
    )

    async def _boom(**kwargs):
        raise AnalysisProviderError("kaboom", analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT)

    async def _fake_openai(frames, elements, focus_instruction=None, language="en"):
        return GOOD_PAYLOAD

    monkeypatch.setattr(gemini_engine, "analyze_video_with_gemini", _boom)
    monkeypatch.setattr(server, "_analyze_frames_with_openai", _fake_openai)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 12.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
        )
    )

    # Fell through to OpenAI (real analysis), did NOT mark gemini success.
    assert result["analysis_mode"] in {"openai", "openai_multimodal"}
