# PR C9.2 — Materialize privacy reference images from object storage

Author: codex-pilot-readiness
Branch: `hotfix/privacy-reference-materialization`
Date: 2026-05-28

## Summary

C9.1 made the privacy worker honest about why it was failing: production
reference rows live only in R2/S3, so the worker reported the structured codes
`no_local_file_and_no_fetchable_url`, `reference_url_malformed`,
`remote_only_but_fetch_disabled`, and `no_usable_references`. C9.2 closes the
loop by *materializing* those remote references into a per-job temp directory
so the OpenCV blur worker has the local files it needs — without persisting
biometric embeddings, exposing raw video to teachers, or relaxing any C1–C9.1
policy gate.

After this PR the pipeline is:

```
upload → raw stored → transcode (if required) → processed asset stored →
  privacy worker loads reference rows →
  materialize remote references into a temp dir →
  destructive blur uses temp local paths →
  temp dir cleaned up in finally →
  redacted asset written + verified →
  teacher playback uses redacted URL →
  analysis proceeds from the redacted/processed asset
```

## Files inspected

- `backend/app/services/privacy_references.py` (C9.1 usability gate)
- `backend/server.py` `_run_video_privacy_job`,
  `_save_privacy_reference_file`,
  `_materialize_video_asset_locally`,
  `_get_s3_client`,
  `_teacher_readiness`,
  `retry_video_privacy`
- `backend/app/services/video_service.py` `retry_video_privacy`
- `backend/privacy_pipeline.py` `load_reference_signatures`,
  `analyze_video_privacy`, `render_redacted_video`
- `backend/scripts/audit_video_processing_pipeline.py`
- `backend/scripts/run_pilot_smoke_checks.py`
- `backend/app/config.py` `PrivacySettings`

## Production failure diagnosis

The newest failed video after C9.1 (`8c81ff86-c0b0-476e-ad5d-7220803577e9`)
had:

- `raw_asset_state = stored`
- `processed_asset_state = stored` (C9.1 transcode worked)
- `redacted_asset_state = failed`
- `privacy_status = failed`
- `privacy_reference_failure_codes = [no_local_file_and_no_fetchable_url,
   reference_url_malformed, remote_only_but_fetch_disabled,
   no_usable_references]`

Teacher reference rows had `s3_key` (the upload path actually completed) but
`file_url` was a leaked-prefix string and the worker host had no local copy of
the image. The C9.1 worker passed `allow_url_fetch=False` to the usability
summary, which deliberately classified s3-only references as
`remote_only_but_fetch_disabled` — *correctly* refusing to mark privacy
"completed" while silently doing nothing.

C9.1 also left a clear seam: `summarize_privacy_references` already exposes
the per-reference detail with `s3_key` populated. C9.2 only had to add the
"materialize into local files for the duration of the job" step.

### Local-only assumption found

`backend/privacy_pipeline.py:load_reference_signatures` calls
`cv2.imread(str(reference_path))`, which only accepts local filesystem paths.
This is the single point in the destructive blur pipeline that required local
files; everything downstream (face detection, signature matching, render
pipeline) already worked through the same path list.

### Did storage-client download already exist?

Yes — `_get_s3_client` already returns a boto3 S3 client, and
`_materialize_video_asset_locally` (server.py:3681) already uses
`client.download_file(BUCKET, key, dest)` to materialize video assets for the
master-admin retry flow. C9.2 lifts that pattern into a named helper
(`download_s3_key_to_file`) and uses it from the reference materializer.

### Is public URL fallback needed?

Not for current production. R2 reference URLs are public, but every reference
row also has `s3_key`, and the worker has authenticated R2 credentials, so the
storage-download path is preferred. The URL fallback is still implemented
because the brief required it, but it stays *off* behind
`PRIVACY_REFERENCE_URL_FETCH_ENABLED` (default `false`) and requires a
non-empty `PRIVACY_REFERENCE_URL_ALLOWED_HOSTS` allow-list before any host is
accepted.

## Materialization design

New service: `backend/app/services/privacy_reference_materialization.py`.

Public surface:

- `materialize_privacy_references(references, *, upload_dir, storage_downloader,
  url_fetcher, url_fetch_enabled, allowed_hosts, timeout_seconds, max_bytes,
  now_iso, temp_dir_prefix)`
- `materialize_privacy_reference(...)` for per-reference use.
- `cleanup_materialized_privacy_references(result)` — best-effort, idempotent.
- `verify_materialized_reference_file(path, max_bytes)` — magic-byte + size
  check (does not import PIL; OpenCV is the real reader).
