# Cognivio Video Transcode Implementation Tickets

Date: 2026-04-12  
Companion docs:

- `docs/VIDEO_TRANSCODE_IMPLEMENTATION_PLAN_2026-04-12.md`

Purpose:  
Translate the video transcode/storage optimization plan into sprint-ready implementation tickets that reduce storage cost, preserve simple upload UX, and keep the media pipeline scalable.

## 1. Ticket Status Model

Use one of these labels:

- `ready`: can enter sprint planning immediately
- `next`: should start after upstream dependencies are complete
- `later`: valid roadmap work, but not yet ready to schedule
- `spike`: discovery or validation required before implementation

## 2. Priority Model

- `P0`: critical to pilot-safe media handling and scale readiness
- `P1`: important follow-on work that materially improves performance or reliability
- `P2`: optimization or polish after the new asset model is stable

## 3. Ownership Model

Use these shorthand owners:

- `BE`: backend
- `FE`: frontend
- `PLAT`: storage / queue / ops / infra
- `UX`: product / UX

## 4. Sprint Model

Suggested sprint windows for this work:

- `Sprint VT1`: data model and queue foundation
- `Sprint VT2`: raw upload refactor
- `Sprint VT3`: transcode worker
- `Sprint VT4`: privacy / analysis / playback rewiring
- `Sprint VT5`: retention, cleanup, and observability
- `Sprint VT6`: UX polish and scale hardening

## 5. Phase 1 Tickets: Data Model and Queue Foundation

## VT-001 Video Asset Model Expansion

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: none
- Target sprint window: `Sprint VT1`
- Rollout flag: `video_transcode_pipeline`
- Goal: make raw and processed media assets first-class objects in the `videos` document.
- Scope:
  - add fields for raw asset metadata
  - add fields for processed asset metadata
  - add transcode status and timestamps
  - preserve backward compatibility for existing videos
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
  - `backend/app/repositories/video_repository.py`
- Acceptance criteria:
  - new uploads can store raw and processed asset fields distinctly
  - existing reads do not break for videos without processed assets
  - transcode status can be queried independently from privacy and analysis status

## VT-002 Transcode Status Normalization Helpers

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `VT-001`
- Target sprint window: `Sprint VT1`
- Rollout flag: `video_transcode_pipeline`
- Goal: normalize transcode lifecycle handling the same way Cognivio already normalizes privacy and analysis state.
- Scope:
  - add status normalization helpers
  - add terminal/non-terminal transcode state helpers
  - add default response application logic
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
- Acceptance criteria:
  - invalid or missing transcode states are normalized safely
  - video responses expose consistent transcode state
  - state handling is reusable across API and worker paths

## VT-003 R2 Media Key Strategy

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-001`
- Target sprint window: `Sprint VT1`
- Rollout flag: `video_transcode_pipeline`
- Goal: separate raw, processed, and derivative media assets into explicit storage prefixes.
- Scope:
  - create helpers for raw keys
  - create helpers for processed keys
  - create helpers for future derivative keys
- Repo touchpoints:
  - `backend/server.py`
- Acceptance criteria:
  - raw uploads land under `uploads/videos/raw/...`
  - processed masters land under `uploads/videos/processed/...`
  - thumbnails remain clearly separated

## VT-004 Video Transcode Job Contract

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-001`, `VT-002`, `VT-003`
- Target sprint window: `Sprint VT1`
- Rollout flag: `video_transcode_pipeline`
- Goal: create a dedicated queue contract for transcode work instead of overloading privacy/analysis processing.
- Scope:
  - define `video_transcode_jobs` schema or equivalent queue payload
  - include video ID, teacher ID, source asset reference, status, attempt count, timestamps, and requested profile
  - add enqueue helper
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
- Acceptance criteria:
  - each new upload can enqueue a transcode job
  - job payload is sufficient to run transcode without reading request context
  - retries are represented cleanly

## VT-005 Transcode Metrics Foundation

