import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TeacherCoachingPage } from "@/pages/TeacherCoachingPage";
import { teacherApi } from "@/lib/api";
import { findBannedCoachVoicePhrases } from "@/lib/coachVoice";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/lib/api", () => ({
  teacherApi: {
    myCoaching: jest.fn(),
    createReflection: jest.fn(),
    updateCoachingTask: jest.fn(),
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

describe("TeacherCoachingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.myCoaching.mockResolvedValue({
      data: {
        readiness: { missing_items: [] },
        active_tasks: [
          {
            id: "task-1",
            title: "Ask one follow-up",
            body: "Invite one more student to build on the first answer.",
            video_href: "/videos/video-1?t=42",
            status: "open",
          },
        ],
        shared_moments: [{ comment_id: "c1", video_id: "video-1", timestamp_seconds: 42, body: "You paused long enough for another student voice.", href: "/videos/video-1?t=42" }],
        recommendations: [],
        suggested_improvements: [],
        teacher_reflections: [{ id: "r1", tried: "I tried a follow-up.", happened: "More students joined.", visibility: "shared_with_admin" }],
        next_best_action: null,
      },
    });
    teacherApi.createReflection.mockResolvedValue({ data: { ok: true } });
    teacherApi.updateCoachingTask.mockResolvedValue({ data: { id: "task-1", status: "tried" } });
  });

  it("renders coaching tasks and reflections without backend/rubric leakage", async () => {
    renderWithClient(<TeacherCoachingPage />);

    expect(await screen.findByText("Ask one follow-up")).toBeInTheDocument();
    expect(screen.getByText("Shared with admin")).toBeInTheDocument();
    expect(findBannedCoachVoicePhrases(document.body.textContent)).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\b(?:d1b|1a|1b|2b|3c)\b/i);
    expect(document.body.textContent).not.toMatch(/\d+(?:\.\d+)?\/10/);
  });

  it("sends reflection visibility and marks tried", async () => {
    const user = userEvent.setup();
    renderWithClient(<TeacherCoachingPage />);

    await user.click(await screen.findByRole("button", { name: "I tried this" }));
    expect(teacherApi.updateCoachingTask).toHaveBeenCalledWith("task-1", { status: "tried" });

    await user.click(screen.getByRole("button", { name: "Reflect" }));
    await user.type(screen.getByLabelText("Reflection"), "I tried the follow-up and heard one more idea.");
    await user.selectOptions(screen.getByLabelText("Visibility"), "shared_with_admin");
    await user.click(screen.getByRole("button", { name: "Save reflection" }));

    expect(teacherApi.createReflection).toHaveBeenCalledWith({
      text: "I tried the follow-up and heard one more idea.",
      task_id: "task-1",
      comment_id: undefined,
      video_id: undefined,
      visibility: "shared_with_admin",
    });
  });
});
