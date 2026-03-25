# Cognivio Tracker-Ready Roadmap

Date: 2026-03-24
Purpose: Pre-convert all three phases into tracker-ready items so execution can continue phase-to-phase without returning to backlog design
Companion docs:

- `docs/EXECUTABLE_DEV_PLAN_2026-03-24.md`
- `docs/WORKING_DELIVERY_ARTIFACT_2026-03-24.md`
- `docs/IMPLEMENTATION_TICKETS_2026-03-24.md`

## 1. How To Use This In Jira / Linear / GitHub Issues

Create:

- one project called `Cognivio Roadmap`
- three milestones:
  - `Phase 1`
  - `Phase 2`
  - `Phase 3`
- five labels:
  - `frontend`
  - `backend`
  - `ai`
  - `platform`
  - `ux`

Suggested workflow states:

- `Backlog`
- `Ready`
- `In Progress`
- `In Review`
- `Done`
- `Blocked`

Suggested estimate labels:

- `S`: 1-3 days
- `M`: 3-5 days
- `L`: 1-2 weeks
- `XL`: multi-sprint, split before starting

## 2. Phase Transition Rules

### Move from Phase 1 to Phase 2 when:

- core observation workflow is stable
- core review UX is strong
- feedback capture is live
- evaluation harness exists
- product is pilot-ready

### Move from Phase 2 to Phase 3 when:

- context-aware personalization is working
- trainer/admin workflows are established
- organization memory is bounded and trusted
- AI quality and override observability are in place

## 3. Tracker Item Format

Each item below is already structured for direct import.

Fields:

- `ID`
- `Title`
- `Phase`
- `Type`
- `Priority`
- `Estimate`
- `Owners`
- `Dependencies`
- `Target sprint window`
- `Rollout flag`
- `Summary`
- `Implementation checklist`
- `Acceptance criteria`

## 4. Phase 1 Tracker Items

Target sprint window: Sprints 1-6

### P1-001

- Title: Dashboard Role Shell
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 1`
- Rollout flag: `dashboard_role_shell`
- Summary: Make the dashboard immediately communicate next actions for principals and trainers.
- Implementation checklist:
  - audit current above-the-fold content in `DashboardPage`
  - define role-aware layout blocks
  - add role-specific heading and framing
  - create smart queue shell placeholder
  - update English and Hebrew copy
- Acceptance criteria:
  - first viewport communicates role, priorities, and next actions
  - dashboard is easier to scan than current version
  - existing KPI and leadership sections do not regress

### P1-002

- Title: Dashboard Smart Queue Content
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `backend`, `ux`
- Dependencies: `P1-001`
- Target sprint window: `Sprint 1-2`
- Rollout flag: `dashboard_smart_queue`
- Summary: Populate the dashboard smart queue with role-aware high-leverage actions.
- Implementation checklist:
  - define principal queue item logic
  - define trainer queue item logic
  - map queue items to real routes
  - add backend support if needed for queue computation
  - render queue items with CTA states
- Acceptance criteria:
  - at least 3 useful actions appear when relevant data exists
  - queue items deep-link into real workflows
  - queue differs meaningfully by role or mode

### P1-003

- Title: Guided Onboarding Checklist
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 1`
- Rollout flag: `guided_onboarding`
- Summary: Add a role-aware onboarding checklist for first-run users.
- Implementation checklist:
  - define first-run steps for principals, trainers, and teachers
  - render checklist in dashboard or onboarding panel
  - persist progress locally or per user
  - connect checklist actions to actual routes
- Acceptance criteria:
  - first-time user sees a clear setup path
  - progress persists across refresh/session
  - checklist steps map to real product actions

### P1-004

