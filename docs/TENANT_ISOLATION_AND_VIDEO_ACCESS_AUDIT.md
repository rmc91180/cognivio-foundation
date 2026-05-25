# PR 26 Pass 4 Tenant Isolation and Video Access Audit

This document records the PR 26 Pass 4 implementation for tenant isolation, video access, unblurred access auditing, demo/real boundaries, and sensitive query scoping.

## Role Boundary Matrix

| Role | Allowed baseline access | Explicit limits | Audit expectations |
|---|---|---|---|
| Teacher | Own teacher profile, own videos, own shared lesson comments, own coaching/reflection/recognition surfaces, own reference images. | Cannot access another teacher's video, transcript, audio analysis, comments, coaching tasks, recognition, or reports unless a route explicitly shares the item. | Cross-tenant denials emit `cross_tenant_access_denied`; own video views emit `video_viewed`. |
| School admin | Teachers, videos, reports, coaching, recognition, framework settings, and comments scoped to the admin's school/workspace/organization. | Cannot access another school or organization tenant. Private observer comments are visible only to the author unless already shared/admin scoped. | Video, transcript/audio, unblurred, report-export, and denial events are audited. |
| Training admin | Trainees, observations, coaching, reports, and recognition scoped to the training workspace/program organization. | Cannot access school tenant data or another training program unless explicitly assigned through the same organization/workspace. | Same as school admin. |
| Master Admin / super_admin | Global platform surfaces through explicit Master Admin routes only. | Global access should not be implicit through normal school/training routes; sensitive global access needs a Master Admin guard. | Master/global routes remain documented exceptions for the query scanner and should emit Master Admin audit events where operationally relevant. |
| Support/internal | No implicit unblurred access. | Unblurred support access requires tenant authorization, an explicit reason, and audit events. | `support_unblurred_access_granted`, `support_unblurred_access_denied`, and `unblurred_video_viewed`. |

## Sensitive Data Matrix

| Data type | Scope authority | Current Pass 4 status |
|---|---|---|
| Videos and playback metadata | `teacher_id` plus teacher visibility helper | Scoped through `_get_teacher_or_404` and video service helpers. |
| Unblurred/raw video source | Tenant admin plus explicit access reason | Hardened in Pass 4; reason is required and grant/deny events are audited. |
| Comments and timestamp markers | Source video access plus visibility rules | Scoped by `_get_visible_video_or_404` and `_comment_visibility_query`. |
| Transcripts and audio/talk-time | Source video access | Admin transcript/audio debug routes and teacher/admin audio-analysis route audit access. |
| Reports and CSV exports | Dashboard base teacher IDs | Snapshot exports build from tenant-scoped teacher IDs and now emit `report_exported`. |
| Coaching notes/tasks/reflections | Teacher ID and visible coaching task helper | Teacher self routes and dashboard reports use teacher-scoped queries. |
| Recognition moments/badges | Teacher/video visibility | Review queue query is now teacher-ID scoped before per-video verification. |
| Teacher reference images | Current teacher/workspace | Existing self-profile routes scope by current teacher and workspace; Pass 4 tests document expected boundary. |
| Framework settings | User/workspace selection | Framework payloads use current workspace/user selection; query audit flags any future unscoped access. |
| Gradebook reminders | Teacher/workspace | Demo/internal placeholder remains scoped by teacher/workspace. |
| Demo seed records | `demo_data=true`, persona, and current scope | Existing seed route denies non-demo users/workspaces; Pass 4 adds audit events for seed execution. |
| Audit logs | Target and guarded admin route | Privacy audit listing remains an area for Pass 5 triage; scanner flags list routes as advisory. |

## Route Coverage

Pass 4 verified and/or hardened these route families:

- `/api/videos`, `/api/videos/{video_id}`, `/api/videos/{video_id}/status`
- `/api/videos/{video_id}/raw-access`
- `/api/videos/{video_id}/comments`
- `/api/videos/{video_id}/audio-analysis`
- `/api/admin/videos/{video_id}/audio-transcript`
- `/api/admin/videos/{video_id}/audio-features`
- `/api/reports/coaching-snapshot`
- `/api/reports/cohort-snapshot`
- `/api/reports/export/coaching-snapshot.csv`
- `/api/reports/export/cohort-snapshot.csv`
- `/api/recognition/review-queue`
- `/api/demo/seed`

## Video Access Rules

Normal video metadata access uses the teacher visibility policy:

- teacher own video: allowed,
- teacher other video: denied with controlled `403` and `reason_code=forbidden_tenant_access`,
- same-tenant school/training admin video: allowed,
- cross-tenant admin video: denied and audited,
- transcript/audio access follows source video access,
- comments follow source video access plus visibility rules,
- recognition follows source teacher/video scope.

