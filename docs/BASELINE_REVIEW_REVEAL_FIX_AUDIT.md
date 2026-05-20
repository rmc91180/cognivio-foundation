# Baseline Review, Reveal, and Fix Audit

## Executive Summary

This audit was completed for the `audit-reveal-and-fix-platform-baseline` stabilization branch. The branch was created from protected `main` at commit `92853447e2fb4be63503808ed861fdc2f881fc0f`, which includes the earlier routing, CORS, and demo seed repair PR.

The current repo already exposes the teacher, admin workspace, and demo seed endpoints added by the prior stabilization work. The remaining production symptom, `GET /api/frameworks` returning 500 from Admin Settings, traced to backend framework-route fragility rather than CORS. This PR fixes that route, adds a safe `/api/health/version` deployment-alignment endpoint, gives Admin Settings a canonical route, and adds regression tests for route mounting, CORS preflight, settings empty states, and role routing.

## Production Symptoms Addressed

- Admin Settings called `GET /api/frameworks` and received a backend 500.
- Settings was effectively tied to setup/school onboarding rather than a stable admin settings route.
- Training admins had no visible Settings nav even though the same framework and recording policy surfaces are relevant.
- Previous baseline symptoms were re-verified: dashboard route loops, missing demo seed buttons, CORS failures, and PR #21 endpoint contracts.

Secondary console warnings from Cloudflare beacon/SRI or missing source maps remain non-blocking unless the app shell injects the script or build config is changed.

## Deployment Alignment Findings

- Current branch base: `92853447e2fb4be63503808ed861fdc2f881fc0f`.
- Prior PR #21 endpoint claims are present in the mounted production app object:
  - `GET /api/teachers/me/dashboard`
  - `GET /api/teachers/me/recognition`
  - `POST /api/demo/seed`
  - `GET /api/admin/workspace/dashboard`
  - `GET /api/admin/workspace/search`
- Prior PR #22 baseline repairs are present, including `/api/me`, production-safe CORS defaults, and dashboard/onboarding loop repair.
- This PR adds `GET /api/health/version` so deployed backend instances can expose safe build/version signals.

Manual deployment verification is still required after merge:

- Railway backend is deployed from latest protected `main`.
- Frontend app at `app.cognivio.live` was rebuilt from latest protected `main`.
- `app.cognivio.live` is not serving a stale bundle.
- Cloudflare Pages marketing site is not serving the app shell by mistake.
- Runtime env vars include the correct backend public URL and allowed frontend origins.
- Deployed `/api/health/version` commit/build fields match the expected release.

## Frontend Route Map

| Path | Component | Roles | Guards and Redirects | Backend Calls | Demo Critical |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `DashboardPage` | `school_admin`, `training_admin` | Protected by auth/role, no global onboarding redirect | admin workspace dashboard/search, dashboard intelligence | Yes |
| `/settings` | `FrameworksPage` | `school_admin`, `training_admin` | Protected by auth/role, stable admin settings route | frameworks, framework selection, custom domains, teachers, recording policies | Yes |
| `/admin/settings` | Redirect | `school_admin`, `training_admin` | Redirects to `/settings` | none | Yes |
| `/school-setup` | `FrameworksPage` | `school_admin`, `training_admin` | Explicit setup/settings surface only | same as `/settings` | Yes |
| `/my-workspace` | `TeacherWorkspacePage` | `teacher` | Teacher route guard and consent handling | teacher dashboard/search, demo seed | Yes |
| `/my-lessons` | `TeacherLessonsPage` | `teacher` | Teacher route guard | teacher lessons/profile/readiness | Yes |
| `/my-coaching` | `TeacherCoachingPage` | `teacher` | Teacher route guard | teacher coaching/reflections | Yes |
| `/my-badges` | `TeacherBadgesPage` | `teacher` | Teacher route guard | teacher recognition | Yes |
| `/my-profile` | `TeacherSelfProfilePage` | `teacher` | Teacher route guard | teacher profile/reference images/privacy | Yes |
| `/record` | `VideoRecorderPage` | `teacher`, `school_admin`, `training_admin` | Role-aware recording behavior | video upload, teachers/profile | Yes |
| `/teachers` | `TeachersPage` | `school_admin`, `training_admin` | Admin/training role guard | teachers | Yes |
| `/observation/new` | `ObservationSetupPage` | `school_admin`, `training_admin` | Admin/training role guard | teachers/frameworks/observations | Yes |
| `/coaching` | `RoleAwareCoachingRoute` | teacher/admin/training | Teacher redirects to `/my-coaching`; admins stay in admin coaching | coaching/teacher APIs | Yes |
| `/reports` | `ReportsPage` | `school_admin`, `training_admin` | Admin/training role guard | report snapshots/history/CSV | Yes |
| `/recognition` | role-aware route | teacher/admin/training | Teacher goes to `/my-badges`, admins to recognition review where allowed | recognition APIs | Yes |
| `/master-admin` | `MasterAdminPage` | `super_admin` | Super-admin guard | master admin overview/readiness/demo | Yes |
| `/master-admin/users` | `MasterAdminUsersPage` | `super_admin` | Super-admin guard | master admin users/lifecycle | Yes |
| `/master-admin/organizations` | `MasterAdminOrganizationsPage` | `super_admin` | Super-admin guard | master admin organizations | Yes |
| `/privacy` | `TeacherPrivacyPage` | authenticated roles | Privacy/consent surface, not an admin dashboard trap | consent/privacy APIs | Yes |
| `/consent` | `ConsentPage` | `teacher` | First-login consent gate | consent APIs | Yes |
| `/onboarding` | `OnboardingPage` | `school_admin`, `training_admin` | Explicit setup page only | onboarding status/complete | Yes |

