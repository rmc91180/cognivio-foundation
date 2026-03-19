# Staging Validation Report

Date: 2026-03-18

## Result

Staging validation for the core product flow is now substantially complete.

The staged backend is deployed and healthy at `https://cognivio-staging.up.railway.app`.

The following end-to-end flow has been executed successfully against staging:

1. Demo admin login
2. Hebrew / RTL UI rendering
3. Teacher privacy profile check
4. Real video upload through the UI
5. Privacy processing
6. Analysis completion
7. Redacted thumbnail retrieval
8. Redacted playback retrieval
9. Video player rendering in Hebrew

## Executed Checks

### 1. Backend Automated Validation

Commands:

```bash
python -m pytest backend/tests/test_video_pipeline_helpers.py backend/tests/test_privacy_pipeline.py -q
python -m pytest backend/tests -q
python -m py_compile backend/server.py backend/privacy_pipeline.py
```

Result:

- Passed

### 2. Frontend Build Validation

Command:

```bash
npm run build:frontend:mvp
```

Result:

- Passed

### 3. Staging Backend Health

Validated endpoints:

1. `/health`
2. `/api/health`

Result:

- Passed
- Staging backend returned `200`

### 4. Hebrew / RTL Browser Validation

Validated against the staged backend using the localized frontend:

1. `/dashboard`
2. `/teachers`
3. `/videos`
4. `/school-setup`
5. `/master-schedule`
6. `/all-star-library`
7. `/privacy-review`
8. `/recognition-review`

Result:

- Passed
- `lang="he"` and `dir="rtl"` confirmed

### 5. Storage Retrieval Validation

Validated on staging:

1. Uploaded curriculum file retrieval
2. Redacted video asset retrieval
3. Redacted thumbnail retrieval

Result:

- Passed
- File retrieval returned `200`

### 6. End-to-End Upload / Playback Validation

Validated with a fresh staging upload:

- Video ID: `696cc10a-9140-4698-918f-b64cb9490aa1`
- Upload returned `status: queued`
- Final status reached:
  - `status: completed`
  - `privacy_status: completed`
  - `analysis_status: completed`
- Video player route rendered the uploaded lesson in Hebrew:
  - `/videos/696cc10a-9140-4698-918f-b64cb9490aa1`
- Redacted playback URL returned `200`
- Redacted thumbnail URL returned `200`
- Browser detected a rendered `<video>` element with the staged redacted asset URL

Evidence artifacts:

- `tmp/qa/staging-upload-playback-he-clean.png`
- `tmp/qa/staging-video-player-he-final.png`
- `tmp/qa/staging-dashboard-he.png`
- `tmp/qa/staging-teachers-he.png`
- `tmp/qa/staging-videos-he.png`

## Remaining Limitations

These are the important remaining caveats before production:

1. The successful staging media pass currently depends on `PRIVACY_ALLOW_DEGRADED_RUNTIME=true`.
2. That degraded mode is acceptable for staging validation, but it is not a production-grade privacy guarantee.
3. The Railway-hosted frontend service is still not the validated browser target; browser validation was run from a local frontend pointed at the live staged backend.
4. The recognition / exemplar workflow still has its own separate staging report in [STAGING_VALIDATION_RECOGNITION_LIBRARY_2026-03-18.md](./STAGING_VALIDATION_RECOGNITION_LIBRARY_2026-03-18.md).

## Validation Status By Area

### Core App Boot / Auth

- Passed in staging

### Hebrew / RTL Experience

- Passed in staging for core routes

### Storage / Static Asset Serving

- Passed in staging

### Privacy Pipeline

- Passed in staging for end-to-end upload-to-playback flow
- Currently validated under degraded runtime fallback

### Review / Operations Layer

- Route-level and UI validation passed
- Operational load testing not yet executed

### Recognition / Library

- See separate staging report

## Required Next Actions Before Production

1. Remove the need for degraded privacy runtime in the deployed environment.
2. Validate the privacy pipeline on production-like runtime dependencies, including real OpenCV support.
3. Finish a production-facing frontend hosting path instead of relying on the local frontend for staged browser checks.
4. Execute the production checklist in [PRODUCTION_PHASE_CHECKLIST.md](./PRODUCTION_PHASE_CHECKLIST.md).
5. Re-run a final privacy validation pass without degraded runtime enabled.

## Recommendation

Core staging validation now supports moving into production preparation, not production launch.

The platform is past “blocked in staging” and into “production hardening” territory.

Do not call privacy fully production-ready until the degraded runtime fallback is no longer required in the deployed environment.
