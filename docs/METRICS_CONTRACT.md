# Metrics Contract

This document defines the production metrics contract for Cognivio's
Prometheus-compatible metrics pipeline.

## Principles

- Metric names use the `cognivio_` prefix.
- Labels must stay low-cardinality.
- Do not use labels such as `video_id`, `teacher_id`, `email`, `filename`,
  or free-form error text.
- Durations are measured in seconds.
- Currency totals are measured in `usd`.

## Export Strategy

- Metrics are exposed from the backend at `/metrics`.
- Metrics are emitted in Prometheus text format.
- The current in-memory observability module remains available for lightweight
  admin diagnostics and recent-failure summaries.
- The Master Admin backend also exposes derived operational summaries through
  internal JSON endpoints. These are not raw Prometheus metrics, but they are
  stable product telemetry contracts that the internal platform backend can
  build against.

## Master Admin Derived Telemetry Contract

These contracts are derived from database state, queues, and runtime health for
internal-only platform oversight:

### `/api/master-admin/overview`

- Global user counts by role and approval state
- Queue depth summary
- Dependency health summary
- Pending-approval preview
- Pipeline-blocker preview

### `/api/master-admin/auth-events`

- Durable auth event history
- Successful and failed login traces
- Approval and revocation traces
- Request metadata such as:
  - IP address
  - user agent
  - result
  - reason

### `/api/master-admin/audit-events`

- Sensitive Master Admin action log
- Actor, target, action, and reason
- Structured metadata for safe internal review

### `/api/master-admin/workspaces`

- Admin-owned workspace rollups
- Teacher counts
- Upload and assessment counts
- Failure counts
- Privacy-gap counts
- Linkage-integrity counts
- Last-activity timestamps
- Derived states:
  - health state
  - activity state
  - pilot state

### `/api/master-admin/workspaces/{owner_user_id}`

- One workspace's owner summary
- Teacher roster preview
- Unlinked teacher-login preview
- Recent pipeline failures
- Workspace memory activity

## Metric Catalog

### Upload Pipeline

`cognivio_uploads_total`
- Type: `counter`
- Unit: count
- Labels:
  - `source`
  - `language`
  - `status`

`cognivio_upload_duration_seconds`
- Type: `histogram`
- Unit: seconds
- Labels:
  - `source`
  - `language`
  - `status`

### Privacy Pipeline

`cognivio_privacy_jobs_total`
- Type: `counter`
- Unit: count
- Labels:
  - `status`
  - `mode`

`cognivio_privacy_duration_seconds`
- Type: `histogram`
- Unit: seconds
- Labels:
  - `status`
  - `mode`

`cognivio_privacy_jobs_inflight`
- Type: `gauge`
- Unit: count
- Labels:
  - `mode`

### Analysis Pipeline

`cognivio_analysis_runs_total`
- Type: `counter`
- Unit: count
- Labels:
  - `analysis_mode`
  - `language`
  - `modalities`
  - `status`

`cognivio_analysis_duration_seconds`
- Type: `histogram`
- Unit: seconds
- Labels:
  - `analysis_mode`
  - `language`
  - `modalities`
  - `status`

`cognivio_analysis_runs_inflight`
- Type: `gauge`
- Unit: count
- Labels:
  - `analysis_mode`
  - `language`
  - `modalities`

### Cost and Usage

`cognivio_analysis_input_tokens_total`
- Type: `counter`
- Unit: tokens
- Labels:
  - `model`
  - `analysis_mode`

`cognivio_analysis_output_tokens_total`
- Type: `counter`
- Unit: tokens
- Labels:
  - `model`
  - `analysis_mode`

`cognivio_analysis_estimated_cost_usd_total`
- Type: `counter`
- Unit: usd
- Labels:
  - `model`
  - `analysis_mode`

### Queue and Backlog

`cognivio_jobs_queued`
- Type: `gauge`
- Unit: count
- Labels:
  - `job_type`

`cognivio_jobs_processing`
- Type: `gauge`
- Unit: count
- Labels:
  - `job_type`

`cognivio_jobs_stuck`
- Type: `gauge`
- Unit: count
- Labels:
  - `job_type`

### Dependency Health

`cognivio_dependency_health`
- Type: `gauge`
- Unit: state where `1 = healthy` and `0 = unhealthy`
- Labels:
  - `dependency`

### Transcription Pipeline

`cognivio_transcription_runs_total`
- Type: `counter`
- Unit: count
- Labels:
  - `language`
  - `status`
  - `model`

`cognivio_transcription_duration_seconds`
- Type: `histogram`
- Unit: seconds
- Labels:
  - `language`
  - `status`
  - `model`

### Report / Export Pipeline

`cognivio_reports_generated_total`
- Type: `counter`
- Unit: count
- Labels:
  - `format`
  - `language`
  - `status`

`cognivio_report_duration_seconds`
- Type: `histogram`
- Unit: seconds
- Labels:
  - `format`
  - `language`
  - `status`

### Workers

`cognivio_worker_jobs_total`
- Type: `counter`
- Unit: count
- Labels:
  - `worker_type`
  - `status`

`cognivio_worker_jobs_inflight`
- Type: `gauge`
- Unit: count
- Labels:
  - `worker_type`

## Label Normalization

### `status`
Allowed values:
- `success`
- `failure`
- `queued`
- `processing`
- `review_required`
- `unconfigured`

### `analysis_mode`
Allowed values:
- `fallback`
- `openai`
- `openai_multimodal`
- `unknown`

### `modalities`
Allowed values:
- `vision`
- `audio`
- `vision_audio`
- `unknown`

### `language`
Allowed values:
- `en`
- `he`
- `unknown`

### `mode`
Allowed values:
- `standard`
- `degraded`
- `unknown`

### `job_type`
Allowed values:
- `video`
- `privacy`
- `maintenance`
- `unknown`

### `dependency`
Allowed values:
- `mongodb`
- `openai`
- `storage`
- `railway_runtime`
- `unknown`

## Ownership

- Backend metrics module: backend platform owner
- Dashboard and alert definitions: operations owner
- Cost metric review: product/platform owner

## Related Documents

- [METRICS_STORAGE_SETUP.md](C:/Projects/Cognivio/docs/METRICS_STORAGE_SETUP.md)
- [METRICS_RUNBOOK.md](C:/Projects/Cognivio/docs/METRICS_RUNBOOK.md)
- [METRICS_LABEL_DISCIPLINE.md](C:/Projects/Cognivio/docs/METRICS_LABEL_DISCIPLINE.md)
