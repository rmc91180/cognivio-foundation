import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { TeacherWorkspacePage } from "@/pages/TeacherWorkspacePage";
import { teacherWorkspaceApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Maya Patel", tenant_role: "teacher" } }),
}));

jest.mock("@/lib/api", () => ({
  teacherWorkspaceApi: {
    latestLesson: jest.fn(),
    coachingTasks: jest.fn(),
    taskReflection: jest.fn(),
    reflections: jest.fn(),
    recognition: jest.fn(),
  },
}));

const renderWithClient = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe("TeacherWorkspacePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherWorkspaceApi.latestLesson.mockResolvedValue({ data: { lesson: null } });
    teacherWorkspaceApi.coachingTasks.mockResolvedValue({ data: { tasks: [] } });
    teacherWorkspaceApi.recognition.mockResolvedValue({ data: { badges: [] } });
    teacherWorkspaceApi.reflections.mockResolvedValue({ data: { reflections: [] } });
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
