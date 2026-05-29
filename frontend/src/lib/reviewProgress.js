/**
 * PR C9.3 PART 2 + PART 5 — pure helpers for the teacher-safe review-progress
 * model and validated, privacy-safe playback selection.
 *
 * These functions are intentionally free of React / network / DOM so they can
 * be unit tested in isolation. The backend remains the source of truth for the
 * deterministic ``review_progress`` object and the teacher-safe ``playback``
 * object (see ``backend/app/services/video_review_progress.py`` and
 * ``server._build_teacher_playback_state``); this module only consumes those
 * shapes and never reconstructs privacy decisions on the client.
 */

// Top-level review statuses that mean the review will not advance on its own.
// Polling can stop for these — live updates still arrive over the WebSocket.
export const REVIEW_TERMINAL_STATUSES = Object.freeze([
  "completed",
  "completed_degraded",
  "failed",
  "blocked",
]);

// Audio stage statuses that mean audio analysis was deliberately NOT run, as
// opposed to "pending"/"processing". The UI must phrase these differently —
// never "after audio review is complete".
export const AUDIO_NOT_RUN_STATUSES = Object.freeze(["skipped", "disabled"]);

/**
 * Pull the deterministic ``review_progress`` object off whichever payload has
 * it. The status endpoint and the detail endpoint both embed it; callers may
 * pass either (or both, status first).
 */
export function extractReviewProgress(...sources) {
  for (const source of sources) {
    if (source && typeof source === "object" && source.review_progress) {
      return source.review_progress;
    }
  }
  return null;
}

/**
 * True when the review has reached a state that will not advance without an
 * out-of-band event (admin action, retry, or a WebSocket push). Accepts either
 * a full payload ({review_progress, status}) or a bare review-progress object.
 */
export function isReviewTerminal(data) {
  if (!data || typeof data !== "object") return false;
  const status =
    data.review_progress?.status ||
    data.status ||
    data.review_status ||
    null;
  return REVIEW_TERMINAL_STATUSES.includes(status);
}

/**
 * Compute the react-query ``refetchInterval`` for the status poll. Returns
 * ``false`` (stop polling) once the review is terminal, otherwise the active
 * interval. Keeping this pure makes the polling contract testable.
 */
export function reviewPollingInterval(data, activeMs = 5000) {
  return isReviewTerminal(data) ? false : activeMs;
}

/**
 * Return the audio stage status from a review-progress object, or ``null`` if
 * there is no audio stage. Used to drive audio-specific copy.
 */
export function getAudioStageStatus(progress) {
  const stages = progress?.stages;
  if (!Array.isArray(stages)) return null;
  const audio = stages.find((stage) => stage && stage.key === "audio");
  return audio?.status || null;
}

/**
 * True when audio analysis was deliberately not run for this review (disabled
 * by configuration or skipped), as opposed to still pending/processing. Drives
 * the "Audio analysis was not run for this review." copy.
 */
export function isAudioNotRun(audioStageStatus) {
  return AUDIO_NOT_RUN_STATUSES.includes(audioStageStatus);
}

/** Prefix a relative backend path with the backend origin; pass through absolutes. */
export function absolutizeBackendUrl(url, backendUrl) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${backendUrl || ""}${url}`;
}

/**
 * PART 5 — resolve the URL a TEACHER (or any non-admin) may play. Teachers only
 * ever receive the redacted, validation-passed asset surfaced by the backend
 * ``playback`` object. We never synthesize a URL from raw/processed fields and
 * never fall back to the legacy ``playback_url`` for non-admins.
 */
export function resolveTeacherPlaybackUrl({ playback, backendUrl } = {}) {
  if (!playback || playback.available !== true || !playback.url) return null;
  return absolutizeBackendUrl(playback.url, backendUrl);
}

/**
 * PART 5 — resolve the URL an ADMIN may play. Admins keep the legacy resolver
 * (which can include processed/raw assets per ``select_playback_asset`` with
 * admin privileges) but still only after privacy has completed.
 */
export function resolveAdminPlaybackUrl({ privacyStatus, legacyPlaybackUrl, backendUrl } = {}) {
  if (privacyStatus !== "completed" || !legacyPlaybackUrl) return null;
  return absolutizeBackendUrl(legacyPlaybackUrl, backendUrl);
}

/**
 * Resolve the playable URL for a viewer. Admins use the legacy resolver; all
 * other roles use the strict teacher-safe ``playback`` object. This is the
 * single decision point the page calls so the privacy gate cannot be bypassed.
 */
export function resolvePlaybackUrl({
  isAdmin,
  playback,
  privacyStatus,
  legacyPlaybackUrl,
  backendUrl,
} = {}) {
  if (isAdmin) {
    return resolveAdminPlaybackUrl({ privacyStatus, legacyPlaybackUrl, backendUrl });
  }
  return resolveTeacherPlaybackUrl({ playback, backendUrl });
}
