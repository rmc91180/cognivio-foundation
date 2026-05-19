# Teacher Endpoint Stability Hotfix

## Confirmed production issue

After Teacher Experience v1, production teacher pages called endpoints that returned 404:

- `GET /api/teachers/me/dashboard?period=semester`
- `GET /api/teachers/me/recognition`

The backend code had teacher self endpoints, but dynamic teacher routes such as `/api/teachers/{teacher_id}/dashboard` and `/api/teachers/{teacher_id}/recognition` were registered first. FastAPI treated `me` as a `teacher_id`, then returned `Teacher not found`.

## Endpoints fixed

| Frontend caller | Backend route | File/function | Test coverage |
| --- | --- | --- | --- |
| `teacherApi.myDashboard` | `GET /api/teachers/me/dashboard` | `backend/server.py::get_my_teacher_dashboard` | `backend/tests/test_teacher_admin_endpoint_stability.py` |
| `teacherApi.myRecognition` | `GET /api/teachers/me/recognition` | `backend/server.py::get_my_teacher_recognition` | `backend/tests/test_teacher_admin_endpoint_stability.py` |
| `teacherApi.myLessons` | `GET /api/teachers/me/lessons` | `backend/server.py::get_my_lessons` | existing teacher experience tests |
| `teacherApi.myCoaching` | `GET /api/teachers/me/coaching` | `backend/server.py::get_my_teacher_coaching` | existing teacher experience tests |
| `teacherApi.currentProfile` | `GET /api/teachers/me/profile` | `backend/server.py::get_my_teacher_profile` | existing teacher profile tests |
| `demoApi.seed` | `POST /api/demo/seed` | `backend/server.py::seed_demo_data_v1` | `backend/tests/test_teacher_admin_endpoint_stability.py` |

Route registry tests now confirm these routes are mounted under `/api`, and that `/api/teachers/me/dashboard` and `/api/teachers/me/recognition` are ordered before the dynamic `{teacher_id}` versions.

## Empty data behavior

`GET /api/teachers/me/dashboard` returns 200 for an approved active teacher even when there is no teacher profile yet. The payload includes all required top-level keys, profile-required readiness, and a next step pointing to `/my-profile`.

`GET /api/teachers/me/recognition` returns 200 with empty arrays and a zeroed summary when no recognition exists.

Deleted, tombstoned, inactive, or unapproved users do not receive active teacher dashboard payloads.

## Demo seed behavior

`POST /api/demo/seed` supports:

- teacher demo users: `{ "persona": "teacher", "scope": "current_teacher" }`
- school demo admins: `{ "persona": "k12", "scope": "current_workspace" }`
- training demo admins: `{ "persona": "training", "scope": "current_workspace" }`
- master admins in `DEMO_MODE=true`: global seeding with confirmation

Non-demo teacher/admin accounts cannot seed into real workspaces. Seeded records are marked with `demo_data=true` and `demo_persona`.

## Manual verification

1. Login as an approved teacher.
2. Open `/my-workspace`.
3. Confirm `GET /api/teachers/me/dashboard?period=semester` returns 200.
4. Open `/my-badges`.
5. Confirm `GET /api/teachers/me/recognition` returns 200.
6. If using a demo teacher, click **Fill my demo workspace** and confirm teacher pages populate.
7. Confirm non-demo teachers do not see demo seed controls.
