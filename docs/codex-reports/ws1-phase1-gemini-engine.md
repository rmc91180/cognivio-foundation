# WS1 Phase 1 — Gemini Native-Video Analysis Engine (behind dormant flag, mocked tests)

**Branch:** `ws1/phase1-gemini-engine` (based on `main` @ Phase 0 merge `0b5e6ec`).

**Behavior change at the default flag (`analysis_provider=openai`): NONE.** The Gemini
path is **dormant in production**. Moment-path integration is deferred to Phase 2; with the
flag ON, the moment gate is **not yet Gemini-fed** (documented limitation below). All tests
use a **mocked** Gemini client — there are **no live Gemini calls** in the suite.

---

## Resolved Gemini model id (Step 1)

`GEMINI_API_KEY` was not available in this build environment, so the live model listing
could not be run here. The dev-only script `backend/scripts/resolve_gemini_model.py`
(run manually with a key) lists the account's `/flash/` models so the human can copy the
exact id into `GEMINI_MODEL` (Railway).

**Candidates to verify in Google AI Studio** (the engine never hardcodes an id — it reads
`settings.ai.gemini_model`):

```
gemini-3.5-flash
models/gemini-3.5-flash
gemini-flash-latest
gemini-2.5-flash
models/gemini-2.5-flash
```

`google-genai==1.59.0` is already pinned in `requirements.txt`, `requirements-prod.txt`,
and `requirements-dev.txt` (added earlier in the repo) and installs cleanly — **no
dependency change was required** this phase. `pip check` is green.

---

## What shipped

### New engine — `backend/app/analysis/gemini_engine.py`
`async def analyze_video_with_gemini(*, video_path_or_bytes, elements_to_analyze,
focus_instruction, language, settings, client=None) -> dict`

- Returns the **exact frozen payload contract** (summary / recommendations / element_scores)
  — the same shape `_analyze_frames_with_openai` returns. It does **not** normalize and does
  **not** build moments (Phase 2).
- **Client-injection seam:** `client` defaults to `None`; the real `google-genai` client is
  built **lazily** (`from google import genai` inside `_build_real_client`) only when no
  client is injected. Tests always inject a fake, so the SDK is never built and no network
  I/O happens.
- **Single source of truth for the JSON shape:** the prompt lifts
  `ANALYSIS_PAYLOAD_JSON_SHAPE` from `contracts.py` (added this phase) and injects the exact
  allowed element-id list; the model is told to use only those ids.
- **Determinism:** `GEMINI_GENERATION_CONFIG = {temperature: 0.0, top_p: 1.0,
  response_mime_type: "application/json", max_output_tokens: 4000}`.
- **Inline input only** (`gemini_video_input_mode="inline"`, < 100 MB). `file_api` is a
  clearly-marked NotImplemented stub that raises a typed `AnalysisProviderError`.

### Typed failure mapping (each DISTINCT, from `failures.py` — never silent)
| Cause | Exception | analysis_mode |
|---|---|---|
| model id / api key empty, video missing/oversized, `file_api` stub | `AnalysisProviderError` | `fallback_model_unconfigured` |
| JSON parse failure / empty output | `AnalysisParseError` | `fallback_gemini_parse_error` |
| timeout | `AnalysisProviderError` | `fallback_gemini_timeout` |
| rate-limit / 429 / resource_exhausted | `AnalysisProviderError` | `fallback_gemini_rate_limited` |
| contract: empty element_scores | `AnalysisContractError` | `fallback_empty_element_scores` |
| contract: all element_ids unknown (all dropped) | `AnalysisContractError` | `fallback_all_elements_dropped` |
| contract: other (missing summary, bad segments) | `AnalysisContractError` | `fallback_gemini_parse_error` |

The contract branch runs `validate_payload(payload, [e["id"] for e in elements_to_analyze])`
and branches on its error codes. No new mode strings are invented — only `failures.py`
constants are used.

### Dormant dispatch branch — `backend/server.py`
Added BEFORE the existing OpenAI `if`, gated on
`APP_SETTINGS.ai.analysis_provider == "gemini" and APP_SETTINGS.ai.gemini_api_key`:
- on success → `_normalize_model_analysis(..., analysis_mode=ANALYSIS_MODE_GEMINI_MULTIMODAL)`
  → the **same** normalizer + `orchestrate_specialists` already there.
- on any `AnalysisError` → logs LOUD with the typed mode and **falls through** to the existing
  OpenAI / heuristic path (never serves mock as success). If the run ultimately reaches the
  heuristic fallback, the recorded `fallback_mode` is set to the engine's typed mode.
- a new optional `video_source_path` param threads the source video to the engine; it is a
  **no-op for the OpenAI path**. The single call site passes `file_path`.
