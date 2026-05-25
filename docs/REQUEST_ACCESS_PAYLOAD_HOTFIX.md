# Request-Access Payload Integrity Hotfix

## Executive Summary

This hotfix traces and repairs the public request-access/profile creation flow. The observed production symptom looked like a CORS failure, but current direct checks show backend CORS and validation are working: invalid request bodies reach `/api/auth/request-access` and return structured JSON validation errors. The frontend risk was payload integrity: the final submit path built its payload only from React state, did not require `name` client-side, and could miss browser/password-manager autofill values that are visible in the DOM but not synchronized through `onChange`.

The fix keeps backend validation intact and makes the frontend submit path reconcile current form DOM values into the canonical request state before payload construction. It blocks missing `name`, `email`, or `password` before POST, sends backend field names exactly, and maps backend `422` missing-field responses to a clear validation message.

## Evidence Gathered

- Backend CORS preflight works for `/api/auth/request-access`, `/api/institutions/lookup`, and `/api/auth/login` from `https://app.cognivio.live`.
- Actual invalid `POST /api/auth/request-access` reaches the backend and returns `422` JSON with CORS headers.
- Backend validation requires `email`, `password`, and `name` through the `UserCreate` Pydantic model.
- Direct `{}` testing proves validation/CORS behavior only. It does not prove the production browser sent `{}`.

## What Was Not Assumed

- The production request body was not assumed to be exactly `{}`.
- CORS was not assumed to be broken after direct preflight/POST evidence showed validation responses include CORS headers.
- Login/password verification was not changed because the failing path is public request-access submit, not approved-user login.

## Frontend Flow Traced

Route/page:

- `/login` renders `AuthPage`.
- The request-access/profile creation flow is the `signup` tab in `frontend/src/pages/AuthPage.js`.

State flow:

```text
input fields
  -> canonical AuthPage form state
  -> request summary cards
  -> submit-time FormData reconciliation
  -> signupPayload
  -> requestAccessAsync
  -> authApi.requestAccess
  -> POST /api/auth/request-access
```

Collectors:

- Name: `AuthPage` input `name`, now `name="name"`.
- Email: `AuthPage` input `email`, now `name="email"`.
- Password: `AuthPage` input `password`, now `name="password"`.
- Role: segmented controls produce `derivedRole` as `teacher`, `school_admin`, or `training_admin`.
- Institution type: segmented controls produce `organization_type` as `school` or `training`.
- Institution/school/program: `organization_name` and `school_name`.
- Linked administrator/manager email: optional `requested_manager_email` for teacher requests.
- Summary: `summaryItems` in `AuthPage`; now includes `name` and `email` plus access/institution fields.
- Final submit: `onSubmit` in `AuthPage`.
- API wrapper: `authApi.requestAccess(payload)` in `frontend/src/lib/api.js`.
- Endpoint: `POST /api/auth/request-access`.

Serializer/transformation:

- The API wrapper passes the payload object directly to Axios: `api.post("/api/auth/request-access", payload)`.
- No intentional serializer strips `email`, `password`, or `name`.
- Undefined optional keys are now omitted in the payload builder instead of being included as undefined properties.

Back/forward and autofill findings:

- Tab navigation between login and signup preserves the same component state.
- Before the hotfix, submit relied only on React state, so autofill or password managers could leave visible DOM values out of the payload if no React `onChange` occurred.
- The hotfix reads `FormData` from the form ref during submit and merges non-empty DOM values into canonical state before building the request payload.

## Backend Schema Traced

Route:

- `POST /api/auth/request-access`
- Mounted by `backend/app/routers/auth.py`
- Calls `request_access(user, request)` in `backend/app/services/auth_service.py`
- Request model: `server.UserCreate`

Required model fields:

- `email: EmailStr`
- `password: str`
- `name: str`

Optional accepted fields:

- `role`
- `user_type`
- `institution_type`
- `role_requested`
- `organization_type`
- `organization_name`
- `school_name`
- `training_provider_name`
- `district_or_network`
- `program_or_cohort_name`
- `program_or_department`
- `linked_admin_email`
- `requested_manager_email`

Accepted role behavior:

- `teacher` -> teacher pending request.
- `administrator`, `admin`, `principal`, `school_admin` -> school admin pending request.
- `training_admin` -> training admin pending request.
- `training` / `training_teacher` with `organization_type=training` -> teacher pending request.

