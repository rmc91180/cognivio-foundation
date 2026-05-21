import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { FrameworksPage } from "@/pages/FrameworksPage";
import { frameworkApi, recordingPolicyApi, teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  frameworkApi: {
    list: jest.fn(),
    get: jest.fn(),
    currentSelection: jest.fn(),
    saveSelection: jest.fn(),
    uploadRubric: jest.fn(),
    listCustomDomains: jest.fn(),
    createCustomDomain: jest.fn(),
    addCustomElement: jest.fn(),
    deleteCustomDomain: jest.fn(),
  },
  recordingPolicyApi: {
    list: jest.fn(),
    create: jest.fn(),
  },
  teacherApi: {
    list: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

describe("FrameworksPage baseline settings behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({
      user: { id: "admin-1", role: "admin", tenant_role: "school_admin" },
    });
    frameworkApi.currentSelection.mockResolvedValue({
      data: { framework_type: "danielson", selected_elements: [], priority_elements: [], focus_note: null },
    });
    frameworkApi.get.mockResolvedValue({ data: { domains: [] } });
    frameworkApi.listCustomDomains.mockResolvedValue({ data: { domains: [] } });
    teacherApi.list.mockResolvedValue({ data: [] });
    recordingPolicyApi.list.mockResolvedValue({ data: [] });
  });

  it("renders empty framework settings without crashing the settings page", async () => {
    frameworkApi.list.mockResolvedValue({
      data: {
        frameworks: [],
        empty_state: {
          title: "No frameworks configured yet",
          description: "Framework settings will appear here once a rubric or observation framework is added.",
        },
      },
    });

    renderWithClient(<FrameworksPage />);

    expect(await screen.findByText("No frameworks configured yet")).toBeInTheDocument();
    expect(screen.getByText(/Framework settings will appear here/i)).toBeInTheDocument();
  });

  it("contains framework load failures to the framework section", async () => {
    frameworkApi.list.mockRejectedValue(new Error("frameworks failed"));

    renderWithClient(<FrameworksPage />);

    expect(await screen.findByText("frameworksPage.frameworksLoadFailed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "frameworksPage.retryFrameworks" })).toBeInTheDocument();
    expect(screen.getByText("frameworksPage.recordingCompliancePolicy")).toBeInTheDocument();
  });

  it("renders a fallback empty state when framework payload omits optional fields", async () => {
    frameworkApi.list.mockResolvedValue({ data: {} });

    renderWithClient(<FrameworksPage />);

    expect(await screen.findByText("Framework settings are ready when you need them.")).toBeInTheDocument();
    expect(screen.queryByText("frameworksPage.frameworksLoadFailed")).not.toBeInTheDocument();
  });

  it("renders available framework choices for admin settings", async () => {
    frameworkApi.list.mockResolvedValue({
      data: {
        frameworks: [
          { type: "danielson", name: "Danielson Framework", domain_count: 4 },
          { type: "training_competency", name: "Training Competency Framework", domain_count: 3 },
        ],
      },
    });

    renderWithClient(<FrameworksPage />);

    expect(await screen.findByRole("button", { name: /Danielson Framework/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Training Competency Framework/i })).toBeInTheDocument();
  });
});
