# Cognivio Admin / Teacher Refocus Plan

Date: 2026-03-25

## Purpose

Turn the latest dashboard and teacher-page feedback into a focused implementation plan that clarifies:

- what belongs to the admin
- what belongs to the teacher
- what is lesson-specific
- what is long-term
- what is evidence-backed
- what should synchronize across surfaces

This plan is intentionally narrower than the earlier UI recalibration plan. It is the next execution plan for the current product contract.

## Core Product Decisions

These are now treated as locked decisions for implementation unless we explicitly change them later.

### 1. Admin teacher page is not a teacher workspace

The admin view at `/teachers/:teacherId` is a supervisory deep dive.

It should allow the admin to:

- review evidence
- review the latest lesson
- review recurring goals and patterns
- comment
- prepare for conferences
- edit the action plan
- inspect evidence over time

It should not allow the admin to:

- upload privacy profile assets
- upload or record lesson videos
- upload curriculum
- upload lesson plans
- upload syllabi

Those actions belong only in the teacher-owned workspace.

### 2. Teacher workspace is the operational home for teacher-owned actions

The teacher view at `/my-workspace` is where the teacher lives in the product.

It should be the only primary place for:

- privacy profile setup
- video upload / recording
- curriculum upload
- lesson plan upload
- syllabus upload
- teacher comments and reflections
- teacher implementation notes

### 3. Action plan has one source of truth

There is one action plan per teacher, shared across the system.

The admin owns coaching-plan definition.
The teacher contributes follow-through and implementation context.

The same action plan should appear as:

- editable coaching plan on admin teacher page
- shared goals and implementation record on teacher workspace
- read-only summary in reports and conference prep surfaces

There should not be separate admin and teacher action plans.

### 4. Conference prep is admin prep by default

Conference prep should mean:

- what the admin should prepare for the next coaching conversation
- what changed since the last reviewed lesson
- what current goals should be discussed
- what evidence should anchor the conversation

Teacher-facing visibility should be deliberate, not implied.

Default behavior:

- admin sees full conference prep
- teacher sees upcoming conference status only
- a shared agenda should only appear if we explicitly add a “share with teacher” behavior later

### 5. Lesson review and long-term growth must be two distinct models

We should stop blending them.

Model A: lesson-specific review

- tied to one uploaded video
- dated
- timestamped
- linkable back to exact evidence
- includes AI review, admin review, and video-level notes

Model B: long-term growth and adherence

- aggregated across multiple lessons
- no ambiguous timestamps
- based on repeated evidence, action plans, admin reflections, and follow-through
- shows recurring goals and whether they are improving

### 6. Every uploaded video should have its own review page

Each video should open a page that is clearly lesson-scoped.

That page should show:

- the video
- the review of that video only
- timestamps
- AI insights for that video only
- admin comments for that video
- teacher response for that video
- links from timestamps directly into playback

### 7. Admin dashboard top block should be simplified

The top admin block should be a clean roster-status overview only.

It should show:

- teachers in roster
- observations analyzed
- needs attention

Each tile should click through to the relevant page.

It should not include:

- explanatory narrative copy
- duplicate roster snapshot content
- broad onboarding language in the top block

### 8. “What to do next” must become a true task queue

This block should be built from real prioritized tasks, not mainly navigation shortcuts.

Good task examples:

- latest reviewed lesson needs admin follow-up
- teacher has not responded to a recent comment
- action plan checkpoint is overdue
- conference is approaching and prep is incomplete
- completed video still lacks admin review
- privacy or upload issue is actively blocking the next workflow step

Bad task examples:

- generic “open teachers”
- generic “open videos”
- generic “open setup”

### 9. Graphs must support evidence-language mode

Evidence-based graphs are valuable, but they need a parallel plain-language mode.

For each major graph surface, the user should be able to toggle:

- `Graph view`
- `What informed this`

The plain-language view should explain, in bullets:

- what evidence contributed
- what changed over the selected time period
- which lessons / comments / reflections influenced the movement
- why the system treats the movement as real improvement, decline, or stability

## Current Problems To Fix

### Admin teacher page

Current problems:

