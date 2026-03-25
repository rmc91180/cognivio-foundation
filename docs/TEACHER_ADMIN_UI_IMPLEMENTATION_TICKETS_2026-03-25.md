# Cognivio Teacher/Admin UI Implementation Tickets

Date: 2026-03-25
Companion docs:

- `docs/TEACHER_ADMIN_WORKSPACE_RECALIBRATION_PLAN_2026-03-25.md`
- `docs/TEACHER_ADMIN_WIREFRAMES_2026-03-25.md`
- `docs/TEACHER_ADMIN_UI_IMPLEMENTATION_PLAN_2026-03-25.md`

Purpose:
Convert the teacher/admin UI recalibration plan into sprint-ready implementation tickets.

## 1. Ticket Status Model

Use one of these labels:

- `ready`: can enter sprint planning immediately
- `next`: should start after upstream structure work is complete
- `later`: valid roadmap work, but not yet ready to schedule
- `spike`: discovery or design confirmation required before implementation

## 2. Priority Model

- `P0`: critical to product clarity, adoption, and role separation
- `P1`: important follow-on work that strengthens the experience
- `P2`: polish or extension work after the main IA shift is stable

## 3. Ownership Model

Use these shorthand owners:

- `FE`: frontend
- `BE`: backend
- `UX`: product / UX design
- `PLAT`: routing / shell / shared architecture

## 4. Sprint Model

Suggested sprint windows for this work:

- `Sprint U1`: role split and navigation foundation
- `Sprint U2`: admin teacher deep-dive split
- `Sprint U3`: teacher workspace creation
- `Sprint U4`: dashboard clarification
- `Sprint U5`: polish, adoption pass, and cleanup

## 5. UI Tickets

## UI-001 Role-Based Landing Route Split

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `PLAT`
- Depends on: none
- Target sprint window: `Sprint U1`
- Rollout flag: `role_based_home_routes`
- Goal: send admins and teachers into different primary experiences at login and app entry.
- Scope:
  - add `/my-workspace`
  - route teacher users to `/my-workspace`
  - keep admin users on `/dashboard`
  - update root and fallback redirect behavior
- Repo touchpoints:
  - `frontend/src/App.js`
  - `frontend/src/components/ProtectedRoute.js`
  - `frontend/src/hooks/useAuth.js`
- Acceptance criteria:
  - admin login lands on `/dashboard`
  - teacher login lands on `/my-workspace`
  - teacher users are no longer forced into the admin dashboard as their main home

## UI-002 Role-Based Shell Navigation

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`, `PLAT`
- Depends on: `UI-001`
- Target sprint window: `Sprint U1`
- Rollout flag: `role_based_shell_nav`
- Goal: make the product feel role-appropriate from the first screen.
- Scope:
  - create admin nav variant
  - create teacher nav variant
  - keep admin-only controls out of teacher nav
  - surface teacher-first labels like `My Workspace`
- Repo touchpoints:
  - `frontend/src/components/LayoutShell.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - admins and teachers see meaningfully different primary navigation
  - teacher nav feels like a working space, not a control panel
  - admin-only tools remain hidden from teacher users

## UI-003 Standard Time-Horizon Label System

- Status: `ready`
- Priority: `P0`
- Owners: `UX`, `FE`
- Depends on: none
- Target sprint window: `Sprint U1`
- Rollout flag: `time_horizon_labels`
- Goal: establish a single vocabulary for latest-class versus ongoing-pattern content.
- Scope:
  - add shared labels for:
    - latest class
    - from this lesson
    - immediate follow-up
    - ongoing goal
    - recurring pattern
    - across recent observations
  - apply copy rules to core admin/teacher pages
- Repo touchpoints:
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - short-term and long-term language is consistent across pages
  - no key page relies on implicit interpretation of time horizon

## UI-004 Teacher Workspace Route Stub

