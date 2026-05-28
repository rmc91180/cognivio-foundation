# PR C9.1 — Video upload, compression, storage, privacy clearance, playback, and analysis-source reliability

Author: codex-pilot-readiness
Branch: `hotfix/video-processing-privacy-reliability`
Date: 2026-05-28

## Mission

Production teacher uploads were creating canonical video records and raw R2
assets but failing privacy clearance with
`Teacher privacy profile has no usable references` — even though setup said
references were ready. Reference image rows had `embedding: []`,
`biometric_artifact_status: "no_persistent_embedding_saved"`,
`quality_checks.validation_mode: "contract_only"`, and malformed URLs like
`"S3_PUBLIC_BASE_URL=https://pub-...r2.dev/uploads/..."`. Separately, 46-80 MB
uploads were stored raw but marked `transcode_status: "not_required"` and
`processed_asset_state: "not_created"`, conflicting with the product
requirement to compress large videos.

C9.1 fixes the upload → storage URL → privacy reference usability → transcode
decision → playback / analysis asset selection path **without weakening any
privacy policy and without exposing raw video to teachers**.

## A. Definitively fixed

### A.1 Storage URL normalization

`backend/app/services/storage_urls.py` (new):

- `normalize_storage_url(value)` strips the leaked
  `S3_PUBLIC_BASE_URL=` (or any UPPER_SNAKE `NAME=`) prefix, surrounding
  whitespace, and quotes. Idempotent for clean values; never strips legitimate
  query strings.
- `is_probably_http_url(value)` minimal syntactic check (http/https/s3).
- `build_public_storage_url(key, public_base_url, endpoint, region, bucket)` —
  used by `_get_s3_public_url` so the configured base URL is **always**
  normalized before forming a public URL.
- `describe_storage_url_issue(value)` returns a stable code
  (`url_missing` / `url_empty` / `url_env_name_prefix_leak` /
  `url_not_http_scheme` / `url_not_string`). Used by the audit script and the
  privacy reference validator.

Wired into `server.py`:

- `S3_PUBLIC_BASE_URL` / `S3_ENDPOINT` are now normalized at boot.
- `_get_s3_public_url(key)` routes through `build_public_storage_url`.
- `_save_privacy_reference_file` normalizes `file_url` before returning to the
  caller — so newly persisted reference rows never store the corrupt prefix.
- Both upload paths (`server.upload_video`, `app.services.video_service.upload_video`)
  normalize `file_url` / `raw_file_url` before insertion.
- `_resolve_video_playback_url` normalizes URLs from legacy rows on read.

### A.2 Privacy reference usability

`backend/app/services/privacy_references.py` (new) is the single canonical
"is this reference usable" decision shared between the readiness endpoint, the
privacy worker, the retry endpoint, the audit script, and the pilot smoke
script. Production failure codes are stable strings:

- `no_reference_records`
- `reference_url_malformed`
- `reference_fetch_failed`
- `reference_expired`
- `unsupported_reference_type`
- `reference_policy_blocked`
- `reference_quality_unverified`
- `no_local_file_and_no_fetchable_url`
- `no_usable_references`

Recoverable corruption (URL that `normalize_storage_url` rescues) is reported
as a non-blocking `note` so the worker still proceeds while the operator gets
a fixable audit signal.

Wired into `server.py`:

- `_summarize_teacher_privacy_references(references, allow_url_fetch=True)`
  helper sits next to `get_teacher_reference_images_for_blur`.
- `_teacher_readiness` now derives `privacy_reference_images_ready` from the
  **worker-usability count**, not the row count. New response fields:
  `privacy_reference_images_usable_count`, `privacy_reference_failure_codes`.
- The privacy worker (`_run_video_privacy_job`) calls
  `summarize_privacy_references(allow_url_fetch=False)` so the worker enforces
  the strict local-file rule; structured failure codes are persisted on the
  video document (`privacy_reference_failure_codes`,
  `privacy_reference_usable_count`, `privacy_reference_total_count`,
  `privacy_reference_failure_at`).
