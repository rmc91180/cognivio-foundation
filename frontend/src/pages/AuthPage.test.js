import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPage } from "@/pages/AuthPage";
import { authApi } from "@/lib/api";

const mockRequestAccessAsync = jest.fn();

jest.mock("@/lib/runtimeConfig", () => ({
  runtimeConfig: {
    backendUrl: "https://api.example.test",
    demoMode: false,
    registrationApprovalRequired: true,
  },
}));

jest.mock("@/components/BrandMark", () => ({
  BrandMark: () => <div>Cognivio</div>,
}));

jest.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div />,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    initializing: false,
    login: jest.fn(),
    register: jest.fn(),
    requestAccessAsync: mockRequestAccessAsync,
    requestPasswordResetAsync: jest.fn(),
    confirmPasswordResetAsync: jest.fn(),
    loggingIn: false,
    registering: false,
    requestingAccess: false,
    requestingPasswordReset: false,
    confirmingPasswordReset: false,
  }),
}));

jest.mock("@/lib/api", () => ({
  authApi: {
    institutionLookup: jest.fn(),
  },
}));

const renderAuthPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <AuthPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const fillSignupForm = () => {
  fireEvent.click(screen.getByRole("button", { name: "auth.signUpTab" }));
  fireEvent.change(screen.getByLabelText("auth.schoolOrganizationName"), {
    target: { value: "Sunrise Network" },
  });
  fireEvent.change(screen.getByLabelText("auth.schoolName"), {
    target: { value: "Sunrise Elementary" },
  });
  fireEvent.change(screen.getByLabelText("auth.name"), {
    target: { value: "New Teacher" },
  });
  fireEvent.change(screen.getByLabelText("auth.email"), {
    target: { value: "new.teacher@example.com" },
  });
  fireEvent.change(screen.getByLabelText("auth.password"), {
    target: { value: "StrongPassword123" },
  });
};

describe("AuthPage request-access lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authApi.institutionLookup.mockResolvedValue({ data: { suggestions: [] } });
  });

  it("shows success when the request persists but notification delivery warns", async () => {
    mockRequestAccessAsync.mockResolvedValue({
      data: {
        ok: true,
        status: "pending",
        notification: {
          sent: false,
          warning: "notification_delivery_failed",
        },
      },
    });

    renderAuthPage();
    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "auth.signUpCta" }));

    expect(await screen.findByText("Access request submitted")).toBeInTheDocument();
    expect(screen.getByText(/Access request received/i)).toBeInTheDocument();
    expect(mockRequestAccessAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new.teacher@example.com",
        role: "teacher",
        organization_type: "school",
        organization_name: "Sunrise Network",
        school_name: "Sunrise Elementary",
      })
    );
  });

  it("shows the backend lifecycle reason instead of a generic failure", async () => {
    mockRequestAccessAsync.mockRejectedValue({
      response: {
        data: {
          detail: {
            reason_code: "access_request_already_pending",
          },
        },
      },
    });

    renderAuthPage();
    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "auth.signUpCta" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/already pending/i);
    });
  });
});
