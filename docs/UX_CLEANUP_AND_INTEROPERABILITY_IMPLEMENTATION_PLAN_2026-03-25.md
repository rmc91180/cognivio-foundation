# Cognivio UX Cleanup And Interoperability Implementation Plan

Date: 2026-03-25

## Purpose

Define the next execution phase after the dashboard and teacher-page refocus work.

This plan intentionally sequences:

1. UX cleanup and page-model stabilization first
2. shared coaching-record structure second
3. interoperability layer third

The goal is to improve utility, clarity, and adoption for both admins and teachers without building deeper cross-page intelligence on top of unstable UX.

## Guiding Rules

- Clean the page model before deepening the system model.
- Distinguish clickable controls from informational state everywhere.
- Treat action plans and reflections as first-class shared records, not inline side panels.
- Make each major object in the product clear:
  - dashboard status
  - teacher deep dive
  - teacher workspace
  - video review
  - action-plan history
  - reflection history
- Build interoperability from shared records and shared states, not page-local hacks.

## Current State

### Already strong

- Admin and teacher routes are separated.
- Teacher-owned operational actions live in the teacher workspace.
- Latest video review is separated from long-term coaching on the admin teacher page.
- Dashboard top block and task queue are cleaner than before.
- Main dashboard charts support graph/evidence-language toggle.

### Still unresolved

- Dashboard still duplicates the roster KPI summary.
- Non-clickable status pills still look interactive.
- Action plans and reflections are shared in data, but not surfaced as first-class pages.
- Performance summary and human observations still create clutter on the admin teacher deep dive.
- Cross-page continuity is still partial instead of systemic.

## Sequence Logic

This plan is split into two tracks that must run in order.

### Track A. UX Cleanup And Structural Stabilization

Purpose:
make the product easier to read, easier to trust, and easier to navigate.

Why first:
the interoperability layer should connect stable product objects, not temporary page sections.

### Track B. Interoperability Layer

Purpose:
make the admin dashboard, teacher deep dive, teacher workspace, video review, action-plan history, and reflection history behave like one coordinated system.

Why second:
once the right pages and page responsibilities are stable, interoperability work becomes durable and much cleaner.

## Phase Map

## Phase 1. UX Cleanup And Visual Clarity

Goal:
remove visual noise, remove duplicated status surfaces, and stop misleading users about what is clickable.

### Scope

- remove duplicated dashboard KPI summary
- introduce shared meta/status styling for non-clickable labels
- make heavy deep-dive sections collapsible
- reduce admin deep-dive clutter without losing access to evidence

### Primary Files

- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)
- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)
- [SectionHeader.js](c:\Projects\Cognivio\frontend\src\components\ui\SectionHeader.js)
- [Badge.js](c:\Projects\Cognivio\frontend\src\components\ui\Badge.js)
- [MonthlySummary.js](c:\Projects\Cognivio\frontend\src\components\MonthlySummary.js)

### Work Items

#### 1.1 Remove duplicate dashboard KPI block

- Remove the lower `Teachers / Observations / Departments / Needs support` selector block.
- Keep the top overview cards as the dashboard status source of truth.
- Preserve any useful drilldown data by relocating it if needed, not duplicating it.

#### 1.2 Introduce a shared non-clickable meta style

- Separate informational pills from buttons and tabs.
- Use softer, flatter styling for:
  - `Needs attention`
  - `From this lesson`
  - `Immediate follow-up`
  - `Admin action lane`
  - similar status/meta chips
- Reserve button-like visuals for true actions only.

#### 1.3 Make admin teacher deep-dive heavy sections collapsible

- Make `Performance summary / Evidence over time` collapsible.
- Make `Human observations` collapsible.
- Keep latest video review and long-term goals visible by default.
- Default collapsed state should favor the fastest coaching read.

#### 1.4 Clean admin deep-dive lower hierarchy

- Keep reference material below primary coaching surfaces.
- Reduce the visual weight of secondary editing blocks.
- Ensure the page still reads:
  - latest reviewed lesson
  - long-term goals and adherence
  - admin actions
  - reference material on demand

### Acceptance Criteria