- The retry endpoint (`retry_video_privacy` in both `server.py` and
  `app/services/video_service.py`) re-evaluates references and refuses the
  retry with `PRIVACY_REFERENCES_NOT_USABLE` + the structured failure codes,
  instead of silently re-running the worker and re-failing.

### A.3 Transcode decision + compression policy

New env vars (`backend/app/config.py`):

- `VIDEO_TRANSCODE_ENABLED` (default `false`)
- `VIDEO_TRANSCODE_MIN_BYTES` (default 25 MB)
- `VIDEO_UPLOAD_TIMEOUT_MS` (default 5 min)

`backend/app/services/video_assets.py:decide_transcode_for_upload` returns one
of four stable values: `queued`, `pending`, `not_required`,
`not_required_unknown_size`. The previous one-liner

```python
transcode_status = QUEUED if VIDEO_TRANSCODE_PIPELINE_ENABLED else NOT_REQUIRED
```

silently downgraded 46-80 MB uploads. The new decision:

- below `min_bytes` → `not_required`
- above `min_bytes`, pipeline live → `queued`
- above `min_bytes`, pipeline off → `pending` (still queued, never silently
  flipped to `not_required`).

Wired into both upload paths. The decision is persisted as
`transcode_decision`, `transcode_decision_reason`, `transcode_min_bytes` on
the video doc so audits can reconstruct the choice. The privacy-job enqueue
only short-circuits when the transcode worker actually owns the upload; for
`pending` decisions the privacy worker is still enqueued so uploads still
progress.

### A.4 Asset selection (playback + analysis)

`backend/app/services/video_assets.py`:

- `select_playback_asset(video, viewer_role)` — teachers never get raw URLs;
  admins can fall back to raw only when `allow_raw_for_admin=True`; observers
  behave like teachers.
- `select_analysis_asset(video)` — refuses to start analysis until
  `privacy_status == "completed"`; prefers redacted → processed → raw (raw
  only when `destructive_blurring_enabled=False`); returns structured failure
  codes (`privacy_not_completed`, `no_analysis_asset`,
  `asset_path_unreachable`).

`server.py` exposes `_resolve_teacher_video_playback_url(video)` for strict
teacher surfaces while keeping the legacy `_resolve_video_playback_url(video)`
shape for backwards-compatible admin/list responses (which apply
normalization on read).

### A.5 Operator tooling

- `backend/scripts/audit_video_processing_pipeline.py` (new) — read-only
  scanner that reports malformed URLs across `videos` + `teacher_face_references`,
  readiness ↔ worker disagreements, large videos marked `not_required`,
  legacy unstructured privacy errors, missing redacted assets after
  completion, and unsafe analysis-asset choices. Exit 1 when issues found.
- `backend/scripts/run_pilot_smoke_checks.py` extended with four C9.1 checks:
  `video_pipeline_storage_urls`, `video_pipeline_reference_readiness`,
  `video_pipeline_transcode_decisions`, `video_pipeline_teacher_playback_safety`.

### A.6 Tests

- `backend/tests/test_storage_url_normalization.py` — 30 cases.
- `backend/tests/test_privacy_reference_usability.py` — 19 cases.
- `backend/tests/test_video_asset_selection.py` — 18 cases.
- `backend/tests/test_video_upload_processing_pipeline.py` — 7 cases pinning
  the readiness/worker integration.
- `backend/tests/test_tenant_upload_privacy_flow.py` fixture updated so
  reference docs now look like production rows (file_path + file_url +
  s3_key). The transcode-queue test explicitly enables the new
  size-driven controls.

**Backend suite: 541 passing.** Frontend production build: green.

## B. Definitively diagnosed but deferred

### B.1 Remote reference fetch in the worker

The privacy worker still calls `cv2.imread(local_path)`. When the operator's
worker host has no local copy of the reference (because the upload happened on
a different replica), we now emit the structured failure code
`no_local_file_and_no_fetchable_url` instead of the generic legacy error.

