# C9.5 Forensic Audit — Privacy / Feedback / Audio / Retry / Navigation truth contracts

**Branch:** `hotfix/privacy-feedback-contract-repair` (based on `main` @ `06dd29b`, which contains all of C1–C9.4).
**Date:** 2026-05-30.
**Scope:** Establish *evidence-grounded* root causes BEFORE any code change, per the C9.5 mission. No code was modified to produce this report.

## 0. Evidence-collection method & live-capture limitations

This repository checkout has **no running production MongoDB, no running backend dev server with seeded problem data, and no browser/screenshot tooling** attached to this environment. Per the mission's explicit allowance ("If collections/fields do not exist, document that explicitly" / "If screenshot capture tooling is not available, paste DOM/text evidence and explain"), evidence below is captured from the **authoritative source of truth**:

- **DB field evidence** — captured from the exact code sites that *write* each field onto the `videos` / `assessments` documents (worker completion block, retry endpoints, review-resolution endpoint), and the response builders that *read* them. This is stronger than a single sampled document because it enumerates every field the pipeline can set, not just those present on one row.
- **API payload evidence** — captured from the response-builder functions (`_apply_video_response_defaults`, `get_video_status`, `_build_teacher_lesson_coaching_artifact_for`) that deterministically shape every payload, plus the existing test fixtures that assert those shapes.
- **DOM / frontend evidence** — captured from the component source that renders each badge / card / breadcrumb and the exact string literals (i18n copy files), with the data field each element binds to.

Where a *live* value is required to close a forensic question (e.g. the exact `visual_redaction_validation` dict on prod video `b84feea4`), it is called out under **Open forensic questions** (§6) and the C9.4 report already documented that this specific asset predates the validator and reads `visual_redaction_validation_missing`.

---

## 1. DB FIELD EVIDENCE (`videos` collection)

The mission's requested fields, mapped to the code that sets/reads them. "✓ exists" = the field is written somewhere in the pipeline; "✗ absent" = no such field name exists in the codebase.

| Requested field | Status | Where written / read |
|---|---|---|
| `id` | ✓ | doc id (uuid) |
| `filename` | ✓ | upload |
| `teacher_id` | ✓ | upload |
| `status` | ✓ | `server.py` worker `11559-11569`, retry `27157-27165` |
| `privacy_status` | ✓ | worker completion `~11543`; normalized in `_apply_video_response_defaults:3580` |
| `privacy_pipeline_state` | ✓ | `PrivacyPipelineState` enum `server.py:185-213` (e.g. `BLURRED_VERIFIED`, `DESTRUCTIVE_BLUR_FAILED`, `RETAINED_UNBLURRED_BY_INSTITUTION_POLICY`) |
| `redacted_asset_state` | ✓ | set to `"stored"` on success |
| `redacted_file_url` | ✓ | worker; **NOT stripped** from detail payload (`_sanitize_video_response:3592` strips `redacted_file_path` but not `_url`) |
| `redacted_playback_validation` | ✓ | C9.3; dict `{status, failure_code, ...}`; read by `_redacted_validation_status:3418` |
| `visual_redaction_validation` | ✓ | C9.4; dict `{status, failure_code, ...}`; read by `_visual_redaction_status:3434` |
| `visual_redaction_status` | ✗ absent | only nested under `visual_redaction_validation.status` |
| `visual_redaction_failure_code` | ✗ absent | only nested under `visual_redaction_validation.failure_code` |
| `destructive_blurring_enabled` | ✓ (settings) | settings/config `server.py:431-489`; `destructive_blurring_enabled_default` |
| `privacy_review_required` / `privacy_review_reason` | ✓ | review-resolution `13532-13560` |
| `privacy_manual_override` | ✓ (dict) | set at `13544`; **stripped** from response at `_sanitize_video_response:3609` |
| `effective_privacy_policy` | ✗ absent | **No such field/helper exists.** This is what C9.5 PART 1 must add. |
| `analysis_status` | ✓ | worker/retry |
| `analysis_mode` | ✓ | analysis metadata (`fallback_paid_analysis_not_allowed`, etc.) |
| `analysis_modalities_used` | ✗ absent | modalities inferred from `degradation_reasons`; not a stored field |
| `audio_analysis_enabled` | ✓ | `server.py:28854`; workspace pref flows in at `9446` |
| `audio_transcript_status` | ✓ | `server.py:28855` |
| `audio_analysis_status` | ✗ absent | **No standalone audio status field.** C9.5 PART 4 should distinguish disabled/skipped/queued/processing/completed/failed |
| `feedback_release_status` | ✓ | `_build_feedback_release_metadata:30961` → `"released"`/`"blocked"` only |
| `assessment_id` | ✓ | analysis persistence |
| `teacher_feedback_view` | ✓ (computed, not stored) | attached at runtime to the *artifact*, `server.py:22016`; **never persisted on the video doc** |
| `coaching_artifact` | ✓ (computed) | `teacher_safe_artifact` on lesson payload `22104-22125` |
| `latest_error` / `failure_reason` | ✗ absent | errors live in `privacy_error` / `transcode_error` / `error_message` |
| `updated_at` | ✓ | every write |