- Dashboard has one roster-status summary, not two.
- Users can instantly tell what is clickable and what is not.
- Teacher deep dive reads cleanly without hiding important content.
- Heavy evidence sections are available on demand, not always expanded.

## Phase 2. Shared Coaching Record Surfaces

Goal:
promote action plans and reflections from inline sections into first-class shared records with their own pages and history.

### Scope

- dedicated action-plan page
- dedicated reflection page
- clear history and chronology
- shared access model for teacher and admin

### Primary Files

- [App.js](c:\Projects\Cognivio\frontend\src\App.js)
- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)
- [TeacherWorkspacePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherWorkspacePage.js)
- [useTeacherWorkspaceData.js](c:\Projects\Cognivio\frontend\src\pages\teacher-workspace\useTeacherWorkspaceData.js)
- [server.py](c:\Projects\Cognivio\backend\server.py)
- [workspace_service.py](c:\Projects\Cognivio\backend\app\services\workspace_service.py)

### New Target Routes

Admin:

- `/teachers/:teacherId/action-plan`
- `/teachers/:teacherId/reflections`

Teacher:

- `/my-workspace/goals`
- `/my-workspace/reflections`

Optional later:

- `/teachers/:teacherId/conference-history`

### Work Items

#### 2.1 Create dedicated action-plan history page

- Show current goals, notes, owners, due dates, and status.
- Show prior saved versions or at least prior milestones/updates if full versioning is not yet stored.
- Include links back to supporting lesson pages and evidence where available.

#### 2.2 Create dedicated reflection page

- Separate teacher reflection and admin reflection clearly.
- Show newest reflection plus prior reflections in chronological order.
- Preserve shared visibility rules:
  - admin can view both
  - teacher sees what is intended for teacher visibility

#### 2.3 Keep summary pages lightweight

- Admin teacher deep dive should summarize action-plan state and reflection state.
- Teacher workspace should summarize the same shared records.
- Full editing and history lives on the dedicated pages.

#### 2.4 Clarify conference relationship

- Conference prep remains admin-facing.
- Teacher sees conference status and, later, optionally a published agenda.
- Action plans and reflections should visibly feed conference prep.

### Acceptance Criteria

- Action plan is a first-class page, not only an inline block.
- Reflection is a first-class page, not only an inline form.
- Admin and teacher can reach the same shared coaching record from their own surfaces.
- Deep-dive and workspace pages become lighter because history moves to the right place.

## Phase 3. Interoperability Foundation

Goal:
turn shared records and shared states into a coherent cross-surface workflow engine.

### Scope

- shared coaching timeline
- cross-page continuity links
- real shared task states
- stronger conference continuity

### Primary Files

- [DashboardPage.js](c:\Projects\Cognivio\frontend\src\pages\DashboardPage.js)
- [TeacherProfilePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherProfilePage.js)
- [TeacherWorkspacePage.js](c:\Projects\Cognivio\frontend\src\pages\TeacherWorkspacePage.js)
- [VideoPlayerPage.js](c:\Projects\Cognivio\frontend\src\pages\VideoPlayerPage.js)
- [TeachersPage.js](c:\Projects\Cognivio\frontend\src\pages\TeachersPage.js)
- [server.py](c:\Projects\Cognivio\backend\server.py)
- [workspace_service.py](c:\Projects\Cognivio\backend\app\services\workspace_service.py)

### Work Items

#### 3.1 Build a shared coaching timeline

- Create one chronological record that combines:
  - action-plan updates
  - teacher reflections
  - admin reflections
  - major observation comments
  - conference milestones
  - linked lesson evidence
- Show timeline entries on dedicated pages first.
- Surface summarized timeline signals back into dashboard, teacher deep dive, and teacher workspace.

#### 3.2 Add cross-page continuity links

- From dashboard task to teacher deep dive
- From teacher deep dive to exact lesson page
- From lesson page to linked action plan or reflection
- From teacher workspace to the comment, lesson, or goal that triggered the task

#### 3.3 Build a unified task-state model

- Replace page-local urgency logic with shared task states such as:
  - `awaiting_teacher_response`
  - `awaiting_admin_review`
  - `goal_checkpoint_due`
  - `conference_upcoming`
  - `privacy_blocker`
  - `new_evidence_ready`
