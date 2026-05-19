import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchoolAdminPilotDashboard } from "@/components/dashboard/SchoolAdminPilotDashboard";
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

describe("SchoolAdminPilotDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onboardingApi.status.mockResolvedValue({
      data: { progress_pct: 100, counts: { reviewed_lessons: 1 }, next_step: { href: "/dashboard" } },
    });
    adminWorkspaceApi.search.mockResolvedValue({ data: { query: "", results: [] } });
    demoApi.seed.mockResolvedValue({ data: { counts: { teachers: 1, videos: 5 } } });
  });

  it("renders priority cards and plain-language patterns from dashboard intelligence", async () => {
    adminWorkspaceApi.dashboard.mockResolvedValue({
      data: {
        demo_eligible: true,
        summary: {
          active_teachers: 3,
          reviewed_lessons: 3,
          open_coaching_tasks: 1,
          reports_ready: 1,
        },
        next_best_actions: [{ id: "follow-up", title: "Follow up on active coaching", description: "One teacher has a coaching item ready.", href: "/coaching", cta_label: "Open coaching" }],
        priority_cards: [
          {
            id: "gap",
            type: "observation_gap",
            title: "Teachers ready for a fresh observation",
            summary: "Two teachers would benefit from a focused visit.",
            count: 2,
            severity: "warning",
            cta_label: "Plan observation",
            cta_href: "/observation/new",
          },
        ],
        teacher_attention: [{ teacher_id: "t1", teacher_name: "Avery Stone", reason: "Needs a fresh observation this cycle.", href: "/observation/new?teacher_id=t1" }],
        recent_lessons: [],
        observation_gaps: [{ teacher_id: "t1", teacher_name: "Avery Stone", days_since_last_observation: 75, recommended_href: "/observation/new?teacher_id=t1" }],
        coaching_activity: [],
        recognition_candidates: [],
        gradebook_reminders: [],
        reports: [],
        trends: [],
      },
    });

    renderWithClient(<SchoolAdminPilotDashboard />);

    await waitFor(() => expect(screen.getByText("School Dashboard")).toBeInTheDocument());
    expect(await screen.findByText("Teachers ready for a fresh observation")).toBeInTheDocument();
    expect(screen.getAllByText("Avery Stone").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Fill demo workspace" })).toBeInTheDocument();
  });

  it("renders a friendly empty intelligence state", async () => {
    adminWorkspaceApi.dashboard.mockResolvedValue({
      data: {
        summary: {},
        next_best_actions: [],
        priority_cards: [],
        teacher_attention: [],
        recent_lessons: [],
        observation_gaps: [],
        coaching_activity: [],
        recognition_candidates: [],
        gradebook_reminders: [],
        reports: [],
        trends: [],
        demo_eligible: false,
      },
    });

    renderWithClient(<SchoolAdminPilotDashboard />);

    expect(await screen.findByText("Priorities will appear as lesson feedback builds.")).toBeInTheDocument();
    expect(screen.queryByText(/No data available/i)).not.toBeInTheDocument();
  });

  it("fills a demo workspace only when the backend marks it eligible", async () => {
    const user = userEvent.setup();
    adminWorkspaceApi.dashboard.mockResolvedValue({
      data: {
        demo_eligible: true,
        summary: {},
        next_best_actions: [],
        priority_cards: [],
        teacher_attention: [],
        recent_lessons: [],
        observation_gaps: [],
        coaching_activity: [],
        recognition_candidates: [],
        gradebook_reminders: [],
        reports: [],
        trends: [],
      },
    });

    renderWithClient(<SchoolAdminPilotDashboard />);

    await user.click(await screen.findByRole("button", { name: "Fill demo workspace" }));

    expect(demoApi.seed).toHaveBeenCalledWith({ persona: "k12", scope: "current_workspace" });
  });
});
