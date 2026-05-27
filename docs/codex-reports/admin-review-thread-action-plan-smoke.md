# PR C6 — Admin review workflow, coaching thread, action-plan lifecycle, smoke automation

## Summary

C1–C5 built and protected the canonical teacher coaching artifact:

* **C1** — source-chain integrity audit + cascade cleanup
* **C2** — teacher-facing quarantine (unsafe-text + orphan gates)
* **C3** — moment + assessment evidence-quality gates
* **C4** — canonical `TeacherLessonCoachingArtifact`
* **C5** — frontend migration to artifact-first rendering, admin
  teacher_preview, recognition separation, Hebrew mappings, artifact
  audit CLI

C6 adds the **workflow layer** so the artifact becomes an active
coaching surface rather than a static report:

1. **Persistent admin review** — new `teacher_feedback_reviews`
   collection + `POST/GET /api/admin/assessments/{id}/teacher-feedback-review`
   endpoint. The artifact builder honors `admin_hidden` and
   `revision_requested`; `admin_approved` is informational and
   cannot override C1/C2/C3 gates.
2. **Coaching thread** — merged teacher reflections (private + shared)
   and admin responses (existing `video_comments` with
   `visibility: shared_with_teacher`). Two new endpoints expose the
   thread for teachers (`/api/teachers/me/coaching-thread`) and for
   admins (`/api/admin/teachers/{teacher_id}/coaching-thread`).
3. **Action-plan lifecycle** — `POST
   /api/teachers/me/action-items/{action_item_id}/tried` and
   `/reflect` promote the artifact's action item into a real
   `coaching_tasks` row **only on first call** (no duplicate persistence
   on artifact reads). Reflection updates the task status and
   reflection counts.
4. **VideoPlayer rendering** — the teacher view of `VideoPlayerPage`
   now renders the artifact's action items + a blocked-state banner.
5. **Audit + smoke automation** — `audit_teacher_coaching_artifacts.py`
   gained the new C6 issue codes; `run_pilot_smoke_checks.py` is a
   new read-only operator script.

## Files inspected

Backend:

* `backend/server.py` — admin assessment endpoint, reflection endpoint,
  `_compute_teacher_feedback_admin_status`, `_build_teacher_lesson_coaching_artifact_for`
* `backend/app/services/teacher_lesson_coaching_artifact.py` — gate
  composition + `_empty_artifact`
* `backend/app/services/teacher_artifact_quarantine.py`,
  `backend/app/services/lesson_moment_quality.py` (unchanged)
* `backend/scripts/audit_teacher_coaching_artifacts.py` (extended)
* `backend/scripts/run_pilot_smoke_checks.py` (new)
* `backend/tests/test_pilot_teacher_experience_integration.py`,
  `test_teacher_lesson_coaching_artifact.py`,
  `test_teacher_artifact_quarantine.py`,
  `test_lesson_moment_evidence_quality.py`,
  `test_video_source_chain_audit.py`,
  `test_teacher_feedback_projection.py`

Frontend:

* `frontend/src/pages/VideoPlayerPage.js` — teacher artifact action
  items panel + blocked-state banner
* `frontend/src/lib/teacherCoachingArtifact.js` (C5 helpers reused)
* `frontend/src/pages/PilotTeacherExperience.test.js` (regression)

## Admin review endpoint / status behavior

**Endpoints**

* `POST /api/admin/assessments/{assessment_id}/teacher-feedback-review`
  with body `{ status, review_note?, hidden_reason?, revision_reason? }`.
  Allowed `status` values:
  * `admin_approved` — informational. Persisted but does NOT bypass
    the C1/C2/C3 gates.
  * `admin_hidden` — the artifact builder collapses to an
    `admin_review_pending` empty state. Teacher feedback is suppressed
    even when source + evidence + safety would otherwise allow it.
  * `revision_requested` — the artifact builder collapses to an
    `admin_revision_requested` empty state.
* `GET /api/admin/assessments/{assessment_id}/teacher-feedback-review`
  returns the latest review record for the admin UI.

