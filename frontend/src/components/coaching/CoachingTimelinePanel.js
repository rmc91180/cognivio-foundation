import React from "react";
import { Link } from "react-router-dom";
import { Panel, SectionHeader } from "@/components/ui";
import { resolveCoachingLink } from "@/lib/coachingRoutes";

export function CoachingTimelinePanel({
  title,
  description,
  eyebrow,
  entries = [],
  user,
  teacherId,
  t,
  emptyLabel,
  dateFormatter,
}) {
  return (
    <Panel>
      <SectionHeader title={title} description={description} eyebrow={eyebrow} />
      <div className="mt-4 space-y-3">
        {entries.length ? (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{entry.title}</div>
                <div className="text-[11px] text-slate-500">
                  {entry.created_at && dateFormatter
                    ? dateFormatter.format(new Date(entry.created_at))
                    : ""}
                </div>
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                {[entry.author_role, entry.author_name].filter(Boolean).join(" • ")}
              </div>
              {entry.summary ? (
                <div className="mt-3 text-xs text-slate-700">{entry.summary}</div>
              ) : null}
              <div className="mt-3">
                <Link
                  to={resolveCoachingLink(user, teacherId, entry.route_hint, {
                    videoId: entry.video_id,
                  })}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {t("coachingTimeline.openLinkedRecord")}
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

export default CoachingTimelinePanel;
