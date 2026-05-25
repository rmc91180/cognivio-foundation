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
        schedule: [],
        gradebook_reminders: [],
        reports: [],
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

    expect(await screen.findByText("Finish your teacher profile")).toBeInTheDocument();
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

    expect(await screen.findByText("Finish your teacher profile")).toBeInTheDocument();
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
});
