# Cognivio Architectural Audit

**Purpose:** structural map of the Cognivio backend + frontend to inform a strangler-pattern rebuild toward 3,000-user scale.
**Scope:** read-only. This document reports *what IS*, with `file:line` citations for every structural claim. Inferences are labeled `[INFERRED]`. Recommendations are confined to §9.
**Deploy truth:** the live ASGI app is `server:app` (`backend/server.py`), confirmed by `Dockerfile:42`, `railway.toml:17,21`. `CLAUDE.md` is stale (it describes server.py as "~1078 lines"; it is **33,990 lines**) and was not trusted.

> **One-sentence shape of the system.** Cognivio is a single 33,990-line `server.py` monolith (the FastAPI app, ~254 routes, all Pydantic models, the AI/video pipeline, the workers, and the data layer), wrapped by a thin, *mostly-unmounted* `app/` package that imports `server as legacy` and calls back into it. The "modularization" is a facade: 32 files depend on the monolith; the monolith is the kernel.

---

## 1. SYSTEM TOPOLOGY

### 1A. Entry points & boot

**App object & deploy truth.** The live app is `FastAPI(...)` created at `server.py:6664` with `lifespan=lifespan` (`server.py:6667`). Deploy paths:
- `Dockerfile:42` — `CMD uvicorn server:app` (deploy truth; `railway.toml:2` selects `builder = "DOCKERFILE"`).
- `railway.toml:17` (api service) and `railway.toml:21` (worker service via `worker_entrypoint.py`).
- `nixpacks.toml:40` also targets `server:app` but is **inert** — railway forces the Dockerfile builder. `[INFERRED]`
- `app/main.py:81` exposes an alternate `app = create_app()` wrapping `legacy_server.app` (`app/main.py:24`), but **no deploy config references `app.main:app`** — it is dead-at-deploy. It only adds a `/metrics` route (`app/main.py:63`) and `app.state` registries.

**Two-service split (one image).**
- `api` (`railway.toml:17`): forces `VIDEO_WORKER_COUNT=0 VIDEO_TRANSCODE_WORKER_COUNT=0 PRIVACY_WORKER_COUNT=0` → the web process starts **no** background workers.
- `worker` (`railway.toml:21`): runs `worker_entrypoint.py`, which calls `server._ensure_database_indexes`, the three `_rehydrate_*` queue calls, then `_start_video_transcode_workers` / `_start_privacy_workers` / `_start_video_workers` (`worker_entrypoint.py:24-31`), then blocks on a stop event. Healthcheck `GET /health` (`railway.toml:12`; handler `server.py:6765`).

**Boot sequence — `lifespan` (`server.py:6544`)** calls `_app_startup()` (`server.py:6449`) which runs, in order:
1. `_validate_s3_config()` (`server.py:6450`)
2. `_ensure_database_indexes()` (`server.py:6451`) → `scripts.ensure_indexes.ensure_indexes(db)` + `CACHE_CLIENT.ensure_indexes()` (`server.py:33959-33963`)
3. `_ensure_master_admin_user()` (`server.py:6452`, defined `6493`) — upserts the super-admin from `MASTER_ADMIN_EMAIL/PASSWORD`
4. `_start_privacy_maintenance_tasks()` (`server.py:6453`)
5. `_start_video_transcode_workers()` / `_start_privacy_workers()` / `_start_video_workers()` (`server.py:6454-6456`) — gated to 0 on the api service
6. `_rehydrate_video_transcode_queue()` / `_rehydrate_video_privacy_queue()` / `_rehydrate_video_processing_queue()` (`server.py:6457-6459`)
7. If `DEMO_MODE`: upsert `DEMO_USERS` and `_ensure_demo_tenant_state()` (`server.py:6460-6490`)

`_app_shutdown` (`server.py:6538`) cancels worker tasks via `_stop_video_workers()` (`server.py:33966`) and closes the Mongo client (`server.py:6540`).

**Routers mounted (include order):**
- `auth_router` — `app/routers/auth.py`, `prefix="/api"` at `server.py:33912`
- `videos_router` — `app/routers/videos.py`, `prefix="/api"` at `server.py:33913`
- `build_router` — `app/routers/build.py`, **no prefix** at `server.py:33914` → `GET /__build`
- `api_router` (`APIRouter(prefix="/api")`, `server.py:6435`; **253 routes**) at `server.py:33915`
- Extra route `GET /api/admin/access-request-actions/{action}` via `add_api_route` at `server.py:33916`
- `StaticFiles` mount `/uploads` at `server.py:33921`
- Root `GET /health` at `server.py:6765`

**Mounted vs. unmounted.** `app/routers/__init__.py:13-62` registers 8 routers but marks **all extracted ones `"extracted_unmounted"`** — including auth and videos, which `server.py` nonetheless *does* mount (33912-33913). The registry metadata is **stale/misleading**. The genuinely-unmounted routers (never `include_router`-ed) are `assessments`, `teachers`, `privacy`, `recognition`, `exemplars` — they exist as code but serve no traffic. Route ordering is pre-sorted by `_prioritize_static_routes(api_router)` (`server.py:33911`).

**Middleware stack.** Registered (source order) plus CORS via `add_middleware`:

| Reg. line | Name |
|---|---|
| `server.py:6697` | `reject_oversized_video_uploads` |
| `server.py:6713` | `enforce_general_post_rate_limit` |
| `server.py:6725` | `block_write_requests_in_preview_mode` |
| `server.py:6750` | `enforce_csrf_for_session_auth` |
| `server.py:33950` | `CORSMiddleware` (`add_middleware`) |

Starlette runs the last-added outermost. **Effective execution order (outermost → handler):**
1. `CORSMiddleware` (`33950`) → 2. `enforce_csrf_for_session_auth` (`6750`) → 3. `block_write_requests_in_preview_mode` (`6725`) → 4. `enforce_general_post_rate_limit` (`6713`) → 5. `reject_oversized_video_uploads` (`6697`) → route handler.

**Exception handlers** (`server.py:6670-6694`): `RateLimitExceeded`→429, `UploadTooLargeError`→413, `InvalidVideoFileTypeError`→422, `UploadQuotaReachedError`→402.
**CORS** (`server.py:33950`): `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`, origins from `_build_cors_origins()` (`33936`) = `CORS_ORIGINS` ∪ `FRONTEND_URL` ∪ hardcoded production origins (`33922`) ∪ localhost (`33927`).

### 1B. Representative authenticated request lifecycle — `GET /api/videos`

Chosen because it is fully traceable through the modular router into the service/repository layers (the `api_router` equivalents are inline in server.py).

1. **Middleware chain** (execution order above): CORS (`33950`) → CSRF (`6750`, no-op for GET) → preview-block (`6725`, no-op for GET) → rate-limit (`6713`; `_consume_*` skip non-POST, `6626`/`6645`) → oversize-upload (`6697`, POST-only no-op).
2. **Route handler**: `get_videos_route` (`app/routers/videos.py:50-55`), declares `current_user = Depends(get_current_user)`.
3. **Auth dependency**: the router imports `get_current_user` from `app.dependencies` (`videos.py:9`), which re-exports `from server import get_current_user` (`app/dependencies.py:3`), which itself is `from app.middleware.auth_middleware import get_current_user` (`server.py:9577`). **There is exactly one resolver**, at `app/middleware/auth_middleware.py:80`.
4. **Auth resolution** (`auth_middleware.py:80-141`): token from bearer (`:14`) or session cookie (`:30`); 401 if missing (`:93`); `jwt.decode` with `legacy.JWT_SECRET`/HS256 (`:100`); `_find_user_from_payload` (`:48`) → DB read `legacy.db.users.find_one({"id": user_id}, {"_id":0,"password":0})` (`:64`); 401 if absent, 403 if `_is_user_access_active` false (`:71`). Preview override (`:121-139`): if `X-Cognivio-Preview-User` set and caller is super_admin, a **second** `db.users.find_one` (`:128`) swaps in the previewed user.
5. **Service call**: `list_videos(teacher_id, current_user)` (`app/services/video_service.py:374`).
6. **Role-based query shaping**: `video_repository.list_teacher_ids_for_user` → `legacy._list_teacher_ids_for_user` (`server.py:4191`) branches by `tenant_role` (super_admin → all `4198`, teacher → self `4203`, admin → org/school `4215`); `legacy._build_video_visibility_query` (`server.py:5403`): super_admin → `{}`, admin → `{teacher_id:{$in:...}}` or `{uploaded_by:id}`, others → teacher-scoped (`5408-5420`).
7. **DB read**: `legacy.db.videos.find(query, {"_id":0,"uploaded_by":0,"stored_filename":0}).to_list(1000)` (`app/repositories/video_repository.py:28`).
8. **Projection/serialization**: per video `legacy._apply_video_response_defaults` (`server.py:3659`) then `legacy._sanitize_video_response` (`server.py:3682`) strips `s3_key`, `raw_file_url`, `raw_file_path`, `effective_privacy_policy`, etc.
9. **Response**: list → FastAPI JSON-encode → CORS headers applied outbound.

