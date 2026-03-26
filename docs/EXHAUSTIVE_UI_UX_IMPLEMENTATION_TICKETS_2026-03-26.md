# Cognivio Exhaustive UI/UX Implementation Tickets

Date: 2026-03-26  
Companion docs:

- `docs/EXHAUSTIVE_UI_UX_IMPLEMENTATION_PLAN_2026-03-26.md`

Purpose:  
Convert the full UI/UX implementation plan into sprint-ready implementation tickets covering cleanup, structural refactors, sub-page creation, and higher-value usability improvements.

## 1. Ticket Status Model

Use one of these labels:

- `ready`: can enter sprint planning immediately
- `next`: should start after upstream structure work is complete
- `later`: valid roadmap work, but not yet ready to schedule
- `spike`: discovery or design confirmation required before implementation

## 2. Priority Model

- `P0`: critical to clarity, utility, and adoption
- `P1`: important improvement that materially strengthens workflow quality
- `P2`: polish or extension work after the core IA shift is stable

## 3. Ownership Model

Use these shorthand owners:

- `FE`: frontend
- `BE`: backend
- `UX`: product / UX design
- `PLAT`: routing / shell / shared architecture

## 4. Sprint Model

Suggested sprint windows for this work:

- `Sprint UX1`: navigation and page-model simplification
- `Sprint UX2`: dashboard re-architecture
- `Sprint UX3`: roster simplification
- `Sprint UX4`: admin teacher deep-dive refactor
- `Sprint UX5`: shared coaching record consolidation
- `Sprint UX6`: teacher workspace simplification
- `Sprint UX7`: video review declutter
- `Sprint UX8`: cross-page context and continuity
- `Sprint UX9`: adoption and utility enhancements

## 5. Phase 1 Tickets: Navigation and Page-Model Simplification

## UX-001 Teacher Workspace Route-Based Rendering

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `PLAT`, `UX`
- Depends on: none
- Target sprint window: `Sprint UX1`
- Rollout flag: `teacher_workspace_route_sections`
- Goal: make `/my-workspace/:section` behave as true section routing instead of stacked same-page content.
- Scope:
  - render one major workspace section at a time
  - remove stacked multi-section rendering on `/my-workspace`
  - preserve direct links for `goals`, `reflections`, `materials`, and `history`
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/App.js`
  - `frontend/src/pages/teacher-workspace/useTeacherWorkspaceData.js`
- Acceptance criteria:
  - `/my-workspace` shows only home content
  - `/my-workspace/goals` shows only goals content
  - `/my-workspace/reflections` shows only reflections content
  - users no longer scroll through all major teacher sections on one page

## UX-002 Teacher Workspace Navigation Simplification

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-001`
- Target sprint window: `Sprint UX1`
- Rollout flag: `teacher_workspace_nav_cleanup`
- Goal: remove redundant local navigation patterns from the teacher workspace.
- Scope:
  - reduce overlap between shell nav, top action buttons, start-here cards, and sidebar
  - keep one primary nav and one lightweight local context strip only where useful
  - simplify top CTA hierarchy
- Repo touchpoints:
  - `frontend/src/components/LayoutShell.js`
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - teacher users do not see four competing navigation mechanisms
  - each page has one obvious way to move to the next relevant place
  - top CTA density is reduced