- still contains teacher-owned upload and setup sections
- still visually mixes lesson-specific and long-term concepts
- AI insights can look long-term while showing timestamped lesson evidence
- conference prep is not explicit enough about its audience and purpose

### Teacher workspace

Current problems:

- correct direction, but action plan ownership needs clearer wording
- teacher should understand what is shared with admin versus what is teacher-owned
- upcoming conference context is still underdefined

### Dashboard

Current problems:

- top workspace block is over-explained
- top metrics are not acting like clickable operational status tiles
- “what to do next” is too navigational
- graphs show evidence movement but not evidence-language explanation

## Target Surface Responsibilities

## 1. Admin Dashboard

Primary purpose:

- overall roster status
- urgent follow-up queue
- recurring patterns across roster
- evidence-backed trend view

Should contain:

- clean clickable status tiles
- real AI-plus-human task queue
- recent lesson signals
- recurring roster patterns
- charts with graph/evidence toggle

Should not contain:

- long narrative onboarding copy at the top
- redundant roster snapshot cards

## 2. Admin Teacher Deep Dive

Primary purpose:

- supervise one teacher across short-term and long-term performance

Target structure:

### Section A. Latest reviewed video

- video/date context
- summary for that video only
- timestamps and linked evidence
- admin review and teacher response for that video
- link to full lesson review page

### Section B. Long-term goals and adherence

- recurring goals
- action plan progress
- adherence to current coaching objectives
- recurring strengths
- recurring challenges
- no lesson-specific timestamps in this section

### Section C. Conference prep

- admin prep only
- agenda
- continuity from previous work
- linked evidence to discuss

### Section D. Admin action lane

- edit action plan
- schedule conference
- adjust scoring / recommendation overrides
- export / reporting actions

Should not contain:

- teacher upload tools
- teacher privacy setup
- teacher material uploads

## 3. Teacher Workspace

Primary purpose:

- teacher-owned work surface

Target structure:

### Section A. Latest class and immediate follow-up

- most recent reviewed lesson
- latest admin comment
- teacher response
- what to try next

### Section B. My ongoing goals

- shared action-plan goals
- implementation notes
- status updates
- what is still active

### Section C. My uploads and privacy

- privacy profile
- upload / record video
- curriculum
- lesson plan
- syllabus

### Section D. My history

- prior lessons
- prior comments
- completed goals

### Section E. Upcoming conference

- next scheduled conference
- optional shared agenda only if the admin explicitly shares it

## 4. Video Review Page

Primary purpose:

- lesson-level evidence page

Target structure:

- video player
- timestamps
- AI review for this lesson only
- admin review for this lesson only
- teacher response for this lesson only
- lesson-scoped summary
- link from teacher deep dive and dashboard cards

This page is the home for timecoded evidence.

## Synchronization Rules

## Action plan synchronization

Source of truth:

- shared action plan record

Admin can:

- create goals
- edit goals
- set due dates
- set status
- add coaching notes

Teacher can:

- view goals
- add implementation notes
- update progress if we decide to allow direct status updates

Reports should:

- show current action plan snapshot
- never fork into a separate report-only plan

## Conference synchronization

Source of truth:

- admin conference prep record

Admin sees:

- prep agenda
- continuity lines
- evidence links

Teacher sees:

- next conference date
- optional shared agenda only if explicitly published

## Evidence synchronization

Source of truth:

- lesson review pages and stored evidence per video

All timestamps shown on admin deep dive must link back to the lesson page.
Long-term sections should reference repeated evidence, but not expose raw timestamps without a drilldown link.

## Implementation Streams

## Stream 1. Admin Teacher Page Cleanup

Goal:

- remove all teacher-owned upload/setup actions from admin view

Files:

- `frontend/src/pages/TeacherProfilePage.js`
- locale files if labels need adjustment

Tasks:

- remove admin-visible lesson upload / record block
- remove admin-visible privacy profile block
- remove admin-visible curriculum upload block
- keep admin-visible read-only material summaries only if useful

Acceptance criteria:

- admin cannot upload or configure teacher-owned items from admin page
- admin page reads as review, coaching, and supervision only