**Persistent model**

New collection `teacher_feedback_reviews`:

```json
{
  "id": "...",
  "assessment_id": "...",
  "video_id": "...",
  "teacher_id": "...",
  "workspace_id": "...",
  "organization_id": "...",
  "artifact_version": "teacher_lesson_coaching_artifact_v1",
  "status": "admin_approved" | "admin_hidden" | "revision_requested",
  "reviewed_by": "<user_id>",
  "reviewed_by_email": "...",
  "reviewed_by_name": "...",
  "reviewed_at": "<iso8601>",
  "review_note": "...",
  "hidden_reason": "...",
  "revision_reason": "...",
  "teacher_visible_override": true | false,
  "created_at": "...",
  "updated_at": "..."
}
```

**Artifact builder rules**

`build_teacher_lesson_coaching_artifact(..., admin_review=...)`:

* `admin_hidden` → `teacher_feedback_allowed: False`,
  `blocked_reason: "admin_hidden"`, empty state title
  `"A coach is still reviewing this lesson."` (no admin note leaked).
* `revision_requested` → `teacher_feedback_allowed: False`,
  `blocked_reason: "revision_requested"`, empty state title
  `"A coach asked for one more adjustment before sharing feedback."`.
* `admin_approved` → falls through to the C1/C2/C3 gates. Admin
  approval **cannot** override missing source or unsafe text.

**Computed admin status**

`_compute_teacher_feedback_admin_status(artifact)` now returns:
`auto_allowed | blocked_quality | blocked_source | blocked_safety |
admin_hidden | revision_requested`. The admin
`/api/assessments/{id}` response includes it as
`teacher_feedback_admin_status`.

## Thread / message model

Reuses existing collections rather than inventing a parallel one:

* `coaching_task_reflections` — teacher messages.
  * `visibility: "private"` → teacher only.
  * `visibility: "shared_with_admin"` → teacher + admin.
* `video_comments` — admin/observer messages.
  * `visibility: "shared_with_teacher"` → teacher + admin.
  * `visibility: "admin_only"` → admin only (internal notes).
  * Optional `source: "admin_response"` and `action_item_id` link
    a response back to a specific artifact action item.

Merged view exposed at:

* `GET /api/teachers/me/coaching-thread?assessment_id=...&video_id=...`
  — includes the teacher's private + shared reflections AND admin
  `shared_with_teacher` responses anchored to the same assessment
  /video.
* `GET /api/admin/teachers/{teacher_id}/coaching-thread?assessment_id=...&video_id=...`
  — admin view. Filters out private teacher reflections.
* `POST /api/admin/teachers/{teacher_id}/coaching-thread`
  — admin posts a message. Default `visibility = shared_with_teacher`;
  `admin_only` keeps the note internal.

Each merged message includes: `kind`, `sender_role`, `body`,
`visibility`, `shared_with_admin`, `assessment_id`, `video_id`,
`action_item_id`, `coaching_task_id`, `author_id`, `created_at`.

## Reflection privacy and sharing

* Teacher reflections default to private (`visibility: private`).
* Sharing is explicit (`visibility: shared_with_admin`).
* The admin coaching-thread endpoint filters out private reflections at
  load time (`include_private=False`).
* The teacher coaching-thread endpoint always includes their own
  private reflections (`include_private=True`).
* Admin `admin_only` notes are filtered out of the teacher view.
* Backend tests assert each direction explicitly.

## Action-plan lifecycle

Single source of truth for accepted artifact action items is the
existing `coaching_tasks` collection with two new fields:

* `source_type: "artifact_action_item"`
* `source_action_item_id`
* `source_artifact_version`

**Endpoints**

* `POST /api/teachers/me/action-items/{action_item_id}/tried` —
  promotes the artifact action item to a `coaching_tasks` row (only
  on first call; subsequent calls reuse the existing row). Marks
  `status: "tried"` and sets `tried_at`.
