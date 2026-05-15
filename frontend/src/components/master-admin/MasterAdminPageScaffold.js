import React from "react";
import classNames from "classnames";
import { LayoutShell } from "@/components/LayoutShell";
import { Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "./MasterAdminSectionNav";

export function MasterAdminPageScaffold({
  title,
  description,
  meta,
  actions,
  children,
  railNoteTitle = "Internal backend console",
  railNote = "Use this surface for platform oversight, support, and recovery. User-facing coaching flows stay outside this route family.",
}) {
  return (
    <LayoutShell>
      <div className="space-y-6 p-4 sm:p-6">
        <Panel className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_32%),linear-gradient(135deg,#020617_0%,#0f172a_65%,#1e293b_100%)] text-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.85)]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-300">
              <span>Master Admin Backend</span>
              <span className="text-slate-500">/</span>
              <span className="text-emerald-300">Internal Only</span>
            </div>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-white">{title}</h1>
                {description ? <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p> : null}
                {meta ? <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-400">{meta}</div> : null}
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
          </div>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[280px,minmax(0,1fr)]">
          <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <Panel className="border-slate-200 bg-slate-50/90">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{railNoteTitle}</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">{railNote}</div>
            </Panel>
            <MasterAdminSectionNav />
          </div>
          <div className="min-w-0 space-y-6">{children}</div>
        </div>
      </div>
    </LayoutShell>
  );
}

export function MasterAdminMetricGrid({ children, className }) {
  return <div className={classNames("grid gap-4 md:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}

export function MasterAdminMetricCard({ label, value, hint, tone = "neutral" }) {
  const toneClasses =
    tone === "danger"
      ? "border-rose-200 bg-rose-50"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-slate-50";

  return (
    <Panel className={classNames("space-y-2 border", toneClasses)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint ? <div className="text-sm text-slate-600">{hint}</div> : null}
    </Panel>
  );
}