## Backend Route Map

Route inventory was generated from the actual `server.app` object, not an isolated router. Critical mounted paths include:

- `GET /api/health/version`
- `GET /api/me`
- `GET /api/onboarding/status`
- `GET /api/institutions/lookup`
- `GET /api/frameworks`
- `GET /api/frameworks/selection/current`
- `GET /api/frameworks/{framework_type}`
- `GET /api/teachers/me/dashboard`
- `GET /api/teachers/me/recognition`
- `GET /api/teachers/me/lessons`
- `GET /api/teachers/me/coaching`
- `GET /api/teachers/me/profile`
- `GET /api/teachers/me/reference-images`
- `POST /api/teachers/me/reference-images`
- `DELETE /api/teachers/me/reference-images/{image_id}`
- `GET /api/admin/workspace/dashboard`
- `GET /api/admin/workspace/search`
- `GET /api/dashboard/intelligence`
- `POST /api/demo/seed`
- report snapshot and CSV export routes
- Master Admin readiness, dependency health, user/org, and AI quality routes

Regression coverage now also asserts that `/api/frameworks/selection/current` is ordered before `/api/frameworks/{framework_type}`.

## Frontend API Call Map

| Frontend Caller | Method/Path | Backend Status | Notes |
| --- | --- | --- | --- |
| `authApi.me` | `GET /api/me` | Mounted | Deployment-friendly current-user alias |
| `authApi.institutionLookup` | `GET /api/institutions/lookup` | Mounted | CORS preflight covered |
| `onboardingApi.status` | `GET /api/onboarding/status` | Mounted | Explicit onboarding only |
| `frameworkApi.list` | `GET /api/frameworks` | Mounted and fixed | Returns JSON defaults; no 500 on empty settings |
| `frameworkApi.currentSelection` | `GET /api/frameworks/selection/current` | Mounted and reordered | Static route precedes dynamic route |
| `frameworkApi.get` | `GET /api/frameworks/{framework_type}` | Mounted | Framework detail |
| `recordingPolicyApi.list` | `GET /api/recording-policies` | Mounted | Optional settings section |
| `teacherApi.myDashboard` | `GET /api/teachers/me/dashboard` | Mounted | 200 empty/default payload |
| `teacherApi.myRecognition` | `GET /api/teachers/me/recognition` | Mounted | 200 empty/default payload |
| `teacherApi.myLessons` | `GET /api/teachers/me/lessons` | Mounted | Teacher lessons |
| `teacherApi.myCoaching` | `GET /api/teachers/me/coaching` | Mounted | Teacher coaching |
| `teacherApi.currentProfile` | `GET /api/teachers/me/profile` | Mounted | Teacher readiness/profile |
| `adminWorkspaceApi.dashboard` | `GET /api/admin/workspace/dashboard` | Mounted | 200 empty/default payload |
| `adminWorkspaceApi.search` | `GET /api/admin/workspace/search` | Mounted | 200 empty results |
| `dashboardApi.intelligence` | `GET /api/dashboard/intelligence` | Mounted | Existing compatibility surface |
| `demoApi.seed` | `POST /api/demo/seed` | Mounted | Demo fill controls |
| `reportApi.*` | `/api/reports/*` | Mounted | Snapshots/export |
| `masterAdminApi.*` | `/api/master-admin/*`, `/api/admin/*` | Mounted | Master Admin readiness/lifecycle/health |

