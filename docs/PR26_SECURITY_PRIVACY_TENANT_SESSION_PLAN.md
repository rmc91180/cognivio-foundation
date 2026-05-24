# PR 26 Security, Privacy, Tenant Isolation, and Production Session Hardening Plan

This document prepares PR 26, the implementation effort historically referred to in the roadmap as "PR 14." The actual branch, docs, commit, and pull request language must use PR 26.

## Executive Summary

PR 26 is a five-pass hardening sequence that turns the current demo-ready Cognivio surface into a production-hardened baseline for pilot data. Pass 1 is architecture and policy mapping only. It converts the Privacy Policy obligations, recent production lessons, and security roadmap into a concrete implementation sequence for later passes.

The current codebase already includes important foundations: approval-based auth, session records, CORS defaults, safe health/version checks, teacher profile/reference image flows, privacy blur processing, consent records, tenant-scoped teacher/video helpers, demo seed scoping, Master Admin readiness surfaces, dependency health, rate-limit middleware, and MongoDB index creation. Those foundations are not enough for pilot data until PR 26 verifies and hardens enforcement end to end.

## Why PR 26 Comes Before Backend Decomposition

Backend decomposition should not happen while security and privacy contracts are still moving. PR 26 comes first because decomposition would otherwise spread uncertain rules across more modules:

- auth/session state must be stable before splitting routers and services,
- privacy and consent gates must be authoritative before extracting video workflows,
- tenant isolation must be tested before replacing repository boundaries,
- demo/real data boundaries must be explicit before any broad refactor changes query shapes,
- route/API error behavior must be stable before new service seams are introduced.

## Current Production Lessons Learned

Recent stabilization work surfaced the same pattern several times:

- stale frontend bundles and service workers can keep users on old login or route shells,
- users can arrive at wrong-origin app routes on root or `www` domains,
- CORS and API-base mismatch can look like auth failure,
- route contract drift can leave frontend pages calling unmounted or differently shaped endpoints,
- valid empty settings data can become a production 500 if optional config is assumed,
- dashboard/onboarding/profile gates can create loops when missing optional data is treated as fatal,
- demo seed controls can be hidden if eligibility does not flow through stable endpoints,
- classroom video and reference images need stronger tenant, privacy, and access auditing before pilot data.

## Canonical Production Architecture

Canonical domains for PR 26:

| Surface | Canonical URL | Expected behavior |
|---|---|---|
| Marketing/root | `https://cognivio.live` | Public marketing and non-app pages only. App routes should redirect to the app domain or show a safe handoff. |
| Marketing/root www | `https://www.cognivio.live` | Same as root. Wrong-origin app routes should not create stale app shells. |
| App | `https://app.cognivio.live` | Authenticated React app and public auth/request-access surfaces. |
| API | `https://api.cognivio.live` preferred; current transitional Railway backend if not yet cut over | One documented backend base for the app bundle. |

Transitional behavior:

- wrong-origin app routes on root or `www` should redirect to `https://app.cognivio.live` or be temporarily supported without caching a stale shell,
- service worker cache must not intercept API/auth calls,
- service worker shell cache must be versioned or invalidated during deploy,
- CORS must allow intended app origins without wildcard credentials,
- `/api/health/version` and `window.__COGNIVIO_BUILD__` should make stale deployment diagnosis possible without exposing secrets.

## Auth/Session Strategy To Audit In Pass 2

Existing state:

- frontend stores bearer tokens in local storage,
- backend can create session records and cookies,
- public auth endpoints now avoid stale bearer headers,
- `/api/auth/logout` exists and frontend calls it best-effort,
- CORS preflight for auth endpoints is covered by recent tests,
- CSRF exemptions exist for public auth and demo paths.

Pass 2 must decide and verify:

- whether production relies on bearer token only, cookie session only, or a controlled hybrid,
- cookie `SameSite`, `Secure`, max age, and logout behavior for Safari,
- stale-token cleanup on 401/403 and global API error handling,
- session revocation for Master Admin support actions,
- domain redirects and API base consistency,
- service worker cache invalidation and API bypass,
- console cleanup so production logs do not leak sensitive state.

