/**
 * PR C5 frontend tests: pilot teacher experience artifact integration.
 *
 * Covers:
 *   1. Teacher workspace renders artifact summary / action / highlight when allowed.
 *   2. Teacher workspace renders honest empty state when artifact blocked,
 *      and does NOT fall back to bad legacy fields.
 *   3. Teacher coaching page renders artifact action items + deep dive when allowed.
 *   4. Teacher coaching page hides Watch-the-moment link when no video_href.
 *   5. Teacher lessons page uses artifact summary/status (blocked → not "Reviewed").
 *   6. Recognition page separates Gold-Star from personal highlights and does
 *      NOT say highlights require recognition.
 *   7. Defensive scan: blocked artifact fixture renders zero known bad strings.
 *   8. Legacy fallback still works when artifact is absent, not when blocked.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { TeacherCoachingPage } from "@/pages/TeacherCoachingPage";
import { TeacherLessonsPage } from "@/pages/TeacherLessonsPage";
import { TeacherBadgesPage } from "@/pages/TeacherBadgesPage";
import { teacherApi, demoApi } from "@/lib/api";
import { scanForBannedPhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Maya Patel", tenant_role: "teacher" } }),
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
  },
  demoApi: {
    seed: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

const ALLOWED_ARTIFACT = {
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  lesson: {
    lesson_id: "a-good",
    video_id: "v-good",
    assessment_id: "a-good",
    title: "Fractions discussion",
    subject: "Math",
    reviewed_at: "2026-05-27T00:00:00+00:00",
    status: "reviewed",
  },
  teacher_feedback_allowed: true,
  blocked_reason: null,
  summary: {
    headline: "You opened the lesson with a clear question.",
    opening: "You opened the lesson with a clear question.",
    what_worked: "You waited after the prompt and a second student answered.",
    growth_focus: "Try asking a peer to build on the first answer.",
    next_step: "After one student answers, pause and ask 'Who can build on that?'",
  },
  highlights: [
    {
      id: "h1",
      title: "Moment worth keeping",
      body: "You held space for a second student voice.",
      video_href: "/videos/v-good?t=120",
      source: "analysis",
    },
  ],
  action_items: [
    {
      id: "a1",
      title: "Try one quick partner check",
      body: "After one student answers, pause and ask 'Who can build on that?'",
      try_next_lesson: "After one student answers, pause and ask 'Who can build on that?'",
      why_it_matters: "Keeps the practice move small enough to notice what changes.",
      video_href: "/videos/v-good?t=120",
      reflection_prompt: "When you try this move, who joins the conversation?",
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
        what_happened: "You waited after the prompt and Maya extended a peer's answer.",
        why_it_matters: "This moment helps you choose what to repeat next lesson.",
        video_href: "/videos/v-good?t=120",
      },
    ],
    empty_state: null,
  },
  recognition: {
    gold_star: null,
    personal_highlights: [
      {
        id: "h1",
        title: "Moment worth keeping",
        body: "You held space for a second student voice.",
      },
    ],
  },
  reflection: {
    private_by_default: true,
    prompts: ["When you try this move, who joins the conversation?"],
  },
  next_best_action: {
    id: "a1",
    title: "Try one coaching move",
    description: "After one student answers, pause and ask 'Who can build on that?'",
    href: "/my-coaching?task_id=a1",
    cta_label: "Open coaching",
  },
  empty_state: null,
  language: "en",
  guardrails: {
    teacher_visible: true,
    rubric_removed: true,
    scores_removed: true,
    evidence_grounded: true,
    language: "en",
  },
};

const BLOCKED_ARTIFACT = {
  artifact_version: "teacher_lesson_coaching_artifact_v1",
  lesson: {
    lesson_id: "a-bad",
    video_id: "v-bad",
    assessment_id: "a-bad",
    title: "Pending review",
    subject: "Math",
    status: "review_blocked",
  },
  teacher_feedback_allowed: false,
  blocked_reason: "evidence_insufficient",
  summary: { headline: null, opening: null, what_worked: null, growth_focus: null, next_step: null },
  highlights: [],
  action_items: [],
  deep_dive: { available: false, moments: [], empty_state: "Detailed lesson moments will appear after a complete review is ready." },
  recognition: { gold_star: null, personal_highlights: [] },
  reflection: { private_by_default: true, prompts: [] },
  next_best_action: {
    id: "record-lesson",
    title: "Your recording setup is ready.",
    description: "After a lesson has a complete review, you’ll see specific coaching moments and next steps here.",
    href: "/record",
    cta_label: "Record or upload a lesson",
  },
  empty_state: {
    code: "evidence_insufficient",
    title: "This lesson’s feedback isn’t ready yet.",
    message: "Once a complete review is ready, you’ll see specific coaching moments and next steps here.",
  },
  language: "en",
  guardrails: { teacher_visible: false, rubric_removed: true, scores_removed: true, evidence_grounded: false, language: "en" },
};

describe("PR C5 pilot teacher experience integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.mySearch.mockResolvedValue({ data: { results: [] } });
  });

  // -------------------------------------------------------------------------
  // 1. Workspace renders artifact summary / action / highlight when allowed
  // -------------------------------------------------------------------------

  it("workspace renders artifact summary, primary action, and highlight when artifact allowed", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: {
          title: "Fractions discussion",
          subject: "Math",
          uploaded_at: "2026-05-27T00:00:00+00:00",
          href: "/videos/v-good",
          teacher_feedback: ALLOWED_ARTIFACT.legacy_projection || null,
          coaching_artifact: ALLOWED_ARTIFACT,
        },
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText(/You opened the lesson with a clear question/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/You held space for a second student voice/i)).toBeInTheDocument();
    // The action title appears in both the primary action card AND the
    // action items list — both surfaces come from the same artifact.
    expect(screen.getAllByText(/Try one quick partner check/i).length).toBeGreaterThanOrEqual(1);

    const visibleText = document.body.textContent;
    expect(scanForBannedPhrases(visibleText)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Workspace renders empty state when blocked, no legacy bypass
  // -------------------------------------------------------------------------

  it("workspace renders empty state when artifact is blocked and ignores stale legacy fields", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: {
          title: "Pending review",
          subject: "Math",
          uploaded_at: "2026-05-27T00:00:00+00:00",
          // Legacy fields are POPULATED with stale unsafe text; the
          // blocked artifact MUST suppress them.
          teacher_feedback: {
            latest_summary: {
              opening: "The clip gave us a brief window into your lesson — here is what stood out.",
              strength: "Demonstrating Knowledge of Students",
              growth_focus: "Plan a targeted coaching cycle",
              next_step: "Try this next lesson: rafi:",
            },
          },
          coaching_artifact: BLOCKED_ARTIFACT,
        },
        highlights: [
          { id: "stale", title: "Demonstrating Knowledge of Students", description: "Plan a targeted coaching cycle" },
        ],
        action_items: [
          { id: "stale", title: "coach d1b after 5.3 evidence", description: "Try this next lesson: rafi:" },
        ],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText(/This lesson.s feedback isn.t ready yet/i)).toBeInTheDocument();
    });

    // The legacy stale strings must NOT be rendered anywhere.
    const visibleText = document.body.textContent;
    expect(scanForBannedPhrases(visibleText)).toEqual([]);
    expect(visibleText).not.toMatch(/brief window into your lesson/i);
    expect(visibleText).not.toMatch(/plan a targeted coaching cycle/i);
    expect(visibleText).not.toMatch(/try this next lesson: rafi:/i);
    expect(visibleText).not.toMatch(/demonstrating knowledge of students/i);
  });

  // -------------------------------------------------------------------------
  // 3. Coaching page renders artifact action items + deep dive when allowed
  // -------------------------------------------------------------------------

  it("coaching page renders artifact action item and deep dive when allowed", async () => {
    teacherApi.myCoaching.mockResolvedValueOnce({
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
        coaching_artifact: ALLOWED_ARTIFACT,
      },
    });

    renderWithClient(<TeacherCoachingPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Try one quick partner check/i).length).toBeGreaterThanOrEqual(1);
    });
    // Deep dive moment from the artifact is rendered.
    expect(screen.getByText(/Maya extended a peer/i)).toBeInTheDocument();
    // Reflection prompt from the artifact is rendered (it shows in the
    // reflection prompts panel + may also show on action card).
    expect(screen.getAllByText(/who joins the conversation/i).length).toBeGreaterThanOrEqual(1);

    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Coaching page hides Watch-the-moment link without video_href
  // -------------------------------------------------------------------------

  it("coaching page hides Watch-the-moment link when artifact action has no video_href", async () => {
    const noHrefArtifact = JSON.parse(JSON.stringify(ALLOWED_ARTIFACT));
    noHrefArtifact.action_items[0].video_href = null;
    noHrefArtifact.deep_dive.moments[0].video_href = null;

    teacherApi.myCoaching.mockResolvedValueOnce({
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
        coaching_artifact: noHrefArtifact,
      },
    });

    renderWithClient(<TeacherCoachingPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Try one quick partner check/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryAllByText("Watch the moment").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. Lessons page uses artifact summary/status (blocked → not Reviewed)
  // -------------------------------------------------------------------------

  it("lessons page demotes status when artifact is blocked and hides legacy summary", async () => {
    teacherApi.myLessons.mockResolvedValueOnce({
      data: {
        readiness: { teacher_profile_complete: true },
        filters: { subjects: [] },
        lessons: [
          {
            video_id: "v-bad",
            assessment_id: "a-bad",
            title: "Pending review",
            subject: "Math",
            uploaded_at: "2026-05-27T00:00:00+00:00",
            status: "reviewed",
            summary: "The clip gave us a brief window into your lesson — here is what stood out.",
            teacher_feedback: { latest_summary: { opening: "demonstrating knowledge of students" } },
            coaching_artifact: BLOCKED_ARTIFACT,
            href: "/videos/v-bad",
          },
        ],
      },
    });

    renderWithClient(<TeacherLessonsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pending review/i)).toBeInTheDocument();
    });
    // Status pill is downgraded — the lesson card status pill should read
    // something other than "Reviewed" (e.g. "Review in progress" /
    // "Uploaded"). Both the dropdown option AND the status pill contain
    // the text, so we expect 2 matches.
    expect(screen.queryAllByText("Review in progress").length).toBe(2);
    // Legacy bad summary must NOT be rendered.
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  it("lessons page shows artifact summary when artifact is allowed", async () => {
    teacherApi.myLessons.mockResolvedValueOnce({
      data: {
        readiness: { teacher_profile_complete: true },
        filters: { subjects: [] },
        lessons: [
          {
            video_id: "v-good",
            assessment_id: "a-good",
            title: "Fractions discussion",
            subject: "Math",
            uploaded_at: "2026-05-27T00:00:00+00:00",
            status: "reviewed",
            summary: "legacy summary text not used",
            coaching_artifact: ALLOWED_ARTIFACT,
            href: "/videos/v-good",
          },
        ],
      },
    });

    renderWithClient(<TeacherLessonsPage />);

    await waitFor(() => {
      expect(screen.getByText(/You opened the lesson with a clear question/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("legacy summary text not used")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 6. Recognition page separates Gold-Star and personal highlights
  // -------------------------------------------------------------------------

  it("recognition page separates Gold-Star from personal highlights and avoids 'after recognition' copy", async () => {
    teacherApi.myRecognition.mockResolvedValueOnce({
      data: {
        summary: { total_earned: 0, this_month: 0, latest_title: null },
        accolades: [],
        badges: [],
        highlighted_moments: [
          {
            id: "h1",
            title: "Moment worth keeping",
            description: "You held space for a second student voice.",
            video_id: "v-good",
            href: "/videos/v-good?t=120",
          },
        ],
        spotlight_lessons: [],
      },
    });

    renderWithClient(<TeacherBadgesPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Personal lesson highlights/i).length).toBeGreaterThanOrEqual(1);
    });
    // Personal highlights show even when no Gold-Star is earned.
    expect(screen.getByText(/Moment worth keeping/i)).toBeInTheDocument();
    // The page must NOT imply personal highlights only appear after recognition.
    expect(screen.queryByText(/Highlighted moments will appear after recognition is awarded/i)).not.toBeInTheDocument();
    // The page should mention the Gold-Star section is separate from
    // personal highlights so teachers understand the distinction.
    expect(screen.getByText(/separate from personal lesson highlights/i)).toBeInTheDocument();
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 7. Defensive scan on blocked artifact fixture
  // -------------------------------------------------------------------------

  it("blocked artifact fixture renders zero known bad strings across pages", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: { coaching_artifact: BLOCKED_ARTIFACT, teacher_feedback: null },
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);
    await waitFor(() => {
      expect(screen.getByText(/feedback isn.t ready/i)).toBeInTheDocument();
    });
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 8. Legacy fallback works only when artifact is absent
  // -------------------------------------------------------------------------

  it("workspace falls back to legacy fields only when coaching_artifact is absent", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { missing_items: [], upload_ready: true },
        next_best_action: { id: "n1", title: "Open the latest lesson", description: "Legacy fallback action", href: "/my-lessons" },
        latest_lesson: {
          title: "Legacy lesson",
          subject: "Math",
          uploaded_at: "2026-05-27T00:00:00+00:00",
          summary: "Legacy summary line.",
          teacher_feedback: {
            latest_summary: {
              opening: "Legacy summary line.",
              strength: "You waited for a second voice.",
              growth_focus: "Try one partner check.",
              next_step: "Pause after a question.",
            },
          },
          // NOTE: no coaching_artifact key at all → legacy fallback path.
        },
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);
    await waitFor(() => {
      expect(screen.getByText(/Legacy summary line/i)).toBeInTheDocument();
    });
    // Legacy fallback continues to render the legacy strength/growth_focus
    // fields.
    expect(screen.getByText(/You waited for a second voice/i)).toBeInTheDocument();
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });
});
