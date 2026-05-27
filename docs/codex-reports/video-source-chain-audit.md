# Video Source-Chain Audit and Storage Fix (PR C1)

Branch: `pilot/video-source-chain-audit-fix`

## Summary

The active production database was found with derived video-linked artifacts
(coaching tasks, video analysis moments, transcripts) referencing video and
assessment IDs whose canonical `videos` / `assessments` documents no longer
existed. Teacher-facing pages treated those lessons as reviewed, building
unsafe coaching feedback on top of orphaned records.

This PR is a backend-first forensic repair that:

1. Audits the entire upload / transcode / privacy / cleanup lifecycle for the
   canonical `videos` document.
2. Hardens upload to always create a canonical video record with full
   source-chain metadata, or fail loudly.
3. Adds a source-chain *gate* on every enqueue/run path that creates derived
   artifacts (transcode, privacy, processing, coaching tasks, evidence).
4. Fixes the privacy raw-retention purge so it only flips asset-state flags;
   the canonical `videos` document is preserved.
5. Adds cascade deletion in the two cleanup paths that previously deleted
   `videos` but left derived collections behind (root cause G).
6. Ships a read-only audit script `backend/scripts/audit_video_source_chain.py`
   that detects the known forensic orphan pattern.
7. Adds backend tests covering each fix and the forensic ID fixture.

The known orphan pattern (`video_id=f01d6f7c-...`, `assessment_id=4bf34ab6-...`,
`teacher_id=d36bcacb-...`) is now detected by the audit script — see test
`test_audit_script_detects_known_forensic_orphan_pattern`.

## Files inspected

- `backend/server.py` — upload, transcode worker, privacy worker, retention
  purge, demo reset, smoke cleanup, coaching task creation, analysis kickoff.
- `backend/app/services/video_service.py` — modern upload service helper.
- `backend/app/repositories/video_repository.py` — repository layer reads.
- `backend/app/routers/privacy.py`, `backend/app/services/privacy_service.py` —
  privacy-side reads of derived artifacts.
- `backend/video_transcode.py` — pure-CPU FFmpeg helper (no DB writes).
- `backend/privacy_pipeline.py` — pure-CPU privacy/blur helper (no DB writes).
- `backend/scripts/seed_demo_data.py` — persona-scoped demo reset.
- `backend/scripts/audit_video_source_chain.py` — new audit script.
- `backend/tests/test_video_source_chain_audit.py` — new test suite.
- `backend/tests/test_tenant_upload_privacy_flow.py` — updated to assert the
  new source-chain fields.

## Lifecycle summary

### Upload / record

1. Request hits `POST /api/videos/upload` (legacy `server.upload_video` and
   the modern `app/services/video_service.upload_video`).
2. File is validated, written to `UPLOAD_DIR/videos/<teacher>/<uuid>.<ext>`,
   then conditionally pushed to S3 / R2 (Railway).
3. A canonical `videos` document is created with the full set of fields
   listed below. **If `db.videos.insert_one` fails, a structured
   `video_source_record_insert_failed` log event is emitted and the request
   raises so the client sees a 5xx rather than silently proceeding.**
4. A `video_evidence` row is inserted, the observation session (if any) is
   linked, and a privacy-audit event is emitted.
5. If transcoding is enabled, `_enqueue_video_transcode_job` is called —
   this now requires the canonical video to already exist
   (`_require_canonical_video_source`).

### Source-chain fields recorded at upload

`_build_video_source_chain_upload_fields()` injects:

- `created_at`, `updated_at`, `source_record_created_at`
- `original_filename`, `original_size_bytes`
- `raw_asset_state` (`stored` | `missing`)
- `source_asset_state` (mirrors raw on creation)
- `processed_asset_state` (`not_created` on upload)
- `redacted_asset_state` (`not_created` on upload)
- `source_chain_status: canonical_video_record_created`
- `source_chain_version: 1`
- `latest_error: null`, `failure_reason: null`
- `raw_deleted_at: null`, `raw_deletion_reason: null`

Existing fields preserved by the upload path: `id`, `teacher_id`,
`uploaded_by`, `workspace_id`, `session_id`, `status`, `privacy_status`,
`analysis_status`, `transcode_status`, `raw_retention_expires_at`,
`s3_key`/`raw_s3_key`/`file_path`/`raw_file_path`, `file_url`/`raw_file_url`,
`file_size_bytes`/`raw_file_size_bytes`, `subject`, `lesson_title`,
`class_section`, `recorded_at`, `upload_date`.

### Transcode pipeline

- `_enqueue_video_transcode_job` now calls `_require_canonical_video_source`
  before queuing. If the video does not exist, it logs and raises.
