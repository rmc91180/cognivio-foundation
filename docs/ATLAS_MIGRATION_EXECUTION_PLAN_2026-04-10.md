# Cognivio Atlas Migration Execution Plan

## Goal

Cut over Cognivio production from Railway Mongo to MongoDB Atlas cleanly, at low initial cost, while keeping the system easy to scale later.

## Recommended Architecture

- Runtime: Railway
- Database: MongoDB Atlas `M10`
- File/object storage: S3-compatible bucket
- Auth + approvals: existing Cognivio flow unchanged

## Why This Start State

`M10` is the lowest clean production-grade starting point for Cognivio:

- lower cost than larger dedicated tiers
- cleaner than continuing on constrained Railway Mongo
- easy to scale to `M20` later without redesigning the app

## Execution Principles

1. Stabilize first, optimize second.
2. Migrate database before doing broad production cleanup.
3. Keep rollback simple.
4. Validate every major product path immediately after cutover.

## Step-by-Step Execution

### Step 1: Create Atlas Production Cluster

Create:

- Atlas project: `Cognivio Production`
- cluster tier: `M10`
- region: closest to Railway runtime
- backups: on
- alerts: on

Deliverables:

- Atlas cluster ready
- DB user created
- connection string available

### Step 2: Prepare Connectivity

Add network access:

- Railway/backend outbound IPs if available
- otherwise temporarily allow `0.0.0.0/0`

Deliverables:

- Railway can reach Atlas
- Atlas credentials tested

### Step 3: Snapshot Current Railway Mongo

Before cutover:

- export current Railway Mongo
- save current `MONGO_URL`
- record current app health

Deliverables:

- rollback snapshot
- old connection string preserved

### Step 4: Migrate Data into Atlas

Preferred approach for this stage:

- export/import

Why:

- simplest to reason about
- easiest to validate
- lowest procedural risk for current Cognivio size

Deliverables:

- all collections imported into Atlas
- document counts checked

### Step 5: Cut Over Railway Backend

Set Railway backend:

- `MONGO_URL=<Atlas connection string>`

Then:

- redeploy backend
- wait for healthy startup

Deliverables:

- backend running on Atlas
- no DB connection failures

### Step 6: Validate Core Product Paths

Run this sequence immediately:

1. `/health`
2. master admin login
3. signup request
4. admin approval
5. approved-user login
6. dashboard load
7. teacher deep dive load
8. coaching hub load
9. access-management load

Deliverables:

- auth flow verified
- admin flow verified
- key UI surfaces verified

### Step 7: Confirm Index Recovery

Watch backend startup logs and confirm:

- no `OutOfDiskSpace`
- indexes are no longer skipped

Deliverables:

- DB no longer storage-constrained
- startup logs materially cleaner

### Step 8: Clean Production Data

Only after Atlas cutover is stable:

- remove test `example.com` users
- remove temporary validation signups
- remove duplicate or obsolete pending requests
- review stale failed processing jobs

Deliverables:

- cleaner production user table
- less pilot noise

### Step 9: Fix File Storage

Do not leave production on local upload fallback.

Add:

- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT_URL` if not AWS

Then:

- redeploy backend
- upload test asset
- verify object storage is used

Deliverables:

- production upload path hardened

### Step 10: Production Sign-Off

Confirm:

- Atlas is live
- uploads use object storage
- auth/approval flow works
- admin email flow works
- user request/approval emails work
- logs are clean enough for pilot

## Cost Strategy

Start with:

- Atlas `M10`

Scale when:

- storage growth becomes meaningful
- dashboard/query latency becomes noticeable
- teacher/video activity rises materially

Upgrade path:

- `M10` -> `M20` before touching any deeper architecture

## Suggested Timeline

### Day 1

- create Atlas cluster
- create DB user
- set network access
- prepare connection string

### Day 2

- export Railway Mongo
- import into Atlas
- verify collection counts

### Day 3

- cut over backend
- validate app
- confirm log health

### Day 4

- clean test users/data
- configure object storage
- redeploy and validate uploads

## Risks

### Risk 1: Bad connection string / auth

Mitigation:

- test Atlas credentials before cutover

### Risk 2: Hidden data mismatch after import

Mitigation:

- compare collection counts
- validate real product paths, not just DB connectivity

### Risk 3: Upload path still fragile after DB move

Mitigation:

- treat S3-compatible storage as part of the same hardening wave

### Risk 4: Pilot noise in prod data

Mitigation:

- perform structured cleanup immediately after stable cutover

## Clean Recommendation

Use this exact order:

1. Atlas `M10`
2. Railway backend cutover to Atlas
3. production validation
4. production data cleanup
5. object storage cutover
6. final sign-off

That gives Cognivio the lowest-cost clean production foundation without overbuilding too early.
