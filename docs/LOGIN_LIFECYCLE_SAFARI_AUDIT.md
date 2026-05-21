# Login Lifecycle and Safari Signup Audit

## Executive Summary

This audit traced the Cognivio login lifecycle from public request access through approval, login, `/api/me`, role routing, and logout/session cleanup. The immediate production symptom was a Safari user reaching the request summary screen, submitting, then seeing “Failed to submit access request” with no visible approval email or pending request.

The code already persisted public access requests before email delivery in the normal path, but the lifecycle contract was too thin at the edges: duplicate/lifecycle states returned generic errors, the frontend discarded backend reason details, public signup/login calls could include stale bearer tokens from local storage, and notification-warning success looked the same as a hard failure to the user. This PR keeps the existing auth model and adds targeted contract hardening.

Branch baseline: `main` at `8d7c4853c85aef69542cb1fc2a120d422d50172f` (`Deep audit and fix hidden platform failures (#24)`). Manual deployment verification is still required to confirm Railway and the frontend host are running this branch after merge.

## Production Symptom / Video Summary

- Public user on macOS Safari completed the request summary.
- Submit entered a loading state.
- UI showed “Failed to submit access request.”
- Owner did not receive an email.
- Request did not appear in the expected approval flow.
- Owner-created accounts still worked in Chrome, Edge, and Firefox.

The repo alone cannot confirm whether the exact production request failed because of stale deploy, Safari local state, duplicate lifecycle state, email provider state, or a transient backend error. The repaired code now exposes controlled reason codes and success-with-warning messaging so that the next production attempt can distinguish those cases.

## Successful Owner Path vs Failing Public Path

| Lifecycle step | Owner/admin-created path | Public request-access path | Findings |
| --- | --- | --- | --- |
| Account creation | Admin/master admin creates or approves account | `POST /api/auth/request-access` creates pending user | Public path must remain unauthenticated. |
| Email | Optional operational notification | Optional access request + requester confirmation | Email remains non-transactional. |
| Approval source of truth | User record in `users` | Pending user record in `users` | Master Admin queue reads from the same `users` source. |
| Login | `POST /api/auth/login` | Same after approval | Login now returns lifecycle-specific reason codes for blocked states. |
| Session | Bearer token in frontend local storage; backend can also set cookies | Same after approval | Public signup/login no longer attach stale bearer tokens. |

## Safari-Specific Findings

- Frontend and backend are cross-origin: `https://app.cognivio.live` to the Railway API.
- The frontend primarily uses bearer tokens from `localStorage`, not cross-site cookies, for authenticated API calls.
- Public signup and login should not depend on cookies, CSRF cookies, or an existing session.
- Safari private browsing/storage behavior can leave users with no local storage or stale form/autofill state. The public request path now avoids attaching old bearer tokens to `request-access`, `login`, password reset, institution lookup, and health/version calls.
- CORS preflight for `POST /api/auth/request-access`, `POST /api/auth/login`, and `POST /api/auth/logout` is covered with `Origin: https://app.cognivio.live` and `content-type, authorization, x-csrf-token` headers.

## Frontend Lifecycle Map

| UI / hook | Route | Backend endpoint | Public/authenticated | Response handling |
| --- | --- | --- | --- | --- |
| `AuthPage` sign up summary | `/login` sign-up tab | `POST /api/auth/request-access` | Public | Shows success, notification warning, duplicate pending, existing account, disabled account, or fallback error. |
| `AuthPage` login | `/login` | `POST /api/auth/login` | Public | Stores token, sets user, then role router sends user to correct home. |
| `AuthProvider.refreshUser` | app init | `GET /api/me` | Authenticated bearer token | Clears local auth on invalid/expired token. |
| `LayoutShell.logout` | app shell | `POST /api/auth/logout` best effort, then local cleanup | Authenticated if token exists | Clears local token/session even if backend cleanup fails. |
| `roleRouter` | after login | frontend-only | Authenticated user object | Teacher -> `/my-workspace`; school/training admin -> `/dashboard`; super admin -> `/master-admin`. |
| `ProtectedRoute` teacher consent gate | teacher protected routes | `GET /api/consent/status` | Teacher authenticated | Redirects to `/consent` only when returned status says consent is incomplete. |

## Backend Lifecycle Map

