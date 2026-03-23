# Monitoring Assets

This directory contains version-controlled monitoring artifacts for Cognivio.

## Contents

- `prometheus/cognivio-recording-rules.yml`
- `prometheus/cognivio-alerts.yml`
- `grafana/cognivio-operations-dashboard.json`
- `grafana/cognivio-launch-readiness-dashboard.json`

## Intended Use

- Prometheus-compatible environments can load the recording and alert rules.
- Grafana can import the dashboard JSON files directly and then bind them to the
  Prometheus data source used for Cognivio metrics.

## Notes

- These assets assume the backend exposes `/metrics`.
- They assume the metric names documented in:
  [METRICS_CONTRACT.md](C:/Projects/Cognivio/docs/METRICS_CONTRACT.md)
- Thresholds are conservative starting points and should be tuned with real
  production traffic.

Related operating docs:

- [METRICS_STORAGE_SETUP.md](C:/Projects/Cognivio/docs/METRICS_STORAGE_SETUP.md)
- [METRICS_RUNBOOK.md](C:/Projects/Cognivio/docs/METRICS_RUNBOOK.md)
- [METRICS_LABEL_DISCIPLINE.md](C:/Projects/Cognivio/docs/METRICS_LABEL_DISCIPLINE.md)
