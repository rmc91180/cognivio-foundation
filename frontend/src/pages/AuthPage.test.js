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
        password: "StrongPassword123",
        name: "New Teacher",
        role: "teacher",
        organization_type: "school",
        organization_name: "Sunrise Network",
        school_name: "Sunrise Elementary",
      })
    );
  });

  it("uses backend request-access field names exactly and shows the same canonical summary values", async () => {
    mockRequestAccessAsync.mockResolvedValue({ data: { ok: true, status: "pending" } });

    renderAuthPage();
    fillSignupForm();

    expect(screen.getByText("New Teacher")).toBeInTheDocument();
    expect(screen.getByText("new.teacher@example.com")).toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    await waitFor(() => expect(mockRequestAccessAsync).toHaveBeenCalledTimes(1));
    expect(Object.keys(mockRequestAccessAsync.mock.calls[0][0]).sort()).toEqual([
      "email",
      "name",
      "organization_name",
      "organization_type",
      "password",
      "role",
      "school_name",
    ]);
  });

  it("blocks missing name, email, or password before calling request-access", async () => {
    renderAuthPage();
    fireEvent.click(screen.getByRole("button", { name: "auth.signUpTab" }));
    fireEvent.change(screen.getByLabelText("auth.schoolOrganizationName"), {
      target: { value: "Sunrise Network" },
    });
    fireEvent.change(screen.getByLabelText("auth.schoolName"), {
      target: { value: "Sunrise Elementary" },
    });

    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    expect(mockRequestAccessAsync).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please complete your name, email, and password before submitting."
    );
  });

  it("reconciles browser-autofilled DOM values before request-access submit", async () => {
    mockRequestAccessAsync.mockResolvedValue({ data: { ok: true, status: "pending" } });
    renderAuthPage();
    fireEvent.click(screen.getByRole("button", { name: "auth.signUpTab" }));

    const setDomValue = (label, value) => {
      const input = screen.getByLabelText(label);
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor.set.call(input, value);
    };

    setDomValue("auth.schoolOrganizationName", "Autofill Network");
    setDomValue("auth.schoolName", "Autofill Elementary");
    setDomValue("auth.name", "Autofill Teacher");
    setDomValue("auth.email", "autofill.teacher@example.com");
    setDomValue("auth.password", "AutofilledPassword123");

    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    await waitFor(() => expect(mockRequestAccessAsync).toHaveBeenCalledTimes(1));
    expect(mockRequestAccessAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "autofill.teacher@example.com",
        password: "AutofilledPassword123",
        name: "Autofill Teacher",
        organization_name: "Autofill Network",
        school_name: "Autofill Elementary",
      })
    );
  });

  it("preserves identity fields when navigating between login and signup", async () => {
    mockRequestAccessAsync.mockResolvedValue({ data: { ok: true, status: "pending" } });
    renderAuthPage();
    fillSignupForm();

    fireEvent.click(screen.getByRole("button", { name: "auth.loginTab" }));
    fireEvent.click(screen.getByRole("button", { name: "auth.signUpTab" }));
    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    await waitFor(() => expect(mockRequestAccessAsync).toHaveBeenCalledTimes(1));
    expect(mockRequestAccessAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new.teacher@example.com",
        password: "StrongPassword123",
        name: "New Teacher",
      })
    );
  });

  it("submits a complete payload through the native form submit path", async () => {
    mockRequestAccessAsync.mockResolvedValue({ data: { ok: true, status: "pending" } });

    renderAuthPage();
    fillSignupForm();
    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    await waitFor(() => expect(mockRequestAccessAsync).toHaveBeenCalledTimes(1));
    expect(mockRequestAccessAsync.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        email: "new.teacher@example.com",
        password: "StrongPassword123",
        name: "New Teacher",
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

  it("shows backend 422 missing-field validation clearly and preserves input", async () => {
    mockRequestAccessAsync.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            { loc: ["body", "email"], msg: "Field required", type: "missing" },
            { loc: ["body", "password"], msg: "Field required", type: "missing" },
            { loc: ["body", "name"], msg: "Field required", type: "missing" },
          ],
        },
      },
    });

    renderAuthPage();
    fillSignupForm();
    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please complete your name, email, and password before submitting."
    );
    expect(screen.getByLabelText("auth.email")).toHaveValue("new.teacher@example.com");
    expect(screen.getByLabelText("auth.name")).toHaveValue("New Teacher");
  });

  it("shows API unreachable copy for network failures", async () => {
    mockRequestAccessAsync.mockRejectedValue(new Error("Network Error"));

    renderAuthPage();
    fillSignupForm();
    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach Cognivio API from this site. Please open app.cognivio.live and try again."
    );
  });

  it("does not write the password to console output during request-access submit", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRequestAccessAsync.mockResolvedValue({ data: { ok: true, status: "pending" } });

    renderAuthPage();
    fillSignupForm();
    fireEvent.submit(screen.getByRole("button", { name: "auth.signUpCta" }).closest("form"));

    await waitFor(() => expect(mockRequestAccessAsync).toHaveBeenCalledTimes(1));
    const output = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].flat().join(" ");
    expect(output).not.toContain("StrongPassword123");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