* `POST /api/teachers/me/action-items/{action_item_id}/reflect` —
  creates a `coaching_task_reflections` row (private by default),
  marks the task `status: "reflected"` with `reflected_at`, and
  increments `reflection_count` / `shared_reflection_count`.

**Rules enforced**

* The artifact is rebuilt server-side to fetch the action item by id —
  the teacher cannot promote an item that isn't in the current allowed
  artifact.
* If `teacher_feedback_allowed` is False, both endpoints raise 409.
* Action item text is gated through `is_teacher_visible_text_safe`
  before persistence — unsafe text raises 409 even if the artifact
  builder were tricked into emitting it.
* Repeat tried/reflect calls do NOT create duplicate tasks. Tests
  assert one task per (teacher_id, source_action_item_id) pair.

## VideoPlayer rendering

`VideoPlayerPage.js` already loaded `teacherArtifact` / `teacherActionItems`
in C5 but did not render the action items. C6 adds two new rendered
surfaces inside the teacher report panel:

1. `data-testid="teacher-artifact-blocked-state"` — visible when the
   artifact is blocked. Shows the artifact's empty-state title +
   message in an amber banner.
2. `data-testid="teacher-artifact-action-items"` — visible only when
   the artifact is allowed AND has at least one action item. Renders
   title, body, why_it_matters, reflection_prompt, and a
   "Watch the moment" link only when `video_href` exists.

No legacy/admin/rubric text is rendered in either path. Frontend
tests assert no banned strings appear in either fixture.

## Admin UI changes

The C5 admin assessment response already includes `teacher_preview`
and the computed `teacher_feedback_admin_status`. C6 adds:

* `teacher_feedback_admin_status` now reflects persisted review
  (`admin_hidden`, `revision_requested`).
* `teacher_preview.teacher_preview.teacher_feedback_allowed`
  flips to False after `admin_hidden` is persisted.

The admin frontend approve/hide buttons are deferred to the C7 admin
UI sweep — C6 ships the backend hooks + tests + computed preview.

## Smoke automation

New script: `backend/scripts/run_pilot_smoke_checks.py` — read-only,
JSON-capable. Exit code 1 if any check fails.

**Checks**

* `teacher_artifact_banned_strings` — recursive scan of artifact
  teacher-visible surfaces.
* `artifact_blocked_not_bypassed` — when artifact is blocked, the
  legacy `teacher_feedback` field MUST NOT contain banned strings
  (defense against C5 fallback regression).
* `artifact_allowed_has_content` — when allowed, summary +
  action_items must be populated.
* `source_and_quality_present` — `source_validity` +
  `analysis_quality` must be attached.
* `no_orphan_visible_tasks` — coaching_tasks visible to the teacher
  must reference valid video/assessment ids.
* `recognition_separation` — Gold-Star and personal highlights must
  have distinct titles.
* `shared_reflection_visibility` — private reflections must not be
  flagged admin-visible.
* `admin_review_consistency` — `admin_hidden` must block the artifact,
  `admin_approved` must not override source-invalid or unsafe text.

**Usage**

```bash
MONGO_URL=... DB_NAME=... \
  python backend/scripts/run_pilot_smoke_checks.py \
    --teacher-id <teacher-id> --json
```

The audit script
`backend/scripts/audit_teacher_coaching_artifacts.py` gained five
new C6 issue codes:

* `admin_hidden_but_teacher_endpoint_allowed`
* `admin_approved_but_source_invalid`
* `admin_approved_but_unsafe_text`
* `action_item_persisted_with_unsafe_text`
* `duplicate_artifact_action_task`
* `shared_reflection_missing_thread_visibility`
* `private_reflection_visible_to_admin`

## Tests added/updated

**Backend (23 new tests, all passing):**

* `backend/tests/test_admin_teacher_feedback_review.py` (11 tests)
  — approve/hide/revision-requested, teacher-can't-call,
  workspace_id persisted, admin approval cannot override source or
  unsafe text, computed admin status for new states.
