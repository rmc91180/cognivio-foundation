"""Gemini native-video analysis engine (WS1 Phase 1).

`analyze_video_with_gemini` sends a lesson video to Gemini and returns the EXACT
frozen analysis payload contract (`app/analysis/contracts.ANALYSIS_PAYLOAD_CONTRACT`)
— the same shape `server.py::_analyze_frames_with_openai` returns — so the existing
`_normalize_model_analysis` consumes it unchanged.

Phase 1 discipline:

  * This engine is wired behind the dormant `analysis_provider` flag (default
    "openai"); it does NOT run in production this phase.
  * It returns the RAW payload only. It does NOT normalize and does NOT build
    moments (moment-path integration is Phase 2).
  * Every failure maps to a DISTINCT, typed exception from
    `app/analysis/failures.py` carrying the precise fallback `analysis_mode`.
    Nothing is ever silently degraded to a mock or disguised as success.
  * The real `google-genai` SDK is imported LAZILY and only when constructing a
    real client (i.e. when no client is injected). Tests always inject a fake
    client through the `client` seam, so the test suite performs NO network I/O
    and does not even import the SDK.

Determinism: generation uses ``temperature=0.0`` and ``response_mime_type=
"application/json"`` (see :data:`GEMINI_GENERATION_CONFIG`) so the same input +
the same (mocked) client yields stable output.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union

from app.analysis.contracts import ANALYSIS_PAYLOAD_JSON_SHAPE, validate_payload
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED,
    ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
    ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
    ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
    ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
    ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
    AnalysisContractError,
    AnalysisParseError,
    AnalysisProviderError,
)

# Inline (base64) video is only viable for small clips; Gemini's File API path
# is required for larger media and is deferred to a later phase.
INLINE_MAX_BYTES = 100 * 1024 * 1024  # 100 MB

# Fixed, low-temperature generation config for determinism. Passed as a plain
# dict so the engine does not need to import google-genai types at module load.
GEMINI_GENERATION_CONFIG: Dict[str, Any] = {
    "temperature": 0.0,
    "top_p": 1.0,
    "response_mime_type": "application/json",
    "max_output_tokens": 4000,
}

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
        raise AnalysisProviderError(
            f"Video is {len(data)} bytes, exceeding the {INLINE_MAX_BYTES}-byte inline limit; "
            "use the File API input mode (not implemented this phase).",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
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
        # Strip ```json ... ``` fences.
        cleaned = cleaned.strip("`")
        if cleaned[:4].lower() == "json":
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    # Narrow to the outermost object if the model added stray text.
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

    # Empty / missing element_scores.
    if "empty_element_scores" in codes:
        raise AnalysisContractError(
            f"Gemini payload had no element_scores: {codes}",
            analysis_mode=ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
        )

    # All provided element_scores reference ids outside the allowed set → every
    # one would be dropped by the normalizer.
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

    # Any other contract violation (missing summary, malformed segments, etc.).
    raise AnalysisContractError(
        f"Gemini payload violated the analysis contract: {codes}",
        analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
    )


async def _generate_content(client: Any, *, model: str, prompt: str, video_bytes: bytes, mime_type: str) -> Any:
    """Call the (real or injected) client's async generate_content with the
    inline video part. Kept tiny so the mock seam is obvious."""

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

    Args:
        video_path_or_bytes: local path or raw bytes of the source video.
        elements_to_analyze: the rubric elements (each a dict with at least
            ``id``); their ids are the ONLY allowed ``element_id`` values.
        focus_instruction: optional combined focus/context text for the prompt.
        language: "en" or "he" (controls the coach-voice language line).
        settings: the resolved ``Settings`` object (reads ``settings.ai.*``).
        client: OPTIONAL injected client (the test seam). When None, the real
            google-genai client is built lazily from settings.

    Returns:
        The raw analysis payload dict (summary, recommendations, element_scores)
        — the SAME shape `_analyze_frames_with_openai` returns. Does NOT
        normalize and does NOT build moments.

    Raises:
        AnalysisProviderError: model unconfigured, file_api mode (stub),
            timeout, rate-limit, or any transport failure.
        AnalysisParseError: output was not valid JSON.
        AnalysisContractError: parsed JSON violated the frozen payload contract.
    """

    # 1) Model id must be configured.
    model = (getattr(settings.ai, "gemini_model", "") or "").strip()
    if not model:
        raise AnalysisProviderError(
            "GEMINI_MODEL is not configured.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )

    # 2) Resolve the video input mode. Only inline is implemented this phase.
    input_mode = (getattr(settings.ai, "gemini_video_input_mode", "inline") or "inline").strip().lower()
    if input_mode == "file_api":
        # Clearly-marked NotImplemented stub — fail loud, do not build it now.
        raise AnalysisProviderError(
            "gemini_video_input_mode='file_api' is not implemented yet (deferred to a later phase).",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )
    if input_mode != "inline":
        raise AnalysisProviderError(
            f"Unsupported gemini_video_input_mode={input_mode!r} (expected 'inline').",
            analysis_mode=ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        )

    allowed_ids = [str(element["id"]) for element in elements_to_analyze if element.get("id") is not None]

    # 3) Prepare the inline video bytes (raises typed errors on bad source/size).
    video_bytes = _coerce_video_bytes(video_path_or_bytes)
    mime_type = _guess_video_mime(
        video_path_or_bytes if isinstance(video_path_or_bytes, str) else None
    )

    # 4) Build the client if one was not injected (tests always inject).
    if client is None:
        client = _build_real_client(settings)

    prompt = _build_prompt(
        elements_to_analyze=elements_to_analyze,
        focus_instruction=focus_instruction,
        language=language,
        allowed_ids=allowed_ids,
    )

    # 5) Call the model; classify any transport failure into a distinct mode.
    try:
        response = await _generate_content(
            client, model=model, prompt=prompt, video_bytes=video_bytes, mime_type=mime_type
        )
    except (AnalysisProviderError, AnalysisParseError, AnalysisContractError):
        raise
    except BaseException as exc:  # noqa: BLE001 — re-raised as a typed provider error
        raise _classify_provider_exception(exc) from exc

    # 6) Parse JSON, then enforce the frozen contract (distinct mode per cause).
    text = getattr(response, "text", None)
    payload = _extract_json_object(text)
    payload = _enforce_contract(payload, allowed_ids)

    # 7) Success — return the raw payload only.
    return payload


__all__ = [
    "analyze_video_with_gemini",
    "GEMINI_GENERATION_CONFIG",
    "INLINE_MAX_BYTES",
]
