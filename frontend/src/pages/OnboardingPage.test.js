import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { useAuth } from "@/hooks/useAuth";
import { onboardingApi, teacherApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  onboardingApi: {
    status: jest.fn(),
  },
  teacherApi: {
    create: jest.fn(),
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

const schoolStatus = {
  workspace_mode: "school",
  progress_pct: 0,
  next_step: {
    id: "add_teachers",
    title: "Add your first teacher",
    description: "Add teachers so you can plan focused observations.",
    href: "/teachers",
    cta_label: "Add teacher",
  },
  counts: { teachers: 0, trainees: 0, reviewed_lessons: 0 },
  steps: [
    { id: "organization_profile", title: "Confirm your workspace", description: "Name the school.", status: "complete", href: "/school-setup" },
    { id: "add_teachers", title: "Add your first teacher", description: "Add teachers.", status: "incomplete", href: "/teachers", count: 0 },
  ],
};

describe("OnboardingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.create.mockResolvedValue({ data: {} });
  });

  it("renders empty school onboarding status and next step CTA", async () => {
    useAuth.mockReturnValue({ user: { id: "admin", role: "admin", tenant_role: "school_admin" } });
    onboardingApi.status.mockResolvedValue({ data: schoolStatus });

    renderWithClient(<OnboardingPage />);

    expect(await screen.findByText("Set up your first Cognivio observation")).toBeInTheDocument();
    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add teacher" })[0]).toHaveAttribute("href", "/teachers");
    expect(screen.queryByRole("link", { name: "Go to dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No data available/i)).not.toBeInTheDocument();
  });

  it("renders training-specific onboarding copy", async () => {
    useAuth.mockReturnValue({ user: { id: "training", role: "admin", tenant_role: "training_admin" } });
    onboardingApi.status.mockResolvedValue({
      data: {
        ...schoolStatus,
        workspace_mode: "training",
        next_step: { ...schoolStatus.next_step, title: "Add your first trainee", cta_label: "Add trainee" },
        steps: [{ id: "add_teachers", title: "Add your first trainee", description: "Add trainees.", status: "incomplete", href: "/teachers", count: 0 }],
      },
    });

    renderWithClient(<OnboardingPage />);

    expect(await screen.findByText("Set up your first trainee observation")).toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: "Add trainee" }))[0]).toHaveAttribute("href", "/teachers");
  });
});
