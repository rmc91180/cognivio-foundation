# Repair privacy and feedback truth contracts (C9.5)

**Branch:** `hotfix/privacy-feedback-contract-repair` (based on `main` @ `06dd29b`, which contains C1–C9.4).
**Forensic audit:** `docs/codex-reports/c95-forensic-audit.md` (committed first, `0fa4a72`).

## Primary goal

A teacher-facing page must not claim privacy, feedback, or review readiness unless the
actual teacher-facing asset/content is safe and available. The production symptom was a
"Privacy ready" badge — and a teacher playback URL — shown for a video whose redacted
output still contained visibly unblurred faces, plus feedback/retry/navigation surfaces
that lied about state. This PR makes the truth gates fail-closed and machine-checked.

## Contracts made true

### A. Privacy truth
`evaluate_privacy_readiness` (`app/services/privacy_policy.py`) is now the single source of
truth for the "Privacy ready" badge. It returns `ready` only when **(1)** blur is required
AND the *exact* playback asset's visual-redaction validation passed AND browser-playback
validation passed, OR **(2)** blur is explicitly disabled by an *audited, active* privacy
policy override. A missing / skipped / inconclusive visual record reads `needs_attention`
(NOT ready); a failed one reads `retry_needed`. Default is always `face_blurring_required =
True` (fail-closed).

### B. Playback
`teacher_playback_policy_allows` gates whether a teacher may be served *any* playback URL.
A teacher URL is exposed only when the redacted asset passed visual + playback validation,
or an active audited override allows unblurred/processed playback. The concrete asset still
runs through `select_playback_asset`; the policy gate sits in front of it so an unvalidated
redacted asset is never served even though the selector can resolve its URL. Teachers never
fall back to the legacy/raw `playback_url`.

### C. Feedback
The canonical `get_teacher_visible_lesson_feedback` view drives every teacher surface
(lesson / coaching / dashboard) from one projection. "Feedback Done" is asserted only when
teacher-visible feedback is actually available; otherwise the UI shows a *specific*
machine-derived reason (`awaiting_admin_release`, `admin_hidden`, `revision_requested`,
`safety_withheld`, `evidence_insufficient`, `source_unavailable`, `not_yet_reviewed`,
`processing`) — never generic pending copy. The `POST /videos/{id}/feedback/reproject`
endpoint re-projects the canonical view without fabricating content, and the review-progress
feedback stage carries the reason code through to `describeFeedbackReason` on the frontend.

### D. Retry / corrective action
`build_video_action_states` (`app/services/video_actions.py`) projects an eligibility map for
Retry privacy, Retry analysis, Run/retry audio analysis, and Retry feedback projection. Each
control is either eligible (the live endpoint will accept it) or disabled **with a specific
reason code** — never a dead button, never a silent disable. The frontend
`VideoCorrectiveActions` renders the map faithfully; `buildActionControls` / the
`describeActionDisabledReason` copy map turn each reason code into honest text.

### E. Privacy override
An admin can disable face blurring at video / teacher / school scope only through an audited
override record (`build_privacy_override_record`) carrying a non-empty reason, actor,
timestamp, scope, and scope_id. Precedence is video > teacher > school > default; the default
remains destructive blur enabled. Overrides are stored in `privacy_policy_overrides` and
resolved by the pure `build_effective_privacy_policy`.

### F. Navigation
Teacher-facing labels/breadcrumbs read "Lessons" → `/my-lessons`, not the admin
"Videos & Assessments" recordings library. The admin breadcrumb keeps the recordings
library. Queued-upload copy is role-aware.

## What changed

### New pure service modules (DB-free, unit-tested)
- `backend/app/services/privacy_policy.py` — effective policy resolution, override
  selection/precedence, `evaluate_privacy_readiness`, `teacher_playback_policy_allows`,
  `build_privacy_override_record`, teacher-safe policy projection.
