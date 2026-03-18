import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.append(str(Path(__file__).resolve().parents[1]))

from privacy_pipeline import analyze_video_privacy, render_redacted_video


def _write_test_video(path: Path, frame_count: int = 12, width: int = 160, height: int = 120) -> None:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, 10.0, (width, height))
    assert writer.isOpened()
    for idx in range(frame_count):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        cv2.rectangle(frame, (40, 20), (110, 95), (255, 255, 255), -1)
        cv2.putText(frame, str(idx), (8, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (80, 80, 80), 1)
        writer.write(frame)
    writer.release()


def test_analyze_video_privacy_selects_teacher_track(monkeypatch, tmp_path):
    video_path = tmp_path / "teacher.mp4"
    _write_test_video(video_path)

    monkeypatch.setattr("privacy_pipeline.load_reference_signatures", lambda paths: ["ref"])
    monkeypatch.setattr("privacy_pipeline.detect_faces", lambda frame, cascade=None: [(40, 20, 70, 75)])
    monkeypatch.setattr("privacy_pipeline.build_face_signature", lambda face: {"score": 0.96})
    monkeypatch.setattr("privacy_pipeline.signature_similarity", lambda signature, refs: signature["score"])

    result = analyze_video_privacy(
        str(video_path),
        [str(video_path)],
        teacher_match_threshold=0.9,
        ambiguous_match_threshold=0.8,
        max_frames=8,
        sample_stride=2,
    )

    assert result["teacher_track_id"] == "track_01"
    assert result["review_reason"] is None
    assert result["fallback_mode"] == "none"
    assert result["candidate_tracks"][0]["teacher_match_score"] >= 0.9


def test_render_redacted_video_creates_outputs(monkeypatch, tmp_path):
    video_path = tmp_path / "source.mp4"
    output_path = tmp_path / "redacted.mp4"
    thumbnail_path = tmp_path / "thumb.jpg"
    _write_test_video(video_path)

    monkeypatch.setattr("privacy_pipeline.load_reference_signatures", lambda paths: ["ref"])
    monkeypatch.setattr("privacy_pipeline.detect_faces", lambda frame, cascade=None: [(40, 20, 70, 75)])
    monkeypatch.setattr("privacy_pipeline.build_face_signature", lambda face: {"score": 0.12})
    monkeypatch.setattr("privacy_pipeline.signature_similarity", lambda signature, refs: signature["score"])

    stats = render_redacted_video(
        str(video_path),
        str(output_path),
        str(thumbnail_path),
        [str(video_path)],
        teacher_match_threshold=0.9,
        ambiguous_match_threshold=0.8,
        force_blur_all=True,
    )

    assert output_path.exists()
    assert thumbnail_path.exists()
    assert stats["frames_processed"] > 0
    assert stats["faces_blurred_total"] > 0
