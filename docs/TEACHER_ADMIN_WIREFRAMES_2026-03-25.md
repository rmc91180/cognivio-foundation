# Cognivio Low-Fidelity Wireframes

Date: 2026-03-25

## Purpose

Translate the recalibration plan into build-ready low-fidelity wireframes for:

- Admin dashboard
- Admin teacher deep dive
- Teacher workspace home

These wireframes are intentionally structural, not visual-design final. Their job is to lock the information hierarchy and clarify the separation between:

- latest class feedback
- recurring long-term goals and patterns
- admin-owned workflows
- teacher-owned workflows

---

## 1. Admin Dashboard Wireframe

### Page Intent

This page is for triage, supervision, and pattern recognition.

It should answer:

- Who needs attention now?
- What happened in the latest reviewed lessons?
- What patterns are repeating across time?
- Where should admin/coaches focus next?

### Layout

```text
+----------------------------------------------------------------------------------+
| SIDENAV                                                                          |
| Dashboard | Teachers | Videos | Privacy | Recognition | Setup                   |
+----------------------------------------------------------------------------------+
| PAGE HEADER                                                                      |
| Admin Dashboard                                                                  |
| "Separate immediate lesson follow-up from recurring coaching patterns."          |
| [Date Range] [School/Training Mode] [Export]                                    |
+----------------------------------------------------------------------------------+
| ROW 1: TRIAGE                                                                    |
| +-------------------+ +-------------------+ +-------------------+ +------------+ |
| | Needs Follow-Up   | | New Lesson Signals| | Recurring Themes  | | Momentum   | |
| | 8 teachers        | | 5 latest lessons  | | 4 repeated issues | | 6 improving| |
| | Immediate queue   | | Waiting review    | | Across observations| | teachers   | |
| +-------------------+ +-------------------+ +-------------------+ +------------+ |
+----------------------------------------------------------------------------------+
| ROW 2: RECENT LESSON SIGNALS                                                     |
| +-------------------------------------------------------------------------+      |
| | From The Most Recent Class                                              |      |
| |-------------------------------------------------------------------------|      |
| | Teacher A | Last class: Mar 24 | Immediate concern | View lesson        |      |
| | Teacher B | Last class: Mar 23 | Strong lesson     | View lesson        |      |
| | Teacher C | Last class: Mar 22 | Needs response    | View lesson        |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
| ROW 3: RECURRING COACHING PATTERNS                                               |
| +--------------------------------------+ +------------------------------------+  |
| | Repeating Challenges                 | | Ongoing Growth Goals               |  |
| |--------------------------------------| |------------------------------------|  |
| | Questioning depth in 6 teachers      | | Student participation              |  |
| | Wait time in 4 teachers              | | Checks for understanding           |  |
| | Participation spread in 5 teachers   | | Feedback clarity                  |  |
| +--------------------------------------+ +------------------------------------+  |
+----------------------------------------------------------------------------------+
| ROW 4: SUPPORTING EVIDENCE                                                       |
| +--------------------------------------+ +------------------------------------+  |
| | Trend View                           | | Coaching Queue                      |  |
| | performance over time                | | teachers to review today            |  |
| | by teacher / domain / cohort         | | next conference due                 |  |
| +--------------------------------------+ +------------------------------------+  |
+----------------------------------------------------------------------------------+
| ROW 5: OPERATIONS                                                                 |
| +--------------------------------------+ +------------------------------------+  |
| | Recording Compliance                 | | Framework / Focus Domains           |  |
| | Upload coverage                      | | What observation emphasis is active |  |
| +--------------------------------------+ +------------------------------------+  |
+----------------------------------------------------------------------------------+
```

### Key Rules

- `Recent lesson signals` must always be lesson-scoped and date-stamped.
- `Recurring coaching patterns` must always be cumulative and trend-scoped.
- Do not place teacher uploads or teacher-authored workspace actions on this page.

### Interaction Notes

- Clicking a recent lesson card goes to admin teacher deep dive anchored on the latest lesson section.
- Clicking a recurring pattern goes to filtered teacher roster or filtered teacher deep dive list.

---

## 2. Admin Teacher Deep Dive Wireframe

### Page Intent

This page is the admin’s reflective and evidence-backed supervisory workspace for one teacher.

