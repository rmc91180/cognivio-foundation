# Cognivio Video Transcode Implementation Plan

## Goal

Reduce video storage and playback cost without adding friction for teachers or admins.

The right solution for Cognivio is:

- do not ask users to zip files
- do not make users compress files manually
- do not rely on browser-side compression as the primary path
- upload once
- transcode automatically in the background
- run privacy, playback, and analysis on a normalized processed video
- keep raw originals only temporarily

## Current State

Today the upload path is straightforward but expensive:

- the frontend sends the raw file with `multipart/form-data`
- the backend writes the raw upload locally first
- the backend uploads that same raw file to object storage
- the raw upload is then used as the working source for downstream processing
- Cognivio already stores raw-retention metadata
- Cognivio already has FFmpeg available in the backend runtime for audio extraction

Relevant current code paths:

- upload path: [video_service.py](c:\Projects\Cognivio\backend\app\services\video_service.py)
- storage helpers: [server.py](c:\Projects\Cognivio\backend\server.py)
- audio/FFmpeg foundation: [audio_pipeline.py](c:\Projects\Cognivio\backend\audio_pipeline.py)

## Recommended Architecture

### Canonical asset model

Each uploaded lesson should have three possible media assets:

1. Raw original
- exact user upload
- retained only temporarily
- admin-access only if needed for recovery/debug

2. Processed analysis master
- normalized MP4
- H.264 video
- AAC audio
- this becomes the canonical working asset for privacy, playback, and analysis

3. Optional playback proxy
- lower bitrate derivative for very fast playback
- defer this until needed

For pilot launch and early scale, Cognivio should implement only:

- raw original
- processed analysis master

The playback proxy can remain a Phase 2 optimization.

## Target Transcode Settings

The default processed master should be:

- container: `mp4`
- video codec: `libx264`
- audio codec: `aac`
- preset: `veryfast` or `faster`
- CRF: `27`
- max height: `720`
- audio bitrate: `128k`
- flags: `-movflags +faststart`

Why this default:

- strong storage reduction
- very good enough quality for classroom observation
- compatible across browsers
- good playback behavior for web delivery
- stable input for privacy and analysis pipelines

## Product Behavior

### User-facing behavior

The upload experience should stay simple:

1. User selects a file
2. Upload begins immediately
3. Cognivio shows:
   - `Uploading`
   - `Optimizing video`
   - `Running privacy checks`
   - `Analyzing lesson`
4. User does not need to understand transcoding

### Important product rule

Compression should be invisible by default.

Do not present this as:

- “zip your video”
- “compress before upload”
- “choose compression quality”

This is Cognivio infrastructure, not user work.

## Why Server-Side Transcoding Is Best

### Pros

- consistent output quality
- one normalized input for downstream AI and privacy logic
- easier support and debugging
- lower storage cost
- better playback reliability
- no extra burden on low-tech users
- easiest path to later queue-based scale

### Cons

- adds processing time after upload
- needs FFmpeg in production worker/runtime
- needs storage lifecycle management

These are acceptable and much cleaner than making teachers manage compression themselves.

## Why Browser-Side Compression Should Not Be Primary

### Pros

- can reduce upload bandwidth before the file reaches Cognivio

### Cons

- unreliable across browsers/devices
- expensive on weak laptops
- increases UX complexity
- harder to debug
- can fail before upload starts
- makes support harder during pilot

Recommendation:

- do not use browser-side compression as the main pipeline
- optionally revisit later as an advanced optimization for very large uploads

## Recommended Data Model Changes

Extend the `videos` document with explicit asset fields:

- `raw_s3_key`
- `raw_file_url`
- `raw_file_size_bytes`
- `processed_s3_key`
- `processed_file_url`
- `processed_file_size_bytes`
- `processed_content_type`
- `transcode_status`
- `transcode_error`
- `transcode_started_at`
- `transcode_completed_at`
- `transcode_failed_at`
- `transcode_profile`
- `processing_asset_preference`

Recommended `transcode_status` values:

- `queued`
- `processing`
- `completed`
- `failed`
- `not_required`

Recommended `processing_asset_preference`:

- `processed` once transcode succeeds
- `raw` only as temporary fallback

## Target Pipeline

### New flow

1. Upload raw file
- save locally to temp workspace
- upload raw original to R2 under a raw namespace
- create `video` record with `transcode_status=queued`

2. Enqueue transcode job
- separate from privacy queue
- include `video_id`, `teacher_id`, asset source path/url, and target transcode profile

3. Run transcode worker
- pull raw asset
- transcode to processed MP4 master
- upload processed file to R2
- update `video` record with processed fields

4. Enqueue privacy/analysis from processed asset
- privacy runs on processed master
- audio extraction runs from processed master
- multimodal analysis runs from processed master

5. Retain raw temporarily
- keep raw for recovery/debug during retention window
- delete raw automatically after successful completion and retention expiry

## Storage Layout

Use explicit R2 prefixes:

- `uploads/videos/raw/<teacher_id>/<video_id>.<ext>`
- `uploads/videos/processed/<teacher_id>/<video_id>.mp4`
- `uploads/videos/thumbnails/<teacher_id>/<video_id>.jpg`

