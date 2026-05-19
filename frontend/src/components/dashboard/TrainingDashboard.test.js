import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainingDashboard } from "@/components/dashboard/TrainingDashboard";
import { adminWorkspaceApi, demoApi, onboardingApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  adminWorkspaceApi: {
    dashboard: jest.fn(),
    search: jest.fn(),
  },
  demoApi: {
    seed: jest.fn(),
  },
  onboardingApi: {
    status: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("TrainingDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onboardingApi.status.mockResolvedValue({
      data: { progress_pct: 100, counts: { reviewed_lessons: 1 }, next_step: { href: "/dashboard" } },
    });
    adminWorkspaceApi.search.mockResolvedValue({ data: { query: "", results: [] } });
    demoApi.seed.mockResolvedValue({ data: { counts: { teachers: 1, videos: 5 } } });
    adminWorkspaceApi.dashboard.mockResolvedValue({
      data: {
        demo_eligible: false,
        summary: {
          active_trainees: 12,
          reviewed_lessons: 7,
          open_coaching_tasks: 2,
          reports_ready: 1,
        },
        next_best_actions: [{ id: "schedule", title: "Plan a focused trainee observation", description: "Start with one useful touchpoint.", href: "/observation/new" }],
        teacher_attention: [{ teacher_id: "t1", teacher_name: "Trainee One", reason: "Needs a fresh observation.", href: "/observation/new?teacher_id=t1" }],
        recent_lessons: [],
        observation_gaps: [],
        reports: [],
        trends: [],
        recognition_candidates: [],
        gradebook_reminders: [],
      },
    });
  });

  it("renders supervisor-specific copy without school-admin sections", async () => {
    renderWithClient(<TrainingDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Supervisor Dashboard")).toBeInTheDocument();
    });

    expect(await screen.findByText("Trainees needing attention")).toBeInTheDocument();
    expect(screen.queryByText("Today’s coaching priorities")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill demo workspace" })).not.toBeInTheDocument();
  });

  it("allows eligible demo training admins to fill the workspace", async () => {
    const user = userEvent.setup();
    adminWorkspaceApi.dashboard.mockResolvedValueOnce({
      data: {
        demo_eligible: true,
        summary: {},
        next_best_actions: [],
        teacher_attention: [],
        recent_lessons: [],
        observation_gaps: [],
        reports: [],
        trends: [],
        recognition_candidates: [],
        gradebook_reminders: [],
      },
    });

    renderWithClient(<TrainingDashboard />);

    await user.click(await screen.findByRole("button", { name: "Fill demo workspace" }));

    expect(demoApi.seed).toHaveBeenCalledWith({ persona: "training", scope: "current_workspace" });
  });
});
