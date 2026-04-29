from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest


REGISTRY = CollectorRegistry()


def _normalize(value: Optional[str], *, default: str = "unknown") -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return normalized or default


def normalize_language(language: Optional[str]) -> str:
    normalized = _normalize(language)
    if normalized.startswith("he"):
        return "he"
    if normalized.startswith("en"):
        return "en"
    return "unknown"


def normalize_analysis_mode(mode: Optional[str]) -> str:
    normalized = _normalize(mode)
    return normalized if normalized in {"fallback", "openai", "openai_multimodal"} else "unknown"


def normalize_modalities(modalities: Optional[list[str]]) -> str:
    values = sorted({_normalize(item) for item in (modalities or []) if _normalize(item)})
    if values == ["audio", "vision"]:
        return "vision_audio"
    if values == ["vision"]:
        return "vision"
    if values == ["audio"]:
        return "audio"
    return "unknown"


def normalize_worker_type(worker_type: Optional[str]) -> str:
    normalized = _normalize(worker_type)
    return normalized if normalized in {"video", "privacy", "maintenance", "transcode"} else "unknown"


def normalize_status(success: Optional[bool] = None, *, fallback: str = "unknown") -> str:
    if success is True:
        return "success"
    if success is False:
        return "failure"
    return fallback


def normalize_status_value(value: Optional[str]) -> str:
    normalized = _normalize(value)
    return (
        normalized
        if normalized in {"success", "failure", "queued", "processing", "review_required", "unconfigured"}
        else "unknown"
    )


def normalize_source(source: Optional[str]) -> str:
    normalized = _normalize(source)
    return normalized if normalized in {"admin", "teacher", "system", "unknown"} else "unknown"


def normalize_format(value: Optional[str]) -> str:
    normalized = _normalize(value)
    return normalized if normalized in {"csv", "pdf", "unknown"} else "unknown"


def normalize_model(model: Optional[str]) -> str:
    return _normalize(model)


def normalize_job_type(job_type: Optional[str]) -> str:
    normalized = _normalize(job_type)
    return normalized if normalized in {"video", "privacy", "maintenance", "transcode"} else "unknown"


def normalize_dependency(dependency: Optional[str]) -> str:
    normalized = _normalize(dependency)
    return normalized if normalized in {"mongodb", "openai", "storage", "railway_runtime"} else "unknown"


UPLOADS_TOTAL = Counter(
    "cognivio_uploads_total",
    "Total upload attempts recorded by the backend.",
    labelnames=("source", "language", "status"),
    registry=REGISTRY,
)

UPLOAD_DURATION_SECONDS = Histogram(
    "cognivio_upload_duration_seconds",
    "Upload duration in seconds.",
    labelnames=("source", "language", "status"),
    registry=REGISTRY,
    buckets=(0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300),
)

PRIVACY_JOBS_TOTAL = Counter(
    "cognivio_privacy_jobs_total",
    "Total privacy jobs recorded by the backend.",
    labelnames=("status", "mode"),
    registry=REGISTRY,
)

PRIVACY_DURATION_SECONDS = Histogram(
    "cognivio_privacy_duration_seconds",
    "Privacy processing duration in seconds.",
    labelnames=("status", "mode"),
    registry=REGISTRY,
    buckets=(1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200),
)

PRIVACY_JOBS_INFLIGHT = Gauge(
    "cognivio_privacy_jobs_inflight",
    "Number of privacy jobs currently in progress.",
    labelnames=("mode",),
    registry=REGISTRY,
)

ANALYSIS_RUNS_TOTAL = Counter(
    "cognivio_analysis_runs_total",
    "Total analysis runs recorded by the backend.",
    labelnames=("analysis_mode", "language", "modalities", "status"),
    registry=REGISTRY,
)

ANALYSIS_DURATION_SECONDS = Histogram(
    "cognivio_analysis_duration_seconds",
    "Analysis duration in seconds.",
    labelnames=("analysis_mode", "language", "modalities", "status"),
    registry=REGISTRY,
    buckets=(1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200),
)

ANALYSIS_RUNS_INFLIGHT = Gauge(
    "cognivio_analysis_runs_inflight",
    "Number of analysis runs currently in progress.",
    labelnames=("analysis_mode", "language", "modalities"),
    registry=REGISTRY,
)

ANALYSIS_INPUT_TOKENS_TOTAL = Counter(
    "cognivio_analysis_input_tokens_total",
    "Estimated total analysis input tokens.",
    labelnames=("model", "analysis_mode"),
    registry=REGISTRY,
)

ANALYSIS_OUTPUT_TOKENS_TOTAL = Counter(
    "cognivio_analysis_output_tokens_total",
    "Estimated total analysis output tokens.",
    labelnames=("model", "analysis_mode"),
    registry=REGISTRY,
)

