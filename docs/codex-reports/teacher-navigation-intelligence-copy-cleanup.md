# PR C8 — Teacher navigation intelligence and coaching-state copy cleanup

## Summary

C1–C7 hardened safety (source chain, quarantine, evidence quality,
canonical artifact, admin review + thread + action-plan, notifications,
tenant auth). The teacher UI was safe but generic: every state — even
"the lesson review is still in progress" — rendered a "NEXT BEST ACTION
/ Your next step / Open next step" panel, sometimes linking to `/record`
when the teacher had no upload to do. The misleading copy
*"A coach will continue from here as soon as the review is verified."*
made it worse.

C8 adds a **typed navigator** to the canonical
`TeacherLessonCoachingArtifact` and threads it through the frontend so:

* Review-pending / admin-hidden / revision-requested / no-action states
  render status copy with **no CTA and no `/record` link**.
* Coaching-action states render "Coaching focus" + a coaching CTA.
* Moment states render specific moment CTA labels (e.g. "Watch the
  question exchange") rather than generic "Watch the moment".
* Upload CTA appears only when navigator type is `upload_required`.
* Setup CTA appears only when navigator type is `setup_required` (and
  setup-required beats artifact-blocked since the teacher cannot upload
  until setup completes).
* The misleading review-pending sentence is replaced everywhere with
  *"No action needed right now. Your coaching summary will appear here
  when the review is ready."*
* Hebrew variants exist for every navigator type and empty-state
  message.

All C1–C7 gates remain authoritative. The navigator never produces
fake coaching, never overrides source/safety/evidence blocks, and never
links review-pending states to `/record`.

## Files inspected

Backend:

* `backend/app/services/teacher_lesson_coaching_artifact.py` —
  `_empty_state_for_*`, `_next_best_action_from_artifact`,
  `_empty_artifact`, `build_teacher_lesson_coaching_artifact`.
* `backend/app/services/teacher_artifact_quarantine.py` —
  `honest_next_best_action_for_record` (legacy).
* `backend/server.py` — dashboard endpoint that wrapped
  `next_best_action` with "Open next step" + "/my-workspace".
* C4–C7 test files for the regression baseline.

Frontend:

* `frontend/src/lib/teacherCoachingArtifact.js` — `artifactNextBestAction`
  was returning a `/record` fallback for blocked artifacts.
* `frontend/src/lib/coachVoice.js` — banned-phrase corpus.
* `frontend/src/pages/TeacherWorkspacePage.js` — "Your next step" panel.
* `frontend/src/pages/TeacherCoachingPage.js` — "Next best action" panel
  and "Watch the moment" links.
* `frontend/src/pages/VideoPlayerPage.js` (untouched in C8 — already
  uses the artifact empty-state when blocked).
* `frontend/src/components/dashboard/SetupAssistantPanel.js` —
  `"Open next step"` default label.

## Root cause of generic navigation

1. **`_empty_artifact`** always called `honest_next_best_action_for_record(...)`
   which returned `{href: "/record", cta_label: "Record or upload a
   lesson"}` regardless of why the artifact was blocked. So a teacher
   whose lesson was *in review* saw a button to re-record.
2. **`build_teacher_lesson_coaching_artifact`'s success path** wrapped
   `next_best_action` with the legacy `_next_best_action_from_artifact`
   fallback — which still labels things "Open coaching" — and never
   exposed a typed state to the frontend.
3. **`get_my_teacher_dashboard`** rewrapped every `next_best_action`
   with `{title: "Open your next step", cta_label: "Open next step"}` so
   downstream consumers always saw the same generic copy.
4. **`TeacherWorkspacePage`** hardcoded the section header
   `"Your next step"`. The frontend had no way to know whether the
   panel represented an action or a status.
5. **`SetupAssistantPanel`** used `nextStep.cta_label || "Open next step"`
   so legacy `next_step` blockers without a `cta_label` rendered the
   misleading generic label.
6. **`_empty_state_for_unsafe_content`** literally returned
   *"A coach will continue from here as soon as the review is verified."*.

## Backend navigator + action taxonomy

### `navigator` block

`build_teacher_lesson_coaching_artifact` now attaches a typed
`navigator` to every artifact. Shape:

```jsonc
{
  "type": "coaching_action" | "reflection" | "watch_moment"
        | "setup_required" | "upload_required" | "review_pending"
        | "admin_hidden" | "revision_requested" | "admin_message"
        | "no_action",
  "label": "Coaching focus" | "Reflection" | "Moment to revisit"
         | "Setup needed" | "Recording" | "Review status"
         | "Coach message" | "All set",
  "title": "…",
  "body": "…",
  "cta_label": null | "Open coaching action" | "Continue setup" | …,
  "href": null | "/my-coaching?task_id=a1" | "/record" | "/consent" | …,
  "disabled": true | false,
  "priority": 10 | 20 | 25 | 30 | 40 | 50 | 60 | 90,
  "source": "artifact" | "readiness" | "admin_review" | "reflection" | "recording" | "thread",
  "action_item_id": null | "…",
  "start_sec": null | number,
  "end_sec": null | number,
  "video_href": null | "/videos/v1?t=60",
  "reason": null | "evidence_insufficient" | "admin_hidden" | "no_reviewed_lesson" | …
}
```

`build_artifact_navigator(...)` is the dispatcher. Order of precedence:

  1. Setup incomplete → `setup_required` (links to the blocker's
     `href`, never to `/record`).
  2. Blocked artifact → `review_pending` / `admin_hidden` /
     `revision_requested` / `upload_required` (when no assessment AND no
     setup gap). All review-pending states have `disabled: true`,
     `href: null`, `cta_label: null`.
  3. Unread admin message → `admin_message`.
  4. Action items present → `coaching_action`.
  5. Deep-dive moment only → `watch_moment` (timestamp href + specific
     moment CTA via `specific_moment_cta_label`).
  6. Reflection prompt only → `reflection`.
  7. Allowed artifact but empty → `no_action`.

### `next_best_action`

Now derived from the navigator via `_next_best_action_from_navigator`.
Review-pending / no-action navigators return `None` so the legacy
"Open next step" never fires. The dashboard endpoint passes the value
through verbatim instead of re-wrapping it.

### Action-item taxonomy

Each artifact action item gains:

```jsonc
{
  "category": "instructional_practice" | "reflection" | "operational" | "admin_review" | "recording",
  "action_kind": "try_next_lesson" | "reflect" | "watch_moment" | "complete_setup" | "upload_lesson" | "wait_for_review" | "no_action",
  "cta_label": "Open coaching action" | "Continue setup" | …,
  "href": "/my-coaching?task_id=a1",
  "disabled": false,
  "moment_label": null | "question exchange" | "student response" | …,
  "moment_cta_label": "Watch the question exchange"  // present iff video_href
}
```

### Specific moment CTA labels

`specific_moment_cta_label(moment, *, language)` derives a teacher-safe
"Watch the …" label from:

1. `moment.moment_label` if present and safe.
2. Keyword scan on title / what_happened / body / try_next_lesson.
3. Phase lookup (`check_for_understanding`, `transition`,
   `guided_practice`, etc.).
4. Fallback `"Watch this coaching moment"` (English) /
   `"צפו ברגע הזה"` (Hebrew).

## Copy matrix by navigator type

| Type | Label | Title | Body | CTA | href | disabled |
| --- | --- | --- | --- | --- | --- | --- |
| `coaching_action` | Coaching focus | "Try this in your next lesson" | action body | "Open coaching action" | `/my-coaching?task_id=…` | false |
| `watch_moment` | Moment to revisit | moment title | moment body | specific moment label | `/videos/{id}?t=…` | false |
| `reflection` | Reflection | "Add a reflection" | prompt | "Add reflection" | `/my-coaching` | false |
| `setup_required` | Setup needed | blocker label | blocker message | "Continue setup" | blocker.href | false |
| `upload_required` | Recording | "Your recording setup is ready." | upload prompt | "Record or upload a lesson" | `/record` | false |
| `review_pending` | Review status | "Feedback is being reviewed." | "No action needed right now. Your coaching summary will appear here when the review is ready." | null | null | **true** |
| `admin_hidden` | Review status | same | same | null | null | **true** |
| `revision_requested` | Review status | same | same | null | null | **true** |
| `admin_message` | Coach message | "Your coach replied" | thread prompt | "Read coach reply" | `/my-coaching` | false |
| `no_action` | All set | "No action needed right now." | "You're all set." | null | null | **true** |

Hebrew variants ship for every row above.

## Frontend rendering changes

### `frontend/src/lib/teacherCoachingArtifact.js`

* `artifactNextBestAction(artifact, legacy)` no longer returns a
  `/record` fallback for blocked artifacts. When the navigator is
  disabled (review_pending / admin_hidden / revision_requested /
  no_action) it returns `null` so pages render status copy instead of
  a clickable button.
* New helpers: `artifactNavigator`, `isNavigatorClickable`,
  `artifactMomentCtaLabel`, `artifactPrimaryAction`.

### `frontend/src/pages/TeacherWorkspacePage.js`

* "Your next step" panel header is now driven by `navigator.label`
  (`Coaching focus` / `Review status` / `Recording` / `Setup needed`
  / `All set`).
* CTA buttons render only when `isNavigatorClickable(navigator)` —
  blocked / no-action states render status copy without a button.
* The "Watch the moment" link uses
  `primaryAction.moment_cta_label || artifactMomentCtaLabel(primaryAction)`.

### `frontend/src/pages/TeacherCoachingPage.js`

* The top "Next best action" panel is now navigator-aware. When the
  artifact is blocked the panel shows the navigator title/body with
  no clickable link.
* Per-task "Watch the moment" → `artifactMomentCtaLabel(task)` so we
  get the specific phrasing.
* "Open goal" link only renders for persisted (non-artifact) tasks.

### `frontend/src/components/dashboard/SetupAssistantPanel.js`

* Fallback label `"Open next step"` replaced with `"Continue setup"`
  so the component never renders generic copy.

### `frontend/src/lib/coachVoice.js`

* `"a coach will continue from here"` added to the banned-phrase
  corpus so future regressions trip the negative-assertion test.

### `backend/server.py` :: `get_my_teacher_dashboard`

* When the coaching artifact navigator is disabled the dashboard
  passes `next_best_action` through verbatim (so the frontend renders
  the status copy). The previous "Open your next step" / "Open next
  step" wrapper now only fires for navigator types that actually
  carry a CTA, and its labels are state-specific ("Try this in your
  next lesson" / "Open coaching action").
* Honest record/upload fallback only fires when the navigator type is
  `upload_required` or `no_action`.

## Hebrew behavior

* `_navigator_labels(language)` returns Hebrew strings for every
  navigator type when `language` starts with `he`.
* Setup / upload / coaching / review-pending / no-action navigators
  all ship a Hebrew title + body.
* `specific_moment_cta_label(moment, language="he")` returns Hebrew
  keyword / phase labels and a Hebrew fallback (`צפו ברגע הזה`).
* Empty-state copy mirrors the navigator copy in Hebrew.
* Tests verify Hebrew unicode is present and that no English review
  copy ("a coach will continue from here") leaks into Hebrew
  artifacts.

## Tests added / updated

### Backend

* `backend/tests/test_teacher_navigation_intelligence.py` — 21 new
  tests covering navigator types, specific moment CTA labels, Hebrew
  variants, and the negative assertion that "a coach will continue
  from here" / "/record" never appear in review-pending artifacts.
* `backend/tests/test_teacher_lesson_coaching_artifact.py` — one C4
  test updated for the C8 behaviour
  (`test_artifact_returns_empty_state_when_evidence_insufficient`):
  now asserts the typed navigator + `next_best_action is None` instead
  of the deprecated `/record` fallback.

### Frontend

* `frontend/src/pages/TeacherNavigationIntelligence.test.js` — 7 new
  tests covering workspace + coaching navigator rendering, no-upload
  CTA for blocked states, specific moment CTA labels, and the
  defensive scan for `"a coach will continue from here"`.

### Regression

* Backend full suite (`pytest tests/ -q --timeout 120`): **434 passed**,
  zero regressions.
* Frontend targeted suite (`(PilotTeacherExperience|TeacherWorkspacePage|
  TeacherCoachingPage|TeacherBadgesPage|AdminReviewAndActionPlan|
  AdminTeacherFeedbackReviewCard|EndToEndAppFlowAudit|TeacherExperienceV1
  |TeacherNavigationIntelligence)\.test\.`): **9 suites / 43 tests
  passed**.
* Frontend production build: **green**.

## Commands run

```
# Backend
cd backend
python -m py_compile server.py                                                  # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py           # ok
python -m py_compile app/services/teacher_artifact_quarantine.py                # ok
python -m py_compile app/services/lesson_moment_quality.py                      # ok
python -m py_compile scripts/audit_teacher_coaching_artifacts.py                # ok
python -m py_compile scripts/run_pilot_smoke_checks.py                          # ok
python -m compileall -q app                                                     # ok
python -m pytest tests/test_teacher_navigation_intelligence.py -q               # 21 passed
python -m pytest tests/test_teacher_lesson_coaching_artifact.py
              tests/test_pilot_teacher_experience_integration.py
              tests/test_admin_workflow_notifications_audit.py
              tests/test_admin_teacher_feedback_review.py
              tests/test_teacher_admin_coaching_thread.py
              tests/test_action_plan_lifecycle.py
              tests/test_teacher_artifact_quarantine.py
              tests/test_lesson_moment_evidence_quality.py
              tests/test_video_source_chain_audit.py
              tests/test_teacher_feedback_projection.py -q                       # 122 passed
python -m pytest tests/ -q --timeout 120                                         # 434 passed

# Frontend
cd frontend
env CI=true npm test -- --runInBand --testPathPattern="TeacherNavigationIntelligence"
# 1 suite, 7 tests passed
env CI=true npm test -- --runInBand --testPathPattern="(PilotTeacherExperience|TeacherWorkspacePage|TeacherCoachingPage|TeacherBadgesPage|AdminReviewAndActionPlan|AdminTeacherFeedbackReviewCard|EndToEndAppFlowAudit|TeacherExperienceV1|TeacherNavigationIntelligence)\.test\."
# 9 suites, 43 tests passed
env CI=true npm run build                                                       # green
```

## Known limitations

1. **Admin diagnostic dashboard** still relies on the audit JSON
   endpoint. Surfacing it as a sortable table is a C9 task.
2. **LLM-driven coach voice** is intentionally not in this PR. The
   navigator surfaces typed states; the coaching prose itself still
   comes from the C4 rubric translator + projection.
3. **Cross-lesson goal analytics** (tried / reflected aggregates
   across lessons) remain C9 territory.
4. **Setup blocker `href`** falls back to `/my-profile` when readiness
   provides only a code. Most blockers ship explicit hrefs already
   so this is rarely exercised.
5. The smoke automation (C7) has not yet been wired into the deploy
   hook. A C9 follow-up should run it post-deploy in CI.

## Production smoke checklist

Run after Railway deploy. Each check should pass.

### 1. Forensic teacher with blocked artifact
* `GET /api/teachers/me/dashboard` for the forensic teacher returns
  `coaching_artifact.navigator.type === "review_pending"`.
* The workspace page renders `"Review status"` as the navigator label,
  `"Feedback is being reviewed."` as the title, and no CTA button.
* `/record` does NOT appear anywhere in the rendered page (search
  HTML).
* `"a coach will continue from here"` does NOT appear in the response
  body or the rendered page.
* `"Open next step"` does NOT appear.

### 2. Teacher with no lesson but setup-ready
* `coaching_artifact.navigator.type === "upload_required"`.
* The workspace navigator label is `"Recording"`, CTA is `"Record or
  upload a lesson"`, and `href === "/record"`.

### 3. Teacher with setup incomplete
* `coaching_artifact.navigator.type === "setup_required"`.
* `href` points to the blocker's exact setup path (e.g. `/consent`,
  `/my-profile#privacy-reference-images`).
* CTA reads `"Continue setup"`, not `"Open next step"`.

### 4. Teacher with valid artifact and an action
* `coaching_artifact.navigator.type === "coaching_action"`.
* Workspace label is `"Coaching focus"`, CTA is `"Open coaching action"`,
  and `href` is the coaching URL (not `/record`).
* The "Watch the …" link uses the specific moment label, not the
  generic fallback, when phase/keyword signals are present.

### 5. Review-pending / admin-hidden / revision-requested
* Navigator type matches and `disabled === true`.
* `cta_label` is `null` and the page renders status copy only.
* Smoke script
  (`backend/scripts/run_pilot_smoke_checks.py --json --forensic-teacher-id …`)
  reports `overall: ok` and no banned strings.

## C9 handoff notes

1. **LLM-driven coach voice from transcript evidence** — paraphrase
   safe transcript excerpts into more specific coaching prose when
   `quality.transcript_signal_score` is above a threshold.
2. **Transcript sufficiency thresholds** — pick min word count / min
   transcript signal score for LLM activation.
3. **Cost controls + model selection** — gate LLM calls behind admin
   opt-in; meter per-tenant; pick model by transcript length.
4. **Hallucination / fallback guardrails** — any LLM output must pass
   the existing C2 unsafe-text + C4 recursive scan before rendering.
5. **Hebrew LLM coaching strategy** — Hebrew prompt + Hebrew rubric
   translation table extension; never mix English rubric labels.
6. **Admin diagnostic dashboard** — surface the C7 audit endpoint
   JSON as a sortable table with filters by teacher / workspace.
7. **Cross-lesson growth analytics** — aggregate tried / reflected
   counts and surface "you have tried this 3 times across 2 lessons"
   summaries.
8. **Final pilot readiness checklist** — wire `run_pilot_smoke_checks`
   into the Railway deploy hook so post-deploy smoke is automatic.
