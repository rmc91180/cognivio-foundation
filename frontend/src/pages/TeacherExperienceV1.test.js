import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { LayoutShell } from "@/components/LayoutShell";

jest.mock("@/components/BrandMark", () => ({
  BrandMark: () => <div>Cognivio</div>,
}));

jest.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));

jest.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

jest.mock("@/components/OfflineBanner", () => ({
  OfflineBanner: () => null,
}));

jest.mock("@/components/ProductTourOverlay", () => ({
  ProductTourOverlay: () => null,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "teacher-user", name: "Maya Patel", email: "maya@example.com", tenant_role: "teacher" },
    logout: jest.fn(),
    refreshUser: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  masterAdminApi: {
    organizations: jest.fn(),
    organizationDetail: jest.fn(),
  },
}));

const renderShell = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LayoutShell>
          <div>Teacher route content</div>
        </LayoutShell>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("Teacher Experience v1 navigation", () => {
  it("shows the five canonical teacher tabs", () => {
    renderShell();
    const firstHref = (name) => screen.getAllByRole("link", { name })[0].getAttribute("href");
    expect(firstHref(/My Workspace/i)).toBe("/my-workspace");
    expect(firstHref(/^Lessons$/i)).toBe("/my-lessons");
    expect(firstHref(/^Coaching$/i)).toBe("/my-coaching");
    expect(firstHref(/^Recognition$/i)).toBe("/my-badges");
    expect(firstHref(/Teacher Profile/i)).toBe("/my-profile");
  });
});
