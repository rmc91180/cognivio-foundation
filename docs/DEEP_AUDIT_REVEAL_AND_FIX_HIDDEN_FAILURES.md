# Deep Audit, Reveal, and Fix Hidden Failures

## 1. Executive Summary

This audit was completed on the `deep-audit-reveal-and-fix-hidden-failures` branch from `main` commit `161d693` (`Audit, reveal, and fix platform baseline flows (#23)`).

The visible production symptom is the Admin Settings Framework selection card showing:

- `Something went wrong`
- `Failed to load frameworks. Please refresh.`

The source trace shows that exact card is rendered by `frontend/src/pages/FrameworksPage.js` when `frameworkApi.list()` rejects. That call maps to `GET /api/frameworks`. The route exists under `/api`, so the remaining failure class is not a missing route. The deeper repair removes the framework-list cache wrapper as a production-risk point, hardens framework settings route assumptions, adds controlled admin role handling, contains frontend section failures with retry, and adds build/version detection helpers.

## 2. Production Symptoms

- Admin Settings Framework selection still showed a failure after the prior merge.
- The reported network request was `GET /api/frameworks -> 500`, not a CORS failure.
- Prior route/CORS/demo repairs were re-verified instead of assumed.

## 3. Deployment and Version Alignment Findings

- Latest local `main` includes PR #23 and the prior PR #21/#22 endpoint repairs.
- Backend exposes `GET /api/health/version`.
- This branch improves the health payload with safe top-level `commit_sha` and `build_id` fields, while preserving the existing health shape.
- The frontend now exposes `window.__COGNIVIO_BUILD__` and logs `Cognivio build` outside tests so stale bundles can be identified in production.

Manual deployment checks still required:

- Railway backend deployed from latest `main`.
- Frontend app rebuilt from latest `main`.
- `app.cognivio.live` is not serving stale JS.
- Cloudflare/hosting cache is not serving an old bundle.
- Backend allowed origins include `https://app.cognivio.live`, `https://cognivio.live`, and `https://www.cognivio.live`.
- Frontend env points to the correct Railway API base URL.

## 4. Framework Selection Root Cause

Confirmed source path:

| UI Text | Component | Query | Endpoint |
| --- | --- | --- | --- |
| `Framework selection` | `FrameworksPage` | `frameworkApi.list()` | `GET /api/frameworks` |
| `Something went wrong` | `ErrorState` default title | React Query error state | n/a |
| `Failed to load frameworks. Please refresh.` | `frameworksPage.frameworksLoadFailed` | React Query error state | n/a |

Root causes and risks found:

- The route existed, but the framework list helper still depended on a cache decorator. Because the route is cheap and production failures can be cache-wrapper-specific, the decorator is now removed from this path.
- Framework settings code directly indexed `current_user["id"]`, which can turn an unexpected but authenticated user shape into a 500.
- Framework detail and selection helpers still assumed optional backing collections were present.
- Non-admin roles were not explicitly denied with controlled JSON for framework settings.
- The frontend error copy still told users to refresh and had no local retry action.

## 5. `/api/frameworks` Backend Fix

Backend fixes:

- Added `_require_framework_settings_user()` for active approved admin role enforcement.
- Added `_framework_user_id()` to normalize `id`, `user_id`, `sub`, or email into a controlled user key.
- Removed the `@cached` wrapper from framework list generation.
- Added safe helpers for optional `custom_domains` and `framework_selections` reads.
- Hardened these settings endpoints:
  - `GET /api/frameworks`
  - `GET /api/frameworks/selection/current`
  - `GET /api/frameworks/custom-domains`
  - framework write endpoints now share explicit admin access checks.
- Kept `GET /api/frameworks/{framework_type}` readable by active authenticated users because teacher-facing lesson/video focus panels use it to label already-saved observation focus.
- Valid empty/default admin states return 200 JSON.
- Unauthorized roles return controlled 403 JSON.

Stable response fields remain:

```json
{
  "frameworks": [],
  "default_framework_id": "danielson",
  "active_framework_id": "danielson",
  "summary": { "total": 0, "active": 0 },
  "empty_state": {
    "title": "No frameworks configured yet",
    "description": "Framework settings will appear here once a rubric or observation framework is added."
  }
}
```

The actual default payload includes built-in framework choices when available.

## 6. Admin Settings Frontend Fix

Frontend fixes:

