# Internal Testing Runbook

This runbook is for Cognivio internal rehearsal and demo readiness. Do not use real school data for these checks.

## Preconditions

- Use demo or internal accounts only.
- Confirm the latest protected `main` is deployed to Railway, or run a local build.
- Confirm `DEMO_MODE` before using demo reset controls.
- Keep browser zoom at 100%.
- Do not treat this runbook as final security or privacy certification.

## Seed Or Reset Demo Data

Local seed commands:

```powershell
$env:DEMO_MODE="true"
$env:PYTHONPATH="backend"
python backend/scripts/seed_demo_data.py --persona k12
python backend/scripts/seed_demo_data.py --persona training
python backend/scripts/seed_demo_data.py --persona all
```

Use `--force` only for local/dev environments where demo mode is intentionally off:

```powershell
$env:ENVIRONMENT="development"
$env:PYTHONPATH="backend"
python backend/scripts/seed_demo_data.py --persona all --force
```

Railway-safe demo reset should use the Master Admin controls when `DEMO_MODE=true`, or a one-off Railway command with `DEMO_MODE=true` for the job. Do not seed or reset demo data against an environment that contains real school data.

`DEMO_MODE=false` disables reset controls. It does not automatically hide existing seeded demo data from Master Admin internal testing views. Demo data should stay marked as `demo_data=true` and should not be counted as real customer activity.

Master Admin reset:

- Log in as the master admin.
- Open `/master-admin`.
- Use the demo reset controls for K-12, training, or all demo data.
- Confirm K-12 and training data appears in dashboards, teachers/trainees, videos, and reports.

## Test Personas

- Master admin: internal platform operator.
- School admin: K-12 principal or coach.
- Teacher: teacher workspace user.
- Training admin: university supervisor or teacher preparation lead.

Use current internal/demo credentials from the secure team source. Do not add real credentials to docs.

## K-12 Internal Test

1. Log in as a school admin.
2. Open `/onboarding` or use the dashboard setup assistant.
3. Add one teacher from the setup page or `/teachers`.
4. Plan a focused observation from `/observation/new`.
5. Use `/record` to record or upload a lesson and link it to the saved observation focus.
6. Open the video review page.
7. Add a timestamped comment.
8. Review talk-time and transcript panels when demo data supports them.
9. Return to `/dashboard` and check coaching priorities, patterns, recent lessons, and observation gaps.
10. Open `/reports` and export the coaching snapshot CSV.
11. Log in as a teacher and check workspace goals, reflections, recognition, and lesson feedback.
12. Open `/my-profile`, confirm the teacher profile can be saved, then open `/my-lessons`, `/my-workspace/coaching`, and `/my-badges`.

## First-Login Teacher Flow

1. Login as a newly approved teacher.
2. Confirm the privacy consent page appears once.
3. Accept consent and confirm the app advances to the teacher home route.
4. Open `/my-profile` and save grade level, class/section, and subject.
5. Open `/my-lessons` and confirm lesson recordings or a warm empty state render.
6. Open `/record` to confirm the upload/recording path is reachable.
7. Open `/my-coaching` and `/my-badges` and confirm neither page is blank.

## Teacher Experience V1 Demo Flow

1. Seed demo teacher data locally with `DEMO_MODE=true` and `python backend/scripts/seed_demo_data.py --persona all`.
2. Sign in as a seeded teacher persona or open a demo teacher workspace.
3. Open `/my-workspace` and use “Fill my demo workspace” if the account is demo-eligible.
4. Search for a lesson moment, coaching goal, recognition item, or gradebook reminder.
5. Open `/my-lessons` and filter by status, subject, or period.
6. Open `/record`; teacher users should not need to select themselves.
7. Open `/my-profile`, edit teaching details, and upload a privacy reference image.
8. Open `/privacy`, review consent, then use “Back to Teacher Profile.”
9. Open `/my-coaching`, add a reflection to a goal or shared moment.
10. Open `/my-badges` and review Cognivio accolades, highlighted moments, and spotlight lessons.
11. Confirm each gradebook reminder says “Demo reminder — LMS sync is not connected yet.”
12. Confirm demo records stay marked as demo data and do not mix into real customer counts.