**Where things happen:** auth resolved at `auth_middleware.py:80`; first DB hit `auth_middleware.py:64` (user) then `video_repository.py:29` (videos); role shaping at `server.py:4191` + `5403` (scope) and `server.py:3682` (field redaction). Every protected endpoint repeats steps 3–4 identically.

### 1C. File size inventory (top 20 by LOC)

| LOC | File |
|---|---|
| **33990** | `server.py` ⚠ **>2000** |
| **2168** | `app/services/teacher_lesson_coaching_artifact.py` ⚠ **>2000** |
| 1528 | `scripts/run_pilot_smoke_checks.py` (operational script) |
| 1093 | `scripts/audit_video_processing_pipeline.py` (operational script) |
| 989 | `app/services/coach_voice_generation.py` |
| 961 | `app/services/auth_service.py` |
| 951 | `tests/test_teacher_artifact_quarantine.py` (test) |
| 935 | `app/services/lesson_moment_quality.py` |
| 918 | `app/services/teacher_artifact_quarantine.py` |
| 860 | `app/analysis/teacher_feedback_projection.py` |
| 819 | `tests/test_teacher_lesson_coaching_artifact.py` (test) |
| 815 | `app/analysis/master_observer.py` |
| 770 | `app/analysis/voice_gate.py` |
| 733 | `app/services/privacy_reference_materialization.py` |
| 703 | `tests/test_coach_voice_generation.py` (test) |
| 697 | `app/analysis/gemini_engine.py` |
| 692 | `privacy_pipeline.py` |
| 676 | `tests/test_lesson_moment_evidence_quality.py` (test) |
| 663 | `app/services/video_service.py` |
| 652 | `app/services/workspace_service.py` |

**Files > 2000 LOC (non-test source) — FLAGGED:** `server.py` (33,990) and `app/services/teacher_lesson_coaching_artifact.py` (2,168). server.py is **15× larger than the next source file** and ~50× the entire next tier.

**`server.py` structural zones** (banner comments `# ==== X ====`; api_router routes span `6770`→`33664`):

| Lines | Zone |
|---|---|
| 1–6160 | Preamble: privacy/classification enums (`169-204`), settings (`5815`), Mongo handle (`5820`), JWT (`5830`), helpers incl. `_sanitize_video_response` (`3682`), `_list_teacher_ids_for_user` (`4191`), `_build_video_visibility_query` (`5403`) |
| 6160–6663 | Rate-limit machinery, lifespan/startup/shutdown (`6449`, `6544`) |
| 6663–6898 | App creation, middleware, exception handlers, health, metrics |
| 6899–7565 | Enums + framework data (Danielson/Marshall) |
| 7566–9575 | Pydantic models (heavy master-admin schemas) |
| 9576–9719 | Auth helpers / endpoints |
| 9720–10159 | Framework endpoints |
| 10160–11297 | Teacher endpoints |
| 11298–15408 | **Video endpoints** — incl. worker job runners `_run_video_privacy_job` (`11367`), `_run_video_transcode_job` (`12014`), `_run_video_job` (`12243`) |
| 15409–15573 | Curriculum & plans |
| 15574–21940 | **Assessment endpoints** — `GET /api/assessments` at `15575`; teacher/admin fork at `15640` |
| 21941–24642 | Roster & dashboard — `GET /api/teachers/{id}/dashboard` at `22230` |
| 24741–25824 | Observation sessions / observations / schedule |
| 25825–26669 | Recording policy & compliance, notifications, onboarding/consent/telemetry |
| 26670–33147 | "INTEGRATIONS" banner — **misnomer**: ~6,400 lines of master-admin + admin/ops endpoints `[INFERRED]` |
| 33148–end | Seed data, router includes (`33912`), CORS (`33950`), index/worker shutdown helpers |

---

## 2. DATA MODEL (as it actually exists)

> All `app/repositories/*` and DB-touching services delegate to `import server as legacy` and call `legacy.db.<collection>` (e.g. `assessment_repository.py:13`, `video_repository.py:5,13`, `teacher_repository.py:5,9`). Every handle resolves to the single `server.db` object (`server.py:5823`). All collections are accessed `db.<name>` attribute-style (no `db["..."]` form exists). Declared indexes live in `backend/scripts/ensure_indexes.py` `INDEX_SPECS` (lines 55–153). **There are zero `create_index` calls in `server.py` or `app/repositories/`** — index creation happens only via `ensure_indexes.py` at startup; the only other `create_index` in the codebase is in `app/cache.py`.

### 2A. Collections inventory (implied schema from read/write sites)

**Core domain**
- **`users`** (~84 sites). Write (registration) `auth_service.py:765-790`: `id, email, name, password, created_at, updated_at, role, tenant_role, approval_status, tenant_status, is_active, organization_type, organization_name, school_name, requested_*`, `manager_email`, `approval_requested_at`, `uploads_total`, `assessments_total`. Master-admin write `server.py:6519-6535` adds `audio_analysis_enabled, approved_at, approved_by`. Tombstones: `deleted_at, approval_deleted, revoked_at/by` (`server.py:6511-6516`, `2674-2709`). Read by `email` (`server.py:1050,1211,6463`; `auth_service.py:555,886`) and `id` (`auth_middleware.py:64,128`). Self-link `teacher_id` (`server.py:10214-10217`).
- **`teachers`** (~77 sites). Write `server.py:10172-10187`: `id, name, email, subject, grade_level, department, school_id, organization_id, category, category_custom, next_coaching_conference, created_by, created_at`. Read by `id` (`teacher_repository.py:9`), `created_by` (`:25`), `aggregate` (`server.py:29210`).
- **`videos`** (~111 sites — hottest collection). Write `server.py:12816-12881` (large): `id, filename, stored_filename, s3_key, raw_s3_key, file_url, raw_file_url, transcode_decision*, file_path, raw_file_path, content_type, processed_*, teacher_id, observation_session_id, uploaded_by, status, privacy_status, analysis_status, transcode_status, *_started_at/completed_at/failed_at/error, privacy_review_*, raw_retention_expires_at, subject, lesson_title, recorded_at, upload_date, analysis_language, teacher_reference_image*`. **`organization_id`/`school_id`/`workspace_id` are NOT written at insert** — `workspace_id` is resolved at read time via `_resolve_video_workspace_id` (`server.py:5555-5564`). `[INFERRED]`
- **`assessments`** (~66 sites). Write `server.py:29692-29734`: `id, video_id, teacher_id, user_id, framework_type, element_scores, overall_score, summary, recommendations, priority_elements, focus_note, observation_summary, analyzed_at, analysis_*`, `specialist_*`, `data_classifications, processing_purposes`, plus release metadata supplying `feedback_release_status`. **No `organization_id`/`school_id` persisted.** `[INFERRED]`
- **`organizations`** (~20), **`schools`** (~19).

