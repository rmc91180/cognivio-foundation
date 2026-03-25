# Cognivio Demo Cheat Sheet

Date: 2026-03-24
Audience: Teacher training program leaders using Cognivio to augment teacher observation
Recommended demo length: 10 minutes

## Demo goal

Show that Cognivio helps school and program leaders:

1. See observation patterns faster across teachers.
2. Turn video into timestamped, coaching-ready evidence.
3. Keep human judgment in the loop while reducing observation admin work.

## Core positioning

Use this framing early:

- "Cognivio does not replace the instructional leader. It helps leaders see evidence faster, organize it consistently, and coach from a stronger starting point."
- "The value for a teacher training program is not just scoring. It is better observation coverage, clearer follow-up, and more actionable coaching conversations."
- "Everything we show today is designed around privacy-safe classroom review and human oversight."

## Pre-demo setup

Use the principal login:

- `principal@demo.cognivio.app / DemoAccess2026!`

Recommended prep 3-5 minutes before the call:

1. Log in and land on `/dashboard`.
2. Click `Seed demo data` if the workspace looks sparse.
3. Open these backup tabs:
   - `/teachers`
   - `/teachers` with a teacher you plan to open
   - `/videos`
   - one completed lesson page from `/videos/:videoId`
4. Keep the demo in English unless the audience specifically wants Hebrew/RTL.
5. Do not rely on a fresh upload completing live. Use an already completed recording.

If you need a hard reset before reseeding, the backend also exposes:

- `POST /api/seed-demo-data/reset`
- `POST /api/seed-demo-data`

## Best demo personas

Use these seeded teachers depending on the story you want to tell:

- `Sarah Johnson`
  Strong "new teacher improving" story. Good for showing growth and coaching momentum.
- `Robert Martinez`
  Best "high-growth from a lower baseline" story. Good for intervention turning into progress.
- `Michael Chen`
  Best "declining trend / needs support" story. Good for showing where leaders should lean in.
- `Jennifer Williams`
  Best "consistently strong teacher" story. Good for exemplar or recognition discussion.
- `Emily Rodriguez`
  Best "mixed / variable performance" story. Good for showing why leaders still need nuance.

## Recommended 10-minute flow

### 0:00-1:00

Open `/dashboard`

Say:

- "This is the principal or program-level view. In one screen, leaders can see where observation coverage is strong, where support is needed, and where coaching should be focused."

Show:

- KPI strip
- leadership insights
- domain trends
- recording compliance snapshot

Land this point:

- "For a teacher training program, this helps supervisors spend less time assembling the picture and more time acting on it."

### 1:00-2:30

Scroll to focus domains on `/dashboard`

Say:

- "Leaders can decide what they want observations to emphasize, instead of treating every walkthrough as equally broad."

Show:

- focus domain selection
- priority elements
- focus note capability

Land this point:

- "This is especially useful when your program is driving a specific coaching initiative, like questioning, checks for understanding, or classroom culture."

### 2:30-4:00

Open `/teachers`

Recommended teacher for this moment:

- `Michael Chen` for support story, or
- `Sarah Johnson` for growth story

Say:

- "Now we move from the school-wide view to the observation roster. Leaders can quickly sort by concern, improvement, category, or department."

Show:

- filters and sort controls
- recent observations
- trend windows
- action items

Land this point:

- "Instead of hunting across notes and spreadsheets, the leader can move from 'Who needs attention?' to 'What exactly should I coach next?'"

### 4:00-6:30

Open `/teachers/:teacherId`

Recommended teacher:

- `Sarah Johnson` if you want a constructive coaching story
- `Michael Chen` if you want a sharper support/intervention story

Say:

- "This page is where Cognivio becomes a coaching workspace, not just a reporting tool."

Show:

- growth insights summary
- human observations section
- action plan / next steps
- next coaching conference
- curriculum adherence
- recording compliance

If time allows, point out:

- teacher reflection
- lesson plan and curriculum context
- recognition summary on the right rail

Land this point:

- "The output is not just a score. It connects evidence, trend, curriculum context, and the next coaching move."

### 6:30-8:30

Open `/videos` and then a completed recording on `/videos/:videoId`

Say:

- "This is the moment observation teams usually care about most: turning classroom video into something leaders can actually coach from."

Show:

- privacy-safe status badges
- completed lesson playback
- timestamped observations
- detailed rubric view
- coaching moves
- report generation
- copyable timestamp link

Use this line:

- "The key augmentation here is that the observer does not start from a blank page. They start from organized, time-linked evidence they can verify and use."

### 8:30-9:15

Optional branch: `/school-setup`

Use only if the audience is operationally minded.

Say:

- "Programs can also set the observation framework and recording expectations centrally."

Show:

- framework selection
- custom domains
- recording policy

### 9:15-10:00

Optional close with one of these:

- `/privacy-review`
  Best if the audience asks about trust, safety, or student privacy.
- `/recognition-review` or `/all-star-library`
  Best if the audience asks how strong practice can be shared across the program.

Recommended close:

- "At the front end, Cognivio helps leaders observe better. At the back end, it helps programs build a reusable library of strong practice while keeping privacy and human approval in place."

## What to emphasize

- Augments observer capacity, does not replace observer judgment.
- Creates more consistent evidence across leaders.
- Supports coaching follow-through, not just evaluation.
- Makes video review practical through timestamps, summaries, and action steps.
- Keeps privacy and admin review visible in the workflow.

## What not to overemphasize

- Do not make live upload/processing the centerpiece of a 10-minute demo.
- Do not present recognition or the All-Star Library as the core value for this audience.
- Do not describe AI outputs as final decisions; frame them as draft evidence and coaching support.

## Fast fallback moves

If the dashboard looks empty:

- Click `Seed demo data`.

If a video is still processing:

- Jump to another completed lesson from `/videos`.

If the audience wants a stronger coaching story:

- Open `Sarah Johnson` or `Robert Martinez`.

If the audience wants an intervention story:

- Open `Michael Chen`.

If the audience asks about privacy:

- Open `/privacy-review` and say:
- "Privacy issues are not hidden. They are surfaced in a dedicated review workflow before leaders rely on the output."

If the audience asks how this fits a training program:

- Say:
- "A program can use Cognivio to standardize what supervisors look for, increase observation frequency, and make post-observation coaching more concrete across many teachers."

## Suggested final close

"If you remember one thing from today, it is this: Cognivio helps teacher training leaders move from scattered observations to consistent, evidence-linked coaching at scale."
