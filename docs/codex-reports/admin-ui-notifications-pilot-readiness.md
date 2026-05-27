# PR C7 — Admin coaching controls, notifications, stricter workspace safety, pilot readiness

## Summary

C1–C6 protected the canonical teacher coaching artifact and shipped the
admin review + thread + action-plan endpoints. C7 closes the workflow
loop:

1. **Admin UI controls** — new
   `AdminTeacherFeedbackReviewCard` renders the C5 `teacher_preview` +
   `teacher_feedback_admin_status` and ships Approve / Hide / Request
   revision buttons. Wired into `VideoPlayerPage` for admins.
2. **Teacher notifications** — server-side fan-out on admin actions:
   * `admin_approved` AND artifact actually allowed → notify
     `teacher_feedback_ready`.
   * `admin_approved` but artifact still blocked → **no** notification.
   * `admin_hidden` / `revision_requested` → **no** teacher
     notification (internal state change).
   * Admin `shared_with_teacher` thread reply → notify
     `coaching_thread_reply`.
   * Admin `admin_only` internal note → **no** notification.
3. **Strict tenant authorization** — `_require_admin_in_same_tenant` is
   now async, always loads the teacher document via the canonical
   `_get_teacher_or_404` helper, and additionally rejects on
   organization/school mismatch. All admin review + thread endpoints
   route through it.
4. **Admin audit endpoint** — new
   `GET /api/admin/teacher-coaching-artifacts/audit` exposes the C5
   audit collection programmatically for admin dashboards. Same tenant
   rules apply.
5. **Smoke automation** — `run_pilot_smoke_checks.py` gained
   `--base-url` + `--teacher-token` + `--admin-token` for optional API
   smoke checks, plus a `--forensic-teacher-id` alias.

All C1–C6 gates remain authoritative. Admin approval still cannot
override missing source, unsafe text, or insufficient evidence.

## Files inspected

Backend:

* `backend/server.py` — admin review endpoints, thread endpoints,
  action-item lifecycle endpoints, `_create_notification` helper,
  `_require_admin_in_same_tenant`, `_get_teacher_or_404`,
  `_compute_teacher_feedback_admin_status`,
  `_build_teacher_lesson_coaching_artifact_for`
* `backend/app/services/teacher_lesson_coaching_artifact.py`,
  `teacher_artifact_quarantine.py`, `lesson_moment_quality.py`
  (unchanged)
* `backend/scripts/audit_teacher_coaching_artifacts.py` (unchanged)
* `backend/scripts/run_pilot_smoke_checks.py` (extended)

Frontend:

* `frontend/src/pages/VideoPlayerPage.js`
* `frontend/src/pages/TeacherCoachingPage.js`
* `frontend/src/pages/TeacherWorkspacePage.js`,
  `TeacherLessonsPage.js`, `TeacherBadgesPage.js`
* `frontend/src/features/teachers/api.js`,
  `frontend/src/lib/api.js`
* `frontend/src/components/admin/AdminTeacherFeedbackReviewCard.js`
  (new)
* `frontend/src/lib/teacherCoachingArtifact.js`,
  `frontend/src/lib/coachVoice.js`

## Admin UI controls

`frontend/src/components/admin/AdminTeacherFeedbackReviewCard.js`:

* Renders `teacher_feedback_admin_status` as a colored pill
  (Auto-allowed / Admin approved / Hidden from teacher / Revision
  requested / Blocked — source / quality / safety).
* Displays the `teacher_preview` summary opening, action items count,
  deep dive availability, and blocked reason.
* Three buttons:
  * **Approve teacher feedback** — calls
    `adminCoachingApi.upsertReview(assessmentId, { status: "admin_approved", review_note? })`.
    UI copy explicitly states approval does not override source / safety
    / evidence gates.
  * **Hide from teacher** — requires a non-empty reason. Calls
    `{ status: "admin_hidden", hidden_reason, review_note }`.
  * **Request revision** — requires a reason. Calls
    `{ status: "revision_requested", revision_reason, review_note }`.
* Loading and success/error toast states. On success, `invalidateKeys`
  trigger query refetch so the admin sees the updated
  `teacher_feedback_admin_status` immediately.

