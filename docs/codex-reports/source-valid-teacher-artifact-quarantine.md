# PR C2 — Source-valid teacher coaching artifact and unsafe-feedback quarantine

## Summary

PR C1 (`pilot/video-source-chain-audit-fix`) hardened the upload pipeline so the
canonical `videos` document is created on every upload, is preserved across
raw-asset deletion, and is required (via `_require_canonical_video_source`)
before any downstream worker write. C1 also added the read-only audit script
`backend/scripts/audit_video_source_chain.py`.

PR C2 closes the remaining production gap: teacher dashboards and coaching
pages were still rendering reviewed-lesson coaching artifacts whose canonical
`videos` and `assessments` rows had already been deleted by older cleanup
paths. The legacy assessment / projection text from those orphan rows was
leaking rubric names (Danielson + Marshall), score tokens (`d1b`, `5.3/10`),
generic fallback phrases (`The clip gave us a brief window into your
lesson — here is what stood out.`), the teacher's name as a label
(`Try this next lesson: rafi:`), and duplicate `923.8–943.8` deep-dive moments.

C2 makes teacher endpoints **fail closed**:

1. New `backend/app/services/teacher_artifact_quarantine.py` centralizes:
   * Source-chain validation against MongoDB (async + sync forms).
   * Recursive unsafe-text detection over the known bad-string corpus.
   * Coaching-task quarantine filter, deep-dive quality gate, action-item
     eligibility gate, and payload-level rejection.
   * Honest readiness/empty-state copy used by teacher endpoints when no
     source-valid lesson is available.
2. `backend/scripts/audit_video_source_chain.py` now ships a non-destructive
   `--repair-safe` mode that **only attaches diagnostic markers** — no rows
   are deleted, no teacher-visible text is rewritten.
3. `backend/server.py` teacher endpoints (`/api/teachers/me/dashboard`,
   `/api/teachers/me/coaching`, `/api/teachers/me/latest-lesson`,
   `/api/teachers/me/lessons`, `/api/assessments/{id}` when called by a
   teacher, `/api/teachers/me/recognition`) now run every coaching task,
   assessment projection, deep-dive moment, action item, highlight, and
   recognition entry through the new gates before responding.

## Exact problem fixed

The following teacher-visible strings observed in production are now
guaranteed to never appear in any teacher endpoint:

```
"Try this next lesson: rafi:"
"Rafi:"
"coach d", "d1a", "d1b", "d1c", "d2b", "d3b", "d4e"
"after moment"
"after 5.6 evidence"
"score", "rubric", "element", "evidence"
"based on the observed moment"
"Plan a targeted coaching cycle"  /  "plan a targeted coaching cycle"
"The clip gave us a brief window into your lesson — here is what stood out."
"brief window into your lesson"
"Demonstrating Knowledge of Students"
"Demonstrating Knowledge of Content and Pedagogy"
"Creating an Environment of Respect and Rapport"
"Using Questioning and Discussion Techniques"
"Organizing Physical Space"
"Setting Instructional Outcomes"
"Establishing a Culture for Learning"
"Growing and Developing Professionally"
```

Plus duplicate `(start, end)` deep-dive moments at the same timestamp
(production bug: two `923.8–943.8` cards on the same review).

## Files changed

| File | Why |
| --- | --- |
| `backend/app/services/teacher_artifact_quarantine.py` | New module — source validity, unsafe-text gate, deep-dive quality gate, coaching-task filter, payload reject, diagnostic markers, honest empty state. |
| `backend/scripts/audit_video_source_chain.py` | Added `--repair-safe` (non-destructive marker writes), `--dry-run`, `repair_mark_documents`, reusable `_open_mongo_client` + `_load_collections`. |
| `backend/server.py` | Imported the new helpers; gated `_teacher_projection_for_assessment`, `/api/teachers/me/latest-lesson`, `/api/teachers/me/lessons`, `/api/teachers/me/coaching`, `/api/teachers/me/dashboard`, `_my_teacher_recognition_payload` on source-validity + unsafe-text; switched to honest fallback `next_best_action`. |
| `backend/tests/test_teacher_artifact_quarantine.py` | New API-level + unit tests including the negative-assertion helper that recursively serializes responses. |
| `docs/codex-reports/source-valid-teacher-artifact-quarantine.md` | This report. |

The existing `backend/tests/test_video_source_chain_audit.py` and
`backend/tests/test_teacher_feedback_projection.py` continue to pass without
modification.

## Source-validity helper behavior

`build_source_validity` / `validate_teacher_artifact_source_chain` return a
structured payload:

```python
{
  "video_id": ...,
  "assessment_id": ...,
  "teacher_id": ...,
  "video_exists": bool,
  "assessment_exists": bool,
  "video_teacher_match": bool,
  "assessment_teacher_match": bool,
  "assessment_video_match": bool,
  "has_transcript": bool,        # set when require_transcript
  "has_moments": bool,           # set when require_moments
  "valid_for_teacher_display": bool,
  "invalid_reasons": [
    "missing_source_video" | "missing_source_assessment" |
    "video_teacher_mismatch" | "assessment_teacher_mismatch" |
    "assessment_video_mismatch" | "missing_video_id" |
    "explicitly_hidden" | "marked_orphaned" | "missing_transcript" |
    "missing_moments"
  ],
}
```

