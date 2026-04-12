Date: 2026-04-12

## Objective

Design a true Master Admin backend dashboard for Cognivio that is:

- global rather than scoped to one admin's workspace
- simple to operate under pressure
- strong enough for audit, troubleshooting, and user lifecycle control
- safe for destructive actions
- production-oriented for pilot and post-pilot scale

This dashboard is not a teacher-facing or normal admin-facing product surface. It is the internal operating console for the Master Admin and any future platform operators with explicit elevated permission.

## Design Principles

1. One source of truth for platform operations.
2. Global visibility across all users, all uploads, all jobs, and all system dependencies.
3. Safe controls only, with audit trails for every sensitive action.
4. Clear separation between:
   - platform operations
   - pilot user management
   - school/admin workspace management
   - troubleshooting and recovery
5. No storage, queue, or infrastructure internals exposed to normal teachers or school admins.
6. Fast first read: the dashboard should answer "is Cognivio healthy?" within seconds.
7. Drill-down depth for incidents without making the top level busy.

## Current State

Cognivio already has usable pieces:

- [OpsMetricsPage.js](C:/Projects/Cognivio/frontend/src/pages/OpsMetricsPage.js)
- [AccessManagementPage.js](C:/Projects/Cognivio/frontend/src/pages/AccessManagementPage.js)
- `/api/admin/ops/readiness`
- `/api/admin/ops/launch-health`
- `/api/admin/ops/observability`
- `/api/admin/ops/ai-quality`
- `/api/admin/ops/privacy-runtime`
- `/api/admin/ops/backlog-priorities`
- `/api/admin/access-users`
- `/api/admin/access-users/{user_id}/approve`
- `/api/admin/access-users/{user_id}/revoke`

These are good foundations, but they are still oriented around a normal admin/operator model and do not yet form a full Master Admin backend.

## Main Gaps

### 1. Scope gap

Current ops endpoints are still largely scoped to the current admin's workspace or owned records. A true Master Admin view must be able to see:

- all users
- all admins
- all teachers
- all videos
- all jobs
- all organizations/workspaces
- all system-wide failures

### 2. Audit gap

There are audit trails for privacy and recognition, but not yet a unified platform audit model for:

- login attempts
- successful logins
- approval decisions
- access removals
- teacher deletions
- video deletion/retry actions
- admin-triggered reprocessing
- critical configuration changes

### 3. Session/auth visibility gap

Today there is no strong Master Admin surface for:

- who logged in
- when they logged in
- failed login attempts
- last seen timestamps
- active sessions or recent tokens
- suspicious auth behavior

### 4. Troubleshooting gap

There is no one place to answer:

- why did a given upload fail
- which teacher is blocked and by what
- which integrations are degraded
- which dependency is failing now
- which videos are stuck in transcode/privacy/analysis
- which users are creating the most load

### 5. Control safety gap

We have approval/remove controls, but the platform still needs safer operational actions with:

- explicit reason capture
- confirmation modals
- optional typed confirmation for destructive actions
- actor logging
- rollback or undo where possible

## Target Information Architecture

The Master Admin backend should be a dedicated internal route and role boundary.

### Route

- `/master-admin`

### Role boundary

- accessible only to:
  - `super_admin`
  - or a hardened `master_admin` capability flag

Do not overload normal `admin` with this access.

### Top-Level Sections

1. Command Center
2. Users and Access
3. Organizations and Workspaces
4. Videos and Processing
5. Storage and Data
6. AI and Analysis Quality
7. Integrations and Dependencies
8. Audit and Security
9. Support and Recovery

## Page-by-Page Design

### 1. Command Center

Purpose:
- immediate platform status
- highest-priority issues
- first place the Master Admin lands

Top cards:
- total active users
- users pending approval
- successful logins today
- failed logins today
- uploads in last 24h
- videos stuck in pipeline
- privacy reviews pending
- analysis failures 24h
- transcode failures 24h
- storage usage
- database health
- outbound email health

Priority queues:
- critical incidents
- degraded dependencies
- stuck jobs
- pending access approvals
- recent user-facing errors

Drill-through links:
- open affected users
- open affected videos
- open dependency health
- open audit logs

### 2. Users and Access

Purpose:
- manage all people using Cognivio
- understand access lifecycle and activity

Subpages:

#### 2a. User Directory

Columns:
- name
- email
- role
- approval status
- active/inactive
- created at
- approved at
- approved by
- last login
- last seen
- linked teacher/admin/workspace
- total uploads
- total assessments

Filters:
- role
- approval state
- active/inactive
- never logged in
- no linked teacher profile
- recently active
- flagged/suspended

