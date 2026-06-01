# WS1 Phase 3 — Gemini Engine Robustness & Determinism

**Branch:** `ws1/phase3-gemini-robustness` (based on `main` @ Phase 2 merge `eac3de4`).

**Behavior change at default flag (`analysis_provider=openai`): NONE.** `server.py` is
untouched this phase (`git diff main -- server.py` is empty); the analysis logic, moment
derivation, the quality gate, and every threshold are unchanged. All changes are inside the
Gemini engine internals and the failure taxonomy.

---

## What shipped (gemini path only)

### Determinism lock (Step 2)
`GEMINI_GENERATION_CONFIG` keeps `temperature=0.0` (greedy) + `response_mime_type=
"application/json"` with a comment marking these as the determinism guarantees.
**Step-2b schema decision: DEFERRED** (documented TODO in code). The installed
`google-genai` SDK *does* expose a `response_schema` config field, but the allowed
element-id set varies per call (a locked schema would need per-call enum construction +
SDK-type coupling), and the json-mime + `_enforce_contract` (`validate_payload`) path
already rejects malformed/contract-violating output with distinct typed modes. Enforcing a
nested per-call schema is deferred until the Flash model's adherence is confirmed against a
live call — not guessed here.

### Auto size-based input selection (Step 3) — 20 MB threshold
`FILE_API_THRESHOLD_BYTES = 20 MB` (conservative margin under the 100 MB inline cap given
~33% base64 inflation). `_select_input_mode(config_mode, size_bytes)`:
- explicit config `file_api` → always File API;
- size unknown → inline (the coercer still guards the hard cap);
- **size ≥ 20 MB → File API** (an explicit `inline` is auto-upgraded here, never silently
  exceeding the inline cap);
- else → inline.

Size is probed cheaply (`os.path.getsize` for a path — no full read; `len` for bytes).
**Consequence: the ~27 MB demo clip rides the File API path**, validating the production
path in the demo. The NotImplemented `file_api` stub is removed.

### Real File API path (Step 4)
- `_upload_video_file(client, path_or_bytes, mime_type)` → `client.aio.files.upload(file=…, config={"mime_type": …})` (bytes wrapped in `io.BytesIO`).
- `_await_file_active(client, file_ref, timeout_s=120, poll_interval_s=2)` → polls `client.aio.files.get(name=…)` until `FileState.ACTIVE`; raises typed `fallback_gemini_upload_error` on `FAILED`, typed `fallback_gemini_timeout` if not ACTIVE within the bound. Elapsed is tracked by poll interval (deterministic, never hangs).
- `_generate_content_file_api(client, model, prompt, file_ref)` → mirrors the inline wrapper but the video part is `{"file_data": {"file_uri": …, "mime_type": …}}`.
- Both inline and File API feed the SAME `_extract_json_object` + `_enforce_contract` tail.
- **Idempotent within a call:** the upload happens ONCE *before* the retry loop; the file
  handle is reused across generate retries (proven: `upload_calls == 1`, generate `== 2`).

### Bounded retry with jittered backoff (Step 5)
`GEMINI_MAX_ATTEMPTS = 3` (1 + 2 retries). `_generate_with_retry` wraps **only** the
model-generate step (not upload, not parsing). Retries **only** on the TRANSIENT typed modes
`fallback_gemini_timeout` / `fallback_gemini_rate_limited`; **no retry** on parse/contract/
unconfigured (deterministic). Full-jitter backoff `random.uniform(0, min(8, 1·2^(n-1)))`;
each attempt logged at WARNING, exhaustion at ERROR. On exhaustion it raises the LAST typed
error (preserving its mode) → the server dispatch falls through to OpenAI unchanged.
**Worst-case added backoff latency ≈ 3.0 s** (jittered: attempt-1 cap 1 s + attempt-2 cap
2 s, before the 3rd attempt). **File API activation poll timeout: 120 s** (2 s interval).

### Token / cost logging (Step 6)
One structured INFO line per successful analysis — `gemini_analysis_usage model=… input_mode=…
video_bytes=… prompt_tokens=… output_tokens=… total_tokens=…` — read from
`response.usage_metadata` (`prompt_token_count` / `candidates_token_count` /
`total_token_count`). When usage metadata is absent it logs `usage=unavailable` and still
returns the payload. No dollar cost computed (rates change), no PII, no transcript text. The
return contract is unchanged (logging is a side effect).

