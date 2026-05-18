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
$env:PYTHONPATH="backend"
python backend/scripts/seed_demo_data.py --persona k12
python backend/scripts/seed_demo_data.py --persona training
python backend/scripts/seed_demo_data.py --persona all
```

Use `--force` only for local/dev environments where demo mode is intentionally off.

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
