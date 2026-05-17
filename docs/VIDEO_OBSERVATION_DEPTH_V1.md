# Video Observation Depth v1

This PR turns video review into a structured observation surface for internal testing. It connects saved observation focus, lesson playback, timestamped notes, talk-time, transcript review, and demo data without changing the PR #9 lifecycle contract or the PR #13 mobile upload path.

## What Was Implemented

- Mounted video comment endpoints under `/api/videos/{video_id}/comments`.
- Added timestamped comment visibility states:
  - `observer_private`
  - `shared_with_teacher`
  - `admin_only`
- Added comment workspace, organization, teacher, and observation-session context.
- Added one-level replies, edit, and soft-delete behavior.
- Mounted `/api/videos/{video_id}/audio-analysis`.
- Added frontend comment thread and timeline marker components.
- Added talk-time, audio timeline, and transcript panels on the video player.
- Linked video review to observation-session focus context when a video has `observation_session_id`.
- Updated demo seed data with observation notes, focus context, talk-time, and transcript metadata.

## Routes And Components

Backend endpoints:

- `GET /api/videos/{video_id}/comments`
- `POST /api/videos/{video_id}/comments`
- `PATCH /api/videos/{video_id}/comments/{comment_id}`
- `DELETE /api/videos/{video_id}/comments/{comment_id}`
- `GET /api/videos/{video_id}/audio-analysis`

Frontend components:

- `frontend/src/components/VideoCommentThread.js`
- `frontend/src/components/VideoTimelineMarkers.js`
- `frontend/src/components/TalkTimeChart.js`
- `frontend/src/components/AudioTimeline.js`

Updated video review route:

- `/videos/:videoId`

## Comment Visibility Rules

Teachers see only notes marked `shared_with_teacher` for their own visible videos.

School and training admins see:

- their own private observer notes
- shared teacher-facing notes
- admin-only notes in their visible workspace

Super admins can see visible comment records through the existing video access path. Video access still runs through the existing teacher/video visibility checks, so comments do not become a bypass around workspace scoping.

Deletes are soft deletes through `deleted_at`, so removed comments no longer appear in the active thread while preserving a future audit path.

## Observation Focus In Video Review

When the video includes `observation_session_id`, the player fetches that session and shows:

- focus areas
- focus note

The add-note form can tag a comment with one of the saved focus areas. If no session is linked, the video review page simply hides the focus banner.

## Audio, Talk-Time, And Transcript Behavior

The audio-analysis endpoint returns a calm empty response when audio artifacts are missing. The frontend shows:

> Talk-time details will appear here after audio review is complete.

When audio artifacts exist, the player can show:

- teacher/student/quiet percentages
- an audio timeline strip
- key-moment pins
- transcript rows with clickable timestamps

If student voice processing is disabled, student transcript text is suppressed and the UI explains that the transcript is hidden based on the workspace privacy setting.

## Demo Seed Updates

`backend/scripts/seed_demo_data.py` now seeds:

- K-12 demo video comments
- training demo video comments
- observation-session context linked to demo videos
- audio feature records
- transcript records

The script remains idempotent and only resets data marked with `demo_data=true` and the selected `demo_persona`.

## Deferred

- True resumable or chunked upload.
- Full FERPA/privacy hardening from future PR #14.
- Backend decomposition from future PR #16.
- Full production dashboard intelligence from future PR #17.
- Advanced comment analytics.
- Full human transcript correction workflow.
- Automatic “turn into coaching task” creation from comments; the current coaching task API does not expose a safe create endpoint for that flow yet.
