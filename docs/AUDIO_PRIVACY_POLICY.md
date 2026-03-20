# Audio Privacy Policy

## Purpose
Audio analysis is optional and must remain behind explicit feature flags until customer policy, consent, and retention requirements are approved.

## Current Engineering Guardrails
- `AUDIO_ANALYSIS_ENABLED` must be `true` before any audio workflow runs.
- `AUDIO_ALLOW_STUDENT_VOICE_PROCESSING` must be `true` before audio artifacts are generated.
- Audio transcription remains opt-in at the environment level via `AUDIO_TRANSCRIPTION_ENABLED`.
- Transcript artifacts are retention-controlled using `AUDIO_TRANSCRIPT_RETENTION_DAYS`.

## Privacy Expectations
- Audio analysis must never silently expand data collection beyond the agreed customer policy.
- If student voice processing is not approved, the backend must not extract or persist transcript artifacts.
- Transcript and derived features must be treated as sensitive instructional artifacts and must not be exposed through standard user endpoints.

## Operational Rule
- If audio extraction or transcription fails, analysis must fall back to vision-only mode without failing the entire lesson pipeline.
