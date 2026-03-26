import React from "react";
import { Link } from "react-router-dom";
import { resolveCoachingLink } from "@/lib/coachingRoutes";

const signalClasses = {
  reinforcing_progress: "bg-emerald-50 text-emerald-700 border-emerald-200",
  follow_through: "bg-emerald-50 text-emerald-700 border-emerald-200",
  repeated_challenge: "bg-amber-50 text-amber-700 border-amber-200",
  showing_challenge: "bg-amber-50 text-amber-700 border-amber-200",
  evidence_gap: "bg-slate-100 text-slate-600 border-slate-200",
  one_off_evidence: "bg-sky-50 text-sky-700 border-sky-200",
  linked_context: "bg-slate-100 text-slate-600 border-slate-200",
};

export function EvidenceRecordList({
  records = [],
  user,
  teacherId,
  t,
  dateFormatter,
  emptyLabel,
}) {
  if (!records.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {records.map((record) => {
        const signalClass =
          signalClasses[record.signal] || "bg-slate-100 text-slate-600 border-slate-200";
        return (
          <div
            key={record.id}
            className="rounded-md border border-slate-200 bg-white px-3 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">{record.title}</div>
              {record.signal ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${signalClass}`}
                >
                  {t(`evidenceSignals.${record.signal}`)}
                </span>
              ) : null}
            </div>
            {record.summary ? (
              <div className="mt-2 text-xs text-slate-700">{record.summary}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              {record.created_at && dateFormatter ? (
                <span>{dateFormatter.format(new Date(record.created_at))}</span>
              ) : null}
              <Link
                to={resolveCoachingLink(user, teacherId, record.route_hint, {
                  videoId: record.video_id,
                  timestampSeconds: record.timestamp_seconds,
                })}
                className="font-medium text-primary hover:underline"
              >
                {t("coachingTimeline.openLinkedRecord")}
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default EvidenceRecordList;
