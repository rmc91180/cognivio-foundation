import importlib.util
from pathlib import Path


def _load_moment_sampler_module():
    module_path = Path(__file__).resolve().parents[1] / "moment_sampler.py"
    spec = importlib.util.spec_from_file_location("backend_moment_sampler", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


moment_sampler = _load_moment_sampler_module()


def test_score_windows_assigns_phase_and_representative_frame():
    windows = [
        {"window_id": "window_00", "start_sec": 0.0, "end_sec": 20.0, "duration_sec": 20.0},
        {"window_id": "window_01", "start_sec": 20.0, "end_sec": 40.0, "duration_sec": 20.0},
    ]
    frames = [
        {
            "timestamp_sec": 5.0,
            "selection_score": 0.42,
            "selection_reason": "teacher_prominence",
            "selection_features": {"teacher_prominence_score": 0.7, "board_text_density_score": 0.1},
        },
        {
            "timestamp_sec": 28.0,
            "selection_score": 0.81,
            "selection_reason": "board_content_change",
            "selection_features": {"teacher_prominence_score": 0.8, "board_text_density_score": 0.7},
        },
    ]

    scored = moment_sampler.score_windows(windows, frames)

    assert len(scored) == 2
    assert scored[0]["representative_frame_sec"] == 5.0
    assert scored[1]["representative_frame_sec"] == 28.0
    assert scored[1]["phase"] in {"modeling", "guided_practice"}


def test_select_lesson_moments_keeps_timeline_anchors_and_diverse_phases():
    windows = [
        {
            "window_id": "window_00",
            "start_sec": 0.0,
            "end_sec": 20.0,
            "phase": "lesson_launch",
            "selection_reason": "timeline_coverage",
            "representative_frame_sec": 5.0,
            "supporting_features": {},
            "score": 0.25,
        },
        {
            "window_id": "window_01",
            "start_sec": 20.0,
            "end_sec": 40.0,
            "phase": "modeling",
            "selection_reason": "board_content_change",
            "representative_frame_sec": 28.0,
            "supporting_features": {},
            "score": 0.88,
        },
        {
            "window_id": "window_02",
            "start_sec": 40.0,
            "end_sec": 60.0,
            "phase": "closure",
            "selection_reason": "timeline_coverage",
            "representative_frame_sec": 50.0,
            "supporting_features": {},
            "score": 0.22,
        },
    ]

    moments = moment_sampler.select_lesson_moments(windows, max_moments=3)

    assert [moment["phase"] for moment in moments] == ["lesson_launch", "modeling", "closure"]
    assert moments[0]["moment_id"] == "moment_01"
    assert moments[-1]["end_sec"] == 60.0
