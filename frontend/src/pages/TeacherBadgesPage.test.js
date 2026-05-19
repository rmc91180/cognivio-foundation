import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeacherBadgesPage } from "@/pages/TeacherBadgesPage";
import { demoApi, teacherApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  teacherApi: {
    myRecognition: jest.fn(),
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

describe("TeacherBadgesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    demoApi.seed.mockResolvedValue({ data: { counts: {} } });
  });

  it("renders an empty recognition payload without a red error", async () => {
    teacherApi.myRecognition.mockResolvedValue({
      data: {
        badges: [],
        accolades: [],
        highlighted_moments: [],
        spotlight_lessons: [],
        share_cards: [],
        summary: { total_earned: 0, this_month: 0, latest_title: null },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherBadgesPage />);

    expect(await screen.findByText("Recognition you earn will appear here.")).toBeInTheDocument();
    expect(screen.queryByText("Recognition could not be opened")).not.toBeInTheDocument();
  });

  it("renders recognition with missing optional image and share fields", async () => {
    teacherApi.myRecognition.mockResolvedValue({
      data: {
        badges: [],
        accolades: [{ id: "badge-1", title: "Strong Student Voice", description: "Students had space to build on one another's thinking." }],
        highlighted_moments: [],
        spotlight_lessons: [],
        share_cards: [],
        summary: { total_earned: 1, this_month: 1, latest_title: "Strong Student Voice" },
        demo_eligible: false,
      },
    });

    renderWithClient(<TeacherBadgesPage />);

    expect((await screen.findAllByText("Strong Student Voice")).length).toBeGreaterThan(0);
  });
});
