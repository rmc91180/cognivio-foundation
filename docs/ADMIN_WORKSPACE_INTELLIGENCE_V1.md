# Admin Workspace Intelligence v1

## Purpose

Admin Workspace Intelligence v1 gives school and training admins a stable dashboard contract before the frontend renders dashboard sections. Empty workspaces return useful starter payloads, not 404s or red error cards.

## Route inventory and compatibility map

| Frontend caller | Backend route | File/function | Test coverage |
| --- | --- | --- | --- |
| `adminWorkspaceApi.dashboard` | `GET /api/admin/workspace/dashboard` | `backend/server.py::get_admin_workspace_dashboard` | `backend/tests/test_teacher_admin_endpoint_stability.py` |
| `adminWorkspaceApi.search` | `GET /api/admin/workspace/search` | `backend/server.py::search_admin_workspace` | `backend/tests/test_teacher_admin_endpoint_stability.py` |
| `demoApi.seed` | `POST /api/demo/seed` | `backend/server.py::seed_demo_data_v1` | `backend/tests/test_teacher_admin_endpoint_stability.py` |

The older `/api/dashboard/intelligence` endpoint remains available for existing callers. The new admin workspace endpoint is the stable contract used by the school and training dashboard surfaces.

## Dashboard contract

`GET /api/admin/workspace/dashboard?period=semester` returns:

- workspace identity and mode
- `demo_eligible`
- summary counts
- next best actions
- priority cards
- teacher/trainee attention
- observation gaps
- coaching activity
- recognition candidates
- recent lessons/observations
- structured communications
- reports
- gradebook reminders
- trends
- search index summary

Every top-level key is always present. Empty arrays are valid.

## School vs training behavior

School admins see teacher-oriented copy and counts. Training admins see trainee/cohort-oriented copy and counts. Master Admin stays separate in the Master Admin area.

## Search contract

`GET /api/admin/workspace/search?q=` searches only the current admin workspace and returns grouped results for teachers/trainees, lessons, moments, coaching, recognition, reports, gradebook reminders, and communications. Empty queries return recent or recommended items when available; no matches return `results: []`.

## Demo seed behavior

If the backend marks the workspace `demo_eligible=true`, the dashboard shows **Fill demo workspace**.

- school admin demo workspace seeds K-12 demo data
- training admin demo workspace seeds training demo data
- non-demo workspaces hide the seed control

The endpoint fills connected teacher/trainee, lesson, coaching, recognition, report, and gradebook reminder data. It does not seed into real customer workspaces for ordinary admins.

## Gradebook reminders

Gradebook reminders are demo/internal placeholders for future LMS integration. The UI must show:

`Demo reminder — LMS sync is not connected yet.`

Real LMS integration is deferred.

## Deferred

- real LMS integration
- generic chat
- scheduled reports
- PDF exports unless already present
- broad security/privacy hardening
- backend decomposition