Actions:
- approve
- deny
- revoke access
- reactivate
- reset password trigger
- force logout all sessions
- view audit timeline

#### 2b. Access Queue

Focused queue for:
- pending sign-up requests
- stale pending requests
- recently denied requests
- re-requested access

Actions:
- approve
- deny
- message template selection
- bulk approve or bulk deny only with typed confirmation and only for low-risk identical cases

#### 2c. Auth Activity

Metrics:
- successful logins by day
- failed logins by day
- login success rate
- logins by role
- logins by user
- dormant approved users

Table:
- timestamp
- email
- role selected
- result
- failure reason
- ip
- user agent
- session id

### 3. Organizations and Workspaces

Purpose:
- see how each admin workspace or school/pilot cohort is behaving

Cards/table:
- admin owner
- teachers count
- approved teacher users count
- uploads count
- assessments count
- last activity
- pipeline failures
- privacy gaps
- missing teacher/profile links

Use cases:
- find underused workspaces
- find blocked pilot environments
- identify high-touch support accounts

### 4. Videos and Processing

Purpose:
- global operational truth for the upload pipeline

Subpages:

#### 4a. Pipeline Overview

Metrics:
- uploads today
- transcodes queued/processing/failed
- privacy queued/processing/review_required/failed
- analysis queued/processing/failed
- mean processing times per stage

#### 4b. Video Registry

Per video:
- video id
- filename
- teacher
- uploader
- created at
- size
- raw asset status
- processed asset status
- transcode status
- privacy status
- analysis status
- playback availability
- latest error reason

Actions:
- retry transcode
- retry privacy
- retry analysis
- open video detail
- quarantine video
- delete video with typed confirmation

#### 4c. Video Detail Troubleshooting

For one video show:
- full lifecycle timeline
- asset locations
- pipeline job history
- dependency calls
- errors and retries
- audit events
- links to teacher/admin context

### 5. Storage and Data

Purpose:
- monitor data footprint, cost, and storage correctness

Sections:
- R2 bucket usage by class of asset
- raw vs processed video counts
- assets pending retention cleanup
- orphaned assets
- database collection sizes
- database growth trend
- largest users/workspaces by storage

Actions:
- run orphan scan
- queue retention cleanup
- export storage report
- mark a video for preservation

### 6. AI and Analysis Quality

Purpose:
- extend current ops metrics into a real global intelligence control surface

Sections:
- total analyses
- failure rate
- fallback rate
- paid path usage
- per-model usage
- estimated cost
- feedback helpfulness
- override rate
- specialist activity
- recurring failure patterns

Drilldowns:
- by workspace
- by admin
- by teacher
- by language
- by time range

Actions:
- inspect failed analysis runs
- inspect specialist traces
- export AI-quality report

### 7. Integrations and Dependencies

Purpose:
- answer whether external services are healthy

Dependencies to show:
- Atlas
- R2
- Resend
- OpenAI
- Railway runtime

For each dependency:
- current health
- last successful probe
- last failure
- degraded mode active?
- operational notes

Actions:
- run health probe
- open recent failures
- see recommended remediation

### 8. Audit and Security

Purpose:
- establish durable operator accountability

Subpages:

#### 8a. Platform Audit Log

Events:
- access requested
- access approved
- access denied
- access revoked
- master admin action taken
- teacher deleted
- video deleted
- pipeline retried
- configuration changed
- force logout triggered

Each event:
- timestamp
- actor
- actor role
- target type
- target id
- action
- reason
- metadata delta

#### 8b. Security Events

Events:
- repeated failed logins
- access requests from suspicious patterns
- role mismatch login attempts
- disabled user login attempts
- expired approval links used

### 9. Support and Recovery

Purpose:
- convert operator actions into guided playbooks

Support tools:
- find user by email and open full account state
- find video by id
- retry failed processing
- relink teacher and login account
- regenerate notifications
- export diagnostic bundle

Recovery playbooks:
- "user cannot log in"
- "approval email did not arrive"
- "upload completed but analysis never appeared"
- "video playback broken"
- "teacher workspace has no linked teacher record"

## New Data Model Required

To make this backend truly reliable, we should add explicit collections instead of relying only on inferred state.

### 1. `auth_event_log`

Purpose:
- login and access visibility

Fields:
- `id`
- `email`
- `user_id`
- `event_type`
  - `login_success`
  - `login_failed`
  - `request_access`
  - `approval_granted`
  - `approval_denied`
  - `access_revoked`
  - `logout_forced`
- `role_selected`
- `result`
- `reason`
- `ip_address`
- `user_agent`
- `session_id`
- `created_at`