**Auth / audit:** `user_sessions`, `auth_event_log`, `master_admin_audit_events`, `privacy_audit_events`, `recognition_audit_events`.
**Assessment-adjacent:** `assessment_report_feedback`, `admin_assessment_overrides`, `teacher_feedback_reviews`, `curriculum_adherence`, `admin_scoring_preferences`, `feedback_review_queue`.
**Coaching/reflection:** `action_plans`, `action_plan_history`, `summary_reflections`, `summary_reflection_history`, `coaching_tasks` (write `server.py:18606-18629`), `coaching_task_reflections`, `published_conference_agendas`, `gradebook_reminders`.
**Observations:** `observations`, `observation_sessions`, `observer_goals`, `observation_compliance_rules`.
**Recognition/exemplars:** `recognition_badges` (write `server.py:14690-14704`), `lesson_recognition_events`, `exemplar_submissions`, `exemplar_library_items`, `share_assets`.
**Video pipeline:** `video_processing_jobs`, `video_transcode_jobs`, `video_privacy_jobs`, `video_sampling_manifests`, `processing_incidents`, `worker_heartbeats`, `video_analysis_features`, `video_analysis_moments`, `video_audio_transcripts`, `video_comments` (write `server.py:16290-16314`), `video_evidence`, `assessment_evidence`, `audio_analyses`.
**Privacy/face:** `teacher_face_profiles`, `teacher_face_references`, `consent_records`, `recording_policies`, `recording_compliance`, `data_subject_requests`.
**Curriculum:** `curricula`, `lesson_plans`, `syllabi`, `curriculum_adherence`.
**Frameworks/tenancy/misc:** `framework_selections`, `custom_frameworks` (declared index but **no read/write site found** `[INFERRED]`), `reports` (**no access site found** `[INFERRED]`), `schedules` (write `server.py:25766,33758`), `notifications` (write `server.py:29300-29321`), `notification_preferences`, `custom_domains`, `gradebook_integrations`, `pending_linkages`, `organization_memory`, `workspace_mode_preferences` (only in `workspace_repository.py:17,24`, absent from server.py), `cache` (`app/cache.py:13`), `dashboard_intelligence_cache`, `dashboard_leadership_insights_cache`, `web_vitals`, `demo_reset_events`.
**Training:** `training_cohorts`, `trainee_placements`.

### 2B. Relationships (informal string-UUID foreign keys, not Mongo `_id`/DBRef)

- `assessments.video_id → videos.id` (`server.py:29694`, consumed `16284`); `assessments.teacher_id → teachers.id` (`29695`); `assessments.user_id → users.id` (`29696`).
- `videos.teacher_id → teachers.id` (`12837`); `videos.uploaded_by → users.id` (`12839`); `videos.observation_session_id → observation_sessions.id` (`12838`).
- `teachers.school_id → schools.id`; `teachers.organization_id → organizations.id` (`10179-10180`); `teachers.created_by → users.id` (`10184`).
- `users.teacher_id → teachers.id` self-link (`10214-10217`); `users.organization_id/school_id` (read `1264-1266`); `schools.organization_id → organizations.id`.
- `coaching_tasks.{teacher_id, assessment_id, video_id, observer_id, linked_observation_session_id}` (`18610-18625`); `recognition_badges.{teacher_id, video_id}` (`14692-14693`); `video_comments.{video_id, assessment_id, teacher_id, author_id, organization_id}` (`16292-16297`).
- All pipeline sub-collections (`video_processing_jobs`, `video_transcode_jobs`, `video_privacy_jobs`, `video_analysis_features`, `video_analysis_moments`, `video_audio_transcripts`, `video_sampling_manifests`) are `video_id`-keyed.

### 2C. Index assumptions — queries with NO supporting index (FLAGGED)

Declared indexes cover `users`, `user_sessions`, `auth_event_log`, `organizations`, `schools`, `teachers`, `videos`, `assessments`, and ~40 more (`ensure_indexes.py:55-153`).

**Collections queried but ENTIRELY ABSENT from `INDEX_SPECS` (every query is a scan):**
- **`schedules`** — `find({teacher_id:$in, recording_status})` (`server.py:21653`), `find({teacher_id}).sort(start_time)` (`23298`), `count_documents({user_id, start_time:$gte})` (`28920`). **High traffic, no index.**
- **`notifications`** — `find({$or:[recipient_user_id,user_id]}).sort(created_at).skip()` (`server.py:26051`), `count_documents` (`26050,29065`). **High traffic; `skip()` paging + unindexed `$or` + sort.**
- **`video_evidence`** (`video_repository.py:43`), **`curriculum_adherence`** (`17015,19244`), **`admin_assessment_overrides`** (`19235`; `assessment_repository.py:30`), **`teacher_feedback_reviews`** (`15744,16417`), **`lesson_plans`** (`17032`), **`syllabi`** (`15571`), **`curricula`** (`15460`), **`recording_policies`** (`5526,5670`), **`recording_compliance`** (`5738`), **`custom_domains`** (`9964,19041`), **`admin_scoring_preferences`** (`16734`), **`gradebook_integrations`** (`28923`), **`organization_memory`** (non-unique upsert key, dup risk; `workspace_repository.py:33-38`), **`workspace_mode_preferences`**, **`cache`** (no TTL index on `expires_at`; `app/cache.py:35`), **`dashboard_leadership_insights_cache`** (`19430`), **`notification_preferences`, `data_subject_requests`, `observation_compliance_rules`, `assessment_evidence`, `audio_analyses`, `pending_linkages`, `demo_reset_events`**.

**Index-vs-write mismatches (declared index cannot serve its apparent purpose):** `[INFERRED]`
- `assessments` index `(organization_id, school_id, analyzed_at)` (`ensure_indexes.py:83`): assessment docs are written without those fields → index keys null → tenant filtering on assessments cannot use it.
- `videos` index `(organization_id, school_id, workspace_id, upload_date)` (`:74`): the upload insert omits all three → composite index unusable for the documented tenant query.
- `videos` index `(demo_data, organization_id, upload_date)` (`:77`): `demo_data` only written in seed paths (`server.py:10343`), not primary upload.
- `observations` index is `(video_id, created_at)` (`:92`) but queries filter `(teacher_id, user_id)` (`server.py:17719`) → not covered.
- `reports` (`:101-102`) and `custom_frameworks` (`:108`): declared but no code accesses them.

### 2D. Denormalization (same fact in multiple places)

- `teacher_name` copied from `teachers.name` into `coaching_tasks.teacher_name` (`server.py:18611`) and `pending_linkages.teacher_name` (`11002`).
- `author_name`/`author_role` copied into `video_comments` (`16298-16303`) — duplicates `users.name` + role.
- `organization_id` + `workspace_id` both stored on `video_comments`, both from `teacher.organization_id` (`16294-16295`).
- `notifications` stores duplicate-field pairs: `type`+`notification_type`, `message`+`body`, `cta_url`+`action_url`, `recipient_user_id`+`user_id` (`29303-29314`) — the `$or` read (`26034`) exists *because* of the id split.
- `recognition_badges.criteria_snapshot` embeds a copy of `lesson_recognition_events.eligibility` (`14698`).
- `videos` stores raw-asset facts twice: `s3_key/raw_s3_key`, `file_url/raw_file_url`, `file_path/raw_file_path` (`12820-12831`).
- `users.uploads_total`/`assessments_total` counters (`auth_service.py:785-786`) duplicate counts derivable from `videos`/`assessments`. `[INFERRED]`

### 2E. Unbounded scans

Whole-collection `find({})` or large `to_list(N)` caps with no indexed equality filter (all in `server.py`):
- `db.teachers.find({}).to_list(5000/10000)` — `1732, 2167, 2248, 28091, 28315`.
- `db.users.find({}).to_list(5000/10000/2000)` — `1733, 2166, 2247, 16792, 26918, 27170, 27711, 28301, 28364`.
- `db.videos.find({}).to_list(10000)` — `2168, 2249, 28090`.
- `db.assessments.find({}).to_list(10000)` — `1757`; `db.organization_memory.find({}).to_list(5000)` — `1762`; `db.processing_incidents.find({}).to_list(10000)` — `2229`; `db.assessment_report_feedback.find({}).to_list(10000)` — `2333`; `db.admin_assessment_overrides.find({}).to_list(10000)` — `2334`; `db.organizations.find({}).to_list(10000)` — `27256, 28328`.
- `auth_event_log` / `master_admin_audit_events` / `user_sessions` `find({}).sort(created_at)` (full index scan, no equality bound) — `27560, 27603, 28372-28374`.
- **Aggregation full scan:** `db.teachers.aggregate([{$match:{created_by}}, {$lookup: videos}, ...])` (`server.py:29210-29225`) — `$match` on unindexed `teachers.created_by`, `$lookup` joins `videos.teacher_id` per teacher.
- `cache` sweep: `find({}, {_id:1}).to_list(10000)` + `find({}, {value:1}).to_list(1000)` (`app/cache.py:97,126-127`).

**Worst pattern `[INFERRED]`:** admin/master-admin diagnostic endpoints (`2166-2168`, `2247-2249`, `28090-28091`, `28301-28328`) co-load full `users` + `teachers` + `videos` (5k–10k caps each) in a single request, scaling linearly with tenant data.

