# Pilot Privacy Validation Pack

Date: 2026-03-18

## Purpose

This pack defines the exact privacy validation process for the teacher-only visibility feature.

Use it before broad pilot rollout and again before launch.

The feature passes only if:

1. No known non-teacher face is visible in final playback.
2. No known non-teacher face is visible in final thumbnails.
3. Standard user flows cannot access raw assets.
4. Ambiguous videos enter the privacy review queue instead of silently shipping.
5. Review and retry operations are manageable by the pilot team.

## Scope

Validate the current MVP privacy implementation in:

- [backend/server.py](/C:/Projects/Cognivio/backend/server.py)
- [backend/privacy_pipeline.py](/C:/Projects/Cognivio/backend/privacy_pipeline.py)
- [frontend/src/pages/PrivacyReviewQueuePage.js](/C:/Projects/Cognivio/frontend/src/pages/PrivacyReviewQueuePage.js)
- [frontend/src/pages/VideoPlayerPage.js](/C:/Projects/Cognivio/frontend/src/pages/VideoPlayerPage.js)
- [frontend/src/pages/VideosPage.js](/C:/Projects/Cognivio/frontend/src/pages/VideosPage.js)

## Required Roles

1. Privacy validation lead
2. Admin reviewer
3. Teacher test user
4. QA recorder or observer
5. Engineering on-call owner

## Required Environment

1. Staging environment using the same backend and frontend commit SHA intended for pilot.
2. `PRIVACY_REQUIRE_PROFILE=true`
3. `PRIVACY_MANUAL_REVIEW_ENABLED=true`
4. `PRIVACY_ALLOW_BLUR_ALL_FALLBACK=true`
5. Privacy workers enabled and stable.
6. Audit endpoint and raw-access endpoint enabled for admin users.

## Pre-Validation Setup

1. Create at least 6 pilot teachers with completed privacy profiles.
2. For each teacher, upload `3-5` clear profile reference photos.
3. Confirm each teacher returns `status: active` from `GET /api/teachers/{teacher_id}/privacy-profile`.
4. Verify admin ops readiness:
   - `GET /api/admin/ops/readiness`
   - `teachers_missing_privacy_profiles == 0`
5. Confirm privacy review queue is empty before starting:
   - `GET /api/privacy/review-queue`

## Dataset Requirements

Run validation against at least 30 real or realistic classroom recordings. Minimum composition:

1. `6` videos with teacher mostly front-facing.
2. `6` videos with teacher side-profile or turning frequently.
3. `4` videos with teacher partially occluded.
4. `4` videos with high student density.
5. `3` videos with low-light or uneven lighting.
6. `3` videos with camera movement or handheld shake.
7. `2` videos where the teacher leaves frame for meaningful periods.
8. `2` videos with posters, projected faces, or printed faces in room.

Stretch cases if available:

1. Teacher wearing mask, hat, or glasses not present in reference images.
2. Similar-looking adult in frame.
3. Classroom aide or co-teacher entering frame.

## Validation Matrix

Each video must be logged with:

1. `video_id`
2. `teacher_id`
3. Scenario tags
4. Privacy profile version used
5. Final `privacy_status`
6. Final `analysis_status`
7. Whether review was required
8. Whether blur-all fallback was used
9. Whether any non-teacher face remained visible
10. Whether teacher remained visible when expected
11. Thumbnail safe or unsafe
12. Raw asset access blocked for standard user
13. Reviewer notes

## Exact Validation Steps Per Video

1. Upload the recording as an admin or teacher through the normal product flow.
2. Confirm upload is accepted only if the teacher privacy profile exists.
3. Track status transitions:
   - `queued`
   - `privacy processing`
   - `review_required` or `completed`
   - `analysis processing`
   - `completed`
4. Open the video from the standard player as an admin.
5. Review at least:
   - opening frame
   - midpoint
   - end segment
   - one student-dense segment
6. Confirm all non-teacher faces are blurred.
7. Confirm the teacher face remains visible when confidently identified.
8. Confirm thumbnail is privacy-safe.
9. Confirm copied timestamp link opens the same redacted asset.
10. Confirm raw asset is not exposed in:
   - normal video detail response
   - player source
   - videos list response
11. Log the result in the validation worksheet.

## Review Queue Validation

Intentionally produce at least 5 ambiguous cases and validate:

1. Video enters `review_required`.
2. Video appears in `GET /api/privacy/review-queue`.
3. Video appears on the privacy review page.
4. `approve_teacher_track` re-queues privacy and eventually completes.
5. `blur_all_and_continue` re-queues privacy and eventually completes.
6. `rerun` re-queues privacy without losing audit history.
7. `reject_video` leaves the video blocked and auditable.

## Raw Access Validation

For at least 3 pilot videos:

1. As a normal teacher user:
   - verify no raw URL appears in standard responses or UI
   - verify no player fallback reaches the raw file
2. As an admin:
   - call `GET /api/videos/{video_id}/raw-access`
   - verify the endpoint returns a URL only for admins
   - verify an audit event is written to `GET /api/privacy/audit`

## Audit Validation

For at least one teacher and three videos, verify audit entries exist for:

1. profile enrollment
2. video upload queued for privacy
3. privacy review required
4. privacy review resolved
5. privacy retry queued
6. privacy completed or failed
7. raw asset accessed

## Retention and Purge Validation

Use a short retention window in staging and verify:

1. teacher reference images are purged after expiry
2. raw uploaded videos are purged after expiry
3. redacted assets remain available after raw purge
4. purge actions create privacy audit entries

## Pass / Fail Criteria

The pilot privacy feature passes only if all are true:

1. `0` known non-teacher face exposures in final playback.
2. `0` known thumbnail exposures.
3. `0` standard-user raw asset exposures.
4. `100%` of ambiguous videos route to review or blur-all fallback.
5. Privacy review backlog remains within staffed capacity.
6. Raw purge works without breaking redacted playback.

## Blockers

Stop rollout immediately if any of these occur:

1. A non-teacher face is visible in customer-visible playback.
2. A non-teacher face is visible in a thumbnail.
3. A standard user can access a raw asset.
4. Privacy review actions do not leave an audit trail.
5. Privacy queue stalls and does not recover with normal retry procedures.

## Exact Signoff

Required signoff owners:

1. Engineering owner
2. Product owner
3. QA/privacy validation lead

Each owner must explicitly sign off on:

1. playback privacy
2. thumbnail privacy
3. access control
4. operational review flow
5. retention and purge behavior

## Validation Worksheet Template

Copy this into the pilot log for each video:

```text
video_id:
teacher_id:
scenario_tags:
privacy_status:
analysis_status:
review_required:
review_decision:
blur_all_fallback:
teacher_visible_expected:
teacher_visible_actual:
non_teacher_exposure_found:
thumbnail_safe:
raw_access_blocked_for_standard_user:
audit_entries_verified:
notes:
signoff:
```
