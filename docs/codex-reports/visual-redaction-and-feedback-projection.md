# C9.4 — Verify Visual Redaction and Project Completed Feedback Artifacts

Branch: `hotfix/visual-redaction-feedback-projection`

## Summary

Two production blockers survived C9.3 even though the teacher player was already
selecting a redacted asset, privacy was completing, and review progress finished:

1. **Privacy false-positive.** The redacted MP4 played, but visible faces were
   still recognizable. The render-time manifest reported
   `faces_blurred_total == faces_detected_total` ("100% blurred") while the
   *output pixels* were never re-inspected. Codec/browser-playability validation
   (C9.3) proves the file plays — it does **not** prove the file is private.

2. **Feedback projection failure.** Review completed and feedback was released,
   yet teacher cards showed generic pending copy ("No action needed right now",
   "Your coaching summary will appear here when the review is ready"). Each
   teacher surface resolved its own ad-hoc empty state, so a completed-but-
   withheld (or completed-and-released) review never produced a single coherent,
   specific status.

3. **WebSocket double slash.** `wss://…app//ws/videos…` — the backend origin
   ended with a trailing slash and was naively concatenated with a leading-slash
   path, breaking the live-update socket.

C9.4 closes all three: it re-inspects rendered redacted pixels and fail-closes
the privacy/playback gate on the result, strengthens blur-all rendering,
centralizes a single canonical teacher feedback view, and fixes the WebSocket
URL join. No raw/processed asset is ever exposed to a teacher, destructive blur
is never bypassed, and no C1–C9.3 safety gate is weakened.

## Files inspected

Redaction / render / privacy:
- `backend/privacy_pipeline.py` — `render_redacted_video`, `analyze_video_privacy`,
  `blur_region`, `detect_faces`, `_load_face_cascade`, `_bbox_iou`, `_safe_crop`,
  fallback `force_blur_all` path, counter accounting.
- `backend/server.py` — `_run_video_privacy_job` (privacy worker), playback gate
  helpers (`_redacted_validation_status`, `_redacted_playback_ready`,
  `_build_teacher_playback_state`, `_build_playback_diagnostics`), privacy retry.
- `backend/app/services/playback_validation.py` (C9.3 codec validation).
- `backend/app/services/video_assets.py` (`select_playback_asset`).

Playback / API / frontend:
- `backend/server.py` `/api/videos/{id}`, status, teacher playback state.
- `frontend/src/pages/VideoPlayerPage.js`, `frontend/src/lib/reviewProgress.js`.

Feedback / artifact projection:
- `backend/app/services/teacher_lesson_coaching_artifact.py` (builder, admin/teacher
  views, quarantine interplay), `teacher_artifact_quarantine.py`,
  `coach_voice_generation.py`, `app/analysis/teacher_feedback_projection.py`.
- `backend/server.py` `_build_teacher_lesson_coaching_artifact_for` (single shared
  helper) and all teacher endpoints that surface `coaching_artifact`.
- `frontend/src/pages/{VideoPlayerPage,TeacherWorkspacePage,TeacherLessonsPage,TeacherCoachingPage}.js`,
  `frontend/src/lib/teacherCoachingArtifact.js`.

Tooling:
- `backend/scripts/audit_video_processing_pipeline.py`,
  `backend/scripts/run_pilot_smoke_checks.py`.

## Production symptoms

- `currentSrc` = `…/uploads/redacted-videos/<id>.mp4` (already redacted — not raw).
- Faces visibly unblurred in the redacted playback despite privacy "ready".
- Manifest evidence: `fallback_mode: blur_all`, `teacher_track_id: null`,
  `faces_detected_total: 5098`, `faces_blurred_total: 5098`, all tracks `decision=blur`.
- Completed/released review with empty/contradictory teacher feedback cards.
- Console: `wss://…app//ws/videos…` double slash.

## Redacted asset selection finding

The frontend asset selection is **correct**. `resolveTeacherPlaybackUrl` only ever
returns the backend `playback` object's redacted, validation-gated URL, and
`resolvePlaybackUrl` never falls back to the legacy/processed URL for a non-admin.
The visible-face bug is therefore **not** a frontend asset-selection problem — it
is in render fidelity + the absence of output verification.

## Visual redaction / root-cause finding

- The renderer blurs **detection boxes per frame** (frontal Haar cascade), not
  tracks or segments — empty segments could not cause "no blur", but the frontal
  cascade **misses profile/tilted/distant faces**, so those faces were never
  blurred yet still counted toward neither the blur nor the false "100%".
- `faces_blurred_total == faces_detected_total` only means "every box the frontal
  detector found was blurred" — it says nothing about faces the detector missed,
  and counters could in principle increment without a strong pixel change.
