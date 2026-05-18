# Pilot Demo Flow v1

This PR builds the first coherent client-demo loop: role-personalized routing, focused dashboards, observation setup, teacher workspace, coaching reflections, notifications, reports, and repeatable demo data.

## Demo Routes

- `/onboarding` - setup hub with progress, next step, quick add, and first-observation actions.
- `/dashboard` - school admin dashboard or training supervisor dashboard, depending on role.
- `/my-workspace` - teacher daily workspace with latest lesson, goals, recognition, and reflections.
- `/observation/new` - observation focus setup for school and training admins.
- `/coaching` - open coaching work for admins.
- `/recognition-review` and `/my-badges` - admin recognition review and teacher recognition.
- `/reports` - coaching snapshot for school admins and cohort snapshot for training admins.
- `/master-admin` - platform overview and demo reset controls for master admins.

## Demo Personas

K-12 persona:

- Organization: Westbrook Elementary
- Principal: Principal Sarah Chen
- Teachers: 8 demo teachers, including one teacher login record
- Includes reviewed lesson summaries, open and completed coaching tasks, recognition badges, and a discussion-focused dashboard pattern

Training persona:

- Organization: Metro University Teacher Ed
- Supervisor: Dr. James Okonkwo
- Cohort: Fall 2025 Cohort
- Trainees: 12 demo trainees with placement sites, upcoming observations, and recent observation summaries

Demo login password for seeded users: `DemoAccess2026!`

## Onboarding Path

Use the internal readiness flow before jumping into analytics:

1. Start from `/onboarding` or the setup assistant on `/dashboard`.
2. Add the first teacher or trainee.
3. Plan the first focused observation.
4. Record or upload from `/record`.
5. Review video comments and talk-time when demo data supports it.
6. Return to dashboard intelligence.
7. Open reports and export CSV for an internal planning snapshot.

This is still internal demo readiness. Final real-school privacy/security approval is deferred to the security hardening track.

## Seeding Demo Data

Run only when `DEMO_MODE=true`, or with `--force` in a local/dev environment:

```powershell
$env:PYTHONPATH="backend"
python backend/scripts/seed_demo_data.py --persona k12
python backend/scripts/seed_demo_data.py --persona training
python backend/scripts/seed_demo_data.py --persona all
```

The script only deletes and recreates records marked with `demo_data: true` and the selected `demo_persona`. It does not wipe non-demo data.

## Resetting Demo Data

When `DEMO_MODE=true`, a super admin can call:

```http
POST /api/demo/reset?persona=k12
POST /api/demo/reset?persona=training
POST /api/demo/reset?persona=all
```

Master admins also see reset buttons on `/master-admin` when demo mode is enabled.

## Coach Voice

Teacher-facing pilot surfaces avoid rubric codes, numeric scores, and system copy. Feedback is written as direct coaching language addressed to "you" and "your," with strengths before next steps.

## Deferred

- Mobile camera upload
- Full AI quality dashboard
- Full eval CI gate
- Mobile responsive audit
- Complete sales script
- Full Tone Specialist rollout
- PR #3 cleanup lifecycle work

PR #3 remains superseded by PR #9 and must not be merged as-is. All changes in this PR are based on current `main`.
