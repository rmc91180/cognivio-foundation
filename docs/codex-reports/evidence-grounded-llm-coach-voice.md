# PR C9 — Evidence-grounded LLM coach voice from transcript

## Summary

C1–C8 made the teacher coaching artifact safe, evidence-quality-gated,
navigationally intelligent, and admin-reviewable. The coaching prose
inside the artifact still came from the C4 deterministic builder
(rubric-to-practice translator + projection text), which is correct but
generic.

C9 layers an LLM coach-voice generation step on top, behind strict
gates. Every C1–C8 guard remains authoritative; the generator can only
run when:

* the artifact is teacher-allowed (no source / safety / evidence / admin
  block),
* enough usable moments AND/OR a completed transcript with non-trivial
  segment signal exist,
* `COACH_VOICE_LLM_ENABLED=true` AND an OpenAI key is configured (or an
  explicit provider is injected for tests),
* the generated JSON survives strict validation (parse, banned-string
  scan, timestamp containment, Hebrew language check, no duplicates).

Generated output replaces the artifact's summary / primary action /
highlight / deep-dive moments while preserving the C8 navigator + action
taxonomy. The cache key is
`(assessment_id, language, coach_voice_version, artifact_version,
evidence_hash)` so we don't pay for repeated calls on identical input.

If anything fails — disabled, no provider key, sufficiency block,
validation failure, model "blocked" sentinel — the artifact stays
deterministic. The teacher experience never regresses.

## Files inspected

Backend:

* `backend/app/services/teacher_lesson_coaching_artifact.py`
* `backend/app/services/teacher_artifact_quarantine.py`
* `backend/app/services/lesson_moment_quality.py`
* `backend/server.py` — `_build_teacher_lesson_coaching_artifact_for`,
  teacher endpoints that return `coaching_artifact`, admin assessment
  path.
* `backend/scripts/audit_teacher_coaching_artifacts.py`
* `backend/scripts/run_pilot_smoke_checks.py`
* Existing LLM integrations: `AsyncOpenAI` import + `OPENAI_API_KEY`
  setting at `backend/server.py:5804` and the existing coaching-prep
  helper at `backend/server.py:22790`.
* `backend/multimodal_analysis.py` / `backend/audio_pipeline.py` —
  transcript shape (segments with `start_sec` / `end_sec` / `text`).
* C1–C8 tests for the regression baseline.

Frontend (no changes required): existing
`coaching_artifact.summary` / `.action_items` / `.highlights` /
`.deep_dive.moments` consumers automatically render the new text.

## Transcript / evidence availability

* `video_audio_transcripts` collection (when `transcript_status =
  "completed"`) holds `{segments: [{start_sec, end_sec, text}], ...}`.
* C3 `compute_moment_quality(...)` already produces per-moment
  `transcript_signal_score`, `has_transcript_window`,
  `teacher_visible_candidate`.
* `_build_teacher_lesson_coaching_artifact_for` now loads
  `video_audio_transcripts` + `video_analysis_moments` once per call
  (sorted newest-first) and hands them to the generator.

## Coach voice sufficiency rules

`evaluate_coach_voice_sufficiency(...)` refuses to call the LLM when any
of these is true:

| Refusal | Reason |
| --- | --- |
| Artifact `teacher_feedback_allowed = False` (any C1–C8 block) | `blocked_artifact` |
| `assessment_quality_blocks_teacher_feedback(...)` is True (C3) | `evidence_blocked` |
| `analysis_quality.fallback_text_used = True` | `fallback_text_used` |
| `admin_review.status` is `admin_hidden` / `revision_requested` | `admin_blocked` |
| No `teacher_visible_candidate` moments | `insufficient_moments` |
| Fewer than `COACH_VOICE_MIN_USABLE_MOMENTS` (default 2) usable moments AND not (transcript completed with ≥ `COACH_VOICE_MIN_TRANSCRIPT_SEGMENTS` segments AND avg moment `transcript_signal_score` ≥ `COACH_VOICE_MIN_TRANSCRIPT_SIGNAL`) | `insufficient_evidence` |