- `gemini_fallback_mode` stays `None` whenever `analysis_provider=="openai"`, so the entire
  default path (the OpenAI `if`, the `elif` fallback chain, and the recorded `fallback_mode`)
  is **byte-for-byte unchanged**.

### Dev script — `backend/scripts/resolve_gemini_model.py`
Standalone, manual-run only. NOT imported by the engine; NOT part of any test.

---

## AUDIT REPORT — hard gate (all GREEN)

### Gate 1 — `python -c "import app.analysis.gemini_engine"`
```
OK gemini_engine
```

### Gate 2 — `python -c "import server"` (monolith still imports)
```
Cognivio settings loaded (environment=development, ...)
SERVER IMPORT OK
```

### Gate 3 — `pytest tests/test_gemini_engine_phase1.py -v`
```
20 passed, 3 warnings in 3.50s
```
Covers: good payload + contract pass; low-temp/single-call; allowed-id prompt injection;
markdown-fence tolerance; every failure mode (parse / empty / all-dropped / other-contract /
timeout / rate-limit×2 / unconfigured×2 / file_api / missing-source); dormancy (provider==openai
→ engine NOT invoked, OpenAI path taken); gate-on (provider==gemini → engine invoked,
`analysis_mode == gemini_multimodal`, source threaded); gemini-failure fall-through to OpenAI;
static no-module-level-google-import guard.

### Gate 4 — `pytest tests/test_analysis_contracts_phase0.py -q` (Phase 0 still green)
```
31 passed, 3 warnings in 2.39s
```
The normalizer regression golden still matches → the dispatch edits did not change OpenAI
analysis behavior.

### Gate 5 — full suite `pytest -q`
```
831 passed, 3 warnings in 83.20s (0:01:23)
```
811 (Phase 0 baseline) + 20 new = 831. **Zero failures; no regressions; no pre-existing
failures to attribute.**

### Gate 6 — lint/format
No lint config exists in the repo (`ruff`/`black`/`flake8`/`pyproject`/`setup.cfg` — none
present). Ran `python -m py_compile` on all created/modified files:
```
py_compile OK (no lint config in repo)
```

### Gate 7 — dormancy grep (server.py)
```
30899:    gemini_fallback_mode: Optional[str] = None
30900:    if APP_SETTINGS.ai.analysis_provider == "gemini" and APP_SETTINGS.ai.gemini_api_key:
30931:            gemini_fallback_mode = exc.analysis_mode
30938:    if OPENAI_API_KEY and AsyncOpenAI is not None and paid_analysis_allowed:
30991:    if gemini_fallback_mode:
30992:        fallback_mode = gemini_fallback_mode
```
The Gemini branch (30900) is guarded by `analysis_provider == "gemini"`. With the default
flag it is skipped and the unconditional OpenAI branch (30938) is reached. `git diff main --
server.py` is entirely additive (the only "deletion" is the one-line docstring expanded to
multi-line).

### Gate 8 — dependency check
```
pip check: No broken requirements found.
google-genai==1.59.0 (already pinned in all three requirements files)
```

---

## How to do the first real call (NON-prod only)
1. In a non-production environment, set `GEMINI_API_KEY` and run
   `python backend/scripts/resolve_gemini_model.py` to get the exact `/flash/` id.
2. Set `GEMINI_MODEL=<that id>` and `GEMINI_API_KEY=<key>`.
3. Set `ANALYSIS_PROVIDER=gemini` **in that non-prod context only** and analyze one clip.
   Do NOT flip `ANALYSIS_PROVIDER` in production this phase.

## Phase 2 limitation (documented)
With the flag ON, moments are still produced by the upstream OpenCV `score_windows` path —
the moment-quality gate is **not yet Gemini-fed**. A `TODO(WS1 Phase 2)` is marked at the
moment-build site and at the dispatch branch. This is safe because the flag is OFF in
production this phase.

## Definition of Done
- [x] `google-genai` dependency present + installs; `pip check` green
- [x] `resolve_gemini_model.py` exists; model id candidates documented (key unavailable here)
- [x] `gemini_engine.py` returns the frozen payload contract; pure; client-injection seam
- [x] every failure maps to a distinct typed `AnalysisError` + `failures.py` mode constant
- [x] dispatch branch dormant at default flag; OpenAI path unchanged (proven by test + grep)
- [x] all new tests pass (20); Phase 0 tests still pass (31); full suite green (831; none pre-existing)
- [x] `server.py` imports; no live Gemini network in tests (static guard + injected fakes)
- [x] Phase 2 moment-integration TODO marked; limitation documented
- [ ] branch pushed, PR opened with audit + model id + limitation note, CI reported, NOT merged — *in progress below*