- Status: `next`
- Priority: `P1`
- Owners: `PLAT`, `BE`
- Depends on: `VT-004`
- Target sprint window: `Sprint VT1`
- Rollout flag: `video_transcode_metrics`
- Goal: measure media optimization cost and effectiveness from day one.
- Scope:
  - add counters for queued, succeeded, failed jobs
  - add duration tracking
  - add compression ratio tracking
- Repo touchpoints:
  - `backend/app/metrics.py`
  - `backend/server.py`
  - `docs/METRICS_CONTRACT.md`
- Acceptance criteria:
  - transcode metrics appear in backend observability
  - success/failure counts are queryable
  - size reduction can be calculated per job

## 6. Phase 2 Tickets: Raw Upload Refactor

## VT-006 Raw Upload Storage Refactor

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-001`, `VT-003`, `VT-004`
- Target sprint window: `Sprint VT2`
- Rollout flag: `video_transcode_pipeline`
- Goal: make raw upload the explicit first stage of the pipeline rather than the implicit canonical asset.
- Scope:
  - upload raw file to raw namespace in R2
  - retain raw metadata in the `video` record
  - keep temporary local staging only as a short-lived implementation detail
- Repo touchpoints:
  - `backend/app/services/video_service.py`
  - `backend/server.py`
- Acceptance criteria:
  - raw uploads are stored under raw R2 keys
  - `video` records clearly identify raw assets
  - upload response contract remains compatible for the frontend

## VT-007 Upload-to-Queue Handoff

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `VT-006`
- Target sprint window: `Sprint VT2`
- Rollout flag: `video_transcode_pipeline`
- Goal: enqueue transcode immediately after raw upload succeeds.
- Scope:
  - set `transcode_status=queued`
  - enqueue transcode job after DB write succeeds
  - fail safely if enqueueing breaks
- Repo touchpoints:
  - `backend/app/services/video_service.py`
  - `backend/server.py`
- Acceptance criteria:
  - newly uploaded videos enter the transcode queue automatically
  - queue failure does not silently mark a video as processed
  - raw asset remains available if queueing fails

## VT-008 Raw Upload Metadata and Retention Fields

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `VT-006`
- Target sprint window: `Sprint VT2`
- Rollout flag: `video_transcode_pipeline`
- Goal: make raw retention safe and observable.
- Scope:
  - store raw size bytes
  - store raw retention expiry
  - store source content type and original extension
- Repo touchpoints:
  - `backend/app/services/video_service.py`
  - `backend/server.py`
- Acceptance criteria:
  - raw asset lifecycle is represented in the DB
  - cleanup jobs can make deletion decisions without guessing
  - admin raw-access flow still works

## 7. Phase 3 Tickets: Transcode Worker

## VT-009 FFmpeg Transcode Service

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-004`, `VT-006`, `VT-007`
- Target sprint window: `Sprint VT3`
- Rollout flag: `video_transcode_pipeline`
- Goal: create a reusable service that converts raw uploads into Cognivio’s processed analysis master.
- Scope:
  - pull raw source
  - transcode to MP4/H.264/AAC
  - cap height at `720`
  - apply `+faststart`
  - return output metadata
- Repo touchpoints:
  - `backend/audio_pipeline.py`
  - `backend/server.py`
  - new media/transcode helper module if needed
- Acceptance criteria:
  - transcode succeeds on supported classroom video formats
  - processed output is materially smaller than raw in typical cases
  - errors are surfaced clearly when FFmpeg fails

