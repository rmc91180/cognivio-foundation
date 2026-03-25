# Grafana Alloy Collector

This folder contains the staging and production collector configuration for
Cognivio's metrics rollout.

## Files

- `config.alloy`
- `staging.env.example`

## Purpose

Grafana Alloy scrapes Cognivio's backend `/metrics` endpoint and remote-writes
those metrics to Grafana Cloud Prometheus.

## Required Environment Variables

- `GRAFANA_CLOUD_PROMETHEUS_REMOTE_WRITE_URL`
- `GRAFANA_CLOUD_PROMETHEUS_USERNAME`
- `GRAFANA_CLOUD_API_KEY`
- `COGNIVIO_MONITORING_ENV`
- `COGNIVIO_METRICS_TARGET`
- `COGNIVIO_METRICS_SCHEME`
- `COGNIVIO_METRICS_PATH`
- `COGNIVIO_METRICS_SCRAPE_INTERVAL`
- `COGNIVIO_METRICS_SCRAPE_TIMEOUT`

## Recommended Staging Values

- `COGNIVIO_MONITORING_ENV=staging`
- `COGNIVIO_METRICS_SCHEME=https`
- `COGNIVIO_METRICS_PATH=/metrics`
- `COGNIVIO_METRICS_SCRAPE_INTERVAL=30s`
- `COGNIVIO_METRICS_SCRAPE_TIMEOUT=10s`

## Suggested Startup Command

If Alloy is installed in the runtime image:

```bash
alloy run monitoring/alloy/config.alloy --server.http.listen-addr=0.0.0.0:12345
```

## Rollout Notes

- Start with staging only.
- Confirm the staging `/metrics` endpoint via:
  - [smoke-metrics-target.ps1](C:/Projects/Cognivio/scripts/smoke-metrics-target.ps1)
- Do not point the collector at both staging and production until staging data
  is visible and stable in Grafana Cloud.
