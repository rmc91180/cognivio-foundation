# PR 26 Pass 3 Privacy, Consent, Blurring, Biometric, and Gold Star Controls

This document records the PR 26 Pass 3 implementation. The pass adds enforceable privacy-policy guardrails without claiming that every future destructive deletion and certification workflow is complete.

## Implementation Summary

Pass 3 adds backend policy contracts for:

- data classification and processing purposes,
- forbidden Student Data purposes,
- upload privacy gate metadata,
- destructive blurring defaults and source-retention status,
- transient biometric purpose limits,
- non-identifiable export validation helpers,
- AI output reflection-only safeguards,
- Gold Star/exemplar teacher and institution authorization controls.

The implementation is intentionally additive. Existing upload, video review, teacher reference image, recognition, and exemplar routes remain in place, with stricter metadata and authorization checks.

## Privacy And Consent Controls

New policy helpers in `backend/server.py` define the allowed processing purposes:

- teacher reflection,
- instructional feedback,
- professional development,
- educator-controlled reporting,
- privacy blurring,
- audio masking,
- deidentification pipeline,
- security audit,
- support troubleshooting.

Forbidden purposes are rejected with controlled `422` JSON, including advertising, marketing, unrelated student profiling, biometric identification/authentication, persistent tracking, individualized student prediction, and employment determination.

Upload metadata now tags classroom recordings as Student Data, classroom video/audio, behavioral/interactional data, and transient biometric processing. If a workspace explicitly requires privacy setup and the required notice/consent fields are missing, upload returns controlled `409` JSON with `reason_code=privacy_setup_required`.

Schools and institutions remain responsible for lawful notices and consents. Cognivio records and enforces product guardrails but does not make legal compliance determinations for the school.

## Destructive Blurring State

New video metadata records:

- `student_face_blur_enabled`,
- `destructive_blurring_enabled`,
- `destructive_blurring_enabled_default`,
- `allow_unblurred_retention`,
- `unblurred_retention_reason`,
- `privacy_pipeline_state`,
- `unblurred_deletion_status`,
- `source_deletion_deferred_reason`.

New uploads default to destructive blurring when student face blur is enabled, unless the institution/workspace explicitly allows unblurred retention. The privacy worker marks redacted output as `blurred_verified` after successful redacted asset generation.

Full physical source deletion is deferred in this pass. The current compensating controls are:

- normal playback prefers redacted assets,
- raw storage fields are removed from normal video API responses,
- raw access is admin-only and audited,
- raw access returns 404 after `unblurred_deleted`,
- source deletion remains visible as `deferred_pending_worker`,
- admin ops privacy runtime reports deferred and failed destructive-blur counts.

## Biometric Guardrails

Biometric processing is limited to privacy blurring, audio masking, and de-identification. The code explicitly rejects biometric purposes such as identifying, authenticating, tracking, recognizing students or teachers, or training recognition systems.

Teacher reference images now carry policy metadata:

- allowed use is `privacy_blur_workflow_only`,
- authentication, surveillance, tracking, and biometric identification are prohibited,
- persistent embeddings are not allowed,
- saved reference image records are validated against persistent biometric identifier fields.

The current implementation stores no persistent face embeddings for teacher references.

## Non-Identifiable Data Controls

Pass 3 adds a non-identifiable export validation helper. It blocks raw media fields, transcript text, segments, names, emails, and student IDs from non-identifiable export payloads and returns metadata requiring no re-identification.

There is no new ML-training export endpoint in this pass. The helper is a contract for existing and future internal analytics/export paths.

## AI Safeguards

Assessment records now include:

- `ai_output_use=informational_reflection_only`,
- an AI reflection-only disclaimer,
- explicit prohibited AI uses.

AI output validation blocks determinative fields and phrases such as employment decision, discipline recommendation, biometric identification, teacher ranking, and student prediction. Existing dashboard/report language remains coaching and reflection oriented.

## Gold Star Authorization Model

Gold Star/exemplar sharing now requires two separate authorizations:

- teacher authorization through the opt-in path,
- institution/admin authorization through exemplar library review.

Admin users can award recognition, but they cannot set teacher exemplar authorization on the teacher's behalf. Exemplar publication requires:

- awarded recognition,
- teacher opt-in and authorization timestamp,
- completed privacy processing,
- redacted playback asset,
- admin/institution approval.

Published exemplar records are blurred by default, prohibit promotional use by default, and block unblurred publication unless a future consent/certification workflow explicitly enables it. Revoke actions mark related exemplar library items as revoked.

## Tests Added

Added `backend/tests/test_pr26_privacy_controls.py` covering:

- forbidden processing purpose rejection,
- destructive blurring upload defaults,
- privacy setup gate blocking,
- forbidden biometric purpose rejection,
- persistent biometric field rejection,
- reference image privacy-blur-only policy,
- non-identifiable export blocking,
- AI output safeguard blocking,
- teacher-only exemplar authorization,
- institution authorization on exemplar publication.

Updated existing recognition and exemplar contract tests for teacher authorization and policy fields.

## Deferred Limitations And Compensating Controls

Deferred in this pass:

- physical deletion worker for unblurred source assets,
- backup/archive erasure guarantees,
- full privacy request workflow,
- policy-version re-consent migration,
- explicit unblurred exemplar consent-document upload UI,
- broad tenant/video/export isolation audit, scheduled for Pass 4.

Compensating controls:

- do not claim physical source deletion is complete,
- use redacted playback in normal video responses,
- keep raw/unblurred access admin-only and audited,
- mark deletion status as deferred,
- block unblurred exemplar publication,
- document manual verification before any pilot data.

## Manual Verification Checklist

1. Upload a classroom recording and confirm the response includes Student Data classifications and `destructive_blurring_enabled=true`.
2. Force a workspace privacy setup requirement and confirm upload returns controlled `privacy_setup_required` JSON.
3. Confirm normal video responses do not expose raw storage fields.
4. Confirm admin raw access is audited and returns 404 after `unblurred_deleted`.
5. Upload a teacher reference image and confirm the profile states privacy-blur-only use.
6. Award recognition as admin.
7. Try to set teacher opt-in as admin and confirm it is blocked.
8. Set teacher opt-in as the teacher.
9. Submit an exemplar and approve as admin.
10. Confirm published exemplar uses redacted playback, has teacher and institution authorization, and has `promotional_use_allowed=false`.
11. Confirm unblurred exemplar publication remains blocked.
12. Confirm admin ops privacy runtime shows destructive blur deferred/failure counts.
