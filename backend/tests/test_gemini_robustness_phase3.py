"""WS1 Phase 3 — Gemini engine robustness & determinism (mocked, no network).

Covers: size-based input selection (20 MB threshold), the real File API path
(upload -> await ACTIVE -> generate-by-ref), bounded retry on transient errors
only (with no-retry on deterministic errors), idempotent upload, the
determinism config lock, and token-usage logging. ``asyncio.sleep`` is patched
so retries/polls never actually wait.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import app.analysis.gemini_engine as engine
from app.analysis.contracts import validate_payload
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
    ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
    ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
    AnalysisContractError,
    AnalysisProviderError,
    is_fallback_mode,
)
from app.analysis.gemini_engine import (
    FILE_API_THRESHOLD_BYTES,
    GEMINI_GENERATION_CONFIG,
    GEMINI_MAX_ATTEMPTS,
    INLINE_MAX_BYTES,
    _await_file_active,
    _select_input_mode,
    analyze_video_with_gemini,
)

ELEMENTS = [
    {"id": "2b", "name": "Questioning", "domain": "Instruction", "priority": True},
    {"id": "3c", "name": "Engagement", "domain": "Instruction", "priority": False},
]
GOOD_PAYLOAD = {
    "summary": "You built a strong discussion with specific questions.",
    "recommendations": [],
    "element_scores": [
        {
            "element_id": "2b",
            "score": 6.8,
            "confidence": 80,
            "observations": ["You asked students to explain their reasoning."],
            "evidence_segments": [
                {"start_sec": 30, "end_sec": 52, "summary": "Open question posed.", "rationale": "discussion"}
            ],
        }
    ],
}
GOOD_JSON = json.dumps(GOOD_PAYLOAD)
SMALL_VIDEO = b"\x00\x01\x02tiny-fake-mp4"


def _settings(*, model="gemini-test-flash", api_key="key", input_mode="inline"):
    return SimpleNamespace(
        ai=SimpleNamespace(gemini_model=model, gemini_api_key=api_key, gemini_video_input_mode=input_mode)
    )


# --------------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------------- #
class _Usage:
    def __init__(self, p, c, t):
        self.prompt_token_count = p
        self.candidates_token_count = c
        self.total_token_count = t


class _Resp:
    def __init__(self, text, usage=None):
        self.text = text
        if usage is not None:
            self.usage_metadata = usage


class _Models:
    def __init__(self, *, text=GOOD_JSON, usage=None, raises_sequence=None):
        self.calls = []
        self._text = text
        self._usage = usage
        self._raises_sequence = list(raises_sequence or [])

    async def generate_content(self, *, model, contents, config):
        idx = len(self.calls)
        self.calls.append({"model": model, "contents": contents, "config": config})
        if idx < len(self._raises_sequence) and self._raises_sequence[idx] is not None:
            raise self._raises_sequence[idx]
        return _Resp(self._text, usage=self._usage)


class _Files:
    def __init__(self, *, initial_state="ACTIVE", get_states=("ACTIVE",), upload_raises=None, uri="files/abc", name="files/abc"):
        self.upload_calls = 0
        self.get_calls = 0
        self._initial = initial_state
        self._get_states = list(get_states)
        self._upload_raises = upload_raises
        self._uri = uri
        self._name = name

    async def upload(self, *, file, config):
        self.upload_calls += 1
        if self._upload_raises is not None:
            raise self._upload_raises
        return SimpleNamespace(name=self._name, uri=self._uri, mime_type="video/mp4", state=self._initial)

    async def get(self, *, name):
        state = self._get_states[min(self.get_calls, len(self._get_states) - 1)]
        self.get_calls += 1
        return SimpleNamespace(name=name, uri=self._uri, mime_type="video/mp4", state=state)


class FakeClient:
    def __init__(self, models=None, files=None):
        self.models = models or _Models()
        self.files = files or _Files()
        self.aio = SimpleNamespace(models=self.models, files=self.files)


@pytest.fixture
def no_sleep(monkeypatch):
    delays = []

    async def _fake_sleep(d):
        delays.append(d)

    monkeypatch.setattr(engine.asyncio, "sleep", _fake_sleep)
    return delays


def _run(**overrides):
    kwargs = dict(
        video_path_or_bytes=SMALL_VIDEO,
        elements_to_analyze=ELEMENTS,
        focus_instruction="focus",
        language="en",
        settings=_settings(),
    )
    kwargs.update(overrides)
    return asyncio.run(analyze_video_with_gemini(**kwargs))


# =========================================================================== #
# 7a — size-based input selection
# =========================================================================== #
def test_select_inline_under_threshold():
    mode, _ = _select_input_mode("inline", 19 * 1024 * 1024)
    assert mode == "inline"


def test_select_file_api_at_or_over_threshold():
    mode, _ = _select_input_mode("inline", FILE_API_THRESHOLD_BYTES)
    assert mode == "file_api"
    mode2, _ = _select_input_mode("inline", 27 * 1024 * 1024)  # the demo clip
    assert mode2 == "file_api"


def test_explicit_inline_small_clip_stays_inline():
    mode, _ = _select_input_mode("inline", 5 * 1024 * 1024)
    assert mode == "inline"


def test_explicit_inline_oversized_auto_upgrades_to_file_api():
    mode, note = _select_input_mode("inline", INLINE_MAX_BYTES + 1)
    assert mode == "file_api"
    assert "auto-upgrad" in note.lower()


def test_explicit_file_api_config_forces_file_api():
    mode, _ = _select_input_mode("file_api", 1024)
    assert mode == "file_api"


def test_unknown_size_defaults_inline():
    mode, _ = _select_input_mode("inline", None)
    assert mode == "inline"


# =========================================================================== #
# 7b — File API happy path
# =========================================================================== #
def test_file_api_happy_path(no_sleep):
    files = _Files(initial_state="PROCESSING", get_states=["PROCESSING", "ACTIVE"])
    client = FakeClient(models=_Models(text=GOOD_JSON), files=files)
    payload = _run(client=client, settings=_settings(input_mode="file_api"))
    assert validate_payload(payload, ["2b", "3c"]).ok is True
    assert files.upload_calls == 1
    assert files.get_calls == 2  # PROCESSING then ACTIVE
    assert len(client.models.calls) == 1
    # generate referenced the uploaded file handle, not inline_data
    parts = client.models.calls[0]["contents"][0]["parts"]
    assert "file_data" in parts[1]
    assert parts[1]["file_data"]["file_uri"] == "files/abc"


def test_file_api_and_inline_return_same_contract(no_sleep):
    # Identical fake model output via either path -> identical payload.
    file_client = FakeClient(models=_Models(text=GOOD_JSON), files=_Files(initial_state="ACTIVE"))
    inline_client = FakeClient(models=_Models(text=GOOD_JSON))
    file_payload = _run(client=file_client, settings=_settings(input_mode="file_api"))
    inline_payload = _run(client=inline_client, settings=_settings(input_mode="inline"))
    assert file_payload == inline_payload


# =========================================================================== #
# 7c — File API upload / activation failures
# =========================================================================== #
def test_file_api_upload_failed_state_raises_upload_error(no_sleep):
    files = _Files(initial_state="FAILED")
    client = FakeClient(files=files)
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=client, settings=_settings(input_mode="file_api"))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR
    assert is_fallback_mode(ei.value.analysis_mode) is True
    assert client.models.calls == []  # never generated


def test_file_api_upload_exception_raises_upload_error(no_sleep):
    files = _Files(upload_raises=RuntimeError("network down"))
    client = FakeClient(files=files)
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=client, settings=_settings(input_mode="file_api"))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR


def test_await_file_active_times_out_bounded(no_sleep):
    files = _Files(initial_state="PROCESSING", get_states=["PROCESSING"])
    client = FakeClient(files=files)
    file_ref = SimpleNamespace(name="files/x", uri="files/x", mime_type="video/mp4", state="PROCESSING")
    with pytest.raises(AnalysisProviderError) as ei:
        asyncio.run(_await_file_active(client, file_ref, timeout_s=6.0, poll_interval_s=2.0))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT
    assert is_fallback_mode(ei.value.analysis_mode) is True
    # bounded: 6s / 2s = 3 polls, not infinite
    assert files.get_calls <= 4


# =========================================================================== #
# 7d / 7e / 7f — bounded retry behavior
# =========================================================================== #
class _RateLimited(Exception):
    code = 429


def test_retry_succeeds_after_transient(no_sleep):
    models = _Models(text=GOOD_JSON, raises_sequence=[_RateLimited("429 quota"), None])
    client = FakeClient(models=models)
    payload = _run(client=client, settings=_settings(input_mode="inline"))
    assert validate_payload(payload, ["2b", "3c"]).ok is True
    assert len(models.calls) == 2  # one retry
    assert len(no_sleep) == 1  # backoff awaited once


def test_retry_exhaustion_raises_typed(no_sleep):
    models = _Models(raises_sequence=[asyncio.TimeoutError(), asyncio.TimeoutError(), asyncio.TimeoutError()])
    client = FakeClient(models=models)
    with pytest.raises(AnalysisProviderError) as ei:
        _run(client=client, settings=_settings(input_mode="inline"))
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT
    assert is_fallback_mode(ei.value.analysis_mode) is True
    assert len(models.calls) == GEMINI_MAX_ATTEMPTS  # exactly 3
    assert len(no_sleep) == GEMINI_MAX_ATTEMPTS - 1  # 2 backoffs before final


def test_no_retry_on_deterministic_error(no_sleep):
    err = AnalysisContractError("bad", analysis_mode="fallback_gemini_parse_error")
    models = _Models(raises_sequence=[err, None, None])
    client = FakeClient(models=models)
    with pytest.raises(AnalysisContractError):
        _run(client=client, settings=_settings(input_mode="inline"))
    assert len(models.calls) == 1  # NOT retried
    assert len(no_sleep) == 0


# =========================================================================== #
# 7g — determinism config lock
# =========================================================================== #
def test_generation_config_is_deterministic():
    assert GEMINI_GENERATION_CONFIG["temperature"] <= 0.2
    assert GEMINI_GENERATION_CONFIG["response_mime_type"] == "application/json"


# =========================================================================== #
# 7h — token logging
# =========================================================================== #
def test_token_logging_present(no_sleep, caplog):
    models = _Models(text=GOOD_JSON, usage=_Usage(1200, 300, 1500))
    client = FakeClient(models=models)
    with caplog.at_level(logging.INFO, logger="app.analysis.gemini_engine"):
        _run(client=client, settings=_settings(input_mode="inline"))
    line = next((r.getMessage() for r in caplog.records if "gemini_analysis_usage" in r.getMessage()), "")
    assert "prompt_tokens=1200" in line
    assert "output_tokens=300" in line
    assert "total_tokens=1500" in line


def test_token_logging_graceful_when_absent(no_sleep, caplog):
    models = _Models(text=GOOD_JSON, usage=None)  # response has no usage_metadata
    client = FakeClient(models=models)
    with caplog.at_level(logging.INFO, logger="app.analysis.gemini_engine"):
        payload = _run(client=client, settings=_settings(input_mode="inline"))
    assert validate_payload(payload, ["2b", "3c"]).ok is True  # still returns payload
    assert any("usage=unavailable" in r.getMessage() for r in caplog.records)


# =========================================================================== #
# 7i — idempotent upload (upload once, reuse across generate retries)
# =========================================================================== #
def test_upload_once_reused_across_generate_retries(no_sleep):
    files = _Files(initial_state="ACTIVE")
    models = _Models(text=GOOD_JSON, raises_sequence=[_RateLimited("429"), None])
    client = FakeClient(models=models, files=files)
    payload = _run(client=client, settings=_settings(input_mode="file_api"))
    assert validate_payload(payload, ["2b", "3c"]).ok is True
    assert files.upload_calls == 1  # uploaded ONCE
    assert len(models.calls) == 2  # generate retried, reusing the handle