- `is_safe_privacy_s3_key(key)` — refuses anything outside `uploads/privacy/`.
- `is_allowed_reference_url(url, allowed_hosts)` — HTTPS + host allow-list.
- `evaluate_materialization_capability(...)` — cheap, side-effect-free probe
  used by readiness, audit script, and smoke runner so they all agree.

Result shape:

```python
PrivacyReferenceMaterializationResult(
    usable=[
        MaterializedReference(
            reference_id=..., teacher_id=...,
            source="local_path" | "s3_key" | "normalized_url",
            local_path="/tmp/cognivio-privacy-refs-<video-id>-xxxx/<ref>.jpg",
            content_type=..., bytes_written=..., cleanup_required=True/False,
            notes=(...),
        ),
        ...
    ],
    unusable=[UnusableReference(failure_codes=(...), message=...), ...],
    temp_dir="/tmp/cognivio-privacy-refs-<video-id>-xxxx",
    failure_codes=(...),
    notes=(...),
    cleanup=callable_that_rmtrees_temp_dir,
)
```

Materialization order per reference:

1. **Local file present** under `UPLOAD_DIR / file_path` AND readable →
   `source=local_path`, `cleanup_required=False`.
2. **Authenticated storage download** via `storage_downloader(s3_key,
   destination)` — only when `is_safe_privacy_s3_key(s3_key)` is True (the
   key is under `uploads/privacy/`). Defense-in-depth against a corrupt DB
   row trying to pull arbitrary objects from the bucket.
3. **URL fetch** — only when `PRIVACY_REFERENCE_URL_FETCH_ENABLED=true` AND
   the host appears in `PRIVACY_REFERENCE_URL_ALLOWED_HOSTS`. HTTPS only,
   streamed with `timeout_seconds`, capped at `max_bytes`.

Every materialized file goes through `verify_materialized_reference_file`
before being marked usable: magic-byte check (JPEG/PNG/WEBP), size cap, and
file-exists check. Files that fail verification are unlinked immediately and
the reference is moved to `unusable` with the appropriate failure code.

## Storage-client download behavior

New helper `download_s3_key_to_file(s3_key, destination_path)` in
`server.py`:

- Raises `RuntimeError("storage_download_unavailable")` when the bucket /
  credentials are not configured.
- Raises `FileNotFoundError("reference_object_not_found")` when boto reports
  `NoSuchKey` / 404.
- Re-raises other boto exceptions (caller maps to `reference_fetch_failed`).
- Never logs the access key, secret, or full URL.

Capability probe `_storage_download_available()` is the single source of
truth — used by readiness, the materializer, the audit script, and the smoke
runner. Returns `True` only when `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY` are all set.

## URL fetch fallback behavior

`fetch_public_url_to_file(url, destination_path, timeout_seconds, max_bytes)`:

- Streams via `requests.get(stream=True, timeout=...)`.
- Caps total bytes at `max_bytes`; raises `RuntimeError("max bytes exceeded")`
  on overflow and unlinks the partial file.
- Maps HTTP 404 to `FileNotFoundError("reference_object_not_found")`.
- Logs only the host label, never the full URL (could contain a presigned
  signature).

Disabled by default. Even when enabled, the materializer requires:

- The reference URL normalizes cleanly (C9.1 `normalize_storage_url`).
- Scheme is HTTPS.
- Host appears in `PRIVACY_REFERENCE_URL_ALLOWED_HOSTS` (comma-separated).

## Temp-file cleanup behavior

- Temp directory: `tempfile.mkdtemp(prefix=f"cognivio-privacy-refs-{video_id}-")`.
- Each materialized file lives directly under the temp dir; nothing is written
  outside it.
- Cleanup is invoked from the privacy worker's `finally` block in
  `_run_video_privacy_job`, so it runs on success, on caught exceptions, AND
  when the worker is interrupted between completion and the next state
  transition.
- `cleanup_materialized_privacy_references` uses `shutil.rmtree(ignore_errors=True)`
  — safe to call multiple times and never raises.

## Privacy retry behavior

`retry_video_privacy` (in `server.py` and mirrored in
`app/services/video_service.py`) now:

1. Re-runs the materialization-aware usability summary via
   `_summarize_teacher_privacy_references` (defaults to actual capability:
   `_storage_download_available()` and `PRIVACY_REFERENCE_URL_FETCH_ENABLED`).
