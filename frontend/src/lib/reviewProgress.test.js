/**
 * PR C9.3 — unit tests for the pure review-progress / playback helpers.
 *
 * These lock the two safety contracts the helpers exist to enforce:
 *   1. Polling stops once a review is terminal (completed / degraded / failed /
 *      blocked) so a finished review never spins forever.
 *   2. Non-admins only ever receive the redacted, validation-passed playback
 *      URL surfaced by the backend ``playback`` object — never the legacy /
 *      raw URL. Admins keep the legacy resolver (privacy-completed only).
 */

import {
  REVIEW_TERMINAL_STATUSES,
  extractReviewProgress,
  isReviewTerminal,
  reviewPollingInterval,
  getAudioStageStatus,
  isAudioNotRun,
  absolutizeBackendUrl,
  resolveTeacherPlaybackUrl,
  resolveAdminPlaybackUrl,
  resolvePlaybackUrl,
  buildBackendWebSocketUrl,
  getFeedbackStage,
  getFeedbackReasonCode,
  describeFeedbackReason,
} from "@/lib/reviewProgress";

describe("isReviewTerminal / reviewPollingInterval", () => {
  it.each(REVIEW_TERMINAL_STATUSES)("treats %s as terminal and stops polling", (status) => {
    const data = { review_progress: { status } };
    expect(isReviewTerminal(data)).toBe(true);
    expect(reviewPollingInterval(data, 5000)).toBe(false);
  });

  it("keeps polling while processing", () => {
    const data = { review_progress: { status: "processing" } };
    expect(isReviewTerminal(data)).toBe(false);
    expect(reviewPollingInterval(data, 5000)).toBe(5000);
  });

  it("does not treat completed_degraded as a stuck/in-flight review", () => {
    expect(reviewPollingInterval({ review_progress: { status: "completed_degraded" } })).toBe(false);
  });

  it("falls back to top-level status when review_progress is absent", () => {
    expect(isReviewTerminal({ status: "completed" })).toBe(true);
    expect(isReviewTerminal({ status: "processing" })).toBe(false);
  });

  it("keeps polling when there is no data yet", () => {
    expect(reviewPollingInterval(undefined, 4000)).toBe(4000);
    expect(reviewPollingInterval(null)).toBe(5000);
  });
});

describe("extractReviewProgress", () => {
  it("returns the first payload carrying review_progress", () => {
    const progress = { status: "processing", stages: [] };
    expect(extractReviewProgress(undefined, { review_progress: progress })).toBe(progress);
  });

  it("prefers the earlier source (status endpoint before detail)", () => {
    const a = { status: "processing" };
    const b = { status: "completed" };
    expect(extractReviewProgress({ review_progress: a }, { review_progress: b })).toBe(a);
  });

  it("returns null when nothing has review_progress", () => {
    expect(extractReviewProgress(null, {}, { foo: 1 })).toBeNull();
  });
});

describe("getAudioStageStatus / isAudioNotRun", () => {
  const progress = {
    stages: [
      { key: "privacy", status: "completed" },
      { key: "audio", status: "skipped" },
    ],
  };

  it("reads the audio stage status", () => {
    expect(getAudioStageStatus(progress)).toBe("skipped");
  });

  it("returns null when there is no audio stage", () => {
    expect(getAudioStageStatus({ stages: [{ key: "privacy", status: "completed" }] })).toBeNull();
    expect(getAudioStageStatus(null)).toBeNull();
  });

  it("flags skipped/disabled as not-run but never pending/processing", () => {
    expect(isAudioNotRun("skipped")).toBe(true);
    expect(isAudioNotRun("disabled")).toBe(true);
    expect(isAudioNotRun("pending")).toBe(false);
    expect(isAudioNotRun("processing")).toBe(false);
    expect(isAudioNotRun("completed")).toBe(false);
  });
});

describe("feedback reason helpers (PR C9.5 PART 6 — contract C)", () => {
  const withheldProgress = {
    status: "blocked",
    feedback_reason_code: "safety_withheld",
    stages: [
      { key: "analysis", status: "completed" },
      { key: "feedback", status: "blocked", reason_code: "safety_withheld" },
    ],
  };

  it("reads the feedback stage off the progress object", () => {
    expect(getFeedbackStage(withheldProgress).key).toBe("feedback");
    expect(getFeedbackStage({ stages: [] })).toBeNull();
    expect(getFeedbackStage(null)).toBeNull();
  });

  it("prefers the progress-level feedback_reason_code, then the stage reason_code", () => {
    expect(getFeedbackReasonCode(withheldProgress)).toBe("safety_withheld");
    expect(
      getFeedbackReasonCode({
        stages: [{ key: "feedback", status: "blocked", reason_code: "admin_hidden" }],
      })
    ).toBe("admin_hidden");
    expect(getFeedbackReasonCode({ stages: [] })).toBeNull();
  });

  it("maps every known reason code to honest copy that never implies feedback exists", () => {
    expect(describeFeedbackReason("feedback_awaiting_release")).toMatch(/administrator review/i);
    expect(describeFeedbackReason("safety_withheld")).toMatch(/safety check/i);
    expect(describeFeedbackReason("evidence_insufficient")).toMatch(/evidence/i);
    // A withheld reason must never use wording that claims feedback is ready/done.
    expect(describeFeedbackReason("safety_withheld")).not.toMatch(/\bdone\b/i);
  });

  it("returns null for an unknown or missing reason code", () => {
    expect(describeFeedbackReason(null)).toBeNull();
    expect(describeFeedbackReason("totally_unknown_code")).toBeNull();
  });
});