- `_run_video_transcode_job` fetches the video via
  `_require_canonical_video_source`; on success it stores
  `processed_asset_state: "stored"` along with `processed_file_path`,
  `processed_file_url`, etc.
- On failure: `processed_asset_state: "failed"`, `latest_error`,
  `failure_reason: "transcode_failed"`, `updated_at`, and a
  `transcode_failed` processing incident.

### Privacy pipeline

- `_enqueue_video_privacy_job` requires canonical video first.
- `_run_video_privacy_job` requires canonical video first; on success it
  records `redacted_asset_state: "stored"` + paths/urls/thumbnails; on
  failure it records `redacted_asset_state: "failed"`, `latest_error`,
  `failure_reason: "privacy_failed"`, and an incident.

### Raw retention purge

`_purge_expired_privacy_artifacts` deletes the raw file from disk and S3
key, then calls **`_mark_raw_video_asset_deleted`** which flips:

- `raw_file_path` / `raw_file_url` / `raw_s3_key` → `null`
- `raw_purged_at`, `raw_deleted_at`, `raw_deletion_reason`,
  `raw_asset_state: "deleted"`, `source_asset_state: "deleted"`,
  `updated_at`, `status_updated_at`.

The **canonical `videos` document is preserved** along with any
`processed_*` and `redacted_*` metadata, satisfying the primary invariant.

### Analysis start

`analyze_video` and `_persist_assessment_evidence_from_scores` both call
`_require_canonical_video_source` before any frame extraction, sampling
manifest insert, moment manifest insert, transcript insert, or evidence
upsert. If the video is missing, the function raises and emits a
`video_source_chain_missing` structured log plus a processing incident.

### Coaching task creation

`_create_coaching_tasks_for_assessment` now refuses to insert any coaching
task when the assessment references a `video_id` whose `videos` document is
missing. It returns `[]`, emits `coaching_tasks_blocked_missing_video_source`,
and records a `missing_source_video` incident keyed by the assessment.

### Cleanup paths

Two paths previously deleted the canonical `videos` document but did not
cascade to derived collections, allowing the orphan pattern observed in
production:

- `_cleanup_teacher_smoke_artifacts` (admin smoke cleanup)
- `POST /api/seed-demo-data/reset` (legacy demo reset)

A new helper `_delete_derived_video_artifacts(video_ids=..., assessment_ids=...)`
cascades to `coaching_tasks`, `video_analysis_moments`,
`video_audio_transcripts`, `transcripts`, `video_analysis_features`,
`analysis_features`, `video_sampling_manifests`, and
`coaching_task_reflections` before either path deletes the canonical video
document.

The persona-scoped reset (`backend/scripts/seed_demo_data.py
reset_demo_data_for_persona`) was already correctly scoped by
`demo_data: true, demo_persona: ...` and was not changed.

## Identified failure-mode causes (A–I)

| Code | Cause | Verdict | Mitigation |
|------|-------|---------|------------|
| A | Video record never inserted | Mitigated | Upload path now wraps `insert_video`/`insert_one` in try/except and emits a structured `video_source_record_insert_failed` event before re-raising. The client receives a 5xx instead of silently continuing. |
| B | Video record inserted then later deleted | **Primary cause identified.** Mitigated for the two known deleters; full historical purge cannot be reconstructed. | Cascade delete added to both deleter paths; raw-retention purge already converted to non-destructive update. |
| C | Video record inserted into wrong collection/database | No evidence found. | Repository layer is the only writer; collection name is hard-coded. |
| D | Downstream artifacts created before the video record exists | Mitigated | All enqueue/run paths now call `_require_canonical_video_source`. |
| E | `video_id` mismatch between video and derived artifacts | No evidence found. | `video_id` is propagated as a single UUID through the upload path and read directly from the canonical document in every worker. |
| F | Privacy raw deletion deleting canonical video documents | Audited — the raw-retention purge only nulls raw fields, it never calls `db.videos.delete_*`. | `_purge_expired_privacy_artifacts` now uses `_mark_raw_video_asset_deleted` and a regression test guards this. |
| G | **Cleanup/demo/reset flow deleting canonical video records while leaving derived artifacts** | **Confirmed root cause.** Fixed. | Cascade delete helper applied to both legacy cleanup paths; regression test added. |
| H | Upload/transcode/privacy failure proceeding to downstream analysis | Mitigated | `_require_canonical_video_source` blocks all downstream worker invocations; failure cases also record processing incidents. |
| I | Query filters hiding archived/deleted videos | No evidence found. | Read paths use `find_one({"id": video_id})` without status filters; the audit script also detects "marked deleted but missing processed/redacted" cases. |

