# Cognivio Master Admin Backend Dashboard Tickets

Date: 2026-04-12  
Companion docs:

- `docs/MASTER_ADMIN_BACKEND_DASHBOARD_PLAN_2026-04-12.md`

Purpose:  
Convert the Master Admin backend dashboard plan into sprint-ready implementation tickets that establish a safe, global, audit-first operating console for Cognivio.

## 1. Ticket Status Model

Use one of these labels:

- `ready`: can enter sprint planning immediately
- `next`: should start after upstream dependencies are complete
- `later`: valid roadmap work, but not yet ready to schedule
- `spike`: discovery or validation required before implementation

## 2. Priority Model

- `P0`: critical to safe pilot operations and platform governance
- `P1`: important improvement that materially strengthens troubleshooting or oversight
- `P2`: optimization or extension work after the Master Admin core is stable

## 3. Ownership Model

Use these shorthand owners:

- `BE`: backend
- `FE`: frontend
- `PLAT`: platform / auth / observability / infra contract
- `UX`: product / UX

## 4. Sprint Model

Suggested sprint windows for this work:

- `Sprint MA1`: permission boundary and shell foundation
- `Sprint MA2`: global overview and user directory
- `Sprint MA3`: auth activity and audit logging
- `Sprint MA4`: workspace and organization oversight
- `Sprint MA5`: global videos and processing control
- `Sprint MA6`: storage and dependency operations
- `Sprint MA7`: AI quality and incident intelligence
- `Sprint MA8`: support and recovery console

## 5. Phase 1 Tickets: Permission Boundary and Shell Foundation

