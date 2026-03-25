# Cognivio UI Implementation Plan

Date: 2026-03-25

## Purpose

Convert the dashboard/teacher/admin recalibration work into an execution-ready UI plan with page-by-page tasks.

This plan focuses on:

- clearer separation of short-term lesson feedback from long-term coaching goals
- clearer separation of admin-owned pages from teacher-owned workspace pages
- easier adoption for low-tech users
- stronger utility for both teachers and admins

## Core Product Rules

Every page should make these distinctions obvious:

- `Latest class / immediate follow-up`
- `Ongoing goals / recurring patterns`
- `Admin actions`
- `Teacher actions`

No page should mix those without visual separation.

## Current Source Pages

- [App.js](c:\Projects\Cognivio\frontend\src\App.js)
- [LayoutShell.js](c:\Projects\Cognivio\frontend\src\components\LayoutShell.js)
- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)
- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)
- [TeachersPage.js](c:\Projects\Cognivio\frontend\src\pages\TeachersPage.js)

## Target Page Map

### Admin

- `/dashboard`
  - admin triage and pattern view
- `/teachers`
  - teacher roster and entry point into deep dives
- `/teachers/:teacherId`
  - admin teacher deep dive

### Teacher

- `/my-workspace`
  - teacher-owned home
- `/videos`
  - optional deep link for lesson history
- `/teachers/:teacherId`
  - should no longer serve as the teacher's main home

## Implementation Phases

### Phase 1. Role Entry and Route Split

Goal:
Make admin and teacher enter different primary experiences.

### Phase 2. Admin Teacher Deep Dive Refactor

Goal:
Turn the current shared teacher page into a true admin reflective page.

### Phase 3. Teacher Workspace Creation

Goal:
Create a teacher-owned home that is active and interactive.

### Phase 4. Admin Dashboard Clarification

Goal:
Make the dashboard clearly distinguish recent class signals from recurring patterns.

---

## Page-By-Page Tasks

## 1. App Routing and Role Entry

Primary file:

- [App.js](c:\Projects\Cognivio\frontend\src\App.js)

### Tasks

- Add a dedicated teacher-owned route:
  - `/my-workspace`
- Keep `/teachers/:teacherId` as the admin deep-dive route
- Change the default landing behavior:
  - admin -> `/dashboard`
  - teacher -> `/my-workspace`
- Update catch-all routing so teacher users are not always redirected back to `/dashboard`

### Notes

- This is the first structural change because the IA will remain blurry until the app has distinct role entry points.

### Acceptance Criteria

- Admin login lands on admin dashboard
- Teacher login lands on teacher workspace
- No teacher is forced to use the admin dashboard as their main home

---

## 2. Layout Shell and Navigation

Primary file:

- [LayoutShell.js](c:\Projects\Cognivio\frontend\src\components\LayoutShell.js)

### Tasks

- Introduce role-based nav variants
- Admin nav should prioritize:
  - Dashboard
  - Teachers
  - Videos
  - Privacy Review
  - Recognition Review
  - Setup
- Teacher nav should prioritize:
  - My Workspace
  - My Videos
  - My Materials
  - My Goals
  - My History
- Keep workspace mode switching admin-only
- Add visual role labeling in the shell header or profile area if useful

### Supporting Tasks

- Add nav localization strings for teacher-specific routes
- Ensure the shell can render both admin and teacher variants without duplicating the component

### Acceptance Criteria

- Admin and teacher see different primary navigation
- Teacher nav feels like a working space, not an admin control surface

---

## 3. Admin Dashboard

Primary file:

- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)

### Goal

Restructure the dashboard around time horizon clarity.

### Target Sections

- Triage row
- Recent lesson signals row
- Recurring coaching patterns row
- Supporting evidence and queue row
- Operations row

### Tasks

#### 3.1 Reframe the page header

- Change description copy to emphasize:
  - immediate follow-up
  - recurring patterns
- Remove copy that feels generic or purely analytic

#### 3.2 Build a dedicated Recent Lesson Signals section

- Create a section explicitly labeled:
  - `From the most recent class`
  - `Latest lesson signals`
- Show teacher name, latest lesson date, immediate concern/strength, and direct entry into the lesson/deep dive
- Use date stamps prominently

