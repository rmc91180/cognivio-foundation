# Pilot Deployment Checklist

Date: 2026-03-30

Use this as the live cutover checklist for the first Cognivio pilot.

## Target Topology

- Frontend: `https://www.cognivio.live`
- Backend: `https://api.cognivio.live`
- Auth mode: approval-required
- Approval notification inbox: `rmc91180@gmail.com`

## Phase 1: Domain Cutover

### DNS and TLS

- [ ] Point `www.cognivio.live` to the frontend host
- [ ] Point `api.cognivio.live` to the backend host
- [ ] Enable TLS for both domains
- [ ] Decide whether `https://cognivio.live` redirects to `https://www.cognivio.live`

### Frontend runtime

- [ ] Set `REACT_APP_BACKEND_URL=https://api.cognivio.live`
- [ ] Set `REACT_APP_DEMO_MODE=false`
- [ ] Set `REACT_APP_REGISTRATION_APPROVAL_REQUIRED=true`
- [ ] Optionally set `REACT_APP_BUILD_SHA`
- [ ] Optionally set `REACT_APP_BUILD_TIME`

### Backend runtime

- [ ] Set `FRONTEND_URL=https://www.cognivio.live`
- [ ] Set `BACKEND_PUBLIC_BASE_URL=https://api.cognivio.live`
- [ ] Set `CORS_ORIGINS=https://www.cognivio.live,https://cognivio.live`
- [ ] Set a strong `JWT_SECRET`
- [ ] Set `DEMO_MODE=false`

### Smoke checks

- [ ] `https://www.cognivio.live` loads
- [ ] browser API calls go to `https://api.cognivio.live`
- [ ] backend health responds from `https://api.cognivio.live/api/health`
- [ ] no CORS errors appear in browser console

## Phase 2: Approval-Gated Login

### Admin bootstrap

- [ ] Put your admin email in `ADMIN_EMAILS`
- [ ] Confirm your admin email can request access and sign in
- [ ] Confirm admin login lands on `/dashboard`
- [ ] Confirm the admin shell shows `Access Approvals`

Recommended initial value:

```env
ADMIN_EMAILS=rmc91180@gmail.com
```

### Approval settings

- [ ] Set `ACCESS_APPROVAL_REQUIRED=true`
- [ ] Set `ACCESS_APPROVAL_NOTIFY_EMAIL=rmc91180@gmail.com`

### Approval email delivery

Configure an SMTP account that the backend can use for approval notifications.

- [ ] Set `SMTP_HOST`
- [ ] Set `SMTP_PORT`
- [ ] Set `SMTP_USERNAME`
- [ ] Set `SMTP_PASSWORD`
- [ ] Set `SMTP_FROM_EMAIL`
- [ ] Set `SMTP_USE_TLS=true`

Recommended Gmail-style pilot setup:

```env
ACCESS_APPROVAL_REQUIRED=true
ACCESS_APPROVAL_NOTIFY_EMAIL=rmc91180@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=rmc91180@gmail.com
SMTP_PASSWORD=<gmail-app-password>
SMTP_FROM_EMAIL=rmc91180@gmail.com
SMTP_USE_TLS=true
```

Notes:

- Use an app password, not a personal Gmail password.
- If SMTP is not configured, access requests will still be saved in Cognivio, but the email notification will not send.

### Approval flow validation

- [ ] Open `/login`
- [ ] Confirm the second tab reads `Request access`
- [ ] Submit a request from a non-admin email
- [ ] Confirm the request is saved as `pending`
- [ ] Confirm the approval notification reaches `rmc91180@gmail.com`
- [ ] Open `/access-management` as admin
- [ ] Approve the pending user
- [ ] Confirm that user can then log in

### Removal / revocation validation

- [ ] Open `/access-management`
- [ ] Remove access for an approved non-admin user
- [ ] Confirm that user can no longer log in
- [ ] Confirm their record still remains in the system

Important:

- Removing access disables login; it does not hard-delete user-linked coaching data.
- The system blocks admins from removing their own access through the UI/API.

## Phase 3: Teacher Provisioning

Teacher workspace resolution depends on email matching.

- [ ] Create the teacher record in Cognivio first
- [ ] Set the teacher record email to the teacher’s real login email
- [ ] Have the teacher request access with that exact same email
- [ ] Approve the request
- [ ] Confirm teacher login lands on `/my-workspace`
- [ ] Confirm the workspace resolves the intended `teacher_id`

## Phase 4: Upload and Processing Enablement

### Analysis configuration

- [ ] Set `OPENAI_API_KEY`
- [ ] Set `PAID_ANALYSIS_ENABLED=true`
- [ ] Optionally set `PAID_ANALYSIS_ALLOWLIST_EMAILS` for the first pilot cohort

### Privacy configuration

- [ ] Set `PRIVACY_REQUIRE_PROFILE=true`
- [ ] Set `PRIVACY_MANUAL_REVIEW_ENABLED=true`
- [ ] Set `PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true`
- [ ] Set `PRIVACY_WORKER_COUNT=1`
- [ ] Set `PRIVACY_MAX_RETRIES=3`

### Storage

- [ ] Set S3 bucket and credentials
- [ ] Confirm uploads persist across restarts

Recommended minimum:

```env
S3_BUCKET=<pilot-bucket>
S3_REGION=<region>
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
```

## Phase 5: First Real Pilot Run

- [ ] Teacher logs in
- [ ] Teacher completes privacy profile
- [ ] Teacher uploads one lesson recording
- [ ] Video enters queue successfully
- [ ] Privacy processing completes
- [ ] Analysis completes
- [ ] Teacher can open the processed lesson
- [ ] Admin can review the same lesson
- [ ] Evidence and playback links resolve correctly

## Final Go / No-Go Check

- [ ] Domains are live and HTTPS works
- [ ] Approval-required login is active
- [ ] Approval emails reach `rmc91180@gmail.com`
- [ ] Admin can approve and remove users
- [ ] Teacher email-to-record linking works
- [ ] One full upload-to-review cycle works
- [ ] No blocking CORS, auth, storage, or asset-origin issues remain