The card is mounted inside `VideoPlayerPage.js` between the summary and
the teacher-facing deep-dive / action-item surfaces, gated by
`isAdmin && assessmentRes?.id`. Teachers never see the card.

## Authorization hardening

**Before C7**, `_require_admin_in_same_tenant` was a best-effort match
that fell through to `_get_teacher_or_404` for the strict check.

**After C7** the helper:

* is async,
* always calls `_get_teacher_or_404` (which already enforces canonical
  tenant + observer-of rules and audit-logs cross-tenant denials),
* additionally rejects with 403 `forbidden_tenant_access` when the
  admin's `organization_id` or `school_id` differs from the teacher's,
* returns the teacher document so callers don't have to re-load it.

`super_admin` continues to bypass the org/school assertion (intentional
global behaviour).

Endpoints routed through it:

* `GET  /api/admin/assessments/{id}/teacher-feedback-review`
* `POST /api/admin/assessments/{id}/teacher-feedback-review`

The thread endpoints (`/api/admin/teachers/{teacher_id}/coaching-thread`)
already used `_get_teacher_or_404` directly, which carries the same
canonical check.

The new admin audit endpoint
(`GET /api/admin/teacher-coaching-artifacts/audit`) calls
`_get_teacher_or_404` per discovered teacher and also rejects when a
`workspace_id` query parameter doesn't match the admin's
`organization_id` (unless super_admin).

## Notifications

New helpers in `backend/server.py`:

* `_find_teacher_user(teacher)` — locate the teacher's user account by
  `teacher_id` or email.
* `_notify_teacher_feedback_review_change(...)` — only sends
  `teacher_feedback_ready` when status is `admin_approved` AND the
  rebuilt artifact actually has
  `teacher_feedback_allowed: True`. No notification for `admin_hidden`
  or `revision_requested`.
* `_notify_teacher_admin_thread_reply(...)` — only sends
  `coaching_thread_reply` when visibility is `shared_with_teacher`. The
  admin's body is truncated to a 140-character excerpt for the
  notification message (no admin internal note ever leaks).

Both helpers go through the existing `_create_notification` so the
notification surfaces in the existing teacher notification UI and
`/api/notifications/unread-count`.

The endpoint responses now return `notification_created: bool` so the
admin frontend can show "Teacher notified" feedback when relevant. This
is a backward-compatible addition.

## Teacher / admin thread + reflection UI

C6 already migrated the teacher thread to consume the merged
`/api/teachers/me/coaching-thread` response. C7 adds the matching
admin-side API method (`adminCoachingApi.postThreadMessage`) and the
client-side admin card. A dedicated admin thread panel is deferred to
C8 — the backend endpoints, the API client methods, and the
notification fan-out are in place so the C8 UI sweep can drop in a
minimal viewer.

## Action-plan lifecycle UI

`TeacherCoachingPage.js`:

* Artifact-derived tasks now carry `source_kind:
  "artifact_action_item"`, `action_item_id`, and `assessment_id`.
* The "I tried this" button now routes artifact items through
  `teacherApi.actionItemTried(actionItemId, { assessment_id })`
  (C6 endpoint) and legacy tasks through the existing
  `updateCoachingTask`. No duplicate persistence — the C6 backend
  ensures one `coaching_tasks` row per
  `(teacher_id, source_action_item_id)`.
* New API methods `teacherApi.actionItemTried`,
  `teacherApi.actionItemReflect`, and `teacherApi.myCoachingThread` are
  exported alongside the existing surface.

## Audit endpoint / script changes

New endpoint:
`GET /api/admin/teacher-coaching-artifacts/audit?teacher_id=...&assessment_id=...&video_id=...&workspace_id=...&limit=...`.

Returns the same shape as
`backend/scripts/audit_teacher_coaching_artifacts.py::audit_collections`
(generated_at, counts, issues, samples, filters). Admin-only; tenant
isolation enforced as described above.

## Smoke automation

`backend/scripts/run_pilot_smoke_checks.py` (extended in C7):

