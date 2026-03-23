# Grafana Dashboard Spec

This document defines the two dashboards that make up Sprint M4 of the Cognivio
metrics rollout.

## Dashboard 1: Cognivio Operations

Primary audience:
- engineering
- operations
- product during rollout windows

Primary goal:
- answer "what is broken, slow, or getting expensive?" without log diving

### Required panels

1. Upload volume per hour
- Query:
  `sum(increase(cognivio_uploads_total[1h]))`

2. Analysis runs per hour by mode
- Query:
  `sum by (analysis_mode) (increase(cognivio_analysis_runs_total{status="success"}[1h]))`

3. Analysis failure rate, 15m
- Query:
  `cognivio:analysis_failure_rate_15m`

4. Privacy failure rate, 15m
- Query:
  `cognivio:privacy_failure_rate_15m`

5. Transcription failure rate, 15m
- Query:
  `cognivio:transcription_failure_rate_15m`

6. Analysis p95 latency, 15m
- Query:
  `cognivio:analysis_p95_seconds_15m`

7. Privacy p95 latency, 15m
- Query:
  `cognivio:privacy_p95_seconds_15m`

8. Report generation p95 latency, 15m
- Query:
  `cognivio:report_p95_seconds_15m`

9. Jobs queued by type
- Query:
  `cognivio_jobs_queued`

10. Jobs stuck by type
- Query:
  `cognivio_jobs_stuck`

11. Dependency health
- Query:
  `cognivio_dependency_health`

12. Estimated cost by model, 24h
- Query:
  `sum by (model) (increase(cognivio_analysis_estimated_cost_usd_total[24h]))`

### Recommended dashboard variables

- `env`
- `analysis_mode`
- `job_type`
- `dependency`
- `model`

### Refresh

- Auto refresh: `30s` in staging, `1m` in production

## Dashboard 2: Cognivio Launch Readiness

Primary audience:
- founders
- pilot operators
- launch coordinators

Primary goal:
- answer "is Cognivio healthy enough for customers right now?"

### Required panels

1. Service health summary
- Query:
  `min(cognivio_dependency_health)`

2. Daily analyses completed
- Query:
  `sum(increase(cognivio_analysis_runs_total{status="success"}[24h]))`

3. Daily upload volume
- Query:
  `sum(increase(cognivio_uploads_total{status="success"}[24h]))`

4. Current queue backlog
- Query:
  `sum(cognivio_jobs_queued) + sum(cognivio_jobs_processing)`

5. Stuck jobs
- Query:
  `sum(cognivio_jobs_stuck)`

6. Analysis p95 latency
- Query:
  `cognivio:analysis_p95_seconds_15m`

7. Recent failure rate summary
- Query:
  `max(cognivio:analysis_failure_rate_15m, cognivio:privacy_failure_rate_15m, cognivio:transcription_failure_rate_15m)`

8. Daily estimated cost
- Query:
  `cognivio:daily_estimated_cost_usd`

### Refresh

- Auto refresh: `1m`

## Alerting Alignment

The dashboards should line up directly with the Prometheus rule files:

- [monitoring/prometheus/cognivio-recording-rules.yml](C:/Projects/Cognivio/monitoring/prometheus/cognivio-recording-rules.yml)
- [monitoring/prometheus/cognivio-alerts.yml](C:/Projects/Cognivio/monitoring/prometheus/cognivio-alerts.yml)

## Done Criteria

Sprint M4 dashboard work is complete when:

- both dashboards are defined in version-controlled artifacts
- each panel maps to a stable metric or recording rule
- alert expressions and dashboard expressions use the same semantics
