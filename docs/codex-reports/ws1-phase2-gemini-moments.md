# WS1 Phase 2 — Gemini Moment-Path Integration (Option A, honest gate)

**Branch:** `ws1/phase2-gemini-moments` (based on `main` @ Phase 1 merge `3c523f5`).

**Behavior change at default flag (`analysis_provider=openai`): NONE.** All new logic is
gated on the gemini provider. The OpenAI moment path, the quality gate, and every threshold
are untouched. Flipping `analysis_provider=gemini` now yields element scores **and an honest
moment gate** — the Phase-1 documented limitation is resolved. Still gated OFF in prod pending
Phase 4 validation; the first real end-to-end call remains a separate observed step.

---

## The honest gate (the core proof)

`teacher_feedback_allowed` flips true only on REAL signals. Each derived moment's
`supporting_features` are a blend of two genuine Gemini signals — the element's own
`confidence` and the `specificity_score` of its evidence summary (the SAME function the gate
trusts) — never hardcoded. `compute_moment_quality`, `compute_assessment_quality`, and all
thresholds in `lesson_moment_quality.py` are **unchanged**.

| | `test_honest_pass` | `test_honest_fail` |
|---|---|---|
| Input | 3 specific, confident (74–82) evidence segments | 2 vague, low-confidence (20) one-liners ("Good lesson.") |
| Derived features | well above the 0.05 near-zero threshold | low (`raw_selection_score` < 0.2) |
| Per-moment confidence | ≥ 0.35 | **0.093** (< 0.35) |
| Moments kept | 3 (pass `validate_moment`) | 2 (kept, evaluated by the gate — not dropped) |
| `usable_moment_count` | 3 | **0** |
| `teacher_feedback_allowed` | **True** | **False** |

Both tests import and run the REAL gate (never mocked). **The honest-fail test passing is the
evidence we did not cheat the gate** — if the mapping ever became a rubber stamp, weak evidence
would wrongly pass and that test would fail. Blank/empty evidence yields all-near-zero features
that fail `validate_moment` and are dropped; if nothing usable survives, derivation raises
`AnalysisContractError(fallback_gemini_no_moments)` and the dispatch falls through to OpenAI —
**OpenCV moments are never attached to a Gemini-labeled assessment.**

`selection_reason = "gemini_grounded"` is truthful and deliberately NOT in
`LOW_SIGNAL_SELECTION_REASONS`, but the label never passes the gate alone — confidence is still
computed from the features. (`representative_frame_sec` is set to each moment's window midpoint:
the model analyzed the *continuous* native video, so a timestamp inside its own cited evidence
window is genuinely grounded — and this never rescues weak evidence, which still fails on
confidence.)

---

## What shipped

### New pure module — `backend/app/analysis/gemini_moments.py` (WS3-safe)
- `derive_moments_from_payload(payload, *, duration_sec, available_frames, elements_to_analyze, max_moments, normalize_fn, dedupe_fn)` — one moment per evidence segment, honest features, normalized + deduped with the gate's own helpers.
- `_derive_supporting_features(element_confidence, segment_summary)` — documented honest mapping (blends of `conf01` and `specificity`).
- `build_gemini_moment_manifest(...)` — same manifest shape as `build_moment_manifest` (`strategy_version="gemini_grounded_v1"`), attaches `quality=compute_quality_fn(...)` per moment, drops+logs any failing `validate_moment`, raises `AnalysisContractError(fallback_gemini_no_moments)` if none survive.
- Pure: no I/O/network/DB, no module-global mutable state. Reuses `specificity_score`, `normalize_lesson_moment_window`, `dedupe_lesson_moments`, `compute_moment_quality` from `lesson_moment_quality` (imported, not reinvented — asserted by `test_reuses_gate_helpers_from_lesson_moment_quality`); `compute_quality_fn`/`normalize_fn`/`dedupe_fn` are injectable.

### Taxonomy — `backend/app/analysis/failures.py`
Added `ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS = "fallback_gemini_no_moments"` to `FALLBACK_MODES` + meanings + `__all__`.

