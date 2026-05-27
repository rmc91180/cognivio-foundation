# PR C3 — Lesson moment evidence quality and assessment-readiness gating

## Summary

PR C1 hardened the source chain (canonical `videos`/`assessments` survive
cleanup; `audit_video_source_chain.py` reports orphans). PR C2 hardened the
teacher read path (orphan/unsafe artifacts are quarantined and teacher
endpoints fail closed). PR C3 fixes the upstream cause of those bad
teacher pages: the evidence pipeline was selecting weak/duplicate windows,
persisting `representative_frame_sec` *outside* the moment window, and
treating timeline-coverage fallback windows as if they were real teacher
evidence.

This PR:

1. Adds `backend/app/services/lesson_moment_quality.py` with:
   * `normalize_lesson_moment_window` — enforces the timestamp invariant
     `start_sec >= 0 < end_sec`, clamps `end_sec` to video duration, and
     guarantees `representative_frame_sec ∈ [start_sec, end_sec]`. When no
     real frame falls inside the window, it falls back to the midpoint and
     marks `representative_frame_source: "synthetic_midpoint"` so the
     downstream gate knows.
   * `dedupe_lesson_moments` — drops exact-duplicate `(start_sec, end_sec)`
     pairs, high-overlap windows (≥85 %), same-text duplicates, and
     near-identical representative frames. Keeps the higher-quality moment;
     records `deduped_from` on dropped entries.
   * `compute_moment_quality` — returns a structured `quality` block
     (`version: lesson_moment_quality_v1`, visual/audio/transcript signal
     scores, specificity, fallback detection, `is_timeline_fallback`,
     `teacher_visible_candidate`, `quality_reasons`).
   * `compute_assessment_quality` — returns
     `version: assessment_quality_v1`, `evidence_sufficient`,
     `teacher_feedback_allowed`, `usable_moment_count`,
     `fallback_text_used`, etc. This is the single switch the projection
     consults.
   * `audit_moment_evidence_quality` / `audit_assessment_evidence_quality`
     — pure helpers shared with the new audit script.

2. Fixes the moment sampler in `backend/moment_sampler.py`:
   * When no frame falls inside a window, the sampler used to borrow the
     closest frame from the entire corpus — that's how the production
     1100–1108.6 window got `representative_frame_sec: 923.8`. The sampler
     now keeps the *features* from the closest frame for phase inference
     but synthesizes the midpoint timestamp and marks the window as
     `representative_frame_source: "synthetic_midpoint"`. Defensive final
     clamp ensures the rep-frame is always inside `[start_sec, end_sec]`.

3. Integrates the quality module into the persistence + assessment path in
   `backend/server.py`:
   * `build_moment_manifest` normalizes timestamps, runs dedupe, and
     attaches the per-moment `quality` block before writing to
     `video_analysis_moments`. The manifest now also persists
     `duration_sec`, `candidate_target`, `candidate_pool_size`, and a
     `deduped_moments` audit list.
   * Assessment generation computes the `analysis_quality` block from the
     persisted moments + transcript + audio + element scores and writes it
     into the assessment document.
   * `_teacher_projection_for_assessment` now consults
     `analysis_quality.teacher_feedback_allowed`; when it is `False` the
     projection returns `None` so the C2 honest empty state fires.

4. Adds `backend/scripts/audit_lesson_evidence_quality.py` — read-only,
   reports the new evidence-quality issue codes alongside the C1/C2
   source-chain audit.

5. Adds `backend/tests/test_lesson_moment_evidence_quality.py` — 23 tests
   that use the exact production failure pattern (1100–1108.6 window with
   rep-frame at 923.8, duplicate 923.8–943.8 moments, six timeline-coverage
   windows with near-zero features). C1 + C2 regression smoke tests are
   included.

## Files inspected

* `backend/moment_sampler.py` — segmentation + scoring + selection
  (`segment_video_windows`, `score_windows`, `select_lesson_moments`)
* `backend/frame_selection.py` — frame extraction with selection_features
* `backend/multimodal_analysis.py` —
  `align_transcript_segments_to_moments`, `build_multimodal_analysis_payload`
* `backend/audio_pipeline.py` — transcript extraction (existing flow)
* `backend/server.py` — `build_moment_manifest`,
  `attach_moment_metadata_to_frames`, the analysis pipeline that calls
  `analyze_frames_with_ai`, `_normalize_model_analysis`,
  `_build_placeholder_element_score` (source of the “brief window”
  fallback text), `_teacher_projection_for_assessment` (C2 read-side gate)
