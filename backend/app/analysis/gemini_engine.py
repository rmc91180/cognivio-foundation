"""Gemini native-video analysis engine (WS1 Phases 1–3).

`analyze_video_with_gemini` sends a lesson video to Gemini and returns the EXACT
frozen analysis payload contract (`app/analysis/contracts.ANALYSIS_PAYLOAD_CONTRACT`)
— the same shape `server.py::_analyze_frames_with_openai` returns — so the existing
`_normalize_model_analysis` consumes it unchanged.

Phase 1: dormant behind the `analysis_provider` flag; returns the RAW payload only;
typed failures from `failures.py`; lazy SDK import behind the injectable `client` seam.

Phase 3 (robustness / determinism) — gemini path only, no behavior change at the
default openai flag:

  * AUTO size-based input selection: clips ``>= FILE_API_THRESHOLD_BYTES`` (20 MB)
    ride the File API; smaller clips stay inline. Explicit config ``file_api``
    forces the File API; inline never exceeds the hard inline cap.
  * Real File API path: upload -> await ACTIVE (bounded poll) -> generate-by-ref,
    feeding the SAME parse + contract tail as inline. Upload happens ONCE and the
    file handle is reused across generate retries (idempotent within a call).
  * Bounded retry: ``GEMINI_MAX_ATTEMPTS`` (3) attempts on TRANSIENT typed modes
    only (timeout, rate-limited) with full-jitter bounded backoff; parse/contract/
    unconfigured errors are NOT retried. Exhaustion raises the last typed error so
    the server dispatch falls through to OpenAI exactly as before.
  * One structured token-usage log line per successful analysis (measurement only).

Determinism: ``GEMINI_GENERATION_CONFIG`` pins ``temperature=0.0`` and
``response_mime_type="application/json"`` — same input + same (mocked) client =>
same output structure and analysis_mode.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import random
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Union

from app.analysis.contracts import ANALYSIS_PAYLOAD_JSON_SHAPE, validate_payload
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED,
    ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
    ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
    ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
    ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
    ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
    ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
    AnalysisContractError,
    AnalysisError,
    AnalysisParseError,
    AnalysisProviderError,
)

logger = logging.getLogger(__name__)

# Inline (base64) video is only viable for small clips. Hard cap from Gemini's
# inline-request limit; larger media must use the File API path.
INLINE_MAX_BYTES = 100 * 1024 * 1024  # 100 MB

# WS1 Phase 3: clips at/above this size ride the File API. Chosen as a
# conservative margin under the 100 MB inline cap that accounts for ~33% base64
# inflation, so we never gamble near the boundary. Consequence: the ~27 MB demo
# clip rides the File API path, validating the production path in the demo.
FILE_API_THRESHOLD_BYTES = 20 * 1024 * 1024  # 20 MB

# File API activation polling (bounded — never hangs).
FILE_API_ACTIVE_TIMEOUT_S = 120.0
FILE_API_POLL_INTERVAL_S = 2.0

# Bounded retry on TRANSIENT errors only. 1 initial + 2 retries.
GEMINI_MAX_ATTEMPTS = 3
GEMINI_RETRY_BASE_DELAY_S = 1.0
GEMINI_RETRY_MAX_DELAY_S = 8.0
# Worst-case added backoff latency = jittered sum of caps before the final
# attempt = min(8,1) + min(8,2) = up to 3.0s (full jitter => 0..3.0s).

# Fixed, low-temperature generation config for determinism. Passed as a plain
# dict so the engine does not import google-genai types at module load.
#
# DETERMINISM GUARANTEE: temperature=0.0 (greedy decoding) + response_mime_type
# "application/json" are what make the same input + same client yield the same
# output structure. Do NOT raise the temperature.
#
# TODO(WS1 later): the installed google-genai SDK exposes a `response_schema`
# config field, so output COULD be schema-constrained by construction. Deferred
# here because (a) the allowed element-id set varies per call (a fully-locked
# schema would need per-call enum construction + SDK type coupling) and (b) the
# json-mime + `_enforce_contract` path already rejects malformed/contract-
# violating output with distinct typed modes. Revisit once the Flash model's
# adherence to a nested per-call schema is confirmed against a live call.
GEMINI_GENERATION_CONFIG: Dict[str, Any] = {
    "temperature": 0.0,
    "top_p": 1.0,
    "response_mime_type": "application/json",
    "max_output_tokens": 4000,
}

_TRANSIENT_MODES = frozenset(
    {ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT, ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED}
)

_VIDEO_MIME_BY_SUFFIX = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".m4v": "video/mp4",
}


def _guess_video_mime(path: Optional[str]) -> str:
    if path:
        _, ext = os.path.splitext(str(path).lower())
        if ext in _VIDEO_MIME_BY_SUFFIX:
            return _VIDEO_MIME_BY_SUFFIX[ext]
    return "video/mp4"


def _source_size_bytes(video_path_or_bytes: Union[str, bytes, "os.PathLike[str]", None]) -> Optional[int]:
    """Cheap size probe: stat for a path (no full read), len for bytes."""

    if video_path_or_bytes is None:
        return None
    if isinstance(video_path_or_bytes, (bytes, bytearray)):
        return len(video_path_or_bytes)
    try:
        return os.path.getsize(os.fspath(video_path_or_bytes))
    except OSError:
        return None


def _select_input_mode(config_mode: str, size_bytes: Optional[int]) -> tuple[str, str]:
    """Auto-select 'inline' vs 'file_api' by size (the 20 MB threshold is the
    primary rule). Returns (mode, human-readable note).

    - explicit config 'file_api' -> always file_api.
    - size unknown -> inline (safe default; the coercer still guards the cap).
    - size >= FILE_API_THRESHOLD_BYTES -> file_api (an explicit 'inline' is
      auto-upgraded here so we never silently exceed the inline cap).
    - otherwise -> inline.
    """

    mode = (config_mode or "inline").strip().lower()
    if mode == "file_api":
        return "file_api", "config override: file_api"
    if size_bytes is None:
        return "inline", "size unknown; defaulting to inline"
    if size_bytes >= FILE_API_THRESHOLD_BYTES:
        if mode == "inline":
            return (
                "file_api",
                f"explicit 'inline' auto-upgraded: {size_bytes}B >= {FILE_API_THRESHOLD_BYTES}B -> file_api",
            )
        return "file_api", f"auto: {size_bytes}B >= {FILE_API_THRESHOLD_BYTES}B threshold -> file_api"
    return "inline", f"auto: {size_bytes}B < {FILE_API_THRESHOLD_BYTES}B threshold -> inline"


def _coerce_video_bytes(
    video_path_or_bytes: Union[str, bytes, "os.PathLike[str]", None],
) -> bytes:
    """Return the raw video bytes for inline upload, or raise a typed error."""

    if video_path_or_bytes is None:
        raise AnalysisProviderError(
            "No video source provided to the Gemini engine.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )
    if isinstance(video_path_or_bytes, (bytes, bytearray)):
        data = bytes(video_path_or_bytes)
    else:
        path = os.fspath(video_path_or_bytes)
        if not os.path.exists(path):
            raise AnalysisProviderError(
                f"Video source not found: {path!r}",
                analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
            )
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError as exc:
            raise AnalysisProviderError(
                f"Could not read video source {path!r}: {exc}",
                analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
            ) from exc
    if not data:
        raise AnalysisProviderError(
            "Video source is empty.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )
    if len(data) > INLINE_MAX_BYTES:
        # Defensive: the size selector routes >= 20 MB to the File API, so the
        # inline path should only ever see small clips. If we still got here,
        # fail loud rather than silently exceed the inline cap.
        raise AnalysisProviderError(
            f"Video is {len(data)} bytes, exceeding the {INLINE_MAX_BYTES}-byte inline cap; "
            "the File API path should have been selected.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
        )
    return data


def _build_prompt(
    *,
    elements_to_analyze: Sequence[Mapping[str, Any]],
    focus_instruction: Optional[str],
    language: str,
    allowed_ids: Sequence[str],
) -> str:
    elements_text = "\n".join(
        f"- {element['id']}: {element.get('name', '')}"
        f" (Domain: {element.get('domain', '')})"
        f"{' [PRIORITY]' if element.get('priority') else ''}"
        for element in elements_to_analyze
    )
    focus_text = (focus_instruction or "").strip()
    allowed_list = ", ".join(str(eid) for eid in allowed_ids)
    json_shape = ANALYSIS_PAYLOAD_JSON_SHAPE.replace("{allowed_ids}", allowed_list)
    language_line = (
        "Write every text field in natural Hebrew coaching language."
        if str(language or "").lower().startswith("he")
        else "Write every text field in warm, specific English coaching language."
    )
    return f"""
