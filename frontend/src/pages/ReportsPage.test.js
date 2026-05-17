import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReportsPage } from "@/pages/ReportsPage";
import { reportApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  reportApi: {
    coachingSnapshot: jest.fn(),
    cohortSnapshot: jest.fn(),
    exportCoachingSnapshotCsv: jest.fn(),
    exportCohortSnapshotCsv: jest.fn(),
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

describe("ReportsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the school coaching snapshot and CSV export action", async () => {
    useAuth.mockReturnValue({ user: { id: "admin", tenant_role: "school_admin", role: "admin" } });
    reportApi.coachingSnapshot.mockResolvedValue({
      data: {
        summary: {
          reviewed_lessons: 4,
          teachers_with_feedback: 3,
          open_coaching_tasks: 2,
          completed_coaching_tasks: 1,
          recognition_earned: 1,
          observation_gaps: 1,
        },
        patterns: [{ id: "p1", title: "Student discussion is showing up as a common growth area.", description: "Three teachers are ready for focused support.", recommended_action: "Plan one observation." }],
        teacher_rows: [{ teacher_id: "t1", teacher_name: "Avery Stone", reviewed_lessons: 2, open_tasks: 1, latest_summary: "You gave students room to explain their thinking.", next_action: "Review the latest lesson feedback." }],
      },
    });

    renderWithClient(<ReportsPage />);

    expect(await screen.findByText("Coaching Snapshot")).toBeInTheDocument();
    expect(await screen.findByText("Teacher rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("renders the training cohort snapshot", async () => {
    useAuth.mockReturnValue({ user: { id: "training", tenant_role: "training_admin", role: "admin" } });
    reportApi.cohortSnapshot.mockResolvedValue({
      data: {
        summary: {
          active_trainees: 8,
          completed_observations: 5,
          upcoming_observations: 2,
          trainees_at_risk: 1,
          trainees_not_started: 2,
        },
        trainee_rows: [{ trainee_id: "tr1", trainee_name: "Trainee One", placement_site: "Partner School", status: "At risk", latest_summary: "You opened with a clear purpose.", next_action: "Schedule observation" }],
        recent_observations: [],
      },
    });

    renderWithClient(<ReportsPage />);

    expect(await screen.findByText("Cohort Snapshot")).toBeInTheDocument();
    expect(await screen.findByText("Trainee status")).toBeInTheDocument();
    expect(screen.queryByText(/school-wide/i)).not.toBeInTheDocument();
  });

  it("redirects teachers away from admin reports", () => {
    useAuth.mockReturnValue({ user: { id: "teacher", tenant_role: "teacher", role: "teacher" } });

    renderWithClient(<ReportsPage />);

    expect(reportApi.coachingSnapshot).not.toHaveBeenCalled();
    expect(reportApi.cohortSnapshot).not.toHaveBeenCalled();
  });
});