It should answer:

- What did we learn from the latest class?
- What is repeating over time?
- What goals are currently active?
- What evidence supports those conclusions?

### Layout

```text
+----------------------------------------------------------------------------------+
| HEADER                                                                           |
| Teacher: Sarah Johnson                                                           |
| Math | Grade 8 | Next conference: Apr 2                                          |
| [Open Latest Lesson] [Jump To Ongoing Goals] [Schedule Conference]               |
+----------------------------------------------------------------------------------+
| TOP SPLIT                                                                        |
| +---------------------------------------------------+ +------------------------+  |
| | LEFT: LATEST CLASS REVIEW                         | | RIGHT: ONGOING RECORD  |  |
| |---------------------------------------------------| |------------------------|  |
| | Last reviewed class: Mar 24                       | | Ongoing coaching goals |  |
| | Summary from that lesson                          | | Goal 1                 |  |
| | Immediate strengths                               | | Goal 2                 |  |
| | Immediate concerns                                | | Goal 3                 |  |
| | Timestamped evidence                              | | Repeating challenges   |  |
| | Latest teacher response                           | | Repeating strengths    |  |
| | Latest admin comment                              | | Trend status           |  |
| +---------------------------------------------------+ +------------------------+  |
+----------------------------------------------------------------------------------+
| MIDDLE: EVIDENCE + TREND BRIDGE                                                  |
| +-------------------------------------------------------------------------+      |
| | Evidence Over Time                                                       |      |
| |-------------------------------------------------------------------------|      |
| | Performance chart                                                       |      |
| | Labels: single observation / emerging pattern / established pattern     |      |
| | Evidence seen in 1 lesson vs multiple lessons                           |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
| LOWER LEFT: SHORT-TERM FOLLOW-UP                                                |
| +-------------------------------------------------------------------------+      |
| | Immediate Follow-Up From Latest Class                                    |      |
| |-------------------------------------------------------------------------|      |
| | What admin should address next                                           |      |
| | What teacher should respond to next                                      |      |
| | Lesson-linked evidence moments                                           |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
| LOWER RIGHT: ADMIN ACTIONS                                                      |
| +-------------------------------------------------------------------------+      |
| | Admin Actions                                                            |      |
| |-------------------------------------------------------------------------|      |
| | Add comment                                                              |      |
| | Update long-term goal                                                    |      |
| | Mark recommendation useful / rewrite                                     |      |
| | Set next conference                                                      |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
| BOTTOM: HISTORY                                                                  |
| +-------------------------------------------------------------------------+      |
| | Prior lessons | prior comments | goal history | prior conferences        |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
```

### Section Meaning

#### Latest Class Review

Short-term and specific.

Must contain only:

- latest lesson summary
- latest evidence
- latest admin comment
- latest teacher response
- immediate next-step interpretation

#### Ongoing Record

Long-term and cumulative.

Must contain only:

- recurring patterns
- active long-term goals
- trend-backed development themes
- admin longitudinal coaching interpretation

### Visual Hierarchy Rule

Use visibly different section headers and support labels:

- `Latest class`
- `Immediate follow-up`
- `Ongoing goals`
- `Recurring pattern`

This page should never feel like a teacher upload console.

---

## 3. Teacher Workspace Home Wireframe

### Page Intent

This is where the teacher lives in Cognivio.

It should answer:

- What do I need to do now?
- What did we learn from my latest class?
- What are my ongoing goals?
- Where do I upload and manage my materials?

### Layout