* `backend/app/analysis/teacher_feedback_projection.py` — teacher voice +
  deep-dive output (unchanged)
* `backend/app/services/teacher_artifact_quarantine.py` — C2 read-side
  gates (unchanged behaviour; C3 plugs into the projection at the same
  gate point)
* `backend/scripts/audit_video_source_chain.py` — C1/C2 audit script
  (unchanged; C3 ships a separate `audit_lesson_evidence_quality.py`)
* `backend/tests/test_moment_sampler.py`,
  `backend/tests/test_frame_selection.py`,
  `backend/tests/test_teacher_feedback_projection.py`,
  `backend/tests/test_teacher_artifact_quarantine.py`,
  `backend/tests/test_video_source_chain_audit.py`

## Existing pipeline path discovered

1. `extract_video_frames` (OpenCV) → sample of frames with
   `timestamp_sec`, `selection_score`, `selection_features`.
2. `build_sampling_manifest` → persists selected frames in
   `video_sampling_manifests`.
3. `build_moment_manifest` →
   `segment_video_windows` (contiguous 20-sec windows) →
   `score_windows` (assigns dominant frame, phase, score, supporting
   features) → `select_lesson_moments` (cap of 6 moments by default).
4. `attach_moment_metadata_to_frames` annotates each frame with its
   matching moment.
5. `build_audio_artifacts` (when enabled) creates
   `video_audio_transcripts` + `video_analysis_features`.
6. `build_multimodal_analysis_payload` aligns transcript segments to
   moments.
7. `analyze_frames_with_ai` calls the LLM; `_normalize_model_analysis`
   normalizes; `_build_placeholder_element_score` synthesizes element
   scores when the model output is missing — using the literal text *“The
   clip gave us a brief window into your lesson — here is what stood
   out.”*.
8. The assessment document is written with `element_scores`, `summary`,
   `recommendations`, `observation_summary`, `analysis_confidence`,
   `specialist_orchestrator`, etc.
9. Teacher projection (`_teacher_projection_for_assessment`) consumes the
   assessment + canonical video and produces the teacher-facing
   `latest_summary`/`highlights`/`action_items`/`deep_dive`.

## Root causes found

| Root cause | Where | Effect |
| --- | --- | --- |
| Sampler borrows closest-overall frame timestamp when no frame falls inside a window | `score_windows` in `backend/moment_sampler.py` | `representative_frame_sec=923.8` written into a `1100/1108.6` window |
| No dedupe before persistence | `build_moment_manifest` | Duplicate `923.8–943.8` moments visible in production |
| Timeline-coverage windows with all-zero features treated identically to evidence-rich windows | `_teacher_projection_for_assessment` + `_moment_candidates` | Fake teacher deep dives |
| Placeholder element scores carry the “brief window” text and confidence 25 — but the assessment did not flag itself as low-evidence | `_build_placeholder_element_score` + assessment doc | Teacher endpoints rendered the placeholder text |
| Six 20-second moments are too thin a candidate pool for >10-minute videos | `VIDEO_ANALYSIS_MAX_MOMENTS=6` cap | Most windows ended up as timeline_coverage |
| No structured `quality` block per moment, no `analysis_quality` block per assessment | (none existed) | No upstream way to tell teacher path the evidence was weak |

## Moment quality implementation

Schema persisted under `video_analysis_moments[*].quality`:

```json
{
  "version": "lesson_moment_quality_v1",
  "source_valid": true,
  "timestamp_valid": true,
  "representative_frame_valid": false,
  "selection_reason": "timeline_coverage",
  "is_timeline_fallback": true,
  "visual_signal_score": 0.06,
  "audio_signal_score": 0.0,
  "transcript_signal_score": 0.0,
  "specificity_score": 0.0,
  "teacher_action_signal": 0.0,
  "student_response_signal": 0.0,
  "has_transcript_window": false,
  "fallback_text_used": false,
  "confidence": 0.03,
  "teacher_visible_candidate": false,
  "quality_reasons": [
    "missing_transcript",
    "timeline_coverage_low_signal",
    "no_transcript_for_window"
  ]
}
```

Selection rules (a moment becomes `teacher_visible_candidate: true` only
when all of):