This keeps raw and processed assets separate and makes cleanup safer.

## Implementation Phases

## Phase 1: Foundation

Goal:

- make transcoding a first-class pipeline stage

Work:

1. Add transcode fields to the `videos` model handling
2. Add transcode status normalization helpers
3. Add R2 key-building helpers for raw vs processed
4. Add a transcode job queue collection or queue contract
5. Add metrics for:
   - transcode queued
   - transcode succeeded
   - transcode failed
   - input size
   - output size
   - size reduction ratio

Deliverable:

- pipeline can represent raw and processed assets distinctly

## Phase 2: Raw Upload Refactor

Goal:

- make uploads land as raw originals, not implicit canonical assets

Work:

1. Refactor upload path in [video_service.py](c:\Projects\Cognivio\backend\app\services\video_service.py)
2. Upload raw file to `uploads/videos/raw/...`
3. Save raw-only fields in the `video` record
4. Set:
   - `status=queued`
   - `transcode_status=queued`
   - `analysis_status=queued`
   - `privacy_status=queued`
5. Return a clean response to frontend unchanged from a user perspective

Deliverable:

- raw uploads are explicitly tracked

## Phase 3: Transcode Worker

Goal:

- generate a normalized processed master automatically

Work:

1. Add a new FFmpeg transcode function
2. Use a temp working directory
3. Transcode to:
   - MP4
   - H.264
   - AAC
   - 720p cap
   - faststart enabled
4. Upload processed master to R2
5. Update video fields and transcode timestamps
6. On failure:
   - mark `transcode_status=failed`
   - retain raw asset
   - preserve useful error text

Deliverable:

- Cognivio automatically creates a smaller standardized working video

## Phase 4: Pipeline Rewire

Goal:

- run all downstream work from the processed master

Work:

1. Change privacy pipeline input to processed file
2. Change audio extraction input to processed file
3. Change video playback resolution helpers to prefer processed file
4. Keep raw access admin-only
5. Use raw only as explicit fallback if transcode failed

Deliverable:

- one canonical asset for privacy, playback, and analysis

## Phase 5: Retention and Cleanup

Goal:

- remove unnecessary raw storage safely

Work:

1. Add cleanup job for expired raw assets
2. Delete raw only when:
   - transcode completed
   - privacy is not in a dangerous partial state
   - retention window expired
3. Log deletions to audit/ops
4. Preserve processed asset

Deliverable:

- raw storage stops accumulating indefinitely

## Phase 6: UX and Ops

Goal:

- make the pipeline understandable without becoming noisy

Work:

1. Add upload status labels for:
   - uploading
   - optimizing
   - privacy processing
   - analysis processing
2. Add ops metrics:
   - transcode queue backlog
   - average transcode duration
   - average compression ratio
   - transcode failure reasons
3. Add admin-only runtime visibility into raw/processed storage health

Deliverable:

- better operational confidence and cleaner user communication

## Scale Strategy

### Pilot / low activity

- run transcoding in the current backend worker/runtime
- single processed master only
- no streaming proxy yet

### Growth stage

- move transcode work to dedicated workers
- isolate FFmpeg jobs from request-serving runtime
- add playback proxy if needed
- consider thumbnail/storyboard improvements separately

### Higher scale

- split upload ingestion from media processing
- use queue-backed media workers with concurrency controls
- optionally pre-signed direct-to-R2 uploads

## Recommended Queue Strategy

Create a distinct queue from privacy/analysis:

- `video_transcode_jobs`

Each job should include:

- `video_id`
- `teacher_id`
- `raw_s3_key`
- `source_content_type`
- `requested_profile`
- `attempt_count`
- `status`
- `error`
- `queued_at`
- `started_at`
- `completed_at`

This avoids overloading the privacy queue and keeps responsibilities clean.

## Failure Handling

If transcode fails:

- preserve raw original
- mark the video for admin retry
- surface a clear internal error
- do not delete raw

Fallback behavior:

- if absolutely necessary, allow privacy/analysis on raw only as an explicit emergency fallback
- do not make raw fallback the default path

## Recommended Rollout Sequence

1. Ship data model + queue plumbing
2. Ship transcode worker behind a feature flag
3. Run on selected internal uploads only
4. Validate:
   - compression ratios
   - privacy stability
   - analysis quality
   - playback compatibility
5. Turn on for all new uploads
6. Backfill older videos only if needed later

## Success Criteria

The implementation is successful when:

- new uploads automatically produce a processed master
- playback works from processed assets
- privacy and analysis run from processed assets
- raw originals no longer accumulate indefinitely
- average stored size per video drops materially
- user workflow stays unchanged except for a brief `optimizing` status

## Recommended Next Engineering Slice

The best next implementation slice is:

1. Phase 1 foundation
2. Phase 2 raw upload refactor
3. Phase 3 transcode worker

That is the smallest useful end-to-end cut.

## Final Recommendation

For Cognivio, the cleanest and most scalable path is:

- automatic server-side transcoding after upload
- processed MP4 as the canonical working asset
- temporary raw retention only
- no user-managed compression
- no zip workflow

This keeps the UX simple today and gives the platform a much cleaner storage and media-processing foundation as pilot usage grows.