## MA-001 Super Admin Capability Boundary

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: none
- Target sprint window: `Sprint MA1`
- Rollout flag: `master_admin_backend`
- Goal: create a distinct permission boundary for the Master Admin backend.
- Scope:
  - formalize `super_admin` access handling
  - add `SUPER_ADMIN_EMAILS` or capability-based allowlist support
  - create a dedicated backend authorization helper for Master Admin routes
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/auth_service.py`
  - `backend/.env.example`
- Acceptance criteria:
  - normal `admin` users cannot access Master Admin routes
  - `super_admin` users can access Master Admin routes
  - access rules are explicit and test-covered

## MA-002 Master Admin Route Family Scaffold

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `FE`, `PLAT`
- Depends on: `MA-001`
- Target sprint window: `Sprint MA1`
- Rollout flag: `master_admin_backend`
- Goal: create the dedicated `/master-admin` route family in frontend and backend.
- Scope:
  - add frontend page shell for `/master-admin`
  - add backend route namespace `/api/master-admin/*`
  - keep current `/api/admin/*` routes unchanged
- Repo touchpoints:
  - `frontend/src/App.js`
  - `frontend/src/components/LayoutShell.js`
  - `frontend/src/lib/api.js`
  - `backend/server.py`
- Acceptance criteria:
  - `/master-admin` exists as a separate internal surface
  - route access is protected by the new permission boundary
  - no normal admin workflows regress

## MA-003 Master Admin Navigation Entry

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `MA-001`, `MA-002`
- Target sprint window: `Sprint MA1`
- Rollout flag: `master_admin_backend`
- Goal: add a clear, internal-only navigation entry to the Master Admin backend.
- Scope:
  - show Master Admin navigation only for eligible users
  - keep it visually separate from school-admin navigation
  - add appropriate internal-only labeling
- Repo touchpoints:
  - `frontend/src/components/LayoutShell.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - only super admins see the Master Admin entry
  - the entry is clearly internal/platform-oriented

## MA-004 Master Admin Page Shell and Section IA

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `MA-002`
- Target sprint window: `Sprint MA1`
- Rollout flag: `master_admin_backend`
- Goal: establish the information architecture and shell framing for the Master Admin backend.
- Scope:
  - create section navigation for:
    - command center
    - users and access
    - organizations and workspaces
    - videos and processing
    - storage and data
    - AI quality
    - dependencies
    - audit and security
    - support and recovery
- Repo touchpoints:
  - `frontend/src/pages/*`
  - `frontend/src/components/ui/*`
- Acceptance criteria:
  - the backend has a calm top-level IA
  - sections are clearly separated and extensible

## 6. Phase 2 Tickets: Global Overview and User Directory

## MA-005 Global Master Admin Overview Endpoint

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `MA-001`, `MA-002`
- Target sprint window: `Sprint MA2`
- Rollout flag: `master_admin_backend`
- Goal: build a global overview endpoint that aggregates platform-wide health and usage.
- Scope:
  - return total users by role and approval state
  - return logins today, uploads today, active workspaces, queue issues, and dependency summary
  - return top platform alerts and recommended actions
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/metrics.py`
  - `backend/app/observability.py`
- Acceptance criteria:
  - overview metrics are global, not scoped to one admin
  - payload supports the command-center first read

## MA-006 Master Admin Command Center UI

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `MA-004`, `MA-005`
- Target sprint window: `Sprint MA2`
- Rollout flag: `master_admin_backend`
- Goal: build the first landing page for the Master Admin backend.
- Scope:
  - top KPI cards
  - critical incidents lane
  - pending approvals lane
  - pipeline blockers lane
  - dependency status strip
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminDashboardPage.js`
  - `frontend/src/components/ui/*`
- Acceptance criteria:
  - a Master Admin can answer “is Cognivio healthy?” in one screen
  - all alert counts drill into filtered details

## MA-007 Global User Directory Endpoint

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `MA-001`, `MA-002`
- Target sprint window: `Sprint MA2`
- Rollout flag: `master_admin_users`
- Goal: expose a platform-wide user directory with activity and linkage metadata.
- Scope:
  - return all users with:
    - role
    - approval status
    - is_active
    - created_at
    - approved_at
    - last_login_at
    - last_seen_at
    - linked teacher/admin/workspace
    - total uploads
    - total assessments
  - support filters and pagination
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/*`
- Acceptance criteria:
  - Master Admin can browse all users globally
  - endpoint supports filters without full-table UI hacks

## MA-008 Master Admin User Directory UI

- Status: `ready`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `MA-007`
- Target sprint window: `Sprint MA2`
- Rollout flag: `master_admin_users`
- Goal: create the global user directory page.
- Scope:
  - searchable table
  - filters for role, approval state, activity, linkage, and recent login
  - quick actions for approve, deny, revoke, reactivate, and open detail
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminUsersPage.js`
  - `frontend/src/lib/api.js`
  - `frontend/src/locales/en/common.js`
  - `frontend/src/locales/he/common.js`
- Acceptance criteria:
  - Master Admin can manage all user accounts from one place
  - the page is global and not confused with school-admin access management

## MA-009 User Detail Page

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `BE`, `UX`
- Depends on: `MA-007`, `MA-008`
- Target sprint window: `Sprint MA2`
- Rollout flag: `master_admin_user_detail`
- Goal: provide a full detail page for one user.
- Scope:
  - account profile
  - access history
  - login history
  - linked teacher/admin records
  - uploads/assessments summary
  - safe actions
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminUserDetailPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - Master Admin can troubleshoot one user without leaving the page

## 7. Phase 3 Tickets: Auth Activity and Audit Logging

## MA-010 Auth Event Log Collection

- Status: `ready`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `MA-001`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_auth_audit`
- Goal: create a durable auth event model for platform-wide login and access events.
- Scope:
  - add `auth_event_log`
  - log:
    - request access
    - approval granted
    - approval denied
    - access revoked
    - login success
    - login failed
    - role mismatch login attempt
  - capture ip, user agent, result, and reason where possible
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/auth_service.py`
- Acceptance criteria:
  - auth events are stored durably and queryable by user, email, and type

## MA-011 Login Success and Failure Instrumentation

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `MA-010`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_auth_audit`
- Goal: log successful and failed login attempts consistently.
- Scope:
  - log invalid credentials
  - log pending approval attempts
  - log revoked access attempts
  - log successful token issuance
  - update `last_login_at` and `last_seen_at`
- Repo touchpoints:
  - `backend/server.py`
- Acceptance criteria:
  - every login attempt produces a traceable auth event
  - user records retain latest login/seen timestamps

## MA-012 Master Admin Audit Events Model

- Status: `ready`
- Priority: `P0`
- Owners: `BE`
- Depends on: `MA-001`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_audit_log`
- Goal: create a dedicated audit log for sensitive Master Admin actions.
- Scope:
  - add `master_admin_audit_events`
  - log actor, target, action, reason, and metadata delta
  - include access changes, retries, deletes, and support actions
- Repo touchpoints:
  - `backend/server.py`
- Acceptance criteria:
  - all sensitive Master Admin actions are audit logged
  - audit data is structured and filterable

## MA-013 Auth Activity Page

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `BE`, `UX`
- Depends on: `MA-010`, `MA-011`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_auth_activity`
- Goal: build the Master Admin auth activity page.
- Scope:
  - successful vs failed login metrics
  - login table with filters
  - suspicious behavior highlighting
  - dormant approved users
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminAuthActivityPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - Master Admin can inspect login health and suspicious auth patterns globally

## MA-014 Audit Log Page

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `BE`, `UX`
- Depends on: `MA-012`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_audit_log`
- Goal: surface platform audit events in a searchable UI.
- Scope:
  - filters by actor, target type, action, and date
  - event detail view
  - links back to user/video/workspace detail
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminAuditPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - sensitive platform actions are reviewable without log diving

## 8. Phase 4 Tickets: Workspace and Organization Oversight

## MA-015 Global Workspace Summary Endpoint

- Status: `next`
- Priority: `P1`
- Owners: `BE`
- Depends on: `MA-005`
- Target sprint window: `Sprint MA4`
- Rollout flag: `master_admin_workspaces`
- Goal: expose workspace-level rollups across the platform.
- Scope:
  - aggregate by admin owner or workspace
  - include teacher counts, upload counts, assessment counts, failures, and last activity
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/workspace_service.py`
- Acceptance criteria:
  - Master Admin can identify inactive, blocked, or overloaded workspaces

## MA-016 Workspace Oversight UI

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `MA-015`
- Target sprint window: `Sprint MA4`
- Rollout flag: `master_admin_workspaces`
- Goal: build the organizations/workspaces section.
- Scope:
  - workspace cards or table
  - filters for health, activity, and pilot status
  - click-through to workspace detail
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminWorkspacesPage.js`
- Acceptance criteria:
  - workspace health can be reviewed globally from one surface

## MA-017 Workspace Detail and Linkage Integrity

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`
- Depends on: `MA-015`, `MA-016`
- Target sprint window: `Sprint MA4`
- Rollout flag: `master_admin_workspace_detail`
- Goal: show one workspace’s integrity and support state.
- Scope:
  - admins in workspace
  - approved teachers
  - unlinked logins
  - missing privacy profiles
  - recent processing issues
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminWorkspaceDetailPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - Master Admin can diagnose one workspace without manual DB inspection

## 9. Phase 5 Tickets: Global Videos and Processing Control

## MA-018 Processing Incident Model

- Status: `next`
- Priority: `P0`
- Owners: `BE`, `PLAT`
- Depends on: `MA-005`
- Target sprint window: `Sprint MA5`
- Rollout flag: `master_admin_processing_incidents`
- Goal: normalize pipeline problems into a first-class incident model.
- Scope:
  - add `processing_incidents`
  - create/refresh incidents for transcode, privacy, analysis, and playback failures
  - track resolution state
- Repo touchpoints:
  - `backend/server.py`
  - worker/processing codepaths
- Acceptance criteria:
  - pipeline failures can be reviewed as incidents instead of scattered statuses

## MA-019 Global Videos Registry Endpoint

- Status: `next`
- Priority: `P0`
- Owners: `BE`
- Depends on: `MA-018`
- Target sprint window: `Sprint MA5`
- Rollout flag: `master_admin_videos`
- Goal: expose a global videos and processing registry.
- Scope:
  - include teacher, uploader, statuses, asset state, sizes, timestamps, and latest error
  - support filtering by stage, failure state, and owner
- Repo touchpoints:
  - `backend/server.py`
- Acceptance criteria:
  - Master Admin can find any video and understand its pipeline state

## MA-020 Global Videos Registry UI

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `UX`
- Depends on: `MA-019`
- Target sprint window: `Sprint MA5`
- Rollout flag: `master_admin_videos`
- Goal: build the Master Admin videos and processing page.
- Scope:
  - table of all videos
  - status filters
  - open detail
  - retry controls
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminVideosPage.js`
- Acceptance criteria:
  - video troubleshooting no longer requires jumping between unrelated pages

## MA-021 Video Detail Troubleshooting Page

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`
- Depends on: `MA-019`, `MA-020`
- Target sprint window: `Sprint MA5`
- Rollout flag: `master_admin_video_detail`
- Goal: show the full lifecycle of one video for support and troubleshooting.
- Scope:
  - processing timeline
  - asset locations
  - job history
  - retries
  - related teacher and uploader
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminVideoDetailPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - a single video can be debugged from one page

## 10. Phase 6 Tickets: Storage and Dependency Operations

## MA-022 Storage Summary Endpoint

- Status: `next`
- Priority: `P1`
- Owners: `BE`, `PLAT`
- Depends on: `MA-018`
- Target sprint window: `Sprint MA6`
- Rollout flag: `master_admin_storage`
- Goal: expose storage usage and asset health globally.
- Scope:
  - raw vs processed counts
  - retention backlog
  - orphan candidate counts
  - top storage consumers
- Repo touchpoints:
  - `backend/server.py`
  - storage helpers
- Acceptance criteria:
  - Master Admin can see data footprint and cleanup pressure

## MA-023 Storage Operations UI

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `MA-022`
- Target sprint window: `Sprint MA6`
- Rollout flag: `master_admin_storage`
- Goal: build the storage and data section.
- Scope:
  - storage summary cards
  - orphan/retention report
  - links into affected videos
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminStoragePage.js`
- Acceptance criteria:
  - storage cleanup and footprint are inspectable without shell access

## MA-024 Dependency Health Expansion

- Status: `next`
- Priority: `P1`
- Owners: `BE`, `PLAT`
- Depends on: `MA-005`
- Target sprint window: `Sprint MA6`
- Rollout flag: `master_admin_dependencies`
- Goal: expand dependency health from normal admin ops into a true platform dependency panel.
- Scope:
  - Atlas
  - R2
  - Resend
  - OpenAI
  - Railway runtime
  - latest successful probe and latest failure note
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/metrics.py`
- Acceptance criteria:
  - dependency health is visible globally with useful remediation context

## MA-025 Dependency Health UI

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `MA-024`
- Target sprint window: `Sprint MA6`
- Rollout flag: `master_admin_dependencies`
- Goal: build the integrations and dependencies section.
- Scope:
  - dependency cards
  - health state
  - recent failures
  - remediation guidance
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminDependenciesPage.js`
- Acceptance criteria:
  - Master Admin can see whether platform dependencies are healthy at a glance

## 11. Phase 7 Tickets: AI Quality and Incident Intelligence

## MA-026 Global AI Quality Endpoint

- Status: `next`
- Priority: `P1`
- Owners: `BE`
- Depends on: `MA-005`
- Target sprint window: `Sprint MA7`
- Rollout flag: `master_admin_ai_quality`
- Goal: extend AI quality reporting to the global platform level.
- Scope:
  - global feedback rate
  - override rate
  - specialist usage
  - failure patterns
  - by workspace and by time range
- Repo touchpoints:
  - `backend/server.py`
  - `backend/app/services/workspace_service.py`
- Acceptance criteria:
  - Master Admin can review AI quality globally, not just per admin workspace

## MA-027 AI Quality and Specialist Review UI

- Status: `next`
- Priority: `P1`
- Owners: `FE`, `UX`
- Depends on: `MA-026`
- Target sprint window: `Sprint MA7`
- Rollout flag: `master_admin_ai_quality`
- Goal: build the Master Admin AI quality section.
- Scope:
  - global KPIs
  - specialist activity
  - failure clusters
  - links into problematic records
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminAIQualityPage.js`
- Acceptance criteria:
  - platform AI quality is inspectable without relying on normal admin ops pages

## MA-028 Incident Queue UI

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`, `UX`
- Depends on: `MA-018`
- Target sprint window: `Sprint MA7`
- Rollout flag: `master_admin_incidents`
- Goal: expose a central incident queue for pipeline and operational issues.
- Scope:
  - severity buckets
  - ownership state
  - resolution notes
  - click-through to affected records
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminIncidentsPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - platform failures can be triaged as incidents instead of raw logs

## 12. Phase 8 Tickets: Support and Recovery Console

## MA-029 User Support Console

- Status: `later`
- Priority: `P1`
- Owners: `FE`, `BE`
- Depends on: `MA-009`, `MA-013`, `MA-014`
- Target sprint window: `Sprint MA8`
- Rollout flag: `master_admin_support_console`
- Goal: create a guided support surface for user-level troubleshooting.
- Scope:
  - find user by email
  - inspect login state
  - inspect approval state
  - inspect linked records
  - trigger safe support actions
- Repo touchpoints:
  - `frontend/src/pages/MasterAdminSupportPage.js`
  - `backend/server.py`
- Acceptance criteria:
  - common support questions can be answered from one console

## MA-030 Force Logout and Session Revocation

- Status: `later`
- Priority: `P1`
- Owners: `BE`, `PLAT`, `FE`
- Depends on: `MA-010`, `MA-012`
- Target sprint window: `Sprint MA8`
- Rollout flag: `master_admin_sessions`
- Goal: allow Master Admin to revoke active sessions safely.
- Scope:
  - add `user_sessions` model
  - add force logout action
  - audit all revocations
- Repo touchpoints:
  - `backend/server.py`
  - auth/session helpers
  - `frontend/src/pages/*`
- Acceptance criteria:
  - Master Admin can invalidate active sessions for a user
  - session revocations are audit logged

## MA-031 Diagnostic Bundle Export

- Status: `later`
- Priority: `P2`
- Owners: `BE`, `FE`
- Depends on: `MA-021`, `MA-029`
- Target sprint window: `Sprint MA8`
- Rollout flag: `master_admin_diagnostic_export`
- Goal: export a support-safe diagnostic bundle for a user, workspace, or video.
- Scope:
  - package metadata, statuses, and recent events
  - exclude sensitive secrets and private passwords
- Repo touchpoints:
  - `backend/server.py`
  - `frontend/src/pages/*`
- Acceptance criteria:
  - support bundles can be exported safely for internal review

## 13. Cross-Cutting Safety and Hardening Tickets

## MA-032 Destructive Action Safety Framework

- Status: `next`
- Priority: `P0`
- Owners: `FE`, `BE`, `UX`
- Depends on: `MA-012`
- Target sprint window: `Sprint MA3`
- Rollout flag: `master_admin_safe_actions`
- Goal: standardize safe handling for destructive Master Admin actions.
- Scope:
  - reason capture
  - confirmation modal
  - typed confirmation for highest-risk actions
  - audit write on success/failure
- Repo touchpoints:
  - `frontend/src/components/ui/*`
  - `backend/server.py`
- Acceptance criteria:
  - destructive actions are never one-click silent operations
  - action reasons are retained in the audit log

## MA-033 Master Admin Metrics Contract

- Status: `next`
- Priority: `P1`
- Owners: `PLAT`, `BE`
- Depends on: `MA-005`, `MA-010`, `MA-018`
- Target sprint window: `Sprint MA4`
- Rollout flag: `master_admin_backend`
- Goal: define and document the new global Master Admin metrics and event contract.
- Scope:
  - overview metrics
  - auth metrics
  - incident metrics
  - storage metrics
  - dependency metrics
- Repo touchpoints:
  - `docs/METRICS_CONTRACT.md`
  - `docs/METRICS_RUNBOOK.md`
  - backend metric helpers
- Acceptance criteria:
  - Master Admin telemetry is documented and stable enough to build against

## MA-034 Test Coverage for Master Admin Guardrails

- Status: `next`
- Priority: `P0`
- Owners: `BE`
- Depends on: `MA-001`, `MA-010`, `MA-012`, `MA-018`
- Target sprint window: `Sprint MA4`
- Rollout flag: `master_admin_backend`
- Goal: ensure the Master Admin backend is strongly covered where mistakes would be risky.
- Scope:
  - role-boundary tests
  - auth-event tests
  - audit-event tests
  - destructive-action safety tests
- Repo touchpoints:
  - `backend/tests/*`
- Acceptance criteria:
  - critical Master Admin behavior is regression tested

## 14. Recommended Initial Execution Queue

Start with these tickets first:

1. `MA-001 Super Admin Capability Boundary`
2. `MA-002 Master Admin Route Family Scaffold`
3. `MA-003 Master Admin Navigation Entry`
4. `MA-004 Master Admin Page Shell and Section IA`
5. `MA-005 Global Master Admin Overview Endpoint`
6. `MA-006 Master Admin Command Center UI`
7. `MA-007 Global User Directory Endpoint`
8. `MA-008 Master Admin User Directory UI`
9. `MA-010 Auth Event Log Collection`
10. `MA-011 Login Success and Failure Instrumentation`
11. `MA-012 Master Admin Audit Events Model`
12. `MA-032 Destructive Action Safety Framework`

That first wave creates a real platform console quickly without overreaching into every later support and incident workflow immediately.

## 15. Recommended Sprint Order

- `Sprint MA1`
  - `MA-001`
  - `MA-002`
  - `MA-003`
  - `MA-004`

- `Sprint MA2`
  - `MA-005`
  - `MA-006`
  - `MA-007`
  - `MA-008`
  - `MA-009`

- `Sprint MA3`
  - `MA-010`
  - `MA-011`
  - `MA-012`
  - `MA-013`
  - `MA-014`
  - `MA-032`

- `Sprint MA4`
  - `MA-015`
  - `MA-016`
  - `MA-017`
  - `MA-033`
  - `MA-034`

- `Sprint MA5`
  - `MA-018`
  - `MA-019`
  - `MA-020`
  - `MA-021`

- `Sprint MA6`
  - `MA-022`
  - `MA-023`
  - `MA-024`
  - `MA-025`

- `Sprint MA7`
  - `MA-026`
  - `MA-027`
  - `MA-028`

- `Sprint MA8`
  - `MA-029`
  - `MA-030`
  - `MA-031`