Other pipeline fields present: `processed_file_*`, `raw_file_*`, `transcode_status/error`, `raw_retention_expires_at`, `raw_cleanup_*`, `unblurred_deletion_status`, `privacy_completed_at`, `privacy_failed_at`, `redacted_thumbnail_*`.

**Related `assessments` fields:** `feedback_release_status`, `analysis_quality` (`{teacher_feedback_allowed, block_reason}` — C3 gate), `teacher_feedback_allowed`, `blocked_reason`.

**Privacy-override model:** **does not exist as a scoped collection.** Today there is only a per-video `privacy_manual_override` dict plus institution settings `destructive_blurring_enabled` / `allow_unblurred_retention` / `unblurred_retention_reason`. There is **no** `scope=video|teacher|school` override record with `reason`/`actor`/`timestamp`/`is_active`. C9.5 PART 5 must add it.

---

## 2. API PAYLOAD EVIDENCE

### `GET /api/videos/{video_id}` — `get_video_detail` (server.py:12793)
Returns `_sanitize_video_response(_apply_video_response_defaults(video))`. Injected keys (`_apply_video_response_defaults:3577-3589`):
- `playback_url` (legacy admin/mixed resolver `_resolve_video_playback_url:3336` — redacted→processed→raw if `privacy_status==completed`)
- `thumbnail_url`
- `review_progress` = `build_video_review_progress(video)` — **called WITHOUT `assessment`/`teacher_feedback`** (`_build_video_review_progress_for_response:3563`)
- `playback` = `_build_teacher_playback_state(video)` → `{available, asset_kind, url, status[, failure_code]}`
- `playback_diagnostics` = `_build_playback_diagnostics(video)`

**Critical:** the detail payload has **no** `teacher_feedback_view`, **no** `coaching_artifact`, **no** `actions`/retry-eligibility block. `visual_redaction_validation` & `redacted_playback_validation` dicts survive (raw doc fields).

`_build_teacher_playback_state` (3468-3522) **is already fail-closed** (C9.4): teacher URL only when `privacy_status==completed` AND `redacted_playback_validation.status=="passed"` AND `visual_redaction_validation.status=="passed"`. Status values: `privacy_incomplete`, `no_redacted_asset`, `validation_failed`, `validation_pending`, `redaction_unverified`, `redaction_pending`, `ready`.

### `GET /api/videos/{video_id}/status` — `get_video_status` (server.py:12885)
Explicit keys: `status, privacy_status, analysis_status, transcode_status, privacy_review_required, privacy_review_reason, error_message, privacy_error, review_progress, review_status, review_percent, playback, redacted_playback_validation`. **No** `visual_redaction_validation`, **no** `teacher_feedback_view`, **no** `actions`.