`_teacher_projection_for_assessment` uses the sync form: it already loads the
canonical video for the teacher, so we avoid the extra DB round-trip.
`/api/teachers/me/coaching` uses the in-memory variant after loading the full
set of canonical videos/assessments for the teacher in one query each.

## Unsafe-text detector behavior

`find_unsafe_text_issues(text)` returns a list of marker strings —
`bad_pattern:<exact phrase>`, `rubric_code_token`, `score_token`. The
implementation:

* Substring-matches multi-word / punctuated patterns (e.g.
  `"plan a targeted coaching cycle"`, `"rafi:"`).
* Word-boundary matches bare alphanumeric tokens (e.g. `score`, `rubric`,
  `element`, `evidence`, `d1a..d4e`) so `scoreboard` and `elementary` are NOT
  false-positives.
* Detects rubric-code shape via regex `\b[dm][1-9][a-j]?\b`.
* Detects score-shape (`5.3`, `5.3/10`, `57%`).

`find_teacher_visible_text_issues(payload)` is the recursive variant returning
`[{"path": "...", "value": "...", "issues": "..."}]`, used by
`reject_unsafe_teacher_payload` to verify a cleaned projection.

## Endpoints gated

| Endpoint | Gate added |
| --- | --- |
| `/api/teachers/me/dashboard` | Selects only source-valid + safe `latest_lesson`; filters `highlights`, `action_items`, `recognition.items`; uses honest fallback `next_best_action` when none survive. |
| `/api/teachers/me/coaching` | Loads canonical `videos`/`assessments`, filters `coaching_tasks` via `filter_teacher_visible_coaching_tasks`, picks the newest source-valid assessment to drive the projection, filters `active_tasks`/`recommendations`/`suggested_improvements` through `is_action_item_teacher_eligible`, falls back to `honest_next_best_action_for_record`. |
| `/api/teachers/me/latest-lesson` | Returns `{"lesson": null}` if the projection is rejected. |
| `/api/teachers/me/lessons` | Lessons whose assessment fails the projection gate are demoted from `reviewed` to the underlying video-processing status. |
| `/api/assessments/{assessment_id}` (teacher path) | Returns `teacher_feedback: null` and empty `summary`/`recommendations` for orphan source chains. |
| `/api/teachers/me/recognition` | Drops badges whose `video_id` references a deleted or wrong-teacher video; drops any badge whose title/description fails the unsafe-text gate. |

Admin endpoints (e.g. master-admin assessment views, audit script output)
preserve full visibility — the diagnostic markers attached by `--repair-safe`
make orphan rows easy to find.

## Audit script `--repair-safe` behavior

`backend/scripts/audit_video_source_chain.py --repair-safe` (without
`--dry-run`):

* Runs the same read-only `audit_documents` pass.
* For every sampled issue whose code is in `_REPAIR_MARKER_CODES`, sets
  ```
  source_integrity: "orphaned" | "invalid"
  hidden_from_teacher: True              # for derived rows; not set on parent videos
  hidden_reason: "missing_source_video" | "missing_source_assessment" |
                  "missing_playable_asset"
  needs_admin_review: True
  source_audited_at: <UTC ISO>
  source_audit_reason: <issue code>
  ```
  on the matching row by `id`.
* Never deletes a row. Never rewrites text. Never touches canonical
  `videos`/`assessments` text — for those collections it only adds
  diagnostic fields (`needs_admin_review`, `source_integrity: "invalid"`)
  when the chain is broken.
* `--dry-run` (default behavior when `--repair-safe` is omitted) writes
  nothing.

The script writes a `repair_safe` summary block into the JSON / text output
(`marked`, `by_collection`, `by_code`).

## Tests added / updated

`backend/tests/test_teacher_artifact_quarantine.py` covers:

1. Known bad strings are flagged by `find_unsafe_text_issues`.
2. Safe teacher copy is not flagged.
3. Word-boundary handling (`elementary`, `scoreboard` allowed).
4. `build_source_validity` orphan + happy path.
5. `filter_teacher_visible_coaching_tasks` drops orphans + unsafe + keeps safe.
6. `filter_deep_dive_moments` drops duplicate `(start, end)` pairs, generic
   fallback phrases, rubric leakage, invalid timestamps.
7. `filter_deep_dive_moments` returns honest empty state when nothing survives.
8. `reject_unsafe_teacher_payload` drops unsafe items, keeps safe items, and
   only marks `guardrails.teacher_visible: True` when the recursive scan
   passes.
9. `reject_unsafe_teacher_payload` returns `None` when source chain invalid.
10. `is_action_item_teacher_eligible` rejects teacher-name prefix.
11. `diagnostic_markers` produces the agreed marker shape.
12. `validate_teacher_artifact_source_chain` async DB validator detects the
    forensic orphan pattern and confirms a clean chain.
