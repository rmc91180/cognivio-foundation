# Privacy Go-Live Checklist

Date: 2026-03-18

This checklist is the exact launch sequence for the privacy-protected recording workflow.

## Release Lock

1. Backend SHA selected.
2. Frontend SHA selected.
3. Both SHAs match the versions used for final pilot validation.
4. No unreviewed privacy-related changes remain in the worktree.

## Environment Configuration

1. `PRIVACY_REQUIRE_PROFILE=true`
2. `PRIVACY_MANUAL_REVIEW_ENABLED=true`
3. `PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true`
4. `PRIVACY_WORKER_COUNT` set for expected launch traffic.
5. `PRIVACY_MAX_RETRIES` set and confirmed.
6. `PRIVACY_RAW_VIDEO_RETENTION_DAYS` approved by policy.
7. `PRIVACY_PROFILE_IMAGE_RETENTION_DAYS` approved by policy.
8. `PRIVACY_PURGE_INTERVAL_MINUTES` set.
9. `S3_BUCKET`, credentials, and public base URL verified.
10. Frontend backend URL points to the intended backend environment.

## Pre-Go-Live Technical Checks

1. `python -m pytest backend/tests/test_video_pipeline_helpers.py backend/tests/test_privacy_pipeline.py -q`
2. `python -m py_compile backend/server.py`
3. `npm run build:frontend:mvp`
4. `GET /api/health`
5. `GET /api/admin/ops/readiness`
6. `GET /api/admin/ops/launch-health`

## Pre-Go-Live Metrics Gates

All must pass:

1. `go_no_go == "go"`
2. `teachers_missing_privacy_profiles == 0`
3. `privacy_review_required == 0` or staffed acceptance explicitly approved
4. `privacy_failed == 0` or all failures triaged and accepted
5. `incident_level != "red"`
6. `failed_privacy_jobs_24h == 0` or explicitly accepted by engineering owner
7. `stale_privacy_jobs == 0`

## Manual Smoke Sequence

Run these in order:

1. Admin login
2. Teacher login
3. Teacher privacy profile enrollment
4. Upload one new recording
5. Confirm status transitions through privacy processing
6. Open final recording playback
7. Confirm:
   - non-teacher faces are blurred
   - teacher remains visible if confidently identified
   - thumbnail is blurred appropriately
8. Confirm raw asset is not present in standard video detail response
9. Confirm admin raw-access endpoint works and writes an audit entry
10. Force one privacy review case and resolve it from the review queue

## Launch Window Checklist

1. Announce launch start in team channel.
2. Deploy backend.
3. Deploy frontend.
4. Re-run smoke sequence on production.
5. Post “launch live” notice only after smoke passes.

## First 30 Minutes

Check every 5 minutes:

1. `GET /api/admin/ops/launch-health`
2. `GET /api/admin/ops/backlog-priorities`
3. `GET /api/privacy/review-queue`

Watch specifically:

1. `privacy_queue_depth`
2. `privacy_reviews_pending`
3. `failed_privacy_jobs_24h`
4. `stale_privacy_jobs`
5. any raw asset access events from `GET /api/privacy/audit`

## Immediate Stop Conditions

Pause launch and trigger rollback if any of these happen:

1. any known non-teacher face exposure in playback
2. any known non-teacher face exposure in thumbnail
3. standard user can access raw asset
4. privacy queue stalls for more than 10 minutes
5. privacy review actions fail or stop auditing correctly

## First-Day Monitoring

1. Review privacy queue every 30 minutes.
2. Review audit events every 2 hours.
3. Confirm raw purge worker is healthy.
4. Publish end-of-day summary:
   - total uploads
   - completed privacy jobs
   - failed privacy jobs
   - reviews required
   - reviews resolved
   - any incidents

## Go-Live Signoff

Required signoff before calling launch complete:

1. Engineering owner
2. Product owner
3. QA/privacy validation lead
4. Ops/on-call owner