When sufficiency passes, the dict returned is
`{"eligible": True, "reason": "eligible", "signals": {...}}`. The
signals dict is mirrored into the cache record so admins can inspect
why the gate fired.

## Provider / config behavior

| Env var | Default | Purpose |
| --- | --- | --- |
| `COACH_VOICE_LLM_ENABLED` | `false` | Master switch. When false (or unset), the provider is NEVER called. Tests can still inject a mock provider. |
| `COACH_VOICE_PROVIDER` | `openai` | Reported in cache record metadata. Only OpenAI is implemented in this PR. |
| `COACH_VOICE_MODEL` | `gpt-4o-mini` | Model passed to the OpenAI chat completion. |
| `COACH_VOICE_MAX_INPUT_CHARS` | `8000` | Input payload byte-budget. Excerpts are dropped first if exceeded; final list trimmed if still too large. |
| `COACH_VOICE_MAX_OUTPUT_TOKENS` | `700` | Provider response cap. |
| `COACH_VOICE_MAX_TRANSCRIPT_EXCERPT_CHARS` | `240` | Per-moment transcript excerpt cap. |
| `COACH_VOICE_TIMEOUT_SECONDS` | `30` | Per-request timeout. |
| `COACH_VOICE_MIN_USABLE_MOMENTS` | `2` | Sufficiency floor. |
| `COACH_VOICE_MIN_TRANSCRIPT_SEGMENTS` | `6` | Sufficiency floor for strong-transcript path. |
| `COACH_VOICE_MIN_TRANSCRIPT_SIGNAL` | `0.45` | Avg transcript signal score floor. |
| `OPENAI_API_KEY` | (existing) | If absent, generation returns `skipped_no_provider`. |

`_openai_provider` is the only default network call site. It is
behind:

1. `COACH_VOICE_LLM_ENABLED=true` AND
2. `OPENAI_API_KEY` set AND
3. sufficiency gate passed.

If `from openai import AsyncOpenAI` fails or the call raises, the
provider returns `{"blocked": True, "reason": "provider_*"}` and the
generator records `status="blocked"`. No raw transcript content is
ever logged — only assessment id / video id / status / reason.

## Prompt / schema details

`coach_voice_prompt(input_payload)` returns `(system_prompt,
user_prompt)`:

* **System prompt (English):** "You are Cognivio's instructional
  coach. Use ONLY the supplied moments and transcript excerpts… Never
  write rubric labels, scores, confidence values, framework element
  names, or system language like 'evidence', 'rubric', 'element',
  'sampled', or 'overall performance'. Do not invent dialogue. Do not
  quote student names. Output STRICT JSON matching the supplied
  schema. Reference moments by start_sec / end_sec values that appear
  in the input. If the supplied evidence is not sufficient to coach
  safely, return `{"blocked": true, "reason": "insufficient_evidence"}`."
* **System prompt (Hebrew):** same instructions in Hebrew, mandating
  Hebrew output and forbidding English rubric labels.
* **User prompt:** the JSON-serialized
  `build_coach_voice_input(...)` payload — bounded, name-redacted,
  rubric-free.

`build_coach_voice_input(...)` exposes ONLY:
`language`, `lesson` (subject/title — never name/email),
`teacher.grade_level` / `teacher.subject` (never name or email),
`moments[i]` (id, start, end, phase, safe summary, redacted transcript
excerpt, signal scores), `prior_action_items[0..1]` (teacher-safe
title/body/why_it_matters), `transcript_available`, and an
`output_schema` dictionary describing the JSON keys the model must
produce.

## Caching / cost controls

* Cache collection: `teacher_coach_voice_generations`.
* Cache key: `(assessment_id, language, coach_voice_version,
  artifact_version, evidence_hash)`.
* `evidence_hash = sha256(canonical_json(input_payload))` — flips
  whenever the moment set, transcript, or prior action items change.