- Empty framework payloads render an empty state.
- Missing optional fields render a fallback empty state.
- True fetch failures remain section-level, not page-level.
- The framework failure card now has a `Retry` action.
- Error copy no longer tells users to refresh.
- The rest of Admin Settings remains usable when the framework list fails.

## 7. Settings Surface Audit

| Surface | Route | Roles | API Calls | Empty/Error Behavior |
| --- | --- | --- | --- | --- |
| Admin Settings / Frameworks | `/settings`, `/admin/settings`, `/school-setup` | `school_admin`, `training_admin` | frameworks, selection, custom domains, teachers, recording policies | Section-level loading/error/empty states |
| Teacher Profile Settings | `/my-profile` | `teacher` | teacher profile, reference images, demo seed | Empty reference images are guidance, not global failure |
| Privacy Settings | `/privacy`, `/consent` | authenticated/teacher | consent/privacy/user export | Consent save errors are controlled |
| Notification Settings | `/settings/notifications` | authenticated | `/api/user/notification-preferences` | Local empty/default preferences |
| Master Admin Health/Settings-like surfaces | `/master-admin/*` | `super_admin` | readiness, dependencies, AI quality, users/orgs | Error cards scoped to page/section |

No `/api/settings` or `/api/admin/settings` backend route exists or is called by the canonical settings page.

## 8. Frontend API Crawl Table

| Frontend file/function | Method | Endpoint | Required role | Backend route exists | Empty state OK | Error contained |
| --- | --- | --- | --- | --- | --- | --- |
| `authApi.me` | GET | `/api/me` | authenticated | yes | n/a | auth flow |
| `authApi.institutionLookup` | GET | `/api/institutions/lookup` | public/signup | yes | yes | signup field |
| `frameworkApi.list` | GET | `/api/frameworks` | admin | yes | fixed | fixed |
| `frameworkApi.currentSelection` | GET | `/api/frameworks/selection/current` | admin | yes | yes | section |
| `frameworkApi.get` | GET | `/api/frameworks/{framework_type}` | authenticated active user | yes | yes | section/focus panel |
| `frameworkApi.listCustomDomains` | GET | `/api/frameworks/custom-domains` | admin | yes | yes | section |
| `recordingPolicyApi.list` | GET | `/api/recording-policies` | admin | yes | yes | section |
| `teacherApi.myDashboard` | GET | `/api/teachers/me/dashboard` | teacher | yes | yes | page card |
| `teacherApi.myRecognition` | GET | `/api/teachers/me/recognition` | teacher | yes | yes | page card |
| `teacherApi.myLessons` | GET | `/api/teachers/me/lessons` | teacher | yes | yes | page card |
| `teacherApi.myCoaching` | GET | `/api/teachers/me/coaching` | teacher | yes | yes | page card |
| `adminWorkspaceApi.dashboard` | GET | `/api/admin/workspace/dashboard` | admin/training | yes | yes | page card |
| `adminWorkspaceApi.search` | GET | `/api/admin/workspace/search` | admin/training | yes | yes | section |
| `dashboardApi.intelligence` | GET | `/api/dashboard/intelligence` | admin | yes | yes | dashboard |
| `demoApi.seed` | POST | `/api/demo/seed` | demo eligible | yes | n/a | toast |
| `reportApi.coachingSnapshot` | GET | `/api/reports/coaching-snapshot` | admin | yes | yes | page card |
| `reportApi.cohortSnapshot` | GET | `/api/reports/cohort-snapshot` | training | yes | yes | page card |
| `masterAdminApi.*` | GET/POST | `/api/master-admin/*`, `/api/admin/*` | super admin | yes | mostly yes | page cards |

Static scan found no obvious `api.get("/...")`, `api.post("/...")`, `api.patch("/...")`, or `api.delete("/...")` wrappers missing the `/api` prefix.

## 9. Backend Route Crawl Table

The route crawl uses `server.app.routes`, not isolated routers.