Materializing the reference from S3/R2 to a temp path inside the worker
(`download_to_temp(reference)`) is the next correct change, but it requires
new S3 download plumbing + retention/temp-cleanup logic that should ship as
its own PR (estimated +120 LOC, +6 tests). The C9.1 helpers already expose
the seam: `PrivacyReferenceUsability.s3_key` and `.fetchable_url` carry the
inputs.

### B.2 Backfill repair for already-corrupted DB rows

The audit script will list every reference / video row whose persisted URL is
malformed. A non-destructive `--repair` flag that rewrites the field through
`normalize_storage_url` would close the loop. Deliberately deferred so this
PR remains strictly read-only against production data, matching the
"Do not delete production data" constraint.

### B.3 Transcode worker activation

`VIDEO_TRANSCODE_ENABLED` defaults to `false` so this PR does not flip
production behavior unilaterally. Once ops sets the env var (and confirms a
transcode worker is running), large uploads transition from `pending` →
`queued` → `processed`. The `transcode_decision_reason` field already
records "size_above_min_but_pipeline_off" so the operator can see the
pending population before flipping the switch.

## C. Still unknown

### C.1 Why the leaked-prefix originated

The audit script will find the corrupt rows but does not prove how they were
written. Hypothesis: an operator pasted an entire `.env` line as the value of
a deploy variable (Railway accepts `KEY=value` strings and stores the whole
right-hand side). The defensive normalization makes this class of operator
mistake harmless going forward; we should still confirm by inspecting the
deploy log when the next operator-side rotation happens.

### C.2 Whether the privacy worker reliably runs at all on the production
   topology

The worker is started by `_app_startup`. If the production deploy is
multi-process / multi-replica without sticky scheduling, the worker may be
queued on a replica that lacks the local upload. The new structured failure
code surfaces this clearly; the long-term fix is either object-storage-aware
references (B.1) or a single-worker deployment profile.

### C.3 Frontend retry button copy

The frontend already exposes a privacy retry button (PR C7). With the new
409 `PRIVACY_REFERENCES_NOT_USABLE` reason code, the UI can show the
specific failure (e.g. "Add a new reference photo — the existing one cannot
be fetched"). This PR does not change the UI copy; that should land alongside
B.1 when the user-facing fix is real.

## Constraints honored

- Do not weaken privacy policy. ✅
- Do not expose raw unblurred classroom video to teachers unless policy
  explicitly permits it. ✅ (`select_playback_asset(viewer_role="teacher")`
  never returns raw; `_resolve_teacher_video_playback_url` enforces strict
  policy; `select_analysis_asset` refuses raw when destructive blur enabled.)
- Do not delete raw assets prematurely. ✅
- Do not remove source-chain safeguards. ✅
- Do not bypass destructive blur. ✅
- Do not mark privacy as completed if redacted asset is not actually
  created. ✅ (`select_playback_asset` returns `redacted_asset_missing` when
  privacy is completed but the asset file/url is absent.)
- Do not mark teacher setup/reference readiness as ready unless references
  are usable by the worker. ✅ (`_teacher_readiness` now derives readiness
  from `summarize_privacy_references`.)
- Do not force analysis on privacy-failed videos. ✅
  (`select_analysis_asset` refuses unless `privacy_status == "completed"`.)
- Do not change C1-C9 teacher artifact safety gates. ✅
- Do not create fake feedback from failed video assets. ✅
- Do not delete production data. ✅
- Do not split server.py. ✅ (helpers live under `backend/app/services/`;
  server.py imports them.)
- Do not require persistent biometric embeddings if policy says no
  persistent embedding is allowed. ✅
  (`PRIVACY_REFERENCE_FAILURE_CODES` has no embedding-existence requirement.)

## Commands run

```
python -m pytest tests/test_storage_url_normalization.py \
  tests/test_privacy_reference_usability.py \
  tests/test_video_asset_selection.py \
  tests/test_video_upload_processing_pipeline.py
# 83 passed

python -m pytest tests/   # 541 passed (full backend regression)
npm run build             # green
```
