# Week 5 Backend Video Pipeline Foundation (Completed)

Status date: 2026-02-25

## Scope Delivered

- Hardened upload API contract (`POST /api/videos/upload`):
  - Explicit filename/type/content-type validation.
  - ISO datetime validation for `recorded_at`.
  - Strict byte-limit enforcement for video uploads (`MAX_VIDEO_BYTES`, default 1GB).
  - Captures and returns file metadata (`file_size_bytes`, `content_type`).
- Metadata/state normalization:
  - Introduced canonical processing states:
    - `queued`
    - `processing`
    - `completed`
    - `failed`
  - Upload starts in `queued` and transitions in `analyze_video`.
  - Legacy error values normalize to `failed` on read endpoints.
- Status transition hardening:
  - `analyze_video` now marks `processing` at start, `completed` on success, `failed` on exception.
  - Added timestamp fields for state transitions (`status_updated_at`, processing start/end/fail).
  - WebSocket and status endpoints now emit normalized values.

## Exit Criteria Check

- Reliable upload + status transitions in staging behavior path: met in code contract.
- File/type/size validation and metadata writes hardened: met.