## Teacher Endpoint and Admin Intelligence Hotfix Verification

1. Login as an approved teacher.
2. Open `/my-workspace`.
3. Confirm `GET /api/teachers/me/dashboard?period=semester` returns 200.
4. Open `/my-badges`.
5. Confirm `GET /api/teachers/me/recognition` returns 200.
6. If the teacher is a demo user, click **Fill my demo workspace**.
7. Confirm `/my-workspace`, `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile` populate without a hard refresh.
8. Login as a school admin.
9. Open `/dashboard`.
10. Confirm `GET /api/admin/workspace/dashboard?period=semester` returns 200.
11. If the school admin workspace is demo-eligible, click **Fill demo workspace**.
12. Confirm `/dashboard`, `/reports`, and `/teachers` populate with connected demo data.
13. Login as a training admin and repeat the `/dashboard` smoke.
14. Confirm `GET /api/admin/workspace/search?q=test` returns 200 for school and training admins.
15. Confirm no red error cards appear for valid empty teacher or admin workspaces.

## Baseline Routing, CORS, and Demo Seed Verification

1. Open `GET /api/health` and `GET /api/health/version` on the deployed Railway backend and confirm the safe environment/build fields match the expected deployment.
2. From `https://app.cognivio.live`, confirm `GET /api/institutions/lookup?organization_type=school&q=Test&limit=6` is not blocked by CORS.
3. Login as a school admin and open `/dashboard`; the admin dashboard should render instead of redirecting to `/onboarding`.
4. Open `/settings` as a school admin and confirm `GET /api/frameworks` returns 200 JSON, not 500.
5. Confirm Admin Settings renders even if framework settings are empty.
6. Login as a training admin and confirm `/settings` is visible and reachable.
7. Click each visible school/training admin dashboard and settings CTA once; only explicit setup CTAs should open setup/onboarding.
8. Login as a training admin and repeat `/dashboard`, `/teachers`, `/observation/new`, `/coaching`, `/reports`, and `/settings`.
9. Login as a teacher and confirm `/my-workspace`, `/my-lessons`, `/my-coaching`, `/my-badges`, and `/my-profile` render loading, starter, or populated states instead of blank pages.
10. If the admin workspace is demo eligible, confirm **Fill demo workspace** appears, calls `POST /api/demo/seed`, and refreshes dashboard/teacher/report data.
11. If the teacher workspace is demo eligible, confirm **Fill my demo workspace** appears, calls `POST /api/demo/seed`, and refreshes workspace/lessons/coaching/recognition/profile data.
12. Login as a non-demo admin or teacher and confirm demo seed controls are hidden.
13. Login as master admin and confirm `/master-admin`, `/master-admin/users`, `/master-admin/organizations`, `/master-admin/dependencies`, and `/master-admin/ai-quality` still work.
14. Confirm demo reset controls still follow `DEMO_MODE`; disabling demo mode must disable reset controls without hiding existing demo data from appropriate internal testing views.
15. If Cloudflare beacon or source-map console messages remain, verify they do not block Cognivio API calls or route rendering.

## Training Internal Test

1. Log in as a training admin.
2. Open `/onboarding` or use the training dashboard setup assistant.
3. Add one trainee, or use a seeded trainee.
4. Plan a trainee observation from `/observation/new`.
5. Use `/record` to record or upload the observation.
6. Review the video comments, talk-time summary, and transcript when available.
7. Return to `/dashboard` and check trainee status and upcoming observation planning.
8. Open `/reports` and export the cohort snapshot CSV.

## Master Admin Checks

1. Open `/master-admin`.
2. Review the Internal readiness panel.
3. Open Dependencies and confirm sanitized status cards.
4. Open AI Quality and confirm the latest quality gate state.
5. Reset demo data only when rehearsing with demo records.
6. Do not test lifecycle actions against real users.

## Known Limitations

- This is not real-school security approval.
- Full security, privacy, tenant isolation, CSRF, rate limiting, and index hardening remain deferred.
- Backend decomposition remains deferred.
- True resumable upload remains deferred.
- Scheduled reports and new PDF exports remain deferred.
