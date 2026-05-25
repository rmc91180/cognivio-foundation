# Teacher Readiness and Video Upload Flow Audit

## Executive Summary

This repair creates one backend-derived teacher readiness source used by the teacher workspace, teacher profile/reference-image surfaces, consent completion flow, and video upload gate. The previous flow mixed three separate concepts under "privacy profile": legal privacy consent, teacher profile completion, and facial reference images. That caused the teacher dashboard to keep recommending "Review privacy consent" after consent was complete, and the upload endpoint to return the misleading blocker "Teacher privacy profile must be completed before video upload."

The final readiness model separates:

- privacy consent/checklist completion,
- teacher profile completion,
- teacher facial reference photos/images.

Video upload is allowed only when all three are complete and at least 4 active usable teacher reference images exist.

## Audit Findings

### Readiness Sources Found

| Source | Location | Previous behavior | Final behavior |
|---|---|---|---|
| Consent records | `GET/POST /api/consent/*` in `backend/server.py` | Grants wrote `granted: true`, but readiness searched for `status: "accepted"`, so completed consent could be missed. | Readiness now uses latest consent records and requires all configured consent types to be granted and not withdrawn. |
| Teacher profile | `_teacher_profile_complete` in `backend/server.py` | Required `subject` and `grade_level`; mixed into a broader privacy/profile readiness story. | Required fields remain explicitly defined in `TEACHER_PROFILE_REQUIRED_FIELDS`; missing fields are exposed separately. |
| Reference images | `teacher_face_references` via `_list_teacher_reference_images` | One reference image counted as ready. Some expired records could remain countable after legacy profile deletion. | Only active/uploaded/ready/validated usable images count, and upload readiness requires 4. Expired profile references are marked `expired`. |
| Teacher workspace setup | `/api/teachers/me/dashboard` | Used readiness `missing_items`, but backend next-best-action could duplicate setup tasks. | Setup next step comes from `readiness.setup_next_step`; next best action is hidden while setup is incomplete. |
| Teacher coaching next best action | `/api/teachers/me/coaching` | Fell back to setup items when no coaching item existed. | Uses real coaching tasks/shared comments only. |
| Video upload backend | `/api/videos/upload` | Blocked on active privacy profile and returned `PRIVACY_PROFILE_REQUIRED` with vague copy. | Uses authoritative readiness and returns exact blocker codes. |
| Video recorder page | `frontend/src/pages/VideoRecorderPage.js` | Showed reference-image status only and linked generic privacy blockers to `/privacy`. | Shows consent/profile/reference status, preserves recording and existing-file upload paths, and links exact blockers. |

### Conflicting / Stale Sources Found

- The consent checklist persisted grant records with `granted: true`, while readiness looked for a non-existent `status: "accepted"` field.
- Dashboard setup and coaching next-best-action could both point at the same setup item.
- Upload readiness relied on an active privacy profile rather than exact consent/profile/reference-image state.
- The required reference-image threshold was inconsistent with the product requirement; it is now enforced as 4.
- No persisted teacher dashboard task record named "Review privacy consent" was found. The stale loop was caused by dynamic readiness recomputation from the wrong consent contract.

## Final Source of Truth

`backend/server.py::_teacher_readiness(teacher, current_user)` is the authoritative readiness helper. It returns:

- `privacy_consent_complete`
- `privacy_policy_version`
- `teacher_profile_complete`
- `missing_profile_fields`
- `privacy_reference_images_count`
- `privacy_reference_images_ready`
- `privacy_reference_images_required_count`
- `upload_ready`
- `setup_next_step`
- `next_best_action` remains a dashboard/coaching operational field, not setup readiness
- `blockers`
- legacy compatibility aliases such as `consent_complete`, `privacy_reference_image_count`, and `missing_items`

Required blocker codes:

- `PRIVACY_CONSENT_REQUIRED`
- `TEACHER_PROFILE_REQUIRED`
- `REFERENCE_IMAGES_REQUIRED`

