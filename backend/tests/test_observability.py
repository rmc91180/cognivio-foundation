from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import observability


def test_estimate_analysis_usage_includes_frames_and_transcript():
    usage = observability.estimate_analysis_usage(
        frames=[{"timestamp": 1}, {"timestamp": 2}],
        multimodal_payload={
            "moments": [
                {"transcript_excerpt": "hello world"},
                {"transcript_excerpt": "more transcript context here"},
            ]
        },
        output_payload={"summary": "abc", "recommendations": ["x", "y"]},
    )
    assert usage["frame_count"] == 2
    assert usage["estimated_input_tokens"] > 972
    assert usage["estimated_output_tokens"] is not None


def test_estimate_analysis_usage_includes_estimated_cost():
    usage = observability.estimate_analysis_usage(
        frames=[{"timestamp": 1}],
        multimodal_payload={"moments": [{"transcript_excerpt": "shalom class"}]},
        output_payload={"summary": "abc"},
        input_cost_per_million=0.4,
        output_cost_per_million=1.6,
    )
    assert usage["estimated_output_tokens"] is not None
    assert usage["estimated_cost_usd"] is not None
    assert usage["estimated_cost_usd"] > 0


def test_record_analysis_run_updates_snapshot():
    before = observability.snapshot()["analysis"]["total_runs"]
    observability.record_analysis_run(
        video_id="video-123",
        success=False,
        analysis_mode="fallback",
        duration_seconds=3.2,
        modalities_used=["vision"],
        estimated_input_tokens=1234,
        estimated_output_tokens=222,
        failure_reason="model_unavailable",
    )
    after = observability.snapshot()["analysis"]
    assert after["total_runs"] == before + 1
    assert after["failed_runs"] >= 1
    assert after["recent_failures"][0]["video_id"] == "video-123"
