# WS1 Phase 0 — Gemini Analysis Contract & Guardrail Foundation

**Branch:** `ws1/phase0-gemini-contracts` (based on `main` @ `b71a9e7`).
**Behavior change: NONE. Default provider remains `openai`.**

This phase ships the frozen contracts, failure taxonomy, provider config surface,
validators, and tests that future phases will build on. It wires **nothing** into
the live analysis dispatch (`server.py::analyze_frames_with_ai`, the ~30819–30960
region). No Gemini SDK is called; no threshold, gate, or behavior is loosened.

---

## What shipped

### New pure modules (DB-free, network-free, import-safe)
- **`backend/app/analysis/contracts.py`** — single source of truth for:
  - `ANALYSIS_PAYLOAD_CONTRACT` — the raw payload shape produced by
    `_analyze_frames_with_openai` and consumed by `_normalize_model_analysis`
    (summary, recommendations[], element_scores[] with nested evidence_segments[]),
    including the `element_scores[].element_id ∈ elements_to_analyze[].id` invariant.
  - `MOMENT_CONTRACT` — the moment shape `compute_moment_quality` reads, including
    the `supporting_features` gate keys and the near-zero (`<= 0.05`) condition that
    distinguishes a real moment from a timeline fallback.
  - `validate_payload(payload, allowed_element_ids) -> ValidationResult` and
    `validate_moment(moment) -> ValidationResult` — pure, never-raising validators
    returning structured `{ok, errors[]}`. They catch: missing/empty element_scores,
    element_ids outside the allowed set, missing summary, malformed evidence_segments,
    non-numeric/negative timestamps, and fallback-shaped (all-near-zero) moments.
- **`backend/app/analysis/failures.py`** — the analysis-mode taxonomy and the typed
  exception hierarchy (`AnalysisError` → `AnalysisParseError`, `AnalysisContractError`,
  `AnalysisProviderError`). **Defined, not raised** in the live path this phase.
  `is_fallback_mode` / `is_success_mode` / `is_terminal_mode` / `describe_mode` helpers.

### Taxonomy reconciliation (no renames)
The existing `server.py` literals are **reused verbatim** — renaming any would orphan
persisted assessment documents (a behavior change):

| Category | Modes |
|---|---|
| Success | `openai`, `openai_multimodal`, **`gemini`**, **`gemini_multimodal`** (gemini_* are new/reserved) |
| Fallback (existing in server.py) | `fallback`, `fallback_model_error`, `fallback_paid_analysis_disabled`, `fallback_paid_analysis_not_allowed`, `fallback_model_unconfigured` |
| Fallback (reserved, not yet emitted) | `fallback_parse_error`, `fallback_empty_element_scores`, `fallback_all_elements_dropped`, `fallback_gemini_parse_error`, `fallback_gemini_timeout`, `fallback_gemini_rate_limited` |
| Terminal / pre-run | `unknown`, `empty_selection`, `failed_before_completion` |

> Note: `fallback_paid_analysis_disabled` is present in `server.py` today and is
> preserved even though it was not in the task's suggested list — reconciliation
> means keeping what the code already emits.

### Provider config surface (`backend/app/config.py`, `AISettings`)
Added, mirroring the existing `os.getenv` pattern, with defaults that change nothing:
- `analysis_provider` ← `ANALYSIS_PROVIDER` (default **`"openai"`**)
- `gemini_api_key` ← `GEMINI_API_KEY` (default `""`)
- `gemini_model` ← `GEMINI_MODEL` (default `""`)
- `gemini_video_input_mode` ← `GEMINI_VIDEO_INPUT_MODE` (default `"inline"`)

Nothing in the live path reads these yet (proven by the dispatch-region grep below).

### Tests
- **`backend/tests/test_analysis_contracts_phase0.py`** — 31 tests:
  validators positive/negative, taxonomy + no-rename grep guard, exception hierarchy,
  config defaults/env-loading, the normalizer regression golden, and the import-safety
  static checks.
- **`backend/tests/fixtures/normalizer_golden_phase0.json`** — golden output of
  `_normalize_model_analysis` captured from current code; the regression test asserts
  byte-for-byte equality, proving Phase 0 changed no analysis behavior.

---

## AUDIT REPORT — hard gate (all GREEN)

### Gate 1 — `python -c "import app.analysis.contracts"`
```
OK app.analysis.contracts
```

### Gate 2 — `python -c "import server"` (monolith still imports)
```
Cognivio settings loaded (environment=development, db_name=test_database, ...)
OK server
```

### Gate 3 — `python -m pytest tests/test_analysis_contracts_phase0.py -v`
```
collected 31 items
...
======================= 31 passed, 3 warnings in 3.00s ========================
```
(3 warnings are pre-existing dependency deprecations: starlette multipart, reportlab ast.)

### Gate 4 — full existing suite `python -m pytest -q`
```
811 passed, 3 warnings in 78.48s (0:01:18)
```
780 pre-existing + 31 new = 811. **Zero failures; nothing broken.** No pre-existing
failures needed to be excluded.

### Gate 5 — lint/format
No lint/format config exists in the repo (`ruff.toml`, `.flake8`, `setup.cfg`,
`pyproject.toml`, `tox.ini` — none present in `backend/` or repo root). Ran
`python -m py_compile` on all created/modified files instead:
```
py_compile OK (no lint config present in repo)
```

### Gate 6 — dispatch-path reference grep (proof of no live wiring)
Whole-file grep of `server.py` for gemini/provider/new-module references:
```
>>> ZERO matches in server.py (no references anywhere)
```
Dispatch region (lines 30819–30960):
```
14:    from app.analysis.specialist_orchestrator import orchestrate_specialists
```
The single hit is the **pre-existing** `specialist_orchestrator` import (unrelated to
the new `contracts`/`failures` modules or gemini config). `git diff --stat main --
server.py` is **empty** — `server.py` is byte-for-byte unchanged on this branch.

---

## Definition of Done

- [x] `contracts.py` exists, pure, import-safe, validators implemented
- [x] Failure taxonomy complete, reconciled with existing `server.py` fallback strings, no renames
- [x] Config fields added, default provider == `openai`, nothing reads them in the live path
- [x] All new tests pass (31/31)
- [x] Full existing suite passes (811 passed; no pre-existing failures to attribute)
- [x] `server.py` still imports; no dispatch-path references to new code (server.py unchanged)
- [x] Normalizer regression golden proves zero behavior change
- [x] Branch pushed, PR opened with this audit report, CI status reported, **NOT merged**

## Not done (scope guardrails honored)
No runtime dispatch change; no Gemini/SDK calls; no threshold or gate loosened; no
existing fallback literal renamed; `server.py` not split and not modified; no production
data touched; no tests weakened.