* `load_cached_coach_voice` returns the cached row when `status` is
  `generated` or `blocked`. Failed/validation rows are NOT reused; the
  next request re-runs the provider.
* `cache_or_persist_coach_voice` upserts on the same key.
* When the database adapter does not expose `teacher_coach_voice_generations`
  (e.g. in older test fixtures) cache calls are silent no-ops — the
  artifact still works.

## Validation / fail-closed behavior

`validate_generated_coach_voice(raw, *, input_payload)` runs:

1. Strict JSON parse → reject with `invalid_json` otherwise.
2. Reject `{"blocked": true, ...}` as `model_blocked`.
3. Require summary fields `opening`, `what_worked`, `growth_focus`,
   `next_step`.
4. Require primary action title / body / try_next_lesson AND
   `(moment_start_sec, moment_end_sec)` to match an input moment.
5. Require highlight body AND timestamps in input.
6. For each `deep_dive_moments[i]`: timestamps in input, no duplicate
   pairs, non-empty text.
7. `quality.used_moment_ids` must reference IDs in input.
8. C2 `find_teacher_visible_text_issues(...)` scan on summary +
   primary_action + highlight + deep_dive_moments. Banned strings
   trigger `unsafe_teacher_text`.
9. Language: if target is Hebrew, declared language must start with
   `he` and rendered text must contain Hebrew Unicode (`֐`–`׿`).

When any issue is reported, `status="failed_validation"` and the
artifact stays deterministic. Validation issues are stored in the
cache record for admin diagnostics.

## Artifact integration

`apply_coach_voice_to_artifact(artifact, record)`:

* Attaches a teacher-safe `coach_voice` block to the artifact:
  `{status, source, language, validated}`.
* Attaches an admin-only `_coach_voice_admin` block with
  `provider`, `model`, `input_token_estimate`,
  `output_token_estimate`, `validation_issues`, `sufficiency`,
  `evidence_hash`, `used_transcript`, `used_moment_ids`.
* Replaces `artifact.summary.opening/what_worked/growth_focus/next_step`
  ONLY when each replacement passes
  `is_teacher_visible_text_safe(...)` AND is not
  `detect_fallback_text(...)`.
* Replaces `artifact.action_items[0].body/try_next_lesson/title/
  why_it_matters/reflection_prompt` under the same safety check.
* Replaces `artifact.highlights[0]` and mirrors into
  `recognition.personal_highlights`.
* Replaces `artifact.deep_dive.moments` while preserving the C3 video
  href from the matching input moment.
* Preserves `artifact.navigator` (C8) and all action-item taxonomy
  fields.

A new `teacher_safe_artifact(artifact)` helper strips
`_coach_voice_admin` before any teacher endpoint returns the artifact.
Every `"coaching_artifact": artifact` in `server.py` was updated to
`"coaching_artifact": teacher_safe_artifact(artifact)`.

`admin_view_of_artifact(...)` reads `_coach_voice_admin` and exposes
it as `coach_voice_diagnostics` next to the existing `teacher_preview`
block.

## Hebrew behavior

* `coach_voice_prompt(...)` ships Hebrew system instructions when the
  language is `he`.
* `validate_generated_coach_voice(...)` rejects Hebrew-target
  responses that lack Hebrew characters
  (`hebrew_english_leak` issue code) or that declare
  `language != "he"` (`language_mismatch`).
* When the provider is disabled or the validation fails, the existing
  Hebrew C5/C8 deterministic translations remain.

## Tests added / updated

### Backend (new, 24 passing)

`backend/tests/test_coach_voice_generation.py`:

* Sufficiency gate: blocks `blocked_artifact`,
  `admin_hidden`, `revision_requested`, `evidence_blocked`,
  `insufficient_evidence`. Allows strong moments + transcript.
* Input builder: excludes rubric labels, scores, confidence, names,
  emails. Transcript excerpts capped at 240 chars.
* `evidence_hash` changes when the moment set changes.
* Validation: rejects non-JSON, unsupported timestamps, banned
  strings (`Try this next lesson: rafi: Demonstrating Knowledge of
  Students.`), unknown moment ids, `{"blocked": True}` sentinels, and
  Hebrew target with English output.