- Title: Empty State Standardization
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 1`
- Rollout flag: `improved_empty_states`
- Summary: Standardize empty states across major routes with next-step CTAs.
- Implementation checklist:
  - audit all major empty states
  - create standard copy and CTA patterns
  - implement in dashboard, teachers, videos, teacher profile
  - verify consistency with shared UI primitives
- Acceptance criteria:
  - no major page has a dead-end empty state
  - each empty state recommends a next action
  - design is visually consistent

### P1-005

- Title: Feature Flag Framework Expansion
- Phase: `Phase 1`
- Type: `Platform`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `backend`, `platform`
- Dependencies: none
- Target sprint window: `Sprint 1`
- Rollout flag: none
- Summary: Expand runtime feature-flag support for new UX and AI behaviors.
- Implementation checklist:
  - extend `runtimeConfig`
  - define flag naming convention
  - add flags for onboarding, smart queue, AI feedback, training mode
  - document usage pattern
- Acceptance criteria:
  - features can be enabled/disabled without code edits
  - frontend reads flags consistently
  - flag usage is documented in `docs/`

### P1-006

- Title: Video Review Layout Pass
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `L`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 2`
- Rollout flag: `video_review_v2`
- Summary: Make the lesson review experience easier to scan and act on.
- Implementation checklist:
  - simplify page hierarchy in `VideoPlayerPage`
  - improve grouping of playback, evidence, rubric, and next actions
  - tighten responsive layout for laptop screens
  - reduce visual competition between sections
- Acceptance criteria:
  - reviewer can move from video to evidence to next action without confusion
  - page is clearer on common laptop viewport sizes
  - no loss of existing functionality

### P1-007

- Title: Video Review Action Focus
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `S`
- Owners: `frontend`, `ux`
- Dependencies: `P1-006`
- Target sprint window: `Sprint 2`
- Rollout flag: `observation_first_video_review`
- Summary: Reduce clutter from secondary recognition/sharing actions in core observation review.
- Implementation checklist:
  - re-rank page action priority
  - visually down-rank recognition and share actions
  - emphasize evidence, report, and coaching actions
- Acceptance criteria:
  - observation-first workflow is visually primary
  - recognition features remain accessible but secondary

### P1-008

- Title: Privacy Status Language Pass
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `S`
- Owners: `frontend`, `backend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 2`
- Rollout flag: `privacy_copy_cleanup`
- Summary: Normalize privacy/review wording across the product.
- Implementation checklist:
  - audit privacy labels and copy
  - standardize labels in player, library, and queue
  - update translations
- Acceptance criteria:
  - labels are consistent across product surfaces
  - action-required states are clear to users

### P1-009

- Title: Report Feedback API
- Phase: `Phase 1`
- Type: `Backend`
- Priority: `P0`
- Estimate: `M`
- Owners: `backend`, `platform`
- Dependencies: none
- Target sprint window: `Sprint 2`
- Rollout flag: `report_feedback`
- Summary: Add backend support for report usefulness ratings and comments.
- Implementation checklist:
  - define feedback schema
  - create save endpoint
  - create query endpoint
  - support summary and recommendation feedback targets
  - add repository methods
- Acceptance criteria:
  - frontend can submit useful/not useful ratings
  - feedback records are queryable per assessment and user
  - schema supports future evaluation use

### P1-010

- Title: Report Feedback UI
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: `P1-009`
- Target sprint window: `Sprint 2`
- Rollout flag: `report_feedback`
- Summary: Let users rate the usefulness of summaries and recommendations in context.
- Implementation checklist:
  - add useful/not useful controls
  - add optional rationale input
  - implement submission states
  - render in teacher profile and lesson review surfaces
- Acceptance criteria:
  - users can rate outputs without leaving current page
  - rationale is optional and easy to submit
  - feedback UX is lightweight and non-disruptive

### P1-011

- Title: Override Taxonomy and Storage
- Phase: `Phase 1`
- Type: `Backend`
- Priority: `P0`
- Estimate: `M`
- Owners: `backend`, `platform`
- Dependencies: `P1-009`
- Target sprint window: `Sprint 3`
- Rollout flag: `override_expansion`
- Summary: Expand override storage beyond score-only correction.
- Implementation checklist:
  - define override types
  - support score, evidence relevance, and recommendation usefulness
  - store override target and rationale
  - preserve compatibility with existing admin override flow
- Acceptance criteria:
  - override records are structured and queryable
  - existing score override behavior continues to work

### P1-012

