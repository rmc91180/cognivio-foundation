import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { SchoolAdminPilotDashboard } from "@/components/dashboard/SchoolAdminPilotDashboard";
import { dashboardApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  dashboardApi: {
    intelligence: jest.fn(),
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
  });

  it("renders priority cards and plain-language patterns from dashboard intelligence", async () => {
    dashboardApi.intelligence.mockResolvedValue({
      data: {
        cycle_summary: {
          reviewed_lessons: 3,
          teachers_observed: 2,
          open_coaching_tasks: 1,
          recognition_count: 1,
          days_remaining_in_cycle: 12,
          coverage_pct: 66,
        },
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
        patterns: [
          {
            id: "student-discussion",
            title: "Student discussion is showing up as a common growth area.",
            description: "Three teachers have recent lesson feedback pointing toward student discussion.",
            recommended_action: "Plan one short observation focused on student discussion.",
            severity: "warning",
            affected_teacher_names: ["Avery Stone"],
          },
        ],
        recent_lessons: [],
        observation_gaps: [{ teacher_id: "t1", teacher_name: "Avery Stone", days_since_last_observation: 75, recommended_href: "/observation/new?teacher_id=t1" }],
        highlights: [],
      },
    });

    renderWithClient(<SchoolAdminPilotDashboard />);

    await waitFor(() => expect(screen.getByText("School Dashboard")).toBeInTheDocument());
    expect(await screen.findByText("Teachers ready for a fresh observation")).toBeInTheDocument();
    expect(screen.getByText("Student discussion is showing up as a common growth area.")).toBeInTheDocument();
    const planLinks = screen.getAllByRole("link", { name: "Plan observation" });
    expect(planLinks.some((link) => link.getAttribute("href") === "/observation/new?teacher_id=t1")).toBe(true);
  });

  it("renders a friendly empty intelligence state", async () => {
    dashboardApi.intelligence.mockResolvedValue({
      data: {
        cycle_summary: {},
        priority_cards: [],
        patterns: [],
        recent_lessons: [],
        observation_gaps: [],
        highlights: [],
      },
    });

    renderWithClient(<SchoolAdminPilotDashboard />);

    expect(await screen.findByText("Priorities will appear as lesson feedback builds.")).toBeInTheDocument();
    expect(screen.queryByText(/No data available/i)).not.toBeInTheDocument();
  });
});
