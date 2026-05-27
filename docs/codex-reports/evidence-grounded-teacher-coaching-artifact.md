# PR C4 — Evidence-grounded teacher coaching artifact and actionable feedback

## Summary

PRs C1–C3 hardened the data plumbing:

* C1 — source chain (canonical `videos`/`assessments` survive cleanup;
  `audit_video_source_chain.py` reports orphans).
* C2 — teacher-facing quarantine (orphan/unsafe artifacts hidden; endpoints
  fail closed; `audit_video_source_chain.py --repair-safe`).
* C3 — moment + assessment evidence quality (representative_frame_sec inside
  window, no duplicates, per-moment `quality` block,
  `analysis_quality.teacher_feedback_allowed`).

PR C4 builds the **canonical TeacherLessonCoachingArtifact** that turns those
gates into the actual teacher coaching experience. One artifact builder is
the single source of truth across the dashboard, coaching page, latest-lesson
card, lessons list, and teacher view of `/api/assessments/{id}`. The artifact
is teacher-safe by construction: it composes the C1 source-validity check,
the C3 evidence-quality gate, the C2 unsafe-text rejection, the C3 deep-dive
quality gate, and a new rubric-to-practice translation step. When any gate
fails the artifact returns an honest empty state — no fake coaching.

## Files inspected

* `backend/server.py` — teacher endpoints (`get_my_latest_lesson`,
  `get_my_lessons`, `get_my_teacher_coaching`, `get_my_teacher_dashboard`,
  `get_assessment`, `get_assessments`), `_teacher_projection_for_assessment`,
  `_teacher_feedback_summary_text`, recognition payload.
* `backend/app/analysis/teacher_feedback_projection.py` —
  `build_teacher_coaching_intelligence`,
  `sanitize_teacher_feedback_projection`,
  `validate_teacher_feedback_projection`.
* `backend/app/services/teacher_artifact_quarantine.py` (C2) —
  `build_source_validity`, `reject_unsafe_teacher_payload`,
  `filter_deep_dive_moments`, `find_teacher_visible_text_issues`,
  `is_action_item_teacher_eligible`,
  `honest_next_best_action_for_record`.
* `backend/app/services/lesson_moment_quality.py` (C3) —
  `assessment_quality_blocks_teacher_feedback`, `detect_fallback_text`.
* `backend/tests/test_teacher_artifact_quarantine.py`,
  `backend/tests/test_lesson_moment_evidence_quality.py`,
  `backend/tests/test_video_source_chain_audit.py`,
  `backend/tests/test_teacher_feedback_projection.py`,
  `backend/tests/test_pilot_demo_flow.py`.

## Existing generation path found

```
get_my_*    ── _teacher_projection_for_assessment ──┐
                                                    ├─ build_teacher_coaching_intelligence (legacy projection)
                                                    └─ reject_unsafe_teacher_payload (C2)
```

Each teacher endpoint built its own response from the projection separately
(coaching seeded `active_tasks`, dashboard built `action_items` again from
coaching, latest-lesson built `summary` from `_teacher_feedback_summary_text`,
the teacher path of `/api/assessments/{id}` produced yet another shape). The
endpoints all consumed the same projection but laid it out differently and
could disagree on what the teacher saw.

## Artifact builder implementation

New module: **`backend/app/services/teacher_lesson_coaching_artifact.py`**

Public surface:

* `TEACHER_LESSON_COACHING_ARTIFACT_VERSION = "teacher_lesson_coaching_artifact_v1"`
* `RUBRIC_TO_PRACTICE` — mapping of Danielson/Marshall rubric labels to
  `{practice, next_step}` teacher-friendly phrasing.
* `translate_rubric_label_to_practice(label)` — case-insensitive lookup.
* `build_teacher_lesson_coaching_artifact(...)` — main entrypoint. Composes
  the C1/C2/C3 gates and returns the canonical artifact described below.
