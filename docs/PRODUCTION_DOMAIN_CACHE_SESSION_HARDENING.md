# Production Domain, Cache, and Session Hardening

This document records the PR 26 Pass 2 production session and frontend hardening decisions.

## Canonical Auth Transport

Cognivio is bearer-token-first for PR 26.

Current canonical behavior:

- `POST /api/auth/login` is public and does not require cookies.
- Login returns a JWT token in JSON.
- The frontend stores the token as `cognivio_token` in local storage.
- The Axios API client attaches `Authorization: Bearer <token>` to protected API routes.
- `/api/me` accepts bearer tokens and returns the current user.
- Public request-access, login, password reset, institution lookup, and health/version calls do not attach stale bearer tokens.
- Logout calls `POST /api/auth/logout` best effort, then clears local auth state.
- Protected `401` responses clear local auth, clear preview mode, dispatch a stale-session event, and route the app back through normal auth guards.

## Cookie And CSRF Status

The backend can set session and CSRF cookies and can read session cookies as a compatibility fallback. This is not the canonical browser transport in PR 26 Pass 2.

Cookie-first migration is deferred because it requires a full cross-site Safari validation plan:

- `SameSite=None; Secure` for cross-site app/API cookies,
- coherent CSRF token issuance and refresh,
- CORS `credentials` behavior for every protected route,
- logout and session revocation across browsers,
- cookie storage behavior under Safari privacy restrictions.

Until that migration is intentionally completed, bearer-token-first remains the documented stable strategy.

## Canonical Domains

| Surface | URL | Behavior |
|---|---|---|
| Marketing/root | `https://cognivio.live` | Marketing pages only. App routes redirect to app domain if the app shell is accidentally served here. |
| Marketing/root www | `https://www.cognivio.live` | Marketing pages only. App routes redirect to app domain if the app shell is accidentally served here. |
| App | `https://app.cognivio.live` | Public auth plus authenticated Cognivio app. |
| API | `https://api.cognivio.live` preferred, transitional Railway backend allowed until cutover | Single API base configured by `REACT_APP_BACKEND_URL` or runtime config. |

Marketing site redirects already point `/login`, `/signup`, `/request-access`, and `/app` to `https://app.cognivio.live/login`. Pass 2 also adds app-shell protection: if app code is served from `cognivio.live` or `www.cognivio.live` on a known app route, it redirects to `https://app.cognivio.live` while preserving path, query, and hash.

## CORS Origin Requirements

Backend CORS must allow:

- `https://app.cognivio.live`
- `https://cognivio.live`
- `https://www.cognivio.live`
- local development origins used by the runbook

Production must not use wildcard CORS with credentials.

## Service Worker And Cache Strategy

Pass 2 changes the service worker to avoid stale app shells:

- no pre-cache of `/` or `/index.html`,
- no API caching,
- no auth-route caching for `/login`, `/request-access`, or `/reset-password`,
- navigation requests use network-only with `cache: "no-store"`,
- only same-origin `/static/` assets are cached,
- cache name is versioned as `cognivio-static-v2`,
- activation deletes old cache names and claims clients.

This keeps static asset caching without letting Safari or Chromium browsers remain trapped on an old login shell.

## Stale Token And Session Cleanup

The frontend API client normalizes errors globally. For protected requests:

- `401` responses that are not public login failures are treated as stale sessions,
- local `cognivio_token` is removed,
- preview mode is cleared,
- `cognivio:auth-stale` is dispatched,
- the auth provider clears user state, clears React Query cache, and shows a controlled session message.

Public login `401 invalid_credentials` remains an auth failure and does not clear unrelated local state as a stale session event.

## Global API Error Behavior

Pass 2 standardizes frontend error normalization for:

- `400`: check request and try again,
- `401`: stale session unless backend reason says invalid credentials,
- `403`: lifecycle-specific pending/rejected/disabled messages or tenant access message,
- `409`: duplicate request/account message,
- `422`: validation guidance,
- `429`: retry later/rate-limited guidance,
- `500`: controlled support-oriented message,
- network/CORS/timeout: API unreachable guidance that points users to `app.cognivio.live`.

Backend `reason_code`, `detail`, and `action` are preserved when safe.

## Production Console And Log Redaction

Frontend production console cleanup:

- missing backend URL console errors are development-only,
- service worker registration warnings are development-only,
- route mismatch warnings remain development-only,
- safe build marker remains available at `window.__COGNIVIO_BUILD__`.

Backend log redaction remains a Pass 5 production checklist item, with special attention to passwords, bearer tokens, cookies, API keys, signed video URLs, transcripts, and raw request payloads.

## Pass 5 Operational Addendum

- Rate limiting now returns structured JSON with `reason_code`, `retry_after`, and a user-safe message for endpoint-specific and general POST limits.
- Baseline app-level limits cover login, request access, password reset request, institution lookup, video upload, teacher reference image upload, framework rubric upload, demo seed, report export, and admin lifecycle actions.
- These limits are intentionally local-process safeguards. Production should add distributed enforcement at the proxy/Redis layer before a high-volume pilot so multiple Railway replicas share counters.
- DB/index readiness is exposed only to Master Admin through `/api/admin/db-health`; failures include collection/index names and error types, not secrets or connection strings.
- The final production checklist lives in `docs/PRODUCTION_SECURITY_PRIVACY_CHECKLIST.md`.

## Browser Behavior Matrix

| Browser | Expected auth behavior | Pass 2 status |
|---|---|---|
| Safari | Public login/signup require no cookies; bearer token is used after login; stale token clears on protected `401`; service worker cannot cache login shell. | Implemented and covered by targeted frontend plus existing Safari-like backend tests; manual Safari verification still required. |
| Chrome | Same bearer-token-first behavior; service worker cache does not trap app shell. | Implemented and test-covered. |
| Firefox | Same bearer-token-first behavior; no cookie dependency for public auth. | Implemented and test-covered through transport-level tests. |
| Edge | Same bearer-token-first behavior as Chromium; service worker avoids auth/API cache. | Implemented and test-covered through transport-level tests. |

## Manual Browser Verification

After deployment:

1. Clear Safari website data and open `https://app.cognivio.live/login`.
2. Confirm login works and `/api/me` succeeds.
3. Manually place a stale token in local storage, reload, and confirm the app returns to login with a session message.
4. Open `https://cognivio.live/login?next=%2Fdashboard#test` and confirm redirect to `https://app.cognivio.live/login?next=%2Fdashboard#test`.
5. Repeat with `https://www.cognivio.live/login`.
6. Confirm service worker cache does not contain `/`, `/index.html`, `/api/*`, or auth routes.
7. Confirm network/CORS failure is not displayed as invalid credentials.
8. Confirm production console has no sensitive payloads, tokens, cookies, transcripts, or private video URLs.