| Backend route/function | Method/path | Public/authenticated | Success shape | Controlled failure shape |
| --- | --- | --- | --- | --- |
| `request_access_route` | `POST /api/auth/request-access` | Public | `{ ok: true, status: "pending", notification: {...} }` | `HTTPException.detail.reason_code` for duplicate/lifecycle states. |
| `login` | `POST /api/auth/login` | Public | `TokenResponse { token, user }` | 401 invalid credentials; 403 pending/rejected/disabled with reason code. |
| `logout_route` | `POST /api/auth/logout` | Public cleanup endpoint | `{ status: "ok" }` | Best-effort; clears cookies and revokes session when token has a session id. |
| `get_current_user_alias` | `GET /api/me` | Authenticated | current user JSON | 401 invalid/expired token, 403 inactive access. |
| `list_access_users` | `GET /api/admin/access-users` | Admin ops | pending/approved/revoked lists | 403 if not admin ops. |
| `master_admin_approve_user` | `POST /api/master-admin/users/{id}/approve` | Master Admin | approval success with email status | State persists even if email fails. |
| `master_admin_delete_user` | `POST /api/master-admin/users/{id}/delete` | Master Admin | reject/delete success with email status | State persists even if email fails. |

## Public Request-Access Diagnosis

Expected order is now explicit and tested:

1. Validate Pydantic payload.
2. Normalize email to lowercase.
3. Check existing user/request case-insensitively.
4. Reuse rejected/deleted/tombstoned emails by removing reusable records.
5. Persist pending user/request.
6. Send notification helpers.
7. Log `request_access_persisted`.
8. If email delivery failed, log `request_access_notification_failed`.
9. Return success with `notification.sent=false` and `notification.warning="notification_delivery_failed"`.

Root causes repaired:

- Duplicate pending requests could previously look like generic submission failure.
- Approved/disabled/revoked account states could previously look like generic submission failure.
- Email delivery warning was returned as `email_warning` only, which the frontend did not surface as a successful pending request.
- Case-insensitive duplicate/retry handling was not robust enough for mixed-case stored emails.
- Public auth endpoints could inherit stale `Authorization` headers from local storage.

## Institution / Workspace Diagnosis

The signup summary is built from the same local form state used to build the payload:

- `organization_type`
- `organization_name`
- `school_name`
- `requested_manager_email`
- derived `role`

Typed institutions are intentionally allowed. If an existing institution is selected, the suggestion copies organization, school, and manager email into the same payload fields. Approval-time tenant assignment creates or links the organization/school. Empty organization/school requirements are still enforced by the frontend for the school path and by approval-time checks where needed.

## Email / Resend Non-Transactional Audit

Email remains non-transactional:

- Access request persistence happens before notification helpers.
- Missing/failed Resend or SMTP returns `notification.sent=false`, not failed signup.
- Approval and rejection flows already persisted state before email and were covered by existing lifecycle tests.
- Raw provider errors, tokens, and credentials are not returned to users.

New request-access success-with-warning response:

```json
{
  "ok": true,
  "status": "pending",
  "notification": {
    "sent": false,
    "warning": "notification_delivery_failed"
  }
}
```

## Master Admin Pending Queue Audit

The Master Admin queue reads pending users from the `users` collection. A request with failed notification remains visible because the user record is persisted first. Existing tests cover request visibility, approval, rejection/delete, and non-transactional approval/rejection email behavior.

## Login / Authentication Audit

Login remains password + bearer token based. This PR preserves the existing owner/admin-created login path and adds controlled lifecycle errors:

| State | Status | Reason code |
| --- | --- | --- |
| Wrong password / unknown / deleted | 401 | `invalid_credentials` |
| Pending | 403 | `account_pending_approval` |
| Rejected / denied | 403 | `account_rejected` |
| Revoked / inactive / frozen | 403 | `account_disabled` |
| Approved active | 200 | token + user |

`/api/me` is verified after login with the same bearer-token mode the frontend uses.

## Lifecycle / Duplicate Email Audit

| Scenario | Behavior |
| --- | --- |
| Fresh email | Creates pending request. |
| Duplicate pending | 409 with `access_request_already_pending`. |
| Approved active email | 409 with `account_already_exists`. |
| Rejected/denied email | Re-request allowed; reusable record removed. |
| Deleted/tombstoned email | Re-request allowed by existing contract. |
| Revoked/frozen/inactive | Controlled disabled-account response. |
| Mixed-case email | Lookup and reusable cleanup are case-insensitive. |

## Role Routing / Onboarding / Privacy / Profile Gate Audit

No route guard rewrite was required. Current routing remains:

- Teacher: `/my-workspace`, with teacher consent gate only when `/api/consent/status` says consent is incomplete.
- School/training admin: `/dashboard`.
- Master Admin/super admin: `/master-admin`.
- Public auth routes: `/login`, `/request-access`, `/forgot-password`, `/reset-password`, `/privacy`.

Existing baseline route audits cover dashboard/onboarding loop repairs. This PR did not change onboarding/profile/privacy gates.

## CORS / Preflight / CSRF Audit