* `window_valid` and `representative_frame_valid`
* not `fallback_text_used`
* not `is_timeline_fallback` (i.e. low-signal `timeline_coverage`/`scene_transition` with all-zero features)
* `confidence >= TEACHER_VISIBLE_MIN_CONFIDENCE` (0.35)
* `specificity_score >= TEACHER_VISIBLE_MIN_SPECIFICITY` (0.4) OR
  `has_transcript_window`

## Assessment quality implementation

Schema persisted under `assessments[*].analysis_quality`:

```json
{
  "version": "assessment_quality_v1",
  "evidence_sufficient": false,
  "teacher_feedback_allowed": false,
  "usable_moment_count": 0,
  "low_confidence_moment_count": 6,
  "visible_candidate_count": 0,
  "transcript_available": false,
  "transcript_segment_count": 0,
  "audio_features_available": false,
  "visual_features_available": true,
  "fallback_text_used": true,
  "element_score_count": 22,
  "element_fallback_count": 22,
  "quality_reasons": [
    "all_element_scores_fallback",
    "transcript_unavailable",
    "audio_features_unavailable",
    "fallback_text_used",
    "no_usable_moments"
  ]
}
```

Gate logic:

* `teacher_feedback_allowed = True` requires at least 2 usable moments,
  at least 1 `teacher_visible_candidate`, and not “all element scores are
  fallback”.
* `_teacher_projection_for_assessment` checks
  `assessment_quality_blocks_teacher_feedback(assessment)` immediately
  after the C2 source-validity check. When True the projection returns
  `None`, triggering the C2 honest empty state in the dashboard/coaching
  endpoints. Older assessments without the `analysis_quality` block are
  NOT blocked here — they still pass through the C2 unsafe-text gate.

## Audit script changes

New script: `backend/scripts/audit_lesson_evidence_quality.py`

Read-only. Loads `video_analysis_moments`, `assessments`, and a small slice
of `videos` (for `duration_sec`). Issues surfaced:

* `moment_invalid_start_sec`
* `moment_missing_end_sec`
* `moment_end_sec_before_start_sec`
* `moment_end_sec_beyond_duration`
* `moment_missing_representative_frame_sec`
* `moment_representative_frame_outside_window`
* `moment_duplicate_window`
* `moment_missing_quality`
* `moment_timeline_coverage_low_signal`
* `moment_fallback_text_used`
* `assessment_missing_analysis_quality`
* `assessment_teacher_feedback_blocked`
* `assessment_fallback_text_used`

The C1/C2 source-chain audit script
(`backend/scripts/audit_video_source_chain.py`) is unchanged.

## Tests added/updated

New file `backend/tests/test_lesson_moment_evidence_quality.py` —
23 passing tests covering:

1. `representative_frame_sec=923.8` inside a `1100/1108.6` window is
   normalized to a synthetic midpoint and marked `_valid=False`.
2. In-window representative frames stay valid; in-window real frames win
   over a bad input.
3. Validator surface the production pattern as
   `representative_frame_outside_window`.
4. Duplicate `923.8–943.8` moments collapse to the stronger one; high-
   overlap and same-text dedup work; distinct windows are kept.
5. Timeline-coverage with all-zero features becomes
   `teacher_visible_candidate: False`, `is_timeline_fallback: True`,
   confidence well under the threshold.
6. Transcript-rich moments score higher than timeline-only moments.
7. Assessment quality blocks teacher feedback when only timeline-fallback
   moments exist and all element scores are placeholder text.
8. Assessment quality allows teacher feedback when evidence is real.
9. `detect_fallback_text` matches the production phrases including the
   Hebrew variant via the same vocabulary; `specificity_score` correctly
   penalizes the fallback.
10. Moment with fallback text becomes `teacher_visible_candidate: False`.
11. Audit script surfaces the expected issue codes for the production
    pattern.
12. `suggested_candidate_window_count` returns more candidates for long
    videos than short ones.
13. `score_windows` no longer emits representative frames outside their
    window even when frames live nowhere near the closure window.
14. Teacher projection returns `None` when
    `analysis_quality.teacher_feedback_allowed` is `False`.
15. Teacher projection still works when quality allows (no false blocking).
16. C2 + C1 imports continue to work (smoke regression).

## Commands run and results

