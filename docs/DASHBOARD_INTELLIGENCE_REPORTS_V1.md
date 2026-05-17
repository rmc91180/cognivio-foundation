# Dashboard Intelligence and Reports v1

This PR turns the pilot dashboard and reports into a deterministic, role-scoped intelligence layer for internal testing.

## Implemented

- `GET /api/dashboard/intelligence`
  - Returns role-scoped coaching priorities, cycle summary, patterns, highlights, observation gaps, and recent lessons.
  - School admins see their workspace teachers and lessons.
  - Training admins receive training-mode data for their cohort/trainees.
  - Teachers are denied admin intelligence and should use `/my-workspace`.
  - Master admins use existing safe visibility rules.

- `GET /api/reports/coaching-snapshot`
  - Returns reviewed lessons, teachers with feedback, open/completed coaching tasks, recognition earned, observation gaps, plain-language patterns, and teacher planning rows.

- `GET /api/reports/cohort-snapshot`
  - Returns active trainees, completed/upcoming observations, trainee status rows, and recent observation summaries.

- `GET /api/reports/export/coaching-snapshot.csv`
- `GET /api/reports/export/cohort-snapshot.csv`
  - Uses Python stdlib CSV.
  - Includes human-readable headers.
  - Excludes transcripts, private comments, and teacher-private data outside role scope.

## Pattern Logic

The first version is deterministic and does not make new LLM calls.

- Observation gaps: teachers with no observation in the current cycle or a long gap since the last observation.
- Lesson ready: reviewed lessons that are ready to turn into follow-up.
- Coaching backlog: open coaching tasks.
- Growth area cluster: three or more teachers with a shared recent plain-language focus area.
- Improvement highlight: recent growth across comparable lessons.
- Recognition: awarded badges or growth moments.
- Video observation signal: shared comments can count as moments to revisit.
- Talk-time signal: when multiple recent lessons carry a high talk-time signal, dashboard language frames it as a coaching conversation starter.

Rubric codes are mapped to plain-language labels before returning dashboard patterns.

## Frontend

- `SchoolAdminPilotDashboard` now uses `/api/dashboard/intelligence`.
- `TrainingDashboard` now uses `/api/reports/cohort-snapshot`.
- `ReportsPage` now uses the new coaching/cohort snapshots and CSV export endpoints.
- Mobile report tables collapse into cards where the page would otherwise become dense.
- Empty states avoid system wording and explain what will appear after lessons are reviewed.

## Demo Data

The existing demo seed remains idempotent and scoped with `demo_data: true`.

- K-12 demo data includes recent lessons, shared growth patterns, observation gaps, open/completed coaching tasks, recognition, video comments, and audio metadata.
- Training demo data includes active trainees, completed observations, upcoming observations, at-risk/not-started trainees, recent summaries, and video observation metadata.

## Deferred

- Advanced analytics.
- LLM-generated dashboard narratives.
- Scheduled emailed reports.
- PDF exports beyond existing report tooling.
- A cache layer for dashboard intelligence.
- Full security/privacy/tenant audit from the future hardening PR.
- Backend decomposition away from the legacy `server.py` bridge.
