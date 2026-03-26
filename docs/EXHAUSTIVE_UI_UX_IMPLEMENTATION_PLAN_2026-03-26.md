# Cognivio Exhaustive UI/UX Implementation Plan

Date: 2026-03-26  
Scope: Admin + Teacher product surfaces  
Goal: Reduce redundancy, clarify navigation, minimize page busyness, and improve utility, usability, adaptability, and adoption.

## 1. Product Objectives

This plan is designed to achieve two parallel outcomes:

1. Cleanup and simplification
- Remove redundant UI blocks
- Reduce stacked navigation patterns
- Clarify click-through behavior
- Separate primary workflows from secondary tools
- Make each page easier to scan and understand

2. Product improvement
- Increase practical day-to-day utility for admins and teachers
- Make coaching workflows more obvious and easier to complete
- Strengthen evidence-to-action continuity
- Improve role clarity between admin and teacher
- Increase trust, adoptability, and low-tech usability

The design principle throughout this plan is:

`One page = one primary job.`

Secondary tasks should move into:
- sub-pages
- tabs
- drawers
- collapsible panels
- contextual click-throughs

## 2. UX Design Rules

These rules should guide all implementation work.

### 2.1 Role clarity

- Admin surfaces should be supervisory, reflective, and action-oriented.
- Teacher surfaces should be interactive, operational, and self-managed.
- No page should blur ownership of an action.

### 2.2 Time-horizon clarity

Every coaching-related surface should clearly distinguish:
- latest lesson / immediate follow-up
- recurring patterns / ongoing goals
- historical record / archive

### 2.3 Navigation clarity

- Primary navigation should stay in the shell.
- Secondary navigation should be contextual to the object being viewed.
- Stacked “multiple navigation systems” should be removed where possible.

### 2.4 Busyness control

- Heavy reference material should be collapsible or moved to sub-pages.
- Operational actions should not compete visually with insight sections.
- Advanced features should not sit at equal visual weight with core workflow features.

### 2.5 Evidence continuity

- Any goal, reflection, or recommendation should be able to link back to lesson evidence.
- Any lesson-level insight should be clearly tied to a specific lesson or timestamp.
- Any graph or trend should be explainable in plain language.

## 3. Current Problems To Address

This implementation plan addresses the following audited findings:

1. Teacher workspace still contains too many navigation systems and too much stacked content.
2. Admin teacher deep dive is still too dense and too broad.
3. Dashboard still mixes too many admin jobs into one experience.
4. Roster page still combines too many jobs in one page context.
5. Action plan and reflection records are separate, but still do not feel like one coherent coaching record system.
6. Video review page still combines too many concerns into one surface.
7. Cross-page navigation context is still too weak once users move below top-level pages.

## 4. Target Information Architecture

## 4.1 Admin information architecture

### Top-level pages

- `/dashboard`
  Purpose: admin operations + high-level insights entry point

- `/teachers`
  Purpose: roster management and teacher triage

- `/teachers/:teacherId`
  Purpose: teacher deep dive summary page

- `/teachers/:teacherId/latest-lesson`
  Purpose: latest lesson summary + evidence bridge

- `/teachers/:teacherId/coaching`
  Purpose: ongoing coaching record hub

- `/teachers/:teacherId/action-plan`
  Purpose: shared action plan record

- `/teachers/:teacherId/reflections`
  Purpose: shared reflection record

- `/teachers/:teacherId/history`
  Purpose: teacher history timeline and archive

- `/videos`
  Purpose: library / queue

- `/videos/:videoId`
  Purpose: lesson review page

- `/videos/:videoId/review`
  Purpose: core review mode

- `/videos/:videoId/admin-tools`
  Purpose: advanced admin-only tools for export/share/recognition

- `/privacy-review`
- `/recognition-review`
- `/school-setup`
- `/master-schedule`

## 4.2 Teacher information architecture

### Top-level pages