## Pass 2 Auth Transport Decision

Pass 2 keeps Cognivio bearer-token-first.

Canonical behavior:

- public request-access and login do not require cookies,
- login returns a JWT token in JSON,
- the frontend stores the token as `cognivio_token`,
- the frontend sends `Authorization: Bearer <token>` on protected API calls,
- `/api/me` accepts the bearer token,
- protected `401` responses clear local auth and return users to login through normal auth guards,
- logout calls backend cleanup best effort and clears local state.

Cookie/session status:

- backend session records and session/CSRF cookies exist and remain supported as compatibility infrastructure,
- cookie-first auth is not the production canonical strategy in this pass,
- a future cookie-first migration must validate `SameSite=None; Secure`, CORS credentials, CSRF token refresh, Safari storage behavior, and logout/session revocation before becoming canonical.

Browser behavior matrix:

| Browser | Expected behavior in PR 26 Pass 2 | Verification |
|---|---|---|
| Safari | No cookies required for public auth; bearer token works after login; stale token clears; service worker does not cache login shell. | Targeted frontend tests plus existing Safari-like backend auth tests; manual Safari verification still required. |
| Chrome | Same bearer-token-first behavior; static cache cannot trap app shell. | Targeted frontend tests. |
| Firefox | Same bearer-token-first behavior; public auth does not need cookies. | Targeted frontend tests. |
| Edge | Same Chromium behavior; stale token cleanup and service-worker bypass apply. | Targeted frontend tests. |

## Privacy Policy Implementation Map Summary

The full row-by-row map lives in [PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md](./PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md).

Highest-priority obligations for PR 26:

- classroom video/audio access and unblurred asset access auditing,
- destructive student face blurring and source retention cleanup,
- biometric/reference-image purpose limitation,
- AI outputs as informational and reflection-only,
- Gold Star/exemplar sharing authorization and unblurred certification,
- Student Data purpose limitation and no unrelated profiling,
- school access/export/delete and privacy request handling,
- tenant isolation for teacher/admin/master admin boundaries,
- demo/real data separation in counts, seed paths, and dashboards.

## Implementation Sequence

### Pass 2: Auth, Session, Domain, Service Worker, API Error, Console Cleanup

Goals:

- finalize production auth/session strategy,
- ensure Safari and cross-site behavior are reliable,
- add global frontend API error interceptor and stale-token cleanup,
- harden domain redirects and API base detection,
- update service worker so stale app shells and API interception cannot trap users,
- remove or gate production console output.

Deliverables:

- auth/session decision record,
- backend and frontend changes for stale-token cleanup,
- service worker version/cache controls,
- wrong-origin redirect or safe-handoff implementation,
- global API error handling,
- production console cleanup,
- targeted tests for Safari-like auth, logout, 401 cleanup, service worker/API bypass, and domain behavior.

### Pass 3: Privacy, Consent, Destructive Blurring, Biometric, AI, Gold Star Controls

Goals:

- enforce privacy/consent gates at upload, processing, playback, and sharing points,
- verify destructive blur/source retention workflow,
- limit teacher reference images and face signatures to privacy blur,
- add unblurred exemplar certification controls,
- strengthen AI informational/reflection-only safeguards,
- formalize privacy request, policy version, and consent version behavior.

Deliverables:

- privacy upload/playback/share policy helpers,
- reference image purpose and retention enforcement,
- raw source purge verification and audit events,
- exemplar unblurred block/certification fields,
- policy version and re-consent plan or implementation,
- tests for blur status, consent withdrawal, unblurred blocking, Gold Star authorization, and privacy request tracking.

### Pass 4: Tenant Isolation, Video Access, Demo/Real Boundary, Audit Script

Goals:

- prove tenant isolation across teacher, school admin, training admin, and Master Admin surfaces,
- audit every video, comment, transcript, report, recognition, and export route,
- ensure demo data cannot pollute real customer counts or be seeded into real workspaces by non-demo users,
- add or update a route/API/tenant contract audit script.

