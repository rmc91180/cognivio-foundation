# Configuration Matrix

This document is the source of truth for active Cognivio runtime configuration.

## Active Stack

- Backend: [backend](C:/Projects/Cognivio/backend)
- Frontend: [frontend](C:/Projects/Cognivio/frontend)
- Primary data store: MongoDB
- Archived legacy stacks: [archive](C:/Projects/Cognivio/archive)

## Backend Required

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `MONGO_URL` | Yes | MongoDB connection string | Backend will not boot without it |
| `JWT_SECRET` | Yes | Auth token signing | Rotate carefully |
| `JWT_ALGORITHM` | Yes | JWT algorithm | Current default is `HS256` |
| `FRONTEND_URL` | Yes | Frontend link generation and CORS support | Keep aligned with production frontend |

## Backend Storage / Media

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `S3_BUCKET` | Optional | Cloud asset storage | If omitted, local upload storage is used |
| `AWS_ACCESS_KEY_ID` | Optional | S3 auth | Required when using S3 |
| `AWS_SECRET_ACCESS_KEY` | Optional | S3 auth | Required when using S3 |
| `AWS_REGION` | Optional | S3 URL generation | Required for correct public URLs in some configs |
| `S3_PUBLIC_URL` | Optional | Public asset URL base | Used for direct public asset links |
| `S3_ENDPOINT_URL` | Optional | S3-compatible endpoint | Needed for non-AWS providers |

## Backend Video / Privacy

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `VIDEO_MAX_UPLOAD_BYTES` | Optional | Upload size cap | Protects storage and processing |
| `VIDEO_ALLOWED_EXTENSIONS` | Optional | Allowed upload file extensions | Keep aligned with frontend validation |
| `VIDEO_ALLOWED_CONTENT_TYPES` | Optional | Allowed upload MIME types | Defense in depth |
| `VIDEO_WORKER_COUNT` | Optional | Background analysis worker concurrency | Increase carefully with CPU load |
| `PRIVACY_WORKER_COUNT` | Optional | Privacy worker concurrency | Increase carefully with CV / ffmpeg load |
| `PRIVACY_REQUIRE_PROFILE` | Optional | Require teacher privacy profile before upload | High-safety mode |
| `PRIVACY_MAX_RETRIES` | Optional | Retry cap for privacy jobs | Used in queue rehydration / recovery |
| `PRIVACY_RAW_VIDEO_RETENTION_DAYS` | Optional | Raw-video retention | Purged by maintenance worker |
| `PRIVACY_PROFILE_IMAGE_RETENTION_DAYS` | Optional | Reference-image retention | Purged by maintenance worker |
| `PRIVACY_PURGE_INTERVAL_MINUTES` | Optional | Purge worker cadence | Maintenance loop frequency |

## Backend Analysis / AI

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Optional | OpenAI model access | Required for live paid analysis |
| `OPENAI_VISION_MODEL` | Optional | Main analysis model | Current production path supports `gpt-4.1-mini` and future replacements |
| `OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD` | Optional | Estimated input-token pricing for observability metrics | Used for Prometheus cost counters; does not affect billing |
| `OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD` | Optional | Estimated output-token pricing for observability metrics | Keep aligned with the active model pricing |
| `PAID_ANALYSIS_ENABLED` | Optional | Master switch for paid model path | Used with allowlist |
| `PAID_ANALYSIS_ALLOWLIST_EMAILS` | Optional | Demo or pilot email allowlist | Comma-separated |
| `VIDEO_ANALYSIS_MAX_FRAMES` | Optional | Max sampled frames | Cost/quality control |
| `SMART_FRAME_SELECTION_ENABLED` | Optional | Smart frame selection switch | Enables smarter visual sampling |
| `SMART_FRAME_SELECTION_VERSION` | Optional | Smart selection strategy version | Persisted into manifests |
| `VIDEO_ANALYSIS_FRAME_SCAN_FPS` | Optional | Candidate scan rate | Smart selection tuning |
| `VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC` | Optional | Diversity spacing between selected frames | Smart selection tuning |
| `VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS` | Optional | OCR/text-density feature extraction | More coverage, more complexity |

## Backend Audio / Multimodal

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `AUDIO_ANALYSIS_ENABLED` | Optional | Master switch for audio path | Keep off unless policy approved |
| `AUDIO_TRANSCRIPTION_ENABLED` | Optional | Enable transcript generation | Depends on `ffmpeg` and model access |
| `AUDIO_FEATURES_ENABLED` | Optional | Enable discourse feature extraction | Uses transcript segments |
| `AUDIO_TRANSCRIPTION_MODEL` | Optional | OpenAI transcription model | Current default is `gpt-4o-mini-transcribe` |
| `AUDIO_TRANSCRIPTION_LANGUAGE` | Optional | Preferred transcription language | Example: `he` |
| `AUDIO_TRANSCRIPT_RETENTION_DAYS` | Optional | Transcript retention | Purged by maintenance worker |
| `AUDIO_ALLOW_STUDENT_VOICE_PROCESSING` | Optional | Audio privacy policy switch | Must match legal/policy decision |

## Frontend Runtime

| Variable | Required | Purpose | Notes |
| --- | --- | --- | --- |
| `REACT_APP_BACKEND_URL` | Yes | API base URL | Injected via runtime config |
| `REACT_APP_BUILD_SHA` | Optional | Build metadata | Helpful for smoke/debug |

## Staging Defaults

- Enable smart sampling before enabling audio.
- Keep paid analysis allowlisted.
- Use Hebrew smoke validation before broad Hebrew rollout.
- Prefer shorter clips for multimodal debugging.

## Production Defaults

- Keep only active Railway services connected to GitHub.
- Keep audio feature-flagged until privacy/legal signoff is complete.
- Monitor `/api/admin/ops/launch-health` and `/api/admin/ops/observability` during rollout.
- Expose `/metrics` only behind trusted network boundaries or a protected scrape path.
- Keep cost-per-million config aligned with the active OpenAI model to avoid misleading spend estimates.