- `backend/app/services/video_actions.py` — corrective-action eligibility map with explicit
  disabled reason codes mirroring the live endpoint gates.

### Backend wiring
- `server.py` — effective-policy resolution + attachment, privacy-readiness gate on the
  badge/playback, audited override CRUD endpoints, `feedback/reproject` and `audio/run`
  endpoints, action-state projection on the video response.
- `app/routers/videos.py`, `app/services/video_service.py`,
  `app/services/video_review_progress.py`, `app/services/visual_redaction_validation.py`,
  `privacy_pipeline.py` — fail-closed redaction render + completion gate, feedback-stage
  reason codes.

### Frontend
- `VideoPlayerPage.js` — role-aware breadcrumb, corrective-action panel, strict teacher
  playback gating (teacher-safe playback object only, never legacy `playback_url`).
- `VideoCorrectiveActions.js` + `lib/videoActions.js` — eligibility-driven controls.
- `VideoReviewProgress.js` + `lib/reviewProgress.js` — honest feedback-stage reason copy.
- `features/videos/api.js` — `runAudioAnalysis`, `reprojectFeedback` endpoints.
- `VideoRecorderPage.js` + `locales/{en,he}/common.js` — "Lessons" vocabulary, role-aware
  queued copy.

### Audit + smoke tooling (PART 9)
`scripts/audit_video_processing_pipeline.py` gains six C9.5 issue codes and three scans:
- `_scan_privacy_policy_truth` → `privacy_blur_disabled_without_audited_override`,
  `privacy_completed_but_readiness_unverified`,
  `teacher_playback_served_without_policy_clearance` (contracts A/B/E).
- `_scan_privacy_overrides_audit` → `privacy_override_missing_audit_fields`,
  `privacy_override_expired_but_active` (contract E).
- `_scan_corrective_actions` → `blocked_video_without_eligible_action` (contract D).

`scripts/run_pilot_smoke_checks.py` gains `check_privacy_policy_truth`,
`check_privacy_override_audit_complete`, and `check_corrective_actions_available`, wired into
the deploy-time smoke run (loads active overrides from `privacy_policy_overrides`). Both
tools remain strictly read-only and safe against production.

## Tests

- **Backend (C9.5):** 71 tests across `test_privacy_override_admin.py` (11),
  `test_video_actions.py` (25), `test_review_progress_feedback_view.py` (7),
  `test_reproject_feedback_endpoint.py` (3), `test_audio_analysis_run.py` (5), and
  `test_c95_audit_smoke.py` (20). Full backend suite: **780 passed**.
- **Frontend (C9.5):** 28 new tests across `videoActions.test.js` (18),
  `reviewProgress.test.js` feedback block (4), `VideoCorrectiveActions.test.js` (4), and
  `VideoPlayerPage.test.js` PART 7 (2). Affected suites: **62 passed**.

## Deferred / follow-up

- **PART 5 admin override UI (frontend):** the override *model* + audited write/list/revoke
  endpoints and the pure resolver are complete and enforced server-side. The admin-facing UI
  to *set* an override from the video page is deferred to a focused frontend pass; the
  contract truth (blur only off via audited override) is already backend-enforced and audited
  by the new tooling.

## Not done (scope guardrails honored)
No raw/processed unredacted video exposed to teachers without an audited override; blur
defaults on; privacy never marked ready on missing/failed/inconclusive validation; no faked
feedback content; no generic pending copy where a specific reason exists; `server.py` not
split; no production DB edits; no weakened tests; forensic audit committed first.

## Production verification (post-merge)
Run after Railway deploy, against production:

```
python backend/scripts/audit_video_processing_pipeline.py --limit 500 --json c95-audit.json
python backend/scripts/run_pilot_smoke_checks.py --teacher-id <forensic-teacher-id> --json
```

Pilot-ready is claimed only after the PR merges, Railway deploys, and the production smoke run
confirms zero `fail` checks on the new C9.5 gates.