| Route | Mounted | Frontend caller |
| --- | --- | --- |
| `GET /api/health/version` | yes | manual/deployment checks |
| `GET /api/me` | yes | `authApi.me` |
| `GET /api/onboarding/status` | yes | `onboardingApi.status` |
| `GET /api/institutions/lookup` | yes | signup/access forms |
| `GET /api/frameworks` | yes | Admin Settings |
| `GET /api/frameworks/selection/current` | yes | Admin Settings/Dashboard |
| `GET /api/frameworks/custom-domains` | yes | Admin Settings |
| `GET /api/recording-policies` | yes | Admin Settings |
| `GET /api/user/notification-preferences` | yes | Notification Settings |
| `GET /api/teachers/me/dashboard` | yes | Teacher Workspace |
| `GET /api/teachers/me/recognition` | yes | Teacher Recognition |
| `GET /api/admin/workspace/dashboard` | yes | Admin Dashboard |
| `GET /api/admin/workspace/search` | yes | Admin Dashboard search |
| `POST /api/demo/seed` | yes | Teacher/Admin demo seed buttons |
| `GET /api/reports/coaching-snapshot` | yes | Reports |
| `GET /api/reports/cohort-snapshot` | yes | Reports |
| `GET /api/master-admin/users` | yes | Master Admin Users |
| `GET /api/master-admin/organizations` | yes | Master Admin Organizations |
| `GET /api/master-admin/dependencies` | yes | Master Admin Dependencies |

Regression test `test_curated_frontend_api_contract_routes_are_mounted_under_api` covers the critical mounted route list.

## 10. UI Failure Message Audit

Findings:

- The production Framework selection failure came from `FrameworksPage` query error state.
- The prior error copy asked users to refresh even though a section retry is better and empty/default configuration is valid.
- Dashboard/teacher recognition/teacher lessons pages already distinguish valid empty data from true query errors.
- Master Admin pages still use page-level error cards for true operational failures, which is acceptable for those admin-only surfaces.

Fix:

- Framework Selection now shows empty state for empty/default payloads.
- True framework fetch failures remain contained to that section with Retry.
- The copy no longer says `Please refresh`.

## 11. Button and CTA Execution Audit

| CTA | Surface | Backend/Route | Status |
| --- | --- | --- | --- |
| Save selection | Admin Settings | `POST /api/frameworks/selection` | Mounted, guarded, refetches selection/roster |
| Retry framework load | Admin Settings | `GET /api/frameworks` | Added |
| Upload rubric | Admin Settings | `POST /api/frameworks/upload-rubric` | Mounted, guarded |
| Add/delete custom domain | Admin Settings | custom-domain endpoints | Mounted, guarded |
| Save recording policy | Admin Settings | `POST /api/recording-policies` | Mounted |
| Fill demo workspace | Admin Dashboard | `POST /api/demo/seed` | Mounted, demo eligible only |
| Fill my demo workspace | Teacher Workspace | `POST /api/demo/seed` | Mounted, demo eligible only |
| Export CSV/report | Reports | report export endpoints | Mounted |
| Master Admin approve/reject/freeze/reactivate/delete | Master Admin | lifecycle endpoints | Mounted from prior repairs |

No new dead CTA was added.

## 12. Routing, Guard, and Loop Audit

- `/settings` and `/admin/settings` are guarded for school/training admins.
- `/school-setup` remains an explicit setup/settings alias for school/training admins.
- Teachers remain on `/my-workspace`, `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile`.
- Master Admin remains under `/master-admin`.
- The prior dashboard/onboarding loop repair remains present.
- Unknown route fallback still routes through `HomeRedirect`, so broken links can be masked; core nav links were checked and remain mounted.

## 13. Demo Seed Recheck

- `POST /api/demo/seed` is mounted.
- Admin and teacher dashboard payloads include `demo_eligible`.
- Seed controls remain hidden for non-demo users.
- Backend tests cover demo eligible teacher, demo eligible admin, non-demo rejection, and idempotent responses.
- This PR does not change seed data behavior.

## 14. Hidden Capability Reveal Audit

| Capability | Classification | Action |
| --- | --- | --- |
| Framework selection/settings | Visible but still fragile | Fixed |
| Observation frameworks/rubrics | Visible in Admin Settings | Guarded/hardened |
| Video observation setup | Visible and working | Documented |
| Uploaded lessons/videos | Visible and working | Documented |
| Timestamped comments/timeline markers | Visible in video review | Documented |
| Shared admin notes/reflections | Visible in coaching | Documented |
| Recognition/accolades/badges | Visible in teacher/admin recognition | Documented |
| Report snapshots/CSV exports | Visible in reports | Documented |
| Audio/talk-time/transcript | Existing video review surfaces | Documented |
| AI quality dashboard | Visible under Master Admin | Documented |
| Dependency health/internal readiness | Visible under Master Admin | Documented |
| Demo controls | Visible when eligible | Rechecked |
| Teacher reference images | Visible in Teacher Profile | Documented |
| Privacy blur/reference image readiness | Visible in profile/recording | Documented |
| Gradebook reminders | Demo/internal placeholder | Real LMS deferred |
| Admin workspace intelligence | Visible in dashboard | Documented |

