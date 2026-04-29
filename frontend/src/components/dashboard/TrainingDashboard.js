import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  GraduationCap,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import api from "@/lib/apiClient";
import { LayoutShell } from "@/components/LayoutShell";
import { Panel, SectionHeader, SkeletonCard, SkeletonStat } from "@/components/ui";
import { UpcomingObservationsWidget } from "@/components/dashboard/UpcomingObservationsWidget";

const COPY = {
  en: {
    title: "Training Supervisor Dashboard",
    description: "Track trainee placement progress, observation cadence, and recent coaching notes.",
    totalTrainees: "Total trainees",
    observationsThisCycle: "Observations this cycle",
    onTrack: "On track",
    needsAttention: "Needs attention",
    complianceTitle: "Observation compliance",
    complianceDescription: "Review each trainee against the current cycle requirement.",
    atRiskOnly: "Show at-risk only",
    traineeName: "Trainee name",
    placementSite: "Placement site",
    required: "Required",
    completed: "Completed",
    status: "Status",
    action: "Action",
    scheduleObservation: "Schedule observation",
    atRisk: "At risk",
    notStarted: "Not started",
    upcomingTitle: "Upcoming observations",
    upcomingDescription: "The next planned observations across active placements.",
    focusElements: "Focus elements",
    startNow: "Start now",
    recentTitle: "Recent observation summaries",
    recentDescription: "A quick read of the latest completed observation notes.",
    viewFullFeedback: "View full feedback",
    noPlacement: "Unassigned",
    noUpcoming: "No upcoming observations are scheduled yet.",
    noRecent: "Completed observation summaries will appear here after trainees are observed.",
    noTrainees: "No trainees are linked to this training organization yet.",
    generalFocus: "General observation focus",
    loading: "Loading training dashboard...",
  },
  he: {
    title: "לוח ניהול הכשרה",
    description: "מעקב אחרי התקדמות מתמחים, קצב תצפיות והערות אימון אחרונות.",
    totalTrainees: "סך מתמחים",
    observationsThisCycle: "תצפיות במחזור הנוכחי",
    onTrack: "בקצב תקין",
    needsAttention: "דורש תשומת לב",
    complianceTitle: "עמידה בתצפיות",
    complianceDescription: "בדיקת כל מתמחה מול דרישת המחזור הנוכחי.",
    atRiskOnly: "להציג רק בסיכון",
    traineeName: "שם המתמחה",
    placementSite: "אתר שיבוץ",
    required: "נדרש",
    completed: "בוצע",
    status: "סטטוס",
    action: "פעולה",
    scheduleObservation: "תיאום תצפית",
    atRisk: "בסיכון",
    notStarted: "טרם התחיל",
    upcomingTitle: "תצפיות קרובות",
    upcomingDescription: "התצפיות המתוכננות הבאות בשיבוצים הפעילים.",
    focusElements: "מוקדי תצפית",
    startNow: "התחלה עכשיו",
    recentTitle: "סיכומי תצפיות אחרונים",
    recentDescription: "קריאה מהירה של הערות התצפית האחרונות שהושלמו.",
    viewFullFeedback: "צפייה במשוב המלא",
    noPlacement: "לא שובץ",
    noUpcoming: "עדיין לא נקבעו תצפיות קרובות.",
    noRecent: "סיכומי תצפיות שהושלמו יופיעו כאן לאחר תצפיות.",
    noTrainees: "עדיין אין מתמחים המשויכים לארגון ההכשרה הזה.",
    generalFocus: "מוקד תצפית כללי",
    loading: "טוען את לוח ההכשרה...",
  },
};

const STATUS_CLASS = {
  on_track: "border-emerald-200 bg-emerald-50 text-emerald-700",
  at_risk: "border-amber-200 bg-amber-50 text-amber-700",
  not_started: "border-rose-200 bg-rose-50 text-rose-700",
};

function getCopy(language) {
  return language?.startsWith("he") ? COPY.he : COPY.en;
}

function observationRoute(traineeId, extraParams = {}) {
  const params = new URLSearchParams({ teacher_id: traineeId, ...extraParams });
  return `/observation/new?${params.toString()}`;
}

function isToday(value) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = new Date();
  return (
    parsed.getFullYear() === today.getFullYear() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getDate() === today.getDate()
  );
}

function formatDate(value, locale) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function coachSentence(value) {
  const cleaned = String(value || "")
    .replace(/\bassessments?\b/gi, "observation")
    .replace(/\banalysis\b/gi, "review")
    .replace(/\bevidence\b/gi, "notes")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = cleaned.match(/[^.!?]+[.!?]*/);
  return sentence ? sentence[0].trim() : cleaned;
}

function statusLabel(status, copy) {
  if (status === "at_risk") return copy.atRisk;
  if (status === "not_started") return copy.notStarted;
  return copy.onTrack;
}

function StatusBadge({ status, copy }) {
  return (
    <span
      className={[
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
        STATUS_CLASS[status] || STATUS_CLASS.on_track,
      ].join(" ")}
    >
      {statusLabel(status, copy)}
    </span>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <Panel className="border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Panel>
  );
}