### New failure mode
`ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR = "fallback_gemini_upload_error"` added to
`failures.py` (FALLBACK_MODES + meanings + `__all__`); `is_fallback_mode` True.

### SDK method names used (verified against installed `google-genai==1.59.0`)
- upload: `client.aio.files.upload(file=str|PathLike|IOBase, config=UploadFileConfigDict)` → `types.File{name, uri, state, mime_type}`
- state poll: `client.aio.files.get(name=…)`; `types.FileState` ∈ {ACTIVE, FAILED, PROCESSING, STATE_UNSPECIFIED}
- generate: `client.aio.models.generate_content(model, contents, config)`
- usage: `response.usage_metadata.{prompt_token_count, candidates_token_count, total_token_count}`

---

## AUDIT REPORT — hard gate (all GREEN)

| Gate | Command | Result |
|---|---|---|
| 1 | `import gemini_engine; failures; gemini_moments` | `imports OK` |
| 2 | `import server` | OK (untouched this phase) |
| 3 | `pytest tests/test_gemini_robustness_phase3.py -v` | **18 passed** |
| 4 | prior phases (phase2 + phase1 + phase0) | **62 passed** |
| 5 | `pytest -q` (full suite) | **860 passed**, 0 failed (842 + 18) |
| 6 | lint/format | no repo lint config; `py_compile OK` |
| 7 | proof greps | size selector (`_select_input_mode`, L135/L587), File API branch (L608), retry loop + transient guard (L475/L487/L625); `git diff main -- server.py` empty |

### Gate 7 — proof excerpts (gemini_engine.py)
```
66   FILE_API_THRESHOLD_BYTES = 20 * 1024 * 1024  # 20 MB
100  _TRANSIENT_MODES = frozenset({...TIMEOUT, ...RATE_LIMITED})
135  def _select_input_mode(config_mode, size_bytes) -> (mode, note)
475  async def _generate_with_retry(generate_call):
487      transient = mode in _TRANSIENT_MODES   # retry ONLY transient
587  effective_mode, mode_note = _select_input_mode(config_mode, size_bytes)
608  if effective_mode == "file_api":           # upload -> await active -> generate-by-ref
625  response = await _generate_with_retry(_do_generate)   # both modes share this + the parse/contract tail
```
The OpenAI dispatch path lives in `server.py`, which is unchanged; the inline generate
wrapper and the parse/contract tail are unchanged, so the inline path behaves exactly as in
Phases 1–2 (the 62 prior-phase tests + full suite confirm).

### Prior-phase test updated
`tests/test_gemini_engine_phase1.py::test_file_api_mode_raises_not_implemented` → renamed
`test_file_api_mode_without_file_support_raises_typed_upload_error`: the stub is gone, so
`file_api` now attempts an upload and (with a client lacking file support) fails with a typed
upload error and never reaches generate. Behavior intentionally replaced by Phase 3.

---

## Definition of Done
- [x] File API path implemented (upload + await-active + generate-by-ref); stub removed
- [x] Auto size selection at 20 MB; explicit `file_api` forces it; inline never exceeds the hard cap
- [x] Bounded retry 2/3, jittered bounded backoff, TRANSIENT modes only, no retry on parse/contract; exhaustion raises typed → OpenAI fall-through intact
- [x] Idempotent upload within a single invocation (upload once, reuse across generate retries)
- [x] Determinism: low temp + json mime locked; schema enforcement DEFERRED with documented reason
- [x] Token/cost log line on success; graceful when usage metadata absent; return contract unchanged
- [x] gate, gemini_moments derivation/features, contracts shapes ALL unchanged
- [x] openai path unchanged; dormant at default flag (`server.py` untouched; full suite green)
- [x] gemini_engine stays WS3-safe (pure, injectable client, no server/db imports, no module-global mutable state)
- [x] all tests green incl. prior phases + full suite (860); the ~27 MB demo clip rides the File API path
- [ ] branch pushed, PR opened with audit; NOT merged — *below*