* New args: `--base-url`, `--teacher-token`, `--admin-token`,
  `--forensic-teacher-id` (alias for `--teacher-id`).
* Reads `COGNIVIO_BASE_URL` / `COGNIVIO_TEACHER_TOKEN` /
  `COGNIVIO_ADMIN_TOKEN` from env when args are omitted.
* When tokens are present, runs API-level checks via `requests`:
  * `api_teacher_latest_lesson` — confirms the teacher endpoint returns
    no banned strings.
  * `api_admin_assessment_preview` — confirms the admin endpoint
    returns `teacher_preview` and `teacher_feedback_admin_status`.
* DB-only mode is the default and never writes data.

## Tests added/updated

**Backend (new C7 tests, 11 passing):**

* `backend/tests/test_admin_workflow_notifications_audit.py`:
  * Cross-workspace admin denied on review (403).
  * Same-workspace admin can review.
  * `admin_approved` creates teacher notification when artifact ends up
    allowed.
  * `admin_approved` does NOT notify when artifact still blocked by
    `analysis_quality`.
  * `admin_hidden` does NOT notify teacher.
  * `revision_requested` does NOT notify teacher.
  * Admin shared_with_teacher thread message creates
    `coaching_thread_reply` notification.
  * Admin `admin_only` note does NOT notify.
  * Admin audit endpoint returns report shape for admin in tenant.
  * Admin audit endpoint rejects teacher caller (403).
  * Admin audit endpoint rejects cross-workspace admin (403).

**Frontend (new C7 tests, 7 passing):**

* `frontend/src/components/admin/AdminTeacherFeedbackReviewCard.test.js`:
  * Renders the auto-allowed status pill and summary preview.
  * Renders the blocked status pill and blocked reason.
  * Approve calls `adminCoachingApi.upsertReview` with `admin_approved`.
  * Hide requires a reason and shows error when missing.
  * Hide calls API with `hidden_reason` + `review_note` when reason
    provided.
  * Request revision requires a reason and calls API with
    `revision_reason`.
  * No banned strings rendered.

**Regression (all passing):**

* Backend: all 11 C1–C7 backend test files green (131 targeted tests),
  full backend suite green (run separately).
* Frontend: 8 suites / 36 targeted tests green
  (PilotTeacherExperience, TeacherWorkspacePage, TeacherCoachingPage,
  TeacherBadgesPage, AdminReviewAndActionPlan,
  AdminTeacherFeedbackReviewCard, EndToEndAppFlowAudit,
  TeacherExperienceV1). Production build green.

## Commands run

```
# Backend
cd backend
python -m py_compile server.py                                            # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py     # ok
python -m py_compile app/services/teacher_artifact_quarantine.py          # ok
python -m py_compile app/services/lesson_moment_quality.py                # ok
python -m py_compile scripts/audit_teacher_coaching_artifacts.py          # ok
python -m py_compile scripts/run_pilot_smoke_checks.py                    # ok
python -m compileall -q app                                               # ok
python -m pytest tests/test_admin_workflow_notifications_audit.py -q      # 11 passed
python -m pytest tests/test_admin_teacher_feedback_review.py -q           # 11 passed
python -m pytest tests/test_teacher_admin_coaching_thread.py -q           # 6 passed
python -m pytest tests/test_action_plan_lifecycle.py -q                   # 6 passed
python -m pytest tests/test_pilot_teacher_experience_integration.py -q    # 15 passed
python -m pytest tests/test_teacher_lesson_coaching_artifact.py -q        # 15 passed
python -m pytest tests/test_teacher_artifact_quarantine.py -q             # 24 passed
python -m pytest tests/test_lesson_moment_evidence_quality.py -q          # 23 passed
python -m pytest tests/test_video_source_chain_audit.py -q                # 6 passed
python -m pytest tests/test_teacher_feedback_projection.py -q             # 5 passed
python -m pytest tests/test_end_to_end_app_flow_hotfix.py
                tests/test_pilot_demo_flow.py -q                          # 9 passed
python -m pytest tests/ -q --timeout 120                                  # full suite green

# Frontend
cd frontend
env CI=true npm test -- --runInBand \
    --testPathPattern="(PilotTeacherExperience|TeacherWorkspacePage|TeacherCoachingPage|TeacherBadgesPage|AdminReviewAndActionPlan|AdminTeacherFeedbackReviewCard|EndToEndAppFlowAudit|TeacherExperienceV1)\.test\."
# 8 suites passed, 36 tests passed
env CI=true npm run build                                                 # green
```