- `/my-workspace`
  Purpose: teacher home / this week

- `/my-workspace/latest`
  Purpose: latest lesson response and immediate next move

- `/my-workspace/goals`
  Purpose: shared goals / implementation view

- `/my-workspace/reflections`
  Purpose: reflection record

- `/my-workspace/materials`
  Purpose: privacy profile, uploads, curriculum, lesson plans

- `/my-workspace/history`
  Purpose: teacher growth history and past activity

- `/videos`
  Purpose: personal video library

- `/videos/:videoId`
  Purpose: lesson review page

## 4.3 Shared object model

There should be four main coaching objects:

1. Lesson review
- lesson-specific
- timestamped
- evidence-backed

2. Action plan
- long-term
- shared between admin and teacher

3. Reflection record
- shared dialogue record
- admin reflection + teacher reflection + implementation response

4. Coaching timeline
- chronological continuity layer across lessons, goals, reflections, and conferences

These should feel connected, not like isolated pages.

## 5. Implementation Phases

The phases below are ordered for cleanliness and minimal rework.

---

## Phase 1: Navigation and Page Model Simplification

### Goal

Reduce stacked navigation and make sub-pages do real work.

### 1.1 Teacher workspace restructuring

#### Problem

The teacher workspace currently has:
- shell navigation
- top buttons
- “start here” cards
- local section sidebar
- stacked sections on one page

This creates too many competing ways to move around.

#### Implementation

- Convert `/my-workspace/:section` into true route-based page rendering.
- Only render one major workspace section at a time.
- Keep the shell nav as the primary nav.
- Keep a lightweight local sub-nav only if it adds clear value.
- Replace the “Start here” card row with a smaller contextual onboarding strip on `/my-workspace` only.

#### Result

Teacher workspace becomes:
- Home
- Goals
- Reflections
- Materials
- History

Each becomes a real page state, not a highlight within one long page.

#### Files likely affected

- `frontend/src/pages/TeacherWorkspacePage.js`
- `frontend/src/App.js`
- `frontend/src/components/LayoutShell.js`
- `frontend/src/pages/teacher-workspace/useTeacherWorkspaceData.js`

### 1.2 Add contextual page headers

#### Implementation

Add a reusable context header for:
- teacher deep dive
- action plan record
- reflection record
- video review

Header should include:
- teacher name
- role/context label
- latest reviewed lesson date
- open goal count
- next conference date
- quick links to related sub-pages

#### Result

Users stay oriented when moving deeper into the system.

### 1.3 Add breadcrumbs / context links

#### Implementation

Add breadcrumbs or compact context trails:
- Dashboard > Teachers > Teacher Name
- Teachers > Teacher Name > Coaching
- Videos > Lesson Name > Review

#### Result

Cross-page movement becomes easier and more understandable.

---

## Phase 2: Dashboard Re-Architecture

### Goal

Separate admin operations from deeper analytical review.

### 2.1 Split dashboard into two primary modes

#### Problem

Dashboard still acts as:
- task queue
- readiness center
- insights hub
- recognition console
- trend explorer

#### Implementation

Add a mode switch at the top:

- `Operations`
- `Insights`

#### Operations mode should show

- what needs action now
- readiness blockers
- privacy review backlog
- recent lesson follow-up queue
- urgent teacher follow-through
- upcoming conferences

#### Insights mode should show

- recent lesson signals
- recurring patterns and ongoing goals
- domain trends
- department progress
- evidence view toggle

#### Result

Admins can choose whether they are:
- running the workflow
- studying the coaching picture

### 2.2 Tighten the action queue

#### Implementation

The queue should remain short and specific.

Rules:
- only real actionable items
- collapse duplicate items
- prefer grouped tasks when many identical blockers exist
- include teacher count when grouping

Task types:
- review new lesson evidence
- teacher follow-through pending
- conference prep due
- privacy blockers
- unresolved action-plan checkpoints

