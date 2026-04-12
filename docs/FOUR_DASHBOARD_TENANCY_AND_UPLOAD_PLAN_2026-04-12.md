# Four Dashboard Tenancy And Upload Plan

## Goal

Establish a clean, enforceable four-dashboard product model:

1. `Master Admin backend`
2. `School administrator / principal`
3. `Teacher training administrator`
4. `Teacher`

while ensuring:

- every non-master-admin user belongs to an organization at signup
- approvals are organization-aware
- post-approval access is tenant-scoped
- teachers can see their owning school administrator
- school administrators only see teachers in their own school
- teacher training administrators only see their own training cohorts / organization scope
- video upload, privacy review, privacy confirmation, transcode, and analysis remain reliable under the scoped model

This plan treats tenancy and upload reliability as one phase, because pilot readiness depends on both.

---

## Target Product Contract

### 1. Master Admin backend

Purpose:
- platform operations
- global troubleshooting
- approval / rejection of users
- monitoring and recovery
- full data visibility

Sees:
- all users
- all organizations
- all schools
- all videos
- all privacy states
- all incidents
- all analytics

Can:
- approve / reject / revoke users
- impersonation-safe troubleshooting actions
- retry processing jobs
- inspect audit and auth logs
- upload / test video flows when needed for operations

### 2. School administrator / principal

Purpose:
- supervise one school
- manage and coach teachers inside that school

Sees:
- only teachers assigned to that school
- only videos, records, and reports for that school
- only school-scoped trends and queues

Can:
- review and coach teachers in that school
- manage school-level setup and school-linked teacher records
- optionally upload or review operational artifacts only if product policy allows it

### 3. Teacher training administrator

Purpose:
- supervise training cohorts / training program participants

Sees:
- only the teachers and workspaces inside the training organization or cohort they own
- training-mode dashboards, not school principal dashboards

Can:
- review participant progress
- manage training workflows
- operate inside training tenancy only

### 4. Teacher

Purpose:
- use the product personally
- upload classroom videos
- maintain privacy profile
- review feedback and coaching

Sees:
- only their own workspace
- their own videos
- their own action plans / reflections / coaching hub
- their linked school administrator or training administrator contact

Can:
- upload videos
- manage privacy identity assets
- review and respond to coaching

---

## Required Data Model

The current model already has partial `school_id` support and role support, but it does not yet enforce a full tenancy contract. The next schema layer should introduce clear first-class organization membership.

### New / normalized concepts

#### Organization

Represents the top-level tenant boundary.

Fields:
- `id`
- `name`
- `organization_type`
  - `school`
  - `training`
- `status`
  - `active`
  - `inactive`
- `created_at`
- `created_by`

#### School

For school-mode organizations. Existing school records can remain, but should be normalized under an organization.

Fields:
- `id`
- `organization_id`
- `name`
- `status`

#### User organization membership

Every non-master-admin user should have explicit tenancy fields.

Required user fields:
- `organization_id`
- `organization_type`
- `school_id` for school-bound users where relevant
- `tenant_role`
  - `super_admin`
  - `school_admin`
  - `training_admin`
  - `teacher`
- `tenant_status`
  - `pending`
  - `approved`
  - `revoked`
- `manager_user_id`
  - for teacher visibility of owning admin when appropriate

#### Access request extension

The signup request must capture organization context.

Required request-access fields:
- `organization_type`
- `organization_name`
- `school_name` or `school_id` depending on flow
- `requested_role`
- `manager_email` optional

---

## Approval Model

### New rule

Approval is not only “approve this user.”

Approval becomes:
- approve this user
- approve them into this organization
- approve them into this tenant role
- optionally link them to an owning admin

### Master-admin approval surface must show

- requested email
- requested role
- organization type
- organization name
- school
- requested admin / manager if provided
- whether a matching organization already exists
- whether a matching school already exists
- whether a matching administrator already exists

### Approval actions

1. `Approve and attach to existing organization`
2. `Approve and create new organization`
3. `Approve and create new school under organization`
4. `Reject`
5. `Hold / incomplete request`

### Approval outputs

On approval:
- user becomes `approved`
- organization fields are persisted
- teacher/admin linkage is set
- confirmation email is sent

