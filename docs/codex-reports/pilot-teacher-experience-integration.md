# PR C5 — Pilot teacher experience integration

## Summary

C1–C4 hardened the data plumbing and built the canonical
TeacherLessonCoachingArtifact:

* **C1** — source-chain integrity (`audit_video_source_chain.py`).
* **C2** — teacher-facing quarantine (`teacher_artifact_quarantine.py`).
* **C3** — moment + assessment evidence quality (`lesson_moment_quality.py`).
* **C4** — canonical artifact builder
  (`teacher_lesson_coaching_artifact.py`); every teacher endpoint
  additionally returns `coaching_artifact`.

C5 turns the artifact into the actual pilot teacher experience:

1. **Frontend** — five teacher pages now prefer `coaching_artifact` and
   fall back to legacy fields only when the artifact key is absent. A
   blocked artifact suppresses stale legacy text completely.
2. **Backend admin** — `GET /api/assessments/{id}` (admin path) now
   additionally returns a `teacher_preview` block from
   `admin_view_of_artifact(...)` plus a computed
   `teacher_feedback_admin_status` so reviewers can see exactly what the
   teacher would (or would not) see — without losing access to rubric
   scores, element labels, or `analysis_quality`.
3. **Hebrew** — `RUBRIC_TO_PRACTICE` now ships Hebrew variants for every
   English rubric mapping. `translate_rubric_label_to_practice(label,
   language="he")` returns Hebrew `practice` / `next_step` /
   `reflection`. Hebrew empty states from C4 continue to apply when no
   Hebrew mapping exists.
4. **Recognition** — Gold-Star and personal highlights are visually and
   structurally separated on the teacher recognition page. The old copy
   that implied highlights only appear after recognition is awarded has
   been replaced.
5. **Ops** — new read-only CLI
   `backend/scripts/audit_teacher_coaching_artifacts.py` scans
   assessments for artifact-safety contradictions.

## Files inspected

Frontend:

* `frontend/src/pages/TeacherWorkspacePage.js`
* `frontend/src/pages/TeacherCoachingPage.js`
* `frontend/src/pages/TeacherLessonsPage.js`
* `frontend/src/pages/TeacherBadgesPage.js`
* `frontend/src/pages/VideoPlayerPage.js`
* `frontend/src/features/teachers/api.js`
* `frontend/src/lib/coachVoice.js`
* `frontend/src/pages/TeacherWorkspacePage.test.js`,
  `TeacherCoachingPage.test.js`, `TeacherBadgesPage.test.js`,
  `EndToEndAppFlowAudit.test.js`, `TeacherExperienceV1.test.js`

Backend:

* `backend/app/services/teacher_lesson_coaching_artifact.py`
* `backend/app/services/teacher_artifact_quarantine.py`
* `backend/app/services/lesson_moment_quality.py`
* `backend/server.py` — teacher + admin assessment endpoints,
  `_build_teacher_lesson_coaching_artifact_for`,
  `_compute_teacher_feedback_admin_status`
* `backend/tests/test_teacher_lesson_coaching_artifact.py`,
  `test_teacher_artifact_quarantine.py`,
  `test_lesson_moment_evidence_quality.py`,
  `test_video_source_chain_audit.py`,
  `test_teacher_feedback_projection.py`,
  `test_end_to_end_app_flow_hotfix.py`,
  `test_pilot_demo_flow.py`

## Frontend pages migrated

| Page | What now reads from the artifact | Fallback when absent |
| --- | --- | --- |
| `TeacherWorkspacePage` | latest coaching summary (`opening` / `what_worked` / `growth_focus` / `next_step`), `next_best_action`, primary action card, personal highlights list, action items list, Gold-Star recognition section | Legacy `latest_lesson.teacher_feedback.latest_summary`, `data.next_best_action`, `data.action_items`, `data.highlights`, `data.recognition.items` |
| `TeacherCoachingPage` | active tasks list, recommendations, suggested improvements, deep-dive moments, reflection prompts panel, next-best-action | Legacy `active_tasks`, `recommendations`, `suggested_improvements`, `next_best_action` |
| `TeacherLessonsPage` | per-lesson summary text + reviewed/processing status pill (blocked artifact downgrades the pill) | Legacy `lesson.summary` and `lesson.status` |
| `TeacherBadgesPage` (recognition) | Section copy refactored — Gold-Star is explicitly labelled as awarded recognition; personal highlights have a new section that explicitly says it does NOT require recognition | n/a (text-only) |
| `VideoPlayerPage` (teacher view) | `visibleSummary`, `teacherDeepDiveMoments`, `teacherActionItems` come from artifact when allowed | Legacy `teacher_feedback.latest_summary` and `teacher_feedback.deep_dive.moments` |