## Stale Task Loop Prevention

The dashboard setup card is derived from current persisted consent/profile/reference-image state on each backend load. Completing consent writes durable consent records. Because readiness now reads the same granted records that the consent page writes, completed consent cannot regenerate a privacy setup item unless consent is withdrawn, reset, or the persisted records no longer satisfy all required consent types.

No setup task records are created on dashboard load, and no duplicate setup tasks are inserted into a task/reminder collection. The teacher coaching next-best-action no longer uses setup fallback items, so it cannot duplicate the setup card.

## Upload Gate Behavior

Both browser-recorded videos and selected existing classroom video files submit through the same `videoApi.upload` path. The backend upload endpoint evaluates readiness for:

- the signed-in teacher for self-uploads,
- the selected target teacher for admin uploads.

It never uses another teacher's consent/profile/reference images to satisfy the gate.

Exact upload blockers:

- `PRIVACY_CONSENT_REQUIRED`: "Complete privacy consent before uploading videos."
- `TEACHER_PROFILE_REQUIRED`: "Complete your teacher profile before uploading videos."
- `REFERENCE_IMAGES_REQUIRED`: "Add at least 4 teacher reference photos before uploading videos."

Readiness failures are logged safely with teacher id, workspace id, blocker code, and route context. Video contents, sensitive file data, and raw reference-image data are not logged.

## Files Changed

Backend:

- `backend/server.py`
- `backend/app/config.py`
- `backend/app/services/video_service.py`
- `backend/app/repositories/teacher_repository.py`
- `backend/tests/test_tenant_upload_privacy_flow.py`
- `backend/tests/test_teacher_admin_endpoint_stability.py`

Frontend:

- `frontend/src/pages/ConsentPage.js`
- `frontend/src/pages/TeacherSelfProfilePage.js`
- `frontend/src/pages/TeacherWorkspacePage.js`
- `frontend/src/pages/VideoRecorderPage.js`
- `frontend/src/pages/TeacherWorkspacePage.test.js`
- `frontend/src/pages/VideoRecorderPage.test.js`

Docs:

- `docs/TEACHER_READINESS_UPLOAD_FLOW_AUDIT.md`

## Tests Added / Updated

- Backend readiness progression: no consent -> profile -> references -> ready.
- Backend upload structured blockers for missing consent, profile, and references.
- Backend tenant safety: another teacher's reference images do not satisfy readiness.
- Backend admin upload checks target teacher readiness, not admin readiness.
- Frontend dashboard setup next step does not duplicate next-best-action.
- Frontend setup card disappears when setup is complete.
- Frontend selected existing video upload still submits through upload path.
- Frontend browser recording upload still submits through upload path.
- Frontend readiness blocker preserves selected file and prevents upload call.

## Manual QA Checklist

- New/incomplete teacher logs in and sees privacy setup.
- Teacher completes privacy consent at `/consent`.
- Dashboard no longer shows privacy consent.
- Dashboard advances to profile/reference-image setup if needed.
- Teacher completes required profile fields.
- Teacher adds 4 reference images.
- Dashboard setup card disappears.
- Next best action does not duplicate setup.
- Upload page shows ready status.
- Upload selected existing video succeeds.
- Browser recording upload still succeeds.
- Delete one reference image.
- Upload becomes blocked with `REFERENCE_IMAGES_REQUIRED`.
- Reference-image setup task returns.
- Privacy consent task does not return.
- Refresh/logout/login equivalent does not regress completed readiness.
- Admin upload checks target teacher readiness.

Manual browser QA was not run locally in this coding pass; automated backend and frontend coverage exercises the readiness state machine, upload gate, and both upload UI paths.

## Known Limitations

- The current teacher profile required fields remain the existing product-required `subject` and `grade_level`; no extra profile fields were invented.
- Reference image validation remains contract/status based. If asynchronous image validation is added later, it should write `validation_status=ready/validated` only when images are usable.