- Title: Override UI Expansion
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: `P1-011`
- Target sprint window: `Sprint 3`
- Rollout flag: `override_expansion`
- Summary: Expose broader correction controls to reviewers without making the UI heavy.
- Implementation checklist:
  - preserve score override UI
  - add recommendation usefulness correction flow
  - add evidence relevance correction where practical
  - surface override history
- Acceptance criteria:
  - reviewers can override at least score and recommendation usefulness
  - override interactions remain understandable and lightweight

### P1-013

- Title: Focus Context UI Visibility
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `S`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 3`
- Rollout flag: `focus_context_visibility`
- Summary: Make selected focus notes and priority elements visible in review flows.
- Implementation checklist:
  - surface focus note and priority elements in relevant pages
  - show how focus is applied in review and coaching contexts
- Acceptance criteria:
  - users can see what observation focus was active
  - focus settings are visible without extra digging

### P1-014

- Title: Focus-Aware Prompt and Synthesis Refinement
- Phase: `Phase 1`
- Type: `AI`
- Priority: `P0`
- Estimate: `M`
- Owners: `ai`, `backend`
- Dependencies: none
- Target sprint window: `Sprint 3`
- Rollout flag: `focus_aware_analysis_v2`
- Summary: Improve how focus notes and priority elements affect summaries and recommendations.
- Implementation checklist:
  - refine prompt instructions
  - tune summary generation logic
  - tune recommendation generation logic
  - validate against sample outputs
- Acceptance criteria:
  - prioritized elements materially affect output
  - focus notes do not create generic or repetitive text

### P1-015

- Title: Evaluation Harness Foundation
- Phase: `Phase 1`
- Type: `Platform`
- Priority: `P0`
- Estimate: `L`
- Owners: `ai`, `platform`
- Dependencies: none
- Target sprint window: `Sprint 4`
- Rollout flag: none
- Summary: Build a repeatable internal evaluation loop for analysis quality.
- Implementation checklist:
  - define initial gold-set recordings
  - define evaluation criteria
  - add scripts/tests for repeatable scoring
  - document evaluation process
- Acceptance criteria:
  - analysis changes can be compared against a stable baseline
  - team can review output quality before rollout

### P1-016

- Title: Moment Ranking Refinement
- Phase: `Phase 1`
- Type: `AI`
- Priority: `P0`
- Estimate: `L`
- Owners: `ai`, `backend`
- Dependencies: `P1-015`
- Target sprint window: `Sprint 4`
- Rollout flag: `moment_ranking_v2`
- Summary: Improve ranking of useful video moments for coaching and review.
- Implementation checklist:
  - refine ranking logic
  - test against evaluation set
  - compare ranked moments before/after
- Acceptance criteria:
  - ranked moments are more useful to reviewers
  - low-value moments are reduced

### P1-017

- Title: Coaching Packet Quality Pass
- Phase: `Phase 1`
- Type: `AI`
- Priority: `P0`
- Estimate: `L`
- Owners: `ai`, `backend`
- Dependencies: `P1-015`
- Target sprint window: `Sprint 4`
- Rollout flag: `coaching_packet_v2`
- Summary: Improve specificity and usefulness of summaries and coaching actions.
- Implementation checklist:
  - refine summary packet generation
  - improve action language
  - strengthen evidence-to-action linkage
  - test with evaluation harness
- Acceptance criteria:
  - recommendations are less generic
  - action items feel grounded in evidence

### P1-018

- Title: Teacher Profile Coaching Workspace UX
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P0`
- Estimate: `L`
- Owners: `frontend`, `ux`
- Dependencies: none
- Target sprint window: `Sprint 3-4`
- Rollout flag: `teacher_profile_coaching_v2`
- Summary: Make the teacher profile feel like a coaching workspace rather than a report dump.
- Implementation checklist:
  - rework action plan layout
  - clarify next-step area
  - improve reflection section usability
  - improve scheduling visibility
- Acceptance criteria:
  - coach can move from evidence to next action naturally
  - profile hierarchy feels coaching-centered

### P1-019

