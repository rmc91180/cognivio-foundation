# Four Dashboard Tenancy And Upload Tickets

## Ticket Model

Each ticket includes:
- `ID`
- `Title`
- `Priority`
- `Owner`
- `Depends on`
- `Scope`
- `Acceptance criteria`

Status defaults:
- `ready`
- `in_progress`
- `blocked`
- `done`

Owners:
- `backend`
- `frontend`
- `fullstack`
- `ops`

---

## Sprint T1: Tenancy Foundation

### TDU-001
**Title**: Add normalized tenant fields to users  
**Priority**: P0  
**Owner**: backend  
**Depends on**: none

**Scope**
- Add normalized tenant fields to user records:
  - `tenant_role`
  - `organization_id`
  - `organization_type`
  - `school_id`
  - `manager_user_id`
  - `tenant_status`
- Preserve compatibility with current `role` and `approval_status` fields.

**Acceptance criteria**
- Existing users still authenticate.
- User serialization includes normalized tenant metadata when present.
- Master admin user remains global and unaffected.

### TDU-002
**Title**: Add organization collection and schemas  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-001

**Scope**
- Add organization-level model/collection.
- Support:
  - `school`
  - `training`
- Add indexes for `organization_type`, `status`, and `name`.

**Acceptance criteria**
- Organizations can be created and listed.
- Queries are indexed for approval and directory use.

### TDU-003
**Title**: Create migration helpers for current users and schools  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-001, TDU-002

**Scope**
- Build migration helpers for:
  - existing school admins
  - existing teachers
  - existing schools
- Generate a safe preview path for ambiguous mappings.

**Acceptance criteria**
- Existing live users can be represented in the new model.
- Ambiguous mappings are surfaced, not silently forced.

### TDU-004
**Title**: Add backend helper layer for tenant resolution  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-001, TDU-002

**Scope**
- Add shared helper functions:
  - resolve current tenant
  - resolve current organization
  - resolve school-admin scope
  - resolve training-admin scope

**Acceptance criteria**
- Helpers can be reused across auth, dashboard, teacher, and video endpoints.

---

## Sprint T2: Signup And Approval Refactor

### TDU-005
**Title**: Extend signup request payload with organization context  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-001, TDU-002

**Scope**
- Extend request-access payload to capture:
  - requested role
  - organization type
  - organization name
  - school name or school id
  - administrator email optional

**Acceptance criteria**
- New access requests persist organization metadata.
- Validation rejects incomplete tenant requests.

### TDU-006
**Title**: Update auth UI for organization-aware signup  
**Priority**: P0  
**Owner**: frontend  
**Depends on**: TDU-005

**Scope**
- Add progressive fields to signup form by requested role.
- Keep the form simple and approval-oriented.

**Acceptance criteria**
- Teacher signup collects school context.
- School-admin signup collects school/org context.
- Training-admin signup collects training-org context.

### TDU-007
**Title**: Extend access-request notification emails with tenant context  
**Priority**: P1  
**Owner**: backend  
**Depends on**: TDU-005

**Scope**
- Show requested tenant information in admin email and user confirmation email.

**Acceptance criteria**
- Approval emails clearly display requested organization and role.

### TDU-008
**Title**: Add organization-aware approval actions in master admin  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-005, TDU-006, TDU-007

**Scope**
- Allow approval into:
  - existing organization
  - new organization
  - new school under existing organization
- Persist tenant assignment on approval.

**Acceptance criteria**
- Approval can assign a user into the correct tenant without shell access.

---

## Sprint T3: Tenant Enforcement

### TDU-009
**Title**: Add shared backend authorization guards for school and training admins  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-004, TDU-008

**Scope**
- Add:
  - `_require_school_admin_user`
  - `_require_training_admin_user`
  - scoped query helpers

**Acceptance criteria**
- New helpers are available for all protected tenant endpoints.

### TDU-010
**Title**: Scope teacher endpoints by tenant  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-009

**Scope**
- Restrict teacher list/detail endpoints by tenant.

**Acceptance criteria**
- School admin cannot retrieve another school’s teachers.
- Training admin cannot retrieve school-admin teacher scope outside tenant.

### TDU-011
**Title**: Scope video and assessment endpoints by tenant  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-009

**Scope**
- Restrict video, privacy, assessment, and report queries by tenant.

