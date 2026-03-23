# Metrics Storage Setup

This document defines the recommended setup for Cognivio's persistent metrics
backend in staging and production.

## Recommended Target

- Metrics format: Prometheus-compatible scrape endpoint
- Backend export path: `/metrics`
- Storage and dashboards: Grafana Cloud Prometheus

This keeps the backend implementation simple while giving the team durable
storage, dashboards, and alerting without standing up a self-hosted metrics
stack first.

## Environment Assumptions

- The backend already exposes `/metrics`.
- Metrics are low-cardinality and safe for Prometheus-style collection.
- Railway is the runtime environment for staging and production.

## Deployment Shape

### Option A: Grafana Cloud Agent / Collector

Recommended first production path:

1. Provision a Grafana Cloud stack with Prometheus support.
2. Create a metrics ingestion token in Grafana Cloud.
3. Run a lightweight collector or scrape bridge that polls Cognivio's
   `/metrics` endpoint.
4. Remote-write the collected metrics into Grafana Cloud.

Use this when:
- the team wants durable metrics quickly
- alerting and dashboards should live outside the app process
- self-hosting Prometheus is unnecessary overhead

### Option B: Self-hosted Prometheus + Grafana

Use this when:
- the team wants full control
- there is already infrastructure for operating Prometheus
- network restrictions make managed remote write less appealing

## Railway Notes

- Railway does not act as a full Prometheus server by itself.
- The backend should expose `/metrics`, but access should be restricted to
  trusted internal networks, a collector, or a protected environment.
- Do not expose the metrics endpoint publicly without a deliberate access
  decision.

## Initial Scrape Targets

Start with:

- production backend `/metrics`
- staging backend `/metrics`

Do not scrape:

- frontend
- MongoDB directly through the Cognivio app stack
- legacy archived services

## Initial Dashboard Coverage

Create at least these panels:

- upload volume per hour
- privacy duration p50/p95
- analysis duration p50/p95
- transcription success/failure rate
- report/export success/failure rate
- queue backlog by job type
- dependency health by dependency
- estimated token and cost totals by model

## Initial Alert Coverage

Start with:

- analysis failure-rate spike
- privacy failure-rate spike
- transcription failure-rate spike
- queue backlog exceeds threshold
- dependency health becomes unhealthy
- estimated daily cost exceeds threshold

## Secrets and Config

Document and store outside the repo:

- Grafana Cloud endpoint
- Grafana Cloud metrics token
- collector auth or network controls
- staging vs production scrape targets

## Rollout Plan

1. Validate `/metrics` locally.
2. Scrape staging backend and confirm expected metric names.
3. Build staging dashboard.
4. Add production scrape target.
5. Turn on production alerts one class of alert at a time.

## Done Criteria

The metrics storage setup is considered complete when:

- staging metrics are stored durably outside process memory
- production metrics are stored durably outside process memory
- dashboard panels show live upload/privacy/analysis data
- at least one failure alert and one backlog alert are active
