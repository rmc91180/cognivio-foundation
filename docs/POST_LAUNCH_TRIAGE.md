# Post-Launch Triage

Date: 2026-02-25

## Inputs

1. `GET /api/admin/ops/launch-health`
2. `GET /api/admin/ops/backlog-priorities`
3. User-reported defects and support tickets

## Priority Rules

1. `P0`:
  - Auth outage
  - Video queue stalled
  - Data corruption or permission bypass
2. `P1`:
  - Repeated failed processing jobs
  - Dashboard and roster unusable for pilot admins
3. `P2`:
  - UX clarity issues without data loss
  - Non-blocking export/report defects

## Response Cadence (Hotfix Window)

1. Every 30 minutes:
  - Review launch-health metrics.
2. Every 2 hours:
  - Re-prioritize backlog with latest telemetry.
3. Daily:
  - Publish triage summary and next-day priorities.