**Acceptance criteria**
- Tenant-scoped users only see videos/assets in scope.

### TDU-012
**Title**: Scope dashboard endpoints by tenant  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-009

**Scope**
- Restrict dashboard overview and queue endpoints to tenant scope.

**Acceptance criteria**
- School admin dashboard reflects only school-bound data.
- Training dashboard reflects only training-bound data.

---

## Sprint T4: Dashboard Routing And Role Experience

### TDU-013
**Title**: Update home-route logic for four dashboard families  
**Priority**: P0  
**Owner**: frontend  
**Depends on**: TDU-008, TDU-009

**Scope**
- Route:
  - `super_admin` → `/master-admin`
  - `school_admin` → school admin dashboard
  - `training_admin` → training admin dashboard
  - `teacher` → `/my-workspace`

**Acceptance criteria**
- Every role lands in the correct dashboard after login.

### TDU-014
**Title**: Tighten route guards for all four dashboard families  
**Priority**: P0  
**Owner**: frontend  
**Depends on**: TDU-013

**Scope**
- Prevent route leakage between dashboard families.

**Acceptance criteria**
- Users cannot browse into the wrong dashboard family through direct URL entry.

### TDU-015
**Title**: Add teacher-facing linked administrator card  
**Priority**: P1  
**Owner**: frontend  
**Depends on**: TDU-008, TDU-013

**Scope**
- Show teacher who their linked admin is.

**Acceptance criteria**
- Approved teacher sees their school admin or training admin on workspace home.

### TDU-016
**Title**: Add school-admin-facing school scope summary  
**Priority**: P1  
**Owner**: frontend  
**Depends on**: TDU-012, TDU-013

**Scope**
- Show school name, teacher count, and scope summary in school-admin dashboard.

**Acceptance criteria**
- Principal dashboard clearly signals current school scope.

---

## Sprint T5: Master Admin Organization Tools

### TDU-017
**Title**: Add master-admin organization directory  
**Priority**: P1  
**Owner**: fullstack  
**Depends on**: TDU-002, TDU-008

**Scope**
- Add platform-wide organization directory with status and membership counts.

**Acceptance criteria**
- Master admin can browse all organizations and types.

### TDU-018
**Title**: Add master-admin school directory  
**Priority**: P1  
**Owner**: fullstack  
**Depends on**: TDU-017

**Scope**
- Add school directory and school detail under organizations.

**Acceptance criteria**
- Master admin can inspect school membership and tenant integrity.

### TDU-019
**Title**: Show tenant membership on master-admin user detail  
**Priority**: P1  
**Owner**: frontend  
**Depends on**: TDU-017, TDU-018

**Scope**
- Add organization, school, manager, and tenant-role details to user detail.

**Acceptance criteria**
- User detail makes tenant placement explicit.

---

## Sprint T6: School Administrator Scope Validation

### TDU-020
**Title**: Validate school-admin roster scoping  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-010, TDU-013

**Scope**
- Test school admin roster against mixed-tenant data.

**Acceptance criteria**
- Only school-owned teachers appear.

### TDU-021
**Title**: Validate school-admin dashboard and deep-dive scoping  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-012, TDU-013

**Scope**
- Test dashboard, teacher deep dive, coaching hub, and videos.

**Acceptance criteria**
- No cross-school records appear anywhere in school-admin UI.

### TDU-022
**Title**: Validate school-admin upload/review visibility  
**Priority**: P1  
**Owner**: fullstack  
**Depends on**: TDU-011

**Scope**
- Ensure principal sees only school-bound uploads and privacy status.

**Acceptance criteria**
- School admin review surfaces are tenant-safe.

---

## Sprint T7: Training Administrator Scope Validation

### TDU-023
**Title**: Normalize training-admin tenant scoping  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-009

**Scope**
- Define training organization scope model and apply to training-admin flows.

**Acceptance criteria**
- Training admins have clean tenant boundaries separate from school admins.

### TDU-024
**Title**: Validate training-admin dashboard and participant scope  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-023, TDU-013

**Scope**
- Test training dashboard, participant list, and coaching views.

**Acceptance criteria**
- Training admin sees only training participants in scope.

### TDU-025
**Title**: Show training-admin linkage to teachers where relevant  
**Priority**: P1  
**Owner**: frontend  
**Depends on**: TDU-023

**Scope**
- Ensure participants can see training-admin linkage when that is their governing role.