Indexes:
- `created_at`
- `email + created_at`
- `user_id + created_at`
- `event_type + created_at`

### 2. `master_admin_audit_events`

Purpose:
- every sensitive backend action

Fields:
- `id`
- `actor_user_id`
- `actor_email`
- `action`
- `target_type`
- `target_id`
- `reason`
- `payload_before`
- `payload_after`
- `metadata`
- `created_at`

### 3. `processing_incidents`

Purpose:
- normalize operational failures instead of re-deriving them from many tables

Fields:
- `id`
- `incident_type`
- `severity`
- `status`
- `video_id`
- `user_id`
- `teacher_id`
- `source_job_type`
- `error_code`
- `error_message`
- `first_seen_at`
- `last_seen_at`
- `resolved_at`
- `resolution_note`

### 4. `user_sessions`

Purpose:
- current and recent session visibility

Fields:
- `id`
- `user_id`
- `email`
- `issued_at`
- `last_seen_at`
- `ip_address`
- `user_agent`
- `is_active`
- `revoked_at`
- `revoked_by`

## New Backend Capability Surface

Recommended route family:

- `/api/master-admin/overview`
- `/api/master-admin/users`
- `/api/master-admin/users/{user_id}`
- `/api/master-admin/auth-events`
- `/api/master-admin/audit-events`
- `/api/master-admin/workspaces`
- `/api/master-admin/videos`
- `/api/master-admin/videos/{video_id}`
- `/api/master-admin/incidents`
- `/api/master-admin/storage`
- `/api/master-admin/dependencies`
- `/api/master-admin/support/*`

Important:
- do not overload current `/api/admin/*` routes
- keep Master Admin as a separate contract

## Required Authorization Model

Introduce a stronger permission distinction:

- `teacher`
- `admin`
- `super_admin`

Rules:
- `admin` keeps school/workspace scope
- `super_admin` gets platform-global scope
- only `super_admin` can access `/master-admin`

Recommended hardening:
- explicit allowlist env:
  - `SUPER_ADMIN_EMAILS`
- optional capability flag on user record:
  - `capabilities: ["master_admin"]`

## Safe Action Model

All destructive or risky actions must require:

1. visible warning text
2. reason capture
3. typed confirmation for the highest-risk actions
4. audit event creation
5. success/failure feedback

High-risk actions:
- delete user
- delete teacher
- delete video
- revoke admin access
- force logout all sessions
- retry or rerun a pipeline in bulk

## Recommended UX Rules

1. Top-level dashboard should be calm.
2. Use detail pages instead of giant stacked screens.
3. Keep destructive actions visually separate from monitoring.
4. Make every count clickable to filtered underlying records.
5. Every failure list should have:
   - why it failed
   - who it affected
   - what to do next
6. Every user page should show:
   - account state
   - activity
   - linked records
   - audit history
   - support actions

## Implementation Phases

### Phase 1: Foundation

- add `super_admin` route boundary
- add `/master-admin` shell page
- add global overview endpoint
- add global user directory endpoint
- add `auth_event_log`
- start logging:
  - access requests
  - approvals
  - revocations
  - login success/failure

### Phase 2: User Lifecycle and Audit

- build user detail page
- build auth activity page
- build master admin audit log
- add force logout and safer revoke flows

### Phase 3: Global Processing Control

- build global videos registry
- build processing incidents model
- build video detail troubleshooting page
- add retry and recovery actions with audit

### Phase 4: Storage and Dependency Operations

- add storage usage rollups
- add R2 asset health/orphan scans
- add Atlas health and size rollups
- add dependency health panel

### Phase 5: Support Console

- guided troubleshooting actions
- diagnostic bundles
- workspace repair tools
- operator playbooks embedded in UI

## Recommended First Slice

The first slice should be narrow and valuable:

1. `/master-admin`
2. global overview
3. global user directory
4. auth event logging
5. master admin audit log

That gives immediate operational value without taking on the entire troubleshooting surface at once.

## What Should Not Be Built Yet

- broad bulk-delete tooling
- user-visible infrastructure status
- editing low-level environment configuration from the UI
- automatic remediation that changes data without explicit operator action
- normal admin access to Master Admin dashboards

## Final Recommendation

Build this as a dedicated internal product inside Cognivio, not as a stretched version of the existing admin ops page.

The best architecture is:

- one Master Admin route family
- one stronger permission boundary
- one global audit model
- one unified user/auth activity model
- one incident model for pipeline failures
- drill-through pages instead of one overloaded ops screen

This will give Cognivio a backend that is:

- safer
- more scalable
- easier to troubleshoot
- easier to operate during pilot
- strong enough for real platform governance later