### Wiring (Option A, analysis-first) — `backend/server.py`, gemini provider only
- Pre-analysis: provider-aware moment build. Gemini → `_empty_gemini_pending_manifest` (OpenCV bypassed; keeps `attach_moment_metadata_to_frames` / `build_multimodal_analysis_payload` no-ops). OpenAI → `build_moment_manifest` unchanged.
- The gemini branch in `analyze_frames_with_ai` derives the grounded manifest from the RAW payload (faithful, pre-tone), attaches it as `_gemini_moment_manifest`, and returns. A derivation failure raises `AnalysisError` → caught → falls through to OpenAI (same mechanism as a Phase-1 engine failure).
- Post-analysis: the outer pipeline pops `_gemini_moment_manifest`, sets `moment_manifest = it`, and persists it — so the UNCHANGED `compute_assessment_quality(moments=moment_manifest.get("moments"))` runs on the gemini moments. On gemini fall-through, it rebuilds the OpenCV manifest so the OpenAI-fallback assessment still has real moments.
- Persisted to `db.video_analysis_moments` with `strategy_version="gemini_grounded_v1"`; the video's `moment_sampling_version` reflects it.

### Design choice: 3b-ii (with unified downstream tail)
Chosen over 3b-i (removing the gemini early-return entirely) because: (1) the typed-failure
fall-through must live inside `analyze_frames_with_ai` where the OpenAI fallback path is, so
deriving moments there lets "no usable evidence" fall through cleanly; (2) smaller, clearer
diff — the branch already returned the orchestrated bundle, so attaching the manifest + popping
it in the outer pipeline is minimal; (3) the outer pipeline's existing
`compute_assessment_quality` tail is reused unchanged for both providers.

---

## AUDIT REPORT — hard gate (all GREEN)

| Gate | Command | Result |
|---|---|---|
| 1 | `python -c "import app.analysis.gemini_moments"` | `imports OK` |
| 2 | `python -c "import server"` | `SERVER IMPORT OK` |
| 3 | `pytest tests/test_gemini_moments_phase2.py -v` | **11 passed** |
| 4 | `pytest tests/test_gemini_engine_phase1.py tests/test_analysis_contracts_phase0.py -q` | **51 passed** (prior phases green) |
| 5 | `pytest -q` (full suite) | **842 passed**, 0 failed (831 + 11; no regressions) |
| 6 | lint/format | no repo lint config; `py_compile OK` on all changed files |
| 7 | dataflow grep | see below |
| 8 | honest-gate 4b/4c contrast | `test_honest_pass PASSED` + `test_honest_fail PASSED` |

### Gate 7 — dataflow proof (server.py)
```
29488  phase2_provider_is_gemini = (APP_SETTINGS.ai.analysis_provider == "gemini" ...)
29492  if phase2_provider_is_gemini:
29493      moment_manifest = _empty_gemini_pending_manifest(video_id)   # OpenCV bypassed for gemini
       else: moment_manifest = build_moment_manifest(...)              # OpenAI unchanged
29557  _gemini_moment_manifest = analysis_payload.pop("_gemini_moment_manifest", None)
29562  if _gemini_moment_manifest is not None:
29563      moment_manifest = _gemini_moment_manifest                    # gemini moments adopted
29569  elif phase2_provider_is_gemini and not moment_manifest.get("moments"):
           moment_manifest = build_moment_manifest(...)                 # fall-through rebuild
29656  compute_assessment_quality(moments=moment_manifest.get("moments") or [], ...)
30979  gemini_moment_manifest = build_gemini_moment_manifest(...)        # built in gemini branch
31005  result["_gemini_moment_manifest"] = gemini_moment_manifest       # handed up
```
With `analysis_provider == "openai"`: the `else` builds the OpenCV manifest as before, the
post-analysis `if`/`elif` are both skipped (no `_gemini_moment_manifest`; `phase2_provider_is_gemini`
is False), and the gemini branch in `analyze_frames_with_ai` is never entered. `git diff main`
touches only `server.py` and `failures.py` (additive); the 842-passing suite confirms OpenAI
behavior is unchanged.

---

## Definition of Done
- [x] `gemini_moments.py` pure, WS3-safe, `validate_moment`-compliant, reuses gate helpers
- [x] honest feature mapping documented; the 4c FAIL test proves it is not a rubber stamp
- [x] Option A analysis-first wired for gemini only; OpenAI path unchanged (test + grep + full suite)
- [x] `compute_assessment_quality` receives gemini moments when provider==gemini (data flow verified, line 29656)
- [x] gate code + thresholds untouched (`lesson_moment_quality.py` not modified)
- [x] gemini manifest persisted with `strategy_version="gemini_grounded_v1"`
- [x] typed failure + OpenAI fall-through on no usable evidence; never OpenCV moments on a gemini label
- [x] all tests green incl. honest-pass + honest-fail; prior phases green (51); full suite green (842)
- [ ] branch pushed, PR opened with audit + design note, CI reported, NOT merged — *below*
