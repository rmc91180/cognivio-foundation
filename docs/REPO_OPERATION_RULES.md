# Repository Operation Rules

## Branch And Deployment Safety

- `main` is the protected production branch.
- Railway deploys from protected `main`; a branch is not production until it is merged to `main` and Railway confirms that commit.
- Do not push directly to `main`.
- All changes must go through a pull request into `main`.
- Required checks must pass before merge.
- Stale PRs and branches should be closed or rebuilt from current `main` before review.

## Lifecycle Branch Warning

PR #9, "Fix user lifecycle and Resend email synchronization," is the current user lifecycle contract.

Older lifecycle cleanup work, especially PR #3, "Add profile deletion and cleanup lifecycle," is superseded by PR #9 and must not be merged as-is. Any future cleanup/dashboard work should be rebuilt from current `main` and explicitly preserve the PR #9 contract:

- Freeze/revoke preserves account history and blocks login.
- Delete performs true hard-delete/tombstone behavior for active credential and roster records.
- Hard-deleted/tombstoned emails may request access again.
- Audit/auth logs remain preserved and must not block re-registration.
