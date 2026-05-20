# Baseline Route/API Audit

## 2026-05-20 Addendum: Settings and Framework Route Stability

Follow-up production testing found that Admin Settings reached Railway successfully but `GET /api/frameworks` returned 500. This was not a CORS failure.

The `audit-reveal-and-fix-platform-baseline` branch adds a deeper settings-specific repair:

- Added `GET /api/health/version` for safe deployment/build alignment checks.
- Fixed `/api/frameworks` so valid empty/default settings return 200 JSON instead of crashing.
- Added stable response fields for framework settings: `frameworks`, `default_framework_id`, `active_framework_id`, `summary`, and `empty_state`.
- Fixed framework route ordering so `/api/frameworks/selection/current` is mounted before `/api/frameworks/{framework_type}`.
- Added canonical Admin Settings routes:
  - `/settings`
  - `/admin/settings` -> `/settings`
- Updated school/training admin nav to use `/settings`.
- Added backend route/CORS tests and frontend Admin Settings empty/error/populated tests.

See `docs/BASELINE_REVIEW_REVEAL_FIX_AUDIT.md` for the full review, reveal, and fix audit.

## Executive Summary

This audit was created for the `repair-baseline-routing-cors-demo-seed-audit` stabilization branch. The repo baseline is `main` at commit `01593cc5ae6098134fe726c6aa4207d93bb45402`, which includes PR #21.

The main codebase did include the PR #21 backend endpoints, but two baseline issues could still explain production symptoms:

- Admin routes were globally hijacked by `ProtectedRoute` whenever onboarding returned `is_complete=false`, causing `/dashboard`, `/teachers`, `/reports`, and other admin CTAs to route back to `/onboarding`.
- Production CORS relied only on `CORS_ORIGINS`; if Railway was missing `https://app.cognivio.live`, browser preflight requests such as `/api/institutions/lookup` failed before route code could run.

The repair keeps onboarding available as an embedded dashboard setup assistant and explicit `/onboarding` route, but removes it as a global navigation trap. It also adds production-safe CORS defaults, a deployment-friendly `/api/me` alias, and a richer `/health` and `/api/health` payload for deployment alignment checks.

## Production Symptoms Addressed

- Admin dashboard links returned to setup/home.
- The setup page exposed a redundant top-right “Go to dashboard” action.
- Demo seed buttons were hidden because dashboard pages could be redirected before the stable dashboard payload loaded.
- `/api/institutions/lookup` could be blocked by CORS from `https://app.cognivio.live`.
- Some older frontend pages used paths without the mounted `/api` prefix.

Cloudflare beacon CORS/SRI and missing CSS source map console messages were treated as secondary because they are not part of Cognivio API routing unless the app shell manually injects those scripts or serves sourcemaps incorrectly.

## Deployment Alignment Findings

- Current main commit: `01593cc5ae6098134fe726c6aa4207d93bb45402`.
- PR #21 merge commit is present on `main`.
- `backend/server.py` exposes:
  - `GET /api/teachers/me/dashboard`
  - `GET /api/teachers/me/recognition`
  - `POST /api/demo/seed`
  - `GET /api/admin/workspace/dashboard`
  - `GET /api/admin/workspace/search`
- Frontend callers use those exact mounted `/api` routes.
- This PR adds `GET /api/me` as a compatibility alias and updates the frontend current-user check to use it.
- This PR improves `/health` and `/api/health` with service status, environment name, safe build/commit fields from environment variables, configured URL booleans, and server time.

## Manual Deployment Verification Required

These cannot be proven from repo state alone:

- Railway backend is deployed from latest protected `main`.
- Frontend app at `app.cognivio.live` was rebuilt after latest `main`.
- Cloudflare Pages marketing site is not serving the app shell by mistake.
- No stale frontend bundle is cached at `app.cognivio.live`.
- Runtime env vars include the correct backend public URL and frontend origins.
- The deployed `/api/health` commit/build fields match the expected deployment.

## Frontend Route Map