#### Improve task cards

Each task card should show:
- task title
- why it matters
- who it affects
- one clear next action

### 2.3 Move secondary ops to dedicated pages or drawers

#### Move out of dashboard prominence

- recognition operations
- extended launch-health metrics
- deep readiness diagnostics

These should be accessible, but not equal in prominence to core admin workflow.

### 2.4 Preserve evidence view toggle

#### Expand it

Every major graph should support:
- graph view
- plain-language evidence view

This should remain and become more prominent, because it improves comprehension and trust.

#### Files likely affected

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/components/dashboard/*`
- shared UI components for mode switch / breadcrumb / context header

---

## Phase 3: Roster Page Simplification

### Goal

Make the roster page feel like a triage and management surface, not a control panel.

### 3.1 Move teacher creation into a sub-flow

#### Problem

Teacher creation is competing with roster review on the same page.

#### Implementation

Replace the inline “add teacher” panel with:
- modal flow, or
- dedicated `/teachers/new` sub-page, or
- drawer

Recommended: modal or drawer for speed.

### 3.2 Move school creation into a more secondary step

#### Problem

School creation is nested inside teacher creation and adds complexity.

#### Implementation

Make school management a dedicated setup function, not something that visually expands roster complexity.

### 3.3 Clarify page sections

Roster page should have:

1. Filters and sorting
2. Teacher rows
3. Quick stats
4. Lightweight actions

Anything more complex should route elsewhere.

### 3.4 Improve row actions

Each teacher row should offer clear click-throughs:
- open deep dive
- open latest lesson
- open coaching record
- schedule conference

#### Files likely affected

- `frontend/src/pages/TeachersPage.js`

---

## Phase 4: Admin Teacher Deep Dive Refactor

### Goal

Turn the teacher page into a cleaner supervisory hub with less busyness.

### 4.1 Strict section model

The deep dive should have these main sections only:

1. Latest lesson
- latest lesson summary
- lesson-specific evidence
- link to full video review
- immediate follow-up

2. Ongoing coaching
- recurring patterns
- shared goals
- progress signals
- link to coaching record

3. Admin actions
- schedule conference
- publish agenda
- export tools
- scoring / override controls

4. Secondary references
- human observations
- evidence over time
- linked history

### 4.2 Create real click-through sub-pages

Add:
- `/teachers/:teacherId/latest-lesson`
- `/teachers/:teacherId/coaching`
- `/teachers/:teacherId/history`

Use the summary page as a hub, not a complete archive.

### 4.3 Remove hidden legacy data-fetching burden

#### Problem

The admin teacher page still loads teacher-owned materials and upload-related data even though the admin should not use them there.

#### Implementation

Remove unused admin-page fetching and mutation plumbing for:
- curriculum uploads
- lesson plan uploads
- syllabus uploads
- video recorder flows
- privacy profile upload handling

If the admin still needs visibility, show:
- read-only status summaries
- click-through to relevant teacher-owned record if appropriate

### 4.4 Keep heavy sections collapsed by default

Maintain and strengthen collapsible sections for:
- evidence over time
- human observations
- secondary evidence detail

These are reference material, not first-read content.

#### Files likely affected

- `frontend/src/pages/TeacherProfilePage.js`

---

## Phase 5: Shared Coaching Record Consolidation

### Goal

Make action plan + reflections feel like one coherent coaching hub.

### 5.1 Introduce shared coaching record hub

Add:
- `/teachers/:teacherId/coaching`
- `/my-workspace/coaching`

This page should include tabs or segmented sections:
- Goals
- Reflections
- Timeline
- Conference

### 5.2 Reposition action plan and reflection pages

They should still exist as dedicated pages, but within the coaching hub structure:
- focused
- historical
- editable

### 5.3 Clarify ownership

Action plan ownership:
- admin defines structure
- teacher adds implementation evidence and notes

Reflection ownership:
- both can contribute
- teacher response and admin reflection should be clearly distinguished

### 5.4 Add tab-level click-throughs

Goals and reflections should show:
- linked lesson evidence
- linked goals
- linked admin comments
- linked video review

### 5.5 Make the timeline central

The coaching timeline should become the continuity backbone:
- new lesson reviewed
- admin comment added
- teacher responded
- goal updated
- conference scheduled
- agenda published
- checkpoint completed

#### Files likely affected

- `frontend/src/pages/ActionPlanRecordPage.js`
- `frontend/src/pages/ReflectionRecordPage.js`
- new coaching hub page
- shared coaching components

---

## Phase 6: Teacher Workspace Simplification and Empowerment

### Goal

Make the teacher workspace feel like the teacher’s operational home, not a compressed admin-style dashboard.

### 6.1 Redesign workspace home as “This Week”

`/my-workspace` should become a concise teacher home with:
- latest class summary
- what needs my response
- shared goals in motion
- next conference
- one next recommended step

It should not try to show every workspace domain at once.

### 6.2 Move uploads and setup into Materials page

Keep on `/my-workspace/materials`:
- privacy profile
- record/upload lesson
- curriculum uploads
- lesson plans
- syllabus

This is the right place for operational teacher actions.

### 6.3 Make Goals and Reflections cleaner

The teacher should experience:
- a clear shared goals page
- a clear reflection page
- a clear history page

Not a stacked overview plus sub-page duplicates.

### 6.4 Improve the “urgent tasks” model

Teacher task cards should be:
- specific
- teacher-readable
- framed as follow-through or response

Example:
- “Respond to feedback on your last class”
- “Add what you tried after the last observation”
- “Prepare for next week’s conference”

Not abstract state labels.

### 6.5 Improve onboarding cues

Low-tech teachers should always know:
- what to do first
- what is optional
- what is due soon
- what was already completed

This should be handled with:
- short status strips
- checklists
- fewer competing cards

#### Files likely affected

- `frontend/src/pages/TeacherWorkspacePage.js`
- `frontend/src/pages/teacher-workspace/useTeacherWorkspaceData.js`

---

## Phase 7: Video Review Declutter

### Goal

Keep lesson review focused on evidence review first.

### 7.1 Split video page into primary and secondary modes

Recommended routes:
- `/videos/:videoId/review`
- `/videos/:videoId/admin-tools`

### 7.2 Primary review mode should contain

- playback
- timeline
- timestamped observations
- assessment summary
- lesson-specific evidence
- recommended moments
- summary notes / action items
- link to ongoing coaching record

### 7.3 Secondary admin-tools mode should contain

- recognition
- exemplar submission
- sharing tools
- social card generation
- email signature generation
- advanced export/admin-only controls

### 7.4 Clarify lesson-specific status

Video review should explicitly show:
- this is one lesson
- this evidence informed these goals
- this lesson contributes to these recurring patterns

### 7.5 Strengthen continuity link-out

From video review, users should be able to click into:
- teacher deep dive
- coaching hub
- linked goal
- linked reflection

#### Files likely affected

- `frontend/src/pages/VideoPlayerPage.js`
- related components

---

## Phase 8: Cross-Page Context and Continuity

### Goal

Make the whole product feel like one coherent system.

### 8.1 Add reusable context bar component

Use on:
- teacher deep dive
- coaching hub
- action plan
- reflections
- video review

Should show:
- teacher
- subject
- active goals
- latest lesson
- next conference
- quick links

### 8.2 Standardize cross-page “open related record” actions

Every relevant page should offer:
- open latest lesson
- open coaching record
- open goals
- open reflections
- open history

### 8.3 Standardize button hierarchy

Across all pages:
- primary action = one per section max
- secondary actions = outlined buttons
- metadata labels = never styled like buttons

### 8.4 Standardize collapsible references

Use a common pattern for:
- advanced evidence
- historical notes
- raw observations
- diagnostic detail

---

## Phase 9: Utility and Adoption Enhancements

### Goal

Make the system more useful and easier to adopt.

### 9.1 Add smarter empty states

Each page should explain:
- what this page is for
- what is missing
- what to do next

### 9.2 Add clearer workflow state labels

Replace abstract status wherever possible with user-centered language:
- awaiting admin review -> needs your review
- awaiting teacher response -> teacher follow-up needed
- goal checkpoint due -> goal review due this week

### 9.3 Add “why this matters” microcopy

Short microcopy should explain:
- why a task is shown
- why a trend changed
- why a goal exists

### 9.4 Add stronger conference continuity

Conference-related UX should connect:
- upcoming meeting
- published agenda
- latest evidence
- current goals
- previous follow-through

### 9.5 Add adaptive support progressively

Memory-informed support should remain bounded and helpful:
- teacher prompt
- admin prompt
- prioritized next move

But should not create visual clutter or extra “AI panel” noise.

---

## 6. Page-by-Page Target State

## 6.1 Dashboard target state

### Primary purpose

Admin home for:
- immediate work
- school/program health
- trend insight

### Structure

1. Mode switch: Operations / Insights
2. Small KPI strip
3. Mode-specific body

### Operations body

- What needs action now
- Readiness blockers
- Upcoming conferences
- Latest lessons awaiting review

### Insights body

- Recent lesson signals
- Recurring patterns
- Graphs with evidence toggle

## 6.2 Teachers page target state

### Primary purpose

Roster triage + teacher entry point

### Structure

1. Filters and sort
2. Teacher table/cards
3. Quick row actions
4. Create/edit flows off-page or in modal

## 6.3 Teacher deep dive target state

### Primary purpose

Admin supervisory hub

### Structure

1. Context header
2. Latest lesson card
3. Ongoing coaching summary
4. Admin action lane
5. Secondary evidence sections
6. Links out to coaching record/history

## 6.4 Teacher workspace target state

### Primary purpose

Teacher operational home

### Structure

1. This week
2. Goals
3. Reflections
4. Materials
5. History

Render one at a time.

## 6.5 Action plan target state

### Primary purpose

Shared goals and progress record

### Structure

1. Context header
2. Goal summary
3. Current goals
4. Evidence links
5. Notes / implementation details
6. History

## 6.6 Reflection target state

### Primary purpose

Shared dialogue and implementation record

### Structure

1. Context header
2. Current reflection entry
3. Linked goals and lesson evidence
4. Latest teacher/admin reflections
5. History

## 6.7 Video review target state

### Primary purpose

Lesson-specific review

### Structure

1. Playback and timeline
2. Lesson review summary
3. Timestamped evidence
4. Recommended moments
5. Link into coaching record
6. Advanced admin tools separated

## 7. Delivery Sequence

Recommended implementation order:

1. Phase 1: Navigation and page-model simplification
2. Phase 2: Dashboard re-architecture
3. Phase 3: Roster simplification
4. Phase 4: Teacher deep dive refactor
5. Phase 5: Shared coaching record consolidation
6. Phase 6: Teacher workspace simplification and empowerment
7. Phase 7: Video review declutter
8. Phase 8: Cross-page context and continuity
9. Phase 9: Utility and adoption enhancements

## 8. Execution Notes

### Keep first

- role separation
- evidence-backed goals
- evidence-backed reflections
- coaching timeline
- adaptive prompts
- graph/evidence toggle

### Avoid

- adding more dense stacked panels
- duplicating the same content on summary page and sub-page without purpose
- introducing more AI-specific UI before cleaning page hierarchy

### Principle

We should treat this plan as:
- first a cleanup of structure
- then a simplification of user effort
- then an enhancement of intelligence and utility

That order is what will make Cognivio feel more powerful and easier to adopt at the same time.