Institution behavior:

- `organization_type` is normalized to `school` or `training`; unknown values fall back to `school`.
- Typed/new institution names are accepted as requested fields and stored for approval.
- The current frontend does not submit `institution_id` or `school_id` on public request-access; known institution selection fills display/requested names and optional manager email.

Linked administrator behavior:

- `requested_manager_email` is optional.
- When provided it is normalized and stored as both `requested_manager_email` and `manager_email` on the pending user record.

Responses:

- Success: `200` JSON with `ok: true`, `status: "pending"`, `approval_status: "pending"`, `reason_code: "access_request_pending_review"`, and notification status.
- Duplicate pending: `409` JSON with `detail.reason_code: "access_request_already_pending"`.
- Existing approved account: `409` JSON with `detail.reason_code: "account_already_exists"`.
- Validation error: `422` JSON from Pydantic validation for missing/invalid required model fields.
- Persistence occurs before notification email; notification failure returns success with a warning.

## Payload Comparison Table

| Backend field | Required? | Frontend source | Frontend field name | Sent in payload? | Risk | Fix |
|---|---|---|---|---|---|---|
| `email` | Yes | Email input / DOM FormData | `email` | Yes | Autofill could bypass React state. | Add `name="email"`, submit-time FormData reconciliation, required-field validation. |
| `password` | Yes | Password input / DOM FormData | `password` | Yes | Autofill/password manager could bypass React state. | Add `name="password"`, submit-time FormData reconciliation, required-field validation; never logged. |
| `name` | Yes | Name input / DOM FormData | `name` | Yes | Frontend previously used `form.name || form.email`, masking missing name. | Require name client-side and block submit with clear guidance. |
| `role` / `requested_role` | Optional backend, product-required role choice | Segmented role + institution type | `role` | Yes as `role` | Mismatch risk if sending UI label. | Submit backend role values: `teacher`, `school_admin`, `training_admin`. |
| `organization_type` / `institution_type` | Optional backend, product-required context | Institution type segmented control | `organization_type` | Yes | Mismatch risk if sending display label. | Submit backend values `school` or `training`. |
| `institution_id` | No current model field | Institution suggestion | Not sent | No | Backend/frontend do not currently contract on IDs. | Documented; no hotfix change. |
| `school_id` | No current public model field | Institution suggestion | Not sent | No | Backend approval resolves later. | Documented; no hotfix change. |
| `school_name` | Optional backend, UI required for K-12 | School/program input | `school_name` | Yes when entered | Empty values could be undefined. | Validate for K-12 and omit only when truly optional/empty. |
| `organization_name` | Optional backend, UI required in signup | Organization input | `organization_name` | Yes | Autofill could bypass state. | Add FormData reconciliation and validation. |
| `requested_manager_email` | Optional | Manager email input or institution suggestion | `requested_manager_email` | Yes only when non-empty | Undefined optional property could appear in mock payload. | Omit optional key unless non-empty. |
| `justification` / `reason` | No current model field | Not collected | Not sent | No | Not part of backend contract. | No change. |
| Consent/privacy acknowledgement fields | Not part of current request-access model | Not collected here | Not sent | No | Not a current hotfix contract. | Deferred; outside focused hotfix. |

## Root Cause Found

The concrete frontend failure class was payload construction from potentially stale React state. Browser autofill/password managers can change visible input values without a React `onChange`, so final submit could build an incomplete payload even when the user saw completed fields. A second issue was that `name` was not marked required and the payload builder silently substituted email for missing name, hiding a backend-required field from client-side validation.

## Fix Implemented

- Added a form ref and submit-time `FormData` reconciliation in `AuthPage`.
- Added `name` attributes and `autoComplete` hints for request-access fields.
- Added `onInput` synchronization alongside `onChange` for better autofill/browser compatibility.
- Added a canonical `buildSignupPayload` path used by request-access submit.
- Added client-side validation before POST for `name`, `email`, `password`, `organization_name`, and K-12 `school_name`.
- Added `name` and `email` to request summary cards so visible identity values match submitted payload values.
- Omitted optional undefined fields from the final payload.
- Preserved form input after validation/backend failures.
- Did not log passwords or full payloads.

## Browser/Autofill Handling

The form now has current-value reconciliation at submit time. This means:

- typed values update canonical state through `onChange` and `onInput`,
- autofill-like DOM values are read through `FormData` even if React state missed an event,
- native form submission, button click, and Enter-key browser submission use the same `onSubmit` handler,
- navigating between login and signup does not drop name/email/password state while the component remains mounted.

## Frontend Error Handling Improvements

- Backend `422` responses listing missing `email`, `password`, or `name` now display: "Please complete your name, email, and password before submitting."
- Network/CORS/API unreachable failures continue to display: "Unable to reach Cognivio API from this site. Please open app.cognivio.live and try again."
- Duplicate pending and existing-account reason codes still map to specific lifecycle guidance.
- Generic "Failed to submit access request" remains only as a fallback.

## Backend Changes

No backend validation was weakened. Backend code was not changed for request-access behavior.

Backend tests were added/updated to lock current behavior:

- invalid `{}` request returns `422` JSON with CORS headers,
- duplicate pending request returns structured `409` JSON with CORS headers.

## Tests Added

Frontend tests added/updated:

- request-access sends `email`, `password`, and `name`,
- request-access uses backend field names exactly,
- summary displays canonical identity values sent in payload,
- missing required fields block submit before API call,
- backend `422` missing fields renders clear validation message,
- browser autofill-like DOM values are included on submit,
- tab navigation preserves name/email/password,
- native form submit path sends complete payload,
- API wrapper does not strip required fields,
- password is not written to console output,
- network failure shows API-unreachable message,
- duplicate pending response shows specific guidance.

Backend tests added/updated:

- invalid body `POST /api/auth/request-access` returns `422` JSON with CORS headers,
- duplicate pending request returns readable `409` JSON with CORS headers.

## Commands Run And Exact Results

- `$env:CI='true'; npm test -- --watchAll=false src/pages/AuthPage.test.js src/lib/apiErrors.test.js src/lib/api.test.js` from `frontend` -> first run failed 1 AuthPage payload-key expectation after the fix exposed an optional `requested_manager_email: undefined` key in the mock payload; payload builder was tightened to omit undefined optional fields.
- `python -m pytest tests/test_login_lifecycle_safari.py tests/test_signup_approval_health_hotfix.py -q` from `backend` -> first run failed 2 CORS-header exact-origin assertions because local TestClient returned `*` while still including CORS headers/credentials; assertions were adjusted to verify CORS headers are present without changing backend behavior.
- `$env:CI='true'; npm test -- --watchAll=false src/pages/AuthPage.test.js src/lib/apiErrors.test.js src/lib/api.test.js` from `frontend` -> 3 suites passed / 23 tests passed; React Router future-flag warnings only.
- `python -m pytest tests/test_login_lifecycle_safari.py tests/test_signup_approval_health_hotfix.py -q` from `backend` -> 17 passed, 3 warnings.
- `$env:CI='true'; npm test -- --watchAll=false` from `frontend` -> 24 suites passed / 83 tests passed; React Router future-flag warnings only.
- `$env:CI='true'; npm run build` from `frontend` -> compiled successfully.
- `python -m pytest -q` from `backend` -> 287 passed, 3 warnings.
- `python scripts\run_quality_gate.py` from `backend` -> all 5 quality-gate dimensions passed / 10 cases passed; RequestsDependencyWarning only.
- `npm run` from `frontend` -> available scripts are `start`, `test`, `postinstall`, `start:prod`, `build`, and `eject`; no separate lint or typecheck scripts are configured.
- `git diff --check` from repo root -> passed; Git reported LF-to-CRLF working-tree normalization warnings for modified files.

## Manual Verification Checklist

1. Chrome request-access with typed values.
2. Safari request-access with typed values.
3. Firefox request-access with typed values.
4. Edge request-access with typed values.
5. Browser autofill/password-manager path.
6. Enter-key submit.
7. Back/forward through the signup/login tabs.
8. Failed validation preserves input.
9. Browser Network payload includes `email`, `password`, and `name`.
10. No password appears in console logs.
11. Successful submission appears in Master Admin pending queue.
12. Duplicate pending request shows clear message.
13. Network/CORS failure shows API-unreachable message.

## Remaining Risks / Deferred Items

- A stale deployed frontend bundle could still send the old payload shape until the app is rebuilt and caches expire.
- Public request-access currently submits typed institution names, not stable institution IDs; approval-time resolution remains the backend source of truth.
- Manual Safari/password-manager verification is still required because jsdom can simulate DOM value reconciliation but not every native autofill implementation.
