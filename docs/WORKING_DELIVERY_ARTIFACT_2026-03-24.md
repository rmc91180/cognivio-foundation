# Cognivio Working Delivery Artifact

Date: 2026-03-24
Companion doc: `docs/EXECUTABLE_DEV_PLAN_2026-03-24.md`
Purpose: Turn the executable plan into a working delivery artifact with epics, sequencing, dependencies, and codebase touchpoints

## 1. How To Use This Document

This is the operating document for product and engineering delivery.

Use it to:

- decide what belongs in the next sprint,
- sequence work across frontend, backend, AI, and platform,
- avoid overbuilding speculative agent features,
- and keep the team aligned around "smart + simple + human-centered."

This document should be updated:

- at the start of each sprint,
- at the end of each sprint,
- and whenever roadmap priorities materially change.

## 2. Delivery Rules

### 2.1 Prioritization rule

If a task makes Cognivio:

- easier to adopt,
- easier to trust,
- easier to act on,
- or more useful in coaching workflows,

it should outrank more speculative AI sophistication.

### 2.2 Architectural rule

We build modular specialist services first.
We do not force a visible multi-agent architecture into the product before the workflows are excellent.

### 2.3 UX rule

If a feature adds configuration burden, explanation burden, or cognitive load for a low-tech user, it must be simplified or deferred.

### 2.4 Trust rule

Every high-impact AI output must be:

- reviewable,
- explainable enough to use,
- and reversible by a human.

## 3. Current Foundation In The Repo

The current codebase already contains several pieces we should build on instead of rebuilding from scratch.

### Frontend surfaces already in place

- dashboard: `frontend/src/pages/DashboardPage.js`
- teachers roster: `frontend/src/pages/TeachersPage.js`
- teacher profile: `frontend/src/pages/TeacherProfilePage.js`
- videos library: `frontend/src/pages/VideosPage.js`
- lesson review/player: `frontend/src/pages/VideoPlayerPage.js`
- frameworks and recording policy: `frontend/src/pages/FrameworksPage.js`
- privacy review: `frontend/src/pages/PrivacyReviewQueuePage.js`
- recognition review: `frontend/src/pages/RecognitionReviewPage.js`
- exemplar library: `frontend/src/pages/ExemplarLibraryPage.js`

### Existing implementation primitives we should leverage

- runtime feature config: `frontend/src/lib/runtimeConfig.js`
- dashboard v2 flag pattern: `docs/DASHBOARD_V2.md`
- focus note and priority elements already flow into analysis
- admin overrides already exist for assessment scoring
- summary reflection already exists on teacher profiles
- privacy and recognition audit events already exist

### Backend modularization already in progress

- orchestration: `backend/app/analysis/analysis_orchestrator.py`
- assessment service: `backend/app/services/assessment_service.py`
- teacher service: `backend/app/services/teacher_service.py`
- privacy service: `backend/app/services/privacy_service.py`
- video service: `backend/app/services/video_service.py`
- recognition service: `backend/app/services/recognition_service.py`

### Important constraint

The app still runs through the bridged legacy backend path in `backend/server.py`, so any medium-sized feature should be designed to avoid deepening legacy coupling unless it is directly needed for delivery.

## 4. Delivery Tracks

Work should be organized into five parallel tracks.

### Track A: UX and Adoption

Primary owner:
Frontend + Product/UX

Focus:

- first-run experience
- dashboard clarity
- low-friction navigation
- empty/loading/error guidance

### Track B: Observation Intelligence

Primary owner:
Backend + AI

Focus:

- evidence ranking
- summary quality
- coaching usefulness
- confidence and relevance

### Track C: Human Personalization

Primary owner:
Frontend + Backend

Focus:

- ratings
- overrides
- focus notes
- organization context
- teacher coaching memory

### Track D: Workflow Integration

Primary owner:
Frontend + Backend

Focus:

- observation-to-action flow
- scheduling and follow-up
- export/share
- training-program cohort views

### Track E: Platform, Evaluation, and Trust

Primary owner:
Backend + Platform/Ops

Focus:

- feature flags
- evaluation harness
- observability
- auditability
- service boundaries

## 5. Phase 1 Working Backlog

Target horizon: next 8-12 weeks
Goal: make the core observation workflow excellent, easy to adopt, and clearly pilot-ready

## P1-UX-01 Role-Aware Dashboard Refresh

Priority: P0
Tracks: A, D

Objective:
Make the dashboard immediately answer: what should I do next?

User outcome:

- principals see observation and coaching priorities
- teacher trainers see cohort and supervisor priorities
- both can act without digging through multiple pages

Implementation scope:

- tighten above-the-fold hierarchy
- add role-aware smart queue
- reduce secondary admin clutter
- improve quick actions

Repo touchpoints:

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/components/dashboard/*`
- `frontend/src/locales/en/common.js`
- `frontend/src/locales/he/common.js`

Dependencies:

- none

Definition of done:

- top of dashboard is role-clear within 5 seconds
- next actions are explicit
- no critical workflow requires more than one extra navigation hop from dashboard

## P1-UX-02 Guided Onboarding and Empty States

Priority: P0
Tracks: A

Objective:
Reduce first-run confusion and setup drop-off.

Implementation scope:

- role-specific onboarding checklist
- empty states for dashboard, teachers, videos, teacher profile
- first-run prompts for seeding demo data, creating teachers, completing privacy profile, and uploading first recording

Repo touchpoints:

- `frontend/src/pages/AuthPage.js`
- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/TeachersPage.js`
- `frontend/src/pages/VideosPage.js`
- shared UI primitives in `frontend/src/components/ui/*`

Dependencies:

- P1-UX-01 preferred but not required

Definition of done:

- first-time user can reach first meaningful action without external explanation

## P1-AI-01 Report Usefulness Ratings and Structured Feedback Capture

Priority: P0
Tracks: B, C, E

Objective:
Turn human feedback into a first-class signal.

Implementation scope:

- thumbs up/down or useful/not useful on summary and recommendations
- optional free-text rationale
- store feedback by report/output block
- expose signals for future learning/evaluation

Repo touchpoints:

- `frontend/src/pages/TeacherProfilePage.js`
- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/features/assessments/api.js`
- `backend/server.py`
- new backend service/repository endpoints under `backend/app/services/assessment_service.py` and repositories

Dependencies:

- P1-PLAT-02 evaluation harness should follow closely

Definition of done:

- users can rate outputs in-product
- feedback is stored and queryable
- product can segment "useful" versus "not useful" output patterns

## P1-AI-02 Override Capture Expansion

Priority: P0
Tracks: B, C, E

Objective:
Expand human override from score-only to broader AI correction capture.

Implementation scope:

- preserve existing score override flow
- add structured override for evidence relevance and recommendation usefulness
- track override reason taxonomy

Repo touchpoints:

- `frontend/src/features/videos/components/VideoRow.js`
- `frontend/src/pages/TeacherProfilePage.js`
- `backend/app/services/assessment_service.py`
- `backend/app/repositories/assessment_repository.py`
- `backend/server.py`

Dependencies:

- P1-AI-01

Definition of done:

- at least score and recommendation override paths are captured
- override history is visible in relevant workflow

## P1-AI-03 Focus-Aware Analysis Hardening

Priority: P0
Tracks: B, C

Objective:
Make focus notes and priority elements materially affect outputs in a visible, trustworthy way.

Current foundation:

- focus note and priority elements already exist in the current pipeline

Implementation scope:

- improve how focus note shapes summaries and recommendations
- surface applied focus context more clearly in UI
- ensure focus settings persist and are visible during review

Repo touchpoints:

- `frontend/src/pages/FrameworksPage.js`
- `frontend/src/pages/DashboardPage.js`
- `backend/app/analysis/analysis_orchestrator.py`
- `backend/app/analysis/model_clients/openai_analysis.py`
- `backend/server.py`

Dependencies:

- none

Definition of done:

- a user can clearly see how selected priorities shaped the resulting analysis

## P1-AI-04 Evidence Ranking and Coaching Packet Improvement

Priority: P0
Tracks: B

Objective:
Improve the usefulness of timestamped observations and coaching actions.

Implementation scope:

- rank video moments by coaching relevance
- improve summary packet consistency
- improve linkage between evidence, rubric element, and action
- reduce low-value or generic recommendations

Repo touchpoints:

- `backend/app/analysis/moment_sampler.py`
- `backend/app/analysis/multimodal_analysis.py`
- `backend/app/analysis/model_clients/openai_analysis.py`
- `backend/server.py`
- `frontend/src/pages/VideoPlayerPage.js`

Dependencies:

- P1-PLAT-02 strongly recommended

Definition of done:

- observation packets are more specific, more coachable, and easier to verify against the video

## P1-WF-01 Teacher Profile As Coaching Workspace

Priority: P0
Tracks: A, C, D

Objective:
Make the teacher profile the center of coaching follow-through.

Implementation scope:

- clarify action plan and next-steps area
- tighten conference scheduling workflow
- improve observation-to-action flow
- strengthen teacher reflection and admin reflection usability

Repo touchpoints:

- `frontend/src/pages/TeacherProfilePage.js`
- `backend/app/services/teacher_service.py`
- `backend/server.py`

Dependencies:

- P1-AI-01 useful but not required

Definition of done:

- after reviewing a lesson, the next coaching action can be recorded in one coherent flow

## P1-WF-02 Video Review Usability Pass

Priority: P0
Tracks: A, B, D

Objective:
Make lesson review easier than competitors for a first-time observer.

Implementation scope:

- improve layout clarity in `VideoPlayerPage`
- better timestamp navigation affordances
- clearer status and review context
- clearer report-generation affordance
- reduced clutter around advanced recognition-related actions in observation-centered flows

Repo touchpoints:

- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/components/VideoTimeline.js`
- `frontend/src/features/videos/components/VideoRow.js`

Dependencies:

- none

Definition of done:

- first-time reviewer can understand the page and navigate between evidence and action without explanation

## P1-WF-03 Lightweight Training Mode Foundation

Priority: P1
Tracks: A, D

Objective:
Begin separating school-admin and teacher-training workflows without splitting the product.

Implementation scope:

- lightweight mode differentiation in dashboard and roster
- terminology and action copy adjustments for cohort/program use
- cohort-oriented filter presets

Repo touchpoints:

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/TeachersPage.js`
- `frontend/src/locales/en/common.js`
- `frontend/src/locales/he/common.js`

Dependencies:

- P1-UX-01

Definition of done:

- trainer workflow feels intentionally supported, even before dedicated cohort analytics ship

## P1-TR-01 Privacy and Audit Clarity Pass

Priority: P0
Tracks: E

Objective:
Make trust controls clearer to users and easier to monitor internally.

Implementation scope:

- improve visibility of privacy states in core pages
- improve audit wording and discoverability
- standardize "review required", "completed", and "manual override" language

Repo touchpoints:

- `frontend/src/pages/VideosPage.js`
- `frontend/src/pages/VideoPlayerPage.js`
- `frontend/src/pages/PrivacyReviewQueuePage.js`
- `backend/app/services/privacy_service.py`
- `backend/server.py`

Dependencies:

- none

Definition of done:

- privacy state is understandable across library, player, and review queue
- audit trail is internally reliable and externally explainable

## P1-PLAT-01 Feature Flag Framework Expansion

Priority: P0
Tracks: E

Objective:
Support safe rollout of new AI and UX behaviors.

Current foundation:

- runtime config exists
- dashboard v2 already uses a feature flag pattern

Implementation scope:

- add structured feature flags beyond dashboard
- document naming and rollout rules
- support safe enable/disable of AI intensity modes, training mode, and feedback capture

Repo touchpoints:

- `frontend/src/lib/runtimeConfig.js`
- `frontend/public/runtime-config.js`
- `backend/app/config.py`
- docs update in `docs/`

Dependencies:

- none

Definition of done:

- new features can be enabled/disabled cleanly without code edits

## P1-PLAT-02 AI Evaluation Harness

Priority: P0
Tracks: B, E

Objective:
Create a practical internal quality loop before launch.

Implementation scope:

- define a small gold-set of recordings and expected output characteristics
- score summary usefulness, evidence relevance, and recommendation quality
- compare model/prompt revisions before rollout

Repo touchpoints:

- `backend/tests/*`
- `backend/app/analysis/*`
- `backend/server.py`
- new evaluation docs/scripts under `docs/` or `scripts/`

Dependencies:

- none

Definition of done:

- analysis changes can be compared against a repeatable baseline before shipping

## P1-PLAT-03 Service Boundary Cleanup For New Work

Priority: P1
Tracks: E

Objective:
Keep new features from further entangling the legacy backend bridge.

Implementation scope:

- route new feedback/override endpoints through extracted services where practical
- keep repositories and services aligned with new feature work
- avoid putting new domain logic directly in page components or only in `server.py`

Repo touchpoints:

- `backend/app/services/*`
- `backend/app/repositories/*`
- `backend/app/routers/*`
- `backend/server.py`

Dependencies:

- ongoing alongside all P1 work

Definition of done:

- major new Phase 1 features land in modular service paths, not only in legacy bridge logic

## 6. Suggested Sprint Sequence For Phase 1

Assumption:
Two-week sprints with parallel frontend/backend work.

## Sprint 1

Primary focus:

- P1-UX-01 Role-Aware Dashboard Refresh
- P1-UX-02 Guided Onboarding and Empty States
- P1-PLAT-01 Feature Flag Framework Expansion

Secondary focus:

- design spike for P1-AI-01 and P1-PLAT-02

## Sprint 2

Primary focus:

- P1-WF-02 Video Review Usability Pass
- P1-AI-01 Report Usefulness Ratings and Structured Feedback Capture
- P1-TR-01 Privacy and Audit Clarity Pass

## Sprint 3

Primary focus:

- P1-AI-02 Override Capture Expansion
- P1-AI-03 Focus-Aware Analysis Hardening
- P1-WF-01 Teacher Profile As Coaching Workspace

## Sprint 4

Primary focus:

- P1-AI-04 Evidence Ranking and Coaching Packet Improvement
- P1-PLAT-02 AI Evaluation Harness
- P1-PLAT-03 Service Boundary Cleanup For New Work

## Sprint 5

Primary focus:

- P1-WF-03 Lightweight Training Mode Foundation
- stabilization and quality pass across P1 epics

## Sprint 6

Primary focus:

- pilot hardening
- bug fixing
- rollout documentation
- backlog shaping for Phase 2

## 7. Phase 2 Delivery Backlog

Target horizon: 2-4 months after Phase 1

These should not enter active development until the Phase 1 workflow is stable.

## P2-PROD-01 School Mode / Training Mode Maturation

Priority: P1

Scope:

- deeper mode-specific dashboard behavior
- mode-specific action language
- improved cohort and program navigation

Repo touchpoints:

- `frontend/src/pages/DashboardPage.js`
- `frontend/src/pages/TeachersPage.js`
- `frontend/src/App.js`

## P2-PROD-02 Cohort Analytics and Supervisor Calibration

Priority: P1

Scope:

- cohort-level progress view
- supervisor comparison/calibration tools
- training-program oriented reporting

Likely touchpoints:

- new training-focused UI surfaces in `frontend/src/pages/`
- analytics endpoints in backend service/router layers

## P2-AI-01 Organization Memory Service

Priority: P1

Scope:

- store organization priorities and coaching context
- retrieve context during analysis and summary generation
- keep memory bounded, scoped, and auditable

Likely touchpoints:

- new service/repository area under `backend/app/services/` and `backend/app/repositories/`
- orchestration updates in `backend/app/analysis/*`

## P2-AI-02 Recommendation Tuning From Human Signals

Priority: P1

Scope:

- use ratings, overrides, and accepted actions to improve ranking and phrasing
- bounded adaptation only

## P2-HUMAN-01 Feedback Digest and Learning Transparency

Priority: P2

Scope:

- "what changed from your feedback" view
- periodic admin/trainer review of learned adjustments
- explicit approval flow for material behavior changes

## P2-WF-01 Stronger Action Planning and Conference Prep

Priority: P1

Scope:

- reusable conference prep summary
- stronger action-plan continuity
- easier follow-up comparison against prior goals

## 8. Phase 3 Delivery Backlog

Target horizon: 4-8 months after Phase 2

These remain conditional and should require an explicit product case before starting.

## P3-ARCH-01 Specialist Service Orchestration

Scope:

- bounded orchestration across specialist reasoning services
- not a user-facing "9 agents" concept

## P3-ARCH-02 Interoperability Hooks

Scope:

- MCP-compatible tool interfaces where useful
- A2A-style patterns only for concrete product value

## P3-AI-01 Predictive Planning Experiments

Scope:

- tightly scoped opt-in simulations
- only after trust and workflow fit are strong

## P3-AI-02 Advanced Personalization Experiments

Scope:

- adaptive coaching experiments
- richer memory-aware assistance
- power-user-only advanced intelligence controls

## 9. Engineering Ticket Template

Every epic should be broken into tickets using this template:

### Ticket

- ID:
- Epic:
- Track:
- User problem:
- Scope:
- Out of scope:
- Frontend touchpoints:
- Backend touchpoints:
- Data/storage changes:
- Feature flag:
- Acceptance criteria:
- QA notes:
- Risks:

## 10. Weekly Review Checklist

At weekly planning or sprint review, ask:

1. Did this sprint reduce workflow friction for a real user?
2. Did this sprint improve trust or controllability?
3. Did this sprint improve coaching usefulness?
4. Did this sprint preserve architectural modularity?
5. Did we accidentally add visible complexity in exchange for hidden technical elegance?

If the answer to question 5 is yes, simplify before continuing.

## 11. Immediate Recommended Build Order

If we want the cleanest path from today to pilot readiness, the best execution order is:

1. dashboard clarity and onboarding
2. video review usability
3. report feedback and override capture
4. focus-aware analysis hardening
5. teacher profile as coaching workspace
6. evaluation harness
7. lightweight training mode
8. bounded organization memory

That order keeps Cognivio moving toward its real advantage:

not maximum AI autonomy,
but the best blend of AI intelligence and human personalization in teacher observation and coaching.