## Unblurred Access Rules

Unblurred/raw video access is intentionally stricter than normal playback:

- caller must be an administrator role in the same tenant,
- caller must provide a specific support/privacy reason,
- deleted unblurred source state returns 404,
- missing raw source returns 404,
- successful access emits `unblurred_video_viewed` and `support_unblurred_access_granted`,
- missing reason, deleted source, and missing source emit `support_unblurred_access_denied`.

This pass does not add a support override role. Any future support override must be explicit, time-bound, tenant-approved, and audited.

## Audit Event Coverage

Implemented or verified events:

- `video_viewed`
- `unblurred_video_viewed`
- `transcript_viewed`
- `audio_analysis_viewed`
- `report_exported`
- `cross_tenant_access_denied`
- `support_unblurred_access_granted`
- `support_unblurred_access_denied`
- `demo_seed_executed`

`video_downloaded` remains reserved for a future route that performs direct video/download streaming. Current raw access returns an access URL and logs unblurred view/access events.

## Demo/Real Boundary Rules

- Non-demo teachers/admins cannot seed demo data.
- Demo teachers can seed only their current teacher demo workspace.
- Demo school/training admins can seed only the current workspace.
- Master Admin global seed/reset remains gated by `DEMO_MODE` and confirmation.
- Demo seed writes are idempotent through deterministic IDs/upsert behavior.
- Real dashboard counts exclude `demo_data=true` teachers unless the current workspace/user is demo.
- Demo seed execution now emits a privacy/audit event with persona, scope, and counts.
- Demo records remain marked `demo_data=true` and `demo_persona`.

## Sensitive Query Audit Script

New script:

```powershell
python backend/scripts/audit_sensitive_query_scoping.py
```

Useful options:

```powershell
python backend/scripts/audit_sensitive_query_scoping.py --json
python backend/scripts/audit_sensitive_query_scoping.py --strict
python backend/scripts/audit_sensitive_query_scoping.py backend/app/services
```

The script statically scans backend Python files for direct Mongo-style calls on sensitive collections. It is advisory by default because variable-built queries and Master Admin/global health routes create false positives. Use:

- `# tenant-scope-ok: reason` for intentionally scoped dynamic queries the scanner cannot infer,
- `# master-admin-scope-ok: reason` for explicitly guarded global routes.

Pass 4 scan result:

- `97` advisory/warning findings in default mode.
- The result is documented for Pass 5 triage; strict mode is intentionally not enabled by default yet.

## Known Exceptions And Follow-Up

- Master Admin/global platform routes legitimately read across tenants but need more inline exception comments and audit verification in Pass 5.
- Privacy audit listing currently remains admin guarded but should be further scoped or explicitly documented in Pass 5.
- Some repository functions accept query variables that are scoped by callers; the scanner flags those as advisory until annotated.
- Physical unblurred source deletion remains deferred from Pass 3 and is not completed here.

## Tests Added

Backend tests added:

- teacher cross-video denial and audit,
- same-tenant admin video allowed/cross-tenant denied,
- audio analysis follows video access,
- comments scoped by tenant and visibility,
- unblurred access requires reason and logs grant/deny,
- dashboard/report counts exclude demo and other tenant data,
- deleted/tombstoned teachers excluded from active tenant lists,
- sensitive query scanner detects a known unscoped sample and ignores documented exceptions.

Frontend targeted tests were run for:

- tenant forbidden message mapping,
- school/training/teacher demo seed visibility and mutation calls.

## Manual Verification Checklist

1. Login as a teacher and open an owned video; confirm it loads and no raw URL is exposed.
2. Try another teacher's video ID and confirm controlled access denial.
3. Login as school admin and open a same-school video.
4. Try a video from another school/workspace and confirm controlled denial.
5. Open audio-analysis/transcript routes for same-tenant and cross-tenant videos.
6. Confirm shared comments are visible to the teacher and observer-private comments are not.
7. Call `/api/videos/{video_id}/raw-access` without `reason` and confirm `422`.
8. Call raw access with a reason as same-tenant admin and confirm an audit event is written.
9. Export coaching/cohort CSV reports and confirm rows are scoped to the current tenant.
10. Seed demo data as eligible teacher/admin and confirm audit event plus scoped refresh.
11. Confirm non-demo users do not see seed controls and receive 403 if calling seed directly.
12. Run `python backend/scripts/audit_sensitive_query_scoping.py --limit 50` and triage new findings.
