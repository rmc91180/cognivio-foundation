import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { teacherApi, demoApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Maya Patel", tenant_role: "teacher" } }),
}));

jest.mock("@/lib/api", () => ({
  teacherApi: {
    myDashboard: jest.fn(),
    mySearch: jest.fn(),
  },
  demoApi: {
    seed: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

describe("TeacherWorkspacePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.myDashboard.mockResolvedValue({
      data: {
        readiness: { missing_items: [] },
        next_best_action: { title: "Record or upload a lesson", description: "Start with one lesson recording.", href: "/record" },
        latest_lesson: null,
        highlights: [],
        action_items: [],
        trends: [],
        schedule: [],
        gradebook_reminders: [],
        reports: [],
        demo_eligible: false,
      },
    });
    teacherApi.mySearch.mockResolvedValue({ data: { results: [] } });
  });

  it("renders teacher empty states without banned system copy", async () => {
    renderWithClient(<TeacherWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText(/Your first lesson summary will appear here/i)).toBeInTheDocument();
    });

    const visibleText = document.body.textContent.toLowerCase();
    expect(findBannedCoachVoicePhrases(visibleText)).toEqual([]);
  });
});