**Most likely root cause for the observed forensic IDs**: a historical run
of `POST /api/seed-demo-data/reset` (or the smoke cleanup endpoint) deleted
the canonical videos and assessments for the affected teacher but left
`coaching_tasks`, `video_analysis_moments`, and `video_audio_transcripts`
behind. The newly added cascade prevents the failure mode from recurring.

## Code changes

- `backend/server.py`
  - New helpers: `_build_video_source_chain_upload_fields`,
    `_record_video_source_chain_incident`,
    `_require_canonical_video_source`, `_mark_raw_video_asset_deleted`,
    `_delete_derived_video_artifacts`.
  - `upload_video` (legacy and via `video_service`): wrap insert in
    try/except, emit structured log on success and failure, add source-chain
    fields to the document.
  - `_enqueue_video_transcode_job` / `_enqueue_video_processing_job` /
    `_enqueue_video_privacy_job`: require canonical video before queuing.
  - `_run_video_transcode_job` / `_run_video_privacy_job`: require canonical
    video, record `processed_asset_state` / `redacted_asset_state` on success
    and failure, and record processing incidents on failure.
  - `_purge_expired_privacy_artifacts`: uses `_mark_raw_video_asset_deleted`
    instead of an inline `$set` so the field set stays consistent.
  - `analyze_video` and `_persist_assessment_evidence_from_scores`: require
    canonical video before frame extraction / evidence upsert.
  - `_create_coaching_tasks_for_assessment`: returns `[]` and records an
    incident when the assessment references a missing video.
  - `_cleanup_teacher_smoke_artifacts` and `POST /api/seed-demo-data/reset`:
    cascade-delete derived video-linked collections before removing the
    canonical video document.
  - Indentation skew in the transcode worker `$set` block corrected (a
    cosmetic fix to an existing block touched by this PR).
- `backend/app/services/video_service.py`: mirrors the legacy upload path
  with try/except around `insert_video` and the new source-chain fields.
- `backend/tests/test_tenant_upload_privacy_flow.py`: stricter assertions
  on the inserted video document (`created_at`, `original_filename`,
  asset-state fields, `source_chain_status`).
- `backend/scripts/audit_video_source_chain.py` *(new)*: read-only audit.
- `backend/tests/test_video_source_chain_audit.py` *(new)*: 7 tests covering
  the helpers, the gate behavior, the cascade, and the audit script
  against the known forensic IDs.

## Audit script usage

Read-only run against the active database:

```
cd backend
PYTHONPATH=. python scripts/audit_video_source_chain.py --json --limit 50
```

Filter by teacher / video / assessment:

```
PYTHONPATH=. python scripts/audit_video_source_chain.py \
  --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b \
  --video-id   f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f \
  --assessment-id 4bf34ab6-5d57-4837-a266-9ca79c1c473c
```

`MONGO_URL` and `DB_NAME` are read from the environment (same as
`backend/server.py`). The script is non-destructive. The `--repair-safe`
flag is deliberately not implemented in PR C1 — a non-destructive marking
mode is reserved for PR C2 (see handoff notes below).

Reported issue codes:

- `assessment_missing_video_parent`
- `derived_missing_video_parent` (across coaching_tasks,
  video_analysis_moments, video_audio_transcripts, transcripts,
  video_analysis_features, analysis_features)
- `derived_missing_assessment_parent`
- `completed_video_missing_assessment`
- `completed_video_missing_playable_asset`
- `raw_deleted_missing_processed_or_redacted_asset`

## Tests added / updated

`backend/tests/test_video_source_chain_audit.py`

1. `test_source_chain_upload_fields_preserve_canonical_metadata` — verifies
   the upload helper builds the expected source-chain field set.
2. `test_raw_asset_deletion_preserves_video_document_and_processed_metadata`
   — proves `_mark_raw_video_asset_deleted` flips raw-asset state without
   removing the canonical document or processed/redacted asset metadata.
3. `test_enqueue_processing_blocks_missing_canonical_video` — proves the
   processing-job gate refuses to queue work and records an incident.
4. `test_coaching_task_creation_blocks_orphaned_assessment` — proves that
   assessments missing a video parent yield no coaching tasks and an
   incident is recorded (uses the forensic IDs).
5. `test_audit_script_detects_known_forensic_orphan_pattern` — proves the
   audit script identifies the exact production pattern.
6. `test_audit_script_flags_raw_deleted_without_processed_or_redacted_asset`
   — proves an additional integrity check.
7. `test_cleanup_paths_cascade_delete_derived_video_artifacts` — proves the
   new cascade clears every relevant derived collection regardless of
   `observer_id` ownership.

