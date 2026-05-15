# Pilot Quality, Mobile, and Readiness v1

This PR certifies the pilot demo flow for phone use, mobile recording, AI quality visibility, and coach voice monitoring.

## Implemented

- Mobile navigation in `LayoutShell` with role-specific bottom tabs.
- Mobile-safe layouts for dashboard, teacher workspace, observation setup, teacher roster, video playback, and master-admin console spacing.
- Mobile camera/file capture in `/record` using `accept="video/*"` and `capture="environment"`.
- Standard upload progress and retry messaging. This is not resumable or chunked upload.
- Observation-session context on `/record` when `teacher_id` or `session_id` is present.
- Backend modular video router compatibility for `observation_session_id`.
- AI quality gate script at `backend/scripts/run_quality_gate.py`.
- CI `AI Quality Gate` job that runs only when analysis-quality paths change.
- Coach voice as a quality dimension with deterministic banned-phrase checks.
- Rule-based Tone Coach Specialist in the specialist orchestrator. It rewrites only visible text fields and preserves scores, IDs, timestamps, and element IDs.
- Master Admin AI Quality dashboard at `/master-admin/ai-quality`, backed by `/api/admin/ai-quality/latest` and `/api/admin/ai-quality/history`.
- Live product demo walkthrough doc at `docs/DEMO_SCRIPT_LIVE_PRODUCT.md`.

## Mobile Routes Audited

- `/dashboard`
- `/teachers`
- `/my-workspace`
- `/observation/new`
- `/coaching`
- `/reports`
- `/videos/:videoId`
- `/master-admin`

The main fixes target horizontal overflow, touch target size, mobile navigation, video aspect ratio, and card/table collapse behavior.

## Eval CI Behavior

The quality gate runs for changes under:

- `backend/app/analysis/**`
- `backend/server.py`
- `backend/evals/**`
- `backend/scripts/run_quality_gate.py`
- `docs/ANALYSIS_EVAL_RUBRIC.md`

`EVAL_GOLD_SET_MAX_CASES=5` keeps CI bounded. The current gate is deterministic and does not require a live `OPENAI_API_KEY`; future LLM judge expansion should keep secrets sanitized.

## AI Quality Dashboard

The dashboard reads `backend/evals/quality_history.json` if present. If the file is absent, the API returns a no-data response instead of a 500.

Manual eval-run triggering is deferred. Running evals from an HTTP request needs stronger rate limiting and worker isolation before it is safe for production.

## Deferred

- Full mobile native app
- True resumable/chunked upload
- Full sales enablement
- Broad scheduling/compliance workflows
- PR #3 cleanup dashboard or profile cleanup lifecycle

No PR #3 cleanup lifecycle code was merged or copied. PR #9 lifecycle behavior and PR #12 demo flow remain the base contract.
