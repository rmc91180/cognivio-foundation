# Grafana Cloud Setup

This guide covers the concrete setup work for Sprint G1 of Cognivio's
persistent metrics rollout.

## Scope

Sprint G1 is complete when the team has:

- provisioned a Grafana Cloud stack
- created staging credentials for metrics ingestion
- prepared a collector configuration that scrapes Cognivio's staging backend
- validated the staging metrics endpoint before collector rollout

This repository includes the version-controlled artifacts for that rollout.
Actual Grafana Cloud account provisioning still requires real operator access
to Grafana Cloud and therefore cannot be completed from source control alone.

## Version-Controlled Assets

- Collector config:
  - [config.alloy](C:/Projects/Cognivio/monitoring/alloy/config.alloy)
- Collector env template:
  - [staging.env.example](C:/Projects/Cognivio/monitoring/alloy/staging.env.example)
- Collector README:
  - [README.md](C:/Projects/Cognivio/monitoring/alloy/README.md)
- Secret inventory template:
  - [MONITORING_SECRET_INVENTORY_TEMPLATE.md](C:/Projects/Cognivio/docs/MONITORING_SECRET_INVENTORY_TEMPLATE.md)
- Metrics smoke script:
  - [smoke-metrics-target.ps1](C:/Projects/Cognivio/scripts/smoke-metrics-target.ps1)

## Step 1: Provision Grafana Cloud

Create or confirm a Grafana Cloud stack with Prometheus support enabled.

Capture at least:

- Grafana stack URL
- Prometheus remote write URL
- Prometheus username or instance id
- API key/token for metrics ingestion

Record those values in your private secret store and mirror them into:

- [MONITORING_SECRET_INVENTORY_TEMPLATE.md](C:/Projects/Cognivio/docs/MONITORING_SECRET_INVENTORY_TEMPLATE.md)

## Step 2: Create Staging Credentials

Create a staging-scoped metrics token in Grafana Cloud.

Recommended separation:

- one token for staging
- one token for production

Do not reuse production credentials in staging.

## Step 3: Fill the Collector Environment

Use:

- [staging.env.example](C:/Projects/Cognivio/monitoring/alloy/staging.env.example)

Populate the real values into Railway variables or another secret manager.

Required values:

- `GRAFANA_CLOUD_PROMETHEUS_REMOTE_WRITE_URL`
- `GRAFANA_CLOUD_PROMETHEUS_USERNAME`
- `GRAFANA_CLOUD_API_KEY`
- `COGNIVIO_METRICS_TARGET`
- `COGNIVIO_MONITORING_ENV`

## Step 4: Validate the Staging Metrics Target

Before deploying the collector, confirm the target backend emits the expected
metrics:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-metrics-target.ps1 `
  -MetricsUrl "https://<staging-backend-host>/metrics"
```

Expected result:

- `200` response
- required Cognivio metric names present

## Step 5: Deploy the Collector

Recommended path:

- run Grafana Alloy as a small dedicated staging service
- point it at:
  - [config.alloy](C:/Projects/Cognivio/monitoring/alloy/config.alloy)

The collector should:

- scrape Cognivio staging `/metrics`
- remote-write to Grafana Cloud
- optionally expose its own health endpoint for debugging

## Step 6: Confirm Ingestion

In Grafana Cloud Explore, validate that staging metrics appear:

- `cognivio_uploads_total`
- `cognivio_analysis_runs_total`
- `cognivio_jobs_queued`
- `cognivio_dependency_health`

## Step 7: Import Dashboards

Import:

- [cognivio-operations-dashboard.json](C:/Projects/Cognivio/monitoring/grafana/cognivio-operations-dashboard.json)
- [cognivio-launch-readiness-dashboard.json](C:/Projects/Cognivio/monitoring/grafana/cognivio-launch-readiness-dashboard.json)

## Step 8: Start With Minimal Alerts

Turn on only these first:

- dependency unhealthy
- stuck jobs

Then add:

- failure-rate alerts
- latency alerts
- cost alerts

## Done Criteria

Sprint G1 is operationally complete when:

- staging collector credentials exist
- the staging collector can scrape Cognivio `/metrics`
- Grafana Cloud shows staging metrics
- at least one dashboard renders staging data