```text
+----------------------------------------------------------------------------------+
| HEADER                                                                           |
| My Teaching Workspace                                                            |
| "See your latest feedback, work on your goals, and manage your teaching inputs." |
| [Upload Lesson] [Upload Privacy] [Add Reflection]                                |
+----------------------------------------------------------------------------------+
| ROW 1: THIS WEEK / THIS CLASS                                                    |
| +--------------------------------------+ +------------------------------------+  |
| | Latest Class                         | | What Needs My Attention            |  |
| |--------------------------------------| |------------------------------------|  |
| | Uploaded: Mar 24                     | | New admin comment                  |  |
| | Latest summary                       | | Reflection to submit               |  |
| | Immediate strengths                  | | Privacy step missing               |  |
| | Immediate next step                  | | Lesson plan missing                |  |
| +--------------------------------------+ +------------------------------------+  |
+----------------------------------------------------------------------------------+
| ROW 2: MY GROWTH GOALS                                                           |
| +-------------------------------------------------------------------------+      |
| | Ongoing Goals                                                           |      |
| |-------------------------------------------------------------------------|      |
| | Goal card 1                                                             |      |
| | Why this goal is active                                                 |      |
| | Recent evidence tied to the goal                                        |      |
| | My implementation note                                                  |      |
| | Progress status                                                         |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
| ROW 3: MY WORKSPACE                                                              |
| +----------------------+ +----------------------+ +------------------------+      |
| | Privacy Profile      | | Lesson Uploads       | | Teaching Materials     |      |
| |----------------------| |----------------------| |------------------------|      |
| | photos/reference     | | upload video         | | lesson plans           |      |
| | status               | | upload recording     | | curriculum             |      |
| | update               | | processing status    | | syllabus               |      |
| +----------------------+ +----------------------+ +------------------------+      |
+----------------------------------------------------------------------------------+
| ROW 4: REFLECT + RESPOND                                                         |
| +--------------------------------------+ +------------------------------------+  |
| | Teacher Reflection                   | | Admin Conversation                 |  |
| |--------------------------------------| |------------------------------------|  |
| | My reflection on latest class        | | Latest admin comment               |  |
| | What I tried                         | | My response                        |  |
| | What I will try next                 | | Follow-up thread                   |  |
| +--------------------------------------+ +------------------------------------+  |
+----------------------------------------------------------------------------------+
| ROW 5: HISTORY                                                                    |
| +-------------------------------------------------------------------------+      |
| | Past lessons | prior feedback | completed goals | prior conference notes |      |
| +-------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------+
```

### Key Rules

- Teacher page must be action-oriented first, reflective second.
- Uploads and privacy belong here, not on the admin deep-dive page.
- Long-term goals should be stable and clearly separated from immediate class feedback.

### Language Rules

Short-term labels:

- latest class
- from this lesson
- immediate next step
- this week

Long-term labels:

- ongoing goal
- repeating pattern
- over time
- long-term growth focus

---

## Navigation Recommendation

### Current

- `/dashboard` shared
- `/teachers/:teacherId` shared

### Target

```text
Admin Login
  -> /dashboard
  -> /teachers/:teacherId

Teacher Login
  -> /my-workspace
  -> optional deep links to /videos or /materials
```

### Nav Recommendation

Admin nav:

- Dashboard
- Teachers
- Videos
- Privacy
- Recognition
- Setup

Teacher nav:

- My Workspace
- My Videos
- My Materials
- My Goals
- My History

This can be implemented either with:

- role-based nav variants in the same shell
- or a shell that conditionally swaps sections by role

---

## Build Mapping

### Admin Dashboard Refactor

Current source:

- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)

Target module groups:

- `RecentLessonSignalsPanel`
- `RecurringPatternsPanel`
- `TeacherFollowUpQueue`
- `DashboardOperationalRow`

### Admin Teacher Deep Dive Refactor

Current source:

- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)

Target module groups:

- `LatestClassReviewPanel`
- `OngoingCoachingRecordPanel`
- `EvidenceTrendBridgePanel`
- `AdminActionsPanel`

### Teacher Workspace

Current source to split from:

- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)

New target page:

- `TeacherWorkspacePage`

Target module groups:

- `TeacherCurrentWorkPanel`
- `TeacherGoalsPanel`
- `TeacherWorkspaceInputsPanel`
- `TeacherReflectionPanel`
- `TeacherHistoryPanel`

---

## Implementation Notes

### Do Not Change Yet

- underlying data sources
- scoring logic
- evidence generation
- action-plan persistence model

### Change First

- route and role entry points
- section hierarchy
- labels and visual grouping
- placement of upload/reflection/admin actions

### Why

The main problem is not a lack of data. The main problem is that the product currently presents different time horizons and ownership models in the same visual space.

---

## Recommended Next Step

Move from wireframes into implementation planning with:

1. route map and page ownership decisions
2. component extraction plan from current `TeacherProfilePage`
3. Phase 1 UI refactor scope for:
   - admin dashboard clarification
   - admin teacher deep-dive split
   - teacher workspace creation
