# Profile deletion API contract

This API contract implements the lifecycle described in `docs/profile-deletion-lifecycle-plan.md`.

## Teacher profile endpoints

### Archive teacher profile

`POST /api/teachers/{teacher_id}/archive`

Allowed roles:
- `school_admin` within own organization/school scope
- `training_admin` within own program scope
- `super_admin`

Request:

```json
{
  "reason": "No longer active at the school"
}
```

Behavior:
- Set `status=archived` on the teacher document.
- Set `archived_at`, `archived_by`, and `archive_reason`.
- Hide the profile from default teacher lists.
- Preserve linked users, videos, assessments, observations, action plans, privacy profiles, audit records, and storage assets.

Response:

```json
{
  "status": "archived",
  "teacher_id": "..."
}
```

### Restore teacher profile

`POST /api/teachers/{teacher_id}/restore`

Allowed roles:
- same as archive.

Request:

```json
{
  "reason": "Teacher returned to active roster"
}
```

Behavior:
- Set `status=active`.
- Set `restored_at`, `restored_by`, and `restore_reason`.
- Preserve archive history fields.

### Delete unused teacher profile, admin scope

`DELETE /api/teachers/{teacher_id}`

Allowed roles:
- `school_admin` within own organization/school scope
- `training_admin` within own program scope

Request:

```json
{
  "confirmation_text": "teacher@example.com",
  "reason": "Duplicate test profile"
}
```

Behavior:
- Allowed only when the teacher profile has no videos, assessments, observations, action plans, privacy profile, privacy review records, or linked active user.
- If blocked, return `409 Conflict` with dependency counts.

Example conflict response:

```json
{
  "detail": "This profile contains data and can only be archived or deleted by a super admin.",
  "dependency_counts": {
    "videos": 1,
    "assessments": 0,
    "observations": 2,
    "action_plans": 0,
    "privacy_profiles": 1,
    "linked_users": 1
  }
}
```

### Permanently delete teacher profile, super-admin scope

`DELETE /api/master-admin/teachers/{teacher_id}`

Allowed roles:
- `super_admin` only.

Request:

```json
{
  "confirmation_text": "teacher@example.com",
  "reason": "Production cleanup after duplicate upload test",
  "delete_storage_assets": true,
  "delete_linked_user": true
}
```

Behavior:
- The super admin can delete even if the teacher contains data.
- Confirmation text must match one of: teacher email, teacher name, or teacher id.
- Create an audit event before deletion with the dependency snapshot.
- Cascade through known teacher-linked collections.
- Optionally delete linked user if `delete_linked_user=true`.
- Optionally delete storage objects if `delete_storage_assets=true`.
- Return a deletion summary.

Known linked collections to evaluate:

- `teachers`
- `users`
- `videos`
- `assessments`
- `observations`
- `action_plans`
- `teacher_face_profiles`
- `privacy_review_queue` / privacy review records if present
- `schedules`
- `coaching_tasks`
- `recognition` / exemplar records if teacher-linked
- storage assets referenced by videos or privacy profiles

Response:

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
    "schedules": 0,
    "coaching_tasks": 0,
    "storage_assets": 4
  }
}
```

## User lifecycle endpoints

### Revoke access

`POST /api/admin/access-users/{user_id}/revoke`
`POST /api/master-admin/users/{user_id}/revoke`

Use this for reversible deactivation. UI should say `Remove access` or `Revoke access`, not `Delete`.

### Reactivate access

`POST /api/master-admin/users/{user_id}/reactivate`

Use this to restore revoked access.

### Permanently delete user

`DELETE /api/master-admin/users/{user_id}`

Allowed roles:
- `super_admin` only.

Request:

```json
{
  "confirmation_text": "user@example.com",
  "reason": "Duplicate signup cleanup",
  "delete_linked_teacher": false
}
```

Behavior:
- Confirmation text must match user email, name, or id.
- If `delete_linked_teacher=true`, call the super-admin teacher purge path for the linked teacher.
- If `delete_linked_teacher=false`, unlink the teacher profile and delete only the user account.
- Write audit events.

## Cleanup endpoints

### Candidate report

`GET /api/master-admin/cleanup-candidates`

Allowed roles:
- `super_admin` only.

Query params:

- `pending_days`, default `90`
- `revoked_days`, default `180`
- `include_archived`, default `true`

Response groups:

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

### Bulk cleanup action

`POST /api/master-admin/cleanup-candidates/actions`

Allowed roles:
- `super_admin` only.

Request:

```json
{
  "action": "purge_pending_users",
  "candidate_ids": ["..."],
  "reason": "Quarterly cleanup",
  "confirmation_text": "PURGE"
}
```

Initial supported actions:
- `purge_pending_users`
- `purge_revoked_users_without_data`
- `archive_unused_teachers`
- `delete_unused_teachers`

## Frontend requirements

- Rename current master-admin user `Delete` actions that call revoke endpoints to `Revoke access`.
- Add a separate `Permanently delete` danger-zone action for true delete endpoints.
- Add teacher archive/delete actions on teacher profile or teacher operations pages.
- Add a master-admin `Data Cleanup` page.
- Add filters for `active`, `archived`, `revoked`, and `deleted` where relevant.

## Safety requirements

- All destructive actions require confirmation text.
- All destructive actions require reason text.
- All destructive actions write audit events.
- Super-admin hard delete must return deleted counts.
- Cascade deletion should be idempotent enough that retrying after a partial failure does not corrupt state.
