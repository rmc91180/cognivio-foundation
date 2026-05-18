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
          demo_mode: true,
          railway_environment_name: "staging",
          frontend_url_configured: false,
          backend_public_base_url_configured: true,
        },
        dependencies: { mongodb: "healthy", r2: "unknown", resend: "healthy", openai: "healthy" },
        demo_data: { k12_seeded: true, training_seeded: false, last_reset_at: null },
        quality: { latest_quality_gate_passed: true, coach_voice_score: 0.92 },
        product_flow: { dashboard_intelligence_available: true, video_comments_available: true, mobile_upload_available: true, reports_available: true },
        warnings: ["Frontend URL is not configured in the backend environment."],
      },
    });

    renderWithClient(<InternalReadinessPanel />);

    expect(await screen.findByText("Internal readiness")).toBeInTheDocument();
    expect(screen.getAllByText("Dependencies").length).toBeGreaterThan(0);
    expect(screen.getByText("Quality gate")).toBeInTheDocument();
    expect(screen.queryByText(/api_key/i)).not.toBeInTheDocument();
  });
});
