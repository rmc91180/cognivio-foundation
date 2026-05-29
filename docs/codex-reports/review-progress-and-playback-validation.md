# PR C9.3 — Review progress instrumentation and browser-playable redacted video validation

Author: codex-pilot-readiness
Branch: `hotfix/review-progress-playback-validation`
Date: 2026-05-29

## Mission

Two production problems, both teacher-facing:

1. **Reviews looked stuck.** Teachers saw a single ambiguous "processing"
   spinner that never resolved — even when the review was actually **complete**
   (just degraded to vision-only because paid analysis was not allowed), and
   even when **audio analysis was disabled by configuration** and was never
   going to run. The known production record makes this concrete:

   - video `79cbcdc5-77c9-413d-ad40-9214a4487467`,
     teacher `d36bcacb-fb19-4d97-8753-f0944131505b`
   - `analysis_mode = fallback_paid_analysis_not_allowed`
   - `audio_analysis_enabled = false`, `audio_transcript_status = null`
   - `degradation_reasons = ["vision_only_mode"]`
   - privacy manifest: `fallback_mode = blur_all`, `teacher_track_id = null`,
     `faces_detected_total = 5098`, `faces_blurred_total = 5098`

   That review is *done* (degraded) with audio *deliberately off*, yet the UI
   reported it as perpetually processing and the transcript card promised copy
   "after audio review is complete."

2. **Redacted video froze in the browser.** The redaction render used OpenCV
   `cv2.VideoWriter` with the `mp4v` fourcc, producing files browsers cannot
   play (single frozen frame). Assets were marked playback-ready without ever
   confirming they were actually browser-playable.

C9.3 makes review progress **deterministic and honest** for every surface, and
makes redacted playback **validated before it is ever offered** — without
weakening any privacy policy, without exposing raw video to teachers, and
without faking completion.

## A. Deterministic, teacher-safe review progress (PART 1 + PART 2)

### A.1 `backend/app/services/video_review_progress.py` (new)

`build_video_review_progress(video, assessment=None, teacher_feedback=None, *, language="en")`
is a pure (no DB / network / config) function returning a single progress
object consumed identically by the status endpoint, the video detail response,
and the teacher workspace projection:

```
status            ∈ {completed, completed_degraded, processing, blocked, failed}
percent           0..100 (weighted; audio weight 0 — informational only)
current_stage     headline stage key
teacher_message   teacher-safe copy
admin_message     operator copy
stages[]          {key, label, status[, detail]} for
                  upload, video_preparation, privacy, analysis, audio, feedback
retry             {eligible, action ∈ {retry_privacy, retry_analysis, retry_transcode}}
needs_admin_attention, failure_code, degraded, degradation_reasons
```

Rules encoded (and locked by tests):

- **Privacy gates analysis.** If `privacy_status != completed`, the analysis
  stage is `blocked` — analysis never runs on a privacy-incomplete video.
- **Completed = analysis completed + assessment present.** Analysis marked
  `completed` *without* an assessment is reported `failed` /
  `needs_admin_attention` with `failure_code = analysis_completed_without_assessment`.
  We never fake completion.
- **Degraded is complete, not stuck.** `vision_only_mode` /
  `fallback_paid_analysis_not_allowed` → `completed_degraded` (status 100%),
  never a perpetual `processing`.
- **Audio disabled ≠ pending.** `audio_analysis_enabled` falsey → the audio
  stage is `skipped` ("Audio analysis is not enabled for this review"), and the
  teacher copy never promises "after audio review is complete."
- **Feedback** released → `completed`; blocked for human review → `blocked`.

### A.2 Frontend wiring (PART 2)

- `frontend/src/lib/reviewProgress.js` (new) — pure helpers:
  `isReviewTerminal` / `reviewPollingInterval` (polling stops once the review
  reaches `completed` / `completed_degraded` / `failed` / `blocked`),
  `getAudioStageStatus` / `isAudioNotRun`, and the playback resolvers in §C.
