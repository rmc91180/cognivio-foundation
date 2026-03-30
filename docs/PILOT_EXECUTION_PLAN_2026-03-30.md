# Pilot Execution Plan

Date: 2026-03-30

## Objective

Prepare Cognivio for real pilot use by:

1. Moving the live site to the Cognivio domain.
2. Enabling real login and pilot usage flows so admins and teachers can sign in, upload videos, and process them successfully.
3. Requiring admin approval before non-admin pilot users can access the product.

## Recommended Pilot Domain Topology

Use:

- Frontend: `https://www.cognivio.live`
- Backend API: `https://api.cognivio.live`

Do not treat `http://www.cognivio.live/` as the final target. The pilot should run on HTTPS.

This topology matches the current app architecture:

- frontend runtime expects `REACT_APP_BACKEND_URL`
- backend already supports `FRONTEND_URL` and `BACKEND_PUBLIC_BASE_URL`
- backend-generated file URLs and share links depend on the backend public origin being correct

## Current Product State

The codebase already has the core pilot foundations:

- JWT login and request-access flows exist:
  - `POST /api/auth/request-access`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
- admin access review exists:
  - `GET /api/admin/access-users`
  - `POST /api/admin/access-users/{user_id}/approve`
  - `POST /api/admin/access-users/{user_id}/revoke`
- the frontend already supports login, token persistence, and protected routes
- teacher workspace routing is already separated from admin routing
- video upload and processing flows already exist
- privacy profile gating already exists before teacher video uploads

Important current behavior:

- pilot access can require approval through `ACCESS_APPROVAL_REQUIRED=true`
- non-admin users request access instead of self-registering directly
- admin role is assigned automatically when the registering email is included in `ADMIN_EMAILS`
- teacher login is linked to a teacher record primarily by matching the login email to the teacher record email
- approved users can later be removed through the admin access-management surface without deleting linked records

That means Step 2 is not “build login from scratch.” It is:

- turn off demo mode
- enable approval-required auth
- provision pilot users correctly
- ensure teacher roster emails match teacher login emails
- verify upload and processing on live infrastructure

## Phase 0: Pilot Freeze And Decisions

Before cutover, lock these decisions:

1. Pilot frontend origin:
   - `https://www.cognivio.live`
2. Pilot backend origin:
   - `https://api.cognivio.live`
3. First pilot admin emails:
   - these must go into `ADMIN_EMAILS`
4. Approval inbox:
   - access request notifications should go to `rmc91180@gmail.com`
5. First pilot teacher emails:
   - these must exactly match teacher record emails in Cognivio
6. Storage mode:
   - recommended: S3-backed storage for pilot
   - avoid relying on local ephemeral upload storage for live pilot use
7. Paid analysis policy:
   - recommended: enable for pilot, initially allowlisted if needed

## Phase 1: Domain Migration

### Target Outcome

- frontend loads from `https://www.cognivio.live`
- backend API responds from `https://api.cognivio.live`
- all app API calls, generated asset links, and browser websocket/video flows resolve against the correct live origins

### Tasks

#### 1. DNS and certificates

Configure:

- `www.cognivio.live` -> frontend host
- `api.cognivio.live` -> backend host

Enable TLS certificates for both.

Also decide whether to redirect:

- `https://cognivio.live` -> `https://www.cognivio.live`

#### 2. Frontend runtime configuration

Set:

```env
REACT_APP_BACKEND_URL=https://api.cognivio.live
REACT_APP_DEMO_MODE=false
```

Optional but recommended:

```env
REACT_APP_BUILD_SHA=<deploy-sha>
REACT_APP_BUILD_TIME=<deploy-time>
```

#### 3. Backend runtime configuration

Set:

```env
FRONTEND_URL=https://www.cognivio.live
BACKEND_PUBLIC_BASE_URL=https://api.cognivio.live
CORS_ORIGINS=https://www.cognivio.live,https://cognivio.live
```

Keep these aligned. Misalignment here will break:

- login/API calls
- browser-origin requests
- generated upload/media URLs
- share and report links

#### 4. Storage configuration

Recommended pilot config:

```env
S3_BUCKET=<pilot-bucket>
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
S3_REGION=<region>
S3_PUBLIC_BASE_URL=<optional-public-base-if-used>
```

Why:

- local fallback storage is acceptable for local dev, not ideal for live pilot durability
- pilot uploads, redacted assets, and generated media should survive restarts and redeploys

#### 5. Domain smoke validation

After domain cutover, confirm:

1. `https://www.cognivio.live` loads the frontend
2. browser API calls point to `https://api.cognivio.live`
3. `GET /api/health` is reachable on the backend origin
4. asset and upload URLs resolve under the intended public origin
5. no CORS errors appear in browser console

## Phase 2: Approval-Gated Live Login

### Target Outcome

- demo-only auth is off
- first pilot admins can request access/login as admins
- first pilot teachers can request access, be approved, and then log in
- teacher users land in a linked teacher workspace

### Tasks

#### 1. Disable demo mode

Set:

```env
DEMO_MODE=false
```

Effect:

- the pilot login page uses the live auth path
- demo login assumptions are removed

#### 2. Set production JWT secret

Set:

```env
JWT_SECRET=<strong-random-secret>
```

This is required for live auth token signing.

#### 3. Define pilot admins

Set:

```env
ADMIN_EMAILS=admin1@...,admin2@...
```

Important:

- any registering email in `ADMIN_EMAILS` becomes `admin`
- any registering email not in `ADMIN_EMAILS` becomes `teacher`

#### 4. Enable approval-required access

Set:

```env
ACCESS_APPROVAL_REQUIRED=true
ACCESS_APPROVAL_NOTIFY_EMAIL=rmc91180@gmail.com
```

