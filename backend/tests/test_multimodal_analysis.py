import importlib.util
from pathlib import Path


def _load_multimodal_module():
    module_path = Path(__file__).resolve().parents[1] / "multimodal_analysis.py"
    spec = importlib.util.spec_from_file_location("backend_multimodal_analysis", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


multimodal = _load_multimodal_module()


def test_align_transcript_segments_to_moments_attaches_overlapping_segments():
    moments = [
        {"moment_id": "moment_01", "start_sec": 10.0, "end_sec": 20.0, "phase": "modeling"},
        {"moment_id": "moment_02", "start_sec": 20.0, "end_sec": 30.0, "phase": "closure"},
    ]
    transcript_segments = [
        {"start_sec": 11.0, "end_sec": 14.0, "text": "Let's compare these two methods."},
        {"start_sec": 22.0, "end_sec": 24.0, "text": "Now summarize your answer."},
    ]

    aligned = multimodal.align_transcript_segments_to_moments(moments, transcript_segments)

    assert aligned[0]["transcript_excerpt"] == "Let's compare these two methods."
    assert aligned[1]["transcript_excerpt"] == "Now summarize your answer."


def test_build_multimodal_analysis_payload_marks_audio_when_transcript_exists():
    frames = [
        {
            "timestamp_sec": 12.0,
            "image_b64": "abc",
            "moment_id": "moment_01",
            "moment_phase": "modeling",
        }
    ]
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
    transcript_doc = {
        "segments": [
            {
                "start_sec": 11.0,
                "end_sec": 15.0,
                "text": "Let's compare the two approaches.",
            }
        ]
    }
    feature_doc = {"question_count": 1, "turn_count": 1}

    payload = multimodal.build_multimodal_analysis_payload(
        frames,
        moment_manifest,
        transcript_doc,
        feature_doc,
    )

    assert payload["modalities_used"] == ["vision", "audio"]
    assert payload["moments"][0]["transcript_excerpt"] == "Let's compare the two approaches."
    assert payload["frames"][0]["transcript_excerpt"] == "Let's compare the two approaches."
    assert payload["audio_features"]["question_count"] == 1