* `generate_teacher_coach_voice`:
  - `skipped_disabled` when env not set AND no provider arg.
  - `generated` when explicit mock provider supplied.
  - Cache hit on second call (mock provider only called once).
  - `skipped_insufficient` when `admin_review = admin_hidden`.
* `apply_coach_voice_to_artifact` replaces summary / action /
  highlight / deep-dive and attaches `coach_voice` + `_coach_voice_admin`.
* `teacher_safe_artifact` strips admin diagnostics and never leaks
  provider/model/token data.
* `admin_view_of_artifact` exposes `coach_voice_diagnostics`.
* Hebrew mock output integrates without rubric leakage.
* Validation failure preserves the deterministic summary.
* Blocked artifact: apply does not overwrite summary fields.

### Backend (regression: 458 passed, 0 regressions)

All C1–C8 backend tests continue to pass, including
`test_teacher_navigation_intelligence`,
`test_pilot_teacher_experience_integration`,
`test_admin_workflow_notifications_audit`,
`test_admin_teacher_feedback_review`,
`test_teacher_admin_coaching_thread`,
`test_action_plan_lifecycle`,
`test_teacher_lesson_coaching_artifact`,
`test_teacher_artifact_quarantine`,
`test_lesson_moment_evidence_quality`,
`test_video_source_chain_audit`,
`test_teacher_feedback_projection`,
`test_end_to_end_app_flow_hotfix`,
`test_pilot_demo_flow`.

### Frontend (no new tests required; 9 suites / 43 tests pass)

The artifact's existing
`summary` / `action_items` / `highlights` / `deep_dive.moments`
contracts are unchanged. The new `coach_voice` teacher-facing block is
additive metadata and not consumed for rendering yet.

The frontend production build is green.

## Commands run

```
cd backend
python -m py_compile server.py                                                # ok
python -m py_compile app/services/teacher_lesson_coaching_artifact.py         # ok
python -m py_compile app/services/teacher_artifact_quarantine.py              # ok
python -m py_compile app/services/lesson_moment_quality.py                    # ok
python -m py_compile app/services/coach_voice_generation.py                   # ok
python -m py_compile scripts/audit_teacher_coaching_artifacts.py              # ok
python -m py_compile scripts/run_pilot_smoke_checks.py                        # ok
python -m compileall -q app                                                   # ok
python -m pytest tests/test_coach_voice_generation.py -q                      # 24 passed
python -m pytest tests/test_teacher_navigation_intelligence.py
                tests/test_teacher_lesson_coaching_artifact.py
                tests/test_pilot_teacher_experience_integration.py
                tests/test_admin_workflow_notifications_audit.py
                tests/test_admin_teacher_feedback_review.py
                tests/test_teacher_admin_coaching_thread.py
                tests/test_action_plan_lifecycle.py
                tests/test_teacher_artifact_quarantine.py
                tests/test_lesson_moment_evidence_quality.py
                tests/test_video_source_chain_audit.py
                tests/test_teacher_feedback_projection.py
                tests/test_end_to_end_app_flow_hotfix.py
                tests/test_pilot_demo_flow.py -q                              # 176 passed
python -m pytest tests/ -q --timeout 120                                      # 458 passed

cd frontend
env CI=true npm test -- --runInBand --testPathPattern="(PilotTeacherExperience|TeacherWorkspacePage|TeacherCoachingPage|TeacherBadgesPage|AdminReviewAndActionPlan|AdminTeacherFeedbackReviewCard|EndToEndAppFlowAudit|TeacherExperienceV1|TeacherNavigationIntelligence)\.test\."
# 9 suites / 43 tests passed
env CI=true npm run build                                                     # green
```

## Known limitations

1. **Frontend does not yet render the `coach_voice.status` badge.** It
   is intentionally additive — existing teacher pages consume the same
   `summary` / `action_items` / `highlights` / `deep_dive.moments`
   keys and automatically pick up the LLM phrasing. A C10 follow-up
   can add an admin "AI-assisted" badge.
