import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsentPage } from "@/pages/ConsentPage";
import { TeacherLessonsPage } from "@/pages/TeacherLessonsPage";
import { TeacherCoachingPage } from "@/pages/TeacherCoachingPage";
import TeacherBadgesPage from "@/pages/TeacherBadgesPage";
import api, { consentApi, teacherApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

const mockRefreshUser = jest.fn();

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "teacher-user-1", name: "Maya Patel", tenant_role: "teacher" },
    refreshUser: mockRefreshUser,
  }),
}));

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
  consentApi: {
    status: jest.fn(),
    grant: jest.fn(),
  },
  teacherApi: {
    myLessons: jest.fn(),
    myCoaching: jest.fn(),
    currentProfile: jest.fn(),
    updateCurrentProfile: jest.fn(),
  },
}));

const renderWithProviders = (ui, initialEntries = ["/"]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

describe("end-to-end app flow hotfix pages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshUser.mockResolvedValue({ id: "teacher-user-1", tenant_role: "teacher" });
  });

  it("submits privacy consent and refreshes the user session", async () => {
    consentApi.status.mockResolvedValue({ data: { consents: {}, all_granted: false } });
    consentApi.grant.mockResolvedValue({ data: { all_granted: true } });

    renderWithProviders(<ConsentPage />, ["/consent"]);

    fireEvent.click(await screen.findByLabelText(/Video recording/i));
    fireEvent.click(screen.getByLabelText(/AI analysis/i));
    fireEvent.click(screen.getByLabelText(/Data retention/i));
    fireEvent.click(screen.getByRole("button", { name: /I understand and consent/i }));

    await waitFor(() => {
      expect(consentApi.grant).toHaveBeenCalledTimes(3);
      expect(mockRefreshUser).toHaveBeenCalled();
    });
  });

  it("routes teacher lesson profile gate to the teacher profile setup page", async () => {
    teacherApi.myLessons.mockResolvedValue({
      data: {
        profile_required: true,
        privacy_profile_required: false,
        lessons: [],
      },
    });

    renderWithProviders(<TeacherLessonsPage />);

    const cta = await screen.findByRole("link", { name: /Complete teacher profile/i });
    expect(cta).toHaveAttribute("href", "/my-profile?returnTo=/my-lessons");
  });

  it("renders teacher lesson cards without banned system copy", async () => {
    teacherApi.myLessons.mockResolvedValue({
      data: {
        profile_required: false,
        privacy_profile_required: false,
        lessons: [
          {
            video_id: "video-1",
            title: "Small-group discussion",
            uploaded_at: "2026-05-01T10:00:00Z",
            status: "reviewed",
            summary: "You gave students time to explain their thinking before stepping in.",
            href: "/videos/video-1",
          },
        ],
      },
    });

    renderWithProviders(<TeacherLessonsPage />);

    expect(await screen.findByText(/Small-group discussion/i)).toBeInTheDocument();
    expect(findBannedCoachVoicePhrases(document.body.textContent.toLowerCase())).toEqual([]);
  });

  it("renders coaching empty state instead of a profile-loop placeholder", async () => {
    teacherApi.myCoaching.mockResolvedValue({
      data: {
        profile_required: false,
        active_tasks: [],
        shared_moments: [],
        reflections: [],
        messages: [],
      },
    });

    renderWithProviders(<TeacherCoachingPage />);

    expect(await screen.findByText(/Your coaching notes will appear here/i)).toBeInTheDocument();
  });

  it("renders recognition empty state from the canonical my-badges endpoint", async () => {
    api.get.mockResolvedValue({ data: { badges: [] } });

    renderWithProviders(<TeacherBadgesPage />);

    expect(await screen.findByText(/Recognition you earn will appear here/i)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/recognition/my-badges");
  });
});
