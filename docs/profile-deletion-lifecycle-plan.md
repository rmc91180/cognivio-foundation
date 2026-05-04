# Profile deletion and data cleanup lifecycle

This plan defines the product and engineering behavior for profile removal, archiving, deletion, and cleanup.

## Goals

- Prevent unused teacher, user, privacy, video, and assessment records from accumulating indefinitely.
- Preserve normal auditability for routine school-admin actions.
- Give super admins a functional hard-delete option, even when a teacher profile contains data.
- Make destructive actions explicit, confirmed, and auditable.

## Lifecycle concepts

### Remove access

Disables a user login while keeping profile, audit, video, assessment, and teacher-growth records intact.

Use for:
- employees who leave an institution,
- denied access requests,
- suspended or revoked accounts,
- reversible account actions.

### Archive profile

Hides a teacher profile from normal active roster views while preserving data and reporting integrity.

Use for:
- former teachers,
- duplicate or inactive profiles that should not appear in day-to-day workflows,
- profiles with historical videos, assessments, action plans, privacy records, or audit events.

### Permanent delete / purge

Removes a profile and associated data from the database and storage. This must be super-admin only.

The product requirement is that a super admin can permanently delete a teacher profile even when it contains data. The backend must therefore support cascade deletion or anonymized deletion instead of blocking on existing data.

## Permissions

### School admin

School admins can:

- remove access for users they manage,
- archive teacher profiles in their organization,
- restore archived teacher profiles in their organization,
- delete unused teacher profiles only when the profile has no videos, assessments, observations, action plans, or privacy history,
- remove a teacher privacy profile/reference set.

School admins cannot permanently purge profiles with associated instructional data.

### Super admin

Super admins can:

- revoke access,
- archive or restore any teacher profile,
- permanently delete any teacher profile, including profiles with videos, assessments, observations, action plans, and privacy records,
- permanently delete user accounts,
- purge abandoned pending users,
- purge revoked users,
- run cleanup reports and bulk cleanup operations.

## Deletion behavior

### Teacher profile archive

Endpoint proposal:

- `POST /api/teachers/{teacher_id}/archive`
- `POST /api/teachers/{teacher_id}/restore`

Fields:

```json
{
  "status": "archived",
  "archived_at": "ISO timestamp",
  "archived_by": "user id",
  "archive_reason": "optional text"
}
```

Default teacher lists should exclude archived profiles unless `include_archived=true` is supplied.

### School-admin unused-profile delete

Endpoint proposal:

- `DELETE /api/teachers/{teacher_id}`

Rules:

- allowed only within the admin's organization/school/program scope,
- allowed only when the profile has no videos, assessments, observations, action plans, privacy profile, privacy review records, or linked active user,
- returns a blocking message with counts if deletion is unsafe.

### Super-admin permanent delete

Endpoint proposal:

- `DELETE /api/master-admin/teachers/{teacher_id}`

Rules:

- super-admin only,
- requires confirmation text matching the teacher email or name,
- accepts a reason,
- cascades through associated collections and file/storage references,
- writes an audit event before and after deletion,
- returns a summary of deleted counts.

Payload proposal:

```json
{
  "confirmation_text": "teacher@example.com",
  "reason": "Test profile cleanup",
  "delete_storage_assets": true,
  "delete_linked_user": true
}
```

Response proposal:

```json
{
  "status": "deleted",
  "teacher_id": "...",
  "deleted_counts": {
    "teachers": 1,
    "users": 1,
    "videos": 2,
    "assessments": 3,
    "observations": 5,
    "action_plans": 1,
    "privacy_profiles": 1,
    "privacy_reviews": 2,
    "storage_assets": 4
  }
}
```

## User account deletion

Current UI uses delete language while calling revoke endpoints. This should be renamed to `Revoke access` unless a true permanent deletion endpoint is added.

Endpoint proposals:

- `POST /api/master-admin/users/{user_id}/revoke` for reversible account deactivation.
- `POST /api/master-admin/users/{user_id}/reactivate` for reactivation.
- `DELETE /api/master-admin/users/{user_id}` for permanent super-admin deletion.

Permanent user deletion should either remove the linked teacher profile or unlink it, depending on payload:

```json
{
  "confirmation_text": "user@example.com",
  "reason": "Duplicate account cleanup",
  "delete_linked_teacher": false
}
```

## Cleanup dashboard

Add a master-admin Data Cleanup page.

Endpoint proposal:

- `GET /api/master-admin/cleanup-candidates`

Candidate groups:

- unused teacher profiles,
- duplicate teacher profiles,
- abandoned pending users,
- revoked users older than retention threshold,
- orphaned privacy profiles,
- orphaned videos,
- teacher profiles without active users,
- users without linked teacher/profile context.

Example response shape:

```json
{
  "unused_teachers": [],
  "duplicate_teachers": [],
  "abandoned_pending_users": [],
  "revoked_users": [],
  "orphaned_privacy_profiles": [],
  "orphaned_videos": []
}
```

## Scheduled cleanup

Add a retention cleanup job after manual flows are working.

Initial recommended policy:

- purge denied/pending access requests older than 90 days,
- purge revoked accounts older than 180 days only if they have no linked data,
- purge orphaned privacy profile images after 30 days,
- keep audit events unless a super admin explicitly purges a profile and requests associated audit cleanup.

## Audit requirements

Every archive, restore, revoke, delete, and purge action must write an audit event with:

- actor user id and email,
- target type and id,
- target email/name when available,
- action type,
- reason,
- before snapshot where safe,
- deleted counts for destructive actions,
- timestamp.

## Implementation phases

1. Rename misleading UI labels so revoke actions are not called delete.
2. Add archive/restore for teacher profiles.
3. Add super-admin hard delete for teacher profiles and users, including cascade deletion.
4. Add cleanup candidate dashboard and endpoints.
5. Add scheduled cleanup jobs and retention settings.
