# PR 26 Production Security and Privacy Checklist

This checklist consolidates the final PR 26 operational readiness state. It is not a certification; it is the deploy/pilot verification checklist for the platform hardening work.

Status values:

- implemented: code and tests exist in PR 26 or before PR 26.
- partially implemented: baseline control exists, but production/manual or future work remains.
- deferred: not implemented in PR 26; compensating control and follow-up are required.
- manual operational control required: the control depends on deployment configuration, staff procedure, or infrastructure outside this repo.

| Area | Status | Verification / control | Remaining action |
|---|---|---|---|
| Auth/session strategy | implemented | Bearer-token-first auth remains canonical; public signup/login do not require cookies; stale token cleanup and logout are covered by Pass 2 tests. | Manual browser regression after deploy. |
| Canonical domains | partially implemented | Docs define `cognivio.live`/`www` as marketing and `app.cognivio.live` as app; wrong-origin app routes are redirected/safely guided in frontend config. | Verify Cloudflare/hosting redirects in production. |
| API base URL | partially implemented | Frontend API diagnostics and `/api/health/version` expose safe build/API hints. | Confirm production env points to the canonical Railway/API base or future `api.cognivio.live`. |
| CORS origins | implemented | Production and local origins are allowlisted; critical preflight tests cover app origin. | Confirm Railway env has no unsafe wildcard override. |
| Service worker/cache plan | partially implemented | Pass 2 prevents service worker from trapping API/auth and documents cache clearing. | Verify deployed stale-cache behavior in Safari/Chrome/Firefox/Edge. |
| Global API error behavior | implemented | Frontend interceptor normalizes auth, lifecycle, rate-limit, stale-session, tenant denial, and network/CORS failures. | Continue adding endpoint-specific reason codes. |
| Rate limits | partially implemented | App-level baseline endpoint limits protect login, request-access, password reset, institution lookup, uploads, framework uploads, demo seed, report exports, and admin lifecycle actions; 429 responses are JSON-shaped. | Add Redis/proxy-backed distributed limits before high-volume pilot. |
| Secret handling | implemented | Health/dependency probes expose only safe config presence, reason codes, and error types. | Rotate secrets before pilot and verify logs in Railway. |
| Production console/log redaction | partially implemented | Pass 2 removed/noised down frontend console output; backend auth/privacy events use reason codes and sanitized identifiers. | Review Railway logs before pilot for raw payload/video URL leakage. |
| DB indexes | implemented | `backend/scripts/ensure_indexes.py` centralizes critical MongoDB index specs and startup uses it idempotently. | Run index creation against production/staging Atlas and review missing index health. |
| DB health/readiness | implemented | Master Admin DB health checks expected/existing/missing indexes and sanitizes failures; dependency health remains safe. | Verify `/api/admin/db-health` as Master Admin in staging/production. |
| Privacy/consent gates | partially implemented | Upload privacy gate and consent/readiness status exist; missing setup returns controlled guidance. | Complete policy-version re-consent workflow. |
| Mobile upload privacy gate | implemented | Mobile/desktop upload share privacy enforcement through the backend upload path. | Manual mobile upload verification after deploy. |
| Reference image privacy guardrails | implemented | Reference image metadata is purpose-limited to privacy blur workflow; copy avoids auth/surveillance/tracking claims. | Verify retention purge operationally. |
| Destructive blurring status | partially implemented | New uploads default destructive blurring state fields and readiness warnings; raw access respects deleted state. | Physical unblurred source deletion worker remains deferred. |
| Unblurred video access rules | implemented | Raw/unblurred access requires reason, tenant access, and emits grant/deny audit events. | Add time-bound support override if needed in future PR. |
| Biometric processing restrictions | implemented | Forbidden biometric purposes and persistent biometric fields are rejected by helpers/tests. | Verify worker temp artifact cleanup in production pipeline. |
| Non-identifiable data controls | partially implemented | Export helper blocks raw media/transcript/direct identifiers and marks no-reidentification metadata. | Add small-cell suppression across all aggregate reports. |
| AI output safeguards | implemented | Pass 3 validators block determinative/prohibited AI fields and phrases in key outputs. | Continue content QA on new report surfaces. |
| Gold Star authorization | implemented | Teacher authorization plus institution/admin review are required before exemplar publication. | Consent-document upload UI remains deferred for unblurred publication. |
| Tenant isolation test matrix | implemented | Pass 4 backend tests cover video, audio, comments, reports, demo counts, and deleted users. | Expand tests as routes are decomposed. |
| Video access rules | implemented | Video, raw access, comments, transcript/audio, and exports are scoped/audited. | Add `video_downloaded` event when direct download route exists. |
| Demo/real data boundaries | implemented | Demo seed is permissioned/idempotent/audited; real counts exclude demo data. | Verify production demo workspaces after deploy. |
| Export/delete/data custody status | partially implemented | Tenant-scoped report exports exist and are audited; deletion/tombstone handling exists for users. | Formal school data export/delete request workflow remains future work. |
| Individual rights request handling status | partially implemented | Privacy/contact handling is documented and notification persistence rules exist. | Add first-class privacy request queue and SLA tracking. |
| Subprocessor/infrastructure notes | partially implemented | MongoDB, R2/S3, Resend, OpenAI, Railway/runtime health are documented with sanitized checks. | Maintain vendor inventory outside code repository. |
| Incident response notes | manual operational control required | Master Admin dependency/readiness surfaces and audit logs support triage. | Create operational incident runbook and owner rotation. |
| Manual pilot-readiness verification | manual operational control required | Browser/domain/auth/privacy/tenant/operations checklist is in the internal runbook. | Complete checklist in staging and production before pilot data. |

## Manual Pilot-Readiness Verification

Browsers:

1. Safari clean cache login.
2. Safari stale cache/wrong-origin route.
3. Chrome login.
4. Firefox login.
5. Edge login.

Domains:

1. `https://cognivio.live` Login routes to `https://app.cognivio.live/login`.
2. `https://www.cognivio.live/login` redirects or is safely supported.
3. `https://app.cognivio.live/login` works.
4. API CORS works from `https://app.cognivio.live`.
5. Service worker does not trap auth/API.

Auth/API:

1. Login and logout.
2. Stale token cleanup.
3. Expired token cleanup.
4. Request access.
5. Pending/rejected/disabled messages.
6. Global API error messages.
7. Rate-limit response shows controlled retry guidance.

Privacy:

1. Admin privacy setup.
2. Mobile upload privacy gate.
3. Reference image warning/state.
4. Destructive blur state visible.
5. Unblurred access audited.
6. Biometric prohibited uses blocked.
7. Gold Star authorization required.

Tenant:

1. Teacher own video allowed.
2. Other teacher video denied.
3. Admin same tenant allowed.
4. Admin cross tenant denied.
5. Transcript/audio/report scoped.
6. Export scoped.
7. Demo data excluded from real counts.

Operations:

1. Rate limits.
2. DB health.
3. Index check.
4. Internal readiness.
5. No sensitive console logs.
6. No secrets in health output.