**Acceptance criteria**
- Teacher-facing workspace correctly reflects training admin where applicable.

---

## Sprint T8: Upload, Privacy, And Analysis Validation

### TDU-026
**Title**: Verify teacher signup into school tenancy end to end  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-008, TDU-013

**Scope**
- Teacher requests access with school context.
- Master admin approves into tenant.
- Teacher logs in and sees linked admin.

**Acceptance criteria**
- Tenant-aware teacher onboarding works end to end.

### TDU-027
**Title**: Verify privacy profile flow under tenant model  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-026

**Scope**
- Upload privacy assets
- confirm privacy status
- verify scoped visibility

**Acceptance criteria**
- Privacy profile works under approved tenant-scoped teacher account.

### TDU-028
**Title**: Verify video upload → transcode → privacy → analysis under tenant model  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-027

**Scope**
- Full classroom video flow under approved tenant teacher account.

**Acceptance criteria**
- Upload completes
- transcode completes
- privacy completes
- analysis completes
- playback and insights render correctly

### TDU-029
**Title**: Verify principal visibility of school teacher video outputs  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-028

**Scope**
- Confirm school admin can see and review only school teacher outputs.

**Acceptance criteria**
- Principal review path works and stays school-scoped.

---

## Sprint T9: Hardening, Audit, And Smoke Coverage

### TDU-030
**Title**: Add audit logging for tenant assignment changes  
**Priority**: P1  
**Owner**: backend  
**Depends on**: TDU-008

**Scope**
- Audit organization assignment, school assignment, manager changes, and revocation changes.

**Acceptance criteria**
- Tenant assignment changes are preserved in audit history.

### TDU-031
**Title**: Add master-admin filtering by organization and school  
**Priority**: P1  
**Owner**: fullstack  
**Depends on**: TDU-017, TDU-018

**Scope**
- Add tenant-aware filtering to master-admin users, videos, incidents, and support views.

**Acceptance criteria**
- Master admin can troubleshoot by organization without manual searching.

### TDU-032
**Title**: Add Playwright smoke coverage for all four dashboard types  
**Priority**: P1  
**Owner**: fullstack  
**Depends on**: TDU-013 through TDU-029

**Scope**
- Add smoke flows for:
  - master admin
  - school admin
  - training admin
  - teacher

**Acceptance criteria**
- Browser smoke verifies correct role landing and scoped access.

### TDU-033
**Title**: Add negative authorization tests for cross-tenant leakage  
**Priority**: P0  
**Owner**: backend  
**Depends on**: TDU-010, TDU-011, TDU-012, TDU-023

**Scope**
- Add test coverage for wrong-tenant access attempts.

**Acceptance criteria**
- Cross-tenant reads fail consistently.

### TDU-034
**Title**: Final production-readiness validation for four-dashboard model  
**Priority**: P0  
**Owner**: fullstack  
**Depends on**: TDU-030, TDU-031, TDU-032, TDU-033

**Scope**
- Final review and signoff:
  - role landings
  - tenant boundaries
  - upload/privacy/analysis
  - audit visibility

**Acceptance criteria**
- Four-dashboard tenant model is clean, green, and pilot-safe.

---

## Recommended Execution Order

### Immediate ready queue
- TDU-001
- TDU-002
- TDU-003
- TDU-004
- TDU-005
- TDU-006

### After foundation
- TDU-007
- TDU-008
- TDU-009
- TDU-010
- TDU-011
- TDU-012

### Then dashboard scoping
- TDU-013
- TDU-014
- TDU-015
- TDU-016

### Then master-admin tenant tools
- TDU-017
- TDU-018
- TDU-019

### Then scoped validation
- TDU-020
- TDU-021
- TDU-022
- TDU-023
- TDU-024
- TDU-025

### Then upload/privacy verification
- TDU-026
- TDU-027
- TDU-028
- TDU-029

### Finally hardening
- TDU-030
- TDU-031
- TDU-032
- TDU-033
- TDU-034

---

## Definition Of Done

This ticket set is complete only when:

- four dashboard families are role-correct
- signup captures organization context
- approval assigns correct tenant membership
- school admins are school-scoped
- training admins are training-scoped
- teachers are self-scoped and linked to their admin
- master admin remains global
- video upload, privacy, and analysis work under the scoped model
- audit and smoke coverage confirm the final contract