- Title: Coaching Workflow Backend Support
- Phase: `Phase 1`
- Type: `Backend`
- Priority: `P0`
- Estimate: `M`
- Owners: `backend`
- Dependencies: `P1-018`
- Target sprint window: `Sprint 4`
- Rollout flag: `teacher_profile_coaching_v2`
- Summary: Support smoother observation-to-action and conference flows on the backend.
- Implementation checklist:
  - tighten action-plan persistence
  - improve schedule semantics for coaching conferences
  - expose cleaner follow-up data for profile views
- Acceptance criteria:
  - action plan and conference state persist reliably
  - profile can retrieve follow-up data cleanly

### P1-020

- Title: Lightweight Training Mode Foundation
- Phase: `Phase 1`
- Type: `Feature`
- Priority: `P1`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: `P1-001`, `P1-018`
- Target sprint window: `Sprint 5`
- Rollout flag: `training_mode_foundation`
- Summary: Begin supporting teacher-training workflows without splitting the product.
- Implementation checklist:
  - adjust dashboard and roster language for training context
  - add cohort-oriented filter presets
  - reduce principal-only bias in key copy
- Acceptance criteria:
  - trainer workflows feel intentionally supported
  - no separate app or route tree is introduced

### P1-021

- Title: Service Boundary Cleanup For Feedback Features
- Phase: `Phase 1`
- Type: `Platform`
- Priority: `P1`
- Estimate: `M`
- Owners: `backend`, `platform`
- Dependencies: `P1-009`, `P1-011`
- Target sprint window: `Sprint 4-5`
- Rollout flag: none
- Summary: Keep new feedback and override work from deepening legacy coupling.
- Implementation checklist:
  - route new endpoints through extracted services
  - add repository methods
  - minimize new logic inside `backend/server.py`
- Acceptance criteria:
  - new feature logic primarily lives in modular service paths

### P1-022

- Title: Phase 1 Stabilization and Pilot Hardening
- Phase: `Phase 1`
- Type: `Hardening`
- Priority: `P0`
- Estimate: `L`
- Owners: `frontend`, `backend`, `ai`, `platform`
- Dependencies: all major Phase 1 tickets
- Target sprint window: `Sprint 6`
- Rollout flag: none
- Summary: Stabilize and harden the product after the main Phase 1 feature work.
- Implementation checklist:
  - regression pass
  - bug fixing
  - feature flag review
  - pilot-ready documentation review
- Acceptance criteria:
  - no known P0 workflow breakages remain
  - Phase 1 features are stable enough for pilot use

## 5. Phase 2 Tracker Items

Target sprint window: Sprints 7-12

### P2-001

- Title: Mode Model and Preference Storage
- Phase: `Phase 2`
- Type: `Backend/Feature`
- Priority: `P1`
- Estimate: `M`
- Owners: `frontend`, `backend`
- Dependencies: `P1-020`
- Target sprint window: `Sprint 7`
- Rollout flag: `school_training_mode`
- Summary: Make School Mode and Training Mode durable product concepts with persisted preference.
- Implementation checklist:
  - define mode storage model
  - support org default and user override
  - expose preference to frontend
- Acceptance criteria:
  - mode persists across sessions
  - mode can be changed and reversed easily

### P2-002

- Title: Mode-Specific Dashboard Behavior
- Phase: `Phase 2`
- Type: `Feature`
- Priority: `P1`
- Estimate: `L`
- Owners: `frontend`, `ux`, `backend`
- Dependencies: `P2-001`
- Target sprint window: `Sprint 7-8`
- Rollout flag: `school_training_mode`
- Summary: Make dashboard behavior materially different by operating context.
- Implementation checklist:
  - define school-specific dashboard priorities
  - define training-specific dashboard priorities
  - add mode-aware card and queue rendering
- Acceptance criteria:
  - dashboard feels context-aware in both modes
  - shared codebase is preserved

### P2-003

- Title: Cohort Analytics API
- Phase: `Phase 2`
- Type: `Backend`
- Priority: `P1`
- Estimate: `L`
- Owners: `backend`
- Dependencies: `P2-001`
- Target sprint window: `Sprint 8`
- Rollout flag: `cohort_analytics`
- Summary: Provide training-program cohort summaries and trend endpoints.
- Implementation checklist:
  - define cohort-level aggregation model
  - add endpoints for skill gaps and cohort trends
  - support filters where appropriate
