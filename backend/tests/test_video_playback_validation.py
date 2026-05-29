"""Unit tests for PR C9.3 browser-playback validation.

ffprobe/ffmpeg are absent in CI/local dev, so every test injects a ``probe``
callable (ffprobe-style JSON) — the same seam production uses to call the real
binary. The critical invariant: when no probe tool is available the validator
returns ``skipped_unavailable`` / ``ffprobe_unavailable`` and **never** reports
``browser_compatible=True``.
"""

from __future__ import annotations

import struct

import pytest

from app.services.playback_validation import (
    BROWSER_COMPATIBLE_VIDEO_CODECS,
    PLAYBACK_VALIDATION_FAILURE_CODES,
    PLAYBACK_VALIDATION_STATUSES,
    PlaybackValidationResult,
    detect_mp4_faststart,
    validate_browser_playback_asset,
)


def _h264_probe(**overrides):
    """Return a probe callable yielding a browser-playable H.264 MP4."""
    video_stream = {
        "codec_type": "video",
        "codec_name": "h264",
        "pix_fmt": "yuv420p",
        "width": 1280,
        "height": 720,
        "nb_frames": "1500",
        "duration": "60.0",
    }
    video_stream.update(overrides.pop("video", {}))
    streams = [video_stream]
    audio = overrides.pop("audio", {"codec_type": "audio", "codec_name": "aac"})
    if audio is not None:
        streams.append(audio)
    fmt = {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "60.0"}
    fmt.update(overrides.pop("format", {}))
    data = {"streams": streams, "format": fmt}
    data.update(overrides)

    def _probe(_path: str):
        return data

    return _probe


class TestProbeUnavailable:
    def test_no_probe_tool_returns_skipped_not_compatible(self, monkeypatch) -> None:
        # Force find_ffprobe to report absent, and pass no injected probe.
        monkeypatch.setattr(
            "app.services.playback_validation.find_ffprobe", lambda: None
        )
        result = validate_browser_playback_asset("http://example.com/v.mp4")
        assert result.status == "skipped_unavailable"
        assert result.failure_code == "ffprobe_unavailable"
        assert result.browser_compatible is False
        assert result.is_playback_ready is False

    def test_skipped_is_never_playback_ready(self, monkeypatch) -> None:
        monkeypatch.setattr(
            "app.services.playback_validation.find_ffprobe", lambda: None
        )
        result = validate_browser_playback_asset("http://example.com/v.mp4")
        assert result.is_playback_ready is False


class TestBrowserCompatible:
    def test_h264_yuv420p_aac_passes(self) -> None:
        result = validate_browser_playback_asset(
            "http://example.com/redacted.mp4", probe=_h264_probe()
        )
        assert result.status == "passed"
        assert result.browser_compatible is True
        assert result.is_playback_ready is True
        assert result.failure_code is None
        assert result.video_codec == "h264"
        assert result.pix_fmt == "yuv420p"

    def test_no_audio_is_acceptable(self) -> None:
        result = validate_browser_playback_asset(
            "http://example.com/redacted.mp4", probe=_h264_probe(audio=None)
        )
        assert result.status == "passed"
        assert result.browser_compatible is True
        assert result.audio_codec is None

    def test_status_and_codes_are_in_vocabulary(self) -> None:
        result = validate_browser_playback_asset(
            "http://example.com/redacted.mp4", probe=_h264_probe()
        )
        assert result.status in PLAYBACK_VALIDATION_STATUSES