---

## 3. THE VIDEO PROCESSING PIPELINE

Four-stage, Mongo-backed, in-memory-`asyncio.Queue` fan-out: **transcode → privacy-blur → analysis**, with **analysis dispatched independently at upload** (decoupled from privacy). All four worker families share `server.py`'s module-level queues; `app/workers/*` are thin re-export wrappers (e.g. `app/workers/video_worker.py:6-27`).

### 3A. End-to-end trace

**Stage 0 — Upload.** Route `app/routers/videos.py:24-47` (`POST /videos/upload`) → `app/services/video_service.py:19-371`: validate (`:42`), stream to disk in 1 MB chunks (`:90-107`), best-effort raw S3 upload (`:111-121`, failure only logged), size-aware transcode decision (`:126-137`), insert `videos` doc with `status/privacy_status/analysis_status=QUEUED` (`:140-211`).
- **0→analysis (independent):** `video_service.py:236-249` → `legacy._enqueue_video_processing_job` (`server.py:11926-11964`) upserts `video_processing_jobs` (QUEUED) and `VIDEO_JOB_QUEUE.put(video_id)` (`:11964`). Analysis runs on the **RAW** asset.
- **0→transcode:** `video_service.py:251-254` → `_enqueue_video_transcode_job` (`server.py:11967-12011`).
- **0→privacy** is enqueued at upload **only when transcode is skipped** (`video_service.py:315-321`); otherwise the transcode worker enqueues privacy on success.

**Stage 1 — Transcode** (`_video_transcode_worker` `server.py:12338`; `_run_video_transcode_job` `12014-12173`): atomically claim QUEUED/FAILED→PROCESSING (`12019-12035`), ffmpeg off-thread (`12078-12082`), upload processed asset (`12083-12090`), write `transcode_status=COMPLETED`, `status=QUEUED` (`12092-12113`); **1→2:** `_enqueue_video_privacy_job` on the *processed* asset (`12124-12129`).

**Stage 2 — Privacy** (`_video_privacy_worker` `12365`; `_run_video_privacy_job` `11367-11923`): claim (attempts `< PRIVACY_MAX_RETRIES`, `11372-11389`), materialize face references off-thread (`11418-11430`), face analysis off-thread (`11493-11499`); ambiguous teacher track + manual review → `privacy_status=REVIEW_REQUIRED` and return (`11518-11575`); render redacted video + thumbnail (`11589-11600`), upload (`11618-11637`), two **fail-closed** gates — playback validation (`11644-11664`) and visual-redaction validation (`11684-11692`); any failure → `privacy_status=FAILED` and return (`11720-11781`). On success: write redacted asset fields + `analysis_status=QUEUED` (`11804-11837`).

**Stage 3 — Analysis** (`_video_processing_worker` `12305`; `_run_video_job` `12243-12302`): claim a `video_processing_jobs` row (`_claim_video_processing_job` `12176-12206`; QUEUED, due, `retry_count < 3`), 30 s heartbeat task (`12234-12249`), call `analyze_video` (`29401-29906`) on the RAW asset, **never gated by privacy** (`29425-29430`): extract frames (`29501`), sampling manifest → `video_sampling_manifests` (`29503-29508`), moment manifest → `video_analysis_moments` (`29518-29526`), audio artifacts (failure swallowed, `29537-29538`), model via `analyze_frames_with_ai` (`29559-29579`), scores/summary/recommendations, `assessments` insert (`29692-29734`), evidence via `_persist_assessment_evidence_from_scores` → `assessment_evidence` (`29749`), set `videos.status=COMPLETED`, coaching tasks + recognition (`29804-29824`).

### 3B. Queues & concurrency

Three in-memory `asyncio.Queue[str]` of `video_id`: `VIDEO_JOB_QUEUE` (`6439`), `VIDEO_TRANSCODE_JOB_QUEUE` (`6442`), `VIDEO_PRIVACY_JOB_QUEUE` (`6444`). Worker counts: `_start_video_workers` creates `VIDEO_WORKER_COUNT` tasks (`12392-12400`; `=3` on worker / `0` on api per `railway.toml:24,28`); transcode (`12403`), privacy (`12414`).

**Job state is persisted per-stage** in Mongo (`video_processing_jobs.status` + `videos.status/analysis_status`; `video_transcode_jobs` + `videos.transcode_status`; `video_privacy_jobs` + `videos.privacy_status`) and **worker liveness** in `worker_heartbeats` (written every 30 s, `12234-12238`).

**Restart mid-job:** the three `_rehydrate_*` functions reset `PROCESSING→QUEUED` and re-queue (`12425-12478`, `12481-12542`, `12545-12571`). In-flight jobs ARE requeued on a clean restart **because the reset is unconditional**.

**Gaps:**
- **No live reclaimer.** `claimed_by`/`last_heartbeat` are written (`12196-12231`) but **never read by any reclaimer** `[INFERRED]`. A job whose worker dies *without a process restart* stays `PROCESSING` forever. The 45-min "stuck" counts (`6831-6869`) are **metrics only**.
- Rehydration caps re-queue at `.to_list(2000)` (`12451` etc.) — backlog beyond 2000 is silently dropped from re-enqueue. `[INFERRED]`
- Rehydration resets **all** `PROCESSING` rows with no instance/heartbeat filter — unsafe with >1 replica (see §6C, §9).

### 3C. External calls

| Call | Site | Timeout / Retry | On failure |
|---|---|---|---|
| **Gemini** analysis | `gemini_engine.py` via `server.py:30994-31040` | File-API activation 120 s (`gemini_engine.py:70`); 3 attempts on transient modes w/ jitter backoff (`:74, 491-525`) | raises typed `AnalysisError` → logs loudly → **falls through to OpenAI/heuristic** (`server.py:31041-31047`) |
| **OpenAI vision** | `client.responses.create(...)` `server.py:30895-30903` | **No explicit timeout or retry** (SDK default ~600 s) `[INFERRED]` | degrade to heuristic `fallback_model_error` (`31086-31096`) |
| OpenAI coaching-prep | `gpt-4o-mini` chat `server.py:24421-24427` | none | hardcoded fallback thread |
| OpenAI Whisper transcription | `audio_pipeline.py:69-75` | **No timeout**; one-shot format downgrade retry | swallowed; analysis continues vision-only (`server.py:29537`) |
| **R2/S3 (boto3)** | `_get_s3_client` `server.py:3771`; uploads `3904-3949` | **No `botocore.Config` timeout/retry override** (pure defaults) `[INFERRED]` | **inconsistent by site**: raw-upload swallowed (`video_service.py:120`); redacted-upload swallowed → local URL fallback (`server.py:11626`); processed-upload failure **fails the transcode job** (`12084-12090`) |
| Reference URL fetch | `requests.get(..., timeout=PRIVACY_REFERENCE_URL_FETCH_TIMEOUT_SECONDS)` `server.py:3978` | configured timeout | gated behind enable flag + host allowlist |
| **Resend email** | `requests.post(.../emails, timeout=20)` `server.py:3026-3047` | 20 s | returns False → SMTP fallback (`3071-3095`); off critical path |

No `httpx`/`aiohttp` in the pipeline; sync `requests` + `boto3` + the two AI SDKs.

### 3D. Inconsistent-state failure points

1. **Analysis job stuck `PROCESSING` forever** if the worker task is cancelled / process dies between claim (`12200`) and the job-row update (`12264`), or if the un-timeout'd OpenAI call hangs (`30896`). Recovery only via restart-triggered rehydration; no live reclaimer.
2. **Duplicate assessment on re-run.** `analyze_video` writes `videos=COMPLETED` and inserts the `assessments` doc *inside its own body* (`29734, 29753`), while the owning job row is updated by the caller afterward (`12264`). A crash in that window → rehydration re-queues → **duplicate `assessments` + `assessment_evidence`** (insert at `29734` has no idempotency guard). `[INFERRED]`
3. **Transcode failure strands the chain.** `_run_video_transcode_job` sets `videos.status=FAILED` on any exception (`12135-12152`); since privacy is enqueued only on transcode success and was not enqueued at upload, **privacy never runs** for that video without a manual retry. `[INFERRED]`
4. **Privacy REVIEW_REQUIRED / FAILED are terminal until a human acts** (`POST /videos/{id}/privacy/retry`, `video_service.py:562-663`). A rendered redacted asset may exist on disk/S3 while `privacy_status=FAILED` → **orphaned redacted asset** if the teacher is later deleted. `[INFERRED]`
5. **Attempts-exhausted silently strands.** Once `attempts >= PRIVACY_MAX_RETRIES`, rehydration re-queues but the claim no-ops (`11388`) and **returns silently** — no FAILED transition, no alert. `[INFERRED]`
6. **Source-cleanup race makes retries unrecoverable.** Raw S3 upload failure is swallowed (`video_service.py:120`) so only the local copy exists; later `CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS` deletes it (`29899-29906`) → privacy/analysis retry finds "local video file is missing" (`video_service.py:533-537`) → 409, unrecoverable. `[INFERRED]`
7. **Multi-instance rehydration race** (see §6C).

