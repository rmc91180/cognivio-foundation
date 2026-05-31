"""PR C9.3 PART 6 + PART 4 — blur_all fallback invariants and browser-safe render.

Locks two safety properties:

1. When the teacher cannot be confidently matched, the pipeline falls back to
   ``blur_all`` (``teacher_track_id`` is ``None``) and the render blurs *every*
   detected face — an unrecognized adult is never preserved.
2. The redacted render is finalized to browser-playable H.264 (when ffmpeg is
   available); when ffmpeg is missing the result is flagged
   ``browser_safe_render=False`` with the structured error so the worker never
   marks a frozen asset playback-ready.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2
import numpy as np

from app.services.visual_redaction_validation import measure_region_sharpness
from privacy_pipeline import (
    BROWSER_SAFE_RENDER_ERROR_FFMPEG_MISSING,
    _finalize_redacted_video_with_audio,
    analyze_video_privacy,
    blur_full_frame,
    render_redacted_video,
)


def _write_test_video(path: Path, frame_count: int = 12, width: int = 160, height: int = 120) -> None:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, 10.0, (width, height))
    assert writer.isOpened()
    for idx in range(frame_count):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        cv2.rectangle(frame, (40, 20), (110, 95), (255, 255, 255), -1)
        cv2.rectangle(frame, (10, 10), (35, 40), (200, 200, 200), -1)
        writer.write(frame)
    writer.release()


def _patch_detection(monkeypatch, *, faces, score):
    monkeypatch.setattr("privacy_pipeline.load_reference_signatures", lambda paths: ["ref"])
    monkeypatch.setattr("privacy_pipeline.detect_faces", lambda frame, cascade=None: list(faces))
    monkeypatch.setattr("privacy_pipeline.build_face_signature", lambda face: {"score": score})
    monkeypatch.setattr("privacy_pipeline.signature_similarity", lambda signature, refs: signature["score"])


class TestBlurAllDecision:
    def test_no_confident_match_falls_back_to_blur_all(self, monkeypatch, tmp_path):
        video_path = tmp_path / "lesson.mp4"
        _write_test_video(video_path)
        # Score well below the ambiguous threshold → no confident match.
        _patch_detection(monkeypatch, faces=[(40, 20, 70, 75)], score=0.10)

        result = analyze_video_privacy(
            str(video_path),
            [str(video_path)],
            teacher_match_threshold=0.9,
            ambiguous_match_threshold=0.8,
            max_frames=8,
            sample_stride=2,
        )
        assert result["fallback_mode"] == "blur_all"
        assert result["teacher_track_id"] is None
        # Every track in the manifest must be a blur decision.
        for track in result["manifest_tracks"]:
            assert track["decision"] == "blur"

    def test_no_faces_detected_falls_back_to_blur_all(self, monkeypatch, tmp_path):
        video_path = tmp_path / "empty.mp4"
        _write_test_video(video_path)
        _patch_detection(monkeypatch, faces=[], score=0.0)

        result = analyze_video_privacy(
            str(video_path),
            [str(video_path)],
            teacher_match_threshold=0.9,
            ambiguous_match_threshold=0.8,
            max_frames=8,
            sample_stride=2,
        )
        assert result["fallback_mode"] == "blur_all"
        assert result["teacher_track_id"] is None
        assert result["manifest_tracks"] == []


class TestBlurAllRenderInvariant:
    def test_force_blur_all_blurs_every_detected_face(self, monkeypatch, tmp_path):
        video_path = tmp_path / "src.mp4"
        output_path = tmp_path / "redacted.mp4"
        thumbnail_path = tmp_path / "thumb.jpg"
        _write_test_video(video_path)
        # Two faces per frame; even a HIGH score must NOT be preserved when
        # force_blur_all is set — an unrecognized adult is never kept.
        faces = [(40, 20, 70, 75), (10, 10, 25, 30)]
        _patch_detection(monkeypatch, faces=faces, score=0.99)

        stats = render_redacted_video(
            str(video_path),
            str(output_path),
            str(thumbnail_path),
            [str(video_path)],
            teacher_match_threshold=0.9,
            ambiguous_match_threshold=0.8,
            force_blur_all=True,
        )
        assert stats["frames_processed"] > 0
        assert stats["faces_detected_total"] > 0
        # Invariant: every detected face was blurred.
        assert stats["faces_blurred_total"] == stats["faces_detected_total"]
        # Invariant: the teacher was never treated as visible.
        assert stats["frames_with_teacher_visible"] == 0


class TestBrowserSafeFinalize:
    def test_reencodes_to_h264_when_ffmpeg_present(self, monkeypatch, tmp_path):
        rendered = tmp_path / "r.video_only.mp4"
        rendered.write_bytes(b"fake-mp4v")
        output = tmp_path / "r.mp4"
        source = tmp_path / "src.mp4"
        source.write_bytes(b"src")

        class _Completed:
            returncode = 0
            stderr = ""

        def fake_run(cmd, **kwargs):
            # The browser-safe profile must be requested.
            assert "libx264" in cmd
            assert "yuv420p" in cmd
            assert "+faststart" in cmd
            Path(cmd[-1]).write_bytes(b"h264-output")
            return _Completed()

        monkeypatch.setattr(subprocess, "run", fake_run)
        stats = _finalize_redacted_video_with_audio(str(source), rendered, output)
        assert stats["browser_safe_render"] is True
        assert stats["video_codec"] == "h264"
        assert output.exists()
        assert not rendered.exists()  # unlinked on success

    def test_flags_unsafe_when_ffmpeg_missing(self, monkeypatch, tmp_path):
        rendered = tmp_path / "r.video_only.mp4"
        rendered.write_bytes(b"fake-mp4v")
        output = tmp_path / "r.mp4"
        source = tmp_path / "src.mp4"
        source.write_bytes(b"src")

        def fake_run(cmd, **kwargs):
            raise FileNotFoundError("ffmpeg not found")

        monkeypatch.setattr(subprocess, "run", fake_run)
        stats = _finalize_redacted_video_with_audio(str(source), rendered, output)
        assert stats["browser_safe_render"] is False
        assert stats["browser_safe_error"] == BROWSER_SAFE_RENDER_ERROR_FFMPEG_MISSING
        # Best-effort artifact preserved so the pipeline still has a file.
        assert output.exists()

    def test_flags_unsafe_when_encode_fails(self, monkeypatch, tmp_path):
        rendered = tmp_path / "r.video_only.mp4"
        rendered.write_bytes(b"fake-mp4v")
        output = tmp_path / "r.mp4"
        source = tmp_path / "src.mp4"
        source.write_bytes(b"src")

        class _Completed:
            returncode = 1
            stderr = "encode boom"

        monkeypatch.setattr(subprocess, "run", lambda cmd, **kwargs: _Completed())
        stats = _finalize_redacted_video_with_audio(str(source), rendered, output)
        assert stats["browser_safe_render"] is False
        assert stats["browser_safe_error"] == "ffmpeg_browser_safe_render_failed"
        assert output.exists()


class TestFullFrameFallback:
    """PR C9.5 PART 2 — provably-safe full-frame redaction."""

    def test_blur_full_frame_collapses_sharpness(self):
        # A sharp checkerboard frame has high variance-of-Laplacian; after a
        # full-frame blur the whole-frame sharpness collapses far below the
        # validator's frame-blur threshold.
        frame = np.zeros((120, 160, 3), dtype=np.uint8)
        frame[::4, :] = 255  # high-frequency stripes
        frame[:, ::4] = 255
        before = measure_region_sharpness(frame)
        blur_full_frame(frame)
        after = measure_region_sharpness(frame)
        assert after < before
        assert after < 80.0  # below DEFAULT_FRAME_BLUR_THRESHOLD

    def test_render_records_full_frame_strategy(self, monkeypatch, tmp_path):
        video_path = tmp_path / "src.mp4"
        output_path = tmp_path / "redacted.mp4"
        thumbnail_path = tmp_path / "thumb.jpg"
        _write_test_video(video_path)
        _patch_detection(monkeypatch, faces=[(40, 20, 70, 75)], score=0.05)

        stats = render_redacted_video(
            str(video_path),
            str(output_path),
            str(thumbnail_path),
            [str(video_path)],
            teacher_match_threshold=0.9,
            ambiguous_match_threshold=0.8,
            force_blur_all=True,
            full_frame_fallback=True,
        )
        assert stats["redaction_strategy"] == "full_frame"
        assert stats["frames_processed"] > 0

    def test_render_defaults_to_regions_strategy(self, monkeypatch, tmp_path):
        video_path = tmp_path / "src.mp4"
        output_path = tmp_path / "redacted.mp4"
        thumbnail_path = tmp_path / "thumb.jpg"
        _write_test_video(video_path)
        _patch_detection(monkeypatch, faces=[(40, 20, 70, 75)], score=0.05)

        stats = render_redacted_video(
            str(video_path),
            str(output_path),
            str(thumbnail_path),
            [str(video_path)],
            teacher_match_threshold=0.9,
            ambiguous_match_threshold=0.8,
            force_blur_all=True,
        )
        assert stats["redaction_strategy"] == "regions"