2. If still no usable references, refuses retry with HTTP 409:
   ```json
   {
     "code": "PRIVACY_REFERENCES_NOT_USABLE",
     "reason_code": "storage_download_unavailable" | "no_usable_references" | ...,
     "failure_codes": [...],
     "reference_total": ...,
     "reference_usable_count": ...,
     "storage_download_available": true|false,
     "url_fetch_enabled": true|false
   }
   ```
3. Otherwise enqueues the privacy job from the same local source path as
   C9.1.

The retry never:

- Re-runs the worker when materialization can't possibly succeed (wasted job
  attempts).
- Deletes raw or processed assets.
- Bypasses destructive blur.

## Playback and analysis implications

C9.1 already ensured:

- `_resolve_teacher_video_playback_url(video)` is strict — teachers see only
  the redacted asset.
- `select_analysis_asset(video)` refuses unless
  `privacy_status == "completed"`.

C9.2 does not change either contract. The C9.2 tests
(`test_resolve_teacher_video_playback_url_*` in
`test_video_upload_processing_pipeline.py` and the analysis-asset cases in
`test_video_asset_selection.py`) continue to pass.

## Updated readiness contract

`_teacher_readiness` now derives `privacy_reference_images_ready` from
`_summarize_teacher_privacy_references()` which honors actual worker
capability:

- If R2/S3 credentials are configured, references with `s3_key` are usable.
- If `PRIVACY_REFERENCE_URL_FETCH_ENABLED=true`, references with a normalized
  HTTPS URL on an allow-listed host are usable.

When neither path is configured AND the rows are remote-only, readiness
explicitly fails with:

- `privacy_reference_images_ready = false`
- `privacy_reference_failure_codes` includes `storage_download_unavailable`
  (the more actionable replacement for the legacy
  `no_local_file_and_no_fetchable_url` code).

## Tests added / updated

New: `backend/tests/test_privacy_reference_materialization.py` — 29 cases
covering:

- Production-shaped reference materializes through `s3_key`.
- Local file path preferred when present (no cleanup needed).
- Malformed `file_url` + valid `s3_key` still materializes.
- Missing storage downloader → `storage_download_unavailable`.
- Missing object → `reference_object_not_found`.
- Policy-blocked references rejected.
- Expired / deleted-status references rejected.
- `embedding=[]` + `no_persistent_embedding_saved` does **not** block
  materialization.
- `s3_key` outside `uploads/privacy/` rejected with `reference_policy_blocked`.
- Batch result correctly cleans up temp directory after success AND failure.
- URL fetch disabled by default; enabled requires allow-listed host;
  unlisted host produces `url_fetch_disallowed_host`.
- Verifier passes JPEG and PNG; rejects oversize and non-image payloads.
- `evaluate_materialization_capability` reports the production-fixture
  scenario correctly with and without storage download.

Updated: `backend/tests/test_privacy_reference_usability.py` — adds
`test_local_missing_with_storage_download_makes_s3_ref_usable` and switches
the C9.1 case to the new `storage_download_unavailable` semantic.

Updated: `backend/tests/test_video_upload_processing_pipeline.py` and
`backend/tests/test_tenant_upload_privacy_flow.py` — monkeypatch
`_storage_download_available` to `True` where the fixture explicitly opts
references into "ready" via `s3_key`.

## Commands run / results

```
python -m py_compile server.py
python -m py_compile app/services/storage_urls.py
python -m py_compile app/services/privacy_references.py
python -m py_compile app/services/privacy_reference_materialization.py
python -m py_compile app/services/video_assets.py
python -m py_compile app/services/teacher_lesson_coaching_artifact.py
python -m py_compile app/services/coach_voice_generation.py
python -m py_compile scripts/audit_video_processing_pipeline.py
python -m py_compile scripts/run_pilot_smoke_checks.py
python -m compileall -q app
# all green

python -m pytest backend/tests/test_privacy_reference_materialization.py -q
# 29 passed

python -m pytest backend/tests/  # full backend regression
# 571 passed in 134.99s

cd frontend && npm run build
# Compiled successfully.
```

Targeted regressions also re-confirmed for:
`test_privacy_reference_usability`, `test_video_upload_processing_pipeline`,
`test_video_asset_selection`, `test_storage_url_normalization`,
`test_lesson_moment_evidence_quality`, `test_teacher_lesson_coaching_artifact`,
`test_coach_voice_generation`, `test_teacher_navigation_intelligence`,
`test_admin_workflow_notifications_audit`, `test_tenant_upload_privacy_flow`,
`test_video_pipeline_helpers`, `test_pr26_privacy_controls`,
`test_teacher_artifact_quarantine`.

