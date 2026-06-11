# A0 — Environment Variable Map (cozy-endurance → cognivio-foundation)

**Live reference:** Railway project `cozy-endurance`, service `cognivio-teacher-assessment` (43 service variables).
**Rule:** copy the *keys*, replace every *value* per the bucket. A clone that boots is not proof of isolation — see the A0.7 check at the bottom.

> This file deliberately contains **no live secret values**. Bucket-1/3 entries are placeholders you fill from the clone's own stores or regenerate. Bucket-2 (non-secret config) values are copied as-is for behavior parity.

---

## Bucket 1 — Points at a real resource → REPLACE with the clone's throwaway equivalent
These are the dangerous ones. If any keeps its live value, the clone reads/writes production.

| Key | Replace with | Source |
|---|---|---|
| `MONGO_URL` | clone Atlas connection string | A0.3 |
| `DB_NAME` | `cognivio_foundation_throwaway` (live = `cognivio`) | A0.3 |
| `AWS_ACCESS_KEY_ID` | clone R2 access key | A0.4 |
| `AWS_SECRET_ACCESS_KEY` | clone R2 secret | A0.4 |
| `S3_BUCKET` | `cognivio-foundation-assets` (live = `cognivio`) | A0.4 |
| `S3_ENDPOINT` | clone R2 S3 endpoint | A0.4 |
| `S3_PUBLIC_BASE_URL` | clone R2 public base URL | A0.4 |
| `BACKEND_PUBLIC_BASE_URL` | clone API Railway URL | A0.2 |
| `FRONTEND_URL` | clone frontend URL (or leave unset) | later |
| `CORS_ORIGINS` | clone frontend origin(s), not live cognivio.live domains | later |
| `GEMINI_API_KEY` | clone-scoped Gemini key (separate spend) | your key |
| `OPENAI_API_KEY` | clone-scoped OpenAI key | your key |
| `EMERGENT_LLM_KEY` | clone-scoped key (or reuse if acceptable) | your key |
| `RESEND_API_KEY` | **leave UNSET** so the clone cannot send real email | — |
| `RESEND_FROM_EMAIL` | inert if Resend unset; otherwise throwaway | — |

> ⚠️ Live `S3_PUBLIC_BASE_URL` value has a doubled prefix bug (`S3_PUBLIC_BASE_URL=https://...`). Set the clone's correctly as just the URL.

## Bucket 2 — Config / behavior flags → COPY AS-IS (prove the foundation under live behavior)

```
ANALYSIS_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash
GEMINI_VIDEO_INPUT_MODE=inline
OPENAI_VISION_MODEL=gpt-4o
ACCESS_APPROVAL_REQUIRED=true
ACCESS_APPROVAL_NOTIFY_EMAIL=rmc91180@gmail.com
ADMIN_EMAILS=rmc91180@gmail.com
MASTER_ADMIN_EMAIL=rmc91180@gmail.com
MASTER_ADMIN_NAME=Rafi Cohen
SUPER_ADMIN_EMAILS=rmc91180@gmail.com
PAID_ANALYSIS_ENABLED=true
PAID_ANALYSIS_ALLOWLIST_EMAILS=rc2rc2rc2@gmail.com,rafi@cohenlightlaw.com,rmc91180@gmail.com
DEMO_MODE=false
AUDIO_ALLOW_STUDENT_VOICE_PROCESSING=true
AUDIO_ANALYSIS_ENABLED=true
AUDIO_TRANSCRIPTION_ENABLED=true
PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true
PRIVACY_ALLOW_DEGRADED_RUNTIME=true
PRIVACY_BLUR_ALL_FULL_FRAME=false
PRIVACY_MANUAL_REVIEW_ENABLED=false
PRIVACY_REQUIRE_PROFILE=false
SMART_FRAME_SELECTION_ENABLED=true
SMART_FRAME_SELECTION_VERSION=smart_frames_v2
VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS=true
S3_PRESIGNED_URL_EXPIRES_SECONDS=3600
S3_REGION=us-east-1
NIXPACKS_APT_PACKAGES=libgl1 libglib2.0-0 libxcb1 libx11-6 libxext6 libxrender1 libxau6 libxdmcp6 libsm6 libice6 libxfixes3
```

## Bucket 3 — Secrets with no live resource → REGENERATE
```
JWT_SECRET=<generate a fresh secret; do NOT reuse live's>
```

## Not present on live (add later, not from this list)
- `REDIS_URL` — live has no Redis; first used in A4. On the clone, let the Railway Redis addon inject it; do not paste a hardcoded one (avoid a duplicate `REDIS_URL`).
- `GIT_SHA` — per `backend/railway.toml`, set on **each** service (api + worker) to `${{ RAILWAY_GIT_COMMIT_SHA }}` so `/__build` reports the real commit.

## Worker-specific (the `[[services]]` worker counts are inline in the start command, not env)
- api start: `sh -c 'VIDEO_WORKER_COUNT=0 VIDEO_TRANSCODE_WORKER_COUNT=0 PRIVACY_WORKER_COUNT=0 uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}'`
- worker start: `sh -c 'VIDEO_WORKER_COUNT=${VIDEO_WORKER_COUNT:-3} python worker_entrypoint.py'`
- ⚠️ The worker has no HTTP server, but `railway.toml [deploy] healthcheckPath=/health` is global. On the **worker** service, override/remove the healthcheck in Railway UI so it isn't marked unhealthy.

## Captured so far (live run 2026-06-04)
- **A0.3 Atlas (done):** `DB_NAME=cognivio_foundation_throwaway`; `MONGO_URL` points at the isolated Atlas project `cognivio-foundation` → host `cluster0.gylrqyh.mongodb.net`, user `rmc91180_db_user` (password held by Rafi). Network access `0.0.0.0/0` set.
- **A0.5 Redis (done):** Redis online in the clone Railway project. On api + worker set `REDIS_URL=${{ Redis.REDIS_URL }}` (reference, not a literal). Do not also paste a hardcoded `REDIS_URL`.
- **A0.4 R2 (done — token created):** `S3_BUCKET=cognivio-foundation-assets`; `S3_ENDPOINT=https://d61ac168c33c568a5a65f68478ac9d96.r2.cloudflarestorage.com` (same account as live — isolation is via bucket name + bucket-scoped token); `AWS_ACCESS_KEY_ID=<held by Rafi>`; `AWS_SECRET_ACCESS_KEY` held by Rafi; `S3_REGION=us-east-1`. **Verify the token is scoped to only `cognivio-foundation-assets`.**

## Mechanics
1. Live → service → Variables → **Raw Editor** → copy whole block (done).
2. Edit per buckets above into a scratch block.
3. Clone → **each** service (api + worker) → Variables → Raw Editor → paste. Replicas share the service's vars (don't set per-replica).

## A0.7 — Isolation verification (do BEFORE A1, every time)
Booting green proves the vars are *valid*, not *isolated*. Also confirm:
1. Connect to the clone's Mongo via the `MONGO_URL` it actually uses → confirm DB is `cognivio_foundation_throwaway` and **empty**. Seeing real videos/assessments = a Bucket-1 value wasn't replaced. Stop and fix.
2. Do a test upload on the clone → confirm the object lands in `cognivio-foundation-assets`, not the live bucket.