2. **Only OpenAI provider implemented.** The provider abstraction
   accepts any async callable (tests inject a mock). Adding Anthropic
   or emergentintegrations is a small follow-up.
3. **No background refresh job.** Coach voice is generated lazily on
   the first teacher/admin request that hits sufficient evidence.
   Subsequent requests hit the cache. A deploy-time pre-warm is a
   C10 task.
4. **No cost dashboards.** Per-tenant token totals are estimated and
   stored in the cache record. Aggregating them into an admin
   dashboard is C10.
5. **Hebrew prompt is a single block.** Pilot output may need
   refinement once we see real Hebrew teacher samples.

## Production rollout instructions

1. **Deploy this PR with `COACH_VOICE_LLM_ENABLED` UNSET.** The
   deterministic artifact + C8 navigator behaviour is unchanged. All
   C1–C8 production smoke continues to pass.
2. **Run the C7 smoke script:**
   ```bash
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/run_pilot_smoke_checks.py --json
   ```
   Expect overall `ok` and no banned strings.
3. **Enable coach voice for a single pilot workspace** by setting
   `COACH_VOICE_LLM_ENABLED=true` and `OPENAI_API_KEY=...` in Railway.
4. **Pick a forensic-blocked teacher and verify** that
   `coaching_artifact.coach_voice.status` is `skipped_insufficient`
   (admin can confirm via `admin_view_of_artifact.coach_voice_diagnostics`).
5. **Pick a valid teacher with a recent transcript-rich lesson** and
   verify:
   * `coaching_artifact.coach_voice.status == "generated"`.
   * `coaching_artifact.summary.opening` reads like a coach.
   * `_coach_voice_admin.used_transcript == True` (admin view).
   * Banned strings absent from the rendered teacher page.
6. **Confirm cache reuse:** a second request to the same endpoint
   should return the cached output (no new provider call).
7. **Promote to broader pilot** only after a coach has reviewed at
   least three generated samples and approved the tone.

### Post-deploy smoke checklist (C9-specific)

| Check | Expected |
| --- | --- |
| Forensic blocked teacher | `coach_voice.status` is `skipped_insufficient` or `skipped_disabled`. No provider call (cache empty). Review-status navigator unchanged. |
| Valid teacher, LLM disabled | `coach_voice.status == "skipped_disabled"`. Deterministic summary remains. No regression. |
| Valid teacher, LLM enabled | `coach_voice.status == "generated"`. Generated summary visible. Banned strings absent. Admin view shows diagnostics. Second call uses cache. |
| Invalid mocked output | `coach_voice.status == "failed_validation"`. Deterministic summary preserved. Admin sees validation issues. |
| Hebrew teacher | Hebrew summary. No English rubric labels. |

## C10 handoff notes

1. **Admin diagnostic dashboard** — surface the audit endpoint JSON +
   `coach_voice_diagnostics` per assessment in an admin table.
2. **Cross-lesson growth analytics** — aggregate `coach_voice.status`
   distributions and tried/reflected counts per teacher.
3. **Notification + onboarding polish** — short tooltips around the
   navigator + the coach-voice badge once visible.
4. **Deploy-hook smoke automation** — wire
   `backend/scripts/run_pilot_smoke_checks.py` into Railway's deploy
   hook. Add a `--expect-coach-voice` flag.
5. **Final pilot readiness checklist** — once C9 has been live with
   coach voice enabled for a workspace and three generated samples
   reviewed, declare pilot-ready.
6. **Prompt refinement** — iterate on the English + Hebrew system
   prompt after real pilot samples (especially short-transcript /
   visual-only lessons).
7. **Additional providers** — Anthropic Claude or
   `emergentintegrations` as alternate providers behind the existing
   `CoachVoiceProvider` abstraction.
8. **Token / cost dashboards** — aggregate the cached
   `input_token_estimate` + `output_token_estimate` per tenant.