- The single `GaussianBlur` (`blur_size = max(21, max(w,h)*0.35)`, padding `0.18`)
  could leave enough residual high-frequency detail for a face to remain
  recognizable.
- **Critically**, the output was never re-inspected after render/mux — codec
  validation (C9.3) checks playability, not privacy.

## Blur render changes (PART 2)

`backend/privacy_pipeline.py`:
- **Wider detection** for the blur-all path: added `_load_profile_cascade` +
  `_detect_profile_faces` (both orientations via horizontal flip) and merged with
  the frontal detector through `_merge_boxes` (IoU dedupe). Faces the frontal
  cascade misses are now caught and blurred.
- **Stronger destructive redaction** in `blur_region`: padding `0.18 → 0.30`, then
  **pixelate** (downsample ÷12 → nearest-neighbour upscale) **followed by a heavy
  GaussianBlur** (`max(31, max(w,h)*0.6)`). Pixelation collapses facial structure
  regardless of blur-kernel math, driving the region's variance-of-Laplacian far
  below the validator threshold and making the face non-recoverable.
- **Temporal blur persistence** (`temporal_blur_ttl = 6`): in blur-all mode a face
  that flickers out of detection for a few frames is still blurred, closing the
  window where a recognizable face flashes through.
- **Invariant preserved**: in blur-all mode `faces_detected_total` and
  `faces_blurred_total` both increment by the union count, so
  `blurred == detected` continues to hold and is now backed by real pixel changes.
- The **selective** (preserved-teacher) path is unchanged in policy: only a
  confidently-matched teacher box is kept; everything else is blurred.

## Visual validation design and limitations (PART 1)

New module `backend/app/services/visual_redaction_validation.py`:
- `validate_visual_redaction(rendered_path, *, mode, max_visible_faces, …)`
  re-samples frames of the **rendered** redacted MP4, detects candidate faces
  (frontal + profile Haar), and measures each region's **variance of the
  Laplacian** (`measure_region_sharpness`, with a pure-numpy fallback). A blurred
  region has low high-frequency energy; a sharp/unblurred face has high energy.
- **Modes**: `blur_all` tolerates **0** sharp faces; `selective` tolerates up to
  `max_visible_faces` (the preserved teacher).
- **Statuses**: `passed` / `failed` / `skipped_unavailable`.
  **Failure codes**: `unblurred_face_detected`, `too_many_visible_faces`,
  `unreadable_asset`, `no_frames_sampled`, `cv2_unavailable`.
- **Fully testable**: `frame_sampler` / `face_detector` / `sharpness_fn` are
  injectable seams; OpenCV defaults are only used when nothing is injected.
- **Fail-closed**: missing OpenCV, an unreadable asset, or zero sampled frames is
  **not** verified — `is_redaction_verified` is True only for `status == "passed"`.

Limitations (documented):
- Detection-based: a face the validator's detector also misses cannot be re-checked.
  This is a *conservative* check — it never asserts privacy it could not confirm,
  and the strengthened blur-all render (profile sweep + pixelation + temporal
  persistence) is the primary defense; the validator is the fail-closed audit.
- The sharpness threshold (`DEFAULT_SHARPNESS_THRESHOLD = 80.0`) is conservative;
  broad threshold/compression tuning is **deferred** (out of scope, see below).

## Privacy completion gating (PART 3)

In `_run_video_privacy_job` (`backend/server.py`), after the redacted asset is
rendered and codec-validated, the worker now also runs `validate_visual_redaction`
on the rendered file (`asyncio.to_thread`). Mode is derived from the render:
`blur_all` when `fallback_mode == "blur_all"`, no teacher track, or an explicit
blur-all override; otherwise `selective` with `max_visible_faces = 1`.

Completion gate (fail-closed):
- `status == "failed"` → privacy **not** completed; `privacy_error =
  redacted_video_not_browser_playable:visual_redaction:<code>`; `redacted_asset_state
  = invalid`; assets preserved for audit/retry; source-chain incident recorded.
- `status == "skipped_unavailable"` → fails on a real host (we must be able to
  verify) but is tolerated only in the **degraded** privacy mode (no OpenCV),
  where the teacher-playback gate still independently requires a `passed` record.
- `visual_redaction_validation` (full `to_dict()`) is persisted on the video in
  both the failure and success branches, and surfaced in admin playback diagnostics
  (`visual_redaction_status` / `visual_redaction_failure_code`).

Teacher playback readiness now requires **both** gates:
`_redacted_playback_ready` = `redacted_playback_validation.status == "passed"`
**AND** `visual_redaction_validation.status == "passed"`.
`_build_teacher_playback_state` returns `redaction_unverified` / `redaction_pending`
(no URL) when visual validation failed / is missing.

## Feedback projection root-cause finding

