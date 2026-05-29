"""Browser-playable video validation (PR C9.3).

The destructive privacy blur worker renders its redacted output through
OpenCV's ``cv2.VideoWriter`` using the ``mp4v`` FOURCC. ``mp4v`` is MPEG-4
Part 2 (DivX-era) video, which most browsers cannot decode — so a redacted
asset can be "stored" and yet play as a frozen / black frame for teachers.

This module provides a *validation* helper that inspects a rendered asset and
decides whether it is actually browser-playable, plus a small pure helper that
detects whether an MP4 has its ``moov`` atom up front (``+faststart``).

Design constraints:

- **No hard dependency on ffprobe.** ffprobe is frequently absent (CI, local
  dev). The validator accepts an injectable ``probe`` callable so it is fully
  unit-testable, and when no probe tool can be found it returns
  ``status="skipped_unavailable"`` / ``failure_code="ffprobe_unavailable"`` and
  **never** reports ``browser_compatible=True``. We never *falsely* assert a
  redacted asset is playable.
- **Never weaken privacy.** This module only reads/inspects; it never deletes
  source assets and never exposes raw video.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.services.storage_urls import is_probably_http_url

__all__ = [
    "PLAYBACK_VALIDATION_STATUSES",
    "PLAYBACK_VALIDATION_FAILURE_CODES",
    "BROWSER_COMPATIBLE_VIDEO_CODECS",
    "BROWSER_COMPATIBLE_PIX_FMTS",
    "BROWSER_COMPATIBLE_AUDIO_CODECS",
    "PlaybackValidationResult",
    "ProbeCallable",
    "find_ffprobe",
    "detect_mp4_faststart",
    "validate_browser_playback_asset",
]

# Stable strings — persisted on the video document and read by audit/smoke.
PLAYBACK_VALIDATION_STATUSES: Tuple[str, ...] = (
    "passed",
    "failed",
    "skipped_unavailable",
)

PLAYBACK_VALIDATION_FAILURE_CODES: Tuple[str, ...] = (
    "no_video_stream",
    "unsupported_video_codec",
    "zero_duration",
    "unreadable_asset",
    "frozen_or_single_frame",
    "ffprobe_unavailable",
)

# H.264 is the lingua-franca for ``<video>`` in an MP4 container. VP8/VP9/AV1
# are accepted because modern browsers decode them, but H.264 remains preferred
# (and is what the browser-safe render targets). ``mpeg4`` / ``mp4v`` (the
# OpenCV default) is deliberately NOT here — that is the bug this PR fixes.
BROWSER_COMPATIBLE_VIDEO_CODECS: Tuple[str, ...] = (
    "h264",
    "avc1",
    "vp9",
    "vp8",
    "av1",
    "av01",
)

# 8-bit 4:2:0 is the only chroma layout broadly decodable in browsers. ``yuvj420p``
# is the full-range JPEG variant and is treated as equivalent here.
BROWSER_COMPATIBLE_PIX_FMTS: Tuple[str, ...] = (
    "yuv420p",
    "yuvj420p",
)

# Audio is optional. When present it must be a browser-decodable codec.
BROWSER_COMPATIBLE_AUDIO_CODECS: Tuple[str, ...] = (
    "aac",
    "mp3",
    "opus",
    "vorbis",
)

# ffprobe ``format.format_name`` is a comma list; we only require that one of the
# MP4 family names is present.
_MP4_CONTAINER_NAMES: Tuple[str, ...] = (
    "mp4",
    "mov",
    "m4a",
    "3gp",
    "3g2",
    "mj2",
    "isom",
)

ProbeCallable = Callable[[str], Optional[Dict[str, Any]]]


@dataclass
class PlaybackValidationResult:
    """Outcome of inspecting a rendered asset for browser playability."""

    status: str  # one of PLAYBACK_VALIDATION_STATUSES
    expected_kind: str = "redacted"
    browser_compatible: bool = False
    failure_code: Optional[str] = None
    message: Optional[str] = None
    probe_tool: Optional[str] = None
    # Diagnostic fields (best-effort; may be None when probe is unavailable).
    video_codec: Optional[str] = None
    audio_codec: Optional[str] = None
    pix_fmt: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_sec: Optional[float] = None
    nb_frames: Optional[int] = None
    container: Optional[str] = None
    has_faststart: Optional[bool] = None
    warnings: List[str] = field(default_factory=list)
    checked_at: Optional[str] = None

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    @property
    def is_playback_ready(self) -> bool:
        """True only when the asset is confirmed browser-playable.

        ``skipped_unavailable`` is **not** ready — we never treat an
        un-probed asset as confirmed safe.
        """
        return self.status == "passed" and self.browser_compatible

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "expected_kind": self.expected_kind,
            "browser_compatible": self.browser_compatible,
            "failure_code": self.failure_code,
            "message": self.message,
            "probe_tool": self.probe_tool,
            "video_codec": self.video_codec,
            "audio_codec": self.audio_codec,
            "pix_fmt": self.pix_fmt,
            "width": self.width,
            "height": self.height,
            "duration_sec": self.duration_sec,
            "nb_frames": self.nb_frames,
            "container": self.container,
            "has_faststart": self.has_faststart,
            "warnings": list(self.warnings),
            "checked_at": self.checked_at,
        }


def find_ffprobe() -> Optional[str]:
    """Return the ffprobe executable path, or ``None`` when absent."""
    return shutil.which("ffprobe")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_ffprobe(path: str, *, ffprobe_path: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
    """Invoke the real ffprobe binary and return parsed JSON, or None."""
    cmd = [
        ffprobe_path,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    raw = (completed.stdout or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def detect_mp4_faststart(path: str, *, max_scan_bytes: int = 1_000_000) -> Optional[bool]:
    """Best-effort check whether an MP4 has ``moov`` before ``mdat``.

    Reads only the top-level box headers from the front of the file. Returns:

    - ``True``  — ``moov`` atom appears before ``mdat`` (web-optimized).
    - ``False`` — ``mdat`` appears first (not faststart).
    - ``None``  — could not determine (not a local file, too short, unknown
      layout). Callers treat ``None`` as "unknown", never as a hard failure.
    """
    if not path or is_probably_http_url(path):
        return None
    try:
        if not os.path.isfile(path):
            return None
        with open(path, "rb") as handle:
            scanned = 0
            while scanned < max_scan_bytes:
                header = handle.read(8)
                if len(header) < 8:
                    return None
                size = int.from_bytes(header[0:4], "big")
                box_type = header[4:8]
                if box_type == b"moov":
                    return True
                if box_type == b"mdat":
                    return False
                if size == 1:
                    # 64-bit extended size.
                    ext = handle.read(8)
                    if len(ext) < 8:
                        return None
                    size = int.from_bytes(ext, "big")
                    body = max(0, size - 16)
                elif size == 0:
                    # Box extends to EOF — nothing useful after it.
                    return None
                else:
                    body = max(0, size - 8)
                if body <= 0:
                    return None
                handle.seek(body, os.SEEK_CUR)
                scanned += size if size > 0 else 8
    except OSError:
        return None
    return None


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _first_video_stream(streams: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == "video":
            return stream
    return None


def _first_audio_stream(streams: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == "audio":
            return stream
    return None


def _container_is_mp4(format_name: Optional[str]) -> bool:
    if not format_name:
        return False
    names = {part.strip().lower() for part in str(format_name).split(",") if part.strip()}
    return any(name in names for name in _MP4_CONTAINER_NAMES)


def validate_browser_playback_asset(
    local_path_or_url: Optional[str],
    *,
    expected_kind: str = "redacted",
    probe: Optional[ProbeCallable] = None,
    ffprobe_path: Optional[str] = None,
) -> PlaybackValidationResult:
    """Validate whether an asset is browser-playable.

    Parameters
    ----------
    local_path_or_url:
        A local filesystem path or an ``http(s)://`` URL to inspect.
    expected_kind:
        Logical asset kind (``"redacted"`` for teacher playback). Recorded for
        diagnostics only.
    probe:
        Optional injectable callable taking the path and returning ffprobe-style
        JSON (``{"streams": [...], "format": {...}}``) or ``None``. When omitted
        the real ffprobe binary is used if present.
    ffprobe_path:
        Override for the ffprobe binary location (mainly for tests).

    Returns a :class:`PlaybackValidationResult`. When no probe tool is available
    the result is ``status="skipped_unavailable"`` with
    ``failure_code="ffprobe_unavailable"`` and ``browser_compatible=False`` — we
    never claim playability we could not verify.
    """
    checked_at = _now_iso()

    if not local_path_or_url or not isinstance(local_path_or_url, str):
        return PlaybackValidationResult(
            status="failed",
            expected_kind=expected_kind,
            failure_code="unreadable_asset",
            message="asset path missing or not a string",
            checked_at=checked_at,
        )

    path = local_path_or_url.strip()
    is_url = is_probably_http_url(path)

    # Resolve the probe callable. Injected probe wins; otherwise locate ffprobe.
    probe_tool: Optional[str] = None
    probe_callable: Optional[ProbeCallable] = probe
    if probe_callable is not None:
        probe_tool = "injected"
    else:
        resolved = ffprobe_path or find_ffprobe()
        if resolved:
            probe_tool = "ffprobe"

            def _probe(p: str, _bin: str = resolved) -> Optional[Dict[str, Any]]:
                return _run_ffprobe(p, ffprobe_path=_bin)

            probe_callable = _probe

    if probe_callable is None:
        return PlaybackValidationResult(
            status="skipped_unavailable",
            expected_kind=expected_kind,
            browser_compatible=False,
            failure_code="ffprobe_unavailable",
            message="ffprobe not available; playability could not be verified",
            checked_at=checked_at,
        )

    # Local files must exist before we bother probing.
    if not is_url and not os.path.isfile(path):
        return PlaybackValidationResult(
            status="failed",
            expected_kind=expected_kind,
            failure_code="unreadable_asset",
            message="asset file does not exist",
            probe_tool=probe_tool,
            checked_at=checked_at,
        )

    try:
        probe_data = probe_callable(path)
    except Exception:  # noqa: BLE001 - any probe failure means unreadable
        probe_data = None

    if not isinstance(probe_data, dict) or not probe_data:
        return PlaybackValidationResult(
            status="failed",
            expected_kind=expected_kind,
            failure_code="unreadable_asset",
            message="probe returned no usable metadata",
            probe_tool=probe_tool,
            checked_at=checked_at,
        )

    streams = probe_data.get("streams")
    if not isinstance(streams, list):
        streams = []
    fmt = probe_data.get("format")
    if not isinstance(fmt, dict):
        fmt = {}

    video_stream = _first_video_stream(streams)
    audio_stream = _first_audio_stream(streams)

    container_name = fmt.get("format_name")
    container_is_mp4 = _container_is_mp4(container_name)

    # Compute duration: prefer format duration, fall back to video stream.
    duration = _coerce_float(fmt.get("duration"))
    if (duration is None or duration <= 0) and video_stream is not None:
        duration = _coerce_float(video_stream.get("duration"))

    # Faststart is a soft signal — only attempted for local files.
    has_faststart = detect_mp4_faststart(path) if not is_url else None

    base_kwargs: Dict[str, Any] = {
        "expected_kind": expected_kind,
        "probe_tool": probe_tool,
        "container": container_name,
        "has_faststart": has_faststart,
        "checked_at": checked_at,
    }

    if video_stream is None:
        return PlaybackValidationResult(
            status="failed",
            failure_code="no_video_stream",
            message="no video stream present in asset",
            audio_codec=(audio_stream or {}).get("codec_name"),
            duration_sec=duration,
            **base_kwargs,
        )

    video_codec = (video_stream.get("codec_name") or "").strip().lower() or None
    pix_fmt = (video_stream.get("pix_fmt") or "").strip().lower() or None
    width = _coerce_int(video_stream.get("width"))
    height = _coerce_int(video_stream.get("height"))
    nb_frames = _coerce_int(video_stream.get("nb_frames"))
    audio_codec = (audio_stream.get("codec_name") or "").strip().lower() if audio_stream else None

    result = PlaybackValidationResult(
        status="failed",
        video_codec=video_codec,
        audio_codec=audio_codec,
        pix_fmt=pix_fmt,
        width=width,
        height=height,
        duration_sec=duration,
        nb_frames=nb_frames,
        **base_kwargs,
    )

    # --- Hard checks (ordered) ---------------------------------------------
    if duration is None or duration <= 0:
        result.failure_code = "zero_duration"
        result.message = "asset has zero or unknown duration"
        return result

    if not width or not height or width <= 0 or height <= 0:
        result.failure_code = "unsupported_video_codec"
        result.message = "video stream has invalid dimensions"
        return result

    if nb_frames is not None and nb_frames <= 1:
        result.failure_code = "frozen_or_single_frame"
        result.message = "video has a single frame (frozen)"
        return result

    if not video_codec or video_codec not in BROWSER_COMPATIBLE_VIDEO_CODECS:
        result.failure_code = "unsupported_video_codec"
        result.message = f"video codec '{video_codec}' is not browser-compatible"
        return result

    if pix_fmt and pix_fmt not in BROWSER_COMPATIBLE_PIX_FMTS:
        result.failure_code = "unsupported_video_codec"
        result.message = f"pixel format '{pix_fmt}' is not browser-compatible"
        return result

    # --- Soft signals (warnings, not hard failures) ------------------------
    if not container_is_mp4:
        result.warnings.append("container_not_mp4")
    if has_faststart is False:
        result.warnings.append("missing_faststart")
    if nb_frames is None:
        result.warnings.append("frame_count_unknown")
    if pix_fmt is None:
        result.warnings.append("pix_fmt_unknown")
    if audio_codec and audio_codec not in BROWSER_COMPATIBLE_AUDIO_CODECS:
        result.warnings.append(f"audio_codec_unsupported:{audio_codec}")

    result.status = "passed"
    result.browser_compatible = True
    result.failure_code = None
    result.message = "asset is browser-playable"
    return result