## 15. Role, Tenant, and Data-Scope Audit

- Framework settings list/selection/mutation routes are now explicitly admin-only.
- Framework detail remains readable for active authenticated users so teacher-visible focus panels do not break.
- Teacher access to framework settings returns 403 JSON.
- Framework settings user key includes the current user's id/user_id/sub/email and does not fall through to an uncaught `KeyError`.
- Framework custom domains and selections remain user-scoped.
- Demo seeding permissions remain unchanged and non-demo users cannot seed real workspaces.
- CORS keeps explicit origins with credentials.

## 16. Tests Added

Backend:

- Framework routes return 200 for school, training, and super admin roles.
- Teacher receives controlled 403 JSON from `/api/frameworks`.
- Framework routes survive missing optional framework collections.
- `/api/frameworks/custom-domains` and `/api/recording-policies` are included in route registry coverage.
- Curated critical frontend API routes are mounted under `/api`.
- Existing CORS preflight coverage includes `/api/frameworks`.

Frontend:

- Admin Settings renders empty framework payloads without an error.
- Admin Settings contains framework fetch failures to the framework section.
- Admin Settings renders fallback empty state when optional fields are missing.
- Framework failure section exposes a Retry action.

## 17. Commands Run

- `python -m pytest backend/tests/test_teacher_admin_endpoint_stability.py -q` -> `26 passed, 3 warnings`
- `python -m py_compile backend/server.py backend/scripts/seed_demo_data.py` -> passed
- `python -m pytest backend/tests -q` -> `253 passed, 3 warnings`
- `npm test -- --watchAll=false --runTestsByPath src/pages/FrameworksPage.test.js src/lib/userRoutes.test.js --runInBand` -> `2 passed, 12 tests passed`
- `npm test -- --watchAll=false` -> `18 passed, 55 tests passed`
- `npm run build` -> compiled successfully
- `python backend/scripts/run_quality_gate.py` -> PASS across all dimensions
- `git diff --check` -> clean, with Windows line-ending warnings only

No separate frontend lint/typecheck scripts exist in `frontend/package.json`.

## 18. Manual Verification Checklist

Backend/API:

1. `GET /api/health/version` returns 200 JSON with current safe build fields.
2. `GET /api/me` returns 200 JSON for authenticated user.
3. `GET /api/onboarding/status` returns 200 JSON.
4. `GET /api/frameworks` returns 200 JSON, not 500.
5. `GET /api/institutions/lookup?organization_type=school&q=Test&limit=6` returns 200 or controlled empty JSON.
6. `GET /api/admin/workspace/dashboard?period=semester` returns 200 JSON.
7. `GET /api/admin/workspace/search?q=` returns 200 JSON.
8. `GET /api/teachers/me/dashboard?period=semester` returns 200 JSON.
9. `GET /api/teachers/me/recognition` returns 200 JSON.
10. `POST /api/demo/seed` returns 200 for eligible demo users and 403 for non-demo users.

Admin UI:

1. Open Admin Dashboard.
2. Open Admin Settings.
3. Confirm Framework Selection no longer shows `Something went wrong` for empty/default frameworks.
4. Confirm settings page remains usable if framework load fails.
5. Click framework retry, save selection, custom domain, and recording policy CTAs where appropriate.
6. Confirm no unexpected setup/home loop.
7. Confirm demo seed button appears for eligible demo admin and refreshes dashboard data after seed.

Teacher UI:

1. Open `/my-workspace`.
2. Confirm eligible demo teacher sees `Fill my demo workspace`.
3. Confirm `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile` render controlled states.

Master Admin:

1. Open `/master-admin` routes.
2. Confirm users/orgs/internal readiness/dependencies/AI quality render.
3. Confirm demo controls follow `DEMO_MODE`.

Browser console:

1. No 500 for `/api/frameworks`.
2. No CORS failures for app backend endpoints.
3. `window.__COGNIVIO_BUILD__` exists and matches the expected frontend deployment metadata when env vars are configured.

## 19. Known Deferred Items

- Full privacy/security hardening.
- Real LMS integration.
- Generic chat.
- Scheduled reports and new PDF exports.
- Backend decomposition.
- Unknown-route fallback still masks some broken links by redirecting to a role home route; core nav links are tested, but a stricter 404 experience is deferred.
