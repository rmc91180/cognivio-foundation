/**
 * PR C9.3 frontend tests — review progress instrumentation (PART 2) and
 * validated, privacy-safe playback gating (PART 5) on the video detail page.
 *
 * Covers:
 *   1. Teacher sees the review-progress checklist with audio shown as "not run"
 *      (disabled) — never "after audio review is complete".
 *   2. A degraded (vision-only) review reads as complete, not a stuck spinner.
 *   3. Teacher plays ONLY the redacted, validation-passed URL from the
 *      teacher-safe playback object.
 *   4. Teacher sees a privacy-safe message (no player) when validation failed.
 *   5. Teacher never falls back to the legacy/raw playback_url when the strict
 *      playback object is not available, even after privacy completes.
 *   6. Admins keep the legacy resolver and can play once privacy completes.
 *   7. The transcript tab states audio was not run (no misleading copy).
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { VideoPlayerPage } from "@/pages/VideoPlayerPage";
import api, {
  assessmentApi,
  exemplarApi,
  observationApi,
  recognitionApi,
  shareAssetApi,
  videoApi,
} from "@/lib/api";

// eslint-disable-next-line prefer-const -- reassigned per test before render.
let mockUser = { id: "user-1", teacher_id: "teacher-1", tenant_role: "teacher" };

// Override the global setupTests react-i18next mock to also provide i18n.dir()
// (VideoPlayerPage reads i18n.dir() for RTL layout). t() still returns the key.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options) =>
      options && typeof options.defaultValue === "string" ? options.defaultValue : key,
    i18n: { language: "en", dir: () => "ltr", changeLanguage: jest.fn() },
  }),
  Trans: ({ children }) => children,
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
  assessmentApi: { get: jest.fn(), listFeedback: jest.fn() },
  exemplarApi: { submit: jest.fn() },
  observationApi: { listForVideo: jest.fn() },
  recognitionApi: { video: jest.fn(), updateOptIn: jest.fn() },
  shareAssetApi: { createSocialCard: jest.fn(), createEmailSignature: jest.fn() },
  videoApi: {
    detail: jest.fn(),
    status: jest.fn(),
    comments: jest.fn(),
    audioAnalysis: jest.fn(),
    analysisMoments: jest.fn(),
    retry: jest.fn(),
    retryPrivacy: jest.fn(),
    createComment: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
  },
}));

jest.mock("react-router-dom", () => {
  const actual = jest.requireActual("react-router-dom");
  return { ...actual, useParams: () => ({ videoId: "video-1" }) };
});

const REDACTED_URL = "https://api.example/uploads/redacted/video-1.mp4";
const LEGACY_RAW_URL = "https://api.example/uploads/raw/legacy-video-1.mp4";
const ADMIN_PROCESSED_URL = "https://api.example/uploads/processed/video-1.mp4";

const degradedAudioDisabledProgress = () => ({
  status: "completed_degraded",
  percent: 100,
  current_stage: "feedback",
  teacher_message: "Your review is complete. This analysis was based on video only.",
  admin_message: "Review complete but degraded (vision-only / paid analysis not available).",
  degraded: true,
  degradation_reasons: ["vision_only_mode"],
  needs_admin_attention: false,
  failure_code: null,
  retry: { eligible: false, action: null },
  stages: [
    { key: "upload", label: "Upload", status: "completed" },
    { key: "video_preparation", label: "Video preparation", status: "completed" },
    { key: "privacy", label: "Privacy blur", status: "completed" },
    { key: "analysis", label: "AI analysis", status: "completed", detail: "Completed with reduced modalities" },
    { key: "audio", label: "Audio analysis", status: "skipped", detail: "Audio analysis is not enabled for this review" },
    { key: "feedback", label: "Feedback", status: "completed" },
  ],
});

const baseVideo = (overrides = {}) => ({
  id: "video-1",
  filename: "lesson.mp4",
  teacher_id: "teacher-1",
  status: "completed",
  analysis_status: "completed",
  privacy_status: "completed",
  transcode_status: "completed",
  assessment_id: null,
  thumbnail_url: null,
  audio_analysis_enabled: false,
  review_progress: degradedAudioDisabledProgress(),
  playback: { available: true, asset_kind: "redacted", url: REDACTED_URL, status: "ready" },
  ...overrides,
});

const statusFor = (video) => ({
  status: video.status,
  privacy_status: video.privacy_status,
  analysis_status: video.analysis_status,
  transcode_status: video.transcode_status,
  privacy_review_required: false,
  review_progress: video.review_progress,
  review_status: video.review_progress?.status,
  review_percent: video.review_progress?.percent,
  playback: video.playback,
  redacted_playback_validation: video.redacted_playback_validation || null,
});

const setVideo = (video) => {
  videoApi.detail.mockResolvedValue({ data: video });
  videoApi.status.mockResolvedValue({ data: statusFor(video) });
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VideoPlayerPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "user-1", teacher_id: "teacher-1", tenant_role: "teacher" };
  // Audio disabled → analysis features unavailable.
  videoApi.audioAnalysis.mockResolvedValue({ data: { features_available: false } });
  videoApi.comments.mockResolvedValue({ data: { comments: [] } });
  videoApi.analysisMoments.mockResolvedValue({ data: { moments: [] } });
  observationApi.listForVideo.mockResolvedValue({ data: [] });
  recognitionApi.video.mockResolvedValue({ data: { recognition: { status: "not_evaluated" }, eligibility: {} } });
  assessmentApi.get.mockResolvedValue({ data: {} });
  assessmentApi.listFeedback.mockResolvedValue({ data: { feedback: [] } });
  api.get.mockResolvedValue({ data: {} });
  // The WS effect bails when no token/backendUrl, but stub to be safe.
  global.WebSocket = jest.fn(() => ({ close: jest.fn() }));
});

describe("PR C9.3 review progress + playback gating (teacher)", () => {
  it("renders the review-progress checklist with audio shown as not run", async () => {
    setVideo(baseVideo());
    renderPage();

    const panel = await screen.findByTestId("review-progress");
    expect(panel).toHaveAttribute("data-status", "completed_degraded");

    const audioStage = screen.getByTestId("review-stage-audio");
    expect(audioStage).toHaveAttribute("data-status", "skipped");
    expect(audioStage).toHaveTextContent("Audio analysis was not run for this review.");

    // Must NOT promise audio is still coming.
    expect(document.body.textContent).not.toMatch(/after audio review is complete/i);
  });

  it("treats a degraded vision-only review as complete, not a stuck spinner", async () => {
    setVideo(baseVideo());
    renderPage();

    const panel = await screen.findByTestId("review-progress");
    expect(panel).toHaveAttribute("data-percent", "100");
    expect(screen.getByTestId("review-progress-percent")).toHaveTextContent("100%");
    expect(screen.getByTestId("review-progress-message")).toHaveTextContent(
      "This analysis was based on video only."
    );
  });

  it("plays only the redacted, validation-passed URL for teachers", async () => {
    setVideo(baseVideo());
    const { container } = renderPage();

    await screen.findByTestId("review-progress");
    const video = await waitFor(() => {
      const el = container.querySelector("video");
      if (!el) throw new Error("video not rendered yet");
      return el;
    });
    expect(video.getAttribute("src")).toBe(REDACTED_URL);
    // The raw URL must never reach the teacher's DOM.
    expect(container.innerHTML).not.toContain(LEGACY_RAW_URL);
  });

  it("shows a privacy-safe message and no player when validation failed", async () => {
    setVideo(
      baseVideo({
        playback: { available: false, asset_kind: "redacted", url: null, status: "validation_failed", failure_code: "ffmpeg_unavailable_for_browser_safe_render" },
        playback_url: LEGACY_RAW_URL,
      })
    );
    const { container } = renderPage();

    await screen.findByTestId("review-progress");
    await waitFor(() =>
      expect(screen.getByText(/couldn.t prepare a playable version/i)).toBeInTheDocument()
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.innerHTML).not.toContain(LEGACY_RAW_URL);
  });

  it("never falls back to the legacy/raw playback_url for teachers", async () => {
    setVideo(
      baseVideo({
        // Privacy completed AND a legacy URL exists, but the redacted asset is
        // not yet validated → the teacher must get nothing playable.
        playback: { available: false, asset_kind: "redacted", url: null, status: "validation_pending" },
        playback_url: LEGACY_RAW_URL,
      })
    );
    const { container } = renderPage();

    await screen.findByTestId("review-progress");
    await waitFor(() =>
      expect(screen.getByText(/finalizing a playable version/i)).toBeInTheDocument()
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.innerHTML).not.toContain(LEGACY_RAW_URL);
  });

  it("states audio was not run on the transcript tab", async () => {
    setVideo(baseVideo());
    renderPage();

    await screen.findByTestId("review-progress");
    await userEvent.click(screen.getByRole("button", { name: "Transcript" }));

    expect(
      screen.getAllByText("Audio analysis was not run for this review.").length
    ).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toMatch(/Transcript will appear here when audio review is available/i);
  });
});

describe("PR C9.5 PART 7 navigation vocabulary (contract F)", () => {
  it("teacher breadcrumb roots at Lessons -> /my-lessons, never the admin recordings library", async () => {
    mockUser = { id: "user-1", teacher_id: "teacher-1", tenant_role: "teacher" };
    setVideo(baseVideo());
    renderPage();

    await screen.findByTestId("review-progress");
    // t() is mocked to echo the key, so "Lessons" surfaces as the nav.lessons key.
    const crumb = screen.getByRole("link", { name: "nav.lessons" });
    expect(crumb).toHaveAttribute("href", "/my-lessons");
    // The teacher must NOT see the admin "Videos & Assessments" (nav.videos) crumb.
    expect(screen.queryByRole("link", { name: "nav.videos" })).toBeNull();
  });

  it("admin breadcrumb keeps the Videos & Assessments recordings library", async () => {
    mockUser = { id: "admin-1", tenant_role: "admin" };
    setVideo(baseVideo());
    renderPage();

    await screen.findByTestId("review-progress");
    const crumb = screen.getByRole("link", { name: "nav.videos" });
    expect(crumb).toHaveAttribute("href", "/videos");
  });
});

describe("PR C9.3 admin playback", () => {
  it("admins keep the legacy resolver and can play once privacy completes", async () => {
    mockUser = { id: "admin-1", tenant_role: "admin" };
    setVideo(
      baseVideo({
        // No teacher-safe playback object needed for admins.
        playback: { available: false, asset_kind: null, url: null, status: "validation_pending" },
        playback_url: ADMIN_PROCESSED_URL,
      })
    );
    const { container } = renderPage();

    await screen.findByTestId("review-progress");
    const video = await waitFor(() => {
      const el = container.querySelector("video");
      if (!el) throw new Error("video not rendered yet");
      return el;
    });
    expect(video.getAttribute("src")).toBe(ADMIN_PROCESSED_URL);
  });
});

describe("PR3 teacher empty-state placeholders (admin/teacher fork)", () => {
  it("teacher sees a clear 'available after observer review' placeholder, not blank/No-X panels", async () => {
    mockUser = { id: "user-1", teacher_id: "teacher-1", tenant_role: "teacher" };
    // Same assessment document, but it carries no teacher-projected summary /
    // strengths / growth / coaching / priority fields yet.
    setVideo(baseVideo({ assessment_id: "assess-1" }));
    assessmentApi.get.mockResolvedValue({ data: { id: "assess-1" } });
    renderPage();

    await screen.findByTestId("review-progress");
    // The observation-summary boxes (strengths/growth/coaching/priority) render
    // the teacher pending label instead of a blank box, a literal null, or the
    // admin "No X yet" copy. (t() is mocked to echo the i18n key.)
    await waitFor(() => {
      expect(
        screen.getAllByText("videoPlayer.feedbackPendingForTeacher").length
      ).toBeGreaterThanOrEqual(4);
    });
    // Admin-only empty-state copy must NOT leak to the teacher.
    expect(screen.queryByText("videoPlayer.noStrengthsAvailable")).toBeNull();
    expect(screen.queryByText("videoPlayer.noGrowthAreasAvailable")).toBeNull();
    expect(screen.queryByText("videoPlayer.noCoachingMovesAvailable")).toBeNull();
    expect(screen.queryByText("videoPlayer.noPriorityAlignment")).toBeNull();
  });

  it("admin keeps the existing 'No X yet' empty-state and never the teacher pending label", async () => {
    mockUser = { id: "admin-1", tenant_role: "admin" };
    setVideo(baseVideo({ assessment_id: "assess-1" }));
    assessmentApi.get.mockResolvedValue({ data: { id: "assess-1" } });
    renderPage();

    await screen.findByTestId("review-progress");
    // The admin fork is unchanged: an empty observation summary shows the admin
    // copy, never the teacher-facing pending label.
    await waitFor(() => {
      expect(
        screen.getAllByText("videoPlayer.noStrengthsAvailable").length
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("videoPlayer.feedbackPendingForTeacher")).toBeNull();
  });
});
