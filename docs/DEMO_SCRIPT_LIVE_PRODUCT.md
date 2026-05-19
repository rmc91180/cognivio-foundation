# Live Product Demo Script

## Pre-demo Checklist

- Confirm Railway is deployed from the latest protected `main`.
- Confirm `DEMO_MODE` status before using reset controls.
- Seed or reset demo data for the right persona.
- Confirm demo login accounts and passwords.
- Set browser zoom to 100%.
- Open the demo once on desktop and once around a 390px mobile viewport.

## 8-minute K-12 Walkthrough

1. Onboarding/setup assistant: show the next step and the setup checklist.
2. Add first teacher: add or point to the first demo teacher.
3. Observation setup: choose a teacher, select one to three focus areas, and save the observation focus.
4. Record/upload: open `/record` from the saved observation and connect the recording.
5. Latest lesson/video review: open video comments, talk-time, and the coaching summary.
6. Coaching task/reflection and recognition: show the follow-up loop.
7. Dashboard intelligence and reports: show priorities, patterns, and CSV export.
8. Demo reset/master admin: show internal readiness, demo controls, and AI quality.

## Video Observation Depth Moment

Use this short sequence inside either walkthrough after opening a reviewed lesson video:

1. Open the demo video from the teacher profile, workspace, or video list.
2. Point out the observation focus banner: "You were watching for..."
3. Click a timeline marker and show how the video jumps to that note.
4. Add a note at the current time and choose whether it stays private, is shared with the teacher, or is admin-only.
5. Open the talk-time tab and describe it as a starting point for the coaching conversation.
6. Open the transcript tab and click a timestamp.
7. If asked about turning notes into coaching tasks, say: "That connection is planned, but this PR keeps task creation out until the backend exposes a safe create endpoint."

## Dashboard and Reports Intelligence Moment

Use this sequence when showing the internal-testing admin flow:

1. Start from `/onboarding` or the dashboard setup assistant.
2. Add the first teacher or trainee.
3. Plan the first focused observation.
4. Record/upload the lesson or observation.
5. Review video comments and talk-time.
6. Open `/dashboard` as the school admin and start with "Today's coaching priorities."
7. Open a "Patterns worth noticing" card and point to the recommended next action.
8. Use an observation gap row to plan a focused observation for one teacher.
9. Open `/reports` and show the Coaching Snapshot summary.
10. Export the coaching snapshot CSV and explain that it is an internal planning artifact, not a teacher-facing score report.

## 8-minute Training Walkthrough

1. Onboarding/setup assistant: show trainee setup progress.
2. Add first trainee or open the seeded cohort.
3. Observation setup: save a focus for a placement observation.
4. Record/upload: connect the observation recording.
5. Latest observation feedback: open video comments, talk-time, and the summary.
6. Coaching/reflection: show the follow-up task loop.
7. Reports: show the cohort snapshot and export CSV.
8. Master admin: verify internal readiness, demo mode, and AI quality monitoring.

## Teacher Experience Walkthrough

1. Open `/my-workspace` as a demo teacher and click “Fill my demo workspace” if the page needs data.
2. Use search to find a lesson moment, coaching goal, recognition item, or gradebook reminder.
3. Open `/my-lessons`, filter by reviewed lessons, and open a recording.
4. Open `/record` and show that the teacher is implied; add a lesson title, subject, and class/section.
5. Open `/my-profile`, edit subjects/classes, and add a privacy reference image.
6. Open `/my-coaching`, add a reflection to a goal or shared moment.
7. Open `/my-badges` and show Cognivio accolades, highlighted moments, and spotlight lessons.
8. Point out that gradebook reminders are demo placeholders and that LMS sync is not connected yet.

## Common Objections

Teachers won't want to be recorded.

Response: "That concern is real. Cognivio is designed around consent, privacy review, and coaching usefulness. The point is not surveillance; it is helping teachers get specific feedback they can use in the next lesson."

How is this different from GoReact or Vosaic?

Response: "Those tools are strong for video capture and annotation. Cognivio focuses on turning reviewed lessons into a role-personalized coaching loop: priorities for admins, a daily workspace for teachers, and coach-voice feedback that does not feel like a rubric report."

Is this just ChatGPT?

Response: "No. The product wraps AI in role permissions, observation focus, privacy checks, eval gates, and master-admin quality monitoring. The AI is one part of a larger coaching workflow."

Is it FERPA/privacy safe?

Response: "The pilot includes consent and privacy gates, retention controls, protected routes, and master-admin dependency health. Final production use still needs the district or program's own policy review."

What happens when the AI is wrong?

Response: "The workflow keeps people in the loop. Admins can review the lesson, teachers can reflect, and master admins can monitor quality trends and coach voice issues. The system is designed to support judgment, not replace it."

How long does setup take?

Response: "For a pilot, setup is intentionally lightweight: create the organization, add users or demo data, confirm privacy settings, and start with a focused observation. Deeper integrations can come after the pilot proves value."