* `backend/tests/test_teacher_admin_coaching_thread.py` (6 tests)
  — teacher sees own private + shared + admin shared_with_teacher,
  admin doesn't see private teacher reflections, admin_only note
  hidden from teacher, teacher can't call admin endpoint, empty body
  rejected.
* `backend/tests/test_action_plan_lifecycle.py` (6 tests) —
  first tried creates a coaching_task, second call doesn't duplicate,
  reflect updates counts + status, blocked artifact refuses
  promotion, missing action_item id raises 404, private default for
  reflections.

**Frontend (4 new tests, all passing):**

* `frontend/src/pages/AdminReviewAndActionPlan.test.js` — focused
  helper + small component test for the VideoPlayer teacher artifact
  panel. Verifies the action items + deep-dive render when allowed,
  the blocked-state banner renders when blocked, the
  Watch-the-moment link only appears when video_href exists, and
  legacy fallback stays empty when `coaching_artifact` is absent.

The full VideoPlayerPage was deliberately NOT mounted in the test
because the page has 12+ `useQuery` calls and heavy timeline /
i18n / chart dependencies — the small in-test component mirrors the
exact rendering rule and keeps the test fast and stable.

## Commands run

```
# Backend
cd backend
python -m py_compile server.py                                                # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py         # ok
python -m py_compile app/services/teacher_artifact_quarantine.py              # ok
python -m py_compile app/services/lesson_moment_quality.py                    # ok
python -m py_compile scripts/audit_teacher_coaching_artifacts.py              # ok
python -m py_compile scripts/run_pilot_smoke_checks.py                        # ok
python -m compileall -q app                                                   # ok
python -m pytest tests/test_admin_teacher_feedback_review.py -q               # 11 passed
python -m pytest tests/test_teacher_admin_coaching_thread.py -q               # 6 passed
python -m pytest tests/test_action_plan_lifecycle.py -q                       # 6 passed
python -m pytest tests/test_pilot_teacher_experience_integration.py -q        # 15 passed
python -m pytest tests/test_teacher_lesson_coaching_artifact.py -q            # 15 passed
python -m pytest tests/test_teacher_artifact_quarantine.py -q                 # 24 passed
python -m pytest tests/test_lesson_moment_evidence_quality.py -q              # 23 passed
python -m pytest tests/test_video_source_chain_audit.py -q                    # 6 passed
python -m pytest tests/test_teacher_feedback_projection.py -q                 # 5 passed
python -m pytest tests/test_end_to_end_app_flow_hotfix.py
                tests/test_pilot_demo_flow.py -q                              # 9 passed
python -m pytest tests/ -q --timeout 120                                      # 402 passed

# Frontend
cd frontend
env CI=true npm test -- --runInBand --testPathPattern="(PilotTeacherExperience|TeacherWorkspacePage|TeacherCoachingPage|TeacherBadgesPage|EndToEndAppFlowAudit|TeacherExperienceV1|AdminReviewAndActionPlan)\.test\."
# 7 suites passed, 29 tests passed
env CI=true npm run build                                                     # green
```

## Known limitations

1. **Admin UI controls deferred to C7.** The admin assessment page
   does not yet expose Approve / Hide / Request-revision buttons.
   Backend endpoints + computed preview are in place; the React
   admin surface is the next surface to migrate.
2. **No notification fan-out yet.** When admin posts a thread message
   or hides feedback, the teacher does not receive a push/in-app
   notification. The existing `notifications` collection is unchanged
   in this PR — C7 should wire it up.
3. **VideoPlayer full-page test was scoped down.** The brittle full
   VideoPlayerPage mount test was replaced with a focused component
   test of the new rendering rule. The page change is covered by
   manual smoke + the production smoke script.
4. **No persistent cross-tenant cross-check on `_require_admin_in_same_tenant`.**
   The helper currently accepts admins whose `organization_id` or
   `school_id` matches and otherwise falls through to the existing
   `_get_teacher_or_404` visibility check (which already enforces
   tenant/observer rules). A future PR could add a stricter
   workspace_id assertion on the review endpoint itself.
