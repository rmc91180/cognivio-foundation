# Production Phase Checklist

Date: 2026-03-18

This checklist is the consolidated production-readiness gate for the current Cognivio MVP stack, including privacy protection, recognition workflows, the All-Star Library, and share-asset generation.

## Release Lock

1. Backend SHA selected and frozen.
2. Frontend SHA selected and frozen.
3. Both SHAs match the versions used in final staging validation.
4. No unreviewed launch-critical changes remain in the worktree.
5. Rollback SHA is identified and documented.

## Environment Configuration

1. `REACT_APP_BACKEND_URL` points to the intended production backend.
2. `BACKEND_PUBLIC_BASE_URL` points to the intended production backend origin.
3. `FRONTEND_URL` points to the intended production frontend origin.
4. `PRIVACY_REQUIRE_PROFILE=true`
5. `PRIVACY_MANUAL_REVIEW_ENABLED=true`
6. `PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true`
7. `PRIVACY_WORKER_COUNT` sized for launch traffic.
8. `PRIVACY_MAX_RETRIES` confirmed.
9. `PRIVACY_RAW_VIDEO_RETENTION_DAYS` approved by policy.
10. `PRIVACY_PROFILE_IMAGE_RETENTION_DAYS` approved by policy.
11. `PRIVACY_PURGE_INTERVAL_MINUTES` set.
12. `RECOGNITION_FIVE_STAR_SCORE_MIN` approved by product and QA.
13. `S3_BUCKET`, credentials, endpoint, and public URL verified.

## Pre-Production Verification

1. `python -m pytest backend/tests -q`
2. `python -m py_compile backend/server.py backend/privacy_pipeline.py backend/recognition_engine.py backend/share_assets.py`
3. `npm run build:frontend:mvp`
4. `GET /api/health`
5. `GET /api/admin/ops/readiness`
6. `GET /api/admin/ops/launch-health`
7. Complete privacy staging validation.
8. Complete recognition/library staging validation.

## Privacy Gates

1. No known non-teacher face exposure in final playback.
2. No known non-teacher face exposure in thumbnails.
3. Standard user flows cannot access raw assets.
4. Privacy review queue is operational.
5. Privacy audit logging is working.
6. Raw retention and purge jobs are enabled.

## Recognition / Library Gates

1. Recognition can only be awarded on privacy-safe completed lessons.
2. Teacher opt-in must be required before exemplar submission.
3. Exemplar publication must require admin approval.
4. All-Star Library must only serve redacted assets.
5. Social card generation must not use classroom video.
6. Email signature generation must not use raw assets.
7. Recognition and exemplar audit events must be written successfully.

## Manual Smoke Sequence

Run in order on production:

1. Admin login
2. Teacher login
3. Teacher privacy profile enrollment
4. Upload one new recording
5. Confirm privacy processing completes
6. Confirm analysis completes
7. Confirm recognition state is visible on the lesson page
8. Save teacher recognition preferences
9. Admin approves one recognition candidate
10. Teacher submits the approved lesson to the All-Star Library
11. Admin approves the exemplar submission
12. Open the published lesson in the All-Star Library
13. Generate one social card
14. Generate one email signature badge
15. Confirm all generated outputs are privacy-safe and customer-visible URLs resolve

## Launch Window Checklist

1. Announce launch start.
2. Deploy backend.
3. Deploy frontend.
4. Re-run the manual smoke sequence.
5. Confirm no stop conditions are triggered.
6. Post launch-live notice only after smoke passes.

## First 60 Minutes

Check every 5-10 minutes:

1. `GET /api/admin/ops/launch-health`
2. `GET /api/admin/ops/backlog-priorities`
3. `GET /api/privacy/review-queue`
4. `GET /api/recognition/review-queue`
5. `GET /api/exemplar-library/review-queue`

Watch specifically:

1. `privacy_queue_depth`
2. `privacy_reviews_pending`
3. `failed_privacy_jobs_24h`
4. recognition review backlog growth
5. exemplar review backlog growth
6. share asset generation errors

## Immediate Stop Conditions

Pause launch and trigger rollback if any of these happen:

1. Any known privacy exposure in playback or thumbnail
2. Standard user can access raw classroom assets
3. Privacy queue stalls
4. Recognition review actions fail
5. Exemplar publication serves non-redacted media
6. Share asset generation exposes classroom media or fails broadly

## End-Of-Day Summary

1. Total uploads
2. Completed privacy jobs
3. Failed privacy jobs
4. Recognition approvals
5. Exemplar submissions
6. Published library items
7. Generated social cards
8. Generated email signature badges
9. Incidents and mitigations

## Final Signoff

Required signoff before calling production phase active:

1. Engineering owner
2. Product owner
3. QA / privacy validation lead
4. Operations / on-call owner
