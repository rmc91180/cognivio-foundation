# Cognivio MVP Delivery Plan (Weeks 0-10)

Status date: 2026-02-25

## Week-by-Week Plan

## Week 0 - Baseline and Scope Lock

- Lock canonical stack (`frontend/` + `backend/`)
- Freeze IA and naming (`School Setup`)
- Freeze MVP in-scope vs out-of-scope
- Verify active frontend build

Exit criteria:

- Baseline document approved and committed
- Route and nav naming aligned in code

## Week 1 - Brand Foundations

- Define logo usage, typography, color tokens, spacing, icon rules
- Produce v1 brand guideline
- Map current components to tokenized styles

Exit criteria:

- Brand guideline approved
- Token spec ready for implementation

## Week 2 - Design System Buildout

- Implement tokenized primitives (button/input/card/table/nav/badge)
- Standardize empty/loading/error/success states
- Add accessibility defaults (focus rings, contrast checks)

Exit criteria:

- Core primitives adopted in top-level pages

## Week 3 - UX Refresh: Dashboard + Teachers

- Redesign task hierarchy for dashboard and teachers flows
- Improve scanability and action clarity
- Mobile/tablet responsive refinements

Exit criteria:

- Dashboard/Teachers parity complete with new system

## Week 4 - UX Refresh: Videos + School Setup

- Refactor video and school setup pages to new UX standards
- Unify forms, validation, and status messaging
- Finish navigation consistency pass

Exit criteria:

- End-to-end UI consistency on all MVP pages

## Week 5 - Backend Video Pipeline Foundation

- Harden upload API contracts and metadata writes
- Enforce file/type/size validation
- Normalize processing states

Exit criteria:

- Reliable upload + status transitions in staging

## Week 6 - Processing + Playback Reliability

- Add/validate worker processing queue flow
- Ensure playable outputs and thumbnails are generated
- Stabilize API for video detail and playback URLs

Exit criteria:

- Video processing success rate meets MVP target

## Week 7 - MVP Integration Pass

- Connect UI states to real backend responses
- Remove or isolate stubs where practical
- Tighten error handling and retry UX

Exit criteria:

- Pilot workflow succeeds without manual backend intervention

## Week 8 - QA, Security, and Performance

- Regression tests for critical paths
- Permission/access audits for admin vs teacher flows
- Performance pass (slow pages, heavy queries, large payloads)

Exit criteria:

- Critical defects closed, release candidate cut

## Week 9 - Pilot Readiness

- UAT with realistic school data
- Fixes from pilot dry-run
- Deployment runbook and rollback validation

Exit criteria:

- Go/no-go signoff checklist complete

## Week 10 - MVP Launch + Stabilization

- Production rollout
- Active monitoring and hotfix window
- Post-launch backlog triage and prioritization

Exit criteria:

- Stable pilot operation and clear post-MVP roadmap

## Dependency Rules

1. No Week N+1 execution before Week N exit criteria are met.
2. Any scope additions require explicit tradeoff approval.
3. Production deploys must come from canonical stack only.