- Acceptance criteria:
  - cohort summaries are queryable via API
  - output supports trainer workflows without manual export

### P2-004

- Title: Cohort Analytics UI
- Phase: `Phase 2`
- Type: `Feature`
- Priority: `P1`
- Estimate: `L`
- Owners: `frontend`, `ux`
- Dependencies: `P2-003`
- Target sprint window: `Sprint 8-9`
- Rollout flag: `cohort_analytics`
- Summary: Surface cohort progress and skill patterns in the UI.
- Implementation checklist:
  - create cohort view or embedded dashboard section
  - add filters and trend presentation
  - connect to cohort analytics API
- Acceptance criteria:
  - trainer can review cohort-level patterns without drilling into every teacher individually

### P2-005

- Title: Supervisor Calibration API
- Phase: `Phase 2`
- Type: `Backend`
- Priority: `P1`
- Estimate: `M`
- Owners: `backend`
- Dependencies: `P2-003`
- Target sprint window: `Sprint 9`
- Rollout flag: `supervisor_calibration`
- Summary: Expose supervisor comparison and calibration support data.
- Implementation checklist:
  - define calibration metrics
  - create API endpoints for supervisor comparisons
  - support filtering and summary retrieval
- Acceptance criteria:
  - program can retrieve supervisor-level comparison summaries

### P2-006

- Title: Supervisor Calibration UI
- Phase: `Phase 2`
- Type: `Feature`
- Priority: `P1`
- Estimate: `L`
- Owners: `frontend`, `ux`
- Dependencies: `P2-005`
- Target sprint window: `Sprint 9-10`
- Rollout flag: `supervisor_calibration`
- Summary: Visualize calibration gaps and supervisor patterns clearly.
- Implementation checklist:
  - design calibration views
  - render comparison summaries
  - add interpretation guidance for trainers
- Acceptance criteria:
  - calibration gaps are visible without analyst support

### P2-007

- Title: Organization Memory Schema and Service
- Phase: `Phase 2`
- Type: `Platform`
- Priority: `P1`
- Estimate: `L`
- Owners: `backend`, `platform`
- Dependencies: strong completion of Phase 1 feedback capture
- Target sprint window: `Sprint 10`
- Rollout flag: `organization_memory`
- Summary: Build bounded, scoped storage for organization priorities and coaching context.
- Implementation checklist:
  - define memory schema
  - define scoping rules
  - define retention and mutation rules
  - create storage and retrieval services
- Acceptance criteria:
  - memory is bounded, scoped, and auditable
  - retrieval behavior is deterministic enough to trust

### P2-008

- Title: Analysis Context Retrieval
- Phase: `Phase 2`
- Type: `AI`
- Priority: `P1`
- Estimate: `L`
- Owners: `ai`, `backend`
- Dependencies: `P2-007`
- Target sprint window: `Sprint 10-11`
- Rollout flag: `organization_memory`
- Summary: Use organization and coaching context during analysis generation.
- Implementation checklist:
  - retrieve organization priorities
  - retrieve teacher coaching context
  - inject bounded context into analysis pipeline
  - validate against evaluation harness
- Acceptance criteria:
  - analysis quality improves from context
  - outputs remain understandable and bounded

### P2-009

- Title: Recommendation Tuning Pipeline
- Phase: `Phase 2`
- Type: `AI/Platform`
- Priority: `P1`
- Estimate: `L`
- Owners: `ai`, `platform`
- Dependencies: `P1-009`, `P1-011`, `P1-015`
- Target sprint window: `Sprint 11`
- Rollout flag: `recommendation_tuning`
- Summary: Use human signals to improve recommendation ranking and phrasing.
- Implementation checklist:
  - build signal pipeline from ratings and overrides
  - define bounded tuning logic
  - validate using evaluation harness
- Acceptance criteria:
  - recommendation behavior improves from human signals in a reviewable way

### P2-010