ANALYSIS_ESTIMATED_COST_USD_TOTAL = Counter(
    "cognivio_analysis_estimated_cost_usd_total",
    "Estimated total analysis cost in USD.",
    labelnames=("model", "analysis_mode"),
    registry=REGISTRY,
)

WORKER_JOBS_TOTAL = Counter(
    "cognivio_worker_jobs_total",
    "Total worker job completions recorded by worker type.",
    labelnames=("worker_type", "status"),
    registry=REGISTRY,
)

WORKER_JOBS_INFLIGHT = Gauge(
    "cognivio_worker_jobs_inflight",
    "Number of worker jobs currently in progress.",
    labelnames=("worker_type",),
    registry=REGISTRY,
)

TRANSCRIPTION_RUNS_TOTAL = Counter(
    "cognivio_transcription_runs_total",
    "Total transcription runs recorded by the backend.",
    labelnames=("language", "status", "model"),
    registry=REGISTRY,
)

TRANSCRIPTION_DURATION_SECONDS = Histogram(
    "cognivio_transcription_duration_seconds",
    "Transcription duration in seconds.",
    labelnames=("language", "status", "model"),
    registry=REGISTRY,
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600),
)

REPORTS_GENERATED_TOTAL = Counter(
    "cognivio_reports_generated_total",
    "Total report export attempts recorded by the backend.",
    labelnames=("format", "language", "status"),
    registry=REGISTRY,
)

REPORT_DURATION_SECONDS = Histogram(
    "cognivio_report_duration_seconds",
    "Report generation duration in seconds.",
    labelnames=("format", "language", "status"),
    registry=REGISTRY,
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60),
)

JOBS_QUEUED = Gauge(
    "cognivio_jobs_queued",
    "Queued jobs grouped by job type.",
    labelnames=("job_type",),
    registry=REGISTRY,
)

JOBS_PROCESSING = Gauge(
    "cognivio_jobs_processing",
    "Jobs currently processing grouped by job type.",
    labelnames=("job_type",),
    registry=REGISTRY,
)

JOBS_STUCK = Gauge(
    "cognivio_jobs_stuck",
    "Jobs considered stuck grouped by job type.",
    labelnames=("job_type",),
    registry=REGISTRY,
)

DEPENDENCY_HEALTH = Gauge(
    "cognivio_dependency_health",
    "Dependency health where 1 is healthy and 0 is unhealthy.",
    labelnames=("dependency",),
    registry=REGISTRY,
)


def render_latest() -> bytes:
    return generate_latest(REGISTRY)


def content_type() -> str:
    return CONTENT_TYPE_LATEST


def _counter_total(metric: Any) -> float:
    total = 0.0
    for family in metric.collect():
        for sample in family.samples:
            if sample.name.endswith("_total"):
                total += float(sample.value)
    return round(total, 6)


def _labeled_gauge_values(metric: Any, label_name: str) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for family in metric.collect():
        for sample in family.samples:
            label_value = sample.labels.get(label_name)
            if label_value is not None:
                values[label_value] = float(sample.value)
    return values


def snapshot_summary() -> Dict[str, Any]:
    return {
        "counters": {
            "uploads_total": _counter_total(UPLOADS_TOTAL),
            "privacy_jobs_total": _counter_total(PRIVACY_JOBS_TOTAL),
            "analysis_runs_total": _counter_total(ANALYSIS_RUNS_TOTAL),
            "transcription_runs_total": _counter_total(TRANSCRIPTION_RUNS_TOTAL),
            "reports_generated_total": _counter_total(REPORTS_GENERATED_TOTAL),
            "analysis_input_tokens_total": _counter_total(ANALYSIS_INPUT_TOKENS_TOTAL),
            "analysis_output_tokens_total": _counter_total(ANALYSIS_OUTPUT_TOKENS_TOTAL),
            "analysis_estimated_cost_usd_total": _counter_total(ANALYSIS_ESTIMATED_COST_USD_TOTAL),
            "worker_jobs_total": _counter_total(WORKER_JOBS_TOTAL),
        },
        "queues": {
            "queued": _labeled_gauge_values(JOBS_QUEUED, "job_type"),
            "processing": _labeled_gauge_values(JOBS_PROCESSING, "job_type"),
            "stuck": _labeled_gauge_values(JOBS_STUCK, "job_type"),
        },
        "dependencies": _labeled_gauge_values(DEPENDENCY_HEALTH, "dependency"),
    }


@contextmanager
def track_analysis_run(
    *, analysis_mode: Optional[str], language: Optional[str], modalities: Optional[list[str]]
) -> Iterator[dict[str, str]]:
    labels = {
        "analysis_mode": normalize_analysis_mode(analysis_mode),
        "language": normalize_language(language),
        "modalities": normalize_modalities(modalities),
    }
    ANALYSIS_RUNS_INFLIGHT.labels(**labels).inc()
    try:
        yield labels
    finally:
        ANALYSIS_RUNS_INFLIGHT.labels(**labels).dec()