#### 3.3 Build a dedicated Recurring Patterns section

- Create a separate section explicitly labeled:
  - `Recurring patterns`
  - `Ongoing coaching goals`
- Populate with repeated themes across time, not latest one-off comments
- Avoid placing latest-lesson copy here

#### 3.4 Tighten triage KPIs

- Keep only KPIs that answer:
  - who needs follow-up
  - who is improving
  - who has recurring challenges
  - who has new lesson evidence waiting

#### 3.5 Move operational surfaces lower

- Keep compliance, focus domains, and gradebook/setup lower on the page
- They should not visually compete with core coaching insight

### Suggested Component Extractions

- `DashboardTriageRow`
- `RecentLessonSignalsPanel`
- `RecurringPatternsPanel`
- `TeacherFollowUpQueuePanel`
- `DashboardOperationsPanel`

### Acceptance Criteria

- A user can tell at a glance which content is latest-lesson-specific
- A user can tell at a glance which content is long-term and recurring
- Operational/setup content is secondary to coaching insight

---

## 4. Teachers Roster Page

Primary file:

- [TeachersPage.js](c:\Projects\Cognivio\frontend\src\pages\TeachersPage.js)

### Goal

Make the roster a clean entry point into admin teacher deep dives.

### Tasks

- Reframe roster summary cards around:
  - needs immediate follow-up
  - recurring challenges
  - improving teachers
  - teachers awaiting review
- In row expansion, visually separate:
  - latest observation notes
  - trend/pattern snapshot
  - current action items
- Make `View profile` language more explicit if needed:
  - `Open deep dive`
  - `View coaching record`
- Avoid making the roster feel like the teacher’s own working area

### Acceptance Criteria

- The page clearly feeds the admin into teacher deep dives
- Latest signals and ongoing patterns are not displayed as one merged block

---

## 5. Admin Teacher Deep Dive

Primary file:

- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)

### Goal

Convert the current mixed page into a clear admin supervisory page.

### Target Sections

- Latest Class Review
- Ongoing Coaching Record
- Evidence and Trend Bridge
- Admin Actions
- Historical Reference

### Tasks

#### 5.1 Create a top-level latest class section

- Surface:
  - last reviewed class date
  - latest summary
  - latest strengths
  - latest concerns
  - latest timestamps/evidence
  - latest teacher response
  - latest admin comment
- Keep this section fully lesson-scoped
- Use language like:
  - `Latest class`
  - `From this lesson`
  - `Immediate follow-up`

#### 5.2 Create a separate ongoing coaching record section

- Surface:
  - active long-term goals
  - recurring challenges
  - recurring strengths
  - conference continuity
  - longitudinal coaching notes
- Keep uploads and lesson-specific actions out of this section

#### 5.3 Build an evidence/trend bridge section

- Keep performance-over-time chart here
- Add labels that explain whether something is:
  - single observation
  - emerging pattern
  - established pattern
- Tie trend explanation back to stored evidence

#### 5.4 Move admin-only controls into a dedicated action lane

- Admin comments
- recommendation overrides
- scheduling
- long-term goal updates
- scoring/interpretation overrides

This prevents controls from visually blending into evidence.

#### 5.5 Remove teacher-owned workspace blocks from the admin page

- privacy profile setup
- upload video flows
- upload lesson plan/curriculum/syllabus
- teacher-owned workspace prompts

These should move to the teacher workspace page.

#### 5.6 Keep historical reference secondary

- past lessons
- past comments
- completed goals
- prior conference notes

These should support the page, not dominate it.

### Suggested Component Extractions

- `TeacherLatestClassPanel`
- `TeacherOngoingGoalsPanel`
- `TeacherEvidenceTrendPanel`
- `TeacherAdminActionsPanel`
- `TeacherHistoryPanel`

### Acceptance Criteria

- Admin page reads as a reflective deep dive, not a mixed workspace
- Short-term lesson feedback is distinct from long-term coaching goals
- Teacher uploads no longer feel primary on this page

---

## 6. Teacher Workspace Home

New primary file:

- `frontend/src/pages/TeacherWorkspacePage.js`

Likely source material to split from:

- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)

### Goal

Create the teacher’s actual home inside Cognivio.