- Status: `ready`
- Priority: `P0`
- Owners: `FE`
- Depends on: `UI-001`, `UI-002`
- Target sprint window: `Sprint U1`
- Rollout flag: `teacher_workspace_home`
- Goal: create the initial teacher-owned home route before full page migration.
- Scope:
  - add `TeacherWorkspacePage`
  - add route and shell integration
  - render a first-pass page skeleton with placeholder sections
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/App.js`
  - `frontend/src/components/LayoutShell.js`
- Acceptance criteria:
  - `/my-workspace` exists and is reachable
  - teacher users can enter a teacher-owned page shell
  - no admin-only sections appear by default

## UI-005 Admin Teacher Deep-Dive Header Reframe

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-003`
- Target sprint window: `Sprint U2`
- Rollout flag: `admin_teacher_deep_dive_v2`
- Goal: make the top of the admin teacher page clearly read as supervisory and evidence-backed.
- Scope:
  - reframe top summary
  - show latest lesson date and next conference clearly
  - provide direct links to latest lesson and ongoing goals
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - admin can immediately identify latest lesson context
  - top-of-page hierarchy signals reflective review, not teacher-owned workflow

## UI-006 Latest Class Review Module

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-005`
- Target sprint window: `Sprint U2`
- Rollout flag: `admin_teacher_deep_dive_v2`
- Goal: create a clearly lesson-scoped section for short-term insight.
- Scope:
  - latest class summary
  - immediate strengths
  - immediate concerns
  - timestamped evidence
  - latest admin comment
  - latest teacher response
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/components/assessment/AssessmentFeedbackWidget.js`
  - `frontend/src/components/assessment/ObservationFocusPanel.js`
- Acceptance criteria:
  - section is clearly anchored to one lesson and one date
  - users can distinguish latest-class content from recurring pattern content

## UI-007 Ongoing Coaching Record Module

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-005`
- Target sprint window: `Sprint U2`
- Rollout flag: `admin_teacher_deep_dive_v2`
- Goal: create a separate long-term coaching section for recurring patterns and goals.
- Scope:
  - active goals
  - recurring strengths
  - recurring challenges
  - conference continuity
  - long-term coaching notes
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/features/teachers/api.js`
- Acceptance criteria:
  - long-term coaching content is visually and structurally distinct
  - page no longer blurs latest lesson comments with ongoing development goals

## UI-008 Evidence-Over-Time Bridge Module

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-006`, `UI-007`
- Target sprint window: `Sprint U2`
- Rollout flag: `admin_teacher_deep_dive_v2`
- Goal: connect lesson-specific evidence to recurring patterns without mixing them.
- Scope:
  - performance-over-time chart framing
  - labels such as:
    - single observation
    - emerging pattern
    - established pattern
  - explanation of why a pattern is treated as recurring
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - supporting chart components if extracted
- Acceptance criteria:
  - trend section helps bridge short-term and long-term interpretation
  - users can tell whether a conclusion comes from one lesson or repeated evidence

## UI-009 Admin Action Lane Separation

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-006`, `UI-007`
- Target sprint window: `Sprint U2`
- Rollout flag: `admin_teacher_deep_dive_v2`
- Goal: move admin controls into a dedicated supervisory action lane.
- Scope:
  - schedule conference
  - add/adjust admin comment
  - update ongoing goal
  - recommendation usefulness override
  - score override access
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - admin controls no longer visually compete with evidence sections
  - page reads as evidence first, action second

## UI-010 Teacher-Owned Workflow Migration Plan in Code

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-004`
- Target sprint window: `Sprint U3`
- Rollout flag: `teacher_workspace_home`
- Goal: move teacher-owned actions out of the admin deep-dive and into the teacher workspace.
- Scope:
  - identify and relocate:
    - privacy setup
    - video upload/record
    - curriculum upload
    - lesson plan upload
    - syllabus upload
    - teacher-authored reflections
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/pages/TeacherWorkspacePage.js`
- Acceptance criteria:
  - teacher-owned actions primarily live in the teacher workspace
  - admin page is no longer the main place for uploads and setup

## UI-011 Teacher Workspace Current Work Module

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-004`, `UI-010`
- Target sprint window: `Sprint U3`
- Rollout flag: `teacher_workspace_home`
- Goal: give teachers a clear “what matters now” section.
- Scope:
  - latest uploaded class
  - most recent summary
  - immediate strengths
  - immediate next step
  - urgent attention items
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/features/assessments/api.js`
- Acceptance criteria:
  - teacher can immediately see what happened in the latest class
  - short-term feedback is clearly distinct from long-term goals