- A canonical `TeacherLessonCoachingArtifact` already existed and was attached by a
  single shared helper (`_build_teacher_lesson_coaching_artifact_for`). The artifact
  correctly encodes `teacher_feedback_allowed` + `blocked_reason`.
- The gap was the **last mile**: each frontend surface independently chose copy from
  `empty_state`, and nothing reconciled the **admin release gate**
  (`feedback_release_status`) with the **safety gate**. A released review with an
  allowed artifact had no single object saying "show this, with this headline";
  a withheld review fell back to generic placeholder copy.

## Canonical feedback selector behavior (PART 4)

New selector `get_teacher_visible_lesson_feedback(artifact, *, feedback_release_status,
language)` in `teacher_lesson_coaching_artifact.py` returns one object with a
SPECIFIC `status` / `headline` / `detail` (+ `feedback_available`, the artifact's
`summary` / `action_items` / `highlights` / `deep_dive` / `next_best_action` /
`navigator` / `lesson`). Decision order:

1. **Safety gate wins.** If `teacher_feedback_allowed` is False, the `blocked_reason`
   maps to a specific withheld status — `not_yet_reviewed`, `admin_hidden`,
   `revision_requested`, `source_unavailable`, `evidence_insufficient`,
   `safety_withheld` (else `processing`). A released flag can **never** surface
   unsafe/unverified feedback.
2. **Release gate.** Allowed but `feedback_release_status == "blocked"` →
   `awaiting_admin_release` (ready, not yet shown, specific copy).
3. Otherwise (allowed + released, or allowed with no release record) → `ready`
   with `feedback_available = True` and populated coaching.

Copy is bilingual (EN/HE) for all nine statuses. The shared helper attaches the
result as `artifact["teacher_feedback_view"]`; `teacher_safe_artifact` preserves it
(strips only `_coach_voice_admin`), so every teacher endpoint that returns
`coaching_artifact` carries the same decision.

## Frontend changes

- `frontend/src/lib/teacherCoachingArtifact.js`: `artifactFeedbackView`,
  `isFeedbackAvailable`, and `feedbackViewMessage` (prefers `teacher_feedback_view`,
  falls back to `empty_state`).
- All four teacher surfaces now render the canonical view's `headline`/`detail` for
  blocked/withheld states (then `empty_state`, then a literal fallback):
  `VideoPlayerPage.js`, `TeacherWorkspacePage.js`, `TeacherLessonsPage.js`,
  `TeacherCoachingPage.js`. Released+available reviews populate summary/action items;
  withheld reviews show a specific reason, never generic pending copy.

## WebSocket URL fix (PART 5)

- `buildBackendWebSocketUrl({ backendUrl, path })` in `reviewProgress.js`: strips
  trailing slashes from the origin, swaps `http(s)://` → `ws(s)://`, and joins a
  single-slash path. Returns `null` for an invalid base.
- `VideoPlayerPage.js` now builds its socket via this helper, eliminating the
  `//ws/videos` double slash.

## Tests added / updated

Backend (3 new files, 55 new tests; full suite 697 passing):
- `tests/test_visual_redaction_validation.py` (24) — unreadable/None/empty path,
  all-blurred→passed, blur-all sharp face→`unblurred_face_detected`, selective
  allowance + `too_many_visible_faces`, `no_frames_sampled`, sampler raises/None →
  `unreadable_asset`, no-faces→passed+warning, mode normalization, OpenCV-absent →
  `skipped_unavailable`, `measure_region_sharpness` (numpy fallback / flat vs sharp /
  tiny region), `to_dict` round-trip, `is_redaction_verified` semantics, vocabularies.
- `tests/test_teacher_feedback_view_projection.py` (19) — every `blocked_reason →
  status` mapping, unknown reason/None → `processing`, release `blocked` →
  `awaiting_admin_release`, allowed+released → `ready`/available, unrecognized release
  ignored, **safety wins over release**, EN≠HE copy, language fallback, vocabulary.
- `tests/test_c94_audit_smoke.py` (12) — audit `_scan_visual_redaction`
  (missing/failed/skipped/passed/not-completed/no-asset), `_scan_feedback_release_consistency`
  (released-but-blocked / clean / unreleased), smoke
  `check_visual_redaction_validation_present` (fail/warn/ok) and
  `check_teacher_feedback_view_consistency` (ok/available/warn), and the server gate
  helpers `_visual_redaction_verified` / `_redacted_playback_ready` (both-gates,
  codec-only, visual-only, missing).

Frontend (44 tests across 2 files; new + extended):
- `src/lib/reviewProgress.test.js` — extended with 6 `buildBackendWebSocketUrl`
  cases (trailing slash, no slash, no-leading-slash path, http→ws, multiple
  trailing slashes, invalid base) alongside existing playback-resolver tests.
