# End-to-End App Flow Audit

This hotfix stabilizes internal testing flows that were closing loops or rendering blank screens. It is not final pilot security certification and does not replace the future privacy, tenant isolation, or backend decomposition work.

## Routes Audited

- `/login`
- `/consent`
- `/privacy`
- `/my-workspace`
- `/my-profile`
- `/my-lessons`
- `/my-workspace/coaching`
- `/my-badges`
- `/videos`
- `/record`
- `/dashboard`
- `/teachers`
- `/observation/new`
- `/coaching`
- `/reports`
- `/master-admin`
- `/master-admin/users`
- `/master-admin/organizations`
- `/master-admin/dependencies`
- `/master-admin/ai-quality`

## Fixed Flows

### Master Admin Approval

Master Admin approve and deny/delete actions now return a consistent success contract. A successful lifecycle transition is treated as success even if the confirmation email cannot be sent. In that case the UI shows a success-with-warning message that points the operator to Resend health instead of saying approval failed.

### First-Login Consent

The consent page now persists all consent choices, refreshes the authenticated user/session state, invalidates consent gate queries, and returns the teacher to the intended page or role home. If saving consent fails, the teacher stays on the page and sees a clear error.

### Teacher Profile Setup

Teacher setup is reachable at `/my-profile`. The page supports the current required profile fields: display name, grade level, class/section, and subject. Saving creates or links the teacher record safely, updates completion state, refreshes the session, and returns to the original destination such as Lessons.

### Lessons

`/my-lessons` is now the teacher lesson hub. It shows lesson recordings, review status, summaries when available, and links back to the video review page. If setup is required, the CTA points to `/my-profile` or `/privacy` instead of looping to the dashboard.

### Coaching

`/my-workspace/coaching` now uses a teacher-facing coaching surface with active goals, shared moments from video comments, and recent reflections. Empty states are warm and actionable.

### Recognition

`/my-badges` now calls the canonical `/api/recognition/my-badges` endpoint, renders inside the app shell, and shows loading, error, badge, and empty states instead of a blank page.

### Blank Screen Protection

A route-level error boundary now catches page render failures and gives the user a way back to their dashboard.

## Demo Data

Local seed command:

```powershell
$env:DEMO_MODE="true"
$env:PYTHONPATH="backend"
python backend/scripts/seed_demo_data.py --persona all
```

Available personas:

```powershell
python backend/scripts/seed_demo_data.py --persona k12
python backend/scripts/seed_demo_data.py --persona training
python backend/scripts/seed_demo_data.py --persona all
```

For local development only, `--force` can be used when `DEMO_MODE=false` and `ENVIRONMENT` is `development`, `local`, or `test`.

`DEMO_MODE=true` enables reset/seed controls. `DEMO_MODE=false` disables reset controls but does not automatically hide existing seeded demo data from Master Admin internal testing views. Demo records must remain marked with `demo_data=true` and `demo_persona`.

## Test Scripts

First-login consent:

1. Approve a pending teacher.
2. Log in as that teacher.
3. Confirm the consent page appears once.
4. Check each consent item and submit.
5. Confirm the app routes to `/my-workspace` or the original destination.
6. Refresh and confirm consent does not block again.

Teacher profile and lessons:

1. Open `/my-lessons` as a teacher without a profile.
2. Follow the CTA to `/my-profile`.
3. Save grade level and subject.
4. Confirm the app returns to Lessons.
5. Open `/record` or `/videos` to add or review lesson recordings.

Teacher coaching and recognition:

1. Open `/my-workspace/coaching`.
2. Confirm active goals, shared moments, or a warm empty state render.
3. Open `/my-badges`.
4. Confirm badges or a friendly empty state render.

Master Admin approval:

1. Open `/master-admin/users`.
2. Open a pending user detail page.
3. Approve the request.
4. Confirm the UI shows approval success.
5. If Resend is unhealthy, confirm the UI shows success with an email warning.

## Deferred

- Broad security and privacy hardening.
- Full tenant isolation audit.
- Backend decomposition.
- Real pilot launch certification.
- New product features outside this stabilization pass.