## VT-010 Processed Asset Upload and Persistence

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-009`
- Target sprint window: `Sprint VT3`
- Rollout flag: `video_transcode_pipeline`
- Goal: upload the processed master to R2 and persist it as the canonical working asset.
- Scope:
  - write processed asset to `uploads/videos/processed/...`
  - save processed URL, key, size, and content type
  - update transcode timestamps and status
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
- Acceptance criteria:
  - successful transcodes populate processed asset fields
  - `transcode_status=completed` only when upload and metadata update both succeed
  - failed uploads leave raw intact

## VT-011 Transcode Failure and Retry Handling

- Status: `next`
- Priority: `P1`
- Owners: `BE`, `PLAT`
- Depends on: `VT-009`, `VT-010`
- Target sprint window: `Sprint VT3`
- Rollout flag: `video_transcode_pipeline`
- Goal: make transcode errors recoverable and observable.
- Scope:
  - persist failure reason
  - increment attempt count
  - allow internal retry path
  - ensure raw fallback remains preserved
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
- Acceptance criteria:
  - failed transcodes are visible in DB and ops
  - retriable failures can be rerun without re-upload
  - raw originals are not deleted on failure

## 8. Phase 4 Tickets: Privacy, Analysis, and Playback Rewiring

## VT-012 Processed-First Privacy Pipeline

- Status: `next`
- Priority: `P0`
- Owners: `BE`
- Depends on: `VT-010`
- Target sprint window: `Sprint VT4`
- Rollout flag: `processed_asset_privacy_pipeline`
- Goal: run privacy processing from the processed master instead of the raw upload.
- Scope:
  - change privacy job input selection
  - keep explicit raw fallback only if processed asset is unavailable
- Repo touchpoints:
  - `backend/server.py`
  - privacy pipeline helpers
- Acceptance criteria:
  - privacy runs on processed assets when available
  - raw fallback is exceptional, not default
  - privacy output contract stays stable

## VT-013 Processed-First Analysis Pipeline

- Status: `next`
- Priority: `P0`
- Owners: `BE`
- Depends on: `VT-010`, `VT-012`
- Target sprint window: `Sprint VT4`
- Rollout flag: `processed_asset_analysis_pipeline`
- Goal: make processed video the canonical input for audio extraction and lesson analysis.
- Scope:
  - point audio extraction to processed asset
  - point multimodal analysis to processed asset
  - preserve raw fallback only for recovery
- Repo touchpoints:
  - `backend/audio_pipeline.py`
  - `backend/server.py`
- Acceptance criteria:
  - analysis runs from processed media by default
  - output quality remains stable
  - pipeline no longer assumes raw upload is the working asset

## VT-014 Processed-First Playback Resolution

- Status: `next`
- Priority: `P0`
- Owners: `BE`, `FE`
- Depends on: `VT-010`
- Target sprint window: `Sprint VT4`
- Rollout flag: `processed_asset_playback`
- Goal: serve playback from the processed master for standard use.
- Scope:
  - update video playback URL resolution helpers
  - keep raw access admin-only
  - preserve backward compatibility for old videos
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/video_service.py`
  - `frontend/src/pages/VideoPlayerPage.js`
- Acceptance criteria:
  - standard playback uses processed media when present
  - old videos without processed assets still load
  - raw access remains a controlled admin-only path

## 9. Phase 5 Tickets: Retention, Cleanup, and Observability

## VT-015 Raw Retention Cleanup Job

- Status: `next`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `VT-010`, `VT-012`, `VT-013`
- Target sprint window: `Sprint VT5`
- Rollout flag: `raw_video_retention_cleanup`
- Goal: stop raw originals from accumulating indefinitely once Cognivio can rely on processed masters.
- Scope:
  - delete raw asset only after processed pipeline success and retention expiry
  - protect videos still in failed or uncertain states
  - log cleanup actions
- Repo touchpoints:
  - `backend/server.py`
  - maintenance / cleanup jobs
- Acceptance criteria:
  - eligible raw originals are cleaned up automatically
  - processed masters are preserved
  - cleanup is safe and auditable

## VT-016 Transcode Ops Visibility

- Status: `next`
- Priority: `P1`
- Owners: `PLAT`, `FE`
- Depends on: `VT-005`, `VT-011`, `VT-015`
- Target sprint window: `Sprint VT5`
- Rollout flag: `transcode_ops_visibility`
- Goal: give the team a clear operational view of optimization health.
- Scope:
  - queue backlog
  - average transcode duration
  - compression ratio
  - failure reasons
- Repo touchpoints:
  - `backend/server.py`
  - `frontend/src/pages/OpsMetricsPage.js`
- Acceptance criteria:
  - ops can see transcode throughput and failures
  - compression savings are measurable
  - media pipeline problems are easier to triage

## VT-017 Storage Runtime Health Surface