- CORS defaults include `https://app.cognivio.live`, `https://cognivio.live`, `https://www.cognivio.live`, and local dev origins.
- `OPTIONS` works for request access, login, and logout with Safari-relevant headers.
- Public request-access/login/password-reset remain CSRF-exempt.
- Logout is also CSRF-exempt so cookie-session users can clear session state safely.
- Protected write routes still require CSRF when session cookies are used.

## Root Causes Found

1. Public request-access lifecycle errors were not specific enough for the UI.
2. Notification warnings were not presented as successful persistence.
3. Stale bearer tokens could ride along on public signup/login/lookup requests.
4. Mixed-case existing email records could bypass exact duplicate checks.
5. Logout had no mounted modular `/api/auth/logout` route despite backend cleanup logic existing.

## Fixes Implemented

- Added structured auth error detail objects with safe `reason_code`.
- Added case-insensitive user lookup and reusable email cleanup in auth service.
- Kept request persistence before email and added `notification` response details.
- Added safe auth events for `request_access_persisted`, `request_access_notification_failed`, and blocked login states.
- Added `/api/auth/logout` route and frontend best-effort backend logout call.
- Prevented public endpoints from attaching stale local bearer tokens.
- Added frontend message parser for auth lifecycle reason codes.
- Added request-access UI section messages for notification-warning success and controlled lifecycle failures.

## Tests Added

- `backend/tests/test_login_lifecycle_safari.py`
- `frontend/src/lib/authMessages.test.js`
- `frontend/src/lib/apiClient.test.js`
- `frontend/src/pages/AuthPage.test.js`

## Commands Run and Exact Results

- `python -m pytest backend/tests/test_login_lifecycle_safari.py -q` -> 9 passed, 3 warnings.
- `python -m pytest backend/tests/test_signup_approval_health_hotfix.py backend/tests/test_user_lifecycle_contract.py backend/tests/test_master_admin_auth_audit.py backend/tests/test_end_to_end_app_flow_hotfix.py -q` -> 24 passed, 3 warnings.
- `npm test -- --watchAll=false --runInBand src/lib/authMessages.test.js src/lib/apiClient.test.js src/lib/api.test.js src/pages/AuthPage.test.js` -> 4 suites passed, 14 tests passed. React Router future-flag warnings only.
- `python -m py_compile backend/app/services/auth_service.py backend/app/routers/auth.py backend/server.py` -> passed.
- `python -m pytest backend/tests -q` -> 262 passed, 3 warnings.
- `npm test -- --watchAll=false` -> 21 suites passed, 62 tests passed. React Router future-flag warnings only.
- `npm run build` -> first attempt timed out after about 15 minutes without output.
- `$env:NODE_OPTIONS='--max_old_space_size=4096'; npm run build` -> compiled successfully.
- `npm run lint --if-present` -> no lint script configured; command exited 0.
- `npm run typecheck --if-present` -> no typecheck script configured; command exited 0.
- `python backend/scripts/run_quality_gate.py` -> passed all 5 dimensions across 10 cases. Requests dependency warning only.

## Manual Verification Checklist

Safari request access:

1. Open `https://app.cognivio.live` in Safari.
2. Clear website data or use a fresh profile.
3. Submit public request access with a fresh email and selected known institution.
4. Confirm success message.
5. Confirm request appears in Master Admin pending queue.
6. Confirm notification email arrives if Resend is healthy.
7. Confirm no generic “Failed to submit access request.”

Safari typed institution:

1. Submit with a typed/new institution.
2. Confirm success if allowed, or a controlled validation message if blocked.
3. Confirm no 500 and no generic failure.

Safari login:

1. Approve the request in Master Admin.
2. Log in as newly approved user in Safari.
3. Confirm `/api/me` succeeds.
4. Confirm role routing is correct.
5. Confirm onboarding/privacy/profile gates do not loop.
6. Logout and log back in.

Regression:

1. Repeat request -> approve -> login in Chrome, Edge, and Firefox.
2. Simulate email failure and confirm pending request persists.
3. Submit duplicate pending email and confirm specific pending message.
4. Submit approved existing email and confirm existing-account message.
5. Confirm non-approved states do not reach dashboards.

Network checks:

- `OPTIONS /api/auth/request-access` -> 200.
- `POST /api/auth/request-access` -> JSON success or controlled JSON error.
- `POST /api/auth/login` -> JSON success or controlled JSON error.
- `GET /api/me` after login -> JSON.
- No CORS failures.

## Remaining Risks / Deferred Items

- Full production security hardening, CSRF strategy review, abuse/rate-limit tuning, and tenant-isolation hardening remain deferred to dedicated hardening work.
- This PR does not add real browser automation on Safari; manual Safari verification remains required after deployment.
- Email provider health still depends on production Resend/SMTP environment variables and verified sender/domain configuration.
- This PR does not rewrite auth storage; bearer-token local storage remains the current frontend contract.
