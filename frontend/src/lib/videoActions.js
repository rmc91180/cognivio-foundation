/**
 * PR C9.5 PART 3–6 (contract D) — pure helpers for the corrective-action
 * controls a video exposes (Retry privacy / Retry analysis / Run-retry audio /
 * Retry feedback projection).
 *
 * The backend computes the authoritative eligibility map on every video payload
 * (``video.actions`` — see ``backend/app/services/video_actions.py``). Each entry
 * is ``{action, eligible, disabled_reason, ...}``. This module never recomputes
 * eligibility on the client; it only reads that map and maps the stable
 * machine-readable codes to button labels and honest disabled-reason copy so the
 * UI never renders a dead button or a generic "unavailable".
 */

export const ACTION_RETRY_PRIVACY = "retry_privacy";
export const ACTION_RETRY_ANALYSIS = "retry_analysis";
export const ACTION_RUN_AUDIO_ANALYSIS = "run_audio_analysis";
export const ACTION_RETRY_FEEDBACK_PROJECTION = "retry_feedback_projection";

// Button label per action. ``run_audio_analysis`` and ``retry_feedback_projection``
// switch label by ``mode`` (first run vs retry).
export const ACTION_LABELS = Object.freeze({
  [ACTION_RETRY_PRIVACY]: "Retry privacy",
  [ACTION_RETRY_ANALYSIS]: "Retry analysis",
  [ACTION_RUN_AUDIO_ANALYSIS]: { run: "Run audio analysis", retry: "Retry audio analysis" },
  [ACTION_RETRY_FEEDBACK_PROJECTION]: { run: "Project feedback", retry: "Refresh feedback" },
});

// Machine-readable disabled reasons → short, honest copy explaining the gate.
export const ACTION_DISABLED_REASON_COPY = Object.freeze({
  no_local_source: "The source recording isn’t available to reprocess.",
  privacy_in_progress: "Privacy processing is already running.",
  privacy_not_complete: "Privacy processing must finish first.",
  analysis_in_progress: "Analysis is already running.",
  analysis_already_complete: "Analysis is already complete.",
  analysis_not_failed: "There’s no failed analysis to retry.",
  analysis_not_complete: "Analysis must finish before feedback can be projected.",
  audio_in_progress: "Audio analysis is already running.",
  audio_analysis_disabled: "Audio analysis is turned off for this workspace.",
  feedback_already_available: "Feedback is already available.",
});

/** Return the backend-computed actions map off a video payload, or ``{}``. */
export function getVideoActions(video) {
  const actions = video && typeof video === "object" ? video.actions : null;
  return actions && typeof actions === "object" ? actions : {};
}

/** Return a single action descriptor by key, or ``null``. */
export function getVideoAction(video, key) {
  const action = getVideoActions(video)[key];
  return action && typeof action === "object" ? action : null;
}

/** True only when the named action exists AND the backend marked it eligible. */
export function isActionEligible(video, key) {
  return getVideoAction(video, key)?.eligible === true;
}

/** Resolve the button label for an action, honoring its ``mode`` when present. */
export function actionLabel(key, mode) {
  const label = ACTION_LABELS[key];
  if (!label) return null;
  if (typeof label === "string") return label;
  return label[mode] || label.run || null;
}

/** Map a disabled-reason code to copy (or ``null`` when there is no reason). */
export function describeActionDisabledReason(code) {
  if (!code) return null;
  return ACTION_DISABLED_REASON_COPY[code] || "This action isn’t available right now.";
}

/**
 * Project the backend actions map into render-ready descriptors. Each item is
 * ``{key, eligible, mode, label, disabledReason}`` where ``disabledReason`` is
 * human copy (null when eligible). Order is stable for deterministic rendering.
 */
export function buildActionControls(video) {
  const actions = getVideoActions(video);
  const order = [
    ACTION_RETRY_PRIVACY,
    ACTION_RETRY_ANALYSIS,
    ACTION_RUN_AUDIO_ANALYSIS,
    ACTION_RETRY_FEEDBACK_PROJECTION,
  ];
  return order
    .filter((key) => actions[key] && typeof actions[key] === "object")
    .map((key) => {
      const action = actions[key];
      const eligible = action.eligible === true;
      return {
        key,
        eligible,
        mode: action.mode || null,
        label: actionLabel(key, action.mode),
        disabledReason: eligible ? null : describeActionDisabledReason(action.disabled_reason),
        disabledReasonCode: eligible ? null : action.disabled_reason || null,
      };
    });
}