## Known limitations

- Compression profile is not tuned in C9.2. Production observation that the
  processed asset is *larger* than the input remains a real concern but does
  not block privacy clearance and is deliberately deferred to C10 (the brief
  said to skip unless trivial).
- The privacy worker downloads each reference fresh on every retry attempt
  (no cache). Acceptable for ≤5 references per teacher; revisit when scale
  warrants.
- URL fetch fallback streams via `requests` — synchronous inside a thread.
  Acceptable while it is off by default; if it gets enabled at high volume
  consider an async equivalent.

## Open forensic questions

- Why were the leaked-prefix URLs persisted in the first place? C9.1's
  defensive normalization is the band-aid; the root cause likely lies in a
  Railway/.env paste pattern. We still need to confirm by inspecting the
  next operator-side rotation.
- Whether the worker reliably runs on a single replica that owns the local
  upload dir. The materializer makes this moot for references, but the
  source video is still loaded by local path (`job["file_path"]`). Out of
  scope for C9.2.

## Production rollout / smoke instructions

After deploy, run these manually as the brief specifies:

1. **Failed-post-C9.1 video.**
   ```
   python -m backend.scripts.audit_video_processing_pipeline \
     --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b
   ```
   - Expect `reference_materialization_would_succeed` for the teacher and
     `materialization_possible_but_privacy_failed` for video
     `8c81ff86-c0b0-476e-ad5d-7220803577e9`.
   - Optional confidence check:
     ```
     python -m backend.scripts.audit_video_processing_pipeline \
       --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b \
       --check-materialization
     ```
     Confirms each reference downloads successfully and the temp directory
     is cleaned up.
   - Trigger retry:
     ```
     curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
       https://$API/api/videos/8c81ff86-c0b0-476e-ad5d-7220803577e9/privacy/retry
     ```
   - Expected: privacy no longer fails with
     `remote_only_but_fetch_disabled` / `storage_download_unavailable`;
     either completes or surfaces a real downstream blur/source-video code.

2. **New small upload.** Upload → raw stored → privacy materializes →
   redacted created → teacher playback uses redacted URL → analysis proceeds.

3. **New large upload.** Same flow plus transcode/`pending` decision from
   C9.1; processed asset is created; privacy still uses materialized
   references; redacted asset created; teacher playback redacted.

4. **Teacher readiness.** `GET /api/teachers/me/readiness` should report
   `privacy_reference_images_ready=true`, `privacy_reference_images_usable_count>0`,
   and no mismatch with the smoke check
   `video_pipeline_reference_materialization`.

5. **Safety.**
   - Teacher playback URL never serves raw asset while privacy is
     incomplete.
   - `/tmp/cognivio-privacy-refs-*` directories do not accumulate after
     privacy jobs.
   - No persistent embedding rows have been inserted into
     `teacher_face_references`.

## C10 handoff notes

- **Compression profile**: the current processed output can be larger than
  the input. Pick a smarter MP4 profile (CRF tuning or hand-rolled FFmpeg
  preset) and add a regression that asserts
  `processed_file_size_bytes <= raw_file_size_bytes` for a representative
  fixture.
- **Admin processing diagnostics dashboard**: surface
  `privacy_reference_failure_codes`, `transcode_decision`, and
  `redacted_asset_state` per video for support triage. The audit-script
  data shape is already correct for a dashboard query.
- **Deploy-hook smoke automation**: wire
  `backend/scripts/run_pilot_smoke_checks.py --teacher-id <forensic>` into a
  post-deploy job so the C9.1 + C9.2 invariants are enforced on every push.
- **Large-file direct-to-storage upload**: as recording length grows, server
  ingest becomes the bottleneck. Presigned PUTs would skip the server
  hop entirely; the materializer already accepts the same `s3_key` shape so
  no API change is needed downstream.
- **Final pilot readiness checklist** (one-pager) should be assembled from
  the C7 + C9.1 + C9.2 smoke check codes.

## Whether full CI must still pass

Yes. CI runs the same `tests/` directory I exercised locally (541 → 571
passing). The frontend build is also covered. No CI-specific paths were
modified.

## Safe to merge?

Yes, after CI green. The change is additive (one new service, one extended
config block) and the privacy worker's wiring is guarded by `finally`. The
default value of `PRIVACY_REFERENCE_URL_FETCH_ENABLED` is `False`, so the
URL fallback path stays inert unless the operator explicitly enables it.