**Helper added:** `frontend/src/lib/teacherCoachingArtifact.js`

The helper centralises the C5 fallback rule:

1. Use `coaching_artifact` if present.
2. If absent, use existing safe legacy fields.
3. If artifact present and **blocked**, do NOT use legacy fields to
   bypass the block.

Exports: `readArtifact`, `isArtifactAllowed`, `isArtifactBlocked`,
`artifactSummaryText`, `artifactLatestSummary`, `artifactActionItems`,
`artifactHighlights`, `artifactGoldStar`, `artifactDeepDive`,
`artifactReflectionPrompts`, `artifactNextBestAction`,
`artifactEmptyState`, `artifactLessonStatus`.

**Banned-phrase scanner.** `frontend/src/lib/coachVoice.js` now ships
`scanForBannedPhrases(payload)` (recursive over objects/arrays). The
full C2 production bad-string corpus was added to
`BANNED_COACH_VOICE_PHRASES`. Every C5 test asserts
`scanForBannedPhrases(document.body.textContent) === []`.

## Backend / admin preview changes

`backend/server.py :: get_assessment(...)` — the admin path now returns:

```jsonc
{
  // ... existing AssessmentResult fields, unchanged ...
  "teacher_preview": {
    // admin_view_of_artifact(...) output: full artifact + element_scores
    // + overall_score + raw_summary + analysis_confidence
    // + teacher_preview sub-block (allowed/blocked, summary preview,
    //   action_items_count, deep_dive_available).
  },
  "teacher_feedback_admin_status": "auto_allowed"
                                  | "blocked_quality"
                                  | "blocked_source"
                                  | "blocked_safety"
}
```

New helper `_compute_teacher_feedback_admin_status(artifact)` derives the
status from `artifact.blocked_reason` (no persistent fields added in
C5 — admin approve/hide writes are C6).

The teacher path of `/api/assessments/{id}` continues to return
`coaching_artifact` + legacy fields (unchanged from C4).

**No persistent admin-status fields were added.** The brief specifically
allowed deferring `teacher_feedback_admin_status` /
`teacher_feedback_reviewed_by` / `teacher_feedback_reviewed_at` /
`teacher_feedback_review_note` to C6 as a database concern, so we expose
the computed status only.

## Hebrew mapping changes

`RUBRIC_TO_PRACTICE` is now keyed `{ rubric: { lang: {practice,
next_step, reflection} } }` with `lang` ∈ `{en, he}`. The 13 existing
English mappings each gained a Hebrew variant. The eight Hebrew-mandated
rubrics from the C5 brief are covered:

* Demonstrating Knowledge of Students
* Demonstrating Knowledge of Content and Pedagogy
* Creating an Environment of Respect and Rapport
* Using Questioning and Discussion Techniques
* Organizing Physical Space
* Setting Instructional Outcomes
* Establishing a Culture for Learning
* Growing and Developing Professionally

`translate_rubric_label_to_practice(label, language="he")` returns the
Hebrew variant. If the mapping is missing for the requested language,
`None` is returned and the caller falls back to the existing Hebrew /
English empty state — never a mixed-language string.

`_generate_action_item_from_rubric(...)` now passes `language` to the
translator and uses the Hebrew `reflection` text when present. The
generated `why_it_matters` text is also Hebrew-aware.

A test parametrised over all eight rubric labels asserts the Hebrew
variant is present, has Hebrew Unicode characters, and never contains an
English rubric name.

## Recognition changes

`TeacherBadgesPage.js`:

* Old "Cognivio accolades" section renamed to **"Gold-Star recognition"**
  with explicit description: *Awarded recognition — separate from
  personal lesson highlights you see below.*
* New **"Personal lesson highlights"** section with explicit
  description: *Lesson moments worth revisiting — these do not require
  Gold-Star recognition.*
* Old empty-state copy *"Highlighted moments will appear after
  recognition is awarded."* has been replaced with *"Personal highlights
  will appear as your reviewed lessons build up. They do not require
  Gold-Star recognition — Cognivio surfaces a positive moment from every
  reviewed lesson when valid evidence exists."*
* Existing tests in `TeacherBadgesPage.test.js` and
  `EndToEndAppFlowAudit.test.js` were updated to match the new copy
  while continuing to assert the same negative invariant (no red-error
  state).

`TeacherWorkspacePage.js`:

* The workspace Gold-Star section now lists either the artifact's
  `recognition.gold_star` (when present) prepended to the legacy
  recognition list, or just the legacy list. Personal highlights have
  always been a separate section.

## Artifact audit script

`backend/scripts/audit_teacher_coaching_artifacts.py` — read-only.