Deliverables:

- centralized tenant scope helpers where practical,
- route-level video access audit,
- demo/real boundary tests,
- export/share/report scope tests,
- route/API contract audit script or curated test list,
- regression checklist for all high-risk data routes.

### Pass 5: Rate Limiting, MongoDB Indexes, DB Health, Checklist, Final Regression

Goals:

- tune rate limits for public auth/signup, login, uploads, and demo seed,
- verify MongoDB indexes and DB health diagnostics,
- ensure operational checks expose safe status only,
- complete production security checklist and final regression.

Deliverables:

- rate-limit matrix and tests,
- index verification script or health endpoint,
- DB health and dependency readiness checks,
- production security checklist,
- final end-to-end regression results and manual verification checklist.

## Acceptance Criteria For Full PR 26

PR 26 is complete only when all of the following are true:

- Safari, Chrome, Edge, and Firefox login/logout/session lifecycle are reliable.
- Wrong-origin app routes do not trap users in stale app shells.
- Service worker/cache does not intercept API/auth and can be safely invalidated.
- Global API errors produce controlled user-facing messages and stale auth cleanup.
- Production console output is safe and minimal.
- Public auth and upload endpoints have appropriate abuse/rate limiting.
- MongoDB indexes and DB health checks cover high-traffic and privacy-sensitive collections.
- Privacy/consent gates are enforced consistently across upload, processing, playback, share, and export.
- Destructive blur/source retention behavior is tested and auditable.
- Teacher reference images are purpose-limited and retention-limited.
- Gold Star/exemplar sharing requires teacher authorization, privacy-complete status, admin review, and unblurred certification when applicable.
- Tenant isolation is proven for teacher, school admin, training admin, and Master Admin surfaces.
- Demo data cannot contaminate real counts and demo seed cannot mutate real workspaces for non-demo users.
- A production security checklist and manual verification plan are complete.

## Deferred Items Policy

Critical or high-risk privacy obligations should not be deferred out of PR 26. If a later pass must defer one, the PR must document:

- reason for deferral,
- compensating product or operational control,
- future target PR,
- owner and manual verification step,
- whether pilot/customer data may be used before completion.

Medium and low items can be deferred when they do not block safe pilot operation, but they still need a named follow-up.

## Test Strategy

Passes 2 through 5 should use layered tests:

- backend contract tests with the actual mounted FastAPI app,
- CORS/preflight tests for app origins,
- auth/session lifecycle tests including Safari-like no-cookie and stale-token cases,
- tenant isolation tests for every core data class,
- privacy pipeline and retention tests,
- frontend tests for global API errors, seed visibility, service worker behavior where practical, and safe empty states,
- route/API audit script or curated route contract test list,
- quality gate and build checks before PR completion.

## Manual Verification Strategy

Manual verification should use demo/internal accounts only until PR 26 is complete:

- Safari cleared-site-data login, signup, logout, and stale history checks,
- wrong-origin route checks on root and `www`,
- app domain API base and health/version checks,
- teacher video own/cross-video checks,
- admin same-tenant/cross-tenant checks,
- privacy upload, reference image, blur status, and playback checks,
- Gold Star/exemplar opt-in, review, sharing, and revoke checks,
- demo seed eligible/non-eligible checks,
- Master Admin dependency, DB health, AI quality, and readiness checks.

## Deployment Verification Notes

Repository inspection cannot prove deployed state. Each pass must document:

- Railway backend commit/build and `/api/health/version`,
- frontend build SHA via `window.__COGNIVIO_BUILD__`,
- Cloudflare/app hosting cache invalidation,
- `REACT_APP_BACKEND_URL` or runtime API base,
- `CORS_ORIGINS` and allowed app origins,
- session cookie env values if cookies are enabled,
- privacy worker env values,
- Resend/OpenAI/R2/Mongo readiness without exposing secrets.

## Pass 1 Handoff to Pass 2

Files created or updated in Pass 1:

- `docs/PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md`
- `docs/PR26_SECURITY_PRIVACY_TENANT_SESSION_PLAN.md`
- `docs/INTERNAL_TESTING_RUNBOOK.md`

High-priority Pass 2 tasks:

- finalize bearer-token vs cookie-session production strategy,
- add stale-token cleanup and global API error interceptor,
- harden logout/session revocation across Safari and Chromium browsers,
- fix service worker cache policy so stale shells and API/auth interception cannot occur,
- implement wrong-origin app route redirect or safe handoff,
- remove or gate production `console.*` output,
- verify CORS/API-base/domain behavior in deployed staging.

Known auth/session/domain/service-worker risks:

- frontend still uses local storage bearer tokens, which can become stale across browsers and domains,
- backend has cookie/session settings, but production strategy needs a single documented authority,
- `frontend/public/service-worker.js` currently caches `/` and `/index.html` under a static cache name and can serve stale shells offline,
- API base is runtime/build configured and must be checked in deploys,
- root and `www` wrong-origin app paths need explicit redirect or safe fallback behavior.

Current uncertainty:

- whether production will use `https://api.cognivio.live` or the transitional Railway backend as canonical API base for PR 26,
- whether root/`www` hosting is controlled by the same app bundle or a separate marketing deployment,
- whether real pilot deployments will enable cookie sessions in addition to bearer tokens,
- whether backups/archive deletion constraints are controlled by Railway/Mongo/R2 operational policies outside the repo.

Commands run in Pass 1:

- `git status --short; git branch --show-current; git remote -v` -> clean worktree on previous branch before switching.
- `git fetch origin main` -> latest main fetched; `origin/main` advanced to `35694c1`.
- `git switch --create pr26-security-privacy-tenant-session-hardening origin/main` -> branch created from latest main.
- `rg -n "PR26|PR 26|PR14|PR 14|SECURITY_PRIVACY|PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS|SECURITY_PRIVACY_TENANT_SESSION" docs backend frontend -S` -> no existing PR 26 artifacts found.
- Code audit searches for privacy, consent, blur, biometric, reference image, recognition/exemplar, tenant, demo data, auth, CORS, service worker, rate limits, indexes, DB health, audit logs, export/delete/retention, transcript/audio, framework, and report terms.
- `git diff --check` -> passed; Git reported only the existing Windows line-ending normalization warning for `docs/INTERNAL_TESTING_RUNBOOK.md`.
- Docs lint/check -> no docs-specific lint command is configured in root `package.json` or `frontend/package.json`.

Tests not run and why:

- No backend or frontend code was changed in Pass 1.
- Full unit/build suites were intentionally deferred because this pass is documentation and implementation planning only.
- Lightweight diff hygiene was run with `git diff --check`.

## Pass 2 Handoff to Pass 3

Files changed in Pass 2:

- `frontend/src/lib/apiErrors.js`
- `frontend/src/lib/apiClient.js`
- `frontend/src/lib/authMessages.js`
- `frontend/src/lib/domainHardening.js`
- `frontend/src/hooks/useAuth.js`
- `frontend/src/index.js`
- `frontend/public/service-worker.js`
- targeted frontend tests under `frontend/src/lib`
- `docs/PRODUCTION_DOMAIN_CACHE_SESSION_HARDENING.md`
- `docs/PR26_SECURITY_PRIVACY_TENANT_SESSION_PLAN.md`
- `docs/PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md`
- `docs/INTERNAL_TESTING_RUNBOOK.md`

Auth/session decisions:

- Canonical transport remains bearer-token-first.
- Cookie/session support remains compatibility infrastructure and is not promoted to canonical production auth in Pass 2.
- Cookie-first migration is deferred until a dedicated pass can validate cross-site Safari cookie behavior, CSRF refresh, CORS credentials, and logout revocation.

Domain/cache/service-worker status:

- App routes served from `cognivio.live` or `www.cognivio.live` redirect to `https://app.cognivio.live` with path/query/hash preserved.
- Marketing-site redirects already send `/login`, `/signup`, `/request-access`, and `/app` to the app domain.
- Service worker no longer pre-caches `/` or `/index.html`.
- Service worker bypasses `/api/*`, `/login`, `/request-access`, and `/reset-password`.
- Navigation requests use network-only `cache: "no-store"`.

Global API error status:

- Frontend API errors are normalized in one place.
- Network/CORS/timeout failures are no longer presented as wrong credentials.
- Protected stale/expired token `401` responses clear local auth, clear preview mode, dispatch a stale-session event, clear React Query cache, and show a controlled message.
- Backend reason codes remain preserved for invalid credentials, pending approval, rejected account, disabled account, duplicate request, tenant denial, validation errors, rate limits, and server failures.

Console/log cleanup status:

- Missing backend URL and service-worker registration console messages are development-only.
- Safe build diagnostics remain at `window.__COGNIVIO_BUILD__`.
- Backend log redaction review remains for Pass 5, with special attention to tokens, cookies, API keys, signed video URLs, transcripts, and raw request payloads.

Remaining risks:

- Manual Safari browser verification is still required after deployment.
- `https://api.cognivio.live` vs transitional Railway backend must be confirmed before production cutover.
- Root/`www` hosting redirect behavior outside the React app still depends on hosting configuration.
- Cookie-first auth migration remains intentionally deferred.

Commands run in Pass 2:

- `git status --short; git branch --show-current; git rev-parse --short HEAD; git log --oneline -3` -> confirmed branch `pr26-security-privacy-tenant-session-hardening` at Pass 1 commit `64f5cb6`.
- Read Pass 1 docs: `docs/PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md`, `docs/PR26_SECURITY_PRIVACY_TENANT_SESSION_PLAN.md`, and `docs/INTERNAL_TESTING_RUNBOOK.md`.
- Code audit searches for auth/login/logout, `/api/me`, bearer/cookie/session/CSRF, service worker, cache, canonical domains, API base, console output, and production URLs.
- `$env:PYTHONPATH='backend'; $env:PYTHONIOENCODING='utf-8'; python -m pytest backend/tests/test_login_lifecycle_safari.py backend/tests/test_teacher_admin_endpoint_stability.py -q` -> 35 passed, 3 warnings.
- `$env:CI='true'; npm test -- --watchAll=false --runInBand src/lib/apiClient.test.js src/lib/apiErrors.test.js src/lib/authMessages.test.js src/lib/domainHardening.test.js src/lib/serviceWorkerPolicy.test.js src/pages/AuthPage.test.js` -> 6 suites passed / 18 tests passed; React Router future-flag warnings only.
- `$env:CI='true'; npm test -- --watchAll=false` from `frontend` -> 24 suites passed / 74 tests passed; React Router future-flag warnings only.
- `$env:CI='true'; npm run build` from `frontend` -> compiled successfully.
- `$env:PYTHONPATH='backend'; $env:PYTHONIOENCODING='utf-8'; python backend\scripts\run_quality_gate.py` -> all 5 quality dimensions passed across 10 cases; Requests dependency warning only.
- `$env:PYTHONPATH='backend'; $env:PYTHONIOENCODING='utf-8'; python -m pytest backend/tests -q` -> 262 passed, 3 warnings.
- `git diff --check` -> passed; Git reported Windows line-ending normalization warnings only.

Tests not run and why:

- No service-worker browser automation was run; service-worker behavior is covered by static contract tests and requires deployed-browser manual verification.

Pass 3 should consume:

- the privacy obligations map in `docs/PRIVACY_POLICY_DEVELOPMENT_REQUIREMENTS.md`,
- the bearer-token-first decision and stale session behavior from this handoff,
- the service-worker/auth-route bypass behavior as a baseline,
- the global API error normalization helper for privacy/consent UI failures,
- and the following high-priority privacy tasks: privacy/consent upload gates, destructive blur/source retention verification, biometric/reference image purpose limits, AI reflection-only guardrails, Gold Star/exemplar authorization, unblurred exemplar certification, and privacy request/policy-version controls.
