# Monitoring Secret Inventory Template

Use this template to track the secrets and endpoints required for Cognivio's
external monitoring setup.

Do not commit real secret values to this file.

## Staging

| Item | Value | Owner | Stored In | Notes |
| --- | --- | --- | --- | --- |
| Grafana stack URL | `<fill>` | `<fill>` | `<fill>` | |
| Prometheus remote write URL | `<fill>` | `<fill>` | `<fill>` | |
| Prometheus username / instance id | `<fill>` | `<fill>` | `<fill>` | |
| Grafana Cloud API key | `<fill>` | `<fill>` | `<fill>` | rotate regularly |
| Metrics scrape target | `<fill>` | `<fill>` | `<fill>` | staging backend `/metrics` |
| Collector admin URL | `<fill>` | `<fill>` | `<fill>` | optional |

## Production

| Item | Value | Owner | Stored In | Notes |
| --- | --- | --- | --- | --- |
| Grafana stack URL | `<fill>` | `<fill>` | `<fill>` | |
| Prometheus remote write URL | `<fill>` | `<fill>` | `<fill>` | |
| Prometheus username / instance id | `<fill>` | `<fill>` | `<fill>` | |
| Grafana Cloud API key | `<fill>` | `<fill>` | `<fill>` | rotate regularly |
| Metrics scrape target | `<fill>` | `<fill>` | `<fill>` | production backend `/metrics` |
| Collector admin URL | `<fill>` | `<fill>` | `<fill>` | optional |

## Handling Rules

- Keep staging and production credentials separate.
- Store real values in Railway variables or a dedicated secret manager.
- Rotate ingestion tokens if they appear in logs or screenshots.
- Never store real tokens in Git or in shared plaintext docs.