### Target Sections

- This Week / This Class
- My Growth Goals
- My Workspace
- Reflect and Respond
- My History

### Tasks

#### 6.1 Build a teacher-first top summary

- latest uploaded class
- latest new feedback
- immediate to-do list
- next required teacher action

This section should feel actionable and calm.

#### 6.2 Build a dedicated My Growth Goals section

- show ongoing goals separately from latest class feedback
- include:
  - why the goal exists
  - evidence tied to it
  - teacher implementation note
  - progress status

#### 6.3 Move uploads and setup into My Workspace

- privacy profile management
- video upload/record
- curriculum upload
- lesson plan upload
- syllabus upload

These should become the teacher’s operational home tools.

#### 6.4 Build a Reflect and Respond section

- teacher reflection on latest lesson
- response to admin comments
- what I tried
- what I will try next

This should support coach-teacher interaction directly.

#### 6.5 Add a history section

- previous lessons
- previous feedback
- prior reflections
- completed goals
- prior conference notes

This should be available but visually secondary.

### Suggested Component Extractions

- `TeacherWorkspaceCurrentPanel`
- `TeacherWorkspaceGoalsPanel`
- `TeacherWorkspaceUploadsPanel`
- `TeacherWorkspaceReflectionPanel`
- `TeacherWorkspaceHistoryPanel`

### Acceptance Criteria

- Teacher page feels owned by the teacher
- Uploads and reflections are easy to find
- Ongoing goals are separate from latest class feedback
- Teacher does not need to interpret an admin-style page to use the product

---

## Shared UI Tasks

### Labels and Copy System

Create a standard vocabulary used across pages:

- `Latest class`
- `From this lesson`
- `Immediate follow-up`
- `Ongoing goal`
- `Recurring pattern`
- `Across recent observations`
- `Long-term development focus`

This should be added to locale files and reused consistently.

### Section Styling Rules

- lesson-scoped sections should use date labels and stronger recency cues
- long-term sections should use pattern/status cues
- teacher-owned action sections should look interactive
- admin-owned sections should look reflective and supervisory

### Evidence Rules

- every latest-class section should reference one specific lesson
- every long-term section should imply repeated evidence, not single evidence

---

## Recommended Build Order

### Sprint A

- route split
- role-based navigation
- teacher workspace route stub

### Sprint B

- admin teacher deep-dive section split
- latest class review section
- ongoing coaching record section

### Sprint C

- teacher workspace creation
- uploads/setup block migration
- reflection and response flow migration

### Sprint D

- dashboard clarification
- recent lesson signals row
- recurring patterns row

### Sprint E

- polish copy, labels, and section hierarchy
- remove redundant controls
- tighten onboarding and first-use clarity

---

## File-Level Implementation Map

### Routing

- [App.js](c:\Projects\Cognivio\frontend\src\App.js)

### Shell and Navigation

- [LayoutShell.js](c:\Projects\Cognivio\frontend\src\components\LayoutShell.js)

### Admin Dashboard

- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)

### Admin Teacher Deep Dive

- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)

### Teacher Workspace

- new page to add:
  - `frontend/src/pages/TeacherWorkspacePage.js`

### Roster Support

- [TeachersPage.js](c:\Projects\Cognivio\frontend\src\pages\TeachersPage.js)

### Localization

- [common.js](c:\Projects\Cognivio\frontend\src\locales\en\common.js)
- [common.js](c:\Projects\Cognivio\frontend\src\locales\he\common.js)

---

## Definition of Done

We should consider the UI recalibration complete when:

- a teacher can instantly tell what is from the latest class versus what is an ongoing goal
- an admin can instantly tell what requires immediate follow-up versus what is a recurring pattern
- teacher-owned workflows live on a teacher-owned page
- the admin teacher page becomes a true reflective deep dive
- the dashboard becomes a clearer triage page
- first-time users can navigate the product without needing to infer who each page is really for

## Recommended Next Step

Move immediately into implementation planning-by-sprint:

1. Phase 1 tickets for route split and role-based shell
2. Phase 2 tickets for admin teacher deep-dive refactor
3. Phase 3 tickets for teacher workspace creation
4. Phase 4 tickets for dashboard clarification