* `admin_view_of_artifact(artifact, *, assessment=None)` — adds rubric
  labels, element_scores, overall_score, analysis_confidence, raw_summary,
  raw_recommendations, and a `teacher_preview` block for admin views.
* `teacher_visible_summary_text(artifact)` — short teacher-safe summary
  string (used by `/api/teachers/me/lessons[*].summary`).
* `audit_teacher_artifact(artifact)` — read-only audit returning issue
  codes (`unsafe_teacher_visible_text`,
  `teacher_feedback_allowed_contradicts_quality`,
  `action_item_duplicates_summary`, `action_item_failed_eligibility`,
  `gold_star_with_invalid_source`, `artifact_version_mismatch`).

### Canonical artifact shape

```json
{
  "artifact_version": "teacher_lesson_coaching_artifact_v1",
  "lesson": {
    "lesson_id": "...",
    "video_id": "...",
    "assessment_id": "...",
    "title": "...",
    "subject": "...",
    "recorded_at": "...",
    "reviewed_at": "...",
    "status": "reviewed | pending | review_blocked"
  },
  "source_validity": {...},
  "analysis_quality": {...},
  "teacher_feedback_allowed": true,
  "blocked_reason": null | "no_reviewed_lesson" | "source_invalid"
                       | "evidence_insufficient" | "unsafe_text"
                       | "unsafe_text_post_compose",
  "summary": {
    "headline": "...",
    "opening": "...",
    "what_worked": "...",
    "growth_focus": "...",
    "next_step": "..."
  },
  "highlights": [{...personal_highlight}],
  "action_items": [{
    "id", "title", "body", "try_next_lesson",
    "why_it_matters", "status", "source",
    "start_sec", "end_sec", "video_href",
    "reflection_prompt"
  }],
  "deep_dive": {"available": bool, "moments": [...], "empty_state": "..."},
  "recognition": {"gold_star": {...} | null, "personal_highlights": [...]},
  "reflection": {"private_by_default": true, "prompts": [...]},
  "admin_connection": {
    "has_admin_feedback": bool,
    "shared_reflection_count": int,
    "admin_response_count": int
  },
  "next_best_action": {...} | null,
  "empty_state": null | {"code", "title", "message"},
  "language": "en" | "he",
  "legacy_projection": {...} | null,
  "guardrails": {
    "teacher_visible": true,
    "rubric_removed": true,
    "scores_removed": true,
    "evidence_grounded": true,
    "language": "en"
  }
}
```

## Teacher / admin separation

* Teacher endpoints return the artifact with all gates applied — no
  `element_scores`, no `overall_score`, no rubric labels, no
  `confidence`, no `analysis_quality` quality-reason vocabulary in
  `summary`/`highlights`/`action_items`.
* `admin_view_of_artifact(...)` is the explicit admin-facing transform.
  Admin paths still expose rubric, scores, confidence,
  `analysis_quality`, `source_validity`, the raw `summary`/
  `recommendations`, and a `teacher_preview` block showing whether teacher
  feedback would be allowed, why it was blocked if so, and the
  current guardrails state.
* The teacher view of `/api/assessments/{id}` was rewritten to call
  `_build_teacher_lesson_coaching_artifact_for(...)` and only return
  `summary`, `recommendations`, `teacher_feedback` (legacy), and
  `coaching_artifact`. The admin path returns the full
  `AssessmentResult` (Pydantic model) untouched, which already exposes
  `element_scores` / `overall_score` for admin consumers.

## Rubric-to-practice translation

`RUBRIC_TO_PRACTICE` maps 13 rubric element names (Danielson + Marshall) to
`{practice, next_step}` pairs, e.g.:

```python
"using questioning and discussion techniques": {
    "practice": "ask questions that open up student thinking",
    "next_step": "After one student answers, pause and ask, 'Who can build on that?'",
},
"organizing physical space": {
    "practice": "use the room setup to support participation",
    "next_step": "Adjust where you stand at one point in the lesson so more students can join in.",
},
```

