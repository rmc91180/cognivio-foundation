import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { TrainingDashboard } from "@/components/dashboard/TrainingDashboard";
import { reportApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  reportApi: {
    cohortSnapshot: jest.fn(),
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
    reportApi.cohortSnapshot.mockResolvedValue({
      data: {
        summary: {
          active_trainees: 12,
          completed_observations: 7,
          upcoming_observations: 2,
          trainees_on_track: 8,
          trainees_at_risk: 3,
          trainees_not_started: 1,
        },
        trainee_rows: [
          {
            trainee_id: "t1",
            trainee_name: "Trainee One",
            placement_site: "Metro Partner School",
            required_observations: 2,
            completed_observations: 1,
            status: "At risk",
            next_action: "Schedule observation",
          },
        ],
        upcoming_observations: [],
        recent_observations: [],
      },
    });
  });

  it("renders supervisor-specific copy without school-admin sections", async () => {
    renderWithClient(<TrainingDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Supervisor Dashboard")).toBeInTheDocument();
    });

    expect(await screen.findByText("Compliance table")).toBeInTheDocument();
    expect(screen.queryByText("Today’s coaching priorities")).not.toBeInTheDocument();
    expect(screen.queryByText("Recognition candidates")).not.toBeInTheDocument();
  });
});
