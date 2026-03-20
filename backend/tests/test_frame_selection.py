import importlib.util
import os
import sys
import types
from pathlib import Path


def _load_frame_selection_module():
    if "cv2" not in sys.modules:
        import cv2  # noqa: F401
    module_path = Path(__file__).resolve().parents[1] / "frame_selection.py"
    spec = importlib.util.spec_from_file_location("backend_frame_selection", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _load_server_module():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub
    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub

    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.append(str(backend_root))

    module_path = backend_root / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_frame_selection", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


frame_selection = _load_frame_selection_module()
server = _load_server_module()


def test_score_frame_candidates_prefers_instructionally_rich_frames():
    candidates = [
        {
            "timestamp_sec": 10.0,
            "features": {
                "scene_change_score": 0.1,
                "motion_score": 0.1,
                "teacher_prominence_score": 0.2,
                "participant_density_score": 0.1,
                "board_text_density_score": 0.0,
                "visual_novelty_score": 0.1,
            },
            "histogram": [0.1, 0.2],
        },
        {
            "timestamp_sec": 20.0,
            "features": {
                "scene_change_score": 0.4,
                "motion_score": 0.5,
                "teacher_prominence_score": 0.8,
                "participant_density_score": 0.7,
                "board_text_density_score": 0.2,
                "visual_novelty_score": 0.6,
            },
            "histogram": [0.2, 0.3],
        },
    ]

    scored = frame_selection.score_frame_candidates(candidates)

    assert scored[0]["timestamp_sec"] == 20.0
    assert scored[0]["score"] > scored[1]["score"]
    assert scored[0]["reason"] in {
        "scene_transition",
        "high_activity_window",
        "teacher_prominence",
        "participant_density_change",
        "board_content_change",
        "visual_novelty",
    }


def test_select_diverse_frames_enforces_min_gap_for_nearby_candidates():
    candidates = [
        {"timestamp_sec": 10.0, "score": 0.9, "histogram": [0.0, 1.0]},
        {"timestamp_sec": 12.0, "score": 0.8, "histogram": [0.0, 0.95]},
        {"timestamp_sec": 25.0, "score": 0.7, "histogram": [1.0, 0.0]},
    ]

    selected = frame_selection.select_diverse_frames(candidates, max_frames=2, min_gap_sec=8)

    assert [item["timestamp_sec"] for item in selected] == [10.0, 25.0]


def test_extract_video_frames_uses_smart_selection_when_enabled(monkeypatch):
    monkeypatch.setattr(server, "SMART_FRAME_SELECTION_ENABLED", True)
    monkeypatch.setattr(server, "VIDEO_ANALYSIS_FRAME_SCAN_FPS", 1.0)
    monkeypatch.setattr(server, "VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC", 8.0)
    monkeypatch.setattr(server, "VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS", False)
    monkeypatch.setattr(server, "SMART_FRAME_SELECTION_VERSION", "smart_frames_v1")

    monkeypatch.setattr(
        server,
        "scan_video_candidates",
        lambda video_path, scan_fps, enable_ocr_signals: [
            {
                "timestamp_sec": 15.0,
                "image_b64": "abc",
                "features": {"teacher_prominence_score": 0.8},
                "histogram": [0.0, 1.0],
            }
        ],
    )
    monkeypatch.setattr(
        server,
        "score_frame_candidates",
        lambda candidates: [{**candidates[0], "score": 0.88, "reason": "teacher_prominence"}],
    )
    monkeypatch.setattr(server, "select_diverse_frames", lambda candidates, max_frames, min_gap_sec: candidates)

    frames = server.extract_video_frames("dummy.mp4", max_frames=12)

    assert frames == [
        {
            "timestamp_sec": 15.0,
            "image_b64": "abc",
            "selection_reason": "teacher_prominence",
            "selection_score": 0.88,
            "selection_features": {"teacher_prominence_score": 0.8},
        }
    ]


def test_build_sampling_manifest_uses_frame_metadata(monkeypatch):
    monkeypatch.setattr(server, "SMART_FRAME_SELECTION_ENABLED", True)
    monkeypatch.setattr(server, "SMART_FRAME_SELECTION_VERSION", "smart_frames_v1")

    manifest = server.build_sampling_manifest(
        "video_123",
        [
            {
                "timestamp_sec": 12.5,
                "selection_reason": "board_content_change",
                "selection_score": 0.91,
                "selection_features": {"board_text_density_score": 0.8},
            }
        ],
    )

    assert manifest["video_id"] == "video_123"
    assert manifest["strategy_version"] == "smart_frames_v1"
    assert manifest["selected_frames"][0]["reason"] == "board_content_change"
    assert manifest["selected_frames"][0]["features"]["board_text_density_score"] == 0.8


def test_attach_moment_metadata_to_frames_enriches_matching_frames():
    frames = [{"timestamp_sec": 14.0, "image_b64": "abc"}]
    moment_manifest = {
        "moments": [
            {
                "moment_id": "moment_01",
                "start_sec": 10.0,
                "end_sec": 20.0,
                "phase": "modeling",
                "selection_reason": "board_content_change",
            }
        ]
    }

    enriched = server.attach_moment_metadata_to_frames(frames, moment_manifest)

    assert enriched[0]["moment_id"] == "moment_01"
    assert enriched[0]["moment_phase"] == "modeling"
    assert enriched[0]["moment_selection_reason"] == "board_content_change"


def test_build_moment_manifest_uses_sampler_pipeline(monkeypatch):
    monkeypatch.setattr(server, "SMART_MOMENT_SAMPLING_ENABLED", True)
    monkeypatch.setattr(server, "SMART_MOMENT_SAMPLING_VERSION", "lesson_moments_v1")
    monkeypatch.setattr(server, "VIDEO_ANALYSIS_WINDOW_SEC", 20.0)
    monkeypatch.setattr(server, "VIDEO_ANALYSIS_MAX_MOMENTS", 4)
    monkeypatch.setattr(server, "segment_video_windows", lambda video_path, window_sec: [{"start_sec": 0.0, "end_sec": 20.0}])
    monkeypatch.setattr(server, "score_windows", lambda windows, frames: [{**windows[0], "phase": "lesson_launch", "selection_reason": "timeline_coverage", "representative_frame_sec": 6.0, "supporting_features": {}, "score": 0.4}])
    monkeypatch.setattr(server, "select_lesson_moments", lambda windows, max_moments: [{"moment_id": "moment_01", "start_sec": 0.0, "end_sec": 20.0, "phase": "lesson_launch", "selection_reason": "timeline_coverage", "representative_frame_sec": 6.0, "supporting_features": {}, "score": 0.4}])

    manifest = server.build_moment_manifest("video_123", "dummy.mp4", [{"timestamp_sec": 6.0, "image_b64": "abc"}])

    assert manifest["video_id"] == "video_123"
    assert manifest["strategy_version"] == "lesson_moments_v1"
    assert manifest["moments"][0]["phase"] == "lesson_launch"