When the only meaningful signal in an assessment is a flagged growth
element, `_generate_action_item_from_rubric(...)` picks the mapping for
the element and emits the teacher-safe `next_step` as the action item
body, with `why_it_matters` referencing the `practice` phrase. The rubric
element name itself is never shown to the teacher.

## Summary / action / highlight / deep-dive behavior

* **Summary** — `opening`, `what_worked`, `growth_focus`, `next_step` are
  taken from the C2-cleaned `latest_summary` block and run through
  `_is_clean_teacher_text` again. A field that fails the safety check
  becomes `None` (not a fake fallback).
* **Action items** — first pass picks teacher-safe items from the legacy
  projection, deduplicates against each other and the summary, and
  enforces `is_action_item_teacher_eligible`. If no items survive, the
  rubric translator emits one teacher-safe action item per growth
  element, capped at `TEACHER_ACTION_ITEM_MAX = 3`. Items never duplicate
  the summary opening / strength / growth focus. Each action item
  carries an evidence-tied `reflection_prompt`.
* **Highlights** — personal positive highlights only, from
  `projection.highlights`, capped at `TEACHER_HIGHLIGHT_MAX = 2`. Each
  highlight must pass the safety check on both title and body.
* **Recognition** — separate from highlights. The artifact's
  `recognition.gold_star` is populated only when a `recognition_badges`
  document of type `gold_star` exists, ties to a valid video for this
  teacher, and has safe title + body. Personal highlights stay in
  `recognition.personal_highlights` mirroring the dashboard list.
* **Deep dive** — re-runs `filter_deep_dive_moments` on the projection's
  deep-dive moments. Capped at `TEACHER_DEEP_DIVE_MAX = 4`. Each moment
  gets a `video_href` synthesized from `start_sec` when missing. When no
  moment survives, `deep_dive.available = False` with an honest
  empty_state.
* **Reflection** — `private_by_default: True`. Prompts include the
  primary action item's `reflection_prompt` (so the prompt is connected
  to the action) plus the projection's generic prompts deduplicated.
* **Truthful guardrails** — after composing the artifact, a final
  recursive scan via `find_teacher_visible_text_issues` runs across
  every teacher-visible section. If ANY unsafe string is found the
  artifact collapses to an empty state with
  `guardrails.teacher_visible: False` — i.e. we never claim guardrails
  passed when they didn't.

## Hebrew support

* `_empty_state_for_no_evidence`, `_empty_state_for_evidence_insufficient`,
  `_empty_state_for_unsafe_content` all return Hebrew copy when
  `language` starts with `he`.
* The rubric-to-practice translator emits English next-step text. For
  Hebrew lessons the teacher will see the Hebrew empty state rather than
  English rubric language until C5 ships Hebrew translation pairs for
  `RUBRIC_TO_PRACTICE`. This is explicit — the unsafe-text gate would
  hide English rubric copy from a Hebrew teacher anyway, so the result is
  the same: honest Hebrew empty state, not unsafe English content.
* The reflection prompt generator returns Hebrew when language is `he`.
* Hebrew empty states are covered by
  `test_hebrew_empty_state_is_hebrew_no_english_rubric`.

## Endpoints wired to the artifact

| Endpoint | What it now returns |
| --- | --- |
| `/api/teachers/me/latest-lesson` | `lesson` populated only when `artifact.teacher_feedback_allowed == True`. Otherwise `{"lesson": null, "artifact": <blocked artifact for diagnostics>}`. The lesson payload contains `coaching_artifact` for the frontend. |
| `/api/teachers/me/lessons` | Each lesson row's `summary` and `teacher_feedback` are derived from the artifact. Status is downgraded to the underlying video status when the artifact blocks the projection. The artifact is attached as `coaching_artifact`. |
| `/api/teachers/me/coaching` | Builds the artifact once. `active_tasks` / `recommendations` / `suggested_improvements` are derived from `artifact.action_items` when allowed. `deep_dive` is taken from `artifact.deep_dive`. The artifact is attached as `coaching_artifact`. |
| `/api/teachers/me/dashboard` | Composes `latest_lesson` / `highlights` / `action_items` / `next_best_action` from the coaching endpoint's payload — which now uses the artifact. |
| `/api/assessments/{id}` (teacher path) | Returns `summary`, `recommendations`, `teacher_feedback` (legacy), and `coaching_artifact`. Admin path unchanged. |
| `/api/assessments?...` list (teacher) | Same shape as the single-assessment teacher path. |