### Teacher coaching/lessons/dashboard
All go through `_build_teacher_lesson_coaching_artifact_for` (server.py:21937) which attaches `artifact["teacher_feedback_view"] = get_teacher_visible_lesson_feedback(artifact, feedback_release_status=…, language=…)` at **22016**. Call sites: latest-lesson `22086`, lessons `22187`, coaching `22360`, dashboard reuse `22775-22776`. So feedback **copy** is canonical across surfaces.

### Retry / audio action metadata
- Retry: only `POST /api/master-admin/videos/{id}/retry-privacy` (27139), `retry-analysis` (27104), `retry-transcode` (27184) — **master-admin only**, no `actions{enabled, reason_disabled}` metadata, and **retry-privacy does NOT clear `redacted_playback_validation` / `visual_redaction_validation` / `redacted_file_url`**.
- Audio: only read-only `GET /api/videos/{id}/audio-analysis` (13489). **No run/retry audio action.** No `actions.run_audio_analysis` metadata.

### `review_progress` object shape (`build_video_review_progress` return, video_review_progress.py:435-447)
`{status, percent, current_stage, teacher_message, admin_message, stages[{key,label,status[,detail]}], retry{eligible,action}, needs_admin_attention, failure_code, degraded, degradation_reasons}`. Stage keys: `upload, video_preparation, privacy, analysis, audio, feedback`.

---

## 3. DOM / FRONTEND EVIDENCE (component source + bound data field)

| UI element | File:line | Renders | Bound field |
|---|---|---|---|
| Breadcrumb root (single lesson) | `pages/VideoPlayerPage.js:736` | `t("nav.videos")` → **"Videos & Assessments"** → `/videos` | i18n `locales/en/common.js:75` |
| Page title | `VideoPlayerPage.js:739` | `videoRes?.filename` | video.filename |
| Analysis badge | `VideoPlayerPage.js:760-762` | "Analysis ready" | `videoStatus` (`statusRes?.status \|\| videoRes?.status`) |
| Privacy badge | `VideoPlayerPage.js:763-765` | **"Privacy ready"** | `privacyStatus` = `statusRes?.privacy_status \|\| videoRes?.privacy_status` — **raw string `=="completed"`, NOT policy-satisfied** |
| Review progress + stages | `components/VideoReviewProgress.js:73,101-108` | "Review progress", per-stage | backend `review_progress.stages` |
| "Audio analysis: Not run" | `VideoReviewProgress.js:107`, `VideoPlayerPage.js:1474-1478` | audio-not-run copy | `review_progress` audio stage `skipped` |
| Retry privacy button | `VideoPlayerPage.js:777-780` | only when `privacyStatus==="failed"` — **never for completed-but-unverified**; no role guard | `privacyStatus` |
| Run audio analysis button | — | **DOES NOT EXIST** anywhere (teacher or admin) | — |
| Coaching empty-state | `pages/TeacherCoachingPage.js:281` (+248,268,292) | **"Feedback suggestions will appear after reviewed lessons."** — hardcoded, NOT driven by `feedbackView.status` | `recommendations.length` |
| Workspace empty-state | `pages/TeacherWorkspacePage.js:308,336,363` | hardcoded generic copy | mixed |
| WebSocket URL | `VideoPlayerPage.js:237-240` | uses `buildBackendWebSocketUrl({backendUrl, path:'ws/videos/…'})` | helper `lib/reviewProgress.js:100-109` |

Helpers `feedbackViewMessage` / `isFeedbackAvailable` (`lib/teacherCoachingArtifact.js`) already exist and are imported by all four pages — but TeacherCoachingPage & TeacherWorkspacePage compute them yet still render **hardcoded** empty-state copy for the actionable-feedback card (the visible contradiction).

