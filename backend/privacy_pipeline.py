from __future__ import annotations

import os
import shutil
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw

try:
    import cv2 as _cv2
    _cv2_import_error = None
except Exception as exc:
    _cv2 = None
    _cv2_import_error = exc

ALLOW_DEGRADED_PRIVACY_RUNTIME = os.getenv("PRIVACY_ALLOW_DEGRADED_RUNTIME", "false").lower() == "true"


@dataclass
class FaceSignature:
    histogram: np.ndarray
    ahash: np.ndarray


def _require_cv2():
    if _cv2 is None:
        raise RuntimeError(f"OpenCV is unavailable in this runtime: {_cv2_import_error}")
    return _cv2


def _cv2_unavailable_message() -> str:
    return f"OpenCV is unavailable in this runtime: {_cv2_import_error}"


def get_privacy_runtime_status() -> Dict[str, Any]:
    return {
        "cv2_available": _cv2 is not None,
        "cv2_error": None if _cv2 is not None else str(_cv2_import_error),
        "degraded_runtime_enabled": ALLOW_DEGRADED_PRIVACY_RUNTIME,
    }


def _write_placeholder_thumbnail(output_path: str, width: int = 640, height: int = 360) -> None:
    image = Image.new("RGB", (width, height), (235, 241, 248))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, width - 40, height - 40), outline=(76, 92, 122), width=3)
    draw.text((70, 130), "Cognivio staging thumbnail", fill=(45, 62, 80))
    draw.text((70, 170), "Privacy runtime fallback active", fill=(45, 62, 80))
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="JPEG", quality=84)


# PR C9.3: the redacted render must be browser-playable. OpenCV's VideoWriter
# emits ``mp4v`` (MPEG-4 Part 2), which most browsers cannot decode — so the
# final artifact would play as a frozen / black frame for teachers. The
# finalize step therefore RE-ENCODES the rendered stream to H.264 / yuv420p
# (the browser lingua-franca) and attaches AAC audio with ``+faststart``. This
# is the minimal codec conversion required for playability — no resolution
# scaling or broad compression tuning.
BROWSER_SAFE_RENDER_ERROR_FFMPEG_MISSING = "ffmpeg_unavailable_for_browser_safe_render"
BROWSER_SAFE_RENDER_ERROR_ENCODE_FAILED = "ffmpeg_browser_safe_render_failed"