- Use those states to feed:
  - dashboard action queue
  - teacher workspace urgent section
  - teacher deep dive next-actions surface

#### 3.4 Add conference publish/sync

- Allow admin to publish a lightweight conference agenda to the teacher.
- Teacher sees what will be discussed and what evidence or goals it is tied to.
- Preserve admin-only private prep notes separately.

### Acceptance Criteria

- The same task or coaching issue appears consistently across admin and teacher surfaces.
- Users can follow a coaching thread from dashboard to teacher to lesson to action plan without losing context.
- Conference prep has an intentional teacher-visible handoff option.

## Phase 4. Evidence-Backed Goal Interoperability

Goal:
make every long-term coaching object traceable to lesson evidence and follow-through.

### Scope

- evidence-backed goals
- evidence-backed reflections
- stronger linkage between video review and long-term development

### Work Items

#### 4.1 Attach evidence links to goals

- Each active goal should support linked evidence:
  - video page
  - timestamps
  - observation comments
  - AI review segment
- Show “why this goal exists” and “latest evidence related to this goal.”

#### 4.2 Attach evidence links to reflections

- Reflection entries should optionally reference:
  - a specific lesson
  - a specific admin comment
  - a specific goal

#### 4.3 Surface progress against goals through evidence

- Show whether a goal is being reinforced or contradicted by recent lessons.
- Distinguish:
  - one-off evidence
  - repeated evidence
  - evidence gap

### Acceptance Criteria

- Goals are not abstract text objects.
- Reflections can be tied back to the evidence that prompted them.
- Long-term growth becomes visibly evidence-backed, not just summarized.

## Phase 5. Shared Memory And Adaptive Support Layer

Goal:
use the existing shared memory foundation to make the system more adaptive without adding UX complexity.

### Scope

- teacher-specific recurring context
- action-plan-aware prompts
- reflection-aware coaching suggestions
- memory-informed task prioritization

### Work Items

#### 5.1 Promote shared memory into user-facing usefulness

- Use reflection context and action-plan memory to shape:
  - coaching suggestions
  - dashboard task ranking
  - teacher workspace prompts
  - conference prep continuity

#### 5.2 Make teacher tasks smarter

- If the teacher has already responded, do not keep surfacing the same unresolved task.
- If a goal is active, push the next relevant evidence-backed step instead of generic reminders.

#### 5.3 Make admin queue smarter

- Rank follow-up not only by missing steps, but by:
  - recency
  - importance
  - repeated challenge
  - upcoming conference timing
  - missing teacher response

### Acceptance Criteria

- The product feels more coordinated without becoming more complicated.
- Admins and teachers see fewer generic prompts and more context-aware guidance.

## Delivery Order

### Batch 1

- Phase 1.1 duplicate KPI removal
- Phase 1.2 shared meta/status styling
- Phase 1.3 collapsible deep-dive sections
- Phase 1.4 lower-hierarchy cleanup

### Batch 2

- Phase 2.1 action-plan history page
- Phase 2.2 reflection history page
- Phase 2.3 summary-page lightening
- Phase 2.4 conference relationship cleanup

### Batch 3

- Phase 3.1 shared coaching timeline
- Phase 3.2 cross-page continuity links
- Phase 3.3 unified task-state model
- Phase 3.4 conference publish/sync

### Batch 4

- Phase 4.1 evidence-backed goals
- Phase 4.2 evidence-backed reflections
- Phase 4.3 evidence-based goal progress

### Batch 5

- Phase 5.1 memory-informed support
- Phase 5.2 smarter teacher tasks
- Phase 5.3 smarter admin queue

## Things We Should Not Do Yet

- Do not build fully new AI surfaces before shared task state exists.
- Do not build separate admin and teacher action-plan systems.
- Do not expose deep memory concepts directly in the UI.
- Do not add more dashboard widgets while the coaching record model is still stabilizing.
- Do not mix history pages and live editing surfaces in a confusing way.

## Recommended Immediate Next Step

Start Batch 1 now.

That gives us:

- immediate visible UX improvement
- cleaner foundations for the teacher deep dive
- cleaner foundations for the shared coaching record pages
- a safer base for interoperability work in the next batch