**Durability model:** state persisted per-stage in Mongo, recovered **only at process restart**. No running watchdog; critical-path AI/S3 calls have **no explicit timeouts** (Gemini excepted); several terminal failure paths require **manual retry**.

---

## 4. IDENTITY, AUTH & ROLES

Two-layer role model: coarse legacy `role` (`teacher`/`admin`/`super_admin`) and finer `tenant_role` (`teacher`/`school_admin`/`training_admin`/`super_admin`). `tenant_role` is canonical; `role` is derived. Access state is tracked separately via `approval_status`/`tenant_status`/`is_active`.

### 4A. Role inventory

- **`tenant_role`** — `VALID_TENANT_ROLES = {"teacher","school_admin","training_admin","super_admin"}` (`server.py:165`), resolved by `_get_user_tenant_role` (`server.py:676-692`): email in `SUPER_ADMIN_EMAILS` → super_admin; else stored `tenant_role`; else email in `ADMIN_EMAILS` → school_admin; else map legacy `role`; default teacher. Frontend mirror `ROLE` (`frontend/src/lib/userRoutes.js:1-7`, `getUserTenantRole` `:20-57`).
- **`role`** (derived) — `_get_user_role` → `_legacy_role_for_tenant_role` (`server.py:630-636`): super_admin→super_admin; {school_admin, training_admin}→**admin**; else teacher. Distinct values: **teacher, admin, super_admin**. Stored at creation (`auth_service.py:570-575`).
- **`master_admin`** — NOT a stored `tenant_role`. (a) Config identity `MASTER_ADMIN_EMAIL/PASSWORD/NAME` (`server.py:5844-5846`, seeded `6494-6522`); (b) frontend-only alias for super_admin (`userRoutes.js:30-34`). `[INFERRED]`
- **Email allowlists override stored roles:** `ADMIN_EMAILS` (`server.py:5842`), `SUPER_ADMIN_EMAILS` (`5843`) short-circuit resolution (`678,683`) and auto-approve registration (`787`). **Frontend hardcodes a super-admin email** `email === "rmc91180@gmail.com"` (`userRoutes.js:32`) — a backdoor baked into the client bundle; the backend relies on configured `SUPER_ADMIN_EMAILS` instead. `[INFERRED]`
- **Access-state fields:** `approval_status` (canonicalized `server.py:699-703`; login allows only `{approved,active}` `auth_service.py:24`); `tenant_status` (written equal to `approval_status`, recomputed equal `server.py:795-796` — **effectively a duplicate**, no gate reads it independently `[INFERRED]`); `is_active` (gates login `auth_service.py:612`); tombstone sets `DELETED_APPROVAL_STATUSES`/`INACTIVE_USER_STATUSES` (`server.py:706-707`).

### 4B. Role gate enforcement

**Backend gates are inline, not dependency-injected.** ~188 occurrences of `_get_user_role`/`_get_user_tenant_role` + `HTTPException(403)`. The modular guards `require_admin_user` (`auth_middleware.py:154-164`) and `require_super_admin_user` (`:167-177`) **take `current_user` as a plain arg, not `Depends`, and are not wired to live routes** — dormant. `[INFERRED]`

| Role | Backend gates | Frontend gates |
|---|---|---|
| `super_admin` | inline `!= "super_admin"` (e.g. `server.py:14197`); `SUPER_ADMIN_EMAILS` short-circuit; generally bypasses tenant scoping | `superAdminOnly` on `/master-admin/*` (`App.js:131-258`); `SUPER_ADMIN_ROUTES` (`roleRouter.js:75-82`) |
| `school_admin` (→`admin`) | `role != "admin"` → 403 (`server.py:5535-5537`) + ~15 inline "Admin access required" | `allowedTenantRoles` on `/dashboard`, `/teachers`, `/reports`, `/privacy-review`, etc. (`App.js`); `ADMIN_ROUTES` |
| `training_admin` (→`admin`) | **Same `role=="admin"` gates — backend does NOT distinguish from school_admin** (`server.py:634`) | distinguished frontend-only: `/cohorts` training-only (`App.js:287`); `TRAINING_ROUTES` |
| `teacher` | projection fork `== "teacher"` (`server.py:15640`); ownership checks | `allowedTenantRoles={["teacher"]}` on `/my-*`; consent gate (`ProtectedRoute.js:104-115`) |

### 4C. Auth flow

**Issuance (login `auth_service.py:588-689`, route `app/routers/auth.py:40-42`):** lookup case-insensitive + bcrypt (`:592-596`); access-state gate (`:611-643`); session row in `user_sessions` (`:658-662`); **JWT mint inconsistency** — if `legacy.create_token` exists it is preferred (`:664-665`), and `create_token` (`server.py:9592`) mints only `sub/user_id/iat/exp` (**no role/email claim**); the richer `create_access_token` (`auth_service.py:289-317`) is only the fallback. So live JWTs carry no role; role is re-derived from the DB at every request `[INFERRED]`. Cookies via `set_auth_cookies` (`:387-420`): `cognivio_session` (HttpOnly, holds JWT) + `cognivio_csrf` (non-HttpOnly, HMAC of `session_id:nonce` keyed by `JWT_SECRET`). Raw token also returned in the JSON body for bearer clients.

**Validation (`get_current_user` `auth_middleware.py:80-141`, the single resolver):** token from bearer or cookie → `jwt.decode` HS256 → `_find_user_from_payload` (DB load, `{_id:0,password:0}`) → 401 if absent / **403 if not access-active**. Preview/impersonation (`:118-139`): super_admin + `X-Cognivio-Preview-User` returns the impersonated user for the whole request.

**CSRF** (`server.py:6750-6762`): mutating `/api/*` methods, **only when a session cookie is present**, validate via `_csrf_is_valid` (`auth_service.py:367-384`). Exempt set `CSRF_EXEMPT_PATHS` (`6740-6747`). **Bearer-token clients bypass CSRF entirely** (cookie-conditioned).

**Backend↔frontend inconsistencies:**
- **`training_admin` vs `school_admin` is a frontend-only distinction**; the backend collapses both to `admin`. A `training_admin` hitting a school_admin-only API would not be blocked by role at the backend — only by tenant-scope checks, if any. `[INFERRED, worth a targeted backend review]`
- Hardcoded super-admin email in the client (`userRoutes.js:32`) vs env-configured server-side → UI/enforcement can diverge. `[INFERRED]`
- CSRF bypassed for bearer clients (`server.py:6759`).
- Frontend route-list (`roleRouter.js`) and `<Route>` guards (`App.js`) must be kept in sync by hand. `[INFERRED maintenance hazard]`
- Frontend guards are **advisory UX only**; all real enforcement is the backend inline 403s.

### 4D. Teacher/admin projection fork

**Fork point:** `GET /api/assessments/{id}` → `get_assessment` (`server.py:15626-15691`), branch at **`server.py:15640`**: `if _get_user_tenant_role(current_user) == "teacher":`.

**Teacher branch** (`15640-15668`) builds a coaching artifact via `_build_teacher_lesson_coaching_artifact_for` (`15642`) and returns a narrow dict: `id, video_id, teacher_id, analyzed_at`; `summary` = `teacher_visible_summary_text` (`teacher_lesson_coaching_artifact.py:2072`); `recommendations`/`teacher_feedback` only if `teacher_feedback_allowed` (`15652-15666`); `coaching_artifact` = `teacher_safe_artifact` which **strips `_coach_voice_admin`** (`:2056-2069`). **Explicitly excluded** (comment `15647-15650`): `element_scores`, `overall_score`, rubric labels. The payload is further scrubbed by `sanitize_teacher_feedback_projection` (`teacher_feedback_projection.py:507-535`) which removes scores/rubric codes/bands and "the teacher…" phrasing (`LEAKAGE_PHRASES` `:23-44`), converts to "you", and stamps `guardrails`.

