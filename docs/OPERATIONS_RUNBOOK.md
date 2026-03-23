# Operations Runbook

This runbook covers the active Cognivio stack.

## Services

- Frontend: `cognivio-frontend`
- Backend: `cognivio-teacher-assessment`
- Database: MongoDB

## Primary Health Checks

- Backend health: `/api/health`
- Frontend health: service root
- Admin readiness: `/api/admin/ops/readiness`
- Launch health: `/api/admin/ops/launch-health`
- Observability snapshot: `/api/admin/ops/observability`
- Privacy runtime: `/api/admin/ops/privacy-runtime`

## Standard Deploy Check

1. Confirm Railway deploy finished for backend and frontend.
2. Hit backend `/api/health`.
3. Load frontend root.
4. If admin access is available, check:
   - `/api/admin/ops/readiness`
   - `/api/admin/ops/launch-health`
5. Confirm no unexpected queue growth or stale jobs.

## Smoke Sequence

### Core admin smoke

1. Log in as principal/admin.
2. Open dashboard, teachers, school setup, videos.
3. Confirm localized experience if testing Hebrew.

### Video processing smoke

1. Upload a short classroom clip.
2. Confirm:
   - upload accepted
   - privacy queued
   - privacy completed
   - analysis completed
3. Open resulting recording and assessment.

### Privacy smoke

1. Create or verify teacher privacy profile.
2. Upload clip requiring redaction.
3. Confirm privacy status transitions cleanly.
4. If review is required, resolve through the review queue.

### Recognition / exemplar smoke

1. Confirm awarded lesson recognition state.
2. Test opt-in.
3. Test exemplar submission.
4. Test share asset generation.

## Incident Triage

### High queue depth

Look at:
- `video_queue_depth`
- `privacy_queue_depth`

Action:
- confirm workers are online
- inspect recent deploys
- review latest worker failures
- temporarily increase worker counts if CPU budget allows

### Stale processing jobs

Look at:
- `stale_processing_jobs`
- `stale_privacy_jobs`

Action:
- inspect latest logs
- restart affected service if necessary
- confirm queue rehydration on restart

### Analysis failures

Look at:
- `observability.analysis.recent_failures`
- `analysis_mode` on affected videos
- OpenAI key / billing / allowlist settings

Action:
- distinguish model failure from fallback behavior
- confirm `OPENAI_API_KEY`
- confirm paid analysis gate settings
- confirm source video and redacted derivative still exist

### Audio / transcript issues

Check:
- `AUDIO_ANALYSIS_ENABLED`
- `AUDIO_TRANSCRIPTION_ENABLED`
- `AUDIO_ALLOW_STUDENT_VOICE_PROCESSING`
- `ffmpeg` availability

Action:
- confirm clip actually has an audio stream
- confirm redacted derivative preserves audio
- confirm transcription model access

## Rollback Guidance

Use [DEPLOYMENT_ROLLBACK_RUNBOOK.md](C:/Projects/Cognivio/docs/DEPLOYMENT_ROLLBACK_RUNBOOK.md) for service rollback specifics.

In general:
1. identify the failing deploy
2. roll back backend first if API behavior regressed
3. roll back frontend if UX/runtime config regressed
4. validate readiness + launch-health after rollback

## Observability Signals

### Analysis

- total runs
- failed runs
- average duration
- average estimated input tokens
- average estimated output tokens
- runs by `analysis_mode`
- recent failures with reasons

### Workers

- completed video jobs
- failed video jobs
- completed privacy jobs
- failed privacy jobs
- recent worker failure reasons

### Queues

- video queue depth
- privacy queue depth

## Expected Warnings

Some warnings are currently known and not release blockers:
- FastAPI `on_event` deprecation warnings in the bridged legacy app
- third-party dependency deprecation warnings during test runs

These should be reduced in later cutover work, but they are not immediate production blockers.

