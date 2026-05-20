import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { consentApi } from "@/lib/api";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  consentApi: {
    status: jest.fn(),
  },
}));

const renderProtectedRoute = (user, initialPath = "/dashboard") => {
  useAuth.mockReturnValue({
    user,
    initializing: false,
    loading: false,
    isLoading: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route
            path={initialPath}
            element={
              <ProtectedRoute allowedTenantRoles={[user.tenant_role]}>
                <div>Protected page shell</div>
              </ProtectedRoute>
            }
          />
          <Route path="/onboarding" element={<div>Onboarding screen</div>} />
          <Route path="/consent" element={<div>Consent screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("ProtectedRoute baseline routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consentApi.status.mockResolvedValue({ data: { all_granted: true } });
  });

  it("does not hijack school admin dashboard access to onboarding", async () => {
    renderProtectedRoute({
      id: "admin-1",
      tenant_role: "school_admin",
      role: "admin",
      approval_status: "approved",
    });

    expect(await screen.findByText("Protected page shell")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding screen")).not.toBeInTheDocument();
  });

  it("does not hijack training admin dashboard access to onboarding", async () => {
    renderProtectedRoute({
      id: "training-1",
      tenant_role: "training_admin",
      role: "admin",
      approval_status: "approved",
    });

    expect(await screen.findByText("Protected page shell")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding screen")).not.toBeInTheDocument();
  });

  it("still sends teachers to consent when consent is required", async () => {
    consentApi.status.mockResolvedValue({ data: { all_granted: false } });
    renderProtectedRoute({
      id: "teacher-1",
      tenant_role: "teacher",
      role: "teacher",
      approval_status: "approved",
    }, "/my-workspace");

    await waitFor(() => expect(screen.getByText("Consent screen")).toBeInTheDocument());
  });
});