**Admin branch** (`15674-15691`) returns full `AssessmentResult(**_enrich_assessment_for_response(...))` plus admin-only additive fields: `teacher_preview` = `admin_view_of_artifact` (`15684`) and `teacher_feedback_admin_status` (`15690`). `admin_view_of_artifact` (`teacher_lesson_coaching_artifact.py:2018-2053`) **adds** what the teacher branch strips: `element_scores, overall_score, raw_summary, raw_recommendations, analysis_confidence, coach_voice_diagnostics`.

**Net delta (admin − teacher):** scores, overall score, raw summary/recommendations, confidence, coach-voice diagnostics, admin status, full rubric labels — all admin-only.

---

## 5. INTELLIGENCE & EVIDENCE FLOW

### 5A. From raw analysis to narrative

**Generation (two grounding paths in `analyze_video`):**
1. **OpenCV/manifest (default OpenAI):** `build_moment_manifest` (`server.py:30102`, called `29521`) segments → scores → `select_lesson_moments` (`30120`) → per-moment `quality` via `compute_moment_quality` (`30136`).
2. **Gemini grounded-moments (analysis-first):** OpenCV build bypassed (`29519`); moments derived AFTER analysis from the model's cited `evidence_segments` by `gemini_moments.derive_moments_from_payload` (`gemini_moments.py:127-195`) + `build_gemini_moment_manifest` (`:215`, same quality gate `:266`); adopted at `server.py:29586-29597`. If no usable grounded moment survives → `AnalysisContractError` (`gemini_moments.py:274`) → fall through to OpenAI/heuristic.

**Storage:**
- `video_analysis_moments` — the grounded manifest (`server.py:29522-29526`, `29593-29604`).
- `assessment_evidence` — written by `_persist_assessment_evidence_from_scores` (`29342`, called `29749`); it **reads `element_scores[].evidence_segments`, NOT `video_analysis_moments`** (`29356-29387`); falls back to `_ensure_mock_evidence` if empty (`29399`).
- `assessments` — carries `element_scores` (with embedded `evidence_segments`), `observation_summary`, `analysis_quality`. **The grounded moment manifest is NOT embedded in the assessment doc.**

**Who reads the grounded `video_analysis_moments` manifest:** only `_maybe_generate_coach_voice` (`server.py:22894-22899`, inside the coaching-artifact builder) and the admin debug endpoint `get_admin_video_analysis_moments` (`server.py:13616-13624`). The teacher's structured `deep_dive`/`highlights` (`teacher_feedback_projection.py:350-371, 765-795`) and the admin's `_enrich_assessment_for_response` (`server.py:32625, 32652-32689`) read **only `element_scores`/embedded segments**, never the moments collection.

### 5B. Admin vs teacher access to grounded evidence — **CONFIRM (with nuance)**

Both teacher and admin artifacts are produced by the **identical builder** `_build_teacher_lesson_coaching_artifact_for` (`server.py:15642` teacher / `15679` admin), so the grounded moment manifest consulted for coach voice (`22894-22899`) is the same for both. The admin sees everything the teacher artifact contains **plus** raw `element_scores`+`evidence_segments`, `overall_score`, `analysis_quality`, `coach_voice_diagnostics` (`teacher_lesson_coaching_artifact.py:2032-2052`) **plus** a dedicated raw moments route (`server.py:13616`).

**Verdict: the admin has access to AT LEAST as much grounded evidence as the teacher, and strictly MORE.** The teacher is *not* shortchanged on grounded moments. The real nuance: **grounded `video_analysis_moments` evidence reaches the structured narrative of NEITHER persona's main projection** — it reaches only the coach-voice layer (both personas) and the admin debug endpoint (admin only). The admin's primary `AssessmentResult` is recomposed from `element_scores` alone (`_enrich_assessment_for_response` `32652-32689`), not from the persisted grounded-moment manifest. `[INFERRED from the absence of any `video_analysis_moments` read in `build_teacher_coaching_intelligence` and `_enrich_assessment_for_response`]`

### 5C. Template/label-composed text (not grounded)

1. **`generate_summary`** (`server.py:32718`) — score-only f-strings ("Overall performance: {level} ({score}/10)…", `32797-32816`). **Reaches admin** via `AssessmentResult`; stripped from teachers by `LEAKAGE_PHRASES`.
2. **`generate_recommendations`/`_build_recommendation_text`** (`32844`, `31237`) — keyword-templated coaching strings (`31245-31253`). **Reaches admin.**
3. **`generate_mock_scores`** (`31129`) — hard fallback on `fallback_model_*` (`31088-31096`): hardcoded recommendations + `random.uniform(5.2,7.4)` scores (`31149`). **Reaches end users** (admin always; teacher only if quality gate passes). `[INFERRED]`
4. **`_ensure_mock_evidence`** (`24656`, reached from `29399`) — synthesizes evidence from labels + arithmetic timestamps (`start_sec=120+idx*45`, `24696-24711`). **Reaches admin** verbatim; rewritten for teachers.
5. **`RUBRIC_TO_PRACTICE`** label dict (`teacher_lesson_coaching_artifact.py:90-247`) — static per-label next_step/practice, used by `_generate_action_item_from_rubric` (`:310-371`). **Reaches teacher** as action items composed from the rubric label, not a grounded moment.
6. **Static teacher fallbacks** in the projection (`teacher_feedback_projection.py:640-653, 258`). **Reach teacher.**
7. **Coach-voice empty/skip states** (`coach_voice_generation.py:762-772` → static copy `teacher_lesson_coaching_artifact.py:609-699`). **Reach teacher.**

---

## 6. COUPLING & STATE

### 6A. Mutable state outside the database

| State | Location | Holds | Breaks under >1 replica? |
|---|---|---|---|
| `VIDEO_JOB_QUEUE` / `VIDEO_TRANSCODE_JOB_QUEUE` / `VIDEO_PRIVACY_JOB_QUEUE` | `server.py:6439/6442/6444` | `asyncio.Queue[str]` of video IDs | **Yes** — per-process; api-process `put()` invisible to worker process (mitigated by DB-claim model below) |
| `VIDEO_*_WORKER_TASKS` | `6440/6443/6445` | running worker task lists | per-process registries |
| `POST_RATE_LIMIT_BUCKETS` | `6171` | `Dict[(ip,path)→(count,window)]` | **Yes** — per-replica counts; effective limit = N× |
| `ENDPOINT_RATE_LIMIT_BUCKETS` | `6190` | per-endpoint limiter incl. login/password-reset | **Yes** — **security-relevant**: brute-force limits bypassable across replicas; reset on deploy |
| `limiter` (slowapi) | `6438`, registered `6669` | in-memory storage backend | **Yes** — not Redis-backed |
| framework dicts, `DEMO_USERS`, `PAID_ANALYSIS_ALLOWLIST_EMAILS` | `5858, 6912, 6965, 6227` | static reference data | read-only, safe |
| `CacheClient.hits/misses/sets` | `app/cache.py:14-16` | per-process metric counters (cache *values* are Mongo-backed, safe) | metrics only `[INFERRED]` |

**`@lru_cache`:** `get_settings()` (`app/config.py:571`, maxsize=1 — config frozen per process at import); `eval_harness` (`app/analysis/eval_harness.py:76`).
**CSRF/session: stateless** — HMAC tokens (`auth_service.py:356-384`), JWT bearer/cookie; no server-side session store → **replica-safe**.
**Key mitigation:** job dispatch does not rely on the queue for correctness — workers claim via atomic `find_one_and_update({status:QUEUED})` (`server.py:12189-12206`). The `asyncio.Queue` is a per-process low-latency wake-up hint over the DB queue. `[INFERRED]`

### 6B. Tightest coupling points (ranked by fan-in)