- Title: Feedback Digest API
- Phase: `Phase 2`
- Type: `Backend`
- Priority: `P2`
- Estimate: `M`
- Owners: `backend`
- Dependencies: `P2-009`
- Target sprint window: `Sprint 12`
- Rollout flag: `feedback_digest`
- Summary: Expose summarized changes and patterns from human feedback.
- Implementation checklist:
  - define digest data contract
  - create digest endpoint
  - support admin/trainer view needs
- Acceptance criteria:
  - digest data is retrievable in a stable format

### P2-011

- Title: Feedback Digest UI
- Phase: `Phase 2`
- Type: `Feature`
- Priority: `P2`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: `P2-010`
- Target sprint window: `Sprint 12`
- Rollout flag: `feedback_digest`
- Summary: Show users what the system changed or learned from human input.
- Implementation checklist:
  - design digest UI
  - render clear explanations of learned changes
  - support human review or approval cues
- Acceptance criteria:
  - users can see how system behavior is evolving
  - no implication of hidden uncontrolled self-modification

### P2-012

- Title: Action Plan Continuity and Conference Prep
- Phase: `Phase 2`
- Type: `Feature`
- Priority: `P1`
- Estimate: `L`
- Owners: `frontend`, `backend`, `ux`
- Dependencies: `P1-019`
- Target sprint window: `Sprint 11-12`
- Rollout flag: `conference_prep_v2`
- Summary: Improve continuity across observations and make conference prep easier.
- Implementation checklist:
  - create reusable conference prep summary
  - strengthen goal continuity between observations
  - improve follow-up comparison against previous goals
- Acceptance criteria:
  - coach can prepare for follow-up from one coherent workspace

### P2-013

- Title: AI Quality and Override Observability
- Phase: `Phase 2`
- Type: `Platform`
- Priority: `P1`
- Estimate: `M`
- Owners: `platform`, `backend`
- Dependencies: `P1-015`, `P1-021`
- Target sprint window: `Sprint 12`
- Rollout flag: none
- Summary: Make AI quality and human correction visible internally.
- Implementation checklist:
  - define observability metrics for ratings and overrides
  - expose internal review dashboards or endpoints
  - document interpretation guidance
- Acceptance criteria:
  - internal team can inspect where AI is helping or failing

## 6. Phase 3 Tracker Items

Target sprint window: Sprints 13-16+

### P3-001

- Title: Specialist Service Contract Design
- Phase: `Phase 3`
- Type: `Spike`
- Priority: `P1`
- Estimate: `M`
- Owners: `platform`, `ai`
- Dependencies: strong completion of Phase 2
- Target sprint window: `Sprint 13`
- Rollout flag: none
- Summary: Define bounded specialist service contracts before orchestration work begins.
- Implementation checklist:
  - define candidate specialist services
  - define input/output contracts
  - identify concrete product value for each
- Acceptance criteria:
  - specialist services are clearly defined and product-driven

### P3-002

- Title: Specialist Service Orchestrator
- Phase: `Phase 3`
- Type: `Platform/AI`
- Priority: `P1`
- Estimate: `XL`
- Owners: `platform`, `ai`, `backend`
- Dependencies: `P3-001`
- Target sprint window: `Sprint 13-14`
- Rollout flag: `specialist_orchestrator`
- Summary: Introduce bounded coordination across specialist reasoning services.
- Implementation checklist:
  - define orchestrator responsibilities
  - wire specialist contracts into durable flow
  - keep orchestration internal and product-value driven
- Acceptance criteria:
  - orchestrated specialist reasoning adds clear value
  - core workflows do not become unstable or more confusing

### P3-003

- Title: MCP-Compatible Tool Layer Spike
- Phase: `Phase 3`
- Type: `Spike`
- Priority: `P2`
- Estimate: `S`
- Owners: `platform`
- Dependencies: `P3-001`
- Target sprint window: `Sprint 14`
- Rollout flag: none
- Summary: Evaluate whether MCP-compatible interfaces are valuable for Cognivio.
- Implementation checklist:
  - identify possible tool use cases
  - compare value versus complexity
  - write recommendation memo
