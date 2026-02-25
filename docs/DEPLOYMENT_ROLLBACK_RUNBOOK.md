# Deployment and Rollback Runbook

Date: 2026-02-25

## Pre-Deploy Gate

1. `python -m pytest backend/tests`
2. `python -m py_compile backend/server.py`
3. `npm run build --prefix frontend`
4. Confirm admin readiness endpoint:
  - `GET /api/admin/ops/readiness`
  - `go_no_go` must be `go` for launch window.

## Deploy Steps

1. Deploy backend from `main` commit SHA.
2. Deploy frontend build generated from same `main` SHA.
3. Run smoke checks:
  - `GET /api/health`
  - login flow
  - video upload flow
  - dashboard load

## Post-Deploy Verification

1. Check `GET /api/admin/ops/launch-health` every 5 minutes for 30 minutes.
2. Ensure:
  - `incident_level != red`
  - queue depth trends down after uploads
  - failed jobs in last 24h stays within launch threshold

## Rollback Trigger

Rollback immediately if:

1. Authentication failure across users.
2. Video uploads cannot queue or process.
3. Incident level remains `red` for >10 minutes.

## Rollback Steps

1. Redeploy previous known-good backend image/commit.
2. Redeploy previous frontend artifact bound to that backend contract.
3. Verify health and login.
4. Re-run a single upload and dashboard smoke.
5. Announce rollback completion and open incident follow-up.