| # | Symbol | Definition | Fan-in (approx) | Why hard to extract |
|---|---|---|---|---|
| 1 | **`server` module (`import server as legacy`)** | whole `server.py` | **32 files** | entire modular layer is a shell over the monolith |
| 2 | **`db` handle** | `server.py:5823` | **844** `db.` in server.py + **81** `legacy.db` in app/ | single global Motor handle; repos still reach through it |
| 3 | **`get_current_user`** | `auth_middleware.py:80` | **~325** refs | on nearly every route; depends back on `legacy.JWT_SECRET/db` |
| 4 | `legacy.HTTPException` | fastapi via legacy | **62** in app/ | modules reach error types through server |
| 5 | `_get_user_tenant_role`/`_get_user_role` | `server.py:676` | **73/71** refs | every authz decision |
| 6 | the three queues + enqueue/claim helpers | `6439/6442/6444`, `12176` | many | whole pipeline binds to module-level queues |
| 7 | `VideoProcessingStatus`/`PrivacyProcessingStatus` | server.py enums | **17/12** legacy refs | status vocabulary in server.py |
| 8 | `logger`/`log_structured` | server.py | **14/5** legacy refs | logging funnels through legacy |
| 9 | response models (`AssessmentResult`, `TeacherResponse`, `UserResponse`…) | server.py | **13/6**+ refs | schema layer in server.py |
| 10 | `UPLOAD_DIR` + `_sanitize_video_response` + `_log_privacy_audit_event` | `6431/3682` | **4/8/13** refs | fs path + response sanitization + audit in server.py |

`[INFERRED]` counts are textual-occurrence (grep), indicating magnitude, not exact call sites.

### 6C. Single-replica / single-process assumptions (hard blockers)

| Assumption | Location | Why it blocks scale-out |
|---|---|---|
| **Rehydration blindly resets ALL `PROCESSING` rows** | `server.py:12425-12447, 12481, 12545` — `update_many({status:PROCESSING}→QUEUED)` with **no instance/heartbeat filter** | **Hardest blocker.** With >1 worker replica, a restarting replica resets jobs another replica is actively processing → re-claim → **double analysis (duplicate GPT spend + duplicate assessments)**. Heartbeat fields exist but are ignored. Runs on **both** services' startup (`6457-6459`, `worker_entrypoint.py:25-27`) → every deploy re-triggers it. |
| **Local filesystem `/uploads`** | `UPLOAD_DIR` `server.py:6431`; `StaticFiles` mount `33921`; rehydration rebuilds `UPLOAD_DIR / file_path` `12472,12535` | **Hard blocker.** Video files live on one replica's disk; a worker on another replica can't read them, and StaticFiles serves only local files. S3 config exists (`config.py:276-287`) but the live path binds to local disk. |
| In-process rate limiters | `6171, 6190, 6438` | per-replica counts weaken login/password-reset limits linearly; reset on deploy |
| `@lru_cache get_settings()` | `config.py:571` | config snapshot frozen per process; env change needs full restart of every replica |
| In-memory queues | `6439-6444` | jobs not shared across replicas (mitigated by DB-claim) |
| Worker task registries | `6440/6443/6445` | no cross-replica view; effective workers = replicas × `VIDEO_WORKER_COUNT`, no global cap |

---

## 7. CONFIG & ENVIRONMENT

### 7A. Environment variables

Centralized in `Settings.from_env()` (`app/config.py:302-481`), cached by `@lru_cache get_settings()` (`:571`). `validate_startup()` (`:533-556`) raises ("fatal") for a few; the rest fall to silent defaults.

**Fatal-if-missing (production):** `MONGO_URL` (`:314`, fatal if empty `:536`), `DB_NAME` (`:315`, `:539`), `JWT_SECRET` (`:318`, **fatal in prod only** `:543` — empty in dev signs tokens with empty key), `CORS_ORIGINS` (`:304`, `:549`), `BACKEND_PUBLIC_BASE_URL` (`:308`, `:545`), `FRONTEND_URL` (`:309`, `:547`).

**Silent-default highlights (insecure or load-bearing):**
- `COOKIE_SECURE` default **`False`** (`:323`) — cookies over HTTP unless set.
- `OPENAI_API_KEY` (`:416`) / `EMERGENT_LLM_KEY` (`:418`) default `""` — analysis fails at runtime, **no startup check**.
- `OPENAI_VISION_MODEL` default `gpt-4.1-mini` (`:417`) — note: `EMERGENT_LLM_KEY` path uses hardcoded `gpt-5.2` (`server.py:20633`).
- `VIDEO_WORKER_COUNT` default 1 (`:398`, overridden 0/3 in railway.toml); `PRIVACY_WORKER_COUNT` default 1 (`:374`); `PRIVACY_MAX_RETRIES` default 3 (`:375`).
- `PRIVACY_TEACHER_MATCH_THRESHOLD`/`_AMBIGUOUS` defaults 0.9/0.8 (`:376-377`) — biometric thresholds defaulted in code.
- S3 vars (`:471-477`) default `""` → S3 disabled, falls back to local disk.