Static scan found no remaining obvious `api.get("/...")`, `api.post("/...")`, `api.patch("/...")`, or `api.delete("/...")` wrappers missing the `/api` prefix.

## Settings API Audit

Settings surfaces audited:

- Admin Settings / Frameworks: `/settings`, `/admin/settings`, and `/school-setup`.
- Teacher settings/profile: `/my-profile`.
- Privacy settings: `/privacy` and `/consent`.
- Master Admin settings/health-like surfaces: internal readiness, dependencies, AI quality, users, organizations.
- Framework/rubric settings: `/api/frameworks`, `/api/frameworks/selection/current`, custom domains, upload/import helpers.
- Recording policy settings: `/api/recording-policies`, `/api/recording-compliance/*`.

Fixes:

- Added canonical `/settings` and `/admin/settings` alias routes.
- Updated school and training admin nav to point Settings to `/settings`.
- Allowed training admins to access the settings/setup surface.
- Admin Settings now treats empty frameworks as a contained empty state, not a page crash.

## /api/frameworks Root Cause and Fix

Root cause:

- `_get_frameworks_cached(workspace_id, user_id)` used a cache decorator key function that accepted only `workspace_id`. The cache wrapper invoked the key function with both positional args, which could raise a `TypeError` and surface as a 500.
- Framework selection was also fragile if the backing collection/config was missing.
- `/api/frameworks/selection/current` was defined after `/api/frameworks/{framework_type}`, allowing the dynamic route to capture the static selection path in some route-order cases.

Fix:

- Updated the cache key to accept both `workspace_id` and `user_id`, and included both in the cache key.
- Added defensive framework selection/default handling.
- Added safe custom-domain counting so missing optional data cannot crash the route.
- Added the preferred stable response fields: `frameworks`, `default_framework_id`, `active_framework_id`, `summary`, and `empty_state`.
- Added route ordering for framework selection routes ahead of the dynamic framework type route.

## CORS and Preflight Findings

CORS defaults from the prior baseline repair remain in place:

- `https://app.cognivio.live`
- `https://cognivio.live`
- `https://www.cognivio.live`
- local development origins

This PR keeps preflight coverage for critical API paths and adds `/api/frameworks`:

- `OPTIONS /api/frameworks`
- `OPTIONS /api/institutions/lookup`
- `OPTIONS /api/admin/workspace/dashboard`
- `OPTIONS /api/teachers/me/dashboard`
- `OPTIONS /api/demo/seed`

Wildcard CORS with credentials is not used.

## Demo Seed Visibility and Execution Findings

The existing `/api/demo/seed` route is mounted under `/api` and tested. Teacher and admin seed button visibility continues to depend on stable dashboard payloads returning `demo_eligible`.

- Teacher demo users see `Fill my demo workspace`.
- Admin demo users see `Fill demo workspace`.
- Master Admin demo/reset controls continue to follow `DEMO_MODE`.
- Non-demo users do not see seed controls.

No new seed endpoint was added in this PR; the repair preserves the existing endpoint and keeps dashboard/settings routing from hiding eligible controls.

## Empty and Error State Findings

- Empty frameworks are now a settings empty state, not a 500 or global page failure.
- Framework section load failures remain contained to the framework section while the rest of Admin Settings can render.
- Valid empty teacher/admin dashboard payloads remain starter states from prior stabilization work.
- No lessons, no recognition, no coaching tasks, no reports, no reference images, and no demo data remain valid empty/starter states.

## Hidden Capability Reveal Audit

| Capability | Classification | Baseline Action |
| --- | --- | --- |
| Video observation setup | Visible and working | No route change |
| Uploaded videos/lessons | Visible and working | No route change |
| Timestamped comments/timeline markers | Visible through video review | Documented |
| Shared admin notes/reflections | Visible through coaching surfaces | Documented |
| Recognition/accolades/badges | Visible via teacher/admin recognition routes | Documented |
| Report snapshots/CSV exports | Visible via `/reports` | Documented |
| Audio/talk-time/transcript | Existing video review surfaces | Documented |
| AI quality dashboard | Visible under Master Admin | Documented |
| Dependency health/internal readiness | Visible under Master Admin | Documented |
| Demo controls | Visible when dashboard payload says demo eligible | Preserved |
| Teacher reference images | Visible under Teacher Profile | Documented |
| Privacy blur/reference readiness | Visible in profile/recording readiness | Documented |
| Gradebook reminders | Demo/internal dashboard placeholder | Real LMS deferred |
| Admin settings/frameworks | Visible but broken | Fixed |