- Acceptance criteria:
  - decision memo exists with go/no-go recommendation

### P3-004

- Title: Interoperability Adapter Implementation
- Phase: `Phase 3`
- Type: `Platform`
- Priority: `P2`
- Estimate: `L`
- Owners: `platform`
- Dependencies: `P3-003`
- Target sprint window: `Sprint 14-15`
- Rollout flag: `interoperability_adapters`
- Summary: Implement one or more external tool adapters only where justified.
- Implementation checklist:
  - implement selected adapter contracts
  - document adapter boundaries
  - validate maintainability
- Acceptance criteria:
  - at least one meaningful interoperability path exists
  - no broad speculative standard implementation is introduced

### P3-005

- Title: Predictive Planning Experiment Backend
- Phase: `Phase 3`
- Type: `AI`
- Priority: `P2`
- Estimate: `L`
- Owners: `ai`, `backend`
- Dependencies: strong trust and personalization from Phase 2
- Target sprint window: `Sprint 15`
- Rollout flag: `predictive_planning_experiment`
- Summary: Build a bounded backend prototype for predictive planning experiments.
- Implementation checklist:
  - define experiment scope
  - implement bounded simulation logic
  - ensure experimental labeling and safeguards
- Acceptance criteria:
  - feature is clearly experimental
  - simulation remains bounded and optional

### P3-006

- Title: Predictive Planning UI
- Phase: `Phase 3`
- Type: `Feature`
- Priority: `P2`
- Estimate: `M`
- Owners: `frontend`, `ux`
- Dependencies: `P3-005`
- Target sprint window: `Sprint 15`
- Rollout flag: `predictive_planning_experiment`
- Summary: Expose predictive planning safely to a narrow set of power users.
- Implementation checklist:
  - build explicit opt-in UI
  - communicate experimental status
  - show confidence and guardrail language
- Acceptance criteria:
  - feature does not clutter core product
  - experimental state is obvious

### P3-007

- Title: Advanced Personalization Controls
- Phase: `Phase 3`
- Type: `Feature`
- Priority: `P2`
- Estimate: `M`
- Owners: `frontend`, `backend`, `ux`
- Dependencies: advanced Phase 2 context maturity
- Target sprint window: `Sprint 16`
- Rollout flag: `advanced_personalization_controls`
- Summary: Support richer AI behavior controls for power users and advanced organizations.
- Implementation checklist:
  - define advanced control model
  - implement settings UI and persistence
  - document safe usage guidance
- Acceptance criteria:
  - controls remain optional and understandable
  - they do not degrade the default experience

### P3-008

- Title: Upgrade-Safe Model Sandbox
- Phase: `Phase 3`
- Type: `Platform`
- Priority: `P1`
- Estimate: `L`
- Owners: `platform`, `ai`
- Dependencies: `P1-015`, `P2-013`
- Target sprint window: `Sprint 16`
- Rollout flag: none
- Summary: Create a sandbox path for testing new models and prompts safely before rollout.
- Implementation checklist:
  - define sandbox evaluation path
  - compare old and new outputs
  - document release gating rules
- Acceptance criteria:
  - model upgrades can be evaluated safely before broad rollout

## 7. Recommended Milestone Mapping

### Milestone: Phase 1

Include:

- `P1-001` through `P1-022`

### Milestone: Phase 2

Include:

- `P2-001` through `P2-013`

### Milestone: Phase 3

Include:

- `P3-001` through `P3-008`

## 8. Recommended Import Order

If entering these into a tracker manually:

1. create milestones
2. create all Phase 1 tickets and mark `ready` or `next`
3. create all Phase 2 tickets and mark `backlog`
4. create all Phase 3 tickets and mark `backlog`
5. set dependencies
6. assign rollout flags as custom field or label

## 9. Final Guidance

This is now detailed enough that we should not need to "return to ticketing" between phases.

We only need to:

- change statuses,
- refine estimates,
- split any `XL` item before implementation,
- and reprioritize if real user learning forces it.

The roadmap remains executable if we keep the same discipline:

build simplicity first,
then usefulness,
then adaptive intelligence,
then bounded advanced AI.
