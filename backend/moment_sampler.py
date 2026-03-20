from typing import Any, Dict, List

import cv2


def segment_video_windows(video_path: str, window_sec: float = 20.0) -> List[Dict[str, Any]]:
    windows: List[Dict[str, Any]] = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return windows

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if fps <= 0 or total_frames <= 0:
        return windows

    duration_sec = max(1.0, total_frames / fps)
    start_sec = 0.0
    index = 0
    while start_sec < duration_sec:
        end_sec = min(duration_sec, start_sec + max(5.0, window_sec))
        windows.append(
            {
                "window_id": f"window_{index:02d}",
                "start_sec": round(start_sec, 1),
                "end_sec": round(end_sec, 1),
                "duration_sec": round(end_sec - start_sec, 1),
            }
        )
        start_sec = end_sec
        index += 1
    return windows


def _infer_phase(start_sec: float, end_sec: float, total_duration_sec: float, dominant_frame: Dict[str, Any]) -> str:
    midpoint = ((start_sec + end_sec) / 2.0) / max(total_duration_sec, 1.0)
    board_density = float((dominant_frame.get("selection_features") or {}).get("board_text_density_score", 0.0))
    participant_density = float((dominant_frame.get("selection_features") or {}).get("participant_density_score", 0.0))

    if midpoint < 0.15:
        return "lesson_launch"
    if board_density >= 0.45 and midpoint <= 0.8:
        return "modeling"
    if midpoint < 0.55:
        return "guided_practice"
    if participant_density >= 0.45 and midpoint < 0.85:
        return "student_work"
    if midpoint < 0.9:
        return "check_for_understanding"
    return "closure"


def score_windows(windows: List[Dict[str, Any]], frames: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not windows:
        return []

    total_duration_sec = max(float(windows[-1]["end_sec"]), 1.0)
    enriched_windows: List[Dict[str, Any]] = []
    for window in windows:
        assigned = [
            frame
            for frame in frames
            if float(window["start_sec"]) <= float(frame.get("timestamp_sec", 0.0)) < float(window["end_sec"])
        ]
        dominant_frame = max(
            assigned,
            key=lambda item: float(item.get("selection_score", 0.0)),
            default=None,
        )
        if dominant_frame is None and frames:
            midpoint = (float(window["start_sec"]) + float(window["end_sec"])) / 2.0
            dominant_frame = min(frames, key=lambda item: abs(float(item.get("timestamp_sec", 0.0)) - midpoint))

        features = dict((dominant_frame or {}).get("selection_features") or {})
        window_score = max((float(frame.get("selection_score", 0.0)) for frame in assigned), default=float((dominant_frame or {}).get("selection_score", 0.0) or 0.0))
        window_phase = _infer_phase(
            float(window["start_sec"]),
            float(window["end_sec"]),
            total_duration_sec,
            dominant_frame or {},
        )
        enriched_windows.append(
            {
                **window,
                "score": round(window_score, 4),
                "phase": window_phase,
                "selection_reason": (dominant_frame or {}).get("selection_reason") or "timeline_coverage",
                "representative_frame_sec": float((dominant_frame or {}).get("timestamp_sec", window["start_sec"])),
                "supporting_features": features,
            }
        )
    return enriched_windows


def select_lesson_moments(windows: List[Dict[str, Any]], max_moments: int = 6) -> List[Dict[str, Any]]:
    if not windows:
        return []

    selected: List[Dict[str, Any]] = []
    phase_seen = set()
    sorted_by_time = sorted(windows, key=lambda item: item["start_sec"])
    sorted_by_score = sorted(windows, key=lambda item: (item.get("score", 0.0), -float(item["start_sec"])), reverse=True)

    anchors = []
    if sorted_by_time:
        anchors.append(sorted_by_time[0])
    if len(sorted_by_time) > 1:
        anchors.append(sorted_by_time[-1])

    for anchor in anchors:
        if anchor not in selected and len(selected) < max_moments:
            selected.append(anchor)
            phase_seen.add(anchor.get("phase"))

    for window in sorted_by_score:
        if len(selected) >= max_moments:
            break
        if window in selected:
            continue
        if window.get("phase") not in phase_seen:
            selected.append(window)
            phase_seen.add(window.get("phase"))

    for window in sorted_by_score:
        if len(selected) >= max_moments:
            break
        if window in selected:
            continue
        selected.append(window)

    return sorted(
        [
            {
                "moment_id": f"moment_{idx + 1:02d}",
                "start_sec": round(float(window["start_sec"]), 1),
                "end_sec": round(float(window["end_sec"]), 1),
                "phase": window.get("phase", "guided_practice"),
                "selection_reason": window.get("selection_reason", "timeline_coverage"),
                "representative_frame_sec": round(float(window.get("representative_frame_sec", window["start_sec"])), 1),
                "supporting_features": window.get("supporting_features") or {},
                "score": round(float(window.get("score", 0.0)), 4),
            }
            for idx, window in enumerate(selected)
        ],
        key=lambda item: item["start_sec"],
    )
