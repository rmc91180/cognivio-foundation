import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MasterAdminAIQualityPage } from "@/pages/MasterAdminAIQualityPage";
import { masterAdminApi } from "@/lib/api";

jest.mock("@/components/master-admin/MasterAdminPageScaffold", () => ({
  MasterAdminPageScaffold: ({ title, children }) => <div><h1>{title}</h1>{children}</div>,
  MasterAdminMetricGrid: ({ children }) => <div>{children}</div>,
  MasterAdminMetricCard: ({ label, value, hint }) => (
    <div>
      <div>{label}</div>
      <div>{value}</div>
      <div>{hint}</div>
    </div>
  ),
}));

jest.mock("@/lib/api", () => ({
  masterAdminApi: {
    aiQualityLatest: jest.fn(),
    aiQualityHistory: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe("MasterAdminAIQualityPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders no-data state when quality history is missing", async () => {
    masterAdminApi.aiQualityLatest.mockResolvedValue({ data: { no_data: true, scores: {}, thresholds: {}, failures: [], banned_phrases: [] } });
    masterAdminApi.aiQualityHistory.mockResolvedValue({ data: { items: [] } });

    renderWithClient(<MasterAdminAIQualityPage />);

    expect(await screen.findByText(/Quality history will appear here after the eval gate runs/i)).toBeInTheDocument();
  });

  it("renders sample quality score data", async () => {
    masterAdminApi.aiQualityLatest.mockResolvedValue({
      data: {
        run_at: "2026-05-15T10:00:00Z",
        git_sha: "abc123",
        triggered_by: "CI",
        passed: true,
        scores: {
          specificity: 0.92,
          evidence_grounding: 0.9,
          usefulness: 0.88,
          modality_discipline: 0.85,
          coach_voice: 0.91,
        },
        thresholds: {
          specificity: 0.7,
          evidence_grounding: 0.75,
          usefulness: 0.72,
          modality_discipline: 0.65,
          coach_voice: 0.8,
        },
        failures: [],
        banned_phrases: [],
      },
    });
    masterAdminApi.aiQualityHistory.mockResolvedValue({ data: { items: [{ run_at: "2026-05-15T10:00:00Z", passed: true }] } });

    renderWithClient(<MasterAdminAIQualityPage />);

    await waitFor(() => expect(screen.getByText("Coach voice")).toBeInTheDocument());
    expect(screen.getAllByText("0.91").length).toBeGreaterThan(0);
    expect(screen.getByText(/No banned phrases detected/i)).toBeInTheDocument();
  });
});