function EmptyPanel({ children }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
      {children}
    </div>
  );
}

export function TrainingDashboard() {
  const { i18n } = useTranslation();
  const [showAtRiskOnly, setShowAtRiskOnly] = useState(false);
  const copy = getCopy(i18n.language);
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const isRtl = i18n.dir() === "rtl";

  const { data: summary, isLoading } = useQuery({
    queryKey: ["training-supervisor-summary"],
    queryFn: () => api.get("/api/training/supervisor-summary").then((res) => res.data),
  });

  const traineeRows = summary?.trainees || [];
  const filteredRows = useMemo(
    () =>
      showAtRiskOnly
        ? traineeRows.filter((row) => row.status === "at_risk" || row.status === "not_started")
        : traineeRows,
    [showAtRiskOnly, traineeRows]
  );
  const needsAttention = (summary?.trainees_at_risk || 0) + (summary?.trainees_not_started || 0);

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-7xl px-6 py-6" dir={isRtl ? "rtl" : "ltr"}>
          <div className="mb-6 text-sm text-slate-500">{copy.loading}</div>
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonStat key={index} />
            ))}
          </div>
          <div className="mt-6">
            <SkeletonCard height={260} />
          </div>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6" dir={isRtl ? "rtl" : "ltr"}>
        <header>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-950">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.description}</p>
        </header>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard icon={Users} label={copy.totalTrainees} value={summary?.total_trainees || 0} />
          <StatCard
            icon={ClipboardList}
            label={copy.observationsThisCycle}
            value={summary?.observations_this_cycle || 0}
          />
          <StatCard icon={CheckCircle2} label={copy.onTrack} value={summary?.trainees_on_track || 0} />
          <StatCard icon={AlertTriangle} label={copy.needsAttention} value={needsAttention} />
        </div>

        <UpcomingObservationsWidget />

        <Panel as="section" className="border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionHeader title={copy.complianceTitle} description={copy.complianceDescription} />
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showAtRiskOnly}
                onChange={(event) => setShowAtRiskOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              {copy.atRiskOnly}
            </label>
          </div>

          {filteredRows.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">{copy.traineeName}</th>
                    <th className="px-3 py-2">{copy.placementSite}</th>
                    <th className="px-3 py-2">{copy.required}</th>
                    <th className="px-3 py-2">{copy.completed}</th>
                    <th className="px-3 py-2">{copy.status}</th>
                    <th className="px-3 py-2">{copy.action}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((row) => (
                    <tr key={row.trainee_id} className="align-top">
                      <td className="px-3 py-3 font-medium text-slate-900">{row.trainee_name}</td>
                      <td className="px-3 py-3 text-slate-600">{row.school_site || copy.noPlacement}</td>
                      <td className="px-3 py-3 text-slate-700">{row.required}</td>
                      <td className="px-3 py-3 text-slate-700">{row.completed}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={row.status} copy={copy} />
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          to={observationRoute(row.trainee_id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {copy.scheduleObservation}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyPanel>{copy.noTrainees}</EmptyPanel>
            </div>
          )}
        </Panel>

        <Panel as="section" className="border border-slate-200 bg-white p-5">
          <SectionHeader title={copy.upcomingTitle} description={copy.upcomingDescription} />
          {summary?.upcoming_observations?.length ? (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {summary.upcoming_observations.slice(0, 7).map((item) => {
                const dueToday = isToday(item.scheduled_date);
                const focusElements = item.focus_elements?.length ? item.focus_elements : [copy.generalFocus];
                return (
                  <div key={`${item.trainee_id}-${item.scheduled_date}`} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.school_site || copy.noPlacement}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        {formatDate(item.scheduled_date, locale)}
                      </div>
                    </div>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {copy.focusElements}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {focusElements.map((focus) => (
                        <span key={focus} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700">
                          {focus}
                        </span>
                      ))}
                    </div>
                    {dueToday ? (
                      <Link
                        to={observationRoute(item.trainee_id, { start: "now" })}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        {copy.startNow}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyPanel>{copy.noUpcoming}</EmptyPanel>
            </div>
          )}
        </Panel>

        <Panel as="section" className="border border-slate-200 bg-white p-5">
          <SectionHeader title={copy.recentTitle} description={copy.recentDescription} />
          {summary?.recent_observations?.length ? (
            <div className="mt-5 space-y-3">
              {summary.recent_observations.slice(0, 5).map((item) => (
                <div key={`${item.trainee_id}-${item.completed_date}`} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {item.school_site || copy.noPlacement} · {formatDate(item.completed_date, locale)}
                      </div>
                    </div>
                    <Link
                      to={`/teachers/${item.trainee_id}/latest-lesson`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {copy.viewFullFeedback}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {coachSentence(item.summary)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyPanel>{copy.noRecent}</EmptyPanel>
            </div>
          )}
        </Panel>
      </div>
    </LayoutShell>
  );
}