**Usage:**
```
python backend/scripts/audit_teacher_coaching_artifacts.py \
    --teacher-id ... --video-id ... --assessment-id ... \
    --workspace-id ... --limit 500 --json
```

**Issue codes surfaced:**

* `unsafe_teacher_visible_text`
* `teacher_feedback_allowed_contradicts_quality`
* `teacher_endpoint_would_show_despite_source_block`
* `teacher_endpoint_would_show_despite_evidence_block`
* `action_item_duplicates_summary`
* `action_item_failed_eligibility`
* `deep_dive_available_but_empty`
* `gold_star_with_invalid_source`
* `assessment_missing_analysis_quality_for_review`
* `reviewed_assessment_without_quality_block`
* `artifact_build_failed`

The script builds the artifact in-process for every loaded assessment
and runs `audit_teacher_artifact(...)` plus
`find_teacher_visible_text_issues(...)` on the result. It never writes.
The audit_collections helper is also unit-testable (and is tested in
`tests/test_pilot_teacher_experience_integration.py`).

## Tests added/updated

**Backend** — `backend/tests/test_pilot_teacher_experience_integration.py` (15 tests):

1. Hebrew rubric mapping returns Hebrew practice / next_step / reflection
   (parametrised over all eight required labels).
2. English rubric mapping unchanged.
3. Hebrew artifact does not contain English rubric labels.
4. Recognition Gold-Star and personal highlights stay separate.
5. `admin_view_of_artifact` exposes `element_scores` + `teacher_preview`.
6. `_compute_teacher_feedback_admin_status` reports correct codes for
   auto/quality/source/no-artifact.
7. Audit script reports no issues for a clean artifact.
8. Audit script flags legacy assessment without `analysis_quality`.

**Frontend** — `frontend/src/pages/PilotTeacherExperience.test.js`
(9 tests):

1. Workspace renders artifact summary / action / highlight when allowed.
2. Workspace renders empty state when artifact blocked and ignores stale
   legacy fields containing every forbidden bad string.
3. Coaching page renders artifact action items + deep dive when allowed.
4. Coaching page hides Watch-the-moment link when no `video_href`.
5. Lessons page demotes status when artifact is blocked.
6. Lessons page shows artifact summary when allowed.
7. Recognition page separates Gold-Star from personal highlights and
   does not say highlights require recognition.
8. Blocked artifact fixture renders zero known bad strings.
9. Legacy fallback path still works when `coaching_artifact` is absent.

**Updated** legacy frontend tests to match the new Gold-Star empty-state
copy:
* `TeacherBadgesPage.test.js`
* `EndToEndAppFlowAudit.test.js`

## Commands run

```
# Backend
cd backend
python -m py_compile server.py                                                # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py         # ok
python -m py_compile app/services/teacher_artifact_quarantine.py              # ok
python -m py_compile app/services/lesson_moment_quality.py                    # ok
python -m py_compile scripts/audit_teacher_coaching_artifacts.py              # ok
python -m compileall -q app                                                   # ok
python -m pytest tests/test_pilot_teacher_experience_integration.py -q        # 15 passed
python -m pytest tests/test_teacher_lesson_coaching_artifact.py -q            # 15 passed
python -m pytest tests/test_teacher_artifact_quarantine.py -q                 # 24 passed
python -m pytest tests/test_lesson_moment_evidence_quality.py -q              # 23 passed
python -m pytest tests/test_video_source_chain_audit.py -q                    # 6 passed
python -m pytest tests/test_teacher_feedback_projection.py -q                 # 5 passed
python -m pytest tests/test_end_to_end_app_flow_hotfix.py
                tests/test_pilot_demo_flow.py -q                              # 9 passed
python -m pytest tests/ -q --timeout 90                                       # full suite green

# Frontend
cd frontend
env CI=true npm test -- --runInBand --testPathPattern="(TeacherWorkspacePage|TeacherCoachingPage|TeacherBadgesPage|VideoRecorderPage|TeacherExperienceV1|EndToEndAppFlowAudit|PilotTeacherExperience)\.test\."
# 7 suites passed, 28 tests passed
env CI=true npm run build                                                     # production build green
```

## Known limitations

1. **Persistent admin-status fields not added.** The brief explicitly
   allowed deferring `teacher_feedback_admin_status` /
   `teacher_feedback_reviewed_by` / `teacher_feedback_reviewed_at` /
   `teacher_feedback_review_note` to C6. C5 only exposes the *computed*
   status. C6 will add Mongo fields + an admin
   approve/hide/edit endpoint.
2. **`VideoPlayerPage` action-items not yet rendered.** The artifact's
   action items are read into `teacherActionItems` but the teacher-view
   rendering of those items inside the player surface is C6 work — the
   existing teacher-view code path only renders summary + deep-dive
   today.