## UX-003 Reusable Context Header Component

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`, `PLAT`
- Depends on: none
- Target sprint window: `Sprint UX1`
- Rollout flag: `context_header_component`
- Goal: create a shared context header that orients users on deep pages.
- Scope:
  - show teacher name, latest lesson date, active goals, next conference, and quick links
  - support admin and teacher variants
  - support teacher, action-plan, reflection, coaching, and video pages
- Repo touchpoints:
  - `frontend/src/components/ui/*`
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/pages/ActionPlanRecordPage.js`
  - `frontend/src/pages/ReflectionRecordPage.js`
  - `frontend/src/pages/VideoPlayerPage.js`
- Acceptance criteria:
  - deep pages clearly show what object the user is viewing
  - users can move between related records without relying only on the shell

## UX-004 Breadcrumb / Context Trail System

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`, `PLAT`
- Depends on: `UX-003`
- Target sprint window: `Sprint UX1`
- Rollout flag: `page_context_trails`
- Goal: improve cross-page navigation clarity once users are below top-level routes.
- Scope:
  - add route-aware breadcrumbs for teacher, video, and coaching pages
  - ensure consistency across admin and teacher paths
- Repo touchpoints:
  - `frontend/src/App.js`
  - `frontend/src/components/ui/*`
  - deep page components
- Acceptance criteria:
  - users can understand where they are and how they got there
  - deep navigation no longer relies only on one-off return buttons

## 6. Phase 2 Tickets: Dashboard Re-Architecture

## UX-005 Dashboard Operations / Insights Mode Switch

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-003`
- Target sprint window: `Sprint UX2`
- Rollout flag: `dashboard_dual_mode`
- Goal: separate operational workflow from analytical review on the dashboard.
- Scope:
  - add `Operations` and `Insights` mode switch
  - preserve existing admin data sources
  - map sections into one of the two modes
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - dashboard no longer reads like one long mixed-purpose page
  - operational work and reflective analysis are visually distinct

## UX-006 Dashboard Operations Lane Refactor

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-005`
- Target sprint window: `Sprint UX2`
- Rollout flag: `dashboard_operations_lane`
- Goal: make the top of the dashboard feel like a real admin operating surface.
- Scope:
  - keep only acute follow-up tasks
  - include readiness blockers, teacher follow-through, lesson review, and conference prep
  - down-rank secondary system metrics in the first viewport
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - the first admin viewport answers “what do I do now?”
  - no duplicated or overly broad queue items appear

## UX-007 Dashboard Insights Lane Refactor

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-005`
- Target sprint window: `Sprint UX2`
- Rollout flag: `dashboard_insights_lane`
- Goal: make insight surfaces feel coherent and evidence-backed.
- Scope:
  - group recent lesson signals
  - group recurring patterns and ongoing goals
  - preserve graph/evidence toggles
  - clarify teacher and subject filters
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/components/dashboard/*`
- Acceptance criteria:
  - insight content is organized by time horizon
  - graphs and evidence views feel like one system

## UX-008 Dashboard Secondary Operations Demotion

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-006`, `UX-007`
- Target sprint window: `Sprint UX2`
- Rollout flag: `dashboard_secondary_ops_demote`
- Goal: move secondary operational surfaces out of the core dashboard reading path.
- Scope:
  - demote recognition operations
  - demote launch-health detail
  - preserve access via sub-page links or collapsible sections
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - related ops pages
- Acceptance criteria:
  - secondary consoles no longer visually compete with core workflow sections

## 7. Phase 3 Tickets: Roster Simplification

## UX-009 Roster Creation Flow Extraction

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Target sprint window: `Sprint UX3`
- Rollout flag: `teacher_creation_modal_or_drawer`
- Goal: remove inline teacher creation from the main roster reading context.
- Scope:
  - move add-teacher flow to modal, drawer, or dedicated sub-page
  - preserve teacher create success path and roster refresh
- Repo touchpoints:
  - `frontend/src/pages/TeachersPage.js`
  - `frontend/src/components/ui/*`
- Acceptance criteria:
  - roster page remains focused on triage and management
  - teacher creation is still easy, but no longer visually dominant

## UX-010 School Management Flow Extraction

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-009`
- Target sprint window: `Sprint UX3`
- Rollout flag: `school_management_subflow`
- Goal: remove school-creation complexity from the inline teacher creation experience.
- Scope:
  - move school creation into a smaller setup flow or dedicated management UI
  - keep teacher create flow simpler
- Repo touchpoints:
  - `frontend/src/pages/TeachersPage.js`
  - `frontend/src/pages/FrameworksPage.js` or related setup pages
- Acceptance criteria:
  - teacher add flow is shorter and easier to scan
  - school management remains available but no longer clutters roster

## UX-011 Teacher Row Quick Action System

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Target sprint window: `Sprint UX3`
- Rollout flag: `teacher_row_quick_actions`
- Goal: turn each roster row into a clear entry point into the right follow-up workflow.
- Scope:
  - add quick actions for deep dive, latest lesson, coaching record, and schedule
  - keep row-level actions lightweight and obvious
- Repo touchpoints:
  - `frontend/src/pages/TeachersPage.js`
- Acceptance criteria:
  - users can move from roster triage into the exact next page without hunting

## UX-012 Roster Page Section Hierarchy Cleanup

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-009`, `UX-011`
- Target sprint window: `Sprint UX3`
- Rollout flag: `roster_hierarchy_cleanup`
- Goal: make the roster page read as one coherent management surface.
- Scope:
  - tighten filter/sort row
  - simplify summary stats
  - reduce mixed-purpose UI on the same scroll path
- Repo touchpoints:
  - `frontend/src/pages/TeachersPage.js`
- Acceptance criteria:
  - the roster page no longer feels like a control panel and a management form at once

## 8. Phase 4 Tickets: Admin Teacher Deep-Dive Refactor

## UX-013 Teacher Deep-Dive Summary Hub

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-003`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_deep_dive_hub`
- Goal: make the root teacher page a summary hub instead of an everything page.
- Scope:
  - keep latest lesson summary
  - keep long-term coaching summary
  - keep admin action lane
  - convert everything else into secondary references or links
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - admin teacher page becomes faster to read
  - users are encouraged to click through to focused sub-pages

## UX-014 Latest Lesson Sub-Page

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-013`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_latest_lesson_page`
- Goal: create a dedicated page for lesson-scoped teacher review.
- Scope:
  - add `/teachers/:teacherId/latest-lesson`
  - show latest lesson summary, evidence, timestamps, and lesson-specific follow-up
  - link to full video review
- Repo touchpoints:
  - `frontend/src/App.js`
  - new latest lesson page
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - latest-lesson content no longer needs to dominate the teacher summary hub

## UX-015 Ongoing Coaching Sub-Page

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-013`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_ongoing_coaching_page`
- Goal: create a focused page for recurring goals, patterns, and coaching continuity.
- Scope:
  - add `/teachers/:teacherId/coaching`
  - show recurring strengths, recurring challenges, goals in motion, and conference continuity
- Repo touchpoints:
  - `frontend/src/App.js`
  - new coaching page
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - ongoing coaching no longer competes visually with latest lesson evidence

## UX-016 Teacher History Sub-Page

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-013`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_history_page`
- Goal: move historical reference material into a dedicated archive page.
- Scope:
  - add `/teachers/:teacherId/history`
  - show historical observations, prior reflections, prior plans, and trend archive
- Repo touchpoints:
  - `frontend/src/App.js`
  - new teacher history page
- Acceptance criteria:
  - historical material stops inflating the summary hub

## UX-017 Admin Teacher Page Data-Fetch Cleanup

- Status: `ready`
- Priority: `P0`
- Owners: `FE`
- Depends on: `UX-013`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_deep_dive_data_cleanup`
- Goal: remove teacher-owned operational data-fetching and mutation logic from the admin teacher page.
- Scope:
  - remove admin-page use of curriculum/lesson-plan/syllabus upload mutations
  - remove admin-page use of video recorder flows
  - keep read-only summaries only where needed
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - admin page no longer carries unnecessary teacher-owned workflow code
  - page complexity is reduced without regressions

## UX-018 Deep-Dive Secondary Reference Standardization

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-013`
- Target sprint window: `Sprint UX4`
- Rollout flag: `teacher_secondary_reference_panels`
- Goal: standardize collapsible heavy sections on the teacher deep dive.
- Scope:
  - keep evidence-over-time and human observations collapsed by default
  - apply common visual treatment
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/components/ui/*`
- Acceptance criteria:
  - secondary sections are clearly reference material, not primary workflow

## 9. Phase 5 Tickets: Shared Coaching Record Consolidation

## UX-019 Shared Coaching Hub Route

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `PLAT`, `UX`
- Depends on: `UX-015`
- Target sprint window: `Sprint UX5`
- Rollout flag: `shared_coaching_hub`
- Goal: create a single coaching hub that organizes goals, reflections, timeline, and conference continuity.
- Scope:
  - add `/teachers/:teacherId/coaching` and `/my-workspace/coaching`
  - include tabbed or segmented navigation for goals, reflections, timeline, and conference
- Repo touchpoints:
  - `frontend/src/App.js`
  - new coaching hub page
  - shared coaching components
- Acceptance criteria:
  - coaching record feels like one system rather than separate sibling pages

## UX-020 Action Plan Record Reframe

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-019`
- Target sprint window: `Sprint UX5`
- Rollout flag: `action_plan_record_reframe`
- Goal: reposition the action plan page as one focused part of the coaching hub.
- Scope:
  - add tab context / return context
  - clarify ownership labels
  - emphasize evidence-backed goals and progress
- Repo touchpoints:
  - `frontend/src/pages/ActionPlanRecordPage.js`
- Acceptance criteria:
  - action plan page reads as “shared goals record,” not an isolated page

## UX-021 Reflection Record Reframe

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-019`
- Target sprint window: `Sprint UX5`
- Rollout flag: `reflection_record_reframe`
- Goal: reposition the reflection page as part of one coaching conversation.
- Scope:
  - clarify admin reflection vs teacher response
  - improve anchor-to-goal / anchor-to-lesson clarity
  - emphasize continuity with action plan and timeline
- Repo touchpoints:
  - `frontend/src/pages/ReflectionRecordPage.js`
- Acceptance criteria:
  - reflection record clearly expresses a shared coaching dialogue

## UX-022 Coaching Timeline Centrality Pass

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-019`, `UX-020`, `UX-021`
- Target sprint window: `Sprint UX5`
- Rollout flag: `coaching_timeline_centrality`
- Goal: elevate the coaching timeline into a central continuity layer across coaching records.
- Scope:
  - reuse timeline consistently in coaching hub, action plans, and reflections
  - normalize entry types and link-outs
- Repo touchpoints:
  - `frontend/src/components/coaching/CoachingTimelinePanel.js`
  - coaching pages
  - `backend/server.py`
- Acceptance criteria:
  - users can follow the coaching story chronologically without page-hopping blind

## 10. Phase 6 Tickets: Teacher Workspace Simplification and Empowerment

## UX-023 Teacher Workspace Home Reframe

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-001`, `UX-002`
- Target sprint window: `Sprint UX6`
- Rollout flag: `teacher_workspace_this_week_home`
- Goal: make `/my-workspace` a concise “This week” home instead of a compressed dashboard.
- Scope:
  - latest class summary
  - what needs my response
  - goals in motion
  - next conference
  - one recommended next move
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
- Acceptance criteria:
  - home page feels like a teacher home base
  - only the most useful current-week content remains on the main route

## UX-024 Teacher Materials Page Tightening

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-001`
- Target sprint window: `Sprint UX6`
- Rollout flag: `teacher_materials_page_cleanup`
- Goal: make the materials page the clear home for setup and uploads.
- Scope:
  - group privacy, video capture/upload, curriculum, lesson plans, and syllabus
  - clarify required vs optional setup items
  - improve upload hierarchy and labels
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - upload-related components
- Acceptance criteria:
  - teachers understand where to do operational setup work
  - upload flows feel consolidated rather than scattered

## UX-025 Teacher Task Card Language Pass

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-023`
- Target sprint window: `Sprint UX6`
- Rollout flag: `teacher_task_language_v2`
- Goal: make teacher task cards read like specific teacher actions, not abstract workflow states.
- Scope:
  - replace abstract phrasing with direct follow-through language
  - include “why this matters” context where helpful
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
  - `backend/server.py`
- Acceptance criteria:
  - teacher tasks are actionable and understandable to low-tech users

## UX-026 Teacher Workspace Onboarding Strip

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-023`, `UX-024`
- Target sprint window: `Sprint UX6`
- Rollout flag: `teacher_workspace_onboarding_strip`
- Goal: provide a lightweight onboarding layer without cluttering the workspace.
- Scope:
  - show what is due first
  - show what has already been completed
  - keep it concise and dismissible
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
- Acceptance criteria:
  - first-time and low-tech teachers know where to start without extra clutter

## 11. Phase 7 Tickets: Video Review Declutter

## UX-027 Video Review Primary / Secondary Split

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`, `PLAT`
- Depends on: none
- Target sprint window: `Sprint UX7`
- Rollout flag: `video_review_primary_secondary_modes`
- Goal: split lesson review from advanced admin-only tooling.
- Scope:
  - add `/videos/:videoId/review`
  - add `/videos/:videoId/admin-tools`
  - keep `/videos/:videoId` redirecting to review mode
- Repo touchpoints:
  - `frontend/src/App.js`
  - `frontend/src/pages/VideoPlayerPage.js`
- Acceptance criteria:
  - core lesson review no longer competes with sharing/recognition/admin extras

## UX-028 Video Review Core Surface Simplification

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `UX-027`
- Target sprint window: `Sprint UX7`
- Rollout flag: `video_review_core_surface`
- Goal: keep the review page focused on playback, evidence, and coaching output.
- Scope:
  - prioritize playback, timeline, observations, lesson summary, evidence, and recommended moments
  - strengthen link into coaching record
- Repo touchpoints:
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/components/VideoTimeline.js`
- Acceptance criteria:
  - review workflow feels cleaner and easier to scan

## UX-029 Video Admin Tools Extraction

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-027`
- Target sprint window: `Sprint UX7`
- Rollout flag: `video_admin_tools_page`
- Goal: move advanced secondary tools into a more appropriate place.
- Scope:
  - recognition controls
  - share assets
  - social card generation
  - exemplar submission
  - export and admin-only extras
- Repo touchpoints:
  - `frontend/src/pages/VideoPlayerPage.js`
  - related sharing / recognition components
- Acceptance criteria:
  - advanced tools remain available without cluttering evidence review

## 12. Phase 8 Tickets: Cross-Page Context and Continuity

## UX-030 Related Record Quick-Link System

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`, `PLAT`
- Depends on: `UX-003`
- Target sprint window: `Sprint UX8`
- Rollout flag: `related_record_quick_links`
- Goal: standardize cross-page links between teacher, coaching, and video surfaces.
- Scope:
  - open latest lesson
  - open coaching hub
  - open goals
  - open reflections
  - open history
- Repo touchpoints:
  - shared deep page headers
  - deep page route models
- Acceptance criteria:
  - users can navigate between related records without guessing where to go next

## UX-031 Shared Button Hierarchy Standard

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: none
- Target sprint window: `Sprint UX8`
- Rollout flag: `button_hierarchy_standard`
- Goal: normalize primary, secondary, and metadata visual language across the app.
- Scope:
  - ensure metadata labels do not look clickable
  - ensure one primary CTA per section max
  - normalize outlined secondary buttons
- Repo touchpoints:
  - shared UI components
  - admin and teacher pages
- Acceptance criteria:
  - clickable and non-clickable elements are visually distinct everywhere

## UX-032 Shared Collapsible Reference Pattern

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: none
- Target sprint window: `Sprint UX8`
- Rollout flag: `collapsible_reference_pattern`
- Goal: create one common pattern for heavy reference panels.
- Scope:
  - historical notes
  - human observations
  - raw evidence details
  - secondary diagnostics
- Repo touchpoints:
  - `frontend/src/components/ui/*`
  - deep page surfaces
- Acceptance criteria:
  - secondary reference content feels consistent across the app

## 13. Phase 9 Tickets: Utility and Adoption Enhancements

## UX-033 Smarter Empty State System

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `UX-005`, `UX-009`, `UX-023`
- Target sprint window: `Sprint UX9`
- Rollout flag: `empty_state_v2`
- Goal: ensure each major page explains purpose, missing prerequisites, and next action.
- Scope:
  - dashboard
  - roster
  - teacher deep dive
  - teacher workspace
  - coaching records
  - video review
- Repo touchpoints:
  - page components
  - shared UI empty states
- Acceptance criteria:
  - no major page feels like a dead end when data is missing

## UX-034 Workflow Status Language Upgrade

- Status: `ready`
- Priority: `P1`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-025`
- Target sprint window: `Sprint UX9`
- Rollout flag: `workflow_status_language_v2`
- Goal: replace internal workflow wording with clearer user-centered language.
- Scope:
  - admin tasks
  - teacher tasks
  - queue cards
  - status labels
- Repo touchpoints:
  - locales
  - queue builders
  - task surfaces
- Acceptance criteria:
  - workflow language becomes clearer without losing accuracy

## UX-035 “Why This Matters” Microcopy Layer

- Status: `next`
- Priority: `P1`
- Owners: `UX`, `FE`
- Depends on: `UX-006`, `UX-025`, `UX-034`
- Target sprint window: `Sprint UX9`
- Rollout flag: `microcopy_why_this_matters`
- Goal: add lightweight explanations that improve trust and understanding.
- Scope:
  - tasks
  - goals
  - trends
  - conference prep
- Repo touchpoints:
  - locales
  - page-level cards and panels
- Acceptance criteria:
  - users understand why a surface or task is being shown with minimal extra reading

## UX-036 Conference Continuity UX Upgrade

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-019`, `UX-021`
- Target sprint window: `Sprint UX9`
- Rollout flag: `conference_continuity_upgrade`
- Goal: make conference flows feel more connected and actionable.
- Scope:
  - connect agenda, latest evidence, current goals, and prior follow-through
  - improve admin publish flow and teacher read flow
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - coaching hub
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - backend conference-prep surfaces
- Acceptance criteria:
  - conference prep feels like a coherent continuity tool, not a separate island

## UX-037 Adaptive Support Display Tightening

- Status: `later`
- Priority: `P2`
- Owners: `FE`, `UX`, `BE`
- Depends on: `UX-023`, `UX-034`
- Target sprint window: `Sprint UX9`
- Rollout flag: `adaptive_support_display_v2`
- Goal: keep adaptive prompts helpful without adding more AI clutter.
- Scope:
  - refine prompt placement
  - reduce repeated AI panels
  - make one next move more obvious
- Repo touchpoints:
  - `frontend/src/pages/TeacherWorkspacePage.js`
  - `frontend/src/pages/DashboardPage.js`
  - adaptive support backend responses
- Acceptance criteria:
  - adaptive support strengthens the workflow without increasing visual noise

## 14. Recommended Sprint Order

Execute in this order:

1. `Sprint UX1`
- `UX-001`
- `UX-002`
- `UX-003`
- `UX-004`

2. `Sprint UX2`
- `UX-005`
- `UX-006`
- `UX-007`
- `UX-008`

3. `Sprint UX3`
- `UX-009`
- `UX-010`
- `UX-011`
- `UX-012`

4. `Sprint UX4`
- `UX-013`
- `UX-014`
- `UX-015`
- `UX-016`
- `UX-017`
- `UX-018`

5. `Sprint UX5`
- `UX-019`
- `UX-020`
- `UX-021`
- `UX-022`

6. `Sprint UX6`
- `UX-023`
- `UX-024`
- `UX-025`
- `UX-026`

7. `Sprint UX7`
- `UX-027`
- `UX-028`
- `UX-029`

8. `Sprint UX8`
- `UX-030`
- `UX-031`
- `UX-032`

9. `Sprint UX9`
- `UX-033`
- `UX-034`
- `UX-035`
- `UX-036`
- `UX-037`

## 15. Immediate Ready Queue

The best starting queue is:

- `UX-001 Teacher Workspace Route-Based Rendering`
- `UX-002 Teacher Workspace Navigation Simplification`
- `UX-003 Reusable Context Header Component`
- `UX-005 Dashboard Operations / Insights Mode Switch`
- `UX-009 Roster Creation Flow Extraction`
- `UX-013 Teacher Deep-Dive Summary Hub`

These tickets unlock the rest of the UI/UX roadmap without creating rework.