def _finalize_redacted_video_with_audio(
    source_video_path: str,
    rendered_video_path: Path,
    output_video_path: Path,
) -> Dict[str, Any]:
    """Re-encode the redacted render to a browser-playable MP4.

    OpenCV writes a video-only ``mp4v`` MP4. We re-encode the video stream to
    H.264 / yuv420p, attach the original audio (AAC) when present, and write
    ``+faststart`` so the asset streams in a browser. Silent source videos
    still succeed (the audio map is optional).

    When ffmpeg is unavailable (or the encode fails) we preserve the rendered
    file as a best-effort artifact but flag ``browser_safe_render=False`` with a
    structured ``browser_safe_error`` so the worker never marks the asset
    playback-ready.
    """
    encode_command = [
        "ffmpeg",
        "-y",
        "-i",
        str(rendered_video_path),
        "-i",
        str(source_video_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(output_video_path),
    ]
    try:
        completed = subprocess.run(
            encode_command,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        shutil.move(str(rendered_video_path), str(output_video_path))
        return {
            "audio_preserved": False,
            "audio_muxed": False,
            "audio_mux_error": "ffmpeg_unavailable",
            "browser_safe_render": False,
            "browser_safe_error": BROWSER_SAFE_RENDER_ERROR_FFMPEG_MISSING,
            "video_codec": "mpeg4",
        }

    if completed.returncode != 0:
        shutil.move(str(rendered_video_path), str(output_video_path))
        stderr = (completed.stderr or "").strip()
        return {
            "audio_preserved": False,
            "audio_muxed": False,
            "audio_mux_error": stderr[:500] if stderr else "ffmpeg_encode_failed",
            "browser_safe_render": False,
            "browser_safe_error": BROWSER_SAFE_RENDER_ERROR_ENCODE_FAILED,
            "video_codec": "mpeg4",
        }

    rendered_video_path.unlink(missing_ok=True)
    return {
        "audio_preserved": True,
        "audio_muxed": True,
        "audio_mux_error": None,
        "browser_safe_render": True,
        "browser_safe_error": None,
        "video_codec": "h264",
    }


def _load_face_cascade():
    cv2 = _require_cv2()
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(str(cascade_path))
    if cascade.empty():
        raise RuntimeError(f"Unable to load face cascade: {cascade_path}")
    return cascade


def _load_profile_cascade():
    """Load the side-profile Haar cascade, or ``None`` when unavailable.

    PR C9.4 PART 2 — the frontal cascade misses faces turned to the side. For
    the blur-all render we additionally sweep with the profile cascade (and a
    horizontally-flipped pass) so more candidate faces are caught and blurred.
    Returns ``None`` rather than raising so the render degrades to frontal-only
    instead of failing outright.
    """
    cv2 = _require_cv2()
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_profileface.xml"
    cascade = cv2.CascadeClassifier(str(cascade_path))
    if cascade.empty():
        return None
    return cascade


def _detect_profile_faces(frame: np.ndarray, profile_cascade: Any) -> List[Tuple[int, int, int, int]]:
    """Detect side-profile faces in both orientations (left- and right-facing)."""
    if profile_cascade is None or frame is None:
        return []
    cv2 = _require_cv2()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    boxes: List[Tuple[int, int, int, int]] = []
    detected = profile_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(36, 36))
    for box in detected:
        boxes.append(tuple(int(v) for v in box))
    # The profile cascade is trained on one orientation; flip to catch the other.
    flipped = cv2.flip(gray, 1)
    width = gray.shape[1]
    detected_flipped = profile_cascade.detectMultiScale(flipped, scaleFactor=1.1, minNeighbors=4, minSize=(36, 36))
    for box in detected_flipped:
        fx, fy, fw, fh = (int(v) for v in box)
        # Map the flipped x back to original-image coordinates.
        boxes.append((width - fx - fw, fy, fw, fh))
    return boxes


def _merge_boxes(
    boxes: List[Tuple[int, int, int, int]],
    iou_threshold: float = 0.3,
) -> List[Tuple[int, int, int, int]]:
    """Deduplicate overlapping boxes so a face is counted/blurred once."""
    merged: List[Tuple[int, int, int, int]] = []
    for box in boxes:
        if box[2] <= 0 or box[3] <= 0:
            continue
        if any(_bbox_iou(box, kept) >= iou_threshold for kept in merged):
            continue
        merged.append(box)
    return merged


def _safe_crop(frame: np.ndarray, bbox: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    x, y, w, h = bbox
    if w <= 0 or h <= 0:
        return None
    x = max(0, x)
    y = max(0, y)
    return frame[y:y + h, x:x + w]


def detect_faces(frame: np.ndarray, cascade: Optional[Any] = None) -> List[Tuple[int, int, int, int]]:
    if frame is None:
        return []
    cv2 = _require_cv2()
    cascade = cascade or _load_face_cascade()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    detected = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(36, 36),
    )
    return [tuple(int(v) for v in box) for box in detected]


def build_face_signature(face_bgr: np.ndarray) -> Optional[FaceSignature]:
    if face_bgr is None or face_bgr.size == 0:
        return None
    cv2 = _require_cv2()
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    normalized = cv2.resize(gray, (128, 128))
    equalized = cv2.equalizeHist(normalized)
    hist = cv2.calcHist([equalized], [0], None, [64], [0, 256])
    hist = cv2.normalize(hist, hist).flatten()

    ahash_img = cv2.resize(equalized, (8, 8))
    ahash_bits = (ahash_img > ahash_img.mean()).astype(np.uint8).flatten()
    return FaceSignature(histogram=hist, ahash=ahash_bits)


def signature_similarity(signature: FaceSignature, references: List[FaceSignature]) -> float:
    if not references:
        return 0.0
    cv2 = _require_cv2()
    best_score = 0.0
    for reference in references:
        hist_score = float(cv2.compareHist(signature.histogram.astype(np.float32), reference.histogram.astype(np.float32), cv2.HISTCMP_CORREL))
        hist_score = max(0.0, min(1.0, (hist_score + 1.0) / 2.0))
        hash_similarity = float((signature.ahash == reference.ahash).sum()) / float(len(signature.ahash))
        combined = 0.7 * hist_score + 0.3 * hash_similarity
        if combined > best_score:
            best_score = combined
    return round(best_score, 4)


def load_reference_signatures(reference_paths: List[str]) -> List[FaceSignature]:
    cv2 = _require_cv2()
    cascade = _load_face_cascade()
    signatures: List[FaceSignature] = []
    for reference_path in reference_paths:
        image = cv2.imread(str(reference_path))
        if image is None:
            continue
        faces = detect_faces(image, cascade)
        face_crop = None
        if faces:
            face_crop = _safe_crop(image, max(faces, key=lambda box: box[2] * box[3]))
        if face_crop is None:
            face_crop = image
        signature = build_face_signature(face_crop)
        if signature is not None:
            signatures.append(signature)
    return signatures


def _bbox_center(box: Tuple[int, int, int, int]) -> Tuple[float, float]:
    x, y, w, h = box
    return x + w / 2.0, y + h / 2.0


def _bbox_iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    intersection = float((ix2 - ix1) * (iy2 - iy1))
    union = float(aw * ah + bw * bh - intersection)
    return intersection / union if union else 0.0


def blur_region(frame: np.ndarray, bbox: Tuple[int, int, int, int], padding: float = 0.30) -> None:
    """Destructively redact a face region.

    PR C9.4 PART 2 — the previous single GaussianBlur could leave a region with
    enough residual high-frequency detail to remain recognizable (and detectable
    by the post-render visual-redaction validator). We now (a) pad more
    generously so the whole head/edges are covered, (b) PIXELATE the region by
    down-then-up sampling — which collapses facial structure regardless of blur
    kernel math — and (c) follow with a heavy GaussianBlur. The combination
    drives the region's variance-of-Laplacian far below the validator's
    sharpness threshold and makes the face non-recoverable.
    """
    cv2 = _require_cv2()
    height, width = frame.shape[:2]
    x, y, w, h = bbox
    pad_w = int(w * padding)
    pad_h = int(h * padding)
    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(width, x + w + pad_w)
    y2 = min(height, y + h + pad_h)
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return
    roi_h, roi_w = roi.shape[:2]
    # 1) Pixelate: downsample to a tiny mosaic then nearest-neighbour upscale.
    mosaic_w = max(1, roi_w // 12)
    mosaic_h = max(1, roi_h // 12)
    small = cv2.resize(roi, (mosaic_w, mosaic_h), interpolation=cv2.INTER_LINEAR)
    pixelated = cv2.resize(small, (roi_w, roi_h), interpolation=cv2.INTER_NEAREST)
    # 2) Heavy GaussianBlur on top to remove mosaic edges (also high-frequency).
    blur_size = max(31, int(max(w, h) * 0.6))
    if blur_size % 2 == 0:
        blur_size += 1
    frame[y1:y2, x1:x2] = cv2.GaussianBlur(pixelated, (blur_size, blur_size), 0)


def analyze_video_privacy(
    video_path: str,
    reference_paths: List[str],
    teacher_match_threshold: float,
    ambiguous_match_threshold: float,
    max_frames: int = 150,
    sample_stride: int = 15,
) -> Dict[str, Any]:
    if _cv2 is None:
        if not ALLOW_DEGRADED_PRIVACY_RUNTIME:
            raise RuntimeError(_cv2_unavailable_message())
        return {
            "frames_analyzed": 0,
            "teacher_track_id": None,
            "review_reason": None,
            "candidate_tracks": [],
            "fallback_mode": "blur_all",
            "manifest_tracks": [],
            "runtime_fallback": "cv2_unavailable",
        }
    cv2 = _require_cv2()
    references = load_reference_signatures(reference_paths)
    if not references:
        raise RuntimeError("Teacher privacy profile has no usable face references")

    cascade = _load_face_cascade()
    cap = cv2.VideoCapture(video_path)
    if not cap or not cap.isOpened():
        raise RuntimeError("Unable to open video for privacy analysis")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    tracks: List[Dict[str, Any]] = []
    frames_analyzed = 0
    candidate_tracks: List[Dict[str, Any]] = []
    frame_index = 0

    try:
        while frames_analyzed < max_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
            if not ret:
                break
            detections = detect_faces(frame, cascade)
            for bbox in detections:
                crop = _safe_crop(frame, bbox)
                signature = build_face_signature(crop) if crop is not None else None
                score = signature_similarity(signature, references) if signature is not None else 0.0
                assigned_track = None
                best_iou = 0.0
                for track in tracks:
                    iou = _bbox_iou(track["last_bbox"], bbox)
                    if iou > best_iou and iou >= 0.15:
                        best_iou = iou
                        assigned_track = track
                if assigned_track is None:
                    assigned_track = {
                        "track_id": f"track_{len(tracks) + 1:02d}",
                        "scores": [],
                        "detections": [],
                        "last_bbox": bbox,
                    }
                    tracks.append(assigned_track)
                assigned_track["scores"].append(score)
                assigned_track["detections"].append(
                    {
                        "frame_index": frame_index,
                        "timestamp_ms": int((frame_index / fps) * 1000),
                        "bbox": list(map(int, bbox)),
                        "teacher_match_score": score,
                    }
                )
                assigned_track["last_bbox"] = bbox
            frames_analyzed += 1
            frame_index += max(1, sample_stride)
    finally:
        cap.release()

    scored_tracks = []
    for track in tracks:
        if not track["detections"]:
            continue
        avg_score = sum(track["scores"]) / len(track["scores"])
        best_score = max(track["scores"])
        scored_tracks.append(
            {
                "track_id": track["track_id"],
                "avg_score": round(avg_score, 4),
                "best_score": round(best_score, 4),
                "detection_count": len(track["detections"]),
                "sample_frame_index": track["detections"][0]["frame_index"],
                "sample_bbox": track["detections"][0]["bbox"],
            }
        )
    scored_tracks.sort(key=lambda item: (item["avg_score"], item["best_score"], item["detection_count"]), reverse=True)
    candidate_tracks = [
        {
            "track_id": item["track_id"],
            "teacher_match_score": item["avg_score"],
            "sample_frame_url": None,
        }
        for item in scored_tracks[:3]
    ]

    teacher_track_id = None
    review_reason = None
    fallback_mode = "none"
    if scored_tracks:
        best = scored_tracks[0]
        second = scored_tracks[1] if len(scored_tracks) > 1 else None
        if best["avg_score"] >= teacher_match_threshold:
            if second and second["avg_score"] >= ambiguous_match_threshold and abs(best["avg_score"] - second["avg_score"]) < 0.05:
                review_reason = "multiple_candidate_teacher_tracks"
            else:
                teacher_track_id = best["track_id"]
        elif best["avg_score"] >= ambiguous_match_threshold:
            review_reason = "teacher_match_ambiguous"
        else:
            fallback_mode = "blur_all"
    else:
        fallback_mode = "blur_all"

    manifest_tracks = []
    for item in scored_tracks:
        manifest_tracks.append(
            {
                "track_id": item["track_id"],
                "decision": "teacher_visible" if teacher_track_id == item["track_id"] else "blur",
                "teacher_match_score": item["avg_score"],
                "segments": [],
            }
        )

    return {
        "frames_analyzed": frames_analyzed,
        "teacher_track_id": teacher_track_id,
        "review_reason": review_reason,
        "candidate_tracks": candidate_tracks,
        "fallback_mode": fallback_mode,
        "manifest_tracks": manifest_tracks,
    }


def render_redacted_video(
    source_video_path: str,
    output_video_path: str,
    thumbnail_output_path: str,
    reference_paths: List[str],
    teacher_match_threshold: float,
    ambiguous_match_threshold: float,
    teacher_track_id: Optional[str] = None,
    force_blur_all: bool = False,
) -> Dict[str, Any]:
    if _cv2 is None:
        if not ALLOW_DEGRADED_PRIVACY_RUNTIME:
            raise RuntimeError(_cv2_unavailable_message())
        output_path = Path(output_video_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(str(source_video_path), str(output_path))
        _write_placeholder_thumbnail(thumbnail_output_path)
        return {
            "frames_processed": 0,
            "frames_with_teacher_visible": 0,
            "faces_detected_total": 0,
            "faces_blurred_total": 0,
            "runtime_fallback": "cv2_unavailable_copy_only",
            "browser_safe_render": False,
            "browser_safe_error": "cv2_unavailable_copy_only",
            "video_codec": None,
        }
    cv2 = _require_cv2()
    references = load_reference_signatures(reference_paths)
    if not references:
        raise RuntimeError("Teacher privacy profile has no usable face references")

    cascade = _load_face_cascade()
    profile_cascade = _load_profile_cascade()
    cap = cv2.VideoCapture(source_video_path)
    if not cap or not cap.isOpened():
        raise RuntimeError("Unable to open video for redaction rendering")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("Unable to determine source video dimensions")

    output_path = Path(output_video_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rendered_video_path = output_path.with_name(f"{output_path.stem}.video_only{output_path.suffix}")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(rendered_video_path), fourcc, fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError("Unable to open output video writer")

    thumbnail_path = Path(thumbnail_output_path)
    thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

    previous_teacher_bbox: Optional[Tuple[int, int, int, int]] = None
    # PR C9.4 PART 2 — temporal blur persistence for the blur_all path: a face
    # that flickers out of detection for a frame or two still gets blurred,
    # closing a window where a recognizable face would otherwise flash through.
    temporal_blur_ttl = 6
    persisted_blur_boxes: List[Tuple[Tuple[int, int, int, int], int]] = []
    frame_index = 0
    frames_processed = 0
    frames_with_teacher_visible = 0
    faces_detected_total = 0
    faces_blurred_total = 0
    thumbnail_written = False

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            # Combine the frontal cascade (patchable ``detect_faces``) with the
            # side-profile sweep so faces the frontal detector misses are still
            # caught and blurred.
            frontal = detect_faces(frame, cascade)
            profile = _detect_profile_faces(frame, profile_cascade)
            detections = _merge_boxes(list(frontal) + list(profile))

            if force_blur_all:
                # Blur the union of this frame's detections and recently-seen
                # boxes. Count == blur so the blur_all invariant
                # (faces_blurred_total == faces_detected_total) is preserved.
                candidate_boxes = list(detections)
                for box, _ttl in persisted_blur_boxes:
                    candidate_boxes.append(box)
                regions_to_blur = _merge_boxes(candidate_boxes)
                for bbox in regions_to_blur:
                    blur_region(frame, bbox)
                faces_detected_total += len(regions_to_blur)
                faces_blurred_total += len(regions_to_blur)
                previous_teacher_bbox = None
                # Age out old persisted boxes; refresh current detections.
                refreshed: List[Tuple[Tuple[int, int, int, int], int]] = []
                for box, ttl in persisted_blur_boxes:
                    if ttl - 1 > 0 and not any(_bbox_iou(box, det) >= 0.3 for det in detections):
                        refreshed.append((box, ttl - 1))
                for det in detections:
                    refreshed.append((det, temporal_blur_ttl))
                persisted_blur_boxes = refreshed
            else:
                faces_detected_total += len(detections)
                best_face: Optional[Tuple[int, int, int, int]] = None
                best_score = -1.0
                scored_faces: List[Tuple[Tuple[int, int, int, int], float]] = []
                for bbox in detections:
                    crop = _safe_crop(frame, bbox)
                    signature = build_face_signature(crop) if crop is not None else None
                    score = signature_similarity(signature, references) if signature is not None else 0.0
                    if previous_teacher_bbox is not None and _bbox_iou(previous_teacher_bbox, bbox) >= 0.2:
                        score = max(score, ambiguous_match_threshold)
                    scored_faces.append((bbox, score))
                    if score > best_score:
                        best_face = bbox
                        best_score = score

                teacher_visible_this_frame = False
                if best_face is not None and best_score >= teacher_match_threshold:
                    teacher_visible_this_frame = True
                    previous_teacher_bbox = best_face
                else:
                    previous_teacher_bbox = None

                for bbox, score in scored_faces:
                    should_keep = teacher_visible_this_frame and best_face == bbox and score >= ambiguous_match_threshold
                    if not should_keep:
                        blur_region(frame, bbox)
                        faces_blurred_total += 1

                if teacher_visible_this_frame:
                    frames_with_teacher_visible += 1

            if not thumbnail_written and frame_index >= max(1, int(fps)):
                cv2.imwrite(str(thumbnail_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                thumbnail_written = True

            writer.write(frame)
            frame_index += 1
            frames_processed += 1
    finally:
        cap.release()
        writer.release()

    if not thumbnail_written:
        cap_thumb = cv2.VideoCapture(str(rendered_video_path))
        ret, frame = cap_thumb.read()
        if ret:
            cv2.imwrite(str(thumbnail_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        cap_thumb.release()

    audio_stats = _finalize_redacted_video_with_audio(source_video_path, rendered_video_path, output_path)

    return {
        "frames_processed": frames_processed,
        "frames_with_teacher_visible": frames_with_teacher_visible,
        "faces_detected_total": faces_detected_total,
        "faces_blurred_total": faces_blurred_total,
        **audio_stats,
    }
