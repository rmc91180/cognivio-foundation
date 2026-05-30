/**
 * PR C9.4 PART 4 — unit tests for the canonical teacher feedback-view helpers
 * that lesson and dashboard cards consume.
 *
 * The contract the cards depend on:
 *   - `feedbackViewMessage` always returns SPECIFIC `{ status, headline, detail }`
 *     copy for a withheld review (never the generic "no action needed" filler),
 *     preferring the backend `teacher_feedback_view`, then `empty_state`.
 *   - `isFeedbackAvailable` is true ONLY when the backend view marks the
 *     feedback available — a released-but-blocked review stays unavailable.
 */

import {
  feedbackViewMessage,
  isFeedbackAvailable,
  artifactFeedbackView,
} from "@/lib/teacherCoachingArtifact";

describe("feedbackViewMessage", () => {
  it("prefers the backend teacher_feedback_view copy", () => {
    const artifact = {
      teacher_feedback_view: {
        status: "evidence_insufficient",
        headline: "This recording didn't capture enough to coach on.",
        detail: "We couldn't see enough clear classroom activity.",
        feedback_available: false,
      },
      empty_state: { code: "old", title: "old title", message: "old message" },
    };
    const msg = feedbackViewMessage(artifact);
    expect(msg.status).toBe("evidence_insufficient");
    expect(msg.headline).toBe("This recording didn't capture enough to coach on.");
    expect(msg.detail).toBe("We couldn't see enough clear classroom activity.");
  });

  it("surfaces a specific reason for an admin-hidden review (not generic pending copy)", () => {
    const msg = feedbackViewMessage({
      teacher_feedback_view: {
        status: "admin_hidden",
        headline: "An administrator paused this lesson's feedback.",
        detail: "Your reviewer chose to hold this lesson's coaching for now.",
        feedback_available: false,
      },
    });
    expect(msg.status).toBe("admin_hidden");
    expect(msg.headline).toMatch(/administrator/i);
    expect(msg.detail).toBeTruthy();
  });

  it("falls back to empty_state copy when no backend view is present", () => {
    const msg = feedbackViewMessage({
      empty_state: { code: "not_yet_reviewed", title: "Not reviewed yet", message: "Hang tight." },
    });
    expect(msg.status).toBe("not_yet_reviewed");
    expect(msg.headline).toBe("Not reviewed yet");
    expect(msg.detail).toBe("Hang tight.");
  });

  it("returns the awaiting-release copy for a released-but-not-yet-shared review", () => {
    const msg = feedbackViewMessage({
      teacher_feedback_view: {
        status: "awaiting_admin_release",
        headline: "Your feedback is ready and awaiting release.",
        detail: "An administrator is doing a final check before sharing.",
        feedback_available: false,
      },
    });
    expect(msg.status).toBe("awaiting_admin_release");
    expect(msg.headline).toMatch(/awaiting release/i);
  });

  it("returns null when there is nothing to show", () => {
    expect(feedbackViewMessage(null)).toBeNull();
    expect(feedbackViewMessage({})).toBeNull();
    expect(feedbackViewMessage(undefined)).toBeNull();
  });

  it("accepts a bare view object as well as a full artifact", () => {
    const view = { status: "ready", headline: "Ready", detail: "Open your lesson." };
    expect(feedbackViewMessage(view).status).toBe("ready");
  });
});

describe("isFeedbackAvailable", () => {
  it("is true only when the backend view marks feedback available", () => {
    expect(
      isFeedbackAvailable({ teacher_feedback_view: { status: "ready", feedback_available: true } })
    ).toBe(true);
  });

  it("is false for a released-but-blocked (safety-withheld) review", () => {
    expect(
      isFeedbackAvailable({
        teacher_feedback_view: { status: "safety_withheld", feedback_available: false },
      })
    ).toBe(false);
  });

  it("is false when there is no view at all", () => {
    expect(isFeedbackAvailable(null)).toBe(false);
    expect(isFeedbackAvailable({})).toBe(false);
  });

  it("accepts a bare view object", () => {
    expect(isFeedbackAvailable({ feedback_available: true })).toBe(true);
    expect(isFeedbackAvailable({ feedback_available: false })).toBe(false);
  });
});

describe("artifactFeedbackView", () => {
  it("returns the attached view object", () => {
    const view = { status: "ready", feedback_available: true };
    expect(artifactFeedbackView({ teacher_feedback_view: view })).toBe(view);
  });

  it("returns null when absent or malformed", () => {
    expect(artifactFeedbackView(null)).toBeNull();
    expect(artifactFeedbackView({})).toBeNull();
    expect(artifactFeedbackView({ teacher_feedback_view: "nope" })).toBeNull();
  });
});
