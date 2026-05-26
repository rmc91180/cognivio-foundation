import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { teacherApi, demoApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

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
    updateCoachingTask: jest.fn(),
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

describe("TeacherWorkspacePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.myDashboard.mockResolvedValue({
      data: {
        readiness: { missing_items: [] },
        next_best_action: { title: "Record or upload a lesson", description: "Start with one lesson recording.", href: "/record" },
        latest_lesson: null,
        highlights: [],
        action_items: [],
        trends: [],
        reflections: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });
    teacherApi.mySearch.mockResolvedValue({ data: { results: [] } });
  });

  it("renders teacher empty states without banned system copy", async () => {
    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText(/Your first lesson summary will appear here/i)).toBeInTheDocument();
    });

    const visibleText = document.body.textContent.toLowerCase();
    expect(findBannedCoachVoicePhrases(visibleText)).toEqual([]);
  });

  it("shows and uses the demo seed button only when eligible", async () => {
    const user = userEvent.setup();
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { missing_items: [{ id: "profile", label: "Finish your teacher profile", href: "/my-profile" }] },
        next_best_action: null,
        latest_lesson: null,
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        demo_eligible: true,
      },
    });
    demoApi.seed.mockResolvedValue({ data: { counts: { videos: 5, coaching_tasks: 2 } } });

    renderWithClient(<TeacherWorkspacePage />);

    expect((await screen.findAllByText("Finish your teacher profile")).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole("button", { name: "Fill my demo workspace" }));

    expect(demoApi.seed).toHaveBeenCalledWith({ persona: "teacher", scope: "current_teacher" });
  });

  it("shows only the next incomplete setup step and does not duplicate next best action", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: {
          setup_next_step: {
            id: "profile",
            code: "TEACHER_PROFILE_REQUIRED",
            label: "Finish your teacher profile",
            href: "/my-profile",
          },
          missing_items: [
            { id: "profile", code: "TEACHER_PROFILE_REQUIRED", label: "Finish your teacher profile", href: "/my-profile" },
          ],
        },
        next_best_action: { id: "profile", code: "TEACHER_PROFILE_REQUIRED", title: "Finish your teacher profile", description: "Duplicate setup.", href: "/my-profile" },
        latest_lesson: null,
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    expect((await screen.findAllByText("Finish your teacher profile")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Duplicate setup.")).not.toBeInTheDocument();
    expect(screen.queryByText("Review privacy consent")).not.toBeInTheDocument();
  });

  it("hides setup next step when readiness is complete", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { setup_next_step: null, missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: null,
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => expect(screen.queryByText("Setup next step")).not.toBeInTheDocument());
    expect(screen.queryByText("Ready to record")).not.toBeInTheDocument();
  });

  it("renders distinct coaching summary, highlight, action, recognition, and readiness without rubric leakage", async () => {
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { setup_next_step: null, missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: {
          title: "Fractions discussion",
          subject: "Math",
          uploaded_at: "2026-05-01T00:00:00Z",
          href: "/videos/video-1",
          teacher_feedback: {
            latest_summary: {
              opening: "You opened the discussion with a clear question.",
              strength: "You gave students time to build on one another's ideas.",
              growth_focus: "Try one follow-up before you explain.",
              next_step: "Ask who can add on to the first answer.",
            },
            recording_compliance: { ready_to_record: true, blockers: [] },
            growth_over_time: { available: false, items: [], empty_state: "After a few reviewed lessons, this space will show patterns." },
          },
        },
        highlights: [{ id: "h1", title: "Moment worth keeping", description: "Students built on one another's thinking.", href: "/videos/video-1?t=42" }],
        action_items: [{ id: "task-1", title: "Ask one follow-up", description: "Invite one more student voice.", href: "/my-coaching?task_id=task-1" }],
        reflections: [{ id: "r1", tried: "I tried the follow-up.", happened: "Students added more detail.", visibility: "private" }],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [{ id: "badge-1", title: "Strong Student Voice", description: "A moment worth celebrating." }] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    expect(await screen.findByText("Your latest coaching summary")).toBeInTheDocument();
    expect(screen.getByText("Moment worth keeping")).toBeInTheDocument();
    expect(screen.getByText("Gold-Star recognition")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    const visibleText = document.body.textContent;
    expect(findBannedCoachVoicePhrases(visibleText)).toEqual([]);
    expect(visibleText).not.toMatch(/\b(?:d1b|1a|1b|2b|3c)\b/i);
    expect(visibleText).not.toMatch(/\d+(?:\.\d+)?\/10/);
  });

  it("marks a coaching action tried from the workspace hero", async () => {
    const user = userEvent.setup();
    teacherApi.updateCoachingTask.mockResolvedValue({ data: { id: "task-1", status: "tried" } });
    teacherApi.myDashboard.mockResolvedValueOnce({
      data: {
        readiness: { setup_next_step: null, missing_items: [], upload_ready: true },
        next_best_action: null,
        latest_lesson: null,
        highlights: [],
        action_items: [{ id: "task-1", title: "Ask one follow-up", description: "Invite one more student voice.", href: "/my-coaching?task_id=task-1" }],
        trends: [],
        reflections: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        recognition: { items: [] },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherWorkspacePage />);

    await user.click(await screen.findByRole("button", { name: "I tried this" }));
    expect(teacherApi.updateCoachingTask).toHaveBeenCalledWith("task-1", { status: "tried" });
  });
});

