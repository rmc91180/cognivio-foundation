# Cognivio Phase 1 Execution Plan

Date: 2026-03-24
Purpose: Convert Phase 1 into an execution-ready development plan so implementation can begin immediately
Companion docs:

- `docs/EXECUTABLE_DEV_PLAN_2026-03-24.md`
- `docs/WORKING_DELIVERY_ARTIFACT_2026-03-24.md`
- `docs/IMPLEMENTATION_TICKETS_2026-03-24.md`
- `docs/TRACKER_READY_ROADMAP_2026-03-24.md`

## 1. Phase 1 Goal

Make the core Cognivio observation workflow:

- easier to adopt,
- easier to understand,
- easier to trust,
- and more useful for real coaching work.

Phase 1 is successful when a principal or teacher trainer can:

1. get oriented quickly,
2. review a lesson without confusion,
3. trust and correct AI output,
4. turn that review into a coaching next step,
5. and do all of this without heavy onboarding or technical support.

## 2. Phase 1 Scope Lock

We are building:

- dashboard clarity
- onboarding and empty states
- video review usability
- report feedback capture
- override expansion
- focus-aware analysis refinement
- evaluation harness
- teacher profile as coaching workspace
- lightweight training-mode foundation
- trust and privacy clarity

We are not building in Phase 1:

- multi-agent orchestration
- predictive simulation
- federated learning
- no-code agent builder
- full cohort analytics
- advanced interoperability

## 3. Recommended Team Shape

Assumed working shape for execution:

- `FE/UX`: frontend implementation and UX polish
- `BE`: APIs, data models, service boundary work
- `AI`: prompt, ranking, summary quality, evaluation harness
- `PLAT`: feature flags, observability, architecture hygiene

If one person covers multiple roles, keep the same execution order and do not parallelize too aggressively.

## 4. Critical Path

The critical path for Phase 1 is:

1. dashboard and onboarding clarity
2. video review usability
3. report feedback capture
4. focus-aware analysis refinement
5. evaluation harness
6. coaching workspace improvements
7. stabilization and pilot hardening

If anything on this path slips, lower-priority work should move out before core workflow work does.

## 5. What To Start This Week

These are the first tickets to execute immediately:

### Immediate execution set

- `P1-001 Dashboard Role Shell`
- `P1-003 Guided Onboarding Checklist`
- `P1-004 Empty State Standardization`
- `P1-005 Feature Flag Framework Expansion`

### Immediate parallel discovery

- `P1-009 Report Feedback API`
- `P1-015 Evaluation Harness Foundation`

These should begin now because they unlock later Phase 1 work and reduce future thrash.

## 6. Sprint-by-Sprint Plan

Assumption: 2-week sprints

## Sprint 1

Theme:
Make the product easier to understand on first use.

Tickets:

- `P1-001 Dashboard Role Shell`
- `P1-002 Dashboard Smart Queue Content`
- `P1-003 Guided Onboarding Checklist`
- `P1-004 Empty State Standardization`
- `P1-005 Feature Flag Framework Expansion`

Primary outcomes:

- better first impression
- clearer dashboard purpose
- clear getting-started path
- safe rollout infrastructure

Main repo touchpoints:

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/AuthPage.js`
- `frontend/src/pages/TeachersPage.js`
- `frontend/src/pages/VideosPage.js`
- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/lib/runtimeConfig.js`
- `backend/app/config.py`

Sprint 1 exit criteria:

- first-time user can understand what to do next
- dashboard communicates role and actions clearly
- new UX features can be controlled with flags

## Sprint 2

Theme:
Make lesson review easier and more trustworthy.

Tickets:

- `P1-006 Video Review Layout Pass`
- `P1-007 Video Review Action Focus`
- `P1-008 Privacy Status Language Pass`
- `P1-009 Report Feedback API`
- `P1-010 Report Feedback UI`

Primary outcomes:

- observation-first lesson review
- clearer privacy states
- feedback capture on AI outputs

Main repo touchpoints:

- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/features/videos/components/VideoRow.js`
- `frontend/src/pages/PrivacyReviewQueuePage.js`
- `backend/app/services/assessment_service.py`
- `backend/app/repositories/assessment_repository.py`
- `backend/app/routers/assessments.py`

Sprint 2 exit criteria:

- users can rate output quality in product
- video review is easier to scan and act on
- privacy labels are consistent and understandable

## Sprint 3

Theme:
Make human correction and observation focus materially useful.

Tickets:

- `P1-011 Override Taxonomy and Storage`
- `P1-012 Override UI Expansion`
- `P1-013 Focus Context UI Visibility`
- `P1-014 Focus-Aware Prompt and Synthesis Refinement`
- `P1-018 Teacher Profile Coaching Workspace UX`

Primary outcomes:

- AI outputs become easier to correct
- focus notes visibly shape review
- teacher profile becomes more coaching-centered

Main repo touchpoints:

- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/pages/FrameworksPage.js`
- `backend/app/analysis/analysis_orchestrator.py`
- `backend/app/analysis/model_clients/openai_analysis.py`
- `backend/app/services/assessment_service.py`

Sprint 3 exit criteria:

- users can correct more than just scores
- focus note visibly influences outputs
- teacher profile supports coaching follow-through better

## Sprint 4

Theme:
Improve AI usefulness and backend support for coaching workflows.