3. **Hebrew empty-state breadth.** Hebrew variants exist for the 13
   English `RUBRIC_TO_PRACTICE` keys but not for every Marshall rubric.
   Unmapped Hebrew rubrics fall back to the Hebrew C4 empty state
   (honest, not unsafe).
4. **No LLM-driven coach voice yet.** The artifact still uses the
   rubric translator + projection text. Transcript-driven coach voice
   is C6.
5. **Audit script is operator-only.** Wiring the audit into the admin
   UI surface is C6.

## Production smoke checklist

> Run after deploy. Each step should match the expected behaviour.

### A. Forensic teacher with old orphaned data
**Teacher:** `d36bcacb-fb19-4d97-8753-f0944131505b`
Open the teacher workspace as that teacher.
* `latest_lesson` must be `null` OR `coaching_artifact.teacher_feedback_allowed: false`.
* The page renders the readiness/review-pending empty state — never
  the legacy `teacher_feedback.latest_summary` text.
* `scanForBannedPhrases(document.body.textContent)` returns `[]`.
* No stale action item from the orphan corpus appears.

### B. New valid upload with sufficient evidence
Upload a fresh classroom video and wait for analysis to complete.
* `/api/teachers/me/latest-lesson` returns `lesson.coaching_artifact`
  with `teacher_feedback_allowed: true`.
* Workspace summary opens with the artifact `opening`.
* One primary action item is visible in workspace + coaching page +
  latest-lesson card.
* Deep-dive moment is visible on the coaching page with a working
  `video_href`.
* Reflection prompt is tied to the action item.
* Gold-Star section is empty (or populated by a real badge); personal
  highlights show the artifact highlight.
* `GET /api/assessments/{id}` as admin returns
  `teacher_preview.teacher_feedback_allowed: true` and
  `teacher_feedback_admin_status: "auto_allowed"`.

### C. Hebrew teacher
Switch the teacher language to `he`.
* Workspace empty state (when no valid lesson) is Hebrew.
* When a Hebrew assessment passes the C3 gate, the action item
  `next_step` is Hebrew (no English rubric labels in the rendered
  text).
* Run `scanForBannedPhrases(document.body.textContent)` — still empty.

### D. Admin review
Open the admin assessment view.
* `element_scores`, `overall_score`, and rubric labels remain visible.
* `teacher_preview.teacher_feedback_allowed` shows allowed/blocked.
* `teacher_feedback_admin_status` reflects the artifact state.
* Admin can see `analysis_quality` diagnostics and
  `source_validity.invalid_reasons`.

### E. Audit script
Operator runs from an admin shell:
```
MONGO_URL=... DB_NAME=... \
  python backend/scripts/audit_teacher_coaching_artifacts.py --json --limit 500
```
* Output is JSON.
* For the forensic teacher / video, the report lists
  `assessment_endpoint_would_show_despite_source_block` or
  `reviewed_assessment_without_quality_block` only if legacy orphan
  data still exists. After the existing C2 `--repair-safe` sweep, the
  artifact-safety report should be empty for the forensic IDs.

## C6 handoff notes

C5 ships the artifact through the teacher UI surface and the admin
preview. C6 should focus on:

1. **Admin approve / hide / edit workflow** — persist
   `teacher_feedback_admin_status`, `teacher_feedback_reviewed_by`,
   `teacher_feedback_reviewed_at`, `teacher_feedback_review_note` and
   write a small admin mutation endpoint that updates them. Wire the
   artifact builder to honor admin-approved/admin-hidden states.
2. **Teacher/admin messaging thread** — extend the existing reflection
   endpoints into a two-way thread anchored on the artifact.
3. **Action-plan lifecycle** — promote artifact action items to
   `coaching_tasks` only when the teacher accepts them. Track
   try/reflect/done states.
4. **Persisted teacher goal workflow** — let admins assign teacher
   goals that survive across lessons (separate from per-lesson
   artifacts).
5. **Richer LLM coach voice from transcript** — when transcript
   evidence is strong, defer to Claude/OpenAI for a quoted coach voice
   tied to a real classroom exchange.
6. **Final pilot smoke refinement** — automate the production smoke
   checklist into a deploy-time job.
7. **Onboarding / in-product guidance** — short tooltips on the new
   artifact sections explaining what teachers should look for.
8. **`VideoPlayerPage` teacher action-items rendering** — surface the
   already-loaded `teacherActionItems` in the teacher view.
9. **Hebrew rubric coverage expansion** — Marshall rubric Hebrew
   variants.
10. **Admin UI wiring of the artifact audit script** — bring the issue
    codes into an admin diagnostic dashboard.