- Status: `next`
- Priority: `P1`
- Owners: `PLAT`, `BE`
- Depends on: `VT-015`
- Target sprint window: `Sprint VT5`
- Rollout flag: `transcode_storage_health`
- Goal: extend runtime health to include processed/raw media pipeline status.
- Scope:
  - surface whether processed-first mode is active
  - expose raw cleanup lag
  - expose transcode backlog snapshot
- Repo touchpoints:
  - `backend/server.py`
  - `docs/OPERATIONS_RUNBOOK.md`
- Acceptance criteria:
  - storage/media health is visible without digging through logs
  - production readiness is easier to assess

## 10. Phase 6 Tickets: UX and Scale Hardening

## VT-018 Upload Status UX Pass

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `VT-010`, `VT-012`, `VT-013`
- Target sprint window: `Sprint VT6`
- Rollout flag: `upload_status_optimization_labels`
- Goal: show user-friendly media lifecycle states without exposing infrastructure complexity.
- Scope:
  - add `Optimizing video` stage
  - distinguish upload, privacy, and analysis states more clearly
  - keep wording simple for low-tech users
- Repo touchpoints:
  - `frontend/src/pages/VideosPage.js`
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - users understand that upload is progressing after transfer completes
  - no technical FFmpeg/storage jargon appears in core UX

## VT-019 Playback Proxy Spike

- Status: `spike`
- Priority: `P2`
- Owners: `BE`, `PLAT`, `FE`
- Depends on: `VT-014`
- Target sprint window: `Sprint VT6`
- Rollout flag: `playback_proxy_variant`
- Goal: assess whether Cognivio should add a lower-bitrate playback proxy in addition to the processed master.
- Scope:
  - test a second derivative
  - compare playback speed and storage impact
  - decide whether the extra complexity is justified
- Repo touchpoints:
  - media pipeline modules
  - `frontend/src/pages/VideoPlayerPage.js`
- Acceptance criteria:
  - team has a documented decision on whether to add a playback proxy
  - no production behavior changes until decision is made

## VT-020 Direct-to-R2 Upload Spike

- Status: `later`
- Priority: `P2`
- Owners: `PLAT`, `BE`, `FE`
- Depends on: `VT-006` through `VT-015`
- Target sprint window: `Sprint VT6`
- Rollout flag: `direct_to_r2_uploads`
- Goal: evaluate whether pre-signed direct uploads should replace backend-mediated upload transfer at higher scale.
- Scope:
  - analyze complexity tradeoffs
  - define security model
  - estimate performance benefit
- Repo touchpoints:
  - upload endpoints
  - frontend upload clients
- Acceptance criteria:
  - decision memo exists
  - no premature architectural complexity is introduced before needed

## 11. Recommended Execution Order

Implement in this order:

1. `VT-001 Video Asset Model Expansion`
2. `VT-002 Transcode Status Normalization Helpers`
3. `VT-003 R2 Media Key Strategy`
4. `VT-004 Video Transcode Job Contract`
5. `VT-006 Raw Upload Storage Refactor`
6. `VT-007 Upload-to-Queue Handoff`
7. `VT-008 Raw Upload Metadata and Retention Fields`
8. `VT-009 FFmpeg Transcode Service`
9. `VT-010 Processed Asset Upload and Persistence`
10. `VT-012 Processed-First Privacy Pipeline`
11. `VT-013 Processed-First Analysis Pipeline`
12. `VT-014 Processed-First Playback Resolution`
13. `VT-011 Transcode Failure and Retry Handling`
14. `VT-015 Raw Retention Cleanup Job`
15. `VT-005 Transcode Metrics Foundation`
16. `VT-016 Transcode Ops Visibility`
17. `VT-017 Storage Runtime Health Surface`
18. `VT-018 Upload Status UX Pass`
19. `VT-019 Playback Proxy Spike`
20. `VT-020 Direct-to-R2 Upload Spike`

## 12. Immediate Ready Queue

These tickets are ready to execute now:

- `VT-001`
- `VT-002`
- `VT-003`
- `VT-004`
- `VT-006`
- `VT-007`
- `VT-008`
- `VT-009`
- `VT-010`

That set is the smallest useful end-to-end implementation slice for Cognivio’s new media pipeline.