Tickets:

- `P1-015 Evaluation Harness Foundation`
- `P1-016 Moment Ranking Refinement`
- `P1-017 Coaching Packet Quality Pass`
- `P1-019 Coaching Workflow Backend Support`
- `P1-021 Service Boundary Cleanup For Feedback Features`

Primary outcomes:

- repeatable AI quality evaluation
- more useful ranked evidence
- better coaching packet quality
- better backend support for follow-through

Main repo touchpoints:

- `backend/tests/*`
- `backend/app/analysis/*`
- `backend/app/services/teacher_service.py`
- `backend/app/services/assessment_service.py`
- `backend/server.py`

Sprint 4 exit criteria:

- analysis changes can be evaluated systematically
- evidence ranking and recommendations materially improve
- coaching workflow data persists reliably

## Sprint 5

Theme:
Expand support for teacher-training workflows and close UX gaps.

Tickets:

- `P1-020 Lightweight Training Mode Foundation`
- bug fixes from Sprints 1-4
- UX polish on dashboard, teacher profile, and lesson review

Primary outcomes:

- training workflows feel intentionally supported
- Phase 1 surfaces are more coherent and consistent

Main repo touchpoints:

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/TeachersPage.js`
- `frontend/src/locales/en/common.js`
- `frontend/src/locales/he/common.js`

Sprint 5 exit criteria:

- trainer workflow is viable without product confusion
- major UX seams from earlier sprints are closed

## Sprint 6

Theme:
Stabilize for pilot readiness.

Tickets:

- `P1-022 Phase 1 Stabilization and Pilot Hardening`
- unresolved P1 bug fixes
- rollout flag review
- known-issues review
- QA and workflow regression pass

Primary outcomes:

- stable Phase 1 release candidate
- controlled rollout path
- clear backlog handoff into Phase 2

Sprint 6 exit criteria:

- no known P0 workflow failures
- key P1 features are stable enough for pilot execution
- Phase 2 can begin without reopening ticket design

## 7. Immediate Execution Checklist

This is the checklist to use right now.

### Product and planning

- create a tracker project using `docs/TRACKER_READY_ROADMAP_2026-03-24.md`
- add milestones for Phase 1, Phase 2, Phase 3
- create all Phase 1 items and mark:
  - `P1-001`, `P1-003`, `P1-004`, `P1-005`, `P1-009`, `P1-015` as `Ready`
  - the rest as `Backlog`

### Engineering kickoff

- create a feature flag inventory
- define Sprint 1 branch strategy
- confirm owners for FE, BE, AI, PLAT
- create a lightweight decision log in `docs/`

### Quality setup

- define the first evaluation gold set for `P1-015`
- identify 3-5 core workflows for regression validation:
  - login to dashboard
  - seed demo data
  - roster to teacher profile
  - videos to lesson review
  - lesson review to coaching follow-up

## 8. Suggested Phase 1 Board Layout

Use these columns:

### Ready Now

- `P1-001`
- `P1-003`
- `P1-004`
- `P1-005`
- `P1-009`
- `P1-015`

### Ready After Sprint 1

- `P1-002`
- `P1-006`
- `P1-008`
- `P1-010`

### Ready After Sprint 2

- `P1-007`
- `P1-011`
- `P1-013`
- `P1-014`
- `P1-018`

### Ready After Sprint 3

- `P1-012`
- `P1-016`
- `P1-017`
- `P1-019`

### Ready After Sprint 4

- `P1-020`
- `P1-021`

### Final Hardening

- `P1-022`

## 9. Definition Of Done For Phase 1

Phase 1 is done when all of the following are true:

- a new user can orient themselves quickly
- lesson review is clearer and more actionable than the current version
- AI outputs can be rated and corrected in product
- focus notes and priorities visibly affect outputs
- coaching follow-through is easier on teacher profile
- evaluation harness exists and is in use
- privacy and trust states are easy to understand
- training workflow support has started without fragmenting the product

## 10. Execution Risks To Watch Weekly

### Risk 1: too much parallel work

Mitigation:
Do not start lower-priority Phase 1 items before core workflow items stabilize.

### Risk 2: overbuilding AI before UX is fixed

Mitigation:
If there is a tradeoff between smarter output and simpler flow, simplify the flow first unless AI quality is actively blocking usage.

### Risk 3: adding more logic into `backend/server.py`

Mitigation:
Route new work through modular services and repositories when possible.

### Risk 4: training mode becomes a second product

Mitigation:
Keep it as a presentation and workflow adaptation layer in Phase 1, not a separate architecture.

## 11. Recommended Weekly Operating Cadence

### Monday

- confirm sprint focus
- confirm blockers
- review feature flag posture

### Mid-week

- quick UX review of active tickets
- quick AI quality review if output-affecting ticket is in flight

### Friday

- demo completed work against Phase 1 goals
- update tracker statuses
- log architecture or product decisions

## 12. Final Execution Guidance

If the goal is to start Phase 1 ASAP, do not start by debating Phase 2 or Phase 3 details.

Start by executing:

1. dashboard clarity
2. onboarding clarity
3. lesson review clarity
4. feedback capture
5. output quality evaluation

That sequence will create the best foundation for everything else.

The right mindset for Phase 1 is:

make Cognivio obviously easier to use,
then obviously more useful,
then progressively smarter.