- `src/lib/teacherCoachingArtifact.test.js` (new) — `feedbackViewMessage`
  (prefers backend view, specific admin-hidden/awaiting-release copy, empty_state
  fallback, bare-view input, null), `isFeedbackAvailable` (available only when the
  view says so; released-but-blocked stays false), `artifactFeedbackView`.

## Audit / smoke checks (PART 6)

`audit_video_processing_pipeline.py` — new issue codes + scans:
`visual_redaction_validation_missing`, `visual_redaction_failed_but_privacy_completed`,
`visual_redaction_inconclusive_but_privacy_completed` (`_scan_visual_redaction`), and
`feedback_released_but_safety_blocked` (`_scan_feedback_release_consistency`).

`run_pilot_smoke_checks.py` — new checks:
`check_visual_redaction_validation_present` (fail on failed-but-completed; warn on
missing/inconclusive) and `check_teacher_feedback_view_consistency` (withheld view
must carry specific copy; safety wins over release; available ⇒ allowed).

## Commands run / results

Backend (from `backend/`):
- `python -m py_compile` of server.py, privacy_pipeline.py,
  visual_redaction_validation.py, playback_validation.py, video_review_progress.py,
  video_assets.py, teacher_lesson_coaching_artifact.py, teacher_artifact_quarantine.py,
  coach_voice_generation.py, scripts/audit_video_processing_pipeline.py,
  scripts/run_pilot_smoke_checks.py + `python -m compileall -q app` → **OK**.
- New C9.4 files + targeted privacy/playback/feedback set → **201 passed**.
- Regression (source-chain, evidence-quality, coach-voice, navigation, admin
  notifications, end-to-end, pilot demo, pilot teacher experience, quarantine) →
  **134 passed**.
- Full `python -m pytest tests/ -q` → **697 passed**.

Frontend (from `frontend/`):
- `craco test --watchAll=false` on `src/lib/(reviewProgress|teacherCoachingArtifact).test.js`
  → **44 passed**.
- `npm run build` (production build) — see PR checks.

## Known limitations

- Visual validation is detection-based: a face missed by both the render detector
  and the validator detector cannot be re-checked. The check is conservative and
  fail-closed; the strengthened blur-all render is the primary mitigation.
- `skipped_unavailable` is tolerated for completion **only** in degraded (no-OpenCV)
  privacy mode; the teacher-playback gate still independently requires `passed`, so
  a degraded-mode asset is never teacher-playable until re-verified on a real host.
- Sharpness threshold is a heuristic; no per-codec calibration in this PR.

## Deferred compression tuning note

Broad compression-ratio / encoder-bitrate tuning is intentionally **out of scope**
for C9.4. The blur strength increase here is targeted at privacy fidelity, not
general transcode quality. Compression tuning remains a separate, deferred task.

## Production smoke instructions

After Railway deploys this branch:

1. **Existing latest video** — confirm `currentSrc` is redacted; confirm
   `visual_redaction_validation` exists with `status == "passed"`; confirm faces are
   visibly blurred; confirm teacher playback is unavailable if validation failed;
   confirm review progress complete/completed_degraded; confirm feedback cards
   populate or show a precise `status` reason.
2. **New upload** — small video; confirm privacy materialization succeeds, visual
   redaction passes, redacted playback moves with faces blurred, analysis completes,
   and coaching summary/action items/moments populate when the artifact is valid.
3. **Substitute / no-teacher-visible case** — confirm `fallback_mode == blur_all`,
   every face blurred (including any adult/substitute), and no unrecognized face
   preserved.
4. **WebSocket** — confirm the console no longer shows `//ws/videos` and that review
   progress updates without reload.
5. **Audit / smoke**:
   ```
   cd backend
   python scripts/audit_video_processing_pipeline.py --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b --limit 10
   python scripts/run_pilot_smoke_checks.py --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b --json
   ```
   Expected: no teacher playback without visual validation; no privacy-completed
   asset with failed/missing visual validation (new assets); no released feedback
   missing projection for completed reviewed videos; blur_all invariant OK.

## Open forensic questions

- The **existing** production redacted asset (`b84feea4…`) predates this validator;
  its persisted record will read `visual_redaction_validation_missing`. It must be
  **reprocessed** (privacy retry) to gain a `passed` record before it is treated as
  teacher-safe — it should not be assumed private retroactively.
- Confirm on a real host whether the prior weak blur or the missed profile faces was
  the dominant cause for that specific recording (the strengthened render addresses
  both).

## C10 handoff notes

- Consider a stronger/learned face detector (DNN) for both render and validation to
  shrink the "missed by both detectors" gap.
- Consider per-codec sharpness calibration and a small labeled redaction fixture set.
- Consider a one-shot backfill job that reprocesses pre-C9.4 redacted assets so their
  `visual_redaction_validation` is populated rather than relying on lazy retry.