| Path | Component | Roles | Gate behavior | Demo relevance |
| --- | --- | --- | --- | --- |
| `/dashboard` | `DashboardPage` -> `SchoolAdminPilotDashboard` or `TrainingDashboard` | `school_admin`, `training_admin` | No global onboarding redirect after this PR; setup assistant renders inside dashboard | Admin seed button when `demo_eligible=true` |
| `/my-workspace` | `TeacherWorkspacePage` | `teacher` | Consent gate only when required | Teacher seed button when `demo_eligible=true` |
| `/my-lessons` | `TeacherLessonsPage` | `teacher` | Uses teacher readiness/profile CTA, no dashboard loop | Seeded lessons visible |
| `/my-coaching` | `TeacherCoachingPage` | `teacher` | Uses teacher readiness/profile CTA | Seeded goals/comments/reflections visible |
| `/my-badges` | `TeacherBadgesPage` | `teacher` | Empty recognition is valid | Seed CTA/recognition when eligible |
| `/my-profile` | `TeacherSelfProfilePage` | `teacher` | Editable teacher profile and reference image surface | Demo profile/reference image data |
| `/record` | `VideoRecorderPage` | `teacher`, `school_admin`, `training_admin` | Role-aware recording/upload | Seeded profile metadata can prefill |
| `/teachers` | `TeachersPage` | `school_admin`, `training_admin` | No onboarding hijack after this PR | Demo workspace roster |
| `/observation/new` | `ObservationSetupPage` | `school_admin`, `training_admin` | No onboarding hijack after this PR | Demo observations |
| `/coaching` | `RoleAwareCoachingRoute` / `CoachingHubPage` | `teacher`, `school_admin`, `training_admin` | Teacher redirects to `/my-coaching`, admins stay in admin coaching | Demo coaching |
| `/reports` | `ReportsPage` | `school_admin`, `training_admin` | No onboarding hijack after this PR | Demo report snapshots/CSV |
| `/master-admin` | `MasterAdminPage` | `super_admin` | Super-admin gate | Demo reset/seed controls follow `DEMO_MODE` |
| `/master-admin/users` | `MasterAdminUsersPage` | `super_admin` | Super-admin gate | Approval/lifecycle visibility |
| `/master-admin/organizations` | `MasterAdminOrganizationsPage` | `super_admin` | Super-admin gate | Demo org visibility |
| `/privacy` | `TeacherPrivacyPage` | teacher/admin/super admin | Consent/privacy route, not a dashboard gate for admins | Privacy checks |
| `/consent` | `ConsentPage` | `teacher` | Teacher consent only | First-login flow |
| `/onboarding` | `OnboardingPage` | `school_admin`, `training_admin` | Explicit setup hub only | Setup rehearsal |

Old aliases remain route-safe:

- `/teacher/profile` -> `/my-profile`
- `/teacher/lessons` -> `/my-lessons`
- `/lessons` -> teacher `/my-lessons`, admin `/videos`
- `/recognition` -> teacher `/my-badges`, admin `/recognition-review`
- `/coaching` -> teacher `/my-coaching`, admin coaching

## Frontend API Call Map

| Frontend caller | Method/path | Backend route | Notes |
| --- | --- | --- | --- |
| `authApi.me` | `GET /api/me` | `backend/server.py::get_current_user_alias` | Added compatibility alias |
| `authApi.institutionLookup` | `GET /api/institutions/lookup` | `backend/server.py::lookup_institutions` | CORS preflight tested for `app.cognivio.live` |
| `onboardingApi.status` | `GET /api/onboarding/status` | `backend/server.py::get_onboarding_status` | Used by setup assistant/page only |
| `teacherApi.myDashboard` | `GET /api/teachers/me/dashboard` | `backend/server.py::get_my_teacher_dashboard` | 200 empty payload |
| `teacherApi.myRecognition` | `GET /api/teachers/me/recognition` | `backend/server.py::get_my_teacher_recognition` | 200 empty payload |
| `teacherApi.myLessons` | `GET /api/teachers/me/lessons` | `backend/server.py::get_my_lessons` | Teacher lessons hub |
| `teacherApi.myCoaching` | `GET /api/teachers/me/coaching` | `backend/server.py::get_my_teacher_coaching` | Teacher coaching hub |
| `teacherApi.currentProfile` | `GET /api/teachers/me/profile` | `backend/server.py::get_my_teacher_profile` | Readiness/profile |
| `teacherApi.myReferenceImages` | `GET /api/teachers/me/reference-images` | `backend/server.py::list_my_teacher_reference_images` | Reference image status |
| `teacherApi.uploadReferenceImage` | `POST /api/teachers/me/reference-images` | `backend/server.py::upload_my_teacher_reference_image` | Multipart upload |
| `adminWorkspaceApi.dashboard` | `GET /api/admin/workspace/dashboard` | `backend/server.py::get_admin_workspace_dashboard` | 200 empty payload |
| `adminWorkspaceApi.search` | `GET /api/admin/workspace/search` | `backend/server.py::search_admin_workspace` | 200 empty results |
| `dashboardApi.intelligence` | `GET /api/dashboard/intelligence` | `backend/server.py::get_dashboard_intelligence` | Existing dashboard compatibility |
| `demoApi.seed` | `POST /api/demo/seed` | `backend/server.py::seed_demo_data_v1` | Teacher/admin demo fill |
| `reportApi.coachingSnapshot` | `GET /api/reports/coaching-snapshot` | `backend/server.py::get_coaching_snapshot_report` | Reports page |
| `reportApi.cohortSnapshot` | `GET /api/reports/cohort-snapshot` | `backend/server.py::get_cohort_snapshot_report` | Training reports |
| `reportApi.exportCoachingSnapshotCsv` | `GET /api/reports/export/coaching-snapshot.csv` | mounted | CSV export |
| `reportApi.exportCohortSnapshotCsv` | `GET /api/reports/export/cohort-snapshot.csv` | mounted | CSV export |
| `masterAdminApi.internalReadiness` | `GET /api/admin/internal-readiness` | mounted | Internal readiness |
| `masterAdminApi.dependencies` | `GET /api/master-admin/dependencies` | mounted | Dependency health |
| `masterAdminApi.aiQualityLatest` | `GET /api/admin/ai-quality/latest` | mounted | AI quality |

