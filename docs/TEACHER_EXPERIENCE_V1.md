# Teacher Experience v1

Teacher Experience v1 turns the teacher side of Cognivio into a connected professional workspace for internal testing and demo rehearsal.

## Teacher IA

Canonical teacher routes:

- My Workspace: `/my-workspace`
- Lessons: `/my-lessons`
- Coaching: `/my-coaching`
- Recognition: `/my-badges`
- Teacher Profile: `/my-profile`

Compatibility aliases route safely to the canonical surfaces where needed, including `/teacher/profile`, `/teacher/lessons`, `/lessons`, `/coaching`, and `/recognition`.

## Shared Readiness

Teacher pages use the shared readiness object returned by `/api/teachers/me/profile` and `/api/teachers/me/dashboard`:

- `teacher_profile_complete`
- `consent_complete`
- `privacy_reference_images_ready`
- `privacy_reference_image_count`
- `can_record`
- `can_receive_blur_processing`
- `missing_items`

Pages use `missing_items` for targeted next steps instead of separate profile loops.

## Teacher Profile And Reference Images

`/my-profile` supports editable teaching details:

- display name
- grade level
- class or section
- primary subject
- subjects taught
- professional stage
- privacy and consent summary
- privacy reference images

Teacher reference images can be uploaded, previewed, listed, and deleted through:

- `GET /api/teachers/me/reference-images`
- `POST /api/teachers/me/reference-images`
- `DELETE /api/teachers/me/reference-images/{image_id}`

Reference image metadata is stored with teacher, user, workspace, status, and storage fields. The blur pipeline can query ready/uploaded references through `get_teacher_reference_images_for_blur(teacher_id, workspace_id)`.

This PR wires reference-image storage and readiness. It does not claim production face matching or final privacy certification.

## Recording Flow

Teacher users recording their own lessons no longer need to select themselves from a teacher dropdown. The upload flow infers the current teacher and stores:

- lesson title/topic
- subject
- class/section
- reference image availability
- reference image count
- privacy blur teacher-match readiness status

Admin and supervisor users still select a teacher.

## Lessons Hub

`GET /api/teachers/me/lessons` supports search and filters:

- `q`
- `status`
- `subject`
- `period`

Lesson cards include title, subject, class/section, status, summary, shared moment count, and links back to video review.

## Coaching Hub

`GET /api/teachers/me/coaching` returns:

- next best action
- active goals
- actionable feedback
- moments to revisit
- teacher reflections
- suggested improvements
- upcoming meetings

Teachers can add structured reflections through `POST /api/teachers/me/reflections`. Replies to shared moments are stored as reflections linked to `comment_id`. Generic chat remains deferred.

## Recognition Hub

`GET /api/teachers/me/recognition` returns Cognivio accolades, highlighted moments, spotlight lessons, badges, share cards, and a summary. Recognition stays tied to real badge/video records where available.

## Teacher Dashboard, Search, And Trends

`GET /api/teachers/me/dashboard` powers the command center:

- next best action
- latest lesson
- highlights
- action items
- trends
- schedule
- gradebook reminders
- reports
- readiness

`GET /api/teachers/me/search?q=` searches lessons, shared moments, goals, reflections, recognition, gradebook reminders, and report items.

## Gradebook Reminders

Gradebook reminders are LMS-ready demo/internal records only. The teacher UI uses “Gradebook reminders” and every reminder includes:

“Demo reminder — LMS sync is not connected yet.”

Real LMS integration remains deferred.

## Demo Seeding

`POST /api/demo/seed` supports:

- master-admin global demo seeding when `DEMO_MODE=true`
- teacher-safe “Fill my demo workspace” for demo teacher accounts/workspaces
- demo workspace fill for demo/internal users only

Seeded teacher data is connected across Workspace, Lessons, Coaching, Recognition, Teacher Profile, Record/upload metadata, and Search.

## Cross-Page Synchronization

The same seeded teacher/video/comment/task/reflection/recognition/reminder records appear across:

- latest lesson on My Workspace
- Lessons cards
- Coaching moments to revisit
- Recognition highlighted moments
- Search results
- Record/upload subject and class options
- Profile reference-image readiness

## Deferred

- Full privacy/security hardening and tenant audit
- Production face matching certification
- Real LMS integration
- Generic chat
- Backend decomposition
- Production use of reference images without the follow-up privacy hardening PR