describe("absolutizeBackendUrl", () => {
  it("passes through absolute URLs unchanged", () => {
    expect(absolutizeBackendUrl("https://cdn/x.mp4", "https://api")).toBe("https://cdn/x.mp4");
  });

  it("prefixes relative paths with the backend origin", () => {
    expect(absolutizeBackendUrl("/uploads/x.mp4", "https://api")).toBe("https://api/uploads/x.mp4");
  });

  it("returns null for falsy input", () => {
    expect(absolutizeBackendUrl(null, "https://api")).toBeNull();
  });
});

describe("resolveTeacherPlaybackUrl (PART 5 privacy gate)", () => {
  const backendUrl = "https://api";

  it("returns the redacted URL when available and validated", () => {
    const playback = { available: true, asset_kind: "redacted", url: "/uploads/redacted/x.mp4", status: "ready" };
    expect(resolveTeacherPlaybackUrl({ playback, backendUrl })).toBe("https://api/uploads/redacted/x.mp4");
  });

  it("returns null when validation has not passed (no url)", () => {
    expect(
      resolveTeacherPlaybackUrl({ playback: { available: false, status: "validation_pending", url: null }, backendUrl })
    ).toBeNull();
    expect(
      resolveTeacherPlaybackUrl({ playback: { available: false, status: "validation_failed", url: null }, backendUrl })
    ).toBeNull();
  });

  it("returns null when privacy is incomplete", () => {
    expect(
      resolveTeacherPlaybackUrl({ playback: { available: false, status: "privacy_incomplete", url: null }, backendUrl })
    ).toBeNull();
  });

  it("never returns a URL when the playback object is missing", () => {
    expect(resolveTeacherPlaybackUrl({ playback: null, backendUrl })).toBeNull();
    expect(resolveTeacherPlaybackUrl({})).toBeNull();
  });
});

describe("resolveAdminPlaybackUrl (legacy, privacy-completed only)", () => {
  const backendUrl = "https://api";

  it("resolves the legacy URL once privacy is completed", () => {
    expect(
      resolveAdminPlaybackUrl({ privacyStatus: "completed", legacyPlaybackUrl: "/uploads/p.mp4", backendUrl })
    ).toBe("https://api/uploads/p.mp4");
  });

  it("returns null before privacy completes", () => {
    expect(
      resolveAdminPlaybackUrl({ privacyStatus: "processing", legacyPlaybackUrl: "/uploads/p.mp4", backendUrl })
    ).toBeNull();
  });
});

describe("resolvePlaybackUrl (single decision point)", () => {
  const backendUrl = "https://api";
  const validatedPlayback = { available: true, asset_kind: "redacted", url: "/uploads/redacted/x.mp4", status: "ready" };

  it("admins use the legacy resolver", () => {
    expect(
      resolvePlaybackUrl({
        isAdmin: true,
        playback: null,
        privacyStatus: "completed",
        legacyPlaybackUrl: "/uploads/processed.mp4",
        backendUrl,
      })
    ).toBe("https://api/uploads/processed.mp4");
  });

  it("teachers ignore the legacy URL and use the strict playback object", () => {
    // Legacy URL is present but the redacted asset is NOT validated → teacher
    // must get nothing, never the legacy/raw URL.
    expect(
      resolvePlaybackUrl({
        isAdmin: false,
        playback: { available: false, status: "validation_pending", url: null },
        privacyStatus: "completed",
        legacyPlaybackUrl: "/uploads/raw-ish.mp4",
        backendUrl,
      })
    ).toBeNull();
  });

  it("teachers get the redacted URL when it is validated", () => {
    expect(
      resolvePlaybackUrl({
        isAdmin: false,
        playback: validatedPlayback,
        privacyStatus: "completed",
        legacyPlaybackUrl: "/uploads/raw-ish.mp4",
        backendUrl,
      })
    ).toBe("https://api/uploads/redacted/x.mp4");
  });
});

describe("buildBackendWebSocketUrl (PR C9.4 PART 5 — double-slash fix)", () => {
  it("collapses the seam when the origin ends with a trailing slash", () => {
    const url = buildBackendWebSocketUrl({
      backendUrl: "https://cognivio.up.railway.app/",
      path: "/ws/videos/123",
    });
    expect(url).toBe("wss://cognivio.up.railway.app/ws/videos/123");
    expect(url).not.toContain("//ws");
  });

  it("works when the origin has no trailing slash", () => {
    expect(
      buildBackendWebSocketUrl({ backendUrl: "https://cognivio.up.railway.app", path: "/ws/videos/123" })
    ).toBe("wss://cognivio.up.railway.app/ws/videos/123");
  });

  it("tolerates a path with no leading slash", () => {
    expect(
      buildBackendWebSocketUrl({ backendUrl: "https://cognivio.up.railway.app", path: "ws/videos/123" })
    ).toBe("wss://cognivio.up.railway.app/ws/videos/123");
  });

  it("downgrades http origins to the ws scheme", () => {
    expect(
      buildBackendWebSocketUrl({ backendUrl: "http://localhost:8000/", path: "/ws/videos/abc" })
    ).toBe("ws://localhost:8000/ws/videos/abc");
  });

  it("collapses multiple trailing slashes to a single seam", () => {
    const url = buildBackendWebSocketUrl({
      backendUrl: "https://cognivio.up.railway.app///",
      path: "/ws/videos/9",
    });
    expect(url).toBe("wss://cognivio.up.railway.app/ws/videos/9");
    // Only the scheme keeps a double slash; the host->path seam must be single.
    expect(url.match(/\/\//g)).toHaveLength(1);
  });

  it("returns null for a missing or invalid base", () => {
    expect(buildBackendWebSocketUrl({ backendUrl: "", path: "/ws" })).toBeNull();
    expect(buildBackendWebSocketUrl({})).toBeNull();
    expect(buildBackendWebSocketUrl()).toBeNull();
  });
});
