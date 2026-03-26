import React from "react";
import { Link } from "react-router-dom";
import { Panel, SectionHeader } from "@/components/ui";
import { resolveCoachingLink } from "@/lib/coachingRoutes";

const toneClasses = {
  privacy_blocker: "border-amber-200 bg-amber-50/70",
  awaiting_admin_review: "border-sky-200 bg-sky-50/70",
  awaiting_teacher_response: "border-rose-200 bg-rose-50/70",
  goal_checkpoint_due: "border-violet-200 bg-violet-50/70",
  conference_upcoming: "border-emerald-200 bg-emerald-50/70",
  new_evidence_ready: "border-sky-200 bg-sky-50/70",
};

export function CoachingTaskList({
  title,
  description,
  eyebrow,
  tasks = [],
  user,
  t,
  emptyLabel,
}) {
  return (
    <Panel>
      <SectionHeader title={title} description={description} eyebrow={eyebrow} />
      <div className="mt-4 space-y-3">
        {tasks.length ? (
          tasks.map((task) => (
            <div
              key={task.id}
              className={`rounded-xl border px-4 py-4 ${toneClasses[task.state] || "border-slate-200 bg-slate-50"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{task.title}</div>
                  {task.teacher_name ? (
                    <div className="mt-1 text-[11px] text-slate-500">{task.teacher_name}</div>
                  ) : null}
                </div>
                {task.state ? (
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {t(`coachingTasks.states.${task.state}`, { defaultValue: task.state })}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 text-xs text-slate-700">{task.summary}</div>
              {task.support_prompt && task.support_prompt !== task.summary ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600">
                  {task.support_prompt}
                </div>
              ) : null}
              {task.context_label ? (
                <div className="mt-2 text-[11px] text-slate-500">
                  {task.context_label}
                </div>
              ) : null}
              <div className="mt-4">
                <Link
                  to={resolveCoachingLink(user, task.teacher_id, task.route_hint, {
                    videoId: task.video_id,
                  })}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("coachingTasks.openTask")}
                </Link>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default CoachingTaskList;