## Button and CTA Execution Audit

Key CTA outcomes:

- `Go to dashboard`: previously removed from onboarding loop in prior baseline repair.
- `Settings`: now points to `/settings` for school/training admins.
- `Fill demo workspace` and `Fill my demo workspace`: preserved, visible only with `demo_eligible=true`.
- `Save settings` / framework selection / recording policy save: use mounted settings APIs and show success/error toasts.
- `Upload/record lesson`, `Upload reference image`, `Delete reference image`, report exports, coaching, recognition, and Master Admin approve/reject buttons remain backed by mounted routes from prior repairs.

No new visible nav link was added without a route.

## Role, Tenant, and Data-Scope Findings

- `/settings` and `/admin/settings` are allowed only for school/training admins.
- Teachers cannot access `/settings`; they use `/my-profile` and `/privacy`.
- Master Admin surfaces remain separate under `/master-admin`.
- Framework settings use the current user's workspace id for cache and selection lookup.
- Framework cache key includes user id to avoid cross-user leakage.
- Demo seeding permissions and demo data scoping remain unchanged.
- CORS remains explicit-origin only with credentials.

## Tests Added

- Backend route registry now covers `/api/health/version`, `/api/frameworks`, and `/api/frameworks/selection/current`.
- Backend route-order test ensures framework selection static route precedes the dynamic framework route.
- Backend framework route test verifies empty/default settings payload and current selection return 200 JSON.
- CORS preflight test now includes `/api/frameworks`.
- Frontend Admin Settings tests cover empty frameworks, contained framework failure, and populated framework choices.
- Frontend role routing tests cover `/settings` and `/admin/settings`.

## Manual Verification Checklist

Backend/API:

1. `GET /api/health/version` returns 200 JSON.
2. `GET /api/me` returns 200 JSON for an authenticated user.
3. `GET /api/onboarding/status` returns 200 JSON.
4. `GET /api/institutions/lookup?organization_type=school&q=Test&limit=6` returns 200 or controlled empty JSON, not CORS blocked.
5. `GET /api/frameworks` returns 200 JSON, not 500.
6. `GET /api/frameworks/selection/current` returns 200 JSON.
7. `GET /api/admin/workspace/dashboard?period=semester` returns 200 JSON.
8. `GET /api/admin/workspace/search?q=` returns 200 JSON.
9. `GET /api/teachers/me/dashboard?period=semester` returns 200 JSON.
10. `GET /api/teachers/me/recognition` returns 200 JSON.
11. `POST /api/demo/seed` returns 200 for demo-eligible admin/teacher and 403 for non-demo users.

Admin UI:

1. Login as school admin and open `/dashboard`.
2. Open `/settings`; confirm the settings page renders.
3. Confirm `/api/frameworks` returns 200 and empty/default frameworks render without redirecting to setup.
4. Login as training admin and confirm `/settings` is visible and reachable.
5. Click visible dashboard/settings CTAs once; no CTA should loop to setup/home unless explicitly labeled setup/onboarding.
6. If demo eligible, confirm `Fill demo workspace` appears and seeding refreshes visible dashboard data.

Teacher UI:

1. Login as teacher and open `/my-workspace`.
2. If demo eligible, confirm `Fill my demo workspace` appears.
3. Confirm `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile` render starter or populated states.

Master Admin:

1. Login as master admin/super admin.
2. Confirm `/master-admin`, `/master-admin/users`, `/master-admin/organizations`, dependencies, internal readiness, and AI quality render.
3. Confirm demo seed/reset controls follow `DEMO_MODE`.

Browser console:

1. No app API CORS failures.
2. No 500 for `/api/frameworks`.
3. No blank screens on core routes.

## Known Remaining Limitations

- Full privacy/security hardening remains deferred.
- Real LMS integration remains deferred.
- Generic chat remains deferred.
- Scheduled reports and new PDF exports remain deferred.
- Backend decomposition remains deferred.
- Manual deployment verification is still required after merge because repo state cannot prove Railway/Cloudflare cache state.
