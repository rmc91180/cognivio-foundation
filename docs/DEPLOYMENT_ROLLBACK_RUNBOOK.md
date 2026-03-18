# Deployment and Rollback Runbook

Date: 2026-02-25

## Pre-Deploy Gate

1. `python -m pytest backend/tests`
2. `python -m py_compile backend/server.py`
3. `npm run build --prefix frontend`
4. Confirm admin readiness endpoint:
  - `GET /api/admin/ops/readiness`
  - `go_no_go` must be `go` for launch window.
5. Confirm privacy readiness:
  - `teachers_missing_privacy_profiles == 0`
  - `privacy_review_required == 0` before broad launch window
  - `privacy_failed == 0` or explicitly triaged

## Deploy Steps

1. Deploy backend from `main` commit SHA.
2. Deploy frontend build generated from same `main` SHA.
3. Run smoke checks:
  - `GET /api/health`
  - login flow
  - video upload flow
  - teacher privacy profile enrollment flow
  - privacy review queue load
  - dashboard load

## Post-Deploy Verification

1. Check `GET /api/admin/ops/launch-health` every 5 minutes for 30 minutes.
2. Ensure:
  - `incident_level != red`
  - queue depth trends down after uploads
  - failed jobs in last 24h stays within launch threshold
  - `privacy_queue_depth` trends down after uploads
  - `privacy_reviews_pending` stays within staffed review capacity
  - redacted playback loads and raw playback is not exposed in standard UI

## Rollback Trigger

Rollback immediately if:

1. Authentication failure across users.
2. Video uploads cannot queue or process.
3. Incident level remains `red` for >10 minutes.
4. Raw assets become accessible from standard user endpoints.
5. Non-teacher faces are visible in final playback or thumbnails.

## Rollback Steps

1. Redeploy previous known-good backend image/commit.
2. Redeploy previous frontend artifact bound to that backend contract.
3. Verify health and login.
4. Re-run a single upload and dashboard smoke.
5. Re-check privacy review queue and raw-access endpoint controls.
6. Announce rollback completion and open incident follow-up.

## Privacy Incident Response

1. Disable customer-facing access to affected recordings immediately.
2. Identify impacted `video_id` values from `GET /api/privacy/audit` and admin ops metrics.
3. Revoke any raw asset links issued from `GET /api/videos/{video_id}/raw-access`.
4. Re-run privacy processing or force `blur_all_and_continue` through the privacy review queue.
5. Preserve audit trail and incident notes for follow-up.
