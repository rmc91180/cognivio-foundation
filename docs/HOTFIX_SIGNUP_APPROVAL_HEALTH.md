# Hotfix: Signup, Approval, Deleted Links, and Readiness Health

This hotfix restores the signup -> pending approval -> approval/rejection -> login loop and tightens Master Admin visibility for deleted or tombstoned users.

## Signup and Approval Check

1. Open the login page and choose sign up/request access.
2. Submit a fresh tester email with a password, name, organization, and school/program details.
3. Open Master Admin -> Users -> Pending.
4. Confirm the normalized lowercase email appears in the pending queue.
5. Approve the request.
6. Confirm the tester can log in with the same email and password.
7. Submit a second request and reject/delete it from Master Admin.
8. Confirm the rejected request leaves the pending queue.
9. Hard-delete the approved tester.
10. Confirm the tester disappears from active user, admin, roster, and organization counts.
11. Confirm the same email can request access again after hard delete.

Email delivery is non-transactional for access requests and decisions. If Resend fails, the pending/approved/rejected lifecycle state should still persist and the backend should log a sanitized delivery warning.

## Deleted User Link Reconciliation

Run dry-run first:

```powershell
$env:PYTHONPATH="backend"
python backend/scripts/reconcile_deleted_user_links.py
```

Apply only after reviewing the dry-run summary:

```powershell
$env:PYTHONPATH="backend"
python backend/scripts/reconcile_deleted_user_links.py --apply --actor "master-admin@example.com"
```

Demo records are not mutated by default. To include demo records, explicitly add `--include-demo`.

The script reports:
- stale admin links
- stale teacher links
- stale workspace/school owner links
- organizations with zero active users/admins/teachers

It preserves audit logs and writes a reconciliation audit event when `--apply` is used.

## Internal Readiness Interpretation

- `DEMO_MODE=false` means demo reset controls are disabled. This is neutral, not broken.
- Existing seeded demo data can still be visible to Master Admin/internal testing views.
- K-12 and Training seeded states show `Available` when demo records exist and `Not seeded` when absent while demo mode is off.
- If `DEMO_MODE=true` and demo records are missing, that is unhealthy for rehearsal setup.
- Quality gate `Unknown` is neutral when no history file exists.
- Resend `Unhealthy` remains actionable because it affects signup, approval, and rejection emails.

## Resend Diagnosis

Check Railway environment variables:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_API_BASE_URL` if overridden

Then check the Resend dashboard:
- API key is valid and has access.
- Sender address is valid.
- Sender domain exists in Resend.
- Sender domain DNS verification is complete.

Readiness and dependency health responses should show sanitized `reason_code` and `action` fields without exposing API keys or raw provider responses.

## Optional Signup Health Endpoint

Master Admin can call:

```text
GET /api/admin/signup-health
```

It returns counts only:
- pending requests
- approved users
- deleted tombstones
- stale link counts
- stale orphan organizations
- demo organizations
- demo mode enabled

## After Deploy Checklist

1. Submit a new signup/request-access with a fresh tester email.
2. Confirm the email appears in Master Admin pending approval queue.
3. Approve it.
4. Confirm the tester can log in.
5. Reject another test request and confirm it leaves pending queue.
6. Hard-delete the approved tester.
7. Confirm the tester disappears from active users/admins/rosters/org counts.
8. Confirm the same email can request access again after hard delete.
9. Confirm Zack Isakow no longer appears in approved admin lists or active organization lists unless intentionally shown as archived/orphaned.
10. Confirm audit logs remain present but do not count as active visibility.
11. Open Internal Readiness:
    - Demo mode should be Disabled/neutral if `DEMO_MODE=false`.
    - K-12/Training seeded should be Available/Seeded if demo data exists, or Not seeded neutral if absent.
    - Demo reset controls should be Disabled if `DEMO_MODE=false`.
    - Resend should either be Healthy or show a specific sanitized reason/action.
12. Confirm Master Admin can still view seeded demo organizations/data when appropriate.
13. Confirm demo data does not inflate real customer counts.

## Do Not

- Do not run destructive cleanup without dry-run review.
- Do not merge or copy PR #3 cleanup lifecycle logic.
- Do not expose secrets, API keys, or raw provider errors.
- Do not hide demo data simply because `DEMO_MODE=false`.
