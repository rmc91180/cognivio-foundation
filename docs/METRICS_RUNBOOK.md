# Metrics Runbook

This runbook explains how to operate Cognivio's metrics pipeline after the
Sprint M1-M5 implementation.

## What Exists Today

- Backend emits Prometheus-compatible metrics at `/metrics`
- Admin ops summary endpoint exposes:
  - rolling in-memory observability
  - persistent-metrics summary from the Prometheus registry
- Recording rules and alert rules are version-controlled in:
  - [monitoring/prometheus/cognivio-recording-rules.yml](C:/Projects/Cognivio/monitoring/prometheus/cognivio-recording-rules.yml)
  - [monitoring/prometheus/cognivio-alerts.yml](C:/Projects/Cognivio/monitoring/prometheus/cognivio-alerts.yml)
- Grafana dashboard JSON lives in:
  - [monitoring/grafana](C:/Projects/Cognivio/monitoring/grafana)

## Primary Checks

### Backend metrics endpoint

Check:
- `GET /metrics`

Healthy:
- response `200`
- Prometheus text body includes `cognivio_analysis_runs_total`

Unhealthy:
- endpoint unavailable
- endpoint returns empty or truncated payload

### Master Admin command center

Check:
- `GET /api/master-admin/overview`

Healthy:
- response `200`
- cards, alerts, dependency summary, and queue summary all return

Unhealthy:
- endpoint unavailable
- summary sections missing
- counts obviously contradict live platform state

### Master Admin workspaces

Check:
- `GET /api/master-admin/workspaces`
- `GET /api/master-admin/workspaces/{owner_user_id}`

Healthy:
- response `200`
- workspace rows include health state, activity state, and pilot state
- detail view includes teacher roster, linkage state, and recent failures

Unhealthy:
- workspaces missing despite active admin-owned teachers
- detail view cannot load known workspaces
- linkage and privacy counts are obviously stale

### Internal admin summary

Check:
- `GET /api/admin/ops/observability`

Healthy:
- response `200`
- response includes both:
  - `observability`
  - `persistent_metrics`

Unhealthy:
- one of those sections is missing
- queue or dependency sections are obviously stale

## Common Incidents

### Metrics endpoint down

Symptoms:
- Grafana panels go blank
- scrape target becomes unhealthy

Check:
1. backend health endpoint
2. `/metrics`
3. backend logs around startup and metrics refresh

Likely causes:
- backend deployment issue
- dependency refresh exception
- auth or network restriction in front of `/metrics`

Immediate action:
- confirm backend is serving requests at all
- confirm `/metrics` still emits registry payload even if runtime refresh degraded

### Queue backlog rising

Symptoms:
- `cognivio_jobs_queued` climbs
- `cognivio_jobs_stuck` non-zero

Check:
1. `/api/admin/ops/observability`
2. `/api/admin/ops/launch-health`
3. job-specific logs

Immediate action:
- identify whether backlog is `video`, `privacy`, or `maintenance`
- inspect latest failures
- confirm worker loops are still running

### Workspace health drift

Symptoms:
- multiple workspaces show `attention` or `blocked`
- privacy-gap counts are climbing
- unlinked-teacher-login counts are appearing

Check:
1. `/api/master-admin/workspaces`
2. one affected workspace detail
3. linked teacher users and recent upload/processing records

Immediate action:
- confirm whether the issue is onboarding, privacy setup, or pipeline failure
- use the workspace detail page to identify which teachers are affected
- route the issue to product support or platform remediation based on cause

### Dependency health unhealthy

Symptoms:
- `cognivio_dependency_health{dependency="..."}` equals `0`

Check by dependency:
- `mongodb`: database connection and ping
- `openai`: API key configured and model path available
- `storage`: upload directory or object storage writable
- `railway_runtime`: app runtime availability

Immediate action:
- confirm whether the issue is config, credentials, or runtime
- downgrade traffic or pause rollout if multiple dependencies are unhealthy

### Estimated cost spike

Symptoms:
- `cognivio:daily_estimated_cost_usd` rises sharply
- per-model cost spike alert fires

Check:
1. analysis volume over the same period
2. model mix
3. frame counts and multimodal usage

Immediate action:
- confirm whether traffic increased normally
- confirm no model toggle changed unexpectedly
- confirm no retry loop is amplifying analysis volume

## Alert Response Guidance

### Warning alerts

Use for:
- elevated failure rate
- latency regressions
- growing backlog
- moderate cost increase

Response:
- acknowledge
- inspect dashboard and admin ops summary
- identify whether the issue is isolated or system-wide
- decide whether to intervene immediately or monitor

### Critical alerts

Use for:
- stuck jobs
- dependency unhealthy
- persistent outage behavior

Response:
- acknowledge immediately
- inspect active deploy and backend health
- inspect queue state and recent failure reasons
- stabilize first, then investigate root cause

## Recovery Checklist

1. Confirm backend and frontend health endpoints.
2. Confirm `/metrics` returns a payload.
3. Confirm `/api/admin/ops/observability` includes `persistent_metrics`.
4. Check dependency health gauges.
5. Check queue backlog and stuck jobs.
6. Check recent analysis and worker failures.
7. If needed, rollback the latest deploy.

## Ownership

- Metrics export correctness: backend/platform
- Dashboard and alert tuning: operations/platform
- Cost thresholds: product/platform
