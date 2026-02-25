# Week 0 Baseline (Locked)

Date locked: 2026-02-25

## 1) Canonical Production Stack

Use this stack for all MVP work and deployment:

- Frontend: `frontend/` (React + CRA + CRACO)
- Backend: `backend/` (FastAPI in `backend/server.py`)

Legacy stacks remain in repo for reference only:

- `client/` + `server/`
- `admin-teacher-assessment/`

No new MVP features should be added to legacy stacks.

## 2) Information Architecture Freeze

Primary nav for MVP:

1. `Dashboard`
2. `Teachers`
3. `Videos & Assessments`
4. `School Setup`

Route map (frontend):

- `/dashboard`
- `/teachers`
- `/teachers/:teacherId`
- `/videos`
- `/videos/:videoId`
- `/school-setup`

Compatibility redirect:

- `/frameworks` -> `/school-setup`

## 3) Naming Freeze

- "Frameworks" is renamed to "School Setup" in user-facing navigation.
- "Recording compliance policy" is owned by School Setup (not Dashboard).

## 4) MVP Scope Freeze

In-scope:

1. Authentication and role-based access
2. Teacher roster and profile workflows
3. Video upload, processing status, playback
4. School setup (framework selection + recording policy)
5. Core dashboard and export basics

Out-of-scope until post-MVP:

1. Large redesign experiments outside approved design system rollout
2. Non-essential analytics modules and deep report builders
3. Feature parity for legacy stacks

## 5) Deployment Path

- Frontend deploy target: built from `frontend/`
- Backend deploy target: built from `backend/`
- Branch for release: `main`

## 6) Week 0 Exit Criteria

1. Canonical stack documented and committed
2. IA and route names frozen in code and docs
3. Scope boundaries documented and shared
4. Build verification completed for frontend