`video.currentSrc` check (`/uploads/redacted-videos/`): the `<video>` element src is set from `playback.url` (the fail-closed teacher object), so when validation truly passes the src is the redacted asset. The reported "visible faces in redacted playback" therefore originates **upstream** — the redacted asset itself contains unblurred faces yet `visual_redaction_validation.status=="passed"` (see §5 root-cause #2).

---

## 4. ROUTE / NAVIGATION EVIDENCE

- Single lesson route: `App.js:471` `path="/videos/:videoId"` → `VideoPlayerPage`. Also `/my-lessons` (`App.js:382`), `/lessons` (`455`).
- Sidebar/nav label: `components/LayoutShell.js:68,101` and `lib/roleRouter.js:232` → **"Lessons"** → `/my-lessons` (already canonical).
- Lessons list breadcrumb: `pages/TeacherLessonsPage.js:63` → `[{My Workspace}, {Lessons}]` (already canonical).
- **The ONLY teacher-facing "Videos & Assessments" render** is the breadcrumb root on `VideoPlayerPage.js:736` via `t("nav.videos")` (`locales/en/common.js:75`; also `2348` queued-message copy; Hebrew locale has the mirror key).
- Intended canonical label: **"Lessons"**. Fix is isolated: re-point the `VideoPlayerPage` breadcrumb to a "Lessons"→`/my-lessons` crumb (and confirm Hebrew copy agrees). Do not change the admin recordings-library label if that area intentionally stays "Videos & Assessments".

---

## 5. ROOT-CAUSE TABLE

| # | Symptom | DB state | API payload state | Frontend state | Source file(s) | Root cause | Proposed fix | Test to prove |
|---|---|---|---|---|---|---|---|---|
| 1 | "Privacy ready" shown while faces visibly unblurred | `privacy_status="completed"`, `visual_redaction_validation.status="passed"` (false pass) or missing in degraded | `playback.available` may be true; `privacy_status="completed"` | Privacy badge green | `VideoPlayerPage.js:763`; `video_review_progress.py:240`; worker `server.py:~11543` | Badge reads raw `privacy_status`, decoupled from policy satisfaction; worker sets completed on a `passed` that can be a false pass | PART 1: `build_effective_privacy_policy` + privacy-ready only when (blur required ∧ visual passed) ∨ audited override; badge reads policy-satisfied state | BE tests 8-11; FE test 5,6 |
| 2 | Redacted asset still shows faces yet validation "passed" | `visual_redaction_validation.status="passed"`, `warnings=["no_faces_detected_in_output"]` | `playback.available=true` | Video plays unblurred | `visual_redaction_validation.py:436-457`; `privacy_pipeline.py` detect/blur | Validator uses the **same Haar cascades** as the renderer → a face both miss ⇒ `faces_detected==0` ⇒ passes with a *non-blocking* warning; no full-frame fallback | PART 2: treat `faces_detected==0`+`mode==blur_all` as **inconclusive** (not passed); add full-frame/region blur fallback for blur_all & retry; never pass on the no-faces warning when blur required | BE tests 12, + visual-redaction fail-closed tests |
| 3 | "Feedback Done" / 100% but empty teacher cards | `feedback_release_status="released"` while assessment `analysis_quality.teacher_feedback_allowed=False` | `review_progress.status="completed", percent=100, stages.feedback="completed"` but artifact `teacher_feedback_view.feedback_available=False` | "Feedback being reviewed"/empty | `video_review_progress.py:158-163,308-323`; `_build_video_review_progress_for_response:3563` (no assessment passed) | Feedback stage = `released` flag only; ignores artifact gates & is computed without the assessment/feedback view | PART 6: feedback stage consumes a resolved `teacher_feedback_view`; Done only when status∈{ready,no_actions_required,unavailable_resolved}; pass assessment+view into progress | BE tests 21-27; FE tests 8-13 |
| 4 | Contradictory generic coaching copy | n/a | `teacher_feedback_view.status` specific | hardcoded "appear after reviewed lessons" | `TeacherCoachingPage.js:281`; `TeacherWorkspacePage.js:308` | Cards ignore the computed `feedbackView.status` | PART 6 FE: drive empty-state from `feedbackViewMessage(artifact)` | FE tests 10,11,13 |
| 5 | No "Retry privacy" for existing videos | retry only on master-admin route; no actions metadata | no `actions.retry_privacy` | only on `failed` | `server.py:27139`; `video_review_progress.py:407-417` | Retry eligibility only on `failed`; no metadata for completed-but-unverified; retry doesn't invalidate stale validation | PART 3: `actions.retry_privacy{enabled,reason_disabled}`; eligible on missing/failed/inconclusive visual validation; endpoint invalidates validations + playback | BE tests 14-16; FE tests 1,2 |
| 6 | No "Run/Retry audio analysis" control | `audio_analysis_enabled`, `audio_transcript_status` only | no `actions.run_audio_analysis` | read-only "not run" | `server.py:29279,28656`; `video_review_progress.py:286` | Audio only runs inline; no action metadata/endpoint | PART 4: `actions.run_audio_analysis{enabled,reason_disabled}` + endpoint that respects privacy + updates audio stage | BE tests 17-20; FE tests 3,4 |
| 7 | No audited per-scope blur override | only `privacy_manual_override` dict + settings | none surfaced | none | settings `server.py:431-489` | No scoped override model | PART 5: override collection (scope/scope_id/required/reason/actor/ts/active/version) + admin endpoints + diagnostics | BE tests 1-7; FE test 5 |
| 8 | Teacher breadcrumb says "Videos & Assessments" | n/a | n/a | `VideoPlayerPage.js:736` | `locales/en/common.js:75` `nav.videos` | Breadcrumb uses `nav.videos` copy | PART 7: point teacher lesson breadcrumb to "Lessons"/`/my-lessons` | FE test 14 |
| 9 | WebSocket `//ws` (already fixed C9.4) | n/a | n/a | `VideoPlayerPage.js:237` uses helper | `lib/reviewProgress.js:100-109` | Already fixed; verify only | PART 8: keep helper + tests | BE test 29; FE test 15 |

---

## 6. Open forensic questions (require a live prod/DB capture to fully close)

1. For prod video `b84feea4`: exact `visual_redaction_validation` dict (missing vs `passed`-with-warning vs `skipped_unavailable`). C9.4 report indicates it **predates** the validator ⇒ `visual_redaction_validation_missing` ⇒ playback object should already withhold the URL. If the screenshot showed an unblurred face *with a URL served*, that points to root-cause #2 (false `passed`) on a re-processed asset — to be confirmed post-deploy via the audit script.
2. Whether the served `<video>.currentSrc` on the failing screenshot was `/uploads/redacted-videos/…` (validated) or a legacy `playback_url` admin resolver path. The teacher object is fail-closed; the legacy `playback_url` (`_resolve_video_playback_url`) is NOT teacher-gated and is still present in the detail payload — **a latent leak surface** PART 1 should neutralize for teacher responses.
3. The live `feedback_release_status` vs `analysis_quality.teacher_feedback_allowed` for the failing assessment (confirms root-cause #3 in prod).

These are recorded for the production-smoke step; the code repairs are driven by the deterministic root causes above.

## 7. Files / components inspected
Backend: `server.py` (3336-3613, 11410-11569, 12793-12906, 13489-13560, 21937-22360, 27104-27199, 29279-29448, 30961-31081), `app/services/video_review_progress.py`, `app/services/video_assets.py`, `app/services/visual_redaction_validation.py`, `privacy_pipeline.py`, `app/services/teacher_lesson_coaching_artifact.py`, `app/config.py`, `scripts/audit_video_processing_pipeline.py`, `scripts/run_pilot_smoke_checks.py`.
Frontend: `pages/VideoPlayerPage.js`, `pages/TeacherWorkspacePage.js`, `pages/TeacherCoachingPage.js`, `pages/TeacherLessonsPage.js`, `components/LayoutShell.js`, `components/VideoReviewProgress.js`, `lib/roleRouter.js`, `lib/reviewProgress.js`, `lib/teacherCoachingArtifact.js`, `locales/en/common.js`, `App.js`.