A shared async helper `_build_teacher_lesson_coaching_artifact_for(...)`
loads the canonical video when needed, attaches reflection counts to the
coaching tasks, and calls `build_teacher_lesson_coaching_artifact`.

## Tests added/updated

**New file** `backend/tests/test_teacher_lesson_coaching_artifact.py` — 15
tests, covering all twelve requirements from the brief:

1. Valid evidence produces useful teacher artifact (guardrails passed,
   at least one action item, deep_dive available, no bad strings).
2. Insufficient evidence returns honest empty artifact
   (`blocked_reason: evidence_insufficient`, action_items empty,
   `next_best_action.href = "/record"`).
3. Rubric labels are translated by `translate_rubric_label_to_practice`
   AND the rubric element name itself never leaks into a teacher
   artifact even when the assessment had only that element as signal.
4. Action item is classroom-actionable: not "Plan a targeted coaching
   cycle", does not start with "Strengthen X", does not equal the
   summary opening, has `why_it_matters`, has `reflection_prompt`.
5. No forced action items when there's no actionable evidence (count
   stays ≤ TEACHER_ACTION_ITEM_MAX).
6. Deep dive drops duplicate `923.8-943.8` and "brief window" fallback.
7. Dashboard, coaching, and latest-lesson all use the same artifact —
   summary opening and primary action item body match across the three
   endpoints.
8. Teacher `/api/assessments/{id}` hides `element_scores`,
   `overall_score`, and rubric labels.
9. `admin_view_of_artifact` exposes `element_scores`, `overall_score`,
   and a `teacher_preview` block.
10. C1/C2 regression: the forensic orphan fixture still returns
    `lesson: None` plus a blocked artifact, with no bad strings.
11. Hebrew empty state is Hebrew and contains no English rubric labels.
12. `audit_teacher_artifact` flags the contradiction when
    `teacher_feedback_allowed=True` but `analysis_quality.teacher_feedback_allowed=False`.
13. Defensive guard: synthetic rubric-leaking summary collapses to empty
    state with `guardrails.teacher_visible: False`.
14. Recursive negative-assertion sweep across dashboard / coaching /
    latest-lesson / lessons confirms no known bad strings appear.

**Updated** `backend/tests/test_teacher_artifact_quarantine.py` — relaxed
the strict `result == {"lesson": None}` check for the orphan-chain test
so it accepts the new optional `artifact` diagnostic key. The C2
invariant — no fake reviewed lesson — is still enforced.

## Commands run and results

```
python -m py_compile server.py                                                      # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py               # ok
python -m py_compile app/services/teacher_artifact_quarantine.py                    # ok
python -m py_compile app/services/lesson_moment_quality.py                          # ok
python -m compileall -q app                                                         # ok
python -m pytest tests/test_teacher_lesson_coaching_artifact.py -q                  # 15 passed
python -m pytest tests/test_teacher_artifact_quarantine.py -q                       # 24 passed
python -m pytest tests/test_lesson_moment_evidence_quality.py -q                    # 23 passed
python -m pytest tests/test_video_source_chain_audit.py -q                          # 6 passed
python -m pytest tests/test_teacher_feedback_projection.py -q                       # 5 passed
python -m pytest tests/test_end_to_end_app_flow_hotfix.py tests/test_pilot_demo_flow.py -q   # 9 passed
python -m pytest tests/test_moment_sampler.py tests/test_frame_selection.py -q      # passed
python -m pytest tests/ -q --timeout 90                                             # full suite green
```