- `frontend/src/components/VideoReviewProgress.js` (new) — presentational
  checklist + percent barometer. It renders the backend's decision verbatim
  (never invents status). Audio shown as **"Audio analysis was not run for this
  review."** when skipped/disabled; a degraded review shows the completion copy.
- `frontend/src/pages/VideoPlayerPage.js`:
  - the status poll now uses `reviewPollingInterval` so a finished (or degraded)
    review stops spinning; live changes still arrive over the WebSocket.
  - renders `<VideoReviewProgress>` under the status badges.
  - the Talk-time / transcript card receives `audioStageStatus`; both the
    talk-time empty state and the transcript empty state now say audio was not
    run (instead of "after audio review is complete") when audio is disabled.
- `frontend/src/components/TalkTimeChart.js` accepts `audioStageStatus` and
  swaps its empty-state copy (skipped/disabled → "was not run", failed →
  "could not be completed", processing/pending → "in progress").

## B. Validated, browser-safe redacted playback (PART 3 + PART 4 + PART 5)

### B.1 `backend/app/services/playback_validation.py` (new)

`validate_browser_playback_asset(...)` shells out to `ffprobe` (via an
injectable `probe` callable seam so it is fully testable) to confirm an asset is
genuinely browser-playable: H.264 video, AAC (or no) audio, `yuv420p`, and the
`+faststart` moov-atom-at-front layout. Returns a `PlaybackValidationResult`
with a stable `status` (`passed` / `failed` / `skipped_unavailable`) and
`failure_code`. `detect_mp4_faststart` and `find_ffprobe` are exported helpers.

### B.2 Browser-safe render (PART 4)

`backend/privacy_pipeline.py` — `_finalize_redacted_video_with_audio` now
re-encodes the redacted output to **libx264 / yuv420p / AAC / +faststart / mp4**.
If ffmpeg is missing it flags `browser_safe_render=False` with
`BROWSER_SAFE_RENDER_ERROR_FFMPEG_MISSING =
"ffmpeg_unavailable_for_browser_safe_render"`; an encode failure flags
`BROWSER_SAFE_RENDER_ERROR_ENCODE_FAILED = "ffmpeg_browser_safe_render_failed"`.
A frozen `mp4v` asset is never silently marked playback-ready.

### B.3 Playback gating in `server.py` (PART 3 + PART 5)

- The redaction worker persists `redacted_playback_validation` alongside the
  `privacy_manifest` in the COMPLETED `$set`.
- `_redacted_playback_ready(video)` is **True only when** the stored validation
  `status == "passed"`. A missing record or `skipped_unavailable` is not ready —
  we never assert playability we could not verify.
- `_build_teacher_playback_state(video)` returns
  `{available, asset_kind, url, status[, failure_code]}` — a teacher receives a
  URL only when privacy completed **and** the redacted asset is validation-passed.
  Statuses: `privacy_incomplete`, `no_redacted_asset`, `validation_failed`,
  `validation_pending`, `ready`. The source is always `redacted`; **never raw**.
- `_build_playback_diagnostics(video)` exposes admin booleans only
  (`raw_available` / `processed_available` / `redacted_available`,
  `selected_asset_kind`, `validation_status`, `failure_code`) — no raw URLs.
- `_apply_video_response_defaults` and `GET /videos/{id}/status` both embed
  `review_progress` and the teacher-safe `playback` object so every surface
  agrees.

### B.4 Frontend playback gating (PART 5)

`resolvePlaybackUrl` in `reviewProgress.js` is the single client decision point:

- **Non-admins** use `resolveTeacherPlaybackUrl` — a URL only when
  `playback.available === true && playback.url`. There is **no** legacy /
  `playback_url` / raw fallback for teachers.
- **Admins** keep `resolveAdminPlaybackUrl` (legacy resolver, privacy-completed
  only — may surface processed/raw per `select_playback_asset` with privilege).

