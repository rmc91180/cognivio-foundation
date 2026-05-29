import React from "react";
import { isAudioNotRun } from "@/lib/reviewProgress";

const safePct = (value) => Math.max(0, Math.min(100, Number(value) || 0));

// PR C9.3 PART 2 — when audio analysis was deliberately not run (disabled or
// skipped) or failed, the empty state must say so honestly rather than promise
// "after audio review is complete".
const emptyStateCopy = (audioStageStatus) => {
  if (isAudioNotRun(audioStageStatus)) {
    return "Audio analysis was not run for this review.";
  }
  if (audioStageStatus === "failed") {
    return "Audio analysis could not be completed for this review.";
  }
  if (audioStageStatus === "processing" || audioStageStatus === "pending") {
    return "Audio review is in progress.";
  }
  return "Talk-time details will appear here after audio review is complete.";
};

export function TalkTimeChart({ analysis, isTeacherView = false, audioStageStatus = null }) {
  const hasFeatures = Boolean(analysis?.features_available);
  if (!hasFeatures) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        {emptyStateCopy(audioStageStatus)}
      </div>
    );
  }

  const teacher = safePct(analysis.teacher_talk_pct);
  const student = safePct(analysis.student_talk_pct);
  const silence = safePct(analysis.silence_pct);

  return (
    <div className="space-y-3">
      <div className="hidden sm:block">
        <div className="flex h-4 overflow-hidden rounded-full bg-slate-100" aria-label="Talk-time breakdown">
          <div className="bg-sky-500" style={{ width: `${teacher}%` }} title={`Teacher ${teacher}%`} />
          <div className="bg-emerald-500" style={{ width: `${student}%` }} title={`Students ${student}%`} />
          <div className="bg-slate-300" style={{ width: `${silence}%` }} title={`Quiet time ${silence}%`} />
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md bg-sky-50 px-3 py-2">
          <dt className="font-medium text-sky-900">Teacher talk</dt>
          <dd className="mt-1 text-sky-800">{teacher}%</dd>
        </div>
        <div className="rounded-md bg-emerald-50 px-3 py-2">
          <dt className="font-medium text-emerald-900">Student talk</dt>
          <dd className="mt-1 text-emerald-800">{student}%</dd>
        </div>
        <div className="rounded-md bg-slate-100 px-3 py-2">
          <dt className="font-medium text-slate-800">Quiet time</dt>
          <dd className="mt-1 text-slate-600">{silence}%</dd>
        </div>
      </dl>
      <p className="text-sm leading-6 text-slate-600">
        {isTeacherView
          ? "In this recording, your talk-time pattern gives you one more lens on the lesson. In your next lesson, try one intentional pause before you step back in."
          : "Talk-time gives you a starting point for the coaching conversation."}
      </p>
    </div>
  );
}

export default TalkTimeChart;
