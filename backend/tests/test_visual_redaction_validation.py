"""Unit tests for PR C9.4 visual-redaction validation.

OpenCV/Haar are not exercised here: every test injects the ``frame_sampler`` /
``face_detector`` / ``sharpness_fn`` seams that production uses to call the real
OpenCV defaults. The critical invariant: a rendered "redacted" asset is only
reported ``passed`` / ``is_redaction_verified`` when the sampled output frames
were actually re-scanned and showed no sharp (unblurred) face beyond the mode's
allowance. Missing OpenCV, an unreadable asset, or no sampled frames are all
fail-closed and **never** verified.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import visual_redaction_validation as vrv
from app.services.visual_redaction_validation import (
    DEFAULT_SHARPNESS_THRESHOLD,
    VISUAL_REDACTION_MODES,
    VISUAL_REDACTION_VALIDATION_FAILURE_CODES,
    VISUAL_REDACTION_VALIDATION_STATUSES,
    VisualRedactionValidationResult,
    measure_region_sharpness,
    validate_visual_redaction,
)


def _sampler(frames):
    """Return a frame_sampler seam yielding the given frames for any path."""

    def _sample(_path):
        for frame in frames:
            yield frame

    return _sample


def _frame(size=120):
    return np.zeros((size, size, 3), dtype=np.uint8)


def _detector(boxes):
    """Return a face_detector seam yielding fixed boxes for every frame."""

    def _detect(_frame):
        return list(boxes)

    return _detect


def _constant_sharpness(value):
    def _fn(_region):
        return float(value)

    return _fn


class TestUnreadableInputs:
    def test_none_path_is_unreadable_and_not_verified(self) -> None:
        result = validate_visual_redaction(None)
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"
        assert result.is_redaction_verified is False
        assert result.redaction_verified is False

    def test_empty_path_is_unreadable(self) -> None:
        result = validate_visual_redaction("")
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_non_string_path_is_unreadable(self) -> None:
        result = validate_visual_redaction(123)  # type: ignore[arg-type]
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_sampler_raises_is_unreadable(self) -> None:
        def _boom(_path):
            raise RuntimeError("cannot open asset")

        result = validate_visual_redaction(
            "render.mp4", frame_sampler=_boom, face_detector=_detector([])
        )
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"
        assert result.is_redaction_verified is False

    def test_sampler_returns_none_is_unreadable(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            frame_sampler=lambda _p: None,
            face_detector=_detector([]),
        )
        assert result.status == "failed"
        assert result.failure_code == "unreadable_asset"

    def test_no_frames_sampled_fails(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            frame_sampler=_sampler([]),
            face_detector=_detector([]),
        )
        assert result.status == "failed"
        assert result.failure_code == "no_frames_sampled"
        assert result.is_redaction_verified is False


class TestBlurAllMode:
    def test_all_blurred_faces_pass(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            frame_sampler=_sampler([_frame(), _frame()]),
            face_detector=_detector([(0, 0, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD - 1.0),
        )
        assert result.status == "passed"
        assert result.redaction_verified is True
        assert result.is_redaction_verified is True
        assert result.failure_code is None
        assert result.faces_detected == 2
        assert result.sharp_faces_detected == 0

    def test_sharp_face_fails_unblurred(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([(0, 0, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD + 50.0),
        )
        assert result.status == "failed"
        assert result.failure_code == "unblurred_face_detected"
        assert result.is_redaction_verified is False
        assert result.max_sharp_faces_in_frame == 1

    def test_no_faces_detected_but_sharp_frames_is_unconfirmed(self) -> None:
        # PR C9.5 PART 2 fail-closed repair: zero detections + sharp frames means
        # the render-time AND validation-time cascades were equally blind. We can
        # NOT assert the output is blurred, so it is redaction_unconfirmed (NOT
        # verified) — never the old auto-pass.
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            frame_sampler=_sampler([_frame(), _frame()]),
            face_detector=_detector([]),
            sharpness_fn=_constant_sharpness(999.0),
        )
        assert result.status == "failed"
        assert result.failure_code == "redaction_unconfirmed"
        assert result.is_redaction_verified is False
        assert result.faces_detected == 0
        assert "no_faces_detected_in_output" in result.warnings

    def test_no_faces_detected_with_blurred_frames_passes(self) -> None:
        # When the WHOLE output is demonstrably blurred (low whole-frame
        # sharpness) zero detections is consistent with a full-frame redaction —
        # this is positive evidence, so it may pass.
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            frame_sampler=_sampler([_frame(), _frame()]),
            face_detector=_detector([]),
            sharpness_fn=_constant_sharpness(10.0),
        )
        assert result.status == "passed"
        assert result.is_redaction_verified is True
        assert result.faces_detected == 0
        assert "full_frame_blur_confirmed" in result.warnings

    def test_require_blur_evidence_false_restores_legacy_pass(self) -> None:
        # The escape hatch (callers with independent evidence) may opt out of the
        # zero-detections guard and accept the legacy auto-pass.
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            require_blur_evidence=False,
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([]),
            sharpness_fn=_constant_sharpness(999.0),
        )
        assert result.status == "passed"
        assert result.is_redaction_verified is True
        assert "no_faces_detected_in_output" in result.warnings


class TestFullFrameStrategy:
    def test_full_frame_blurred_passes(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            strategy="full_frame",
            frame_sampler=_sampler([_frame(), _frame()]),
            face_detector=_detector([]),
            sharpness_fn=_constant_sharpness(5.0),
        )
        assert result.status == "passed"
        assert result.strategy == "full_frame"
        assert result.is_redaction_verified is True

    def test_full_frame_with_sharp_frame_fails(self) -> None:
        # A full_frame render must show EVERY frame blurred. A sharp frame means
        # the full-frame blur did not actually apply — fail-closed.
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            strategy="full_frame",
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([]),
            sharpness_fn=_constant_sharpness(500.0),
        )
        assert result.status == "failed"
        assert result.failure_code == "frame_not_blurred"
        assert result.is_redaction_verified is False

    def test_unknown_strategy_normalizes_to_regions(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="blur_all",
            strategy="bogus",
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([(0, 0, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD - 1.0),
        )
        assert result.strategy == "regions"
        assert result.status == "passed"


class TestSelectiveMode:
    def test_one_visible_face_allowed(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="selective",
            max_visible_faces=1,
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([(0, 0, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD + 100.0),
        )
        assert result.status == "passed"
        assert result.max_visible_faces_allowed == 1
        assert result.is_redaction_verified is True

    def test_too_many_visible_faces_fails(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            mode="selective",
            max_visible_faces=1,
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([(0, 0, 40, 40), (50, 50, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD + 100.0),
        )
        assert result.status == "failed"
        assert result.failure_code == "too_many_visible_faces"
        assert result.is_redaction_verified is False
        assert result.max_sharp_faces_in_frame == 2


class TestModeNormalization:
    def test_unknown_mode_forces_blur_all(self) -> None:
        # An unknown mode must collapse to blur_all (0 visible faces allowed),
        # so a single sharp face still fails — never the laxer selective path.
        result = validate_visual_redaction(
            "render.mp4",
            mode="not_a_mode",
            max_visible_faces=5,
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([(0, 0, 40, 40)]),
            sharpness_fn=_constant_sharpness(DEFAULT_SHARPNESS_THRESHOLD + 10.0),
        )
        assert result.mode == "blur_all"
        assert result.max_visible_faces_allowed == 0
        assert result.status == "failed"
        assert result.failure_code == "unblurred_face_detected"


class TestOpenCVUnavailable:
    def test_missing_cv2_with_no_seams_is_skipped(self, monkeypatch) -> None:
        # No injected sampler/detector + no OpenCV → skipped_unavailable, never
        # verified. This is the degraded-runtime fail-closed path.
        monkeypatch.setattr(vrv, "_cv2", None)
        result = validate_visual_redaction("render.mp4")
        assert result.status == "skipped_unavailable"
        assert result.failure_code == "cv2_unavailable"
        assert result.is_redaction_verified is False
        assert result.redaction_verified is False


class TestMeasureRegionSharpness:
    def test_none_region_is_zero(self) -> None:
        assert measure_region_sharpness(None) == 0.0

    def test_empty_region_is_zero(self) -> None:
        assert measure_region_sharpness(np.zeros((0, 0))) == 0.0

    def test_flat_region_has_low_variance(self) -> None:
        flat = np.full((32, 32), 128.0)
        sharp = np.zeros((32, 32))
        sharp[::2, :] = 255.0  # high-frequency stripes
        assert measure_region_sharpness(flat) < measure_region_sharpness(sharp)

    def test_tiny_region_numpy_fallback_is_zero(self, monkeypatch) -> None:
        # Force the pure-numpy Laplacian path; a <3px region returns 0.0.
        monkeypatch.setattr(vrv, "_cv2", None)
        assert measure_region_sharpness(np.ones((2, 2))) == 0.0


class TestResultContract:
    def test_to_dict_round_trips_fields(self) -> None:
        result = validate_visual_redaction(
            "render.mp4",
            frame_sampler=_sampler([_frame()]),
            face_detector=_detector([]),
        )
        payload = result.to_dict()
        assert payload["status"] == "passed"
        assert payload["mode"] == "blur_all"
        assert payload["expected_kind"] == "redacted"
        assert payload["redaction_verified"] is True
        assert "checked_at" in payload
        assert isinstance(payload["warnings"], list)

    def test_skipped_status_is_never_verified(self) -> None:
        result = VisualRedactionValidationResult(status="skipped_unavailable", redaction_verified=True)
        # Even if redaction_verified got set, a non-passed status is not verified.
        assert result.is_redaction_verified is False

    def test_vocabularies_are_stable(self) -> None:
        assert "passed" in VISUAL_REDACTION_VALIDATION_STATUSES
        assert "failed" in VISUAL_REDACTION_VALIDATION_STATUSES
        assert "skipped_unavailable" in VISUAL_REDACTION_VALIDATION_STATUSES
        assert "blur_all" in VISUAL_REDACTION_MODES
        assert "selective" in VISUAL_REDACTION_MODES
        for code in (
            "unblurred_face_detected",
            "too_many_visible_faces",
            "unreadable_asset",
            "no_frames_sampled",
            "cv2_unavailable",
        ):
            assert code in VISUAL_REDACTION_VALIDATION_FAILURE_CODES
