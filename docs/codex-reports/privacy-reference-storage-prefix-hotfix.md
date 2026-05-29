# PR C9.2.1 — Allow production privacy-profile storage keys for reference materialization

## Mission

C9.2 added authenticated object-storage materialization so the destructive blur
worker can pull teacher reference images that live only in R2/S3 into a per-job
temp directory. It shipped a defense-in-depth allow-list, but the allow-list was
keyed to the **wrong prefix**, so it rejected every real production reference
image and the worker still reported "no usable references."

This hotfix corrects the strict S3 key allow-list so valid production privacy
reference image keys under `uploads/privacy-profiles/` are accepted for
transient materialization, **while still rejecting arbitrary bucket reads**.

## Root cause

`backend/app/services/privacy_reference_materialization.py` hardcoded a single
prefix:

```python
STORAGE_PRIVACY_PREFIX = "uploads/privacy/"
...
return cleaned.startswith(STORAGE_PRIVACY_PREFIX)
```

But the upload path actually writes keys under `uploads/privacy-profiles/`:

```text
_save_privacy_reference_file(...)                       # server.py:5111
  → _upload_path_to_s3(file_path, "privacy-profiles", ...)   # server.py:5135
      → _build_s3_key("privacy-profiles", filename)          # server.py:3553
          → f"uploads/{category}/{uuid4()}_{safe_name}"
          → "uploads/privacy-profiles/<uuid>_<filename>"
```

`"uploads/privacy-profiles/x.jpg".startswith("uploads/privacy/")` is `False`
(the `/` in the prefix lands on the `-` of `privacy-profiles`), so production
keys such as

```text
uploads/privacy-profiles/292ca486-4464-4468-9d25-349642326a96_f06ee2e9-1391-48d7-91bd-ebab123a1fb6.jpeg
```

were rejected inside `_materialize_via_storage` with `reference_policy_blocked`,
which aggregated up to `no_usable_references`. The legacy `uploads/privacy/`
prefix was never actually produced by the upload helper.

## Prefix audit table

| Surface | Code path | Key shape | Materialization-readable? |
|---|---|---|---|
| Privacy reference upload (S3 write) | `_save_privacy_reference_file` → `_upload_path_to_s3(…, "privacy-profiles", …)` → `_build_s3_key` | `uploads/privacy-profiles/<uuid>_<file>` | **Yes (production)** — now accepted |
| Privacy reference local relative path | `_save_privacy_reference_file` | `privacy/profiles/{teacher}/{profile}/{file}` | Local file path only — not an `s3_key` |
| Legacy privacy prefix | (historical / back-compat rows) | `uploads/privacy/<…>` | Yes — retained for back-compat |
| Raw video | `_build_video_asset_s3_key("raw", …)` | `uploads/videos/raw/{teacher}/{file}` | No — rejected |
| Processed video | `_build_video_asset_s3_key("processed", …)` | `uploads/videos/processed/{teacher}/{file}` | No — rejected |
| Thumbnail | `_build_video_asset_s3_key("thumbnail", …)` | `uploads/videos/thumbnails/{teacher}/{file}` | No — rejected |
| Generic upload | `_build_s3_key(category, file)` | `uploads/{category}/<uuid>_<file>` | No — rejected unless category is a privacy prefix |

## Change

`is_safe_privacy_s3_key` now validates against an explicit allow-list and is
hardened against bypass attempts:

```python
STORAGE_PRIVACY_REFERENCE_PREFIXES = (
    "uploads/privacy-profiles/",   # production
    "uploads/privacy/",            # legacy / back-compat
)
```

Accepted:

- `uploads/privacy-profiles/<uuid>_<file>` (production)
- `uploads/privacy/<…>` (legacy)

Rejected (defense-in-depth):

- Other object families: `uploads/videos/raw/…`, `uploads/videos/processed/…`,
  `uploads/videos/thumbnails/…`, `redacted-videos/…`, `redacted-thumbnails/…`,
  arbitrary `uploads/<other>/…`, and the bare `uploads/` prefix.
- Prefix-confusion: `uploads/privacy-profiles-malicious/…`,
  `uploads/privacy_evil/…`, `uploads/privacyx/…`, `uploads/privacy` (no slash).
- Absolute / drive paths: leading `/` or `\`, UNC, `C:\…`, `C:/…`.
- URLs: `http://`, `https://`, `s3://`, anything containing `://`.
- Path traversal: any `..` segment (POSIX or Windows separators).
- Empty / whitespace / `None` / non-`str`.

The narrow allow-list is preserved: there is **no** general `uploads/` access, so
raw/processed/redacted videos, thumbnails, and arbitrary uploads can never be
pulled through the materialization path.

## What did NOT change (scope guard)

- URL fetch stays **off** by default (`PRIVACY_REFERENCE_URL_FETCH_ENABLED`
  remains `False`); no host allow-list changes.
- No biometric embeddings are computed or persisted.
- No changes to compression/transcode behavior.
- No changes to playback/analysis source selection.
- No raw video exposed to teachers; destructive blur is not bypassed.
- No production DB edits, no production data deletion.
- `server.py` was not split; no broad refactors.

## Tests

`backend/tests/test_privacy_reference_materialization.py`:

- `_production_shaped_reference` now uses the exact production key shape
  (`uploads/privacy-profiles/<uuid>_<uuid>.jpeg`).
- `TestSafeS3Key`: positive cases for production + legacy prefixes; negative
  cases for every rejection class above (videos, redacted assets, arbitrary
  uploads, bare `uploads/`, prefix-confusion, absolute/Windows paths, URLs,
  traversal, empty/None/non-str).
- `TestProductionPrivacyProfilesPrefixRegression`: documents the old
  single-prefix block, asserts the hardened validator accepts the production
  key, and proves a production-shaped batch now materializes with a mocked
  downloader and no `reference_policy_blocked` / `no_usable_references` codes.

Results:

- `pytest tests/test_privacy_reference_materialization.py tests/test_privacy_reference_usability.py` → 66 passed
- `pytest tests/ -q --timeout 180` → **590 passed**
- `npm run build` (frontend) → success

## Smoke / deploy verification

After deploy, confirm with the existing tooling (no code change required — they
read the corrected allow-list automatically):

```bash
# Dry-run materialization audit against the production fixture video/teacher.
cd backend
python scripts/audit_video_processing_pipeline.py --check-materialization

# Pilot smoke checks (includes reference materialization readiness).
python scripts/run_pilot_smoke_checks.py
```

Expected after deploy: the previously-failing teacher
(`d36bcacb-fb19-4d97-8753-f0944131505b`) and video
(`8c81ff86-c0b0-476e-ad5d-7220803577e9`) move from
`reference_policy_blocked` / `no_usable_references` to a materialized count
> 0, and a retry of the privacy job produces a destructively-blurred asset.

> Privacy is not "fixed" until this is deployed and the retry smoke produces a
> blurred output for the production fixture.
