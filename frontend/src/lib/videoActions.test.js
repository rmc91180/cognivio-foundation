/**
 * PR C9.5 PART 3–6 (contract D) — unit tests for the corrective-action helpers.
 *
 * Locks the contract that the UI renders exactly what the backend authorized:
 *   1. A control is enabled only when the backend marked the action eligible.
 *   2. A disabled control always resolves to specific, honest reason copy — never
 *      a dead button and never a generic blank.
 *   3. run/retry-mode labels follow the backend ``mode`` so first-run vs retry
 *      copy stays truthful.
 */

import {
  ACTION_RETRY_PRIVACY,
  ACTION_RETRY_ANALYSIS,
  ACTION_RUN_AUDIO_ANALYSIS,
  ACTION_RETRY_FEEDBACK_PROJECTION,
  getVideoActions,
  getVideoAction,
  isActionEligible,
  actionLabel,
  describeActionDisabledReason,
  buildActionControls,
} from "@/lib/videoActions";

const videoWith = (actions) => ({ id: "v1", actions });

describe("getVideoActions / getVideoAction", () => {
  it("returns the backend actions map", () => {
    const actions = { [ACTION_RETRY_PRIVACY]: { action: ACTION_RETRY_PRIVACY, eligible: true } };
    expect(getVideoActions(videoWith(actions))).toBe(actions);
  });

  it("returns an empty object when there is no actions map", () => {
    expect(getVideoActions(null)).toEqual({});
    expect(getVideoActions({})).toEqual({});
    expect(getVideoActions({ actions: "nope" })).toEqual({});
  });

  it("returns a single action descriptor or null", () => {
    const video = videoWith({ [ACTION_RETRY_ANALYSIS]: { eligible: false, disabled_reason: "x" } });
    expect(getVideoAction(video, ACTION_RETRY_ANALYSIS)).toEqual({ eligible: false, disabled_reason: "x" });
    expect(getVideoAction(video, ACTION_RETRY_PRIVACY)).toBeNull();
  });
});

describe("isActionEligible", () => {
  it("is true ONLY when the backend marked the action eligible", () => {
    expect(
      isActionEligible(videoWith({ [ACTION_RETRY_PRIVACY]: { eligible: true } }), ACTION_RETRY_PRIVACY)
    ).toBe(true);
    expect(
      isActionEligible(videoWith({ [ACTION_RETRY_PRIVACY]: { eligible: false } }), ACTION_RETRY_PRIVACY)
    ).toBe(false);
    // Missing action is never eligible (no dead/ghost button).
    expect(isActionEligible(videoWith({}), ACTION_RETRY_PRIVACY)).toBe(false);
  });
});

describe("actionLabel", () => {
  it("returns static labels for retry-privacy / retry-analysis", () => {
    expect(actionLabel(ACTION_RETRY_PRIVACY)).toBe("Retry privacy");
    expect(actionLabel(ACTION_RETRY_ANALYSIS)).toBe("Retry analysis");
  });

  it("switches audio/feedback labels by mode", () => {
    expect(actionLabel(ACTION_RUN_AUDIO_ANALYSIS, "run")).toBe("Run audio analysis");
    expect(actionLabel(ACTION_RUN_AUDIO_ANALYSIS, "retry")).toBe("Retry audio analysis");
    expect(actionLabel(ACTION_RETRY_FEEDBACK_PROJECTION, "run")).toBe("Project feedback");
    expect(actionLabel(ACTION_RETRY_FEEDBACK_PROJECTION, "retry")).toBe("Refresh feedback");
  });

  it("defaults to the run label when mode is missing", () => {
    expect(actionLabel(ACTION_RUN_AUDIO_ANALYSIS)).toBe("Run audio analysis");
  });
});

describe("describeActionDisabledReason", () => {
  it("maps known reason codes to specific copy", () => {
    expect(describeActionDisabledReason("no_local_source")).toMatch(/source recording/i);
    expect(describeActionDisabledReason("privacy_not_complete")).toMatch(/privacy/i);
    expect(describeActionDisabledReason("analysis_not_complete")).toMatch(/analysis/i);
    expect(describeActionDisabledReason("audio_analysis_disabled")).toMatch(/turned off/i);
  });

  it("returns null when there is no reason (eligible control)", () => {
    expect(describeActionDisabledReason(null)).toBeNull();
    expect(describeActionDisabledReason(undefined)).toBeNull();
  });

  it("falls back to a non-empty generic message for an unknown code (never blank)", () => {
    expect(describeActionDisabledReason("brand_new_code")).toBeTruthy();
  });
});

describe("buildActionControls", () => {
  it("projects the backend map into ordered, render-ready descriptors", () => {
    const controls = buildActionControls(
      videoWith({
        [ACTION_RETRY_PRIVACY]: { action: ACTION_RETRY_PRIVACY, eligible: true, disabled_reason: null },
        [ACTION_RETRY_ANALYSIS]: {
          action: ACTION_RETRY_ANALYSIS,
          eligible: false,
          disabled_reason: "analysis_in_progress",
        },
        [ACTION_RUN_AUDIO_ANALYSIS]: {
          action: ACTION_RUN_AUDIO_ANALYSIS,
          eligible: true,
          disabled_reason: null,
          mode: "retry",
        },
        [ACTION_RETRY_FEEDBACK_PROJECTION]: {
          action: ACTION_RETRY_FEEDBACK_PROJECTION,
          eligible: false,
          disabled_reason: "analysis_not_complete",
          mode: "run",
        },
      })
    );

    expect(controls.map((c) => c.key)).toEqual([
      ACTION_RETRY_PRIVACY,
      ACTION_RETRY_ANALYSIS,
      ACTION_RUN_AUDIO_ANALYSIS,
      ACTION_RETRY_FEEDBACK_PROJECTION,
    ]);

    const privacy = controls[0];
    expect(privacy.eligible).toBe(true);
    expect(privacy.disabledReason).toBeNull();

    const analysis = controls[1];
    expect(analysis.eligible).toBe(false);
    expect(analysis.disabledReason).toMatch(/already running/i);
    expect(analysis.disabledReasonCode).toBe("analysis_in_progress");

    const audio = controls[2];
    expect(audio.label).toBe("Retry audio analysis");

    const feedback = controls[3];
    expect(feedback.label).toBe("Project feedback");
    expect(feedback.disabledReason).toMatch(/analysis must finish/i);
  });

  it("omits actions the backend did not include", () => {
    const controls = buildActionControls(
      videoWith({ [ACTION_RETRY_PRIVACY]: { action: ACTION_RETRY_PRIVACY, eligible: true } })
    );
    expect(controls).toHaveLength(1);
    expect(controls[0].key).toBe(ACTION_RETRY_PRIVACY);
  });

  it("returns an empty list when the video has no actions", () => {
    expect(buildActionControls({ id: "v1" })).toEqual([]);
    expect(buildActionControls(null)).toEqual([]);
  });
});