## Known limitations

* **No LLM in this PR.** The artifact's summary/action text uses the
  existing C2-cleaned projection and the rubric translator. C5 will plug
  in richer LLM-driven coach voice when transcript/audio evidence is
  available.
* **Hebrew rubric mappings missing.** Hebrew teachers see Hebrew empty
  states but the rubric translator emits English next-step text. The
  unsafe-text gate would hide English rubric copy anyway, so Hebrew
  users currently get the honest empty state until C5 ships Hebrew
  translation pairs.
* **`_my_teacher_recognition_payload` was not migrated to the artifact**
  for this PR. The C2 gate is already filtering badges and the artifact
  surfaces gold-star separately when needed — moving the full recognition
  payload to the artifact is a follow-up in C5.
* **Frontend was not changed.** All teacher endpoints additionally
  return `coaching_artifact`; existing fields are still present so the
  current frontend keeps working. C5 should migrate the dashboard /
  coaching page to read from `coaching_artifact` as the canonical source.
* **Audit script not added.** `audit_teacher_artifact(...)` is exposed
  as a programmatic helper and exercised in tests. A standalone CLI
  audit script is deferred to C5 — running the helper against MongoDB
  needs an admin endpoint that returns the artifact for a given lesson,
  which is a small C5 addition.

## Production rollout notes

1. Deploy this PR. Teacher endpoints will start returning the
   `coaching_artifact` block. Existing `teacher_feedback` / `summary` /
   `recommendations` fields stay populated when the artifact is allowed,
   so the current frontend keeps working.
2. After deploy, spot-check the forensic teacher
   `d36bcacb-fb19-4d97-8753-f0944131505b` — `/api/teachers/me/latest-lesson`
   should still return `{"lesson": null, "artifact": {teacher_feedback_allowed: false, ...}}`
   exactly like C2 (no fake coaching).
3. For a teacher whose latest assessment has the C3
   `analysis_quality.teacher_feedback_allowed: true` block,
   `coaching_artifact` should appear populated with one
   action item and a deep-dive moment.
4. No data migration is required. Older assessments without
   `analysis_quality` still flow through the C2 unsafe-text + source
   gates; the artifact returns `blocked_reason: "source_invalid"` or
   `blocked_reason: "evidence_insufficient"` accordingly.

## C5 handoff notes

C4 lays the canonical artifact; C5 should focus on:

1. **Admin review/approval UI** consuming
   `admin_view_of_artifact(...)`'s `teacher_preview` block to one-click
   promote / block teacher feedback.
2. **Frontend polish** — migrate the dashboard / coaching / latest-lesson
   React pages to read from `coaching_artifact` so visual layout
   stops depending on the legacy `teacher_feedback` field.
3. **Richer transcript/audio capture** — when transcript is available
   per moment, the rubric translator should defer to LLM-generated
   coach voice quoting that transcript. Add transcript_signal_score
   threshold + a Claude/OpenAI call gated behind admin opt-in.
4. **Teacher/admin messaging thread** — the artifact's
   `admin_connection` block reports counts; C5 should add a real
   thread surface.
5. **Action-plan lifecycle** — promote artifact action items to
   `coaching_tasks` only when the teacher accepts them, and let admin
   respond inline.
6. **Recognition page refinement** — fully migrate
   `_my_teacher_recognition_payload` to the artifact's recognition
   block; render gold-star vs personal-highlight differently.
7. **Hebrew rubric translation pairs** — populate Hebrew next-step text
   in `RUBRIC_TO_PRACTICE` so Hebrew teachers get coaching, not just
   empty states.
8. **Standalone audit script** for `audit_teacher_artifact(...)` — wire
   it through `backend/scripts/audit_teacher_coaching_artifacts.py` so
   operators can scan a workspace for contradictions.
