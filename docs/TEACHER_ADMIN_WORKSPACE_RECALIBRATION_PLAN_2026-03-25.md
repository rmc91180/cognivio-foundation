# Cognivio Teacher/Admin Workspace Recalibration Plan

Date: 2026-03-25

## Purpose

Clarify the product for both admins and teachers by making a strong visual and structural distinction between:

- what we learned from the most recent class
- what repeats over time and has become an ongoing coaching goal
- what belongs in the teacher's own working space versus the admin's reflective and supervisory view

The goal is utility, ease of use, and ease of adoption for both roles.

## Confirmed Current-State Problem

The codebase confirms the product gap:

- The app currently routes everyone to the same dashboard entry point at `/dashboard`, regardless of role.
- The teacher deep-dive currently lives in a single shared page at `/teachers/:teacherId`.
- The current teacher profile page mixes short-term lesson review, long-term coaching, teacher uploads, privacy setup, curriculum artifacts, action planning, and admin review into one large surface.

Relevant implementation references:

- Shared dashboard route in [App.js](c:\Projects\Cognivio\frontend\src\App.js#L24)
- Shared teacher profile route in [App.js](c:\Projects\Cognivio\frontend\src\App.js#L40)
- Shared global nav in [LayoutShell.js](c:\Projects\Cognivio\frontend\src\components\LayoutShell.js#L39)
- Admin/teacher role split is only partial in [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js#L36)
- Long-term coaching data and short-term lesson data are pulled together in [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js#L77), [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js#L86), [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js#L113), and [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js#L1572)
- Dashboard is still primarily leadership analytics and operations, not role-specific teaching context, in [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js#L134), [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js#L140), [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js#L1752), and [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js#L1857)

## Product Principle

The system should always answer two different questions separately:

1. What did we learn from the latest class?
2. What patterns are repeating often enough that they now define the teacher's ongoing development goals?

These should never appear as one undifferentiated block of feedback.

## Target Information Architecture

### 1. Admin Dashboard

Purpose:
School/program leadership overview and triage.

What it should emphasize:

- who needs attention now
- who is improving over time
- what recent lesson evidence requires follow-up
- what ongoing coaching priorities are emerging across teachers

What it should not be:

- the teacher's living workspace
- the place where files are uploaded
- the place where detailed teacher self-reflection is authored

Recommended structure:

- Top row: operational summary and triage
  - teachers needing review
  - new lessons awaiting follow-up
  - teachers with recurring growth themes
  - teachers showing momentum
- Middle row: separate "Recent lesson signals" from "Long-term coaching patterns"
  - Recent lesson signals = last uploaded/last reviewed class windows
  - Long-term coaching patterns = recurring challenges/goals across the recent time window
- Bottom row: cohort and compliance surfaces
  - observation coverage
  - recording compliance
  - department/program pattern view

Required visual distinction:

- Recent lesson items should be date-stamped and phrased in immediate language:
  - "From the most recent class"
  - "Last lesson observed"
  - "Immediate follow-up"
- Long-term items should be labeled as cumulative:
  - "Repeating pattern"
  - "Ongoing growth goal"
  - "Across recent observations"

### 2. Admin Teacher Deep Dive

Purpose:
A reflective, evidence-backed supervisory view for one teacher.

This page should answer:

- What happened in the latest class?
- What trends are repeating?
- What is the current coaching direction?
- What evidence supports that direction?

Recommended page structure:

#### Section A. Latest Class Review

This is the short-term layer.

Contents:

- latest lesson card
- date/time of lesson
- short summary of what was seen
- immediate strengths from the latest class
- immediate concerns from the latest class
- evidence moments and timestamps
- admin comments tied to that class
- teacher response tied to that class
- "next conversation" suggestions tied to that class

Design rule:
Everything in this section should feel anchored to one lesson and one date.

#### Section B. Ongoing Coaching Record

This is the long-term layer.

Contents:

- recurring strengths
- recurring challenges
- repeated rubric domains/elements requiring attention
- active coaching goals
- progress against goals over time
- aggregated admin reflections
- aggregated teacher reflection themes

Design rule:
Everything here should be framed as a pattern, not a one-off event.

#### Section C. Evidence and Trend View

Purpose:
Connect short-term and long-term thinking.

Contents:

- performance over time chart
- evidence-backed explanation of why a pattern is considered recurring
- "seen in 1 lesson" vs "seen across multiple lessons" labeling
- trend windows with plain language

Recommended labels:

- single observation
- emerging pattern
- established pattern

#### Section D. Admin Actions

Admin-only actions should live in their own section:

- add coaching comment
- adjust evaluation interpretation
- update long-term goals
- schedule next conference
- add follow-up prompt

This keeps the page reflective first, supervisory second.

### 3. Teacher Workspace

Purpose:
This is where the teacher lives inside Cognivio.

This should become a distinct role-shaped experience, not just the admin deep-dive with a few extra controls.

Primary teacher jobs:

- upload privacy information
- upload videos
- upload lesson plans, syllabus, curriculum artifacts
- see what was learned from the latest class
- respond to admin comments
- reflect on recent teaching
- work toward ongoing goals
- prepare for next coaching conversation

Recommended teacher page structure:

#### Section A. This Week / This Class

Short-term and immediate.

Contents:

- latest uploaded class
- latest feedback summary
- newest admin comment
- what to review next
- what the teacher needs to respond to now

This should feel active and current.

#### Section B. My Growth Goals

Long-term and stable.

Contents:

- current ongoing goals
- why each goal is active
- recent evidence connected to each goal
- progress status
- teacher-owned notes on implementation

This should feel like a working development plan, not a report.

#### Section C. My Workspace

Teacher-owned inputs.

Contents:

- privacy profile
- upload video
- upload curriculum
- upload lesson plan
- upload syllabus
- draft reflections
- teacher comments and responses

This section is where action happens.

#### Section D. My History

Reference and context.

Contents:

- previous uploaded lessons
- previous comments
- prior reflections
- completed goals
- prior conference notes

This should be present but visually secondary.

## Structural Product Change Required

The current app should evolve from:

- one shared dashboard
- one shared teacher profile page

to:

- admin dashboard
- admin teacher deep-dive page
- teacher workspace home

Recommended route direction:

- `/dashboard` becomes admin-first when admin is logged in
- teacher login should land on a dedicated teacher workspace route
- `/teachers/:teacherId` should remain the admin deep-dive
- add a teacher-owned route such as `/my-workspace` or `/me`

## Data Framing Rules

To keep the UI clear, every reflection/comment/goal needs a time horizon and source context.

### Short-Term Record

Definition:
Tied to a single lesson, observation, or recent upload.

Examples:

- latest class summary
- admin note on yesterday's lesson
- evidence moments from one uploaded class
- teacher response to one specific observation

UI labels:

- Last class
- Latest lesson
- From this upload
- Immediate follow-up

### Long-Term Record

Definition:
A pattern synthesized from repeated observations, repeated teacher reflection, or repeated admin feedback.

Examples:

- recurring challenge in questioning
- semester-long participation goal
- repeated note about wait time
- year-long classroom culture objective

UI labels:

- Ongoing goal
- Repeating pattern
- Across recent observations
- Long-term development focus

## Execution Plan

### Phase A. Information Architecture and Role Split

Goal:
Separate admin and teacher page responsibilities before refining visual design.

Tasks:

- define target route map
- define admin-only versus teacher-only actions
- define which shared data components can remain reusable
- define a standard label system for short-term versus long-term content

Deliverable:

- approved page map and content hierarchy

### Phase B. Admin Teacher Deep Dive Refactor

Goal:
Turn the current teacher profile into a clearly structured admin page.

Tasks:

- split the page into latest class review, ongoing coaching record, evidence/trends, and admin actions
- visually separate lesson-specific evidence from recurring themes
- reduce teacher-owned upload actions from this page
- preserve admin comment and follow-up workflows

Deliverable:

- admin page that reads as a supervisory narrative, not a mixed workspace

### Phase C. Teacher Workspace Creation

Goal:
Create a teacher-first home inside the system.

Tasks:

- create teacher-owned landing route
- move uploads, privacy, and working reflections there
- show immediate to-dos and current goals separately
- make teacher response flows primary

Deliverable:

- teacher page that feels active, practical, and low-friction

### Phase D. Dashboard Clarification

Goal:
Make dashboard cards clearly distinguish immediate signals from long-term patterns.

Tasks:

- separate latest-class signals from recurring patterns
- date-stamp short-term items
- aggregate long-term themes into dedicated cards
- reduce ambiguity in trend and coaching summaries

Deliverable:

- dashboard that supports fast triage without blurring time horizons

## Suggested Ticket Grouping

Epic 1: Role-based page architecture

- define teacher landing route
- define admin teacher deep-dive route behavior
- update navigation and route guards

Epic 2: Time-horizon content model

- standardize labels for latest lesson versus ongoing pattern
- tag rendered UI sections as lesson-scoped or trend-scoped
- adjust summary copy to reflect scope clearly

Epic 3: Admin teacher deep-dive redesign

- latest class review module
- ongoing coaching record module
- evidence/trend bridge module
- admin action lane

Epic 4: Teacher workspace redesign

- teacher home
- uploads and privacy block
- current feedback block
- growth goals block
- teacher action history block

Epic 5: Dashboard clarification

- recent lesson signals row
- recurring pattern row
- teacher follow-up queue
- coaching momentum summary

## Acceptance Criteria

We should consider this successful when:

- an admin can immediately distinguish a one-lesson comment from a recurring coaching pattern
- a teacher can immediately distinguish current action items from long-term growth goals
- the teacher workspace clearly feels teacher-owned
- the admin teacher page clearly feels supervisory and evidence-backed
- no upload or privacy workflows remain primary on the admin deep-dive page
- the dashboard communicates "what happened recently" separately from "what is repeating over time"

## Recommendation Before UI Build

Before implementation, produce a lightweight wireframe pass for:

- admin dashboard
- admin teacher deep-dive
- teacher workspace home

That should be the next step before code changes, because the main issue is information architecture and visual hierarchy, not missing data.
