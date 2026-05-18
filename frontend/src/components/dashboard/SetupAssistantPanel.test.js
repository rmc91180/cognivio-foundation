import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { SetupAssistantPanel } from "@/components/dashboard/SetupAssistantPanel";
import { onboardingApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
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

describe("SetupAssistantPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the next setup step for incomplete workspaces", async () => {
    onboardingApi.status.mockResolvedValue({
      data: {
        progress_pct: 40,
        counts: { reviewed_lessons: 0 },
        next_step: {
          title: "Plan a focused observation",
          description: "Choose what Cognivio should pay attention to before upload.",
          href: "/observation/new",
          cta_label: "Plan observation",
        },
      },
    });

    renderWithClient(<SetupAssistantPanel mode="school" />);

    expect(await screen.findByText("Setup assistant")).toBeInTheDocument();
    expect(screen.getByText("Next step: Plan a focused observation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute("href", "/onboarding");
  });

  it("hides when setup is complete and feedback exists", async () => {
    onboardingApi.status.mockResolvedValue({
      data: { progress_pct: 100, counts: { reviewed_lessons: 1 }, next_step: { href: "/dashboard" } },
    });

    renderWithClient(<SetupAssistantPanel mode="school" />);

    await waitFor(() => expect(onboardingApi.status).toHaveBeenCalled());
    expect(screen.queryByText("Setup assistant")).not.toBeInTheDocument();
  });
});