On rejection:
- user becomes `revoked` or `denied`
- rejection email is sent

---

## Signup Flow Changes

### Current gap

Signup captures role, but not enough tenancy context.

### New signup fields

For all non-master-admin users:
- `I am joining as`
  - Teacher
  - School administrator
  - Teacher training administrator

Then:

#### If teacher
- `School or organization name`
- `School`
- `Your administrator email` optional but recommended

#### If school administrator
- `School name`
- `School or district / organization name`

#### If training administrator
- `Training organization name`
- `Program / cohort name` optional

### UX rules

- keep the form simple
- use progressive disclosure
- do not expose internal tenant jargon
- show a clear approval explanation before submit

---

## Authorization And Routing Rules

### Master Admin

Route family:
- `/master-admin/*`

Guards:
- `super_admin` only

### School administrator

Route families:
- existing admin product routes
- only when `tenant_role === school_admin`

Data filters:
- limit all teacher/video/assessment/schedule/report queries to the user’s `organization_id` and relevant `school_id`

### Teacher training administrator

Route families:
- training-mode routes only

Data filters:
- limit to training organization / cohort scope

### Teacher

Route family:
- `/my-workspace/*`

Data filters:
- only own records

### Required backend enforcement

Do not rely on frontend routing alone.

Every sensitive endpoint must be updated to enforce:
- role
- organization boundary
- school boundary where applicable

---

## Dashboard-Specific Requirements

### A. Master Admin backend

Must keep:
- full platform visibility
- approval / rejection
- troubleshooting
- user lifecycle
- audit / auth / incidents / videos / storage / dependencies

Must also gain:
- organization directory
- school directory
- tenant membership view per user
- organization-aware approvals

### B. School administrator dashboard

Must show:
- only school teachers
- school-scoped uploads
- school-scoped coaching trends
- teacher linkage integrity

Must not show:
- other schools
- training-only admin surfaces

### C. Teacher training administrator dashboard

Must show:
- only training participants in that training tenant
- training-mode analytics and support

Must not show:
- school principal analytics
- unrelated schools or tenants

### D. Teacher dashboard

Must show:
- own uploads
- own privacy profile
- own coaching
- linked administrator

Must not show:
- other teachers
- tenant-wide analytics

---

## Upload And Privacy Reliability Requirements

The scoped model is not complete until upload and privacy behavior are verified inside each relevant role boundary.

### Upload contract

Teacher must be able to:
- log in
- upload video
- upload / maintain privacy profile
- trigger transcode
- complete privacy review / privacy confirmation
- continue into analysis and playback

### Admin contract

School administrator must be able to:
- see only school videos
- review privacy state when product policy allows
- review outputs for their teachers

### Master admin contract

Master admin must be able to:
- inspect every video
- run retries
- troubleshoot privacy / transcode / analysis issues

---

## Implementation Phases

## Phase 1: Tenancy Contract Foundation

### Objectives

- define first-class organization membership
- normalize role model
- avoid breaking current pilot accounts

### Work

1. Add tenancy fields to users:
- `tenant_role`
- `organization_id`
- `organization_type`
- `school_id`
- `manager_user_id`

2. Add organization collection if not already explicit

3. Write migration logic:
- map existing school admins
- map existing teachers
- preserve master admin unchanged

4. Keep backward compatibility:
- existing `role` can remain temporarily
- authorization should begin reading from normalized fields

### Acceptance criteria

- every live user can be represented in the new model
- no existing login breaks
- master admin remains global

## Phase 2: Signup And Approval Refactor

### Objectives

- capture organization at signup
- show organization context in approvals

### Work

1. Extend `/auth/request-access`
2. Extend signup UI
3. Extend approval email content
4. Extend master-admin approvals page:
- show tenant request details
- choose existing vs new organization

### Acceptance criteria

- every new request includes school / organization context
- approval can place user into the correct tenant
- user confirmation email reflects assigned tenant

## Phase 3: Tenant-Aware Authorization

### Objectives

- enforce school/training scoping in backend

### Work

1. Add shared backend helpers:
- require school admin
- require training admin
- scope query to tenant

2. Update teacher endpoints
3. Update video endpoints
4. Update assessment/report endpoints
5. Update dashboard endpoints

### Acceptance criteria

