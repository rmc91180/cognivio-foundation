/**
 * PR C8 frontend tests for the typed navigator rendering layer.
 *
 * Verifies that:
 *   1. TeacherWorkspacePage renders the navigator label and CTA for
 *      review_pending / admin_hidden / no_action without showing
 *      "Open next step" or linking to /record.
 *   2. TeacherWorkspacePage shows "Coaching focus" + the coaching CTA
 *      for a valid coaching action.
 *   3. TeacherWorkspacePage shows the upload CTA only when navigator
 *      type is upload_required.
 *   4. TeacherCoachingPage uses navigator label + state-specific CTA.
 *   5. TeacherCoachingPage uses specific moment CTA labels instead of
 *      generic "Watch the moment" when keyword/phase signals are
 *      present.
 *   6. "A coach will continue from here" appears nowhere in rendered
 *      teacher pages.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { TeacherCoachingPage } from "@/pages/TeacherCoachingPage";
import { teacherApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Maya", tenant_role: "teacher" } }),
}));

jest.mock("@/lib/api", () => ({
  teacherApi: {
    myDashboard: jest.fn(),
    mySearch: jest.fn(),
    myCoaching: jest.fn(),
    myLessons: jest.fn(),
    myRecognition: jest.fn(),
    updateCoachingTask: jest.fn(),
    createReflection: jest.fn(),
    actionItemTried: jest.fn(),
    actionItemReflect: jest.fn(),
  },
  demoApi: { seed: jest.fn() },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

const REVIEW_PENDING_NAVIGATOR = {
  type: "review_pending",
  label: "Review status",
  title: "Feedback is being reviewed.",
  body: "No action needed right now. Your coaching summary will appear here when the review is ready.",
  cta_label: null,
  href: null,
  disabled: true,
  priority: 60,
  source: "artifact",
  action_item_id: null,
  start_sec: null,
  end_sec: null,
  video_href: null,
  reason: "evidence_insufficient",
};

const ADMIN_HIDDEN_NAVIGATOR = { ...REVIEW_PENDING_NAVIGATOR, type: "admin_hidden", reason: "admin_hidden" };

const NO_ACTION_NAVIGATOR = {
  type: "no_action",
  label: "All set",
  title: "No action needed right now.",
  body: "You’re all set. New coaching actions will appear here after your next reviewed lesson.",
  cta_label: null,
  href: null,
  disabled: true,
  priority: 90,
  source: "artifact",
  action_item_id: null,
  start_sec: null,
  end_sec: null,
  video_href: null,
  reason: "no_action",
};

const UPLOAD_REQUIRED_NAVIGATOR = {
  type: "upload_required",
  label: "Recording",
  title: "Your recording setup is ready.",
  body: "After a lesson has a complete review, you’ll see specific coaching moments here.",
  cta_label: "Record or upload a lesson",
  href: "/record",
  disabled: false,
  priority: 30,
  source: "recording",
  action_item_id: null,
  start_sec: null,
  end_sec: null,
  video_href: null,
  reason: "no_reviewed_lesson",
};

const COACHING_ACTION_NAVIGATOR = {
  type: "coaching_action",
  label: "Coaching focus",
  title: "Try this in your next lesson",
  body: "After one student answers, pause and ask, 'Who can build on that?'",
  cta_label: "Open coaching action",
  href: "/my-coaching?task_id=a1",
  disabled: false,
  priority: 20,
  source: "artifact",
  action_item_id: "a1",
  start_sec: 60,
  end_sec: 80,
  video_href: "/videos/v1?t=60",
  reason: null,
};

const ALLOWED_ARTIFACT = {
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  lesson: {
    lesson_id: "a-good",
    video_id: "v1",
    assessment_id: "a-good",
    title: "Fractions discussion",
    subject: "Math",
    status: "reviewed",
  },
  teacher_feedback_allowed: true,
  blocked_reason: null,
  summary: {
    headline: "You opened with a clear question.",
    opening: "You opened with a clear question.",
    what_worked: "You waited for a second voice.",
    growth_focus: "Try asking a peer to build on the first answer.",
    next_step: "After one student answers, pause and ask 'Who can build on that?'",
  },
  highlights: [
    { id: "h1", title: "Moment worth keeping", body: "You held space for a quieter voice.", video_href: "/videos/v1?t=120" },
  ],
  action_items: [
    {
      id: "a1",
      title: "Try one quick partner check",
      body: "Ask a peer to add on.",
      try_next_lesson: "After one student answers, pause and ask 'Who can build on that?'",
      why_it_matters: "Keeps the practice small.",
      reflection_prompt: "Who joined the conversation?",
      video_href: "/videos/v1?t=120",
      category: "instructional_practice",
      action_kind: "try_next_lesson",
      cta_label: "Open coaching action",
      moment_cta_label: "Watch the question exchange",
      disabled: false,
      moment_label: null,
    },
  ],
  deep_dive: {
    available: true,
    moments: [
      {
        id: "m1",
        start_sec: 120,
        end_sec: 150,
        title: "Watch this moment",
        what_happened: "You waited after the prompt.",
        why_it_matters: "Choose what to repeat.",
        video_href: "/videos/v1?t=120",
        phase: "discussion",
      },
    ],
    empty_state: null,
  },
  recognition: { gold_star: null, personal_highlights: [] },
  reflection: { private_by_default: true, prompts: ["Who joined the conversation?"] },
  navigator: COACHING_ACTION_NAVIGATOR,
  next_best_action: {
    id: "a1",
    title: "Try this in your next lesson",
    description: "After one student answers, pause and ask 'Who can build on that?'",
    href: "/my-coaching?task_id=a1",
    cta_label: "Open coaching action",
    type: "coaching_action",
    label: "Coaching focus",
  },
  empty_state: null,
  language: "en",
  guardrails: { teacher_visible: true, rubric_removed: true, scores_removed: true, evidence_grounded: true, language: "en" },
};

const blockedArtifact = (navigator) => ({
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  lesson: { lesson_id: "a-bad", video_id: "v-bad", assessment_id: "a-bad", title: "Pending", subject: "Math", status: "review_blocked" },
  teacher_feedback_allowed: false,
  blocked_reason: navigator.reason || navigator.type,
  summary: { headline: null, opening: null, what_worked: null, growth_focus: null, next_step: null },
  highlights: [],
  action_items: [],
  deep_dive: { available: false, moments: [], empty_state: navigator.body },
  recognition: { gold_star: null, personal_highlights: [] },
  reflection: { private_by_default: true, prompts: [] },
  navigator,
  next_best_action: null,
  empty_state: {
    code: navigator.reason || navigator.type,
    title: navigator.title,
    message: navigator.body,
  },
  language: "en",
  guardrails: { teacher_visible: false, rubric_removed: true, scores_removed: true, evidence_grounded: false, language: "en" },
});

const dashboardPayload = (overrides = {}) => ({
  data: {
    readiness: { missing_items: [], upload_ready: true },
    next_best_action: null,
    latest_lesson: null,
    highlights: [],
    action_items: [],
    trends: [],
    schedule: [],
    gradebook_reminders: [],
    reports: [],
    recognition: { items: [] },
    demo_eligible: false,
    coaching_artifact: null,
    ...overrides,
  },
});

const coachingPayload = (artifact) => ({
  data: {
    readiness: {},
    active_tasks: [],
    recommendations: [],
    suggested_improvements: [],
    shared_moments: [],
    teacher_reflections: [],
    reflections: [],
    next_best_action: null,
    upcoming_meetings: [],
    messages: [],
    coaching_artifact: artifact,
  },
});

describe("PR C8 teacher navigation intelligence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.mySearch.mockResolvedValue({ data: { results: [] } });
  });

  // -----------------------------------------------------------------------
  // 1-3. Workspace navigator-aware copy
  // -----------------------------------------------------------------------

  it("workspace renders Review status copy and no Open next step / /record link when artifact blocked", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce(
      dashboardPayload({
        coaching_artifact: blockedArtifact(REVIEW_PENDING_NAVIGATOR),
        latest_lesson: { coaching_artifact: blockedArtifact(REVIEW_PENDING_NAVIGATOR) },
      })
    );
    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("teacher-navigator-label").textContent).toMatch(/Review status/i);
    });
    expect(screen.getByTestId("teacher-navigator-title").textContent).toMatch(/Feedback is being reviewed/i);
    // No "Open next step" anywhere.
    expect(screen.queryByText(/Open next step/i)).not.toBeInTheDocument();
    // No /record link.
    const recordLinks = Array.from(document.querySelectorAll("a")).filter((node) => node.getAttribute("href") === "/record");
    expect(recordLinks.length).toBe(0);
    // No misleading "A coach will continue from here" copy.
    const visible = document.body.textContent;
    expect(findBannedCoachVoicePhrases(visible)).toEqual([]);
    expect(visible.toLowerCase()).not.toContain("a coach will continue from here");
  });

  it("workspace renders admin_hidden as Review status with no clickable CTA", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce(
      dashboardPayload({
        coaching_artifact: blockedArtifact(ADMIN_HIDDEN_NAVIGATOR),
        latest_lesson: { coaching_artifact: blockedArtifact(ADMIN_HIDDEN_NAVIGATOR) },
      })
    );
    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("teacher-navigator-label").textContent).toMatch(/Review status/i);
    });
    expect(screen.queryByTestId("teacher-navigator-cta")).not.toBeInTheDocument();
  });

  it("workspace renders no_action navigator with no CTA", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce(
      dashboardPayload({
        coaching_artifact: blockedArtifact(NO_ACTION_NAVIGATOR),
        latest_lesson: { coaching_artifact: blockedArtifact(NO_ACTION_NAVIGATOR) },
      })
    );
    renderWithClient(<TeacherWorkspacePage />);
    await waitFor(() => {
      expect(screen.getByTestId("teacher-navigator-title").textContent).toMatch(/No action needed right now/i);
    });
    expect(screen.queryByText(/Open next step/i)).not.toBeInTheDocument();
  });

  it("workspace shows the upload CTA only when navigator type is upload_required", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce(
      dashboardPayload({
        coaching_artifact: blockedArtifact(UPLOAD_REQUIRED_NAVIGATOR),
        latest_lesson: { coaching_artifact: blockedArtifact(UPLOAD_REQUIRED_NAVIGATOR) },
      })
    );
    renderWithClient(<TeacherWorkspacePage />);
    await waitFor(() => {
      expect(screen.getByTestId("teacher-navigator-label").textContent).toMatch(/Recording/i);
    });
    const cta = screen.getByTestId("teacher-navigator-cta");
    expect(cta).toHaveAttribute("href", "/record");
  });

  it("workspace renders coaching focus + coaching CTA when artifact allowed", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce(
      dashboardPayload({
        coaching_artifact: ALLOWED_ARTIFACT,
        latest_lesson: { coaching_artifact: ALLOWED_ARTIFACT, teacher_feedback: null, title: "Fractions", subject: "Math" },
      })
    );
    renderWithClient(<TeacherWorkspacePage />);
    await waitFor(() => {
      expect(screen.getByTestId("teacher-navigator-label").textContent).toMatch(/Coaching focus/i);
    });
    expect(screen.getByText(/Open coaching action/i)).toBeInTheDocument();
    // Specific moment label (from C8) replaces generic "Watch the moment".
    expect(screen.getByText(/Watch the question exchange/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 4-5. Coaching page navigator-aware rendering
  // -----------------------------------------------------------------------

  it("coaching page renders Review status with no Open next step for blocked artifact", async () => {
    teacherApi.myCoaching.mockResolvedValueOnce(coachingPayload(blockedArtifact(REVIEW_PENDING_NAVIGATOR)));
    renderWithClient(<TeacherCoachingPage />);
    await waitFor(() => {
      expect(screen.getByTestId("teacher-coaching-navigator-label").textContent).toMatch(/Review status/i);
    });
    expect(screen.queryByText(/Open next step/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("teacher-coaching-navigator-cta")).not.toBeInTheDocument();
    expect(document.body.textContent.toLowerCase()).not.toContain("a coach will continue from here");
  });

  it("coaching page uses specific moment CTA for valid moment with phase signal", async () => {
    teacherApi.myCoaching.mockResolvedValueOnce(coachingPayload(ALLOWED_ARTIFACT));
    renderWithClient(<TeacherCoachingPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Try one quick partner check/i).length).toBeGreaterThanOrEqual(1);
    });
    // The task carries moment_cta_label "Watch the question exchange".
    expect(screen.getAllByText(/Watch the question exchange/i).length).toBeGreaterThanOrEqual(1);
    // No generic "Watch the moment" should appear for this artifact.
    expect(screen.queryByText(/^Watch the moment$/)).not.toBeInTheDocument();
  });
});
