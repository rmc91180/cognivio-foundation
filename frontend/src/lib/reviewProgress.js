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

/**
 * PR C9.5 PART 6 (contract C) — machine-readable feedback reason codes mapped to
 * teacher-safe copy. The backend feedback stage now carries a specific
 * ``reason_code`` (and the progress object a ``feedback_reason_code``) for every
 * withheld / awaiting-release state, so the UI can explain *why* feedback is not
 * shown instead of printing a generic "Waiting". The copy is honest and never
 * implies feedback exists when it is withheld.
 */
export const FEEDBACK_REASON_COPY = Object.freeze({
  feedback_awaiting_release:
    "Your feedback is ready and waiting for a final administrator review before it’s shared.",
  admin_hidden: "An administrator has paused sharing this feedback for now.",
  revision_requested: "Your observer is revising this feedback before it’s shared.",
  safety_withheld:
    "We’re holding this feedback for a quality and safety check before it’s shared.",
  evidence_insufficient:
    "This lesson didn’t capture enough clear evidence to generate reliable feedback.",
  source_unavailable:
    "We couldn’t access the lesson recording needed to prepare this feedback.",
  not_yet_reviewed: "This lesson hasn’t been reviewed yet.",
  processing: "We’re preparing your feedback now.",
  feedback_pending_review:
    "Feedback is pending a human quality review before it’s released.",
});

/** Return the feedback stage object from a review-progress object, or null. */
export function getFeedbackStage(progress) {
  const stages = progress?.stages;
  if (!Array.isArray(stages)) return null;
  return stages.find((stage) => stage && stage.key === "feedback") || null;
}

/**
 * Resolve the most specific feedback reason code available: the progress-level
 * ``feedback_reason_code`` first, then the feedback stage's ``reason_code``.
 */
export function getFeedbackReasonCode(progress) {
  if (!progress || typeof progress !== "object") return null;
  return progress.feedback_reason_code || getFeedbackStage(progress)?.reason_code || null;
}

/** Map a feedback reason code to teacher-safe copy (or null when unknown). */
export function describeFeedbackReason(code) {
  if (!code) return null;
  return FEEDBACK_REASON_COPY[code] || null;
}

/** Prefix a relative backend path with the backend origin; pass through absolutes. */
export function absolutizeBackendUrl(url, backendUrl) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${backendUrl || ""}${url}`;
}

/**
 * PR C9.4 PART 5 — build a WebSocket URL from the backend origin and a path,
 * collapsing the seam to exactly one slash. The backend origin frequently ends
 * with a trailing slash (e.g. ``https://app.example.com/``), which naively
 * concatenated with a leading-slash path produced ``wss://app.example.com//ws/...``
 * — a double slash that breaks the live-update socket. This helper strips any
 * trailing slashes from the origin, swaps the scheme to ``ws``/``wss``, and joins
 * a single-slash path so the WebSocket route always resolves.
 */
export function buildBackendWebSocketUrl({ backendUrl, path } = {}) {
  if (!backendUrl || typeof backendUrl !== "string") return null;
  const trimmedOrigin = backendUrl.trim().replace(/\/+$/, "");
  if (!trimmedOrigin) return null;
  const wsOrigin = trimmedOrigin
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  const safePath = path ? `/${String(path).replace(/^\/+/, "")}` : "";
  return `${wsOrigin}${safePath}`;
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