Older direct page calls repaired in this PR:

- `CohortManagementPage`: `/cohorts` -> `/api/cohorts`
- `ObserverInsightsPage`: `/observer/insights` -> `/api/observer/insights`
- `NotificationPreferencesPage`: `/notifications/preferences` -> `/api/user/notification-preferences` with `PATCH`

## Backend API Map

Route registry tests use the production `server.app`, not isolated routers. Critical mounted routes include:

- `GET /api/me`
- `GET /api/onboarding/status`
- `GET /api/institutions/lookup`
- `GET /api/teachers/me/dashboard`
- `GET /api/teachers/me/dashboard?period=semester`
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
- report snapshot and CSV routes
- Master Admin readiness/dependency/AI quality routes

## Route/API Mismatches Found

- `/api/me` did not exist as a deployment-check alias. Added.
- Some older frontend pages called unprefixed API paths. Repaired and added a frontend regression test that fails on `api.get("/...")` style calls that omit `/api`.
- The PR #21 teacher/admin endpoints were mounted, and route-order tests confirm `/api/teachers/me/*` routes precede dynamic `/api/teachers/{teacher_id}/*` routes.

## Routing/Gating Loops Found

- `ProtectedRoute` redirected every incomplete school/training admin route to `/onboarding`. This was the direct route-loop cause.
- `OnboardingPage` had a top-right `Go to dashboard` action, which became circular when `/dashboard` redirected back to onboarding.

Fix:

- Removed the global admin onboarding redirect.
- Kept setup guidance inside `SetupAssistantPanel` on the dashboard and the explicit `/onboarding` route.
- Removed the top-right `Go to dashboard` action from `OnboardingPage`.

## CORS Findings and Fix

CORS previously depended on `CORS_ORIGINS` only. The repaired server merges configured origins with safe Cognivio production and local development defaults:

- `https://app.cognivio.live`
- `https://cognivio.live`
- `https://www.cognivio.live`
- `http://localhost:3000`
- `http://localhost:5173`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:5173`

Wildcard origins are not used with credentials. Preflight tests cover:

- `OPTIONS /api/institutions/lookup`
- `OPTIONS /api/admin/workspace/dashboard`
- `OPTIONS /api/teachers/me/dashboard`
- `OPTIONS /api/demo/seed`

## Demo Seed Findings and Fix

The backend `POST /api/demo/seed` route is mounted and tested. The existing admin and teacher dashboard seed controls read `demo_eligible` from stable dashboard payloads. Removing the global onboarding redirect allows those dashboard payloads to load so eligible users can see:

- Admin: `Fill demo workspace`
- Teacher: `Fill my demo workspace`

Non-demo users do not see seed controls. Backend tests still verify non-demo seed requests are rejected.

## Empty State/Error State Findings

Valid empty states are handled as starter states:

- Empty admin dashboard renders starter cards.
- Empty teacher workspace renders starter cards.
- Empty recognition returns 200 with empty arrays.
- Empty lessons/coaching/reports are not treated as route errors.
- Missing reference images are shown as readiness guidance, not a global route blocker.

Only network/server failures should show error cards.

## Hidden Capabilities Audit

| Capability | Classification |
| --- | --- |
| Video comments/timestamped comments/timeline markers | Visible through video review/player surfaces |
| Audio/talk-time/transcript | Backend/frontend surfaces exist in video review, demo data supports walkthroughs |
| AI quality dashboard | Visible under Master Admin AI Quality |
| Dependency health/internal readiness | Visible under Master Admin health/readiness surfaces |
| Demo controls | Master Admin reset plus teacher/admin fill controls when eligible |
| Report snapshots/CSV exports | Visible under `/reports` |
| Recognition/accolades | Teacher `/my-badges`, admin review queue where allowed |
| Coaching reflections | Teacher coaching and admin coaching surfaces |
| Observation focus context | Observation setup and video/session linking |
| Teacher reference images | Teacher profile/reference-image endpoints and UI |
| Privacy blur/reference image status | Profile and recording readiness hints |
| Gradebook reminders | Demo/internal dashboard placeholder; real LMS integration deferred |
| Onboarding setup assistant | Dashboard embedded assistant plus explicit `/onboarding` |

## Security and Role Scope Findings

- Teacher dashboard/recognition routes require active approved teacher access.
- Admin workspace endpoints are scoped to school/training admin workspaces.
- Demo seed permissions still deny non-demo users/workspaces.
- Demo data remains marked with `demo_data`/`demo_persona` and must not be counted as real customer data unless the selected workspace is demo.
- Deleted/tombstoned/inactive users are filtered by existing lifecycle helpers.
- CORS uses explicit origins with credentials, not wildcard credentials.
- Health/version payload exposes only safe booleans and environment/build identifiers, not secrets.

## Tests Added or Updated

- Backend route registry now includes critical baseline routes and `/api/me`.
- Backend CORS preflight tests for production frontend origin.
- Frontend `ProtectedRoute` tests confirming school/training admins can reach dashboard routes without onboarding hijack.
- Frontend `OnboardingPage` test confirming the top-right `Go to dashboard` loop action is absent.
- Frontend API-prefix regression test for local API calls.

## Manual Verification Checklist

Production/staging network checks:

1. `GET /api/health` returns current safe deployment/build data.
2. `GET /api/me` returns 200 for an authenticated user.
3. `GET /api/onboarding/status` returns 200 for admins.
4. `GET /api/institutions/lookup?organization_type=school&q=Test&limit=6` is not CORS-blocked from `https://app.cognivio.live`.
5. `GET /api/admin/workspace/dashboard?period=semester` returns 200 for school/training admins.
6. `GET /api/admin/workspace/search?q=` returns 200 for school/training admins.
7. `GET /api/teachers/me/dashboard?period=semester` returns 200 for teachers.
8. `GET /api/teachers/me/recognition` returns 200 for teachers.
9. `POST /api/demo/seed` returns 200 for demo eligible admin/teacher.
10. `POST /api/demo/seed` returns 403 for non-demo user/workspace.

Admin UI checks:

1. Login as a school admin demo user.
2. Open `/dashboard`; confirm it does not redirect to setup/home.
3. Click every visible dashboard CTA once.
4. Confirm no CTA returns to setup/home unless explicitly a setup CTA.
5. Confirm `Fill demo workspace` appears when `demo_eligible=true`.
6. Click seed and confirm dashboard/reports/teachers populate without a hard refresh.
7. Repeat for training admin.

Teacher UI checks:

1. Login as a teacher demo user.
2. Open `/my-workspace`; confirm it does not redirect to setup/home.
3. Confirm `Fill my demo workspace` appears when `demo_eligible=true`.
4. Click seed and confirm lessons/coaching/recognition/profile populate or show controlled starter states.
5. Open `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile`.

Non-demo checks:

1. Login as non-demo admin/teacher.
2. Confirm seed controls are hidden.
3. Confirm valid empty states do not show red error cards.

Master Admin checks:

1. Login as master admin/super admin.
2. Confirm master admin routes work.
3. Confirm demo seed/reset controls follow `DEMO_MODE`.
4. Confirm internal readiness/dependency health pages do not break dashboard routing.

## Known Remaining Limitations

- Manual deployment freshness must be verified after merge.
- Real LMS integration remains deferred.
- Generic chat remains deferred.
- Full privacy/security hardening remains deferred to the dedicated hardening PR.
- Cloudflare beacon/SRI and missing CSS source map console messages are secondary unless the app shell is confirmed to inject or misconfigure them.