## UI-012 Teacher Workspace Goals Module

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-004`, `UI-010`
- Target sprint window: `Sprint U3`
- Rollout flag: `teacher_workspace_home`
- Goal: give teachers a stable home for ongoing goals and repeating patterns.
- Scope:
  - show ongoing goals
  - explain why the goal is active
  - connect recent evidence to each goal
  - allow teacher implementation notes to stay close to the goal
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/features/teachers/api.js`
- Acceptance criteria:
  - ongoing goals are visually separate from latest-class feedback
  - teacher can understand what is long-term and why

## UI-013 Teacher Workspace Uploads and Materials Module

- Status: `ready`
- Priority: `P0`
- Owners: `FE`
- Depends on: `UI-010`
- Target sprint window: `Sprint U3`
- Rollout flag: `teacher_workspace_home`
- Goal: consolidate teacher uploads and setup into one clear working area.
- Scope:
  - privacy profile
  - upload lesson video
  - upload curriculum
  - upload lesson plan
  - upload syllabus
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/features/teachers/api.js`
  - `frontend/src/features/videos/api.js`
- Acceptance criteria:
  - teacher can find all upload/setup actions in one place
  - no need to navigate through admin-style sections to do teacher tasks

## UI-014 Teacher Reflect and Respond Module

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-011`, `UI-012`
- Target sprint window: `Sprint U3`
- Rollout flag: `teacher_workspace_home`
- Goal: make teacher response and reflection a core part of the workspace.
- Scope:
  - latest teacher reflection
  - response to admin comment
  - what I tried
  - what I will try next
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/features/assessments/api.js`
- Acceptance criteria:
  - teacher can respond and reflect without leaving their workspace
  - reflection content is clearly connected to either latest class or ongoing goals

## UI-015 Teacher Workspace History Module

- Status: `next`
- Priority: `P1`
- Owners: `FE`
- Depends on: `UI-011`, `UI-012`, `UI-013`
- Target sprint window: `Sprint U3-U4`
- Rollout flag: `teacher_workspace_home`
- Goal: preserve context without overwhelming the teacher home page.
- Scope:
  - prior lessons
  - prior feedback
  - completed goals
  - prior conference notes
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
- Acceptance criteria:
  - historical information is available but visually secondary
  - teacher home remains action-oriented

## UI-016 Dashboard Triage Row Reframe

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-003`
- Target sprint window: `Sprint U4`
- Rollout flag: `dashboard_time_horizon_v2`
- Goal: make the dashboard top row answer immediate triage questions first.
- Scope:
  - needs follow-up now
  - new lesson signals
  - recurring themes
  - improving momentum
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
- Acceptance criteria:
  - top row communicates priorities at a glance
  - KPI framing reinforces action, not just reporting

## UI-017 Dashboard Recent Lesson Signals Section

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-016`
- Target sprint window: `Sprint U4`
- Rollout flag: `dashboard_time_horizon_v2`
- Goal: separate latest lesson follow-up from trend-based insights.
- Scope:
  - dedicated section labeled as latest-class content
  - date-stamped teacher cards
  - immediate concern/strength summary
  - link to deep dive or lesson review
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/features/assessments/api.js`
- Acceptance criteria:
  - recent lesson signals are clearly lesson-scoped
  - users can identify immediate follow-up items without interpreting trend widgets

## UI-018 Dashboard Recurring Patterns Section

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UI-016`
- Target sprint window: `Sprint U4`
- Rollout flag: `dashboard_time_horizon_v2`
- Goal: create a dedicated long-term pattern row on the dashboard.
- Scope:
  - recurring challenges
  - ongoing goals
  - repeating strengths
  - cumulative framing language
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
- Acceptance criteria:
  - long-term themes are visually distinct from latest lesson signals
  - no ambiguity remains about whether a card is one-off or recurring

## UI-019 Dashboard Operations Demotion Pass

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UI-017`, `UI-018`
- Target sprint window: `Sprint U4`
- Rollout flag: `dashboard_time_horizon_v2`
- Goal: keep setup and operations visible but secondary to coaching insight.
- Scope:
  - move compliance/focus domain/setup blocks lower
  - reduce visual competition with core coaching signals
  - preserve admin access to operational tools
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
- Acceptance criteria:
  - dashboard reads as triage and coaching first
  - operational blocks remain reachable but not dominant

