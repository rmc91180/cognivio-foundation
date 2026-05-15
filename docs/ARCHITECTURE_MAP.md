# Architecture Map

This document describes the current active Cognivio architecture after the repository and backend refactor sprints.

## Runtime Services

- Frontend service: `cognivio-frontend`
- Backend API service: `cognivio-teacher-assessment`
- Database: MongoDB

## Repository Layout

- Active backend: [backend](C:/Projects/Cognivio/backend)
- Active frontend: [frontend](C:/Projects/Cognivio/frontend)
- Active docs: [docs](C:/Projects/Cognivio/docs)
- Active scripts: [scripts](C:/Projects/Cognivio/scripts)
- Archived legacy stacks: [archive](C:/Projects/Cognivio/archive)

## Backend Structure

### Entry / App

- App entry: [main.py](C:/Projects/Cognivio/backend/app/main.py)
- Legacy bridged app: [server.py](C:/Projects/Cognivio/backend/server.py)
- Config: [config.py](C:/Projects/Cognivio/backend/app/config.py)
- DB helpers: [db.py](C:/Projects/Cognivio/backend/app/db.py)
- Shared auth dependencies: [dependencies.py](C:/Projects/Cognivio/backend/app/dependencies.py)

### Routers

- Auth: [auth.py](C:/Projects/Cognivio/backend/app/routers/auth.py)
- Teachers: [teachers.py](C:/Projects/Cognivio/backend/app/routers/teachers.py)
- Videos: [videos.py](C:/Projects/Cognivio/backend/app/routers/videos.py)
- Assessments: [assessments.py](C:/Projects/Cognivio/backend/app/routers/assessments.py)
- Privacy: [privacy.py](C:/Projects/Cognivio/backend/app/routers/privacy.py)
- Recognition: [recognition.py](C:/Projects/Cognivio/backend/app/routers/recognition.py)
- Exemplars / share: [exemplars.py](C:/Projects/Cognivio/backend/app/routers/exemplars.py)

### Services

- Auth: [auth_service.py](C:/Projects/Cognivio/backend/app/services/auth_service.py)
- Teachers: [teacher_service.py](C:/Projects/Cognivio/backend/app/services/teacher_service.py)
- Videos: [video_service.py](C:/Projects/Cognivio/backend/app/services/video_service.py)
- Assessments: [assessment_service.py](C:/Projects/Cognivio/backend/app/services/assessment_service.py)
- Privacy: [privacy_service.py](C:/Projects/Cognivio/backend/app/services/privacy_service.py)
- Recognition: [recognition_service.py](C:/Projects/Cognivio/backend/app/services/recognition_service.py)
- Exemplars: [exemplar_service.py](C:/Projects/Cognivio/backend/app/services/exemplar_service.py)
- Localization: [localization_service.py](C:/Projects/Cognivio/backend/app/services/localization_service.py)
- Reports: [report_service.py](C:/Projects/Cognivio/backend/app/services/report_service.py)

### Repositories

- Teachers: [teacher_repository.py](C:/Projects/Cognivio/backend/app/repositories/teacher_repository.py)
- Videos: [video_repository.py](C:/Projects/Cognivio/backend/app/repositories/video_repository.py)
- Assessments: [assessment_repository.py](C:/Projects/Cognivio/backend/app/repositories/assessment_repository.py)
- Recognition: [recognition_repository.py](C:/Projects/Cognivio/backend/app/repositories/recognition_repository.py)

### Analysis

- Orchestrator: [analysis_orchestrator.py](C:/Projects/Cognivio/backend/app/analysis/analysis_orchestrator.py)
- Audio wrapper: [audio_pipeline.py](C:/Projects/Cognivio/backend/app/analysis/audio_pipeline.py)
- Frame selection wrapper: [frame_selection.py](C:/Projects/Cognivio/backend/app/analysis/frame_selection.py)
- Moment sampling wrapper: [moment_sampler.py](C:/Projects/Cognivio/backend/app/analysis/moment_sampler.py)
- Multimodal wrapper: [multimodal_analysis.py](C:/Projects/Cognivio/backend/app/analysis/multimodal_analysis.py)
- OpenAI analysis client: [openai_analysis.py](C:/Projects/Cognivio/backend/app/analysis/model_clients/openai_analysis.py)
- Transcription client: [transcription.py](C:/Projects/Cognivio/backend/app/analysis/model_clients/transcription.py)

### Workers

- Video processing: [video_worker.py](C:/Projects/Cognivio/backend/app/workers/video_worker.py)
- Privacy processing: [privacy_worker.py](C:/Projects/Cognivio/backend/app/workers/privacy_worker.py)
- Maintenance / retention: [maintenance_worker.py](C:/Projects/Cognivio/backend/app/workers/maintenance_worker.py)

### Observability

- Metrics + structured logs: [observability.py](C:/Projects/Cognivio/backend/app/observability.py)
- Admin ops endpoints: [server.py](C:/Projects/Cognivio/backend/server.py)

## Analysis Flow

1. Upload arrives through the videos domain.
2. Raw video is stored locally and optionally in S3.
3. Privacy job is queued.
4. Privacy worker redacts and writes derivative assets.
5. Analysis job is queued after privacy completion.
6. Smart frame selection and moment sampling prepare visual evidence.
7. Optional audio extraction/transcription/feature generation builds multimodal context.
8. OpenAI analysis path or fallback path returns normalized scoring output.
9. Observation-first summary packet is generated and persisted.
10. Recognition and exemplar state sync can follow completed analysis.

## Frontend Structure

### Shared

- Runtime API client: [apiClient.js](C:/Projects/Cognivio/frontend/src/lib/apiClient.js)
- Compatibility API facade: [api.js](C:/Projects/Cognivio/frontend/src/lib/api.js)

### Feature folders

- Videos: [frontend/src/features/videos](C:/Projects/Cognivio/frontend/src/features/videos)
- Teachers: [frontend/src/features/teachers](C:/Projects/Cognivio/frontend/src/features/teachers)
- School setup: [frontend/src/features/school-setup](C:/Projects/Cognivio/frontend/src/features/school-setup)
- Recognition: [frontend/src/features/recognition](C:/Projects/Cognivio/frontend/src/features/recognition)
- Assessments: [frontend/src/features/assessments](C:/Projects/Cognivio/frontend/src/features/assessments)

## Current Transitional Note

The app still runs through the bridged legacy backend object in [server.py](C:/Projects/Cognivio/backend/server.py). The refactor work has extracted the canonical domain modules, but final mounted-router/runtime cutover is still a later phase.

## Bridge Rules

- [server.py](C:/Projects/Cognivio/backend/server.py) remains the runtime legacy app bridge and owns the mounted `/api` router in production.
- [app/main.py](C:/Projects/Cognivio/backend/app/main.py) attaches settings, metrics, observability, worker registry metadata, and safe extracted-router registry metadata to the legacy app.
- Extracted routers listed in [app/routers/\_\_init\_\_.py](C:/Projects/Cognivio/backend/app/routers/__init__.py) are intentionally marked `extracted_unmounted` unless a route has a migration plan.
- Do not add the same active route to both `server.py` and `app/routers/*` without documenting shadowing, expected precedence, and rollback.
- Dynamic route mounting must be idempotent. Repeated imports or repeated `create_app()` calls must not duplicate runtime routes.
- Final router cutover is future work and should be handled as a dedicated migration PR, not mixed into foundation stabilization.
