import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { TrainingDashboard } from "@/components/dashboard/TrainingDashboard";
import { trainingApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  trainingApi: {
    supervisorSummary: jest.fn(),
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
    trainingApi.supervisorSummary.mockResolvedValue({
      data: {
        total_trainees: 12,
        active_placements: 10,
        observations_this_cycle: 7,
        required_per_trainee: 2,
        trainees_on_track: 8,
        trainees_at_risk: 3,
        trainees_not_started: 1,
        trainees: [
          { trainee_id: "t1", trainee_name: "Trainee One", school_site: "Metro Partner School", required: 2, completed: 1, status: "at_risk" },
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
