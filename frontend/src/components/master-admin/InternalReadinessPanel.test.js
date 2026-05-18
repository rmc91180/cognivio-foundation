import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { InternalReadinessPanel } from "@/components/master-admin/InternalReadinessPanel";
import { masterAdminApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  masterAdminApi: {
    internalReadiness: jest.fn(),
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

describe("InternalReadinessPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders readiness sections with sanitized states", async () => {
    masterAdminApi.internalReadiness.mockResolvedValue({
      data: {
        environment: {
          demo_mode: false,
          demo_mode_status: "disabled",
          demo_reset_controls_status: "disabled",
          railway_environment_name: "staging",
          frontend_url_configured: false,
          backend_public_base_url_configured: true,
        },
        dependencies: { mongodb: "healthy", r2: "unknown", resend: "healthy", openai: "healthy" },
        demo_data: {
          k12_seeded: true,
          training_seeded: false,
          k12_seeded_status: "available",
          training_seeded_status: "not_seeded",
          reset_controls_status: "disabled",
          last_reset_at: null,
        },
        quality: { latest_quality_gate_passed: null, latest_quality_gate_status: "unknown", coach_voice_score: null },
        product_flow: { dashboard_intelligence_available: true, video_comments_available: true, mobile_upload_available: true, reports_available: true },
        warnings: ["Frontend URL is not configured in the backend environment."],
      },
    });

    renderWithClient(<InternalReadinessPanel />);

    expect(await screen.findByText("Internal readiness")).toBeInTheDocument();
    expect(screen.getAllByText("Dependencies").length).toBeGreaterThan(0);
    expect(screen.getByText("Quality gate")).toBeInTheDocument();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Not seeded")).toBeInTheDocument();
    expect(screen.queryByText(/api_key/i)).not.toBeInTheDocument();
  });
});