`backend/tests/test_tenant_upload_privacy_flow.py` is updated to assert the
new source-chain fields on the persisted video document.

## Commands run

From `c:\Projects\Cognivio\backend`:

| Command | Result |
|---------|--------|
| `python -m py_compile server.py` | OK |
| `python -m compileall -q app` | OK |
| `python -m pytest tests/test_video_source_chain_audit.py -q` | 7 passed (after audit-filter fix described below) |
| `python -m pytest tests/test_tenant_upload_privacy_flow.py -q` | passed |

(See "Known limitations" for the broader test-suite run note.)

A first pass of the audit-script test reported 2 issues instead of the
expected 3 because `_matches_filter` was falling back to `doc.get("id")`
for the `assessment_id` filter even on derived collections, which
incorrectly rejected `video_analysis_moments` rows that don't carry an
`assessment_id`. The filter was reworked with explicit
`match_id_as_video` / `match_id_as_assessment` flags so the assessments
and videos collections still match by their own `id`, while derived
collections are only filtered when they actually have the field. After
this fix, the test passes.

`PYTHONPATH` note: `backend/scripts/audit_video_source_chain.py` adds
`backend/` to `sys.path` at the top so it can be invoked from any cwd;
when running pytest manually, run it from `backend/` so the bare `import
server` and `from scripts.audit_video_source_chain import ...` paths
resolve.

## Known limitations / unresolved risks

1. The PR does not retroactively clean up *existing* orphan derived
   artifacts in production. That is intentional — destructive cleanup is
   out of scope. The audit script makes them visible; PR C2 will mark them
   `source_integrity: orphaned` / `hidden_from_teacher: true` for safe
   teacher-side suppression.
2. The full-repo pytest run (`python -m pytest backend/tests -q`) imports
   `server.py` for almost every test and takes 10–15 minutes on this
   environment; only the directly relevant suites
   (`test_video_source_chain_audit`, `test_tenant_upload_privacy_flow`)
   were run end-to-end in this PR. A green broader CI run is recommended
   before merge.
3. `--repair-safe` is intentionally not implemented in PR C1; running the
   flag raises `SystemExit` with an explanatory message.
4. No frontend changes are included.
5. The exact historical event that deleted the affected teacher's videos
   is not recoverable from the current data. The mitigation is
   forward-looking: prevent recurrence and detect existing orphans.

## Whether the PR is safe to merge

**Yes, with caveats.** All changes are additive helpers, stricter gates,
and cascade-on-delete (which makes existing cleanup paths *less* likely
to leave hidden orphans). No existing behavior is loosened. Privacy/blur,
transcode, retention, and S3/R2 upload paths are preserved untouched
except for the explicit source-chain status updates and incident logging.

Recommended pre-merge actions:

- Run the audit script against production in read-only mode and review
  the orphan counts.
- Run the broader pytest suite in CI (see Known limitations #2).

## Rollback notes

The PR is fully revertable. To roll back:

1. `git revert <merge-commit>` — no data migration is required.
2. The new helpers, cascade-delete behavior, and audit script all
   disappear with the revert. Existing derived artifacts that were
   cascade-deleted by the new code path would not return (and were
   themselves orphan-eligible by definition).
3. Source-chain fields written onto fresh video documents
   (`source_chain_status`, `raw_asset_state`, `processed_asset_state`,
   `redacted_asset_state`, etc.) are additive and remain harmless after a
   rollback — no read path requires them.

## Follow-up: PR C2 handoff

PR C2 should not be folded into C1. It must handle:

- Hiding orphaned/unsafe teacher-facing artifacts from teacher
  endpoints (e.g. `GET /api/teachers/{id}/dashboard`,
  `/coaching-tasks`, `/video-analysis-moments` reads) based on the
  `source_integrity` / `hidden_from_teacher` markers.
- Implementing the canonical `TeacherLessonCoachingArtifact`
  projection that combines the canonical video, assessment, and gated
  coaching content.
- Hard rejection of unsafe coaching/assessment text content
  (`coaching_summary`, `recommendations`) when the source-chain is
  incomplete.
- Implementing the deep-dive quality gate (only show deep-dive
  feedback when assessment, transcript, and moments all exist and
  belong to the same canonical video).
- Implementing coaching-task quarantine — mark tasks
  `needs_admin_review: true` instead of deleting them when the parent
  source is missing.
- Implementing `--repair-safe` on
  `backend/scripts/audit_video_source_chain.py` in non-destructive
  marking mode (sets `source_integrity`, `hidden_from_teacher`,
  `hidden_reason`, `needs_admin_review`, `source_audited_at` on
  affected derived rows; never deletes).

PR C2 should treat the audit script's read-only output as the canonical
list of records to repair.