`VideoPlayerPage.js` shows a precise teacher-safe message when there is no
playable URL (privacy incomplete / validation pending / validation failed)
instead of the generic "unavailable" copy.

## C. Blur-all fallback invariant locked (PART 6)

`backend/tests/test_privacy_blur_all_fallback.py` locks the safety property: when
the teacher cannot be confidently matched the pipeline falls back to
`blur_all` (`teacher_track_id = None`), **every** track decision is `blur`, and
`faces_blurred_total == faces_detected_total` — an unrecognized adult is never
preserved, even with a high similarity score, when `force_blur_all` is set. It
also locks the browser-safe finalize behavior (re-encode on success; structured
flag + best-effort artifact when ffmpeg is missing or the encode fails).

## D. Audit + smoke extensions (PART 7)

### D.1 `backend/scripts/audit_video_processing_pipeline.py`

Five new issue codes and a `_scan_review_and_playback` pass:

- `redacted_completed_without_playback_validation` — privacy completed + a
  redacted asset present + no `redacted_playback_validation` record.
- `playback_validation_failed_but_privacy_completed` — validation `failed` while
  privacy is completed.
- `teacher_playback_non_redacted_with_destructive_blur` — privacy completed +
  destructive blur (default-True when unset) but a teacher's
  `select_playback_asset(..., allow_raw_for_admin=False)` resolves a non-redacted
  source.
- `analysis_completed_without_review_progress` — analysis completed but
  `build_video_review_progress` reports `analysis_completed_without_assessment`.
- `blur_all_invariant_violation` — a `blur_all` manifest with a non-null
  `teacher_track_id`, a non-`blur` track, or `faces_blurred < faces_detected`.

### D.2 `backend/scripts/run_pilot_smoke_checks.py`

Six new checks (each a `CheckResult` with the codes above):
`check_review_progress_present`,
`check_review_progress_not_stuck_when_analysis_completed`,
`check_audio_disabled_copy_state` (fails if a disabled-audio video's audio stage
isn't `skipped`/`disabled` or "audio" leaks into the teacher message),
`check_redacted_playback_validation_present` (fail on explicit validation
failure; warn on legacy assets predating the validator),
`check_teacher_playback_uses_redacted`, and `check_blur_all_fallback_enforced`.

## E. Tests

Backend (52 new, all passing under `pytest tests/ -q --timeout 180` — full suite
**642 passed**):

- `test_video_review_progress.py` — 21
- `test_video_playback_validation.py` — 25
- `test_privacy_blur_all_fallback.py` — 6

Frontend (33 new, all passing; production `npm run build` clean):

- `src/lib/reviewProgress.test.js` — 26 (polling-stops-on-terminal contract +
  the teacher-never-gets-raw / admin-legacy playback resolvers).
- `src/pages/VideoPlayerPage.test.js` — 7 (checklist renders, audio shown as
  "not run", degraded reads as complete, teacher plays only the redacted
  validated URL, privacy-safe message when validation failed, teacher never
  falls back to the legacy/raw URL, admin keeps the legacy resolver).

The brief's targeted frontend pattern
(`VideoRecorderPage|VideosPage|VideoPlayerPage|PilotTeacherExperience|TeacherWorkspace|TeacherNavigationIntelligence`)
runs 5 suites / 32 tests, all passing.

## F. Guardrails honored

- Raw video is never exposed to teachers; teachers only ever receive the
  redacted, validation-passed asset.
- Destructive blur is never bypassed; unrecognized adult faces are never
  preserved (blur-all invariant test).
- No biometric embeddings persisted; analysis never runs on privacy-failed
  videos.
- Redacted playback is never marked ready without a `passed` validation record.
- Audio-disabled reviews are never mislabeled "pending"; degraded / vision-only
  mode is surfaced, not hidden.
- No production DB edits/deletes; the compression profile was only changed as
  required to make redacted playback browser-compatible (libx264/yuv420p/AAC/
  +faststart); `server.py` was not split; no tests were weakened.
