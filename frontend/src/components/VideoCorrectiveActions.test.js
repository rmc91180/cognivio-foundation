/**
 * PR C9.5 PART 3–6 (contract D) — corrective-action controls render the backend
 * eligibility map faithfully: enabled buttons fire the action, disabled buttons
 * are inert AND show their specific machine-derived reason (never a dead button,
 * never a silent disable).
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VideoCorrectiveActions } from "@/components/VideoCorrectiveActions";

const video = {
  id: "v1",
  actions: {
    retry_privacy: { action: "retry_privacy", eligible: true, disabled_reason: null },
    retry_analysis: {
      action: "retry_analysis",
      eligible: false,
      disabled_reason: "analysis_already_complete",
    },
    run_audio_analysis: {
      action: "run_audio_analysis",
      eligible: false,
      disabled_reason: "audio_analysis_disabled",
      mode: "run",
    },
    retry_feedback_projection: {
      action: "retry_feedback_projection",
      eligible: true,
      disabled_reason: null,
      mode: "retry",
    },
  },
};

it("renders a control per backend action with correct enabled/disabled state", () => {
  render(<VideoCorrectiveActions video={video} onAction={() => {}} />);

  expect(screen.getByTestId("action-retry_privacy")).toHaveAttribute("data-eligible", "true");
  expect(screen.getByTestId("action-retry_analysis")).toHaveAttribute("data-eligible", "false");

  // The retry-privacy button is enabled; retry-analysis is disabled.
  expect(screen.getByRole("button", { name: "Retry privacy" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Refresh feedback" })).toBeEnabled();
});

it("shows the specific disabled reason for every disabled control (no dead button)", () => {
  render(<VideoCorrectiveActions video={video} onAction={() => {}} />);

  expect(screen.getByTestId("action-retry_analysis-reason")).toHaveTextContent(
    /already complete/i
  );
  expect(screen.getByTestId("action-run_audio_analysis-reason")).toHaveTextContent(
    /turned off/i
  );
});

it("fires onAction only for eligible controls", async () => {
  const onAction = jest.fn();
  render(<VideoCorrectiveActions video={video} onAction={onAction} />);

  await userEvent.click(screen.getByRole("button", { name: "Retry privacy" }));
  expect(onAction).toHaveBeenCalledWith("retry_privacy");

  // Disabled buttons cannot dispatch.
  const disabled = screen.getByRole("button", { name: "Retry analysis" });
  expect(disabled).toBeDisabled();
});

it("renders nothing when the video carries no actions map", () => {
  const { container } = render(<VideoCorrectiveActions video={{ id: "v1" }} onAction={() => {}} />);
  expect(container.querySelector('[data-testid="video-corrective-actions"]')).toBeNull();
});