**Read directly in server.py (bypassing config):** `PRIVACY_BLUR_ALL_FULL_FRAME` (`6257`, **not in config.py**), `RAILWAY_REPLICA_ID/HOSTNAME` (`6441`), `/__build` SHA vars (`6782-6806`), and **`TEACHER_REFLECTION_SHARE_NUDGE_DAYS`** (`18419`, read via `os.environ.get`+`int()` at import with **no try/except** — a non-numeric value raises `ValueError` at import, unlike config's guarded `_env_int`).

**The silent OpenAI fallthrough (verified).** Provider selected at two sites with the same guard:
- `server.py:30994`: `if _effective_provider == "gemini" and APP_SETTINGS.ai.gemini_api_key:`
- `server.py:29513-29517`: `phase2_provider_is_gemini = (_effective_provider == "gemini" and bool(APP_SETTINGS.ai.gemini_api_key))`

If an operator sets `ANALYSIS_PROVIDER=gemini` but `GEMINI_API_KEY` is empty, the `and …gemini_api_key` clause is falsy, the **entire Gemini block is silently skipped**, and execution runs OpenAI identically — **with no error, warning, or log** at the selection site. The engine's own no-key guard (`gemini_engine.py:557-560`) never fires because the engine is never reached. The operator believes Gemini is active while every analysis runs on OpenAI. `[INFERRED design intent: the "keep today's behavior exactly" canary comment at `server.py:30985-30991`; the trade-off is a silent misconfiguration mode.]`

### 7B. Hardcoded values that should be config

- `support@cognivio.com` (`server.py:6693`) — and note domain mismatch with prod origins `*.cognivio.live`.
- Model names `gpt-4o-mini` (`24423`), `gpt-5.2` (`20633`); `temperature=0.4` (`24427`).
- `PRODUCTION_FRONTEND_ORIGINS` hardcoded in code (`33922-33926`), duplicating the `CORS_ORIGINS` env mechanism; `LOCAL_FRONTEND_ORIGINS` (`33927-33932`).
- **`to_list(N)` caps — 231 occurrences**, magic numbers throughout; rehydration caps at `to_list(2000)` (`12451` etc.) → **silently drops re-enqueue overflow beyond 2000**.
- Retry literal `3` in the claim query (`12185`), independent of `PRIVACY_MAX_RETRIES`; worker poll `timeout=5` (`12312`).
- Cost-per-million defaults `0.15`/`0.60` (`config.py:441-444`) — drift from real prices.

---

## 8. TEST SURFACE

87 `test_*.py` in `backend/tests/` (822 test functions), but architecturally **narrow**: almost entirely pure-unit/helper-level against **hand-rolled in-memory fakes**, no real DB, no real external services, no real end-to-end pipeline. **No `conftest.py` and no pytest config** anywhere — every file re-declares its own fakes inline.

### 8A. Inventory & coverage

Grouped: auth/tenancy (`test_tenancy_foundation.py`, `test_tenant_enforcement.py`, `test_tenancy_approval_flow.py`, `test_user_lifecycle_contract.py`, `test_login_lifecycle_safari.py`, `test_sensitive_query_scoping_audit.py`); master-admin (`test_master_admin_*.py` ×6); video pipeline (`test_video_upload_processing_pipeline.py`, `test_video_pipeline_helpers.py`, `test_video_transcode.py`, `test_video_actions.py`, +7); privacy (`test_privacy_pipeline.py`, `test_privacy_retry_invalidation.py`, +6); analysis/Gemini (`test_gemini_engine_phase1.py`, `test_gemini_moments_phase2.py`, `test_gemini_robustness_phase3.py`, `test_multimodal_analysis.py`, `test_analysis_*`); recognition/coach-voice; teacher artifact/coaching/projection (`test_teacher_feedback_view_projection.py` + ~13); dashboard/reports; ops/observability/notifications/health (`test_metrics.py`, `test_dependency_health.py`, `test_pr26_operational_hardening.py`, `test_access_notification_delivery.py`). Many files are named for a PR/hotfix — **regression-guard oriented**. Frontend: 35 `*.test.js` (routing/role gating, copy, API-client) — not backend contracts.

### 8B. Mock vs real

| Dependency | Status | Evidence |
|---|---|---|
| **MongoDB** | **Always faked** — inline `_FakeCollection`/`_Collection`/`_FakeDb` injected via `monkeypatch.setattr(server,"db",fake)` (115 call sites). Zero `mongomock`. | `test_tenancy_foundation.py:6-44`; `test_master_admin_endpoints.py:6-50` |
| **Gemini** | Always stubbed (`FakeGeminiClient`); static test asserts `google` never imported at module level | `test_gemini_engine_phase1.py:1-18` |
| **OpenAI / Resend / S3(boto3)** | All mocked (fake `AsyncOpenAI`, swapped `httpx`, synthetic `boto3` module) | `test_dependency_health.py:106,163`; `test_access_notification_delivery.py:18-26` |
| `unittest.mock` AsyncMock/MagicMock | **Not used at all** — all doubles hand-rolled | repo-wide |
| Real video bytes | One path: `test_privacy_pipeline.py:30-44` writes a real mp4 via `cv2.VideoWriter`, but face detection is monkeypatched | |
| `TestClient` | ~6 files, always with a monkeypatched fake `server.db` | `test_pr26_operational_hardening.py:119` |

**Nothing runs `analyze_video` / the pipeline end-to-end. The AI is always stubbed.** No test drives upload → transcode → privacy → analysis → persistence as one flow.

### 8C. Biggest untested risk areas

1. **HTTP boundary largely untested** — 254 route decorators, ~6 `TestClient` files; nearly all handlers' validation/dependency-wiring/status-codes/response-model serialization are never invoked through ASGI. `[INFERRED]`
2. **Worker restart / rehydration almost uncovered** — only `_rehydrate_video_privacy_queue` has a test (`test_video_pipeline_helpers.py:352`); processing/transcode rehydration, queue-consumer loops (`server.py:12312-12386`), and `worker_entrypoint.py`/`app/workers/*` are **never imported by any test**.
3. **Concurrency/races structurally untestable as written** — zero `asyncio.gather`/`create_task`/threads in tests; single-threaded fakes can't reproduce Mongo atomicity. Two-worker double-claim, retry-vs-validation races: no coverage.
4. **No transactional guarantees** — zero `start_session`/`with_transaction` in server.py; multi-doc transitions are non-atomic and the "torn write" failure class is invisible to the suite.
5. **Index correctness unverified** — zero `create_index` against Mongo in server.py/repos; a health endpoint *reports* missing indexes (`test_pr26_operational_hardening.py:100`) but nothing verifies required indexes exist or that hot tenant queries are backed.
6. **Projection fork tested only as a pure function**, not driven from a real assessment through the route-level teacher-vs-admin fork. `[INFERRED]`
7. **WebSocket/streaming untouched** — 14 `websocket`/`StreamingResponse` refs, no test. `[INFERRED]`
8. **Monolith-vs-module duplication** — tests import from both trees; a test against the `app/` copy gives no assurance about the `server.py` copy serving traffic. `[INFERRED]`

---

## 9. FINDINGS (recommendations only)

### 9A. Top 10 scale blockers (ranked by severity)

1. **Local-disk `/uploads` for video storage** — `server.py:6431, 33921`; rehydration rebuilds local paths (`12472`). Files bind to one replica's disk; workers/static-serving on other replicas can't reach them. *S3 config already exists (`config.py:276-287`) — the path just isn't wired through. This is the #1 blocker to running more than one replica at all.*
2. **Rehydration blindly resets all `PROCESSING` rows with no instance/heartbeat filter** — `server.py:12425-12447, 12481, 12545`, run on both services' startup. With >1 worker, restarts reset in-flight jobs → double analysis (duplicate LLM spend + duplicate `assessments`).
3. **The 33,990-line `server.py` god-module** — `db` (844 refs), `get_current_user` (~325), role helpers (~73), 32 importers. Every change risks the whole surface; no module can be deployed or scaled independently.
4. **In-process rate limiters** — `server.py:6171, 6190, 6438`. Login/password-reset brute-force limits multiply by replica count and reset on every deploy — a security regression under horizontal scale. Needs a shared (Redis/Mongo) backend.
5. **No live job reclaimer + no critical-path timeouts** — `claimed_by`/`last_heartbeat` written but never read (`12196-12231`); OpenAI vision/S3 calls have no explicit timeout (`30896`, `3771`). A hung AI call strands a job `PROCESSING` until a manual restart.
6. **High-traffic collections with zero indexes** — `notifications` (`$or`+sort+`skip()` paging, `server.py:26051`) and `schedules` (`21653, 23298, 28920`) have **no `INDEX_SPECS` entry**; at 3,000 users these degrade to full scans on hot paths.
7. **Tenant composite indexes that can never be used** — `videos`/`assessments` indexes key on `organization_id`/`school_id`/`workspace_id` (`ensure_indexes.py:74,83`) but those fields are never written at insert. Tenant-scoped reads scan.
8. **Admin diagnostic endpoints co-load full `users`+`teachers`+`videos`** (`server.py:2166-2168, 28090-28091, 28301-28328`) at 5k–10k caps per request — O(tenant size) per call, no pagination.
9. **Non-idempotent assessment writes + manual-only failure recovery** — duplicate `assessments`/`assessment_evidence` on re-run (`29734`, no guard); transcode-failed / privacy-review / attempts-exhausted paths require manual retry (§3D 2-6).
10. **Silent provider downgrade** — `ANALYSIS_PROVIDER=gemini` with empty `GEMINI_API_KEY` runs OpenAI with no log (`server.py:30994, 29513`). Operationally invisible cost/quality misconfiguration.

### 9B. The 5 cleanest strangler seams

1. **Video storage behind a `StorageGateway` interface.** `_get_s3_client`/`_upload_path_to_s3`/`download_s3_key_to_file` (`server.py:3771-3968`) plus `UPLOAD_DIR`/StaticFiles are already a narrow, well-bounded surface. Lifting them behind one interface (local vs S3 implementations) unblocks blocker #1 with minimal disturbance and is already half-modeled by `app/services/storage_urls.py`.
2. **The job-queue/worker subsystem** (`server.py:11926-12571` + `app/workers/*`). It already persists state in dedicated Mongo collections and is reached through `_enqueue_*`/`_claim_*` helpers. Replacing the `asyncio.Queue` + rehydration with a durable broker (or a Mongo-backed claim loop with a heartbeat reclaimer) behind those same helper signatures fixes blockers #2 and #5 without touching route handlers.
3. **`get_current_user` / auth** is *already extracted* (`app/middleware/auth_middleware.py`) and is the single resolver app-wide. Formalizing it (move `JWT_SECRET`/role helpers out of `legacy`) detaches every route's auth dependency from the monolith — high leverage, low blast radius.
4. **The teacher/admin projection layer** (`app/analysis/teacher_feedback_projection.py`, `app/services/teacher_lesson_coaching_artifact.py`) is functionally pure and already module-resident; the only coupling is the fork call site at `server.py:15640-15691`. Extracting an `AssessmentProjectionService` behind that fork is clean.
5. **The five already-written-but-unmounted routers** (`assessments`, `teachers`, `privacy`, `recognition`, `exemplars` in `app/routers/`). The extraction work is done; they just aren't wired in. Mounting them one at a time (shifting the matching routes off `api_router`) is the most literal strangler step available — the seam already exists in code.

---

### Audit notes
- An untracked probe file `backend/_probe_unsafe_5849a3b9.py` is present (per `git status`). It was **not** read, run, or modified during this audit and is outside the audited surface; it appears to be leftover from a prior session and is worth removing.
- This audit reflects `server.py` as committed on branch `fix/signup-collection-bool-crash`. `CLAUDE.md` is materially stale (server.py LOC, route list, model name) and should not be used as a structural reference.