13. `/api/teachers/me/dashboard` does not contain any known bad string,
    returns empty highlights / action_items / recognition, and falls back to
    `next_best_action.href == "/record"` for the orphan fixture.
14. `/api/teachers/me/coaching` returns empty `active_tasks` /
    `recommendations` / `suggested_improvements` / `deep_dive.available = false`
    on the orphan fixture.
15. `/api/teachers/me/latest-lesson` returns `{"lesson": null}` for orphan
    chains.
16. `/api/teachers/me/lessons` does not mark orphan assessments as `reviewed`.
17. `/api/assessments/{id}` teacher view returns `teacher_feedback: null` and
    empty recommendations on an orphan chain.
18. Valid source data still renders teacher-safe content (no false blocking).
19. Audit script `repair_mark_documents` marks orphans non-destructively and
    leaves clean rows alone.
20. `audit_documents` continues to surface orphans for admin visibility after
    teacher-side hiding.

A shared `assert_no_known_bad_strings(payload)` helper recursively serializes
every API response and asserts the production bad strings are absent.

## Commands run

```
python -m py_compile server.py
python -m py_compile app/services/teacher_artifact_quarantine.py
python -m py_compile scripts/audit_video_source_chain.py
python -m compileall -q app
python -m pytest tests/test_teacher_artifact_quarantine.py -q
python -m pytest tests/test_video_source_chain_audit.py tests/test_teacher_feedback_projection.py -q
python -m pytest tests/test_end_to_end_app_flow_hotfix.py tests/test_pilot_demo_flow.py -q
python -m pytest tests/ -q --timeout 60         # 326 passed
```

Local audit-script smoke (the script needs Mongo credentials, so no
production data was touched from this branch):

```
python scripts/audit_video_source_chain.py --json --limit 10            # safe, read-only
python scripts/audit_video_source_chain.py --repair-safe --limit 10000  # production run, after review
```

## Production rollout instructions

1. **Deploy this PR** — teacher endpoints will start filtering orphans
   immediately. Diagnostic markers on the rows are optional; the in-memory
   filter handles the unmarked legacy data.
2. **Read-only audit first** — operator runs
   ```
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/audit_video_source_chain.py --json --limit 10
   ```
   and reviews the issue counts.
3. **If counts look correct**, run with marking enabled:
   ```
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/audit_video_source_chain.py --repair-safe --limit 10000
   ```
   `--limit 10000` ensures every sample is processed (the audit collects
   samples up to that limit per issue code). No rows are deleted.
4. **Recheck a teacher dashboard** in production for the previously affected
   teacher (`d36bcacb-fb19-4d97-8753-f0944131505b`).
5. **Verify admin diagnostic visibility** — orphaned rows should still be
   visible in admin audit output, now with `source_integrity`,
   `hidden_from_teacher`, `hidden_reason`, `needs_admin_review`, and
   `source_audited_at` markers.

## Known limitations

* The `--repair-safe` script marks rows that appear in the `samples` list of
  each issue code, capped by `--limit`. For production use the operator must
  pass a sufficiently high `--limit` (the help string suggests `10000`). A
  future PR could switch to streaming mark-as-you-go for unbounded scans.
* The unsafe-text detector is intentionally aggressive on rubric/admin
  vocabulary. If admins later add genuine teacher-visible coaching content
  containing one of those phrases as proper teacher copy, it would still be
  filtered. The current design considers that a feature (the legacy AI emits
  these by accident); a future allowlist could be added if an admin-authored
  template needs the phrase.
* The deep-dive quality gate currently does not check transcript / audio
  evidence quality at a per-moment level — that is C3 work.

## Follow-up notes for PR C3

1. **Richer moment sampling + transcript/audio evidence quality** — extend
   the moment sampler to attach evidence-quality metadata (transcript word
   count, audio clarity, frame count) and feed that into a per-moment
   confidence score used by the deep-dive gate.
2. **Representative frame inside window** — guarantee the selected frame
   timestamp lies inside `[start_sec, end_sec]` and isn't the synthesized
   midpoint when the window is short.
3. **Duplicate timestamp prevention at the sampler level** — push the
   duplicate `(start, end)` rejection from `filter_deep_dive_moments` into
   the sampler so duplicates are never persisted in the first place.
4. **Assessment evidence-quality metadata** — record per-element evidence
   coverage on the assessment so admin tooling can flag thin reviews before
   they reach the teacher.
5. **Canonical `TeacherLessonCoachingArtifact`** — collapse the read-side
   gating logic in `_teacher_projection_for_assessment`, the coaching
   endpoint loaders, and the lessons endpoint into a single object so a
   teacher artifact has one source-of-truth shape.
6. **Admin review/approval workflow** — surface `needs_admin_review` rows in
   the admin UI with one-click "ignore", "delete", or "rebuild" actions
   instead of relying on a CLI script.