## UI-020 Teachers Roster Clarification Pass

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UI-006`, `UI-007`, `UI-017`, `UI-018`
- Target sprint window: `Sprint U4-U5`
- Rollout flag: `teachers_roster_clarity_v2`
- Goal: make the roster a better entry point into the admin deep-dive model.
- Scope:
  - clarify row expansion content
  - separate latest observation snapshot from trend snapshot
  - tighten CTA language into deep dive
- Repo touchpoints:
  - `frontend/src/pages/TeachersPage.js`
- Acceptance criteria:
  - roster rows no longer merge latest comments and recurring patterns into one undifferentiated block
  - admin can move from roster into clear deep-dive review

## UI-021 Shared Section Styling and Hierarchy Pass

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UI-006`, `UI-007`, `UI-011`, `UI-012`, `UI-017`, `UI-018`
- Target sprint window: `Sprint U5`
- Rollout flag: `ui_hierarchy_pass`
- Goal: make section types visually consistent across admin and teacher experiences.
- Scope:
  - define section treatments for:
    - latest class
    - ongoing goals
    - admin actions
    - teacher actions
  - normalize section header patterns and support text
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - shared UI components if needed
- Acceptance criteria:
  - page hierarchy is visually consistent across major surfaces
  - users can infer section type from layout and labeling alone

## UI-022 Adoption and Low-Tech Usability Pass

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UI-011`, `UI-013`, `UI-017`, `UI-018`
- Target sprint window: `Sprint U5`
- Rollout flag: `low_tech_usability_pass`
- Goal: reduce friction for users with low-tech workflows and low tolerance for ambiguity.
- Scope:
  - simplify instructional copy
  - tighten CTA language
  - reduce optionality where it causes hesitation
  - improve empty states and affordances in new role-specific pages
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - first-use flow feels easier for both teacher and admin
  - pages are clearer without training or explanation

## 6. Suggested Sprint Order

### Sprint U1

- `UI-001 Role-Based Landing Route Split`
- `UI-002 Role-Based Shell Navigation`
- `UI-003 Standard Time-Horizon Label System`
- `UI-004 Teacher Workspace Route Stub`

### Sprint U2

- `UI-005 Admin Teacher Deep-Dive Header Reframe`
- `UI-006 Latest Class Review Module`
- `UI-007 Ongoing Coaching Record Module`
- `UI-008 Evidence-Over-Time Bridge Module`
- `UI-009 Admin Action Lane Separation`

### Sprint U3

- `UI-010 Teacher-Owned Workflow Migration Plan in Code`
- `UI-011 Teacher Workspace Current Work Module`
- `UI-012 Teacher Workspace Goals Module`
- `UI-013 Teacher Workspace Uploads and Materials Module`
- `UI-014 Teacher Reflect and Respond Module`
- `UI-015 Teacher Workspace History Module`

### Sprint U4

- `UI-016 Dashboard Triage Row Reframe`
- `UI-017 Dashboard Recent Lesson Signals Section`
- `UI-018 Dashboard Recurring Patterns Section`
- `UI-019 Dashboard Operations Demotion Pass`
- `UI-020 Teachers Roster Clarification Pass`

### Sprint U5

- `UI-021 Shared Section Styling and Hierarchy Pass`
- `UI-022 Adoption and Low-Tech Usability Pass`

## 7. Ticket Template For Tracker Conversion

Use this template if you move these into Linear, Jira, or GitHub Issues:

- Ticket ID:
- Title:
- Status:
- Priority:
- Owners:
- Depends on:
- Target sprint window:
- Rollout flag:
- Goal:
- Scope:
- Repo touchpoints:
- Acceptance criteria:

## 8. Final Guidance

This work should not start with visual polish alone.

The correct build order is:

1. route split
2. role-based shell
3. admin deep-dive structure
4. teacher workspace creation
5. dashboard clarification
6. final usability polish

That sequence keeps the work focused on utility, ease of use, and ease of adoption rather than cosmetic changes without structural clarity.
