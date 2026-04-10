# Cognivio Production DB Remediation Plan

## Goal

Stabilize production data infrastructure so Cognivio is safe for pilot use, with:

- enough database headroom for index creation and growth
- reliable storage for uploads and processed assets
- cleanup of test and validation data
- clear validation and rollback steps

## Current Production Risks

Observed in live backend logs:

- Mongo index creation is being skipped because available disk is below Mongo's minimum free-space threshold.
- Upload storage is still falling back to local container storage because `S3_BUCKET` is not configured.
- Pilot verification data and test users have likely accumulated in the live database.

This means production is currently functional but not properly hardened.

## Recommendation

Use this sequence:

1. Immediate stabilization
2. Durable storage migration
3. Production cleanup
4. Validation and sign-off

## Phase 1: Immediate Stabilization

### Option A: Fastest Temporary Fix

Increase the Railway Mongo volume.

Use this when:

- the goal is to stop the index warnings immediately
- pilot access must continue without interruption

Steps:

1. Increase disk on the Railway Mongo service.
2. Wait for the database service to stabilize.
3. Restart the Cognivio backend.
4. Confirm the startup logs no longer show `OutOfDiskSpace`.
5. Confirm indexes are created successfully.

This is a stopgap, not the best long-term pilot architecture.

### Option B: Recommended Pilot-Ready Fix

Move production Mongo to MongoDB Atlas.

Use this when:

- we want a cleaner production setup
- we want predictable storage growth and backups
- we want to stop depending on a constrained Railway database volume

Steps:

1. Create a MongoDB Atlas project and production cluster.
2. Create a dedicated Cognivio database user.
3. Add Railway/backend network access to Atlas.
4. Copy the Atlas connection string.
5. Update Railway `MONGO_URL`.
6. Redeploy the backend.
7. Validate auth, teacher pages, dashboard, and upload metadata reads/writes.

Recommended target:

- Atlas for Mongo
- S3-compatible object storage for uploads
- Railway for app runtime

## Phase 2: Durable File Storage

This is required for real production readiness.

Current risk:

- live backend logs still show local upload fallback
- container-local storage is not a safe long-term production store for pilot video workflow

Steps:

1. Choose object storage:
   - AWS S3
   - Cloudflare R2
   - Backblaze B2 via S3-compatible API
2. Create a dedicated production bucket.
3. Set Railway env vars:
   - `S3_BUCKET`
   - `S3_REGION`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_ENDPOINT_URL` if using non-AWS S3-compatible storage
4. Redeploy backend.
5. Upload a test file.
6. Confirm new uploads write to object storage, not local fallback.

## Phase 3: Production Cleanup

After storage is stable, clean the live data.

### Cleanup Targets

- temporary access-request users created during validation
- test pilot accounts using disposable email addresses
- duplicate or obsolete pending requests
- demo-only artifacts if they exist in production
- stale failed upload or analysis jobs if present

### Keep

- real admin account
- legitimate pilot users
- production teacher/coaching records that are intended to remain

### Safe Cleanup Sequence

1. Export or snapshot the current database.
2. Query and review users by email pattern.
3. Remove validation users created with disposable/test addresses.
4. Review pending approvals and delete obviously invalid requests.
5. Review failed jobs and old transient processing records.
6. Re-run validation.

### Known Cleanup Candidates

At minimum, review and likely remove:

- access-request test accounts created during live verification
- temporary `example.com` pilot verification users
- any duplicate records created while testing approval email flow

## Phase 4: Index Recovery

Once storage pressure is resolved:

1. Restart the backend.
2. Watch startup logs.
3. Confirm indexes are created instead of skipped.
4. Verify:
   - auth login and approval flow
   - teacher roster loading
   - dashboard loading
   - teacher deep dive loading
   - action plan and reflection pages
   - video metadata and processing records

## Phase 5: Validation Checklist

Production is considered clean only when all of the following are true:

- backend `/health` returns healthy
- no `OutOfDiskSpace` index-creation warnings appear on startup
- uploads no longer use local fallback storage
- master admin login works
- signup request creates `pending` user
- approval email reaches admin inbox
- requester receives confirmation email
- approved requester receives approval email
- approved requester can log in with the same email and password
- dashboard and teacher pages load normally

## Rollback Plan

If any production issue appears after DB or storage changes:

1. Restore previous `MONGO_URL` or storage env values.
2. Redeploy backend.
3. Re-check `/health`.
4. Use the last known-good database snapshot if data corruption is suspected.

## Recommended Execution Order

1. Set up `contact@cognivio.live` forwarding.
2. Increase Mongo headroom immediately or move to Atlas.
3. Configure S3-compatible object storage.
4. Redeploy backend.
5. Clean test and validation data.
6. Confirm index creation succeeds.
7. Run final production validation.

## My Recommendation

For proper pilot readiness:

1. Do not stop at increasing Railway disk.
2. Move Mongo to Atlas.
3. Configure object storage now.
4. Clean the validation/test records immediately after migration.

That is the cleanest route to a production-ready pilot stack.
