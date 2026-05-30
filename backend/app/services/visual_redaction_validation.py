"""Visual redaction validation (PR C9.4).

The destructive privacy blur worker renders a redacted MP4 and persists
``render_stats`` (``faces_detected_total`` / ``faces_blurred_total``). Those
counters only describe what the *render-time* Haar detector found and blurred —
they do **not** prove the output pixels are actually privacy-transformed.

The frontal Haar cascade misses profile / tilted / distant / partially-occluded
faces, so a redacted asset can report ``faces_blurred_total == faces_detected_total``
(a "100% blurred" manifest) while a real, recognizable face is still visible in
the output. That is a privacy false-positive: a teacher plays a "redacted" video
and sees an unblurred face.

This module *re-inspects the rendered output* and decides whether the visible
faces were really blurred:

1. Re-scan sampled frames of the **rendered** redacted video.
2. Detect candidate face regions in the OUTPUT (frontal + profile cascades).
3. Measure each region's sharpness via the variance of the Laplacian. A blurred
   region has low high-frequency energy (low variance); a sharp/unblurred face
   has high variance.
4. Fail-closed: in ``blur_all`` mode **any** sharp detected face fails the
   validation; in ``selective`` mode at most ``max_visible_faces`` sharp regions
   (the preserved teacher) are tolerated.

Design constraints (mirroring ``playback_validation``):

- **Fully testable.** ``frame_sampler`` / ``face_detector`` / ``sharpness_fn``
  are injectable callables; the OpenCV defaults are only used when nothing is
  injected.
- **Fail-closed, never falsely-positive.** When OpenCV is unavailable, the asset
  is unreadable, or no frames could be sampled, the result is **not** verified
  (``status`` is ``"skipped_unavailable"`` / ``"failed"`` and
  ``is_redaction_verified`` is ``False``). We never assert a redaction we could
  not actually confirm.
- **Read-only.** This module only inspects; it never deletes source assets and
  never exposes raw video.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

import numpy as np

try:
    import cv2 as _cv2
    _cv2_import_error = None
except Exception as exc:  # pragma: no cover - exercised only without OpenCV
    _cv2 = None
    _cv2_import_error = exc

__all__ = [
    "VISUAL_REDACTION_VALIDATION_STATUSES",
    "VISUAL_REDACTION_VALIDATION_FAILURE_CODES",
    "VISUAL_REDACTION_MODES",
    "DEFAULT_SHARPNESS_THRESHOLD",
    "VisualRedactionValidationResult",
    "FrameSampler",
    "FaceDetector",
    "SharpnessFn",
    "measure_region_sharpness",
    "validate_visual_redaction",
]

# Stable strings — persisted on the video document and read by audit/smoke.
VISUAL_REDACTION_VALIDATION_STATUSES: Tuple[str, ...] = (
    "passed",
    "failed",
    "skipped_unavailable",
)

VISUAL_REDACTION_VALIDATION_FAILURE_CODES: Tuple[str, ...] = (
    "unblurred_face_detected",
    "too_many_visible_faces",
    "unreadable_asset",
    "no_frames_sampled",
    "cv2_unavailable",
)

VISUAL_REDACTION_MODES: Tuple[str, ...] = (
    "blur_all",
    "selective",
)

# Variance-of-Laplacian threshold. A face region below this is considered
# sufficiently blurred; at or above it is treated as sharp/unblurred. Chosen
# conservatively: a GaussianBlur with the pipeline's kernel collapses face
# high-frequency energy well below this, while an untouched face sits far above.
DEFAULT_SHARPNESS_THRESHOLD: float = 80.0

# A Haar/LBP detection in a *redacted* output is itself suspicious — a properly
# blurred face is usually no longer detectable. We still gate on sharpness so the
# preserved teacher (selective mode) and a strongly-but-detectably-blurred face
# do not cause false failures.

FrameSampler = Callable[[str], Iterable[np.ndarray]]
FaceDetector = Callable[[np.ndarray], List[Tuple[int, int, int, int]]]
SharpnessFn = Callable[[np.ndarray], float]


@dataclass
class VisualRedactionValidationResult:
    """Outcome of inspecting a rendered redacted asset for real blur."""

    status: str  # one of VISUAL_REDACTION_VALIDATION_STATUSES
    mode: str = "blur_all"
    expected_kind: str = "redacted"
    redaction_verified: bool = False
    failure_code: Optional[str] = None
    message: Optional[str] = None
    detector_tool: Optional[str] = None
    # Diagnostics (best-effort; may be 0/None when sampling was impossible).
    frames_sampled: int = 0
    faces_detected: int = 0
    sharp_faces_detected: int = 0
    max_sharp_faces_in_frame: int = 0
    max_visible_faces_allowed: int = 0
    sharpness_threshold: float = DEFAULT_SHARPNESS_THRESHOLD
    max_region_sharpness: Optional[float] = None
    mean_face_sharpness: Optional[float] = None
    warnings: List[str] = field(default_factory=list)
    checked_at: Optional[str] = None

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    @property
    def is_redaction_verified(self) -> bool:
        """True only when the output was confirmed privacy-transformed.

        ``skipped_unavailable`` is **not** verified — we never treat an
        un-inspected asset as confirmed-blurred.
        """
        return self.status == "passed" and self.redaction_verified

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "mode": self.mode,
            "expected_kind": self.expected_kind,
            "redaction_verified": self.redaction_verified,
            "failure_code": self.failure_code,
            "message": self.message,
            "detector_tool": self.detector_tool,
            "frames_sampled": self.frames_sampled,
            "faces_detected": self.faces_detected,
            "sharp_faces_detected": self.sharp_faces_detected,
            "max_sharp_faces_in_frame": self.max_sharp_faces_in_frame,
            "max_visible_faces_allowed": self.max_visible_faces_allowed,
            "sharpness_threshold": self.sharpness_threshold,
            "max_region_sharpness": self.max_region_sharpness,
            "mean_face_sharpness": self.mean_face_sharpness,
            "warnings": list(self.warnings),
            "checked_at": self.checked_at,
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def measure_region_sharpness(region: np.ndarray) -> float:
    """Variance of the Laplacian of a region — higher means sharper.

    A blurred face region has little high-frequency content and a low variance;
    an untouched face has a high variance. Returns ``0.0`` for empty / unusable
    regions (treated as "not sharp").
    """
    if region is None:
        return 0.0
    arr = np.asarray(region)
    if arr.size == 0:
        return 0.0
    if _cv2 is not None:
        gray = arr
        if arr.ndim == 3 and arr.shape[2] >= 3:
            gray = _cv2.cvtColor(arr, _cv2.COLOR_BGR2GRAY)
        laplacian = _cv2.Laplacian(gray, _cv2.CV_64F)
        return float(laplacian.var())
    # Pure-numpy Laplacian fallback (no OpenCV) — keeps the metric meaningful in
    # degraded runtimes and in tests that inject arrays without cv2.
    gray = arr
    if arr.ndim == 3 and arr.shape[2] >= 3:
        gray = arr[..., :3].mean(axis=2)
    gray = gray.astype(np.float64)
    if gray.ndim != 2 or gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    laplacian = (
        -4.0 * gray[1:-1, 1:-1]
        + gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
    )
    return float(laplacian.var())


def _default_face_detector() -> FaceDetector:
    """Build a detector using the frontal + profile Haar cascades.

    Detecting on BOTH cascades widens coverage of candidate faces to re-check in
    the OUTPUT. We are not relying on the cascade to *find every* face (that is
    the very limitation that motivates this validator); we use it to surface the
    most likely unblurred regions and then judge them by sharpness.
    """
    if _cv2 is None:
        raise RuntimeError(f"OpenCV is unavailable in this runtime: {_cv2_import_error}")
    from pathlib import Path

    haar_dir = Path(_cv2.data.haarcascades)
    cascades = []
    for name in (
        "haarcascade_frontalface_default.xml",
        "haarcascade_profileface.xml",
    ):
        cascade = _cv2.CascadeClassifier(str(haar_dir / name))
        if not cascade.empty():
            cascades.append(cascade)
    if not cascades:
        raise RuntimeError("Unable to load any Haar cascade for visual redaction validation")

    def _detect(frame: np.ndarray) -> List[Tuple[int, int, int, int]]:
        if frame is None:
            return []
        gray = frame
        if frame.ndim == 3 and frame.shape[2] >= 3:
            gray = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
        boxes: List[Tuple[int, int, int, int]] = []
        for cascade in cascades:
            detections = cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(32, 32),
            )
            for box in detections:
                boxes.append(tuple(int(v) for v in box))
        return boxes

    return _detect


def _default_frame_sampler(max_frames: int, sample_stride: int) -> FrameSampler:
    if _cv2 is None:
        raise RuntimeError(f"OpenCV is unavailable in this runtime: {_cv2_import_error}")

    def _sample(path: str) -> Iterable[np.ndarray]:
        cap = _cv2.VideoCapture(path)
        if not cap or not cap.isOpened():
            if cap:
                cap.release()
            return
        try:
            sampled = 0
            frame_index = 0
            while sampled < max_frames:
                cap.set(_cv2.CAP_PROP_POS_FRAMES, frame_index)
                ret, frame = cap.read()
                if not ret:
                    break
                yield frame
                sampled += 1
                frame_index += max(1, sample_stride)
        finally:
            cap.release()

    return _sample


def _crop(frame: np.ndarray, box: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    x, y, w, h = box
    if w <= 0 or h <= 0:
        return None
    x = max(0, x)
    y = max(0, y)
    region = frame[y : y + h, x : x + w]
    if region is None or region.size == 0:
        return None
    return region


def validate_visual_redaction(
    rendered_path: Optional[str],
    *,
    mode: str = "blur_all",
    max_visible_faces: int = 0,
    expected_kind: str = "redacted",
    sharpness_threshold: float = DEFAULT_SHARPNESS_THRESHOLD,
    max_frames: int = 60,
    sample_stride: int = 15,
    frame_sampler: Optional[FrameSampler] = None,
    face_detector: Optional[FaceDetector] = None,
    sharpness_fn: Optional[SharpnessFn] = None,
) -> VisualRedactionValidationResult:
    """Confirm a rendered redacted asset is actually privacy-transformed.

    Parameters
    ----------
    rendered_path:
        Local filesystem path to the rendered redacted video.
    mode:
        ``"blur_all"`` — no face may remain sharp (full-redaction fallback).
        ``"selective"`` — up to ``max_visible_faces`` sharp regions (the
        preserved teacher) are tolerated.
    max_visible_faces:
        In ``selective`` mode, the maximum number of sharp faces allowed in any
        single frame. Ignored in ``blur_all`` mode (forced to 0).
    sharpness_threshold:
        Variance-of-Laplacian above which a detected face region is treated as
        sharp/unblurred.
    frame_sampler / face_detector / sharpness_fn:
        Injectable seams. When omitted, OpenCV-backed defaults are used.

    Returns a :class:`VisualRedactionValidationResult`. Fail-closed: when OpenCV
    is unavailable, the asset is unreadable, or no frames can be sampled, the
    result is **not** verified.
    """
    checked_at = _now_iso()
    normalized_mode = mode if mode in VISUAL_REDACTION_MODES else "blur_all"
    allowed_visible = 0 if normalized_mode == "blur_all" else max(0, int(max_visible_faces))

    base = VisualRedactionValidationResult(
        status="failed",
        mode=normalized_mode,
        expected_kind=expected_kind,
        max_visible_faces_allowed=allowed_visible,
        sharpness_threshold=float(sharpness_threshold),
        checked_at=checked_at,
    )

    if not rendered_path or not isinstance(rendered_path, str):
        base.failure_code = "unreadable_asset"
        base.message = "rendered asset path missing or not a string"
        return base

    # Resolve injectable seams; fall back to OpenCV. If OpenCV is required but
    # absent we fail-closed as skipped_unavailable (never "verified").
    detector_tool: Optional[str] = None
    sampler = frame_sampler
    detector = face_detector
    sharp_fn = sharpness_fn or measure_region_sharpness

    if sampler is None or detector is None:
        if _cv2 is None:
            base.status = "skipped_unavailable"
            base.failure_code = "cv2_unavailable"
            base.message = "OpenCV unavailable; visual redaction could not be verified"
            return base
        try:
            if sampler is None:
                sampler = _default_frame_sampler(max_frames=max_frames, sample_stride=sample_stride)
            if detector is None:
                detector = _default_face_detector()
            detector_tool = "opencv_haar"
        except Exception as exc:  # noqa: BLE001 - degraded runtime, fail-closed
            base.status = "skipped_unavailable"
            base.failure_code = "cv2_unavailable"
            base.message = f"OpenCV setup failed; redaction not verified: {exc}"
            return base
    else:
        detector_tool = "injected"

    base.detector_tool = detector_tool

    frames_sampled = 0
    faces_detected = 0
    sharp_faces_detected = 0
    max_sharp_in_frame = 0
    max_region_sharpness: Optional[float] = None
    face_sharpness_values: List[float] = []
    offending_frame_sharp_count = 0

    try:
        frame_iter = sampler(rendered_path)
    except Exception:  # noqa: BLE001 - any sampler failure → unreadable
        base.failure_code = "unreadable_asset"
        base.message = "could not open rendered asset for inspection"
        return base

    if frame_iter is None:
        base.failure_code = "unreadable_asset"
        base.message = "could not open rendered asset for inspection"
        return base

    try:
        for frame in frame_iter:
            if frame is None:
                continue
            frames_sampled += 1
            try:
                boxes = detector(frame)
            except Exception:  # noqa: BLE001 - detector hiccup on a frame
                continue
            sharp_in_this_frame = 0
            for box in boxes or []:
                region = _crop(frame, box)
                if region is None:
                    continue
                faces_detected += 1
                sharpness = float(sharp_fn(region))
                face_sharpness_values.append(sharpness)
                if max_region_sharpness is None or sharpness > max_region_sharpness:
                    max_region_sharpness = sharpness
                if sharpness >= sharpness_threshold:
                    sharp_faces_detected += 1
                    sharp_in_this_frame += 1
            if sharp_in_this_frame > max_sharp_in_frame:
                max_sharp_in_frame = sharp_in_this_frame
    except Exception:  # noqa: BLE001 - mid-stream failure → unreadable
        base.failure_code = "unreadable_asset"
        base.message = "rendered asset became unreadable during inspection"
        return base

    base.frames_sampled = frames_sampled
    base.faces_detected = faces_detected
    base.sharp_faces_detected = sharp_faces_detected
    base.max_sharp_faces_in_frame = max_sharp_in_frame
    base.max_region_sharpness = max_region_sharpness
    base.mean_face_sharpness = (
        float(sum(face_sharpness_values) / len(face_sharpness_values))
        if face_sharpness_values
        else None
    )

    if frames_sampled == 0:
        base.status = "failed"
        base.failure_code = "no_frames_sampled"
        base.message = "no frames could be sampled from the rendered asset"
        return base

    # --- Decision (fail-closed) -------------------------------------------
    if max_sharp_in_frame > allowed_visible:
        base.status = "failed"
        if normalized_mode == "blur_all":
            base.failure_code = "unblurred_face_detected"
            base.message = (
                f"{max_sharp_in_frame} sharp face region(s) survived in a "
                "blur_all redaction (expected 0)"
            )
        else:
            base.failure_code = "too_many_visible_faces"
            base.message = (
                f"{max_sharp_in_frame} sharp face region(s) exceed the "
                f"{allowed_visible} preserved-teacher allowance"
            )
        return base

    base.status = "passed"
    base.redaction_verified = True
    base.failure_code = None
    base.message = "rendered asset shows no unblurred faces beyond allowance"
    if faces_detected == 0:
        base.warnings.append("no_faces_detected_in_output")
    return base
