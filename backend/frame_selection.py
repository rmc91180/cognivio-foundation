import base64
import math
from typing import Any, Dict, List, Optional

import cv2
import numpy as np


_FRAME_SIZE = (640, 480)
_HIST_BINS = (8, 8, 8)


def _get_face_cascade():
    cascade_path = getattr(cv2.data, "haarcascades", "") + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    return cascade if not cascade.empty() else None


def _resize_frame(frame: np.ndarray) -> np.ndarray:
    return cv2.resize(frame, _FRAME_SIZE)


def _encode_frame(frame: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    if not ok:
        raise RuntimeError("Unable to encode selected analysis frame")
    return base64.b64encode(buffer).decode("utf-8")


def _compute_histogram(frame: np.ndarray) -> np.ndarray:
    hist = cv2.calcHist([frame], [0, 1, 2], None, _HIST_BINS, [0, 256, 0, 256, 0, 256])
    hist = cv2.normalize(hist, hist).flatten()
    return hist


def _compute_scene_change_score(frame: np.ndarray, previous_frame: Optional[np.ndarray]) -> float:
    if previous_frame is None:
        return 0.0
    diff = cv2.absdiff(frame, previous_frame)
    return float(np.mean(diff) / 255.0)


def _compute_motion_score(frame: np.ndarray, previous_frame: Optional[np.ndarray]) -> float:
    if previous_frame is None:
        return 0.0
    prev_gray = cv2.cvtColor(previous_frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    diff = cv2.absdiff(gray, prev_gray)
    _, thresholded = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
    return float(np.count_nonzero(thresholded) / thresholded.size)


def _compute_face_metrics(frame: np.ndarray, face_cascade) -> Dict[str, float]:
    if face_cascade is None:
        return {"teacher_prominence_score": 0.0, "participant_density_score": 0.0}

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
    if len(faces) == 0:
        return {"teacher_prominence_score": 0.0, "participant_density_score": 0.0}

    frame_area = float(frame.shape[0] * frame.shape[1])
    largest_face_area = max(float(w * h) for (_, _, w, h) in faces)
    teacher_prominence_score = min(1.0, largest_face_area / (frame_area * 0.18))
    participant_density_score = min(1.0, len(faces) / 6.0)
    return {
        "teacher_prominence_score": round(teacher_prominence_score, 4),
        "participant_density_score": round(participant_density_score, 4),
    }


def _compute_board_text_density_score(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 75, 160)
    board_region = edges[: int(edges.shape[0] * 0.6), int(edges.shape[1] * 0.4) :]
    if board_region.size == 0:
        return 0.0
    return float(np.count_nonzero(board_region) / board_region.size)


def _compute_visual_novelty_score(histogram: np.ndarray, previous_histogram: Optional[np.ndarray]) -> float:
    if previous_histogram is None:
        return 0.0
    correlation = cv2.compareHist(histogram.astype("float32"), previous_histogram.astype("float32"), cv2.HISTCMP_CORREL)
    return float(max(0.0, min(1.0, 1.0 - ((correlation + 1.0) / 2.0))))


def _infer_reason(features: Dict[str, float]) -> str:
    if not features:
        return "timeline_coverage"
    top_feature = max(features.items(), key=lambda item: item[1])[0]
    return {
        "scene_change_score": "scene_transition",
        "motion_score": "high_activity_window",
        "teacher_prominence_score": "teacher_prominence",
        "participant_density_score": "participant_density_change",
        "board_text_density_score": "board_content_change",
        "visual_novelty_score": "visual_novelty",
    }.get(top_feature, "timeline_coverage")


def scan_video_candidates(video_path: str, scan_fps: float = 1.0, enable_ocr_signals: bool = False) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return candidates

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps <= 0 or total_frames <= 0:
        cap.release()
        return candidates

    step_frames = max(1, int(round(fps / max(scan_fps, 0.1))))
    face_cascade = _get_face_cascade()
    previous_frame = None
    previous_histogram = None

    for frame_idx in range(0, total_frames, step_frames):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, raw_frame = cap.read()
        if not ok or raw_frame is None:
            continue

        frame = _resize_frame(raw_frame)
        histogram = _compute_histogram(frame)
        features = {
            "scene_change_score": round(_compute_scene_change_score(frame, previous_frame), 4),
            "motion_score": round(_compute_motion_score(frame, previous_frame), 4),
            "board_text_density_score": round(_compute_board_text_density_score(frame), 4) if enable_ocr_signals else 0.0,
            "visual_novelty_score": round(_compute_visual_novelty_score(histogram, previous_histogram), 4),
        }
        features.update(_compute_face_metrics(frame, face_cascade))

        timestamp_sec = round(frame_idx / fps, 2)
        candidates.append(
            {
                "timestamp_sec": timestamp_sec,
                "frame_idx": frame_idx,
                "image_b64": _encode_frame(frame),
                "features": features,
                "histogram": histogram.tolist(),
            }
        )
        previous_frame = frame
        previous_histogram = histogram

    cap.release()
    return candidates


def score_frame_candidates(
    candidates: List[Dict[str, Any]],
    teacher_track: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    scored: List[Dict[str, Any]] = []
    for candidate in candidates:
        features = dict(candidate.get("features") or {})
        if teacher_track:
            features["teacher_prominence_score"] = max(
                float(features.get("teacher_prominence_score", 0.0)),
                float(teacher_track.get("teacher_prominence_score", 0.0)),
            )
        score = (
            0.22 * float(features.get("scene_change_score", 0.0))
            + 0.18 * float(features.get("motion_score", 0.0))
            + 0.22 * float(features.get("teacher_prominence_score", 0.0))
            + 0.12 * float(features.get("participant_density_score", 0.0))
            + 0.12 * float(features.get("board_text_density_score", 0.0))
            + 0.14 * float(features.get("visual_novelty_score", 0.0))
        )
        enriched = dict(candidate)
        enriched["score"] = round(score, 4)
        enriched["reason"] = _infer_reason(features)
        scored.append(enriched)
    return sorted(scored, key=lambda item: (item.get("score", 0.0), item.get("timestamp_sec", 0.0)), reverse=True)


def _histogram_correlation(candidate: Dict[str, Any], selected: Dict[str, Any]) -> float:
    hist_a = np.array(candidate.get("histogram") or [], dtype="float32")
    hist_b = np.array(selected.get("histogram") or [], dtype="float32")
    if hist_a.size == 0 or hist_b.size == 0:
        return 0.0
    return float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))


def select_diverse_frames(
    candidates: List[Dict[str, Any]],
    max_frames: int,
    min_gap_sec: float,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    for candidate in candidates:
        if len(selected) >= max_frames:
            break
        timestamp = float(candidate.get("timestamp_sec", 0.0))
        too_close = any(abs(timestamp - float(existing.get("timestamp_sec", 0.0))) < float(min_gap_sec) for existing in selected)
        too_similar = any(_histogram_correlation(candidate, existing) > 0.985 for existing in selected)
        if too_close or too_similar:
            continue
        selected.append(candidate)

    if len(selected) < max_frames:
        selected_ids = {id(item) for item in selected}
        for candidate in candidates:
            if len(selected) >= max_frames:
                break
            if id(candidate) in selected_ids:
                continue
            selected.append(candidate)
    return sorted(selected, key=lambda item: item.get("timestamp_sec", 0.0))
