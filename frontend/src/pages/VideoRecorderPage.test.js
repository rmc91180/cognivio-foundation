import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { VideoRecorderPage } from "@/pages/VideoRecorderPage";
import api, { teacherApi, videoApi } from "@/lib/api";

jest.mock("@/components/LayoutShell", () => ({
  LayoutShell: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/components/VideoRecorder", () => ({
  VideoRecorder: ({ onRecordingReady }) => (
    <button
      type="button"
      onClick={() =>
        onRecordingReady(new Blob(["recorded"], { type: "video/webm" }), "blob:recorded")
      }
    >
      Mock recording ready
    </button>
  ),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "teacher-user-1", teacher_id: "teacher-1", tenant_role: "teacher" },
  }),
}));

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
  teacherApi: {
    currentProfile: jest.fn(),
    list: jest.fn(),
  },
  videoApi: {
    upload: jest.fn(),
  },
}));

const readyProfile = {
  profile: {
    id: "teacher-1",
    subject: "Math",
    primary_subject: "Math",
    class_section: "Period 1",
  },
  readiness: {
    privacy_consent_complete: true,
    consent_complete: true,
    teacher_profile_complete: true,
    privacy_reference_images_ready: true,
    privacy_reference_images_count: 4,
    privacy_reference_images_required_count: 4,
    upload_ready: true,
    blockers: [],
  },
};

const renderWithClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VideoRecorderPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("VideoRecorderPage readiness and upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teacherApi.currentProfile.mockResolvedValue({ data: readyProfile });
    teacherApi.list.mockResolvedValue({ data: [] });
    api.get.mockResolvedValue({ data: [] });
    videoApi.upload.mockResolvedValue({ data: { id: "video-1" } });
  });

  it("preserves the existing classroom video file upload flow", async () => {
    const user = userEvent.setup();
    renderWithClient();

    const file = new File(["video"], "lesson.mp4", { type: "video/mp4" });
    await user.upload(await screen.findByLabelText("Choose video file"), file);
    expect(screen.getByText("lesson.mp4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /uploadQueue/i }));

    await waitFor(() => expect(videoApi.upload).toHaveBeenCalledTimes(1));
    const formData = videoApi.upload.mock.calls[0][0];
    expect(formData.get("file").name).toBe("lesson.mp4");
  });

  it("keeps browser recording upload on the same readiness-gated upload path", async () => {
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "Mock recording ready" }));
    await user.click(screen.getByRole("button", { name: /uploadQueue/i }));

    await waitFor(() => expect(videoApi.upload).toHaveBeenCalledTimes(1));
    const formData = videoApi.upload.mock.calls[0][0];
    expect(formData.get("file").name).toMatch(/^class-recording\./);
  });

  it("blocks upload with the exact missing readiness requirement and keeps selected file", async () => {
    const user = userEvent.setup();
    teacherApi.currentProfile.mockResolvedValueOnce({
      data: {
        ...readyProfile,
        readiness: {
          ...readyProfile.readiness,
          privacy_consent_complete: false,
          consent_complete: false,
          upload_ready: false,
          blockers: [
            {
              code: "PRIVACY_CONSENT_REQUIRED",
              message: "Complete privacy consent before uploading videos.",
              route: "/consent",
            },
          ],
        },
      },
    });

    renderWithClient();

    const file = new File(["video"], "blocked-lesson.mp4", { type: "video/mp4" });
    await user.upload(await screen.findByLabelText("Choose video file"), file);
    await user.click(screen.getByRole("button", { name: /uploadQueue/i }));

    await waitFor(() =>
      expect(screen.getAllByText("Complete privacy consent before uploading videos.").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("blocked-lesson.mp4")).toBeInTheDocument();
    expect(videoApi.upload).not.toHaveBeenCalled();
  });
});