Also configure SMTP so approval requests actually email the approval inbox.

#### 5. Provision teacher records before teacher login

This is critical.

For teacher workspace linking to work cleanly:

1. create teacher records in Cognivio first
2. set each teacher record email to the real pilot teacher email
3. then have that teacher request access using the exact same email

Why:

- the backend links teacher users to teacher records by email match first
- if the emails do not match, the teacher can authenticate but may not resolve to the intended teacher workspace

#### 6. Pilot login validation sequence

Validate in order:

1. admin requests access with email in `ADMIN_EMAILS`
2. admin logs in and lands on `/dashboard`
3. non-admin request appears in `/access-management`
4. teacher record exists with matching email
5. teacher requests access with that matching email
6. admin approves the request
7. teacher logs in and lands on `/my-workspace`
8. teacher workspace resolves the correct `teacher_id`

## Phase 3: Upload And Processing Enablement

### Target Outcome

- a teacher can complete privacy setup
- upload a lesson video
- wait for privacy + analysis processing
- review the processed lesson in the live product

### Required Runtime Configuration

#### 1. AI / analysis

At minimum:

```env
OPENAI_API_KEY=<live-key>
PAID_ANALYSIS_ENABLED=true
```

Optional pilot safety control:

```env
PAID_ANALYSIS_ALLOWLIST_EMAILS=admin1@...,teacher1@...
```

This is useful if we want to open live analysis only to the first pilot cohort at the start.

#### 2. Privacy configuration

Recommended pilot values:

```env
PRIVACY_REQUIRE_PROFILE=true
PRIVACY_MANUAL_REVIEW_ENABLED=true
PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true
PRIVACY_WORKER_COUNT=1
PRIVACY_MAX_RETRIES=3
```

#### 3. Upload persistence

Use S3-backed storage for live pilot.

#### 4. Public URL correctness

Because upload and playback links are generated from backend public origin settings, confirm again:

```env
BACKEND_PUBLIC_BASE_URL=https://api.cognivio.live
FRONTEND_URL=https://www.cognivio.live
```

### Pilot Usage Validation Sequence

Run this exact sequence:

1. Teacher logs in.
2. Teacher privacy profile is created successfully.
3. Teacher uploads one lesson recording.
4. Video enters queue successfully.
5. Privacy processing completes.
6. Analysis completes.
7. Teacher can see the uploaded lesson in their workspace/videos flow.
8. Admin can review the lesson from the admin surfaces.
9. Lesson review page loads with evidence and no broken asset URLs.

## Phase 4: Pilot Go-Live Checklist

### Environment checklist

- `REACT_APP_BACKEND_URL=https://api.cognivio.live`
- `REACT_APP_DEMO_MODE=false`
- `FRONTEND_URL=https://www.cognivio.live`
- `BACKEND_PUBLIC_BASE_URL=https://api.cognivio.live`
- `CORS_ORIGINS` includes `https://www.cognivio.live`
- `JWT_SECRET` set
- `ADMIN_EMAILS` set
- `ACCESS_APPROVAL_REQUIRED=true`
- `ACCESS_APPROVAL_NOTIFY_EMAIL=rmc91180@gmail.com`
- SMTP env set
- `OPENAI_API_KEY` set
- `PAID_ANALYSIS_ENABLED=true`
- S3 env set
- privacy env set

### Product checklist

- admin request-access/login works
- teacher request-access/approval/login works
- teacher email matches teacher record email
- teacher workspace resolves correctly
- admin can approve and remove access
- privacy profile save works
- one upload completes end to end
- admin can review processed lesson
- no CORS or asset-origin failures

## Recommended Execution Order

### Day 1: Domain and runtime setup

1. Set frontend and backend domains.
2. Set frontend/backend origin env vars.
3. Configure TLS.
4. Verify `GET /api/health`.

### Day 2: Live auth switch

1. Set `DEMO_MODE=false`.
2. Set `JWT_SECRET`.
3. Set `ADMIN_EMAILS`.
4. Set approval and SMTP env.
5. Create teacher records with real pilot emails.
6. Validate admin and teacher approval/login.

### Day 3: First real upload

1. Confirm S3 and analysis env.
2. Teacher completes privacy profile.
3. Teacher uploads one lesson.
4. Confirm privacy + analysis + review path.

## Risks And Mitigations

### Risk 1: Frontend loads but API calls fail

Likely cause:

- `REACT_APP_BACKEND_URL`
- `CORS_ORIGINS`
- `FRONTEND_URL`
- `BACKEND_PUBLIC_BASE_URL`

Mitigation:

- validate all four together, not separately

### Risk 2: Teacher can log in but not reach the intended workspace

Likely cause:

- teacher user email does not match teacher record email

Mitigation:

- make teacher record creation and email verification part of pilot provisioning

### Risk 3: Uploads work but assets break after processing

Likely cause:

- local storage fallback or wrong public asset origin

Mitigation:

- use S3-backed storage
- verify backend public base URL before pilot uploads

### Risk 4: Pilot opens live auth too broadly

Likely cause:

- `DEMO_MODE=false` without controlled provisioning

Mitigation:

- require approval for non-admin users
- start with a small pilot email list
- optionally use `PAID_ANALYSIS_ALLOWLIST_EMAILS`
- provision pilot teachers intentionally

## Immediate Next Actions

1. Confirm hosting targets for frontend and backend.
2. Confirm whether we will use `api.cognivio.live` for backend.
3. List first pilot admin emails for `ADMIN_EMAILS`.
4. Confirm the approval inbox and SMTP credentials.
5. List first pilot teacher emails and ensure matching teacher records exist.
6. Prepare production environment variable set.
7. Run the first domain cutover and auth smoke sequence.