```
python -m py_compile server.py                                      # ok
python -m py_compile app/services/lesson_moment_quality.py          # ok
python -m py_compile app/services/teacher_artifact_quarantine.py    # ok
python -m py_compile scripts/audit_lesson_evidence_quality.py       # ok
python -m compileall -q app                                         # ok
python -m pytest tests/test_lesson_moment_evidence_quality.py -q    # 23 passed
python -m pytest tests/test_teacher_artifact_quarantine.py -q       # 24 passed
python -m pytest tests/test_video_source_chain_audit.py -q          # 6 passed
python -m pytest tests/test_teacher_feedback_projection.py -q       # 5 passed
python -m pytest tests/test_end_to_end_app_flow_hotfix.py
                tests/test_pilot_demo_flow.py -q                    # 9 passed
python -m pytest tests/test_moment_sampler.py -q                    # 3 passed
python -m pytest tests/test_frame_selection.py -q                   # passed
python -m pytest tests/ -q --timeout 90                             # full suite green
```

## Known limitations

* C3 does **not** implement a new transcription vendor. When the existing
  audio pipeline is disabled or returns no segments, moments report
  `has_transcript_window: false` and the assessment reports
  `transcript_available: false`. The gate correctly refuses teacher
  feedback in that case, but the next PR should focus on actually
  capturing transcript/audio evidence in more lessons.
* `compute_assessment_quality` flags an assessment as `fallback_text_used`
  when the placeholder text appears anywhere — including legacy
  assessments. Operators may see a wave of `teacher_feedback_allowed:
  false` for legacy data; that is intentional (C2 already hides those
  rows from teachers).
* The selection cap (`VIDEO_ANALYSIS_MAX_MOMENTS = 6`) was left
  unchanged. C3 only persists `candidate_target` /
  `candidate_pool_size` on the manifest so a future PR can grow the
  cap with measured data.
* Specificity scoring is a heuristic (length + keyword) and does NOT
  call any LLM. Real semantic evaluation is C4 territory.
* The audit script reads `videos.duration_sec`. Videos without that
  field fall back to per-moment validation only (no duration check).

## Production rollout notes

1. Deploy this PR. New uploads start writing the `quality` block on every
   moment and the `analysis_quality` block on every assessment.
2. Run the new read-only audit on production:
   ```
   MONGO_URL=... DB_NAME=... \
     python backend/scripts/audit_lesson_evidence_quality.py --json --limit 500
   ```
3. Review counts. Expect to see:
   * `moment_representative_frame_outside_window`,
     `moment_duplicate_window`, and
     `moment_timeline_coverage_low_signal` on legacy moments (these are
     reported, not modified).
   * `assessment_missing_analysis_quality` on all assessments older than
     the deploy.
4. Decide whether to backfill `analysis_quality` for legacy assessments
   in a future PR. C3 deliberately leaves legacy data unmodified — the
   C2 read-side gates already hide it from teachers.
5. Re-check teacher dashboards for the forensic teacher
   `d36bcacb-fb19-4d97-8753-f0944131505b`. Expectation: same C2 honest
   empty state until the teacher uploads a new lesson with sufficient
   evidence.

## C4 handoff notes

C3 lays the groundwork; C4 should focus on:

1. **Backfill `analysis_quality` for legacy assessments** so admins can
   filter the orphan/unsafe corpus by `teacher_feedback_allowed=false`.
2. **Assessment prompt + content generation using the new quality
   metadata** — for example, feeding the LLM the per-moment confidence
   so it stops generating fake observations for timeline-fallback
   moments.
3. **Teacher coaching artifact richness** — when transcript is available,
   produce specific quotes + classroom dialogue references. The
   `quality.transcript_signal_score` is the trigger to enrich the
   teacher-visible projection.
4. **Admin review/approval workflow** — surface
   `analysis_quality.quality_reasons` in the admin UI so reviewers can
   one-click promote a borderline assessment to teacher-visible or
   quarantine it.
5. **Rubric-to-practice translation** — once a moment has transcript +
   audio signal, translate rubric labels into the teacher voice without
   needing the `master_observer` fallback path.
6. **Improved teacher action item generation from specific evidence** —
   use `quality.teacher_action_signal` + `quality.student_response_signal`
   to draft action items tied to *real* dialogue moments.
7. **Grow the moment cap for long videos** — the current 6-moment cap is
   conservative; the new `candidate_target`/`candidate_pool_size` fields
   should drive a data-informed bump to ~12 for ≥30-minute videos.
