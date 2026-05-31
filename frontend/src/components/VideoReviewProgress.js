import React from "react";
import { getAudioStageStatus, isAudioNotRun, describeFeedbackReason } from "@/lib/reviewProgress";

/**
 * PR C9.3 PART 2 — teacher-safe review-progress checklist + barometer.
 *
 * Renders the deterministic ``review_progress`` object produced by the backend
 * (see ``backend/app/services/video_review_progress.py``). It never invents its
 * own status; it presents what the backend decided so every surface tells the
 * same story. The component is presentational and side-effect free.
 *
 * Key teacher-safety rules surfaced here:
 *   - A degraded (vision-only) review reads as complete, never a stuck spinner.
 *   - Audio shown as "Not run" when skipped/disabled — never "pending" and
 *     never promising "after audio review is complete".
 */

const STATUS_LABELS = {
  completed: "Done",
  processing: "In progress",
  pending: "Waiting",
  blocked: "Waiting on a step",
  failed: "Needs attention",
  skipped: "Not run",
  not_started: "Not started",
};

const STATUS_DOT_CLASS = {
  completed: "bg-emerald-500",
  processing: "bg-sky-500 animate-pulse",
  pending: "bg-slate-300",
  blocked: "bg-amber-500",
  failed: "bg-rose-500",
  skipped: "bg-slate-300",
  not_started: "bg-slate-200",
};

const BAR_CLASS = {
  completed: "bg-emerald-500",
  completed_degraded: "bg-emerald-500",
  processing: "bg-sky-500",
  blocked: "bg-amber-500",
  failed: "bg-rose-500",
};

const stageStatusLabel = (status) => STATUS_LABELS[status] || status || "";

export function VideoReviewProgress({ progress, isAdmin = false, className = "" }) {
  if (!progress || typeof progress !== "object") return null;

  const {
    status,
    percent = 0,
    stages = [],
    teacher_message: teacherMessage,
    admin_message: adminMessage,
    degraded,
  } = progress;

  const headlineMessage = isAdmin ? adminMessage || teacherMessage : teacherMessage;
  const barClass = BAR_CLASS[status] || "bg-sky-500";
  const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const audioStatus = getAudioStageStatus(progress);

  return (
    <div
      data-testid="review-progress"
      data-status={status}
      data-percent={clampedPercent}
      className={`rounded-lg border border-slate-200 bg-white px-4 py-4 ${className}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Review progress</h2>
        <span
          data-testid="review-progress-percent"
          className="text-xs font-medium text-slate-500"
        >
          {clampedPercent}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>

      {headlineMessage ? (
        <p data-testid="review-progress-message" className="mt-3 text-sm leading-6 text-slate-700">
          {headlineMessage}
        </p>
      ) : null}

      {degraded ? (
        <p data-testid="review-progress-degraded" className="mt-1 text-xs text-amber-700">
          This analysis was based on video only.
        </p>
      ) : null}

      <ul className="mt-3 space-y-2" data-testid="review-progress-stages">
        {stages.map((stage) => {
          const dotClass = STATUS_DOT_CLASS[stage.status] || "bg-slate-300";
          // Audio that was deliberately not run gets explicit, honest copy.
          const audioNotRun = stage.key === "audio" && isAudioNotRun(stage.status);
          // PR C9.5 PART 6: a withheld/awaiting feedback stage explains WHY via
          // its specific reason code rather than a generic "Waiting".
          const feedbackReasonCopy =
            stage.key === "feedback" ? describeFeedbackReason(stage.reason_code) : null;
          const detail = audioNotRun
            ? "Audio analysis was not run for this review."
            : stage.detail || feedbackReasonCopy;
          return (
            <li
              key={stage.key}
              data-testid={`review-stage-${stage.key}`}
              data-status={stage.status}
              className="flex items-start gap-2 text-xs"
            >
              <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
              <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium text-slate-800">{stage.label}</span>
                <span
                  data-testid={`review-stage-${stage.key}-status`}
                  className="text-[11px] text-slate-500"
                >
                  {stageStatusLabel(stage.status)}
                </span>
                {detail ? (
                  <span className="w-full text-[11px] text-slate-500">{detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {audioStatus ? (
        <span className="sr-only" data-testid="review-audio-status">
          {audioStatus}
        </span>
      ) : null}
    </div>
  );
}

export default VideoReviewProgress;