## Stream 2. Shared Action Plan and Conference Clarification

Goal:

- make synchronization rules explicit in the UI

Files:

- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/pages/TeacherWorkspacePage.js`
- `frontend/src/pages/teacher-workspace/useTeacherWorkspaceData.js`
- backend APIs only if role capabilities need tightening

Tasks:

- label action plan as shared across admin and teacher
- separate admin coaching notes from teacher implementation notes if needed
- reduce teacher-facing edit permissions if current editing is too broad
- relabel conference prep as admin prep
- add a small teacher-facing conference status module

Acceptance criteria:

- users can tell where the action plan is edited, viewed, and followed through
- conference prep no longer feels ambiguous about its audience

## Stream 3. Lesson Review vs Long-Term Insight Split

Goal:

- make lesson-level evidence and long-term goals impossible to confuse

Files:

- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/pages/VideosPage.js`
- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/components/MonthlySummary.js`

Tasks:

- rename and restructure current AI insights area
- create `Latest video insights`
- create `Long-term goals and adherence`
- move timestamps out of long-term section
- ensure timestamps always link to lesson page
- make each video review clearly self-contained

Acceptance criteria:

- no long-term section shows ambiguous lesson timestamps
- every timestamp shown in review UI opens concrete video evidence
- admin can distinguish “this lesson” from “pattern over time” immediately

## Stream 4. Dashboard Cleanup and Task Queue Refactor

Goal:

- make the dashboard operationally cleaner and more useful

Files:

- `frontend/src/pages/DashboardPage.js`
- supporting APIs if queue logic needs upgrading

Tasks:

- simplify top admin block to three clickable status tiles
- remove explanatory top narrative
- remove duplicate roster snapshot behavior
- replace smart queue with actual prioritized task queue
- make tasks derive from evidence, follow-up, and pending admin work

Acceptance criteria:

- top dashboard block is clean and clickable
- “what to do next” contains actual to-dos, not generic navigation

## Stream 5. Evidence Toggle for Trend Surfaces

Goal:

- let users understand graph movement in words and in visuals

Files:

- `frontend/src/components/MonthlySummary.js`
- `frontend/src/pages/DashboardPage.js`
- any extracted evidence-summary helpers

Tasks:

- add `Graph view` / `What informed this` toggle
- for teacher deep dive:
  - explain trend movement in bullet form
  - include linked evidence when available
- for dashboard:
  - explain what informed domain and department movement
  - summarize evidence in plain language for the selected period

Acceptance criteria:

- user can switch from chart view to evidence-language view
- evidence-language view explains the movement in bullet points
- the relationship between evidence and graph is explicit

## Recommended Execution Order

## Step 1

Admin page cleanup.

Reason:

- this is the clearest mismatch right now
- it directly affects product trust and role clarity

## Step 2

Action plan and conference synchronization clarification.

Reason:

- this locks the shared workflow model before more UI layering

## Step 3

Lesson-review versus long-term-insight split.

Reason:

- this is the biggest conceptual clarity improvement

## Step 4

Dashboard top-block cleanup and task queue refactor.

Reason:

- this improves admin utility once the teacher/admin contract is cleaner

## Step 5

Evidence-language toggle for charts.

Reason:

- this is powerful, but should build on the clarified evidence model

## Non-Goals For This Pass

- redesigning the entire visual design system
- adding new AI autonomy or agent layers
- inventing a second action-plan model
- exposing full conference prep to teachers by default
- keeping upload workflows on admin pages for convenience

## Repo Touchpoints

- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/pages/TeacherWorkspacePage.js`
- `frontend/src/pages/teacher-workspace/useTeacherWorkspaceData.js`
- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/components/MonthlySummary.js`
- locale files

## Exit Criteria

This plan is complete when:

- admin teacher page is review-only and coaching-focused
- teacher workspace is the only operational upload/setup home
- action plan is clearly one shared record
- conference prep is clearly admin prep
- lesson-specific and long-term insights are structurally separate
- dashboard top block is simplified and clickable
- task queue is built from real urgent work
- charts can be read as visuals or as evidence-language summaries