class TestFailureModes:
    def test_mp4v_codec_is_rejected(self) -> None:
        # The exact production bug: OpenCV mp4v / mpeg4 output.
        result = validate_browser_playback_asset(
            "http://example.com/redacted.mp4",
            probe=_h264_probe(video={"codec_name": "mpeg4"}),
        )
        assert result.status == "failed"
        assert result.failure_code == "unsupported_video_codec"
        assert result.browser_compatible is False
        assert "mpeg4" not in BROWSER_COMPATIBLE_VIDEO_CODECS

    def test_no_video_stream(self) -> None:
        def _probe(_path: str):
            return {"streams": [{"codec_type": "audio", "codec_name": "aac"}], "format": {"duration": "10"}}

        result = validate_browser_playback_asset("http://x/y.mp4", probe=_probe)
        assert result.status == "failed"
        assert result.failure_code == "no_video_stream"

    def test_zero_duration(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4",
            probe=_h264_probe(format={"duration": "0"}, video={"duration": "0"}),
        )
        assert result.status == "failed"
        assert result.failure_code == "zero_duration"

    def test_single_frame_is_frozen(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4", probe=_h264_probe(video={"nb_frames": "1"})
        )
        assert result.status == "failed"
        assert result.failure_code == "frozen_or_single_frame"

    def test_non_yuv420p_pix_fmt_rejected(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4", probe=_h264_probe(video={"pix_fmt": "yuv444p"})
        )
        assert result.status == "failed"
        assert result.failure_code == "unsupported_video_codec"

    def test_invalid_dimensions_rejected(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4", probe=_h264_probe(video={"width": 0, "height": 0})
        )
        assert result.status == "failed"
        assert result.failure_code == "unsupported_video_codec"

    def test_probe_returns_none_is_unreadable(self) -> None:
        result = validate_browser_playback_asset("http://x/y.mp4", probe=lambda _p: None)
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_probe_raises_is_unreadable(self) -> None:
        def _boom(_p: str):
            raise RuntimeError("ffprobe exploded")

        result = validate_browser_playback_asset("http://x/y.mp4", probe=_boom)
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_missing_local_file_is_unreadable(self, tmp_path) -> None:
        missing = str(tmp_path / "does_not_exist.mp4")
        result = validate_browser_playback_asset(missing, probe=_h264_probe())
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_empty_input_is_unreadable(self) -> None:
        result = validate_browser_playback_asset("", probe=_h264_probe())
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_none_input_is_unreadable(self) -> None:
        result = validate_browser_playback_asset(None, probe=_h264_probe())  # type: ignore[arg-type]
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_all_failure_codes_are_in_vocabulary(self) -> None:
        for code in (
            "no_video_stream",
            "unsupported_video_codec",
            "zero_duration",
            "unreadable_asset",
            "frozen_or_single_frame",
            "ffprobe_unavailable",
        ):
            assert code in PLAYBACK_VALIDATION_FAILURE_CODES


class TestWarnings:
    def test_unknown_frame_count_warns_not_fails(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4", probe=_h264_probe(video={"nb_frames": "N/A"})
        )
        assert result.status == "passed"
        assert "frame_count_unknown" in result.warnings

    def test_non_aac_audio_warns_not_fails(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4",
            probe=_h264_probe(audio={"codec_type": "audio", "codec_name": "pcm_s16le"}),
        )
        assert result.status == "passed"
        assert any(w.startswith("audio_codec_unsupported") for w in result.warnings)


def _write_mp4(path, *, moov_first: bool) -> None:
    """Write a minimal MP4 with top-level ftyp + (moov/mdat) boxes."""
    def box(box_type: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload) + 8) + box_type + payload

    ftyp = box(b"ftyp", b"isom" + b"\x00" * 8)
    moov = box(b"moov", b"\x00" * 32)
    mdat = box(b"mdat", b"\x00" * 64)
    if moov_first:
        data = ftyp + moov + mdat
    else:
        data = ftyp + mdat + moov
    path.write_bytes(data)


class TestFaststartDetection:
    def test_moov_before_mdat_is_faststart(self, tmp_path) -> None:
        p = tmp_path / "fast.mp4"
        _write_mp4(p, moov_first=True)
        assert detect_mp4_faststart(str(p)) is True

    def test_mdat_before_moov_is_not_faststart(self, tmp_path) -> None:
        p = tmp_path / "slow.mp4"
        _write_mp4(p, moov_first=False)
        assert detect_mp4_faststart(str(p)) is False

    def test_url_returns_none(self) -> None:
        assert detect_mp4_faststart("http://example.com/v.mp4") is None

    def test_missing_file_returns_none(self, tmp_path) -> None:
        assert detect_mp4_faststart(str(tmp_path / "nope.mp4")) is None

    def test_missing_faststart_recorded_as_warning(self, tmp_path) -> None:
        p = tmp_path / "slow.mp4"
        _write_mp4(p, moov_first=False)
        result = validate_browser_playback_asset(str(p), probe=_h264_probe())
        assert result.status == "passed"
        assert result.has_faststart is False
        assert "missing_faststart" in result.warnings


class TestResultSerialization:
    def test_to_dict_round_trips_fields(self) -> None:
        result = validate_browser_playback_asset(
            "http://x/y.mp4", probe=_h264_probe()
        )
        payload = result.to_dict()
        assert payload["status"] == "passed"
        assert payload["browser_compatible"] is True
        assert payload["video_codec"] == "h264"
        assert payload["expected_kind"] == "redacted"
        assert "checked_at" in payload