- school admin cannot access another school’s data
- training admin cannot access school-admin data outside their tenant
- teacher sees only self

## Phase 4: Dashboard Routing And UX Scope Pass

### Objectives

- guarantee each dashboard is role-specific

### Work

1. Update default home-route logic
2. Tighten route guards
3. Update nav labels and empty states
4. Add teacher-facing administrator card

### Acceptance criteria

- each role lands in the correct dashboard
- no cross-tenant nav leakage
- teacher always sees linked administrator info when available

## Phase 5: Master Admin Approval And Organization Directory

### Objectives

- make tenant assignment operationally safe

### Work

1. Add organization directory page
2. Add school directory page
3. Add tenant membership on user detail
4. Add approval actions to create/attach tenant records

### Acceptance criteria

- master admin can manage organizations and memberships without shell access

## Phase 6: School Administrator Scope Validation

### Objectives

- ensure school admins only see their school

### Work

1. Test roster scope
2. Test dashboard scope
3. Test teacher deep dive scope
4. Test uploads / video list scope

### Acceptance criteria

- school admin sees only school-bound teachers and assets

## Phase 7: Teacher Training Administrator Scope Validation

### Objectives

- ensure training admins only see training-scoped participants

### Work

1. Validate training-mode dashboard queries
2. Validate roster / participant scope
3. Validate shared coaching objects in training mode

### Acceptance criteria

- training admins operate cleanly inside training tenancy only

## Phase 8: Teacher Upload And Privacy Validation

### Objectives

- verify real teacher flow under tenant model

### Work

1. Teacher signup with school context
2. Approval into school
3. Teacher login
4. Privacy profile upload
5. Video upload
6. Transcode
7. Privacy completion
8. Analysis completion
9. Playback verification

### Acceptance criteria

- one full production-like teacher journey completes successfully

## Phase 9: Hardening And Audit

### Objectives

- make the tenancy model safe and supportable

### Work

1. add audit events for tenant assignment changes
2. add master-admin filters by organization
3. add incident visibility by organization
4. add smoke coverage for all four dashboards

### Acceptance criteria

- tenant changes are auditable
- support can reason about user placement quickly

---

## Recommended Sprint Order

### Sprint T1
- Phase 1 foundation
- Phase 2 signup data capture

### Sprint T2
- approval flow refactor
- organization directory basics

### Sprint T3
- backend authorization enforcement
- route scoping

### Sprint T4
- school admin dashboard scoping
- teacher linkage visibility

### Sprint T5
- training admin dashboard scoping

### Sprint T6
- upload/privacy validation under tenant model
- production smoke coverage

### Sprint T7
- audit, support, and cleanup

---

## Validation Matrix

Must verify all of the following before calling this complete:

### Master Admin
- can approve school admin into school tenant
- can approve teacher into school tenant
- can approve training admin into training tenant
- can view all users and all videos

### School administrator
- sees only teachers in their school
- sees only school videos and coaching data

### Teacher training administrator
- sees only training participants in their tenant

### Teacher
- sees only own workspace
- sees linked administrator
- can upload privacy assets and classroom video
- reaches completed analysis

### Negative tests
- school admin cannot open another school’s teacher
- teacher cannot open another teacher’s records
- training admin cannot access school principal scope outside their tenant

---

## Risks

### 1. Retroactive data mapping risk

Existing users and teachers may not map cleanly into a school/organization structure.

Mitigation:
- add migration preview tooling for master admin
- do not auto-delete ambiguous mappings

### 2. Partial authorization risk

If only some endpoints are tenant-scoped, the model will feel correct in UI but remain insecure.

Mitigation:
- implement shared backend scoping helpers first
- audit every teacher/video/report endpoint before rollout

### 3. Upload regression risk

Tenant refactors can accidentally break teacher upload or privacy flows.

Mitigation:
- keep upload/privacy validation as a required phase, not a later optional QA task

---

## Definition Of Done

This phase is done only when:

- all four dashboards exist and are role-correct
- signup captures organization context
- approval assigns users into the correct tenant
- school admins see only their school
- training admins see only their tenant
- teachers see only themselves and their linked administrator
- master admin still sees everything
- full teacher upload → privacy → analysis flow is green under the tenant model
- smoke and audit coverage exist for the final contract