@contextmanager
def track_worker_job(*, worker_type: Optional[str]) -> Iterator[dict[str, str]]:
    labels = {
        "worker_type": normalize_worker_type(worker_type),
    }
    WORKER_JOBS_INFLIGHT.labels(**labels).inc()
    try:
        yield labels
    finally:
        WORKER_JOBS_INFLIGHT.labels(**labels).dec()


@contextmanager
def track_privacy_job(*, mode: Optional[str]) -> Iterator[dict[str, str]]:
    labels = {"mode": _normalize(mode)}
    PRIVACY_JOBS_INFLIGHT.labels(**labels).inc()
    try:
        yield labels
    finally:
        PRIVACY_JOBS_INFLIGHT.labels(**labels).dec()


def record_analysis_result(
    *,
    analysis_mode: Optional[str],
    language: Optional[str],
    modalities: Optional[list[str]],
    success: bool,
    duration_seconds: float,
    model: Optional[str] = None,
    estimated_input_tokens: Optional[int] = None,
    estimated_output_tokens: Optional[int] = None,
    estimated_cost_usd: Optional[float] = None,
) -> None:
    labels = {
        "analysis_mode": normalize_analysis_mode(analysis_mode),
        "language": normalize_language(language),
        "modalities": normalize_modalities(modalities),
        "status": normalize_status(success),
    }
    ANALYSIS_RUNS_TOTAL.labels(**labels).inc()
    ANALYSIS_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))
    model_labels = {
        "model": normalize_model(model),
        "analysis_mode": labels["analysis_mode"],
    }
    if estimated_input_tokens is not None:
        ANALYSIS_INPUT_TOKENS_TOTAL.labels(**model_labels).inc(max(estimated_input_tokens, 0))
    if estimated_output_tokens is not None:
        ANALYSIS_OUTPUT_TOKENS_TOTAL.labels(**model_labels).inc(max(estimated_output_tokens, 0))
    if estimated_cost_usd is not None:
        ANALYSIS_ESTIMATED_COST_USD_TOTAL.labels(**model_labels).inc(max(estimated_cost_usd, 0.0))


def record_worker_result(*, worker_type: Optional[str], success: bool) -> None:
    WORKER_JOBS_TOTAL.labels(
        worker_type=normalize_worker_type(worker_type),
        status=normalize_status(success),
    ).inc()


def record_privacy_result(*, success: bool, duration_seconds: float, mode: Optional[str]) -> None:
    labels = {"status": normalize_status(success), "mode": _normalize(mode)}
    PRIVACY_JOBS_TOTAL.labels(**labels).inc()
    PRIVACY_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))


def record_privacy_status_result(*, status: Optional[str], duration_seconds: float, mode: Optional[str]) -> None:
    labels = {
        "status": normalize_status_value(status),
        "mode": _normalize(mode),
    }
    PRIVACY_JOBS_TOTAL.labels(**labels).inc()
    PRIVACY_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))


def record_upload_result(
    *,
    source: Optional[str],
    language: Optional[str],
    success: bool,
    duration_seconds: float,
) -> None:
    labels = {
        "source": normalize_source(source),
        "language": normalize_language(language),
        "status": normalize_status(success),
    }
    UPLOADS_TOTAL.labels(**labels).inc()
    UPLOAD_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))


def record_transcription_result(
    *,
    language: Optional[str],
    success: bool,
    duration_seconds: float,
    model: Optional[str],
) -> None:
    labels = {
        "language": normalize_language(language),
        "status": normalize_status(success),
        "model": normalize_model(model),
    }
    TRANSCRIPTION_RUNS_TOTAL.labels(**labels).inc()
    TRANSCRIPTION_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))


def record_report_result(
    *,
    format: Optional[str],
    language: Optional[str],
    success: bool,
    duration_seconds: float,
) -> None:
    labels = {
        "format": normalize_format(format),
        "language": normalize_language(language),
        "status": normalize_status(success),
    }
    REPORTS_GENERATED_TOTAL.labels(**labels).inc()
    REPORT_DURATION_SECONDS.labels(**labels).observe(max(duration_seconds, 0.0))


def set_job_backlog(
    *,
    job_type: Optional[str],
    queued: Optional[int] = None,
    processing: Optional[int] = None,
    stuck: Optional[int] = None,
) -> None:
    normalized_job_type = normalize_job_type(job_type)
    if queued is not None:
        JOBS_QUEUED.labels(job_type=normalized_job_type).set(max(queued, 0))
    if processing is not None:
        JOBS_PROCESSING.labels(job_type=normalized_job_type).set(max(processing, 0))
    if stuck is not None:
        JOBS_STUCK.labels(job_type=normalized_job_type).set(max(stuck, 0))


def set_dependency_health(*, dependency: Optional[str], healthy: bool) -> None:
    DEPENDENCY_HEALTH.labels(dependency=normalize_dependency(dependency)).set(1 if healthy else 0)
