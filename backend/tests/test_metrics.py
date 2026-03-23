from pathlib import Path
import sys

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import metrics
from app.main import app


def test_record_analysis_result_exposes_metrics():
    before = metrics.ANALYSIS_RUNS_TOTAL.labels(
        analysis_mode="openai",
        language="he",
        modalities="vision_audio",
        status="success",
    )._value.get()

    metrics.record_analysis_result(
        analysis_mode="openai",
        language="he",
        modalities=["vision", "audio"],
        success=True,
        duration_seconds=12.5,
        model="gpt-4.1-mini",
        estimated_input_tokens=1500,
        estimated_output_tokens=300,
        estimated_cost_usd=0.0042,
    )

    after = metrics.ANALYSIS_RUNS_TOTAL.labels(
        analysis_mode="openai",
        language="he",
        modalities="vision_audio",
        status="success",
    )._value.get()
    assert after == before + 1


def test_record_upload_and_report_metrics_increment():
    before_upload = metrics.UPLOADS_TOTAL.labels(
        source="admin",
        language="he",
        status="success",
    )._value.get()
    before_report = metrics.REPORTS_GENERATED_TOTAL.labels(
        format="pdf",
        language="he",
        status="success",
    )._value.get()

    metrics.record_upload_result(
        source="admin",
        language="he",
        success=True,
        duration_seconds=1.2,
    )
    metrics.record_report_result(
        format="pdf",
        language="he",
        success=True,
        duration_seconds=0.8,
    )

    after_upload = metrics.UPLOADS_TOTAL.labels(
        source="admin",
        language="he",
        status="success",
    )._value.get()
    after_report = metrics.REPORTS_GENERATED_TOTAL.labels(
        format="pdf",
        language="he",
        status="success",
    )._value.get()
    assert after_upload == before_upload + 1
    assert after_report == before_report + 1


def test_record_transcription_and_privacy_metrics_increment():
    before_transcription = metrics.TRANSCRIPTION_RUNS_TOTAL.labels(
        language="he",
        status="success",
        model="gpt_4o_mini_transcribe",
    )._value.get()
    before_privacy = metrics.PRIVACY_JOBS_TOTAL.labels(
        status="review_required",
        mode="degraded",
    )._value.get()

    metrics.record_transcription_result(
        language="he",
        success=True,
        duration_seconds=2.5,
        model="gpt-4o-mini-transcribe",
    )
    metrics.record_privacy_status_result(
        status="review_required",
        duration_seconds=6.5,
        mode="degraded",
    )

    after_transcription = metrics.TRANSCRIPTION_RUNS_TOTAL.labels(
        language="he",
        status="success",
        model="gpt_4o_mini_transcribe",
    )._value.get()
    after_privacy = metrics.PRIVACY_JOBS_TOTAL.labels(
        status="review_required",
        mode="degraded",
    )._value.get()
    assert after_transcription == before_transcription + 1
    assert after_privacy == before_privacy + 1


def test_metrics_endpoint_returns_prometheus_payload():
    client = TestClient(app)

    response = client.get("/metrics")

    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    assert "cognivio_analysis_runs_total" in response.text
    assert "cognivio_worker_jobs_total" in response.text
    assert "cognivio_uploads_total" in response.text
    assert "cognivio_transcription_runs_total" in response.text
    assert "cognivio_reports_generated_total" in response.text


def test_set_job_backlog_and_dependency_health_expose_gauges():
    metrics.set_job_backlog(job_type="video", queued=4, processing=2, stuck=1)
    metrics.set_dependency_health(dependency="mongodb", healthy=True)
    metrics.set_dependency_health(dependency="openai", healthy=False)

    assert metrics.JOBS_QUEUED.labels(job_type="video")._value.get() == 4
    assert metrics.JOBS_PROCESSING.labels(job_type="video")._value.get() == 2
    assert metrics.JOBS_STUCK.labels(job_type="video")._value.get() == 1
    assert metrics.DEPENDENCY_HEALTH.labels(dependency="mongodb")._value.get() == 1
    assert metrics.DEPENDENCY_HEALTH.labels(dependency="openai")._value.get() == 0


def test_snapshot_summary_exposes_counter_queue_and_dependency_sections():
    metrics.record_upload_result(
        source="admin",
        language="en",
        success=True,
        duration_seconds=0.5,
    )
    metrics.set_job_backlog(job_type="privacy", queued=3, processing=1, stuck=0)
    metrics.set_dependency_health(dependency="storage", healthy=True)

    summary = metrics.snapshot_summary()

    assert "counters" in summary
    assert "queues" in summary
    assert "dependencies" in summary
    assert summary["counters"]["uploads_total"] >= 1
    assert summary["queues"]["queued"]["privacy"] == 3
    assert summary["dependencies"]["storage"] == 1
