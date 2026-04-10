# Cognivio Atlas Migration Checklist

## Objective

Move Cognivio production MongoDB from Railway to MongoDB Atlas with:

- minimal downtime
- low initial cost
- easy upgrade path as pilot usage grows
- clean production hygiene after cutover

## Recommended Atlas Starting Point

- Cluster tier: `M10`
- Region: same cloud/provider region closest to Railway runtime
- Backups: enabled
- Alerts: enabled for storage, CPU, memory, and connection spikes

## Phase 0: Decision Lock

- [ ] Confirm Atlas is the production Mongo target
- [ ] Confirm starting tier is `M10`
- [ ] Confirm pilot can tolerate a short maintenance window if needed

## Phase 1: Atlas Provisioning

- [ ] Create MongoDB Atlas account/project for Cognivio production
- [ ] Create production cluster on `M10`
- [ ] Choose cloud/region closest to Railway deployment
- [ ] Create Atlas database user for the app
- [ ] Store username/password securely
- [ ] Enable backups
- [ ] Configure basic alerts

## Phase 2: Network Access

- [ ] Add Railway/backend outbound access to Atlas allowlist
- [ ] If exact egress IP is not available, temporarily allow `0.0.0.0/0`
- [ ] Plan to tighten network access later if needed

## Phase 3: Connection String Prep

- [ ] Copy Atlas `mongodb+srv://...` connection string
- [ ] Set the correct database name
- [ ] Confirm credentials are URL-safe / encoded if needed
- [ ] Prepare final `MONGO_URL`

## Phase 4: Pre-Cutover Safety

- [ ] Snapshot/export current Railway Mongo data
- [ ] Record current Railway `MONGO_URL`
- [ ] Confirm backend `/health` is healthy before migration
- [ ] Freeze any non-essential production changes during cutover

## Phase 5: Data Migration

Choose one of these:

### Option A: Simple Export/Import

- [ ] Export Railway Mongo database
- [ ] Import into Atlas
- [ ] Verify collections exist
- [ ] Verify document counts are plausible

### Option B: Live Migration / Managed Transfer

- [ ] Use Atlas migration tooling if compatible
- [ ] Validate target collections after sync completes

## Phase 6: Railway Backend Cutover

- [ ] Set Railway `MONGO_URL` to Atlas connection string
- [ ] Redeploy backend
- [ ] Confirm backend startup succeeds
- [ ] Confirm `/health` returns healthy

## Phase 7: Post-Cutover Validation

- [ ] Confirm no Mongo `OutOfDiskSpace` startup warnings
- [ ] Confirm indexes are created instead of skipped
- [ ] Log in as master admin
- [ ] Submit a new signup request
- [ ] Confirm admin approval email arrives
- [ ] Confirm user confirmation email arrives
- [ ] Approve the user
- [ ] Confirm approved-user email arrives
- [ ] Confirm approved user can log in
- [ ] Confirm dashboard loads
- [ ] Confirm teacher deep dive loads
- [ ] Confirm coaching hub loads
- [ ] Confirm access-management page loads

## Phase 8: Production Cleanup

- [ ] Remove validation/test access-request accounts
- [ ] Remove `example.com` or disposable test users
- [ ] Remove obsolete pending access requests
- [ ] Review stale failed processing jobs
- [ ] Keep real admin and legitimate pilot users only

## Phase 9: Storage Hardening

- [ ] Choose object storage (`S3`, `R2`, or equivalent)
- [ ] Configure backend S3 env vars
- [ ] Redeploy backend
- [ ] Confirm uploads no longer use local fallback storage

## Phase 10: Sign-Off

- [ ] Git repo clean
- [ ] Production backend healthy
- [ ] Production frontend healthy
- [ ] Atlas backups enabled
- [ ] Pilot auth flow verified end-to-end
- [ ] DB/storage warnings resolved

## Rollback

- [ ] Restore old Railway `MONGO_URL`
- [ ] Redeploy backend
- [ ] Re-test `/health`
- [ ] Revert to last known-good DB snapshot if required
