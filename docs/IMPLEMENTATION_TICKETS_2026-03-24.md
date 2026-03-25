# Cognivio Implementation Tickets

Date: 2026-03-24
Companion docs:

- `docs/EXECUTABLE_DEV_PLAN_2026-03-24.md`
- `docs/WORKING_DELIVERY_ARTIFACT_2026-03-24.md`

Purpose:
Translate the roadmap into ticket-level implementation work across all phases.

## 1. Ticket Status Model

Use one of these labels for each ticket:

- `ready`: can enter sprint planning now
- `next`: should be started after current dependencies are complete
- `later`: valid roadmap work, but not yet ready to schedule
- `spike`: discovery work required before implementation

## 2. Priority Model

- `P0`: critical to product superiority and pilot readiness
- `P1`: important follow-on work
- `P2`: valuable, but only after higher-value workflow work is stable

## 3. Ownership Model

Use these shorthand owners:

- `FE`: frontend
- `BE`: backend
- `AI`: analysis / model / prompt / ranking work
- `PLAT`: platform / architecture / observability
- `UX`: product / UX design

## 4. Phase 1 Tickets

Target horizon: next 8-12 weeks

## P1-001 Dashboard Role Shell

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: make the dashboard immediately communicate next actions for principals and trainers
- Scope:
  - tighten top-of-page hierarchy
  - reduce secondary clutter
  - create role-aware smart queue shell
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/components/dashboard/*`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - the first viewport communicates role, priorities, and next actions
  - core actions are reachable from the dashboard without hunting
  - no regression to existing dashboard sections

## P1-002 Dashboard Smart Queue Content

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `BE`, `UX`
- Depends on: `P1-001`
- Goal: populate the dashboard with high-leverage actions instead of static summary only
- Scope:
  - define queue items for principals
  - define queue items for training programs
  - map queue actions to real routes and workflow states
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - at least 3 actionable queue items appear when data exists
  - queue actions deep-link into real follow-up flows
  - queue content differs meaningfully by role or mode

## P1-003 Guided Onboarding Checklist

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: reduce setup confusion for first-time users
- Scope:
  - create onboarding checklist by role
  - support steps for teachers, videos, privacy, and first review
  - persist checklist progress locally or per user
- Repo touchpoints:
  - `frontend/src/pages/AuthPage.js`
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/lib/api.js`
- Acceptance criteria:
  - new user sees a clear getting-started path
  - checklist progress persists between sessions
  - checklist steps map to actual product actions

## P1-004 Empty State Standardization

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: make all empty states instructive and action-oriented
- Scope:
  - standardize empty states for dashboard, teachers, videos, teacher profile
  - add explicit CTA copy and next actions
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/TeachersPage.js`
  - `frontend/src/pages/VideosPage.js`
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/components/ui/*`
- Acceptance criteria:
  - no major route ends in a dead-end empty state
  - each empty state has a next action or explanation
  - styling is consistent across pages

## P1-005 Feature Flag Framework Expansion

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `BE`, `PLAT`
- Depends on: none
- Goal: safely ship new AI and UX features behind runtime flags
- Scope:
  - extend current runtime config model
  - add flag naming rules
  - support flags for training mode, feedback capture, AI intensity, and experimental ranking
- Repo touchpoints:
  - `frontend/src/lib/runtimeConfig.js`
  - `frontend/public/runtime-config.js`
  - `backend/app/config.py`
  - `docs/`
- Acceptance criteria:
  - new features can be disabled without code changes
  - flag values are readable in frontend runtime config
  - rollout guidance is documented

## P1-006 Video Review Layout Pass

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: make lesson review easier than competitor tools for a first-time reviewer
- Scope:
  - simplify player layout
  - improve timestamp navigation clarity
  - improve relationship between video, observations, rubric, and actions
- Repo touchpoints:
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/components/VideoTimeline.js`
- Acceptance criteria:
  - reviewer can move from observation list to video moment to action with minimal friction
  - screen hierarchy is visually obvious
  - the page is easier to scan on laptop-size screens

## P1-007 Video Review Action Focus

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `P1-006`
- Goal: reduce clutter from secondary actions during core observation review
- Scope:
  - down-rank recognition and sharing features in observation-first contexts
  - emphasize coaching summary, evidence, and report actions
- Repo touchpoints:
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/features/videos/components/VideoRow.js`
- Acceptance criteria:
  - observation-centered actions are visually primary
  - secondary recognition features do not dominate the page
  - core review flow remains intact

## P1-008 Privacy Status Language Pass

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `BE`, `UX`
- Depends on: none
- Goal: make privacy and review states easier to understand
- Scope:
  - normalize copy for `review required`, `completed`, `failed`, `manual override`
  - align wording across videos page, player page, and review queue
- Repo touchpoints:
  - `frontend/src/pages/VideosPage.js`
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/pages/PrivacyReviewQueuePage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - state naming is consistent across pages
  - user can understand whether action is needed
  - no contradictory labels remain

## P1-009 Report Feedback API

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: none
- Goal: create backend support for usefulness ratings and free-text feedback
- Scope:
  - add data model for report feedback
  - expose endpoints to save and query output usefulness by output block
  - support summary and recommendation-level feedback
- Repo touchpoints:
  - `backend/app/services/assessment_service.py`
  - `backend/app/repositories/assessment_repository.py`
  - `backend/app/routers/assessments.py`
  - `backend/server.py`
- Acceptance criteria:
  - frontend can submit ratings and comments
  - feedback records are queryable by assessment and user
  - schema supports later evaluation usage

## P1-010 Report Feedback UI

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `P1-009`
- Goal: let users rate the usefulness of AI outputs in context
- Scope:
  - add useful/not useful controls
  - add optional reason input
  - expose feedback on teacher profile and video player
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/features/assessments/api.js`
- Acceptance criteria:
  - ratings can be submitted without leaving the page
  - users can add optional rationale
  - submission state is clear and non-disruptive

## P1-011 Override Taxonomy and Storage

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `P1-009`
- Goal: expand override capture beyond score changes
- Scope:
  - define override taxonomy for score, evidence relevance, and recommendation usefulness
  - store override reason and target type
- Repo touchpoints:
  - `backend/app/services/assessment_service.py`
  - `backend/app/repositories/assessment_repository.py`
  - `backend/server.py`
- Acceptance criteria:
  - override types are structured and queryable
  - override storage supports future analysis
  - score override compatibility is preserved

## P1-012 Override UI Expansion

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `P1-011`
- Goal: let reviewers correct more than just scores
- Scope:
  - preserve current score override flow
  - add recommendation usefulness override or rejection
  - add evidence relevance marking where practical
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - `frontend/src/features/videos/components/VideoRow.js`
- Acceptance criteria:
  - reviewers can override at least score and recommendation usefulness
  - override history remains visible where relevant
  - the UI does not become cluttered

## P1-013 Focus Context UI Visibility

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: show users how observation focus affected the analysis
- Scope:
  - surface selected priority elements and focus note in review flows
  - make focus context visible in dashboard, framework, and lesson review contexts
- Repo touchpoints:
  - `frontend/src/pages/FrameworksPage.js`
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/VideoPlayerPage.js`
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - focus context is visible without hunting
  - users can connect outputs to their selected observation priorities

## P1-014 Focus-Aware Prompt and Synthesis Refinement

- Status: `ready`
- Priority: `P0`
- Owners: `AI`, `BE`
- Depends on: none
- Goal: make focus notes and priority elements materially influence output quality
- Scope:
  - tighten prompt instructions
  - refine summary and recommendation generation
  - improve output grounding around prioritized domains
- Repo touchpoints:
  - `backend/app/analysis/analysis_orchestrator.py`
  - `backend/app/analysis/model_clients/openai_analysis.py`
  - `backend/server.py`
- Acceptance criteria:
  - prioritized elements are visibly reflected in summaries and recommendations
  - focus notes do not produce generic or repetitive output

## P1-015 Evaluation Harness Foundation

- Status: `ready`
- Priority: `P0`
- Owners: `AI`, `PLAT`
- Depends on: none
- Goal: create a repeatable way to evaluate analysis quality before launch
- Scope:
  - define initial gold-set recordings
  - define evaluation rubric for summary usefulness, evidence relevance, and coaching quality
  - create script or test harness to compare changes
- Repo touchpoints:
  - `backend/tests/*`
  - `backend/app/analysis/*`
  - `scripts/`
  - `docs/`
- Acceptance criteria:
  - analysis changes can be tested against a known baseline
  - output quality comparisons are documented and repeatable

## P1-016 Moment Ranking Refinement

- Status: `next`
- Priority: `P0`
- Owners: `AI`, `BE`
- Depends on: `P1-015`
- Goal: improve ranking of the most useful video moments for coaching
- Scope:
  - refine moment ranking logic
  - improve alignment between ranked moments and observation value
  - reduce low-value timestamps
- Repo touchpoints:
  - `backend/app/analysis/moment_sampler.py`
  - `backend/app/analysis/multimodal_analysis.py`
  - `backend/server.py`
- Acceptance criteria:
  - ranked moments are more likely to be opened and used by reviewers
  - obvious low-value moments are reduced

## P1-017 Coaching Packet Quality Pass

- Status: `next`
- Priority: `P0`
- Owners: `AI`, `BE`
- Depends on: `P1-015`
- Goal: make observation summaries and coaching actions more specific and useful
- Scope:
  - tighten observation summary packet
  - improve action language
  - improve linkage between evidence and next step
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/analysis/model_clients/openai_analysis.py`
  - `frontend/src/pages/VideoPlayerPage.js`
- Acceptance criteria:
  - recommendations are less generic
  - evidence and action feel more tightly connected

## P1-018 Teacher Profile Coaching Workspace UX

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: none
- Goal: make the teacher profile the primary place for coaching follow-through
- Scope:
  - clarify action plan section
  - strengthen next steps
  - improve reflection flow and scheduling visibility
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
- Acceptance criteria:
  - profile reads like a coaching workspace, not a data dump
  - next action is obvious after lesson review

## P1-019 Coaching Workflow Backend Support

- Status: `next`
- Priority: `P0`
- Owners: `BE`
- Depends on: `P1-018`
- Goal: support smoother observation-to-action and conference workflows
- Scope:
  - tighten action-plan persistence
  - improve schedule creation semantics for coaching conferences
  - support follow-up data needed by the profile
- Repo touchpoints:
  - `backend/app/services/teacher_service.py`
  - `backend/server.py`
- Acceptance criteria:
  - action plan and conference state persist reliably
  - follow-up actions can be retrieved cleanly

## P1-020 Lightweight Training Mode Foundation

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `P1-001`, `P1-018`
- Goal: support teacher-training workflows without splitting the app
- Scope:
  - add training-oriented terminology and queue copy
  - create cohort-oriented filters and presets
  - make dashboard and teachers page feel less principal-only
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - `frontend/src/pages/TeachersPage.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - trainer can use dashboard and roster without school-admin mismatch in key copy
  - no major architectural split is introduced

## P1-021 Service Boundary Cleanup For New Feedback Features

- Status: `next`
- Priority: `P1`
- Owners: `BE`, `PLAT`
- Depends on: `P1-009`, `P1-011`
- Goal: prevent new Phase 1 logic from deepening legacy coupling
- Scope:
  - route feedback and override work through extracted services and repositories
  - reduce new direct feature logic in `backend/server.py`
- Repo touchpoints:
  - `backend/app/services/*`
  - `backend/app/repositories/*`
  - `backend/app/routers/*`
  - `backend/server.py`
- Acceptance criteria:
  - new feedback and override domain logic lives primarily in modular service layers

## P1-022 Phase 1 Stabilization and Pilot Hardening

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `BE`, `AI`, `PLAT`
- Depends on: all prior P1 work
- Goal: stabilize the product before pilot exposure
- Scope:
  - regression pass on critical workflows
  - bug fixing
  - feature-flag review
  - pilot notes and known-issues review
- Repo touchpoints:
  - cross-cutting
- Acceptance criteria:
  - no known P0 workflow breakage
  - pilot-facing features are documented and controllable

## 5. Phase 2 Tickets

Target horizon: 2-4 months after Phase 1

## P2-001 Mode Model and Preference Storage

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`
- Depends on: `P1-020`
- Goal: formalize School Mode and Training Mode as durable product concepts
- Scope:
  - mode selection and persistence
  - organization default with per-user override
- Repo touchpoints:
  - `frontend/src/App.js`
  - `frontend/src/lib/api.js`
  - backend user/settings endpoints
- Acceptance criteria:
  - mode is persistent and reversible
  - mode affects product presentation in predictable ways

## P2-002 Mode-Specific Dashboard Behavior

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `UX`, `BE`
- Depends on: `P2-001`
- Goal: make dashboard behavior meaningfully different by operating context
- Scope:
  - school-focused cards and actions
  - training-focused cards and actions
- Repo touchpoints:
  - `frontend/src/pages/DashboardPage.js`
  - dashboard-related backend query surfaces
- Acceptance criteria:
  - dashboard priorities differ clearly by mode
  - shared codebase is preserved

## P2-003 Cohort Analytics API

- Status: `later`
- Priority: `P1`
- Owners: `BE`
- Depends on: `P2-001`
- Goal: support training-program oversight at cohort level
- Scope:
  - cohort aggregation endpoints
  - skill gap summaries
  - cohort trend summaries
- Repo touchpoints:
  - new backend service/router work
  - `backend/app/services/*`
- Acceptance criteria:
  - cohort summaries can be queried without custom scripts

## P2-004 Cohort Analytics UI

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `P2-003`
- Goal: make cohort progress visible and actionable
- Scope:
  - cohort overview screen or embedded dashboard section
  - filters and trend views for training-program use
- Repo touchpoints:
  - `frontend/src/pages/*`
- Acceptance criteria:
  - trainer can review cohort progress without per-teacher manual drilling only

## P2-005 Supervisor Calibration API

- Status: `later`
- Priority: `P1`
- Owners: `BE`
- Depends on: `P2-003`
- Goal: help training programs compare supervisor patterns and consistency
- Scope:
  - calibration-oriented summary endpoints
  - observation pattern comparison support
- Repo touchpoints:
  - new backend service/router work
- Acceptance criteria:
  - program can retrieve supervisor-level comparison summaries

## P2-006 Supervisor Calibration UI

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `P2-005`
- Goal: surface calibration gaps and supervisor drift clearly
- Scope:
  - comparison visuals
  - supervisor-level summaries
  - coach/trainer interpretation affordances
- Repo touchpoints:
  - new or expanded pages in `frontend/src/pages/`
- Acceptance criteria:
  - calibration issues are visible without analyst support

## P2-007 Organization Memory Schema and Service

- Status: `later`
- Priority: `P1`
- Owners: `BE`, `PLAT`
- Depends on: completion of core Phase 1 feedback capture
- Goal: store organization priorities and coaching context in a bounded, auditable service
- Scope:
  - define organization memory model
  - support scoped retrieval by organization, user, and teacher
  - define retention and mutation rules
- Repo touchpoints:
  - new repositories/services under `backend/app/`
- Acceptance criteria:
  - memory is scoped and auditable
  - retrieval is bounded and does not create hidden product behavior

## P2-008 Analysis Context Retrieval

- Status: `later`
- Priority: `P1`
- Owners: `AI`, `BE`
- Depends on: `P2-007`
- Goal: use organization and coaching context during analysis generation
- Scope:
  - retrieve organization priorities
  - retrieve teacher coaching context
  - inject bounded context into analysis pipeline
- Repo touchpoints:
  - `backend/app/analysis/analysis_orchestrator.py`
  - `backend/app/analysis/model_clients/openai_analysis.py`
- Acceptance criteria:
  - outputs improve from context without becoming opaque or overfit

## P2-009 Recommendation Tuning Pipeline

- Status: `later`
- Priority: `P1`
- Owners: `AI`, `PLAT`
- Depends on: `P1-009`, `P1-011`, `P1-015`
- Goal: improve recommendation ranking and phrasing from human signals
- Scope:
  - build data pipeline from ratings and overrides
  - create bounded ranking/tuning logic
- Repo touchpoints:
  - backend analysis and evaluation layers
- Acceptance criteria:
  - recommendation behavior can improve from signals in a measurable, reviewable way

## P2-010 Feedback Digest API

- Status: `later`
- Priority: `P2`
- Owners: `BE`
- Depends on: `P2-009`
- Goal: make system learning visible to users
- Scope:
  - expose summarized changes or trends from human feedback
  - support admin/trainer review views
- Repo touchpoints:
  - new backend service/router work
- Acceptance criteria:
  - digest data is retrievable in a stable, explainable format

## P2-011 Feedback Digest UI

- Status: `later`
- Priority: `P2`
- Owners: `FE`, `UX`
- Depends on: `P2-010`
- Goal: show users what changed from their feedback
- Scope:
  - periodic digest UI
  - clear explanation of learned changes
  - human approval pattern for major shifts
- Repo touchpoints:
  - dashboard or settings surfaces
- Acceptance criteria:
  - users can see how the system changed from human input
  - no claim of hidden self-modification is implied

## P2-012 Action Plan Continuity and Conference Prep

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`, `UX`
- Depends on: `P1-019`
- Goal: make follow-up coaching easier across multiple observations
- Scope:
  - reusable conference prep summary
  - stronger continuity between previous goals and new observations
  - clearer follow-up comparison
- Repo touchpoints:
  - `frontend/src/pages/TeacherProfilePage.js`
  - relevant backend teacher/action-plan endpoints
- Acceptance criteria:
  - coach can prepare for a follow-up conference from one screen

## P2-013 AI Quality and Override Observability

- Status: `later`
- Priority: `P1`
- Owners: `PLAT`, `BE`
- Depends on: `P1-015`, `P1-021`
- Goal: make AI quality and human correction visible internally
- Scope:
  - observability for ratings, overrides, and workflow drop-off
  - lightweight internal dashboards or query surfaces
- Repo touchpoints:
  - `backend/app/observability.py`
  - `monitoring/`
  - admin ops endpoints
- Acceptance criteria:
  - internal team can inspect where AI output is helping or failing

## 6. Phase 3 Tickets

Target horizon: 4-8 months after Phase 2

## P3-001 Specialist Service Contract Design

- Status: `spike`
- Priority: `P1`
- Owners: `PLAT`, `AI`
- Depends on: strong completion of Phase 2
- Goal: define contracts for bounded specialist reasoning services
- Scope:
  - define service boundaries for coaching, trend, equity, or ranking specialists
  - design contracts before orchestration
- Repo touchpoints:
  - architecture docs
  - `backend/app/analysis/*`
- Acceptance criteria:
  - specialist services are clearly defined and product-driven

## P3-002 Specialist Service Orchestrator

- Status: `later`
- Priority: `P1`
- Owners: `PLAT`, `AI`, `BE`
- Depends on: `P3-001`
- Goal: introduce bounded orchestration across specialist services
- Scope:
  - durable coordination across reasoning components
  - no user-facing "9 agents" framing
- Repo touchpoints:
  - orchestration layer under `backend/app/analysis/`
- Acceptance criteria:
  - orchestrated specialist reasoning adds value without destabilizing core workflows

## P3-003 MCP-Compatible Tool Layer Spike

- Status: `spike`
- Priority: `P2`
- Owners: `PLAT`
- Depends on: `P3-001`
- Goal: evaluate whether MCP-compatible interfaces create real product value
- Scope:
  - tool interface design spike
  - identify real product use cases before implementation
- Repo touchpoints:
  - platform architecture docs
- Acceptance criteria:
  - decision memo produced with go/no-go recommendation

## P3-004 Interoperability Adapter Implementation

- Status: `later`
- Priority: `P2`
- Owners: `PLAT`
- Depends on: `P3-003`
- Goal: implement external tool interoperability only where justified
- Scope:
  - adapter interfaces for selected tools
  - no broad standard implementation without product case
- Repo touchpoints:
  - backend platform/service layer
- Acceptance criteria:
  - at least one meaningful interoperability path exists and is maintainable

## P3-005 Predictive Planning Experiment Backend

- Status: `later`
- Priority: `P2`
- Owners: `AI`, `BE`
- Depends on: high trust and strong Phase 2 personalization
- Goal: test bounded predictive planning features
- Scope:
  - prototype simulation logic
  - keep recommendations opt-in and clearly labeled experimental
- Repo touchpoints:
  - analysis services
  - dedicated experimental endpoints
- Acceptance criteria:
  - simulation is clearly marked experimental and bounded

## P3-006 Predictive Planning UI

- Status: `later`
- Priority: `P2`
- Owners: `FE`, `UX`
- Depends on: `P3-005`
- Goal: expose simulation features safely to power users
- Scope:
  - explicit opt-in UI
  - clear confidence and experimental messaging
- Repo touchpoints:
  - dashboard or coaching surfaces
- Acceptance criteria:
  - feature can be enabled by a narrow user group without cluttering the main product

## P3-007 Advanced Personalization Controls

- Status: `later`
- Priority: `P2`
- Owners: `FE`, `BE`, `UX`
- Depends on: Phase 2 context and feedback maturity
- Goal: support richer organization-specific AI behavior controls
- Scope:
  - advanced preference controls for power users
  - stronger bounded adaptation settings
- Repo touchpoints:
  - settings or admin surfaces
- Acceptance criteria:
  - advanced controls remain understandable and optional

## P3-008 Upgrade-Safe Model Sandbox

- Status: `later`
- Priority: `P1`
- Owners: `PLAT`, `AI`
- Depends on: `P1-015`, `P2-013`
- Goal: support safe model and prompt upgrades over time
- Scope:
  - sandbox path for new model testing
  - compare old and new outputs before release
- Repo touchpoints:
  - evaluation tooling
  - analysis configuration
- Acceptance criteria:
  - model upgrades can be tested safely before broad rollout

## 7. Suggested Roadmap Order

Use this as the execution order unless reality forces reprioritization.

### Phase 1 order

1. `P1-001`
2. `P1-002`
3. `P1-003`
4. `P1-004`
5. `P1-005`
6. `P1-006`
7. `P1-007`
8. `P1-008`
9. `P1-009`
10. `P1-010`
11. `P1-013`
12. `P1-014`
13. `P1-015`
14. `P1-016`
15. `P1-017`
16. `P1-018`
17. `P1-019`
18. `P1-011`
19. `P1-012`
20. `P1-020`
21. `P1-021`
22. `P1-022`

### Phase 2 order

1. `P2-001`
2. `P2-002`
3. `P2-003`
4. `P2-004`
5. `P2-005`
6. `P2-006`
7. `P2-007`
8. `P2-008`
9. `P2-009`
10. `P2-012`
11. `P2-013`
12. `P2-010`
13. `P2-011`

### Phase 3 order

1. `P3-001`
2. `P3-002`
3. `P3-003`
4. `P3-004`
5. `P3-005`
6. `P3-006`
7. `P3-007`
8. `P3-008`

## 8. Ticket Template For Conversion Into Tracker Items

When moving these into Linear, Jira, GitHub Issues, or another tracker, use this template:

- Ticket ID:
- Title:
- Phase:
- Status:
- Priority:
- Owners:
- Depends on:
- User problem:
- Scope:
- Repo touchpoints:
- Acceptance criteria:
- QA notes:
- Rollout flag:

## 9. Final Note

This roadmap is executable if we keep one discipline:

We are not building "maximum AI."
We are building the best teacher observation and coaching workflow, then layering intelligence into it carefully.

That is how Cognivio becomes both smarter and easier to adopt than Edthena, TeachFX, and Iris Connect.