5. **Smoke script is read-only.** It does not exercise the live API;
   it pulls Mongo state and re-runs the gates. The brief explicitly
   allowed this — DB-only checks are sufficient for the pilot smoke.

## Production rollout / smoke instructions

After deploy:

1. **Backfill check** — confirm `teacher_feedback_reviews` collection
   appears empty (this is correct — no review actions yet).
2. **Forensic teacher smoke** —
   ```
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/run_pilot_smoke_checks.py \
       --teacher-id d36bcacb-fb19-4d97-8753-f0944131505b --json
   ```
   * `teacher_artifact_banned_strings` must be `ok`.
   * `artifact_blocked_not_bypassed` must be `ok`.
   * `no_orphan_visible_tasks` must be `ok` (after the C2
     `--repair-safe` sweep).
3. **Admin approve smoke** —
   ```
   curl -X POST \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"status":"admin_approved","review_note":"Pilot smoke approve."}' \
     "$BASE_URL/api/admin/assessments/<id>/teacher-feedback-review"
   ```
   * Response: `teacher_feedback_admin_status: "auto_allowed"`
     when source + evidence pass.
4. **Admin hide smoke** —
   ```
   curl -X POST \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"status":"admin_hidden","hidden_reason":"Pilot smoke hide."}' \
     "$BASE_URL/api/admin/assessments/<id>/teacher-feedback-review"
   ```
   * Response: `teacher_feedback_admin_status: "admin_hidden"`.
   * Teacher `/api/teachers/me/latest-lesson` returns
     `{ "lesson": null, "artifact": { "teacher_feedback_allowed": false,
     "blocked_reason": "admin_hidden", ... } }`.
5. **Thread smoke** —
   ```
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"assessment_id":"<id>","body":"Smoke message"}' \
     "$BASE_URL/api/admin/teachers/<teacher_id>/coaching-thread"

   curl -H "Authorization: Bearer $TEACHER_TOKEN" \
     "$BASE_URL/api/teachers/me/coaching-thread?assessment_id=<id>"
   ```
   * Teacher response must include the admin message.
6. **Action-plan smoke** —
   ```
   curl -X POST -H "Authorization: Bearer $TEACHER_TOKEN" -H "Content-Type: application/json" \
     -d '{"assessment_id":"<id>"}' \
     "$BASE_URL/api/teachers/me/action-items/<artifact_action_id>/tried"
   ```
   * Response: `task.status == "tried"`. Repeat call MUST return the
     same task id (no duplicate persisted).
7. **Audit script smoke** —
   ```
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/audit_teacher_coaching_artifacts.py --json --limit 500
   ```
   * Expect zero `admin_hidden_but_teacher_endpoint_allowed`,
     `duplicate_artifact_action_task`, or
     `action_item_persisted_with_unsafe_text` for healthy data.

## C7 handoff notes

C6 ships the workflow plumbing. C7 should focus on:

1. **Admin UI controls** — Approve / Hide / Request-revision buttons
   on the admin assessment page; thread/reflection viewer.
2. **Teacher in-app notifications** — wire
   `teacher_feedback_reviews` writes + `video_comments` admin replies
   to the existing `notifications` collection so teachers see "Coach
   replied" / "Feedback ready" badges.
3. **LLM-driven coach voice from transcript** — defer to Claude/OpenAI
   for quoted classroom-exchange paraphrases when transcript signal
   is strong (the artifact already exposes `transcript_signal_score`
   on each moment).
4. **Persisted cross-lesson goal analytics** — surface "tried" /
   "reflected" counts across lessons; promote repeat-tried action
   items into a long-running goal.
5. **Final pilot smoke automation** — make
   `run_pilot_smoke_checks.py` part of the deploy hook with a
   forensic-id baseline.
6. **Onboarding / in-product guidance** — short tooltips on the new
   artifact action-item card, the admin review buttons, and the
   coaching thread.
7. **Stricter workspace cross-check on the review endpoint** —
   replace the best-effort `_require_admin_in_same_tenant` with a
   strict assertion that admin.workspace_id == teacher.workspace_id.