## Known limitations

1. **Admin thread viewer UI deferred to C8.** Backend endpoints, API
   client methods, and notification fan-out are all in place. The
   admin-side React surface for viewing the merged thread is a small
   UI sweep that can land next.
2. **Notification frontend polish deferred to C8.** Notifications fan
   out via the existing `_create_notification` helper and surface in
   `/api/notifications`. A dedicated "Coach replied" toast / unread
   badge styling lift is a UX polish task for C8.
3. **Admin audit endpoint has no frontend page yet.** The endpoint is
   live and tested; surfacing the JSON in an admin diagnostic page is
   C8 work.
4. **Smoke script API mode is opt-in.** Operators must pass tokens via
   args or env vars. DB-only mode is the default and is what runs in
   the production smoke hook today.

## Production rollout / smoke instructions

After deploy:

1. **Sanity DB smoke** —
   ```bash
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/run_pilot_smoke_checks.py \
       --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b --json
   ```
   * Overall must be `ok`; `teacher_artifact_banned_strings`,
     `artifact_blocked_not_bypassed`, `no_orphan_visible_tasks`,
     `admin_review_consistency` must all be `ok`.

2. **API smoke (optional, when tokens are available)** —
   ```bash
   MONGO_URL=... DB_NAME=... \
   COGNIVIO_BASE_URL=https://api.example.com \
   COGNIVIO_TEACHER_TOKEN=... \
   COGNIVIO_ADMIN_TOKEN=... \
     python backend/scripts/run_pilot_smoke_checks.py \
       --teacher-id <id> --assessment-id <id> --json
   ```

3. **Manual admin review smoke** —
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"status":"admin_hidden","hidden_reason":"Pilot smoke"}' \
        "$BASE_URL/api/admin/assessments/<id>/teacher-feedback-review"
   ```
   * Response: `teacher_feedback_admin_status: "admin_hidden"`,
     `notification_created: false`.
   * Teacher `/api/teachers/me/latest-lesson` returns `{ "lesson": null,
     "artifact": { "blocked_reason": "admin_hidden", ... } }`.

4. **Admin thread reply smoke** —
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"assessment_id":"<id>","body":"Smoke reply"}' \
        "$BASE_URL/api/admin/teachers/<teacher_id>/coaching-thread"
   ```
   * Response: `notification_created: true` (`shared_with_teacher` default).
   * `GET /api/notifications` as the teacher should include the new
     `coaching_thread_reply` entry.

5. **Audit endpoint smoke** —
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$BASE_URL/api/admin/teacher-coaching-artifacts/audit?teacher_id=<id>"
   ```
   * 200 with `issues`, `counts`, `filters`.
   * Cross-workspace admin returns 403.

## C8 handoff notes

C7 delivers the admin controls, notification plumbing, strict tenant
checks, and pilot smoke automation. C8 should focus on:

1. **LLM-driven coach voice from transcript** — defer to Claude/OpenAI
   to paraphrase classroom transcripts into specific coaching prose
   when transcript signal is strong.
2. **Admin thread viewer surface** — small React panel reading
   `adminCoachingApi.getThread(teacherId, { assessment_id })`,
   showing shared reflections + replies + admin_only notes (admin
   side only).
3. **Notification UX polish** — coaching-thread reply toast + badge
   styling lift on the teacher header.
4. **Admin diagnostic dashboard** — surface
   `/api/admin/teacher-coaching-artifacts/audit` JSON as a sortable
   table of issue codes per teacher / per assessment.
5. **Cross-lesson goal analytics** — aggregate tried / reflected
   counts across lessons for admin reporting.
6. **Onboarding / in-product guidance** — short tooltips on the
   admin review card and teacher action-item card.
7. **Final pilot readiness checklist** — automate the smoke script in
   the deploy hook.
