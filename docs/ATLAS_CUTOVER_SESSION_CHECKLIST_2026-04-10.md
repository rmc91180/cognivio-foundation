# Cognivio Atlas Cutover Session Checklist

## Purpose

This is the live execution checklist for moving Cognivio production from Railway Mongo to MongoDB Atlas.

Use this during the actual migration session.

## Target State

- Database: MongoDB Atlas `M10`
- Runtime: Railway
- Frontend: unchanged
- Backend: points to Atlas via `MONGO_URL`
- Auth flow: unchanged
- Master admin: `rmc91180@gmail.com`

## Pre-Session Inputs

Have these ready before starting:

- [ ] Atlas project created
- [ ] Atlas cluster created
- [ ] Atlas DB username
- [ ] Atlas DB password
- [ ] Atlas connection string
- [ ] Railway current `MONGO_URL` copied and saved
- [ ] Cognivio backend Railway access available
- [ ] Maintenance window selected if needed

## Atlas Setup Fields

Record these values:

- Atlas project name: `________________`
- Atlas cluster name: `________________`
- Atlas tier: `M10`
- Atlas provider/region: `________________`
- Atlas database user: `________________`
- Atlas connection string: `________________`
- Atlas database name: `________________`

## Railway Current-State Capture

Before changing anything:

- [ ] Confirm backend health
- [ ] Confirm admin login works
- [ ] Copy current Railway `MONGO_URL`
- [ ] Confirm current production data is reachable

Commands:

```powershell
Invoke-RestMethod -Uri "https://api.cognivio.live/health"
```

Optional live auth check:

```powershell
$body = @{ email = "rmc91180@gmail.com"; password = "CognivioAdmin2026" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "https://api.cognivio.live/api/auth/login" -ContentType "application/json" -Body $body
```

## Backup / Snapshot

- [ ] Export current Railway Mongo before cutover
- [ ] Save the export safely
- [ ] Save old `MONGO_URL`

Record:

- Backup file path: `________________`
- Backup timestamp: `________________`
- Old Railway `MONGO_URL`: `________________`

## Atlas Network Access

- [ ] Add Railway/backend network access to Atlas
- [ ] If exact egress IP is unavailable, temporarily allow `0.0.0.0/0`
- [ ] Confirm Atlas accepts connection from app environment

## Data Migration

### Option Used

Choose one:

- [ ] `mongodump` / `mongorestore`
- [ ] Atlas migration tooling

### If Using `mongodump` / `mongorestore`

Record:

- Source URI: `________________`
- Target URI: `________________`

Commands to prepare:

```powershell
mongodump --uri "<SOURCE_MONGO_URL>" --out ".\\mongo-backup"
mongorestore --uri "<ATLAS_MONGO_URL>" ".\\mongo-backup"
```

Post-import checks:

- [ ] Collections exist in Atlas
- [ ] User collection looks correct
- [ ] Assessments collection looks correct
- [ ] Videos collection looks correct
- [ ] Action plan and reflection collections look correct

## Railway Cutover

Set the new production DB URL:

- [ ] Update Railway `MONGO_URL` to Atlas connection string
- [ ] Redeploy backend
- [ ] Wait for successful deploy

Railway commands:

```powershell
railway variable set "MONGO_URL=<ATLAS_MONGO_URL>" -s cognivio
railway up backend -s cognivio --path-as-root -m "Cut over production Mongo to Atlas"
railway deployment list -s cognivio
```

## Immediate Post-Cutover Checks

- [ ] Backend deployment succeeds
- [ ] `/health` returns healthy
- [ ] No DB connection failures in logs

Commands:

```powershell
Invoke-RestMethod -Uri "https://api.cognivio.live/health"
railway logs -s cognivio --lines 150
```

## Core Product Validation

### Admin

- [ ] Master admin login works
- [ ] Access-management page loads
- [ ] Dashboard loads
- [ ] Teacher roster loads

### Approval Flow

- [ ] New user signup returns `pending`
- [ ] Admin approval email arrives
- [ ] User confirmation email arrives
- [ ] Admin can approve the request
- [ ] Approved user email arrives
- [ ] Approved user can log in with same email/password

Suggested live verification commands:

```powershell
$adminBody = @{ email = "rmc91180@gmail.com"; password = "CognivioAdmin2026" } | ConvertTo-Json
$admin = Invoke-RestMethod -Method POST -Uri "https://api.cognivio.live/api/auth/login" -ContentType "application/json" -Body $adminBody
$token = $admin.token
$headers = @{ Authorization = "Bearer $token" }
```

Create pending user:

```powershell
$email = "atlascutover+" + [guid]::NewGuid().ToString("N").Substring(0,8) + "@example.com"
$signup = @{ name = "Atlas Cutover User"; email = $email; password = "TeacherPass123!" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "https://api.cognivio.live/api/auth/request-access" -ContentType "application/json" -Body $signup
```

List pending users:

```powershell
Invoke-RestMethod -Method GET -Uri "https://api.cognivio.live/api/admin/access-users" -Headers $headers
```

Approve user:

```powershell
$reason = @{ reason = "Atlas cutover verification" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "https://api.cognivio.live/api/admin/access-users/<USER_ID>/approve" -Headers $headers -ContentType "application/json" -Body $reason
```

Approved-user login:

```powershell
$userBody = @{ email = "<USER_EMAIL>"; password = "TeacherPass123!" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "https://api.cognivio.live/api/auth/login" -ContentType "application/json" -Body $userBody
```

## Index Recovery Check

This is a critical success criterion.

- [ ] Review startup logs
- [ ] Confirm `OutOfDiskSpace` warnings are gone
- [ ] Confirm index creation is no longer skipped

Command:

```powershell
railway logs -s cognivio --lines 200
```

## Production Cleanup After Stable Cutover

Only do this after successful validation.

- [ ] Remove temporary `example.com` users
- [ ] Remove obsolete pending requests from validation
- [ ] Keep real pilot users
- [ ] Keep master admin

Cleanup review targets:

- `example.com`
- test aliases used during approval-email verification
- duplicate pending requests

## Object Storage Follow-Up

This is the next hardening step after Atlas cutover.

- [ ] Create S3-compatible bucket
- [ ] Set:
  - `S3_BUCKET`
  - `S3_REGION`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
  - `S3_ENDPOINT_URL` if needed
- [ ] Redeploy backend
- [ ] Verify uploads no longer use local fallback

## Rollback

If cutover fails:

- [ ] Restore old Railway `MONGO_URL`
- [ ] Redeploy backend
- [ ] Confirm `/health`
- [ ] Re-test admin login

Rollback commands:

```powershell
railway variable set "MONGO_URL=<OLD_RAILWAY_MONGO_URL>" -s cognivio
railway up backend -s cognivio --path-as-root -m "Rollback Mongo cutover"
Invoke-RestMethod -Uri "https://api.cognivio.live/health"
```

## Success Criteria

Migration is complete only when all are true:

- [ ] Atlas is the live production DB
- [ ] Backend is healthy
- [ ] Master admin login works
- [ ] Approval flow works end-to-end
- [ ] User notification emails work
- [ ] No Mongo storage/index warnings remain
- [ ] Repo remains clean

## Session Notes

- Start time: `________________`
- End time: `________________`
- Operator: `________________`
- Issues encountered: `________________`
- Final sign-off: `________________`
