/**
 * PR C7 frontend tests for the admin teacher-feedback review card.
 *
 * Verifies:
 *   1. The card renders the teacher_feedback_admin_status pill.
 *   2. Approve calls adminCoachingApi.upsertReview with admin_approved.
 *   3. Hide requires a reason and calls with admin_hidden + hidden_reason.
 *   4. Request revision requires a reason and calls with revision_requested.
 *   5. The card never renders banned strings from teacher_preview.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { adminCoachingApi } from "@/lib/api";
import { scanForBannedPhrases } from "@/lib/coachVoice";
import { AdminTeacherFeedbackReviewCard } from "@/components/admin/AdminTeacherFeedbackReviewCard";

jest.mock("@/lib/api", () => ({
  adminCoachingApi: {
    upsertReview: jest.fn(),
  },
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const { toast } = require("sonner");

const ALLOWED_PREVIEW = {
  // admin_view_of_artifact shape: full artifact plus teacher_preview block.
  teacher_feedback_allowed: true,
  blocked_reason: null,
  summary: { opening: "You opened with a clear question." },
  teacher_preview: {
    teacher_feedback_allowed: true,
    summary: { opening: "You opened with a clear question." },
    action_items_count: 1,
    deep_dive_available: true,
    guardrails: { teacher_visible: true },
  },
};

const BLOCKED_PREVIEW = {
  teacher_feedback_allowed: false,
  blocked_reason: "evidence_insufficient",
  teacher_preview: {
    teacher_feedback_allowed: false,
    blocked_reason: "evidence_insufficient",
    summary: {},
    action_items_count: 0,
    deep_dive_available: false,
  },
};

const renderCard = (props) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminTeacherFeedbackReviewCard {...props} />
    </QueryClientProvider>
  );
};

describe("AdminTeacherFeedbackReviewCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the auto-allowed status pill and summary preview", () => {
    renderCard({
      assessmentId: "a-good",
      teacherPreview: ALLOWED_PREVIEW,
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    expect(screen.getByTestId("teacher-feedback-admin-status-pill").textContent).toMatch(/Auto-allowed/i);
    expect(screen.getByText(/You opened with a clear question\./i)).toBeInTheDocument();
    expect(screen.getByText(/Action items:/i)).toBeInTheDocument();
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });

  it("renders the blocked status pill and blocked reason", () => {
    renderCard({
      assessmentId: "a-bad",
      teacherPreview: BLOCKED_PREVIEW,
      teacherFeedbackAdminStatus: "blocked_quality",
    });
    expect(screen.getByTestId("teacher-feedback-admin-status-pill").textContent).toMatch(/Blocked/i);
    expect(screen.getByText(/evidence_insufficient/i)).toBeInTheDocument();
  });

  it("calls adminCoachingApi.upsertReview with admin_approved", async () => {
    adminCoachingApi.upsertReview.mockResolvedValueOnce({ data: { teacher_feedback_admin_status: "auto_allowed" } });
    const user = userEvent.setup();
    renderCard({
      assessmentId: "a-good",
      teacherPreview: ALLOWED_PREVIEW,
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    await user.click(screen.getByTestId("admin-approve-button"));
    expect(adminCoachingApi.upsertReview).toHaveBeenCalledWith(
      "a-good",
      expect.objectContaining({ status: "admin_approved" })
    );
  });

  it("Hide button requires a reason and shows error when missing", async () => {
    const user = userEvent.setup();
    renderCard({
      assessmentId: "a-good",
      teacherPreview: ALLOWED_PREVIEW,
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    await user.click(screen.getByTestId("admin-hide-button"));
    expect(adminCoachingApi.upsertReview).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/reason/i));
  });

  it("Hide button calls API when reason provided", async () => {
    adminCoachingApi.upsertReview.mockResolvedValueOnce({ data: { teacher_feedback_admin_status: "admin_hidden" } });
    const user = userEvent.setup();
    renderCard({
      assessmentId: "a-good",
      teacherPreview: ALLOWED_PREVIEW,
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    await user.type(screen.getByLabelText(/Review note/i), "Privacy concern");
    await user.click(screen.getByTestId("admin-hide-button"));
    expect(adminCoachingApi.upsertReview).toHaveBeenCalledWith(
      "a-good",
      expect.objectContaining({
        status: "admin_hidden",
        hidden_reason: "Privacy concern",
        review_note: "Privacy concern",
      })
    );
  });

  it("Request revision requires a reason and calls API with revision_reason", async () => {
    adminCoachingApi.upsertReview.mockResolvedValueOnce({
      data: { teacher_feedback_admin_status: "revision_requested" },
    });
    const user = userEvent.setup();
    renderCard({
      assessmentId: "a-good",
      teacherPreview: ALLOWED_PREVIEW,
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    await user.type(screen.getByLabelText(/Review note/i), "Tighten the action item");
    await user.click(screen.getByTestId("admin-request-revision-button"));
    expect(adminCoachingApi.upsertReview).toHaveBeenCalledWith(
      "a-good",
      expect.objectContaining({
        status: "revision_requested",
        revision_reason: "Tighten the action item",
      })
    );
  });

  it("never renders banned strings from teacher_preview", () => {
    renderCard({
      assessmentId: "a-good",
      teacherPreview: {
        ...ALLOWED_PREVIEW,
        teacher_preview: { ...ALLOWED_PREVIEW.teacher_preview, summary: { opening: "Safe coach summary." } },
      },
      teacherFeedbackAdminStatus: "auto_allowed",
    });
    expect(scanForBannedPhrases(document.body.textContent)).toEqual([]);
  });
});