You just watched this lesson recording. Write coaching feedback for the teacher,
addressed directly to "you", grounded in specific visible moments with timestamps.
{language_line}

Rubric areas to address (use ONLY these element ids — no others):
{elements_text}

Allowed element ids: {allowed_list}

Assess EVERY rubric area above for which you observed specific, timestamped
evidence in the recording. Provide a balanced mix of STRENGTHS and GROWTH AREAS —
a teacher learns from both. Produce a distinct takeaway for each area you
genuinely observed; a typical rich lesson yields four to five. Do NOT invent,
stretch, or pad evidence: every observation must cite a real moment you actually
saw, with timestamps. If you genuinely observed evidence for only two areas,
return two — fewer honest takeaways are better than manufactured ones.

{focus_text}

Return ONLY valid JSON with EXACTLY this shape (no prose, no markdown fences):
{json_shape}
""".strip()


def _classify_provider_exception(exc: BaseException) -> AnalysisProviderError:
    """Map an SDK/transport exception to a typed, distinct provider error."""

    text = str(exc).lower()
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)

    is_timeout = isinstance(exc, (asyncio.TimeoutError, TimeoutError)) or any(
        token in text for token in ("timeout", "timed out", "deadline")
    )
    if is_timeout:
        return AnalysisProviderError(
            f"Gemini request timed out: {exc}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
        )

    is_rate_limited = (
        code == 429
        or "429" in text
        or "rate limit" in text
        or "ratelimit" in text
        or "resource_exhausted" in text
        or "resource exhausted" in text
        or "quota" in text
    )
    if is_rate_limited:
        return AnalysisProviderError(
            f"Gemini request was rate-limited: {exc}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
        )

    # Anything else that broke the call is a generic provider error (the base
    # AnalysisProviderError default mode is fallback_model_error).
    return AnalysisProviderError(f"Gemini provider error: {exc}")


def _extract_json_object(text: str) -> Dict[str, Any]:
    """Parse a JSON object from model output, tolerating markdown code fences."""

    if not text or not str(text).strip():
        raise AnalysisParseError(
            "Gemini returned empty output.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
        )
    cleaned = str(text).strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned[:4].lower() == "json":
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError) as exc:
        raise AnalysisParseError(
            f"Gemini output was not valid JSON: {exc}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
        ) from exc
    if not isinstance(parsed, dict):
        raise AnalysisParseError(
            "Gemini output JSON was not an object.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
        )
    return parsed


def _enforce_contract(payload: Dict[str, Any], allowed_ids: Sequence[str]) -> Dict[str, Any]:
    """Run the frozen payload contract and raise a DISTINCT typed error per cause."""

    allowed = {str(eid) for eid in allowed_ids}
    result = validate_payload(payload, allowed)
    if result.ok:
        return payload

    codes = result.errors

    if "empty_element_scores" in codes:
        raise AnalysisContractError(
            f"Gemini payload had no element_scores: {codes}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
        )

    raw_scores = payload.get("element_scores")
    if isinstance(raw_scores, list) and raw_scores:
        valid = [
            score
            for score in raw_scores
            if isinstance(score, Mapping)
            and str(score.get("element_id") or "").strip() in allowed
        ]
        if not valid:
            raise AnalysisContractError(
                f"All Gemini element_scores referenced unknown element ids: {codes}",
                analysis_mode=ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED,
            )

    raise AnalysisContractError(
        f"Gemini payload violated the analysis contract: {codes}",
        analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
    )


# --------------------------------------------------------------------------- #
# Generate wrappers — kept tiny so the mock seam is obvious.
# --------------------------------------------------------------------------- #
async def _generate_content(client: Any, *, model: str, prompt: str, video_bytes: bytes, mime_type: str) -> Any:
    """Inline generate: video sent as inline_data (SDK base64-encodes on the wire)."""

    contents = [
        {
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": video_bytes}},
            ],
        }
    ]
    return await client.aio.models.generate_content(
        model=model,
        contents=contents,
        config=GEMINI_GENERATION_CONFIG,
    )


async def _generate_content_file_api(client: Any, *, model: str, prompt: str, file_ref: Any) -> Any:
    """File API generate: the video part references the uploaded file handle."""

    file_uri = getattr(file_ref, "uri", None) or getattr(file_ref, "name", None)
    mime_type = getattr(file_ref, "mime_type", None) or "video/mp4"
    contents = [
        {
            "role": "user",
            "parts": [
                {"text": prompt},
                {"file_data": {"file_uri": file_uri, "mime_type": mime_type}},
            ],
        }
    ]
    return await client.aio.models.generate_content(
        model=model,
        contents=contents,
        config=GEMINI_GENERATION_CONFIG,
    )


# --------------------------------------------------------------------------- #
# File API upload + activation (the single mockable points for the file path).
# Verified against google-genai (installed): client.aio.files.upload(file=,
# config={"mime_type": ...}) -> File{name, uri, state, mime_type};
# client.aio.files.get(name=...) re-fetches state; FileState enum has
# ACTIVE / FAILED / PROCESSING.
# --------------------------------------------------------------------------- #
async def _upload_video_file(client: Any, *, path_or_bytes: Any, mime_type: str) -> Any:
    """Upload the source video via the File API. Raises a typed upload error."""

    try:
        if isinstance(path_or_bytes, (bytes, bytearray)):
            file_arg: Any = io.BytesIO(bytes(path_or_bytes))
        else:
            file_arg = os.fspath(path_or_bytes)
        return await client.aio.files.upload(file=file_arg, config={"mime_type": mime_type})
    except AnalysisError:
        raise
    except BaseException as exc:  # noqa: BLE001 — typed upload error
        raise AnalysisProviderError(
            f"Gemini File API upload failed: {exc}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
        ) from exc


def _file_state_name(file_ref: Any) -> str:
    state = getattr(file_ref, "state", None)
    if state is None:
        return ""
    return str(getattr(state, "name", state)).upper()


async def _await_file_active(
    client: Any,
    file_ref: Any,
    *,
    timeout_s: float = FILE_API_ACTIVE_TIMEOUT_S,
    poll_interval_s: float = FILE_API_POLL_INTERVAL_S,
) -> Any:
    """Poll until the uploaded file is ACTIVE. Bounded — never hangs.

    Raises a typed upload error on FAILED state, and a typed timeout error if it
    does not become ACTIVE within ``timeout_s``. Elapsed is tracked by the poll
    interval (not wall-clock) so the bound is deterministic under a patched
    ``asyncio.sleep`` in tests.
    """

    current = file_ref
    elapsed = 0.0
    while True:
        state = _file_state_name(current)
        if state == "ACTIVE":
            return current
        if state == "FAILED":
            raise AnalysisProviderError(
                f"Gemini File API reported FAILED for {getattr(current, 'name', '?')}.",
                analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
            )
        if elapsed >= timeout_s:
            raise AnalysisProviderError(
                f"Gemini File API file did not become ACTIVE within {timeout_s}s "
                f"(last state={state or 'unknown'}).",
                analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
            )
        await asyncio.sleep(poll_interval_s)
        elapsed += poll_interval_s
        try:
            current = await client.aio.files.get(name=getattr(current, "name", None))
        except AnalysisError:
            raise
        except BaseException as exc:  # noqa: BLE001 — typed upload error
            raise AnalysisProviderError(
                f"Gemini File API state poll failed: {exc}",
                analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
            ) from exc


# --------------------------------------------------------------------------- #
# Bounded retry (transient-only) with full-jitter backoff.
# --------------------------------------------------------------------------- #
def _retry_backoff_delay(attempt: int) -> float:
    cap = min(GEMINI_RETRY_MAX_DELAY_S, GEMINI_RETRY_BASE_DELAY_S * (2 ** (attempt - 1)))
    return random.uniform(0.0, cap)


async def _generate_with_retry(generate_call: Callable[[], Awaitable[Any]]) -> Any:
    """Run ``generate_call`` with bounded retries on TRANSIENT typed modes only
    (timeout / rate-limited). Parse/contract/unconfigured errors are NOT retried.
    On exhaustion raises the LAST typed error (preserving its mode) so the server
    dispatch falls through to OpenAI unchanged."""

    for attempt in range(1, GEMINI_MAX_ATTEMPTS + 1):
        try:
            return await generate_call()
        except BaseException as exc:  # noqa: BLE001 — re-raised as typed below
            typed = exc if isinstance(exc, AnalysisError) else _classify_provider_exception(exc)
            mode = getattr(typed, "analysis_mode", None)
            transient = mode in _TRANSIENT_MODES
            if not transient or attempt >= GEMINI_MAX_ATTEMPTS:
                if transient:
                    logger.error(
                        "Gemini generate exhausted %d/%d attempts (mode=%s); failing typed",
                        attempt,
                        GEMINI_MAX_ATTEMPTS,
                        mode,
                    )
                if typed is exc:
                    raise
                raise typed from exc
            delay = _retry_backoff_delay(attempt)
            logger.warning(
                "Gemini generate attempt %d/%d failed (mode=%s); retrying in %.2fs",
                attempt,
                GEMINI_MAX_ATTEMPTS,
                mode,
                delay,
            )
            await asyncio.sleep(delay)
    # Unreachable: the loop either returns or raises on the final attempt.
    raise AnalysisProviderError("Gemini generate retry loop exited unexpectedly.")


# --------------------------------------------------------------------------- #
# Token / cost measurement (log only; never changes the return contract).
# --------------------------------------------------------------------------- #
def _log_usage(response: Any, *, model: str, input_mode: str, video_bytes: Optional[int]) -> None:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        logger.info(
            "gemini_analysis_usage model=%s input_mode=%s video_bytes=%s usage=unavailable",
            model,
            input_mode,
            video_bytes,
        )
        return
    logger.info(
        "gemini_analysis_usage model=%s input_mode=%s video_bytes=%s "
        "prompt_tokens=%s output_tokens=%s total_tokens=%s",
        model,
        input_mode,
        video_bytes,
        getattr(usage, "prompt_token_count", None),
        getattr(usage, "candidates_token_count", None),
        getattr(usage, "total_token_count", None),
    )


def _build_real_client(settings: Any) -> Any:
    """Construct the real google-genai client. Imported LAZILY so the module
    stays import-pure and the test suite (which injects a fake) never builds it."""

    api_key = (getattr(settings.ai, "gemini_api_key", "") or "").strip()
    if not api_key:
        raise AnalysisProviderError(
            "GEMINI_API_KEY is not configured.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )
    from google import genai  # lazy: never imported during mocked tests

    return genai.Client(api_key=api_key)


async def analyze_video_with_gemini(
    *,
    video_path_or_bytes: Union[str, bytes, "os.PathLike[str]", None],
    elements_to_analyze: List[Mapping[str, Any]],
    focus_instruction: Optional[str] = None,
    language: str = "en",
    settings: Any,
    client: Any = None,
) -> Dict[str, Any]:
    """Analyze a lesson video with Gemini and return the frozen payload contract.

    Inline for clips < 20 MB; File API for >= 20 MB (or explicit config
    ``file_api``). The model-generate step is retried on transient errors; the
    upload (when used) happens once and is reused across generate retries. The
    function returns the RAW payload only (no normalization, no moments).

    Raises:
        AnalysisProviderError: unconfigured, upload failure / activation timeout,
            transport timeout, rate-limit (after retries), or other transport error.
        AnalysisParseError: output was not valid JSON.
        AnalysisContractError: parsed JSON violated the frozen payload contract.
    """

    model = (getattr(settings.ai, "gemini_model", "") or "").strip()
    if not model:
        raise AnalysisProviderError(
            "GEMINI_MODEL is not configured.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )

    allowed_ids = [str(element["id"]) for element in elements_to_analyze if element.get("id") is not None]

    # AUTO size-based input selection (20 MB threshold).
    config_mode = (getattr(settings.ai, "gemini_video_input_mode", "inline") or "inline").strip().lower()
    size_bytes = _source_size_bytes(video_path_or_bytes)
    effective_mode, mode_note = _select_input_mode(config_mode, size_bytes)
    logger.info(
        "gemini_input_mode model=%s effective_mode=%s size_bytes=%s (%s)",
        model,
        effective_mode,
        size_bytes,
        mode_note,
    )

    mime_type = _guess_video_mime(video_path_or_bytes if isinstance(video_path_or_bytes, str) else None)

    if client is None:
        client = _build_real_client(settings)

    prompt = _build_prompt(
        elements_to_analyze=elements_to_analyze,
        focus_instruction=focus_instruction,
        language=language,
        allowed_ids=allowed_ids,
    )

    if effective_mode == "file_api":
        # Upload ONCE (outside the retry loop) and reuse the handle across
        # generate retries — idempotent within this single invocation.
        file_ref = await _upload_video_file(client, path_or_bytes=video_path_or_bytes, mime_type=mime_type)
        file_ref = await _await_file_active(client, file_ref)

        async def _do_generate() -> Any:
            return await _generate_content_file_api(client, model=model, prompt=prompt, file_ref=file_ref)
    else:
        video_bytes = _coerce_video_bytes(video_path_or_bytes)

        async def _do_generate() -> Any:
            return await _generate_content(
                client, model=model, prompt=prompt, video_bytes=video_bytes, mime_type=mime_type
            )

    # Retry ONLY the generate step on transient errors.
    response = await _generate_with_retry(_do_generate)

    # Measurement only — never alters the return contract.
    _log_usage(response, model=model, input_mode=effective_mode, video_bytes=size_bytes)

    text = getattr(response, "text", None)
    payload = _extract_json_object(text)
    payload = _enforce_contract(payload, allowed_ids)
    return payload


__all__ = [
    "analyze_video_with_gemini",
    "GEMINI_GENERATION_CONFIG",
    "INLINE_MAX_BYTES",
    "FILE_API_THRESHOLD_BYTES",
    "FILE_API_ACTIVE_TIMEOUT_S",
    "FILE_API_POLL_INTERVAL_S",
    "GEMINI_MAX_ATTEMPTS",
    "GEMINI_RETRY_BASE_DELAY_S",
    "GEMINI_RETRY_MAX_DELAY_S",
]
