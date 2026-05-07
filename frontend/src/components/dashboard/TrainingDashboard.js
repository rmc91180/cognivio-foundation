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
  Layers,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, Panel, SectionHeader, Select, SkeletonCard, SkeletonStat } from "@/components/ui";
import { UpcomingObservationsWidget } from "@/components/dashboard/UpcomingObservationsWidget";
import { cohortApi } from "@/lib/api";
import api from "@/lib/apiClient";

const COPY = {
  en: {
    title: "Training Program Dashboard",
    description: "Cohort overview, trainee placements, competency progress, and supervision cadence.",
    cohortOverview: "Cohort overview",
    cohortDescription: "Review training-program progress by cohort instead of school.",
    allCohorts: "All cohorts",
    totalTrainees: "Total trainees",
    observationsThisCycle: "Observations this cycle",
    onTrack: "On track",
    needsAttention: "Needs attention",
    traineeName: "Trainee name",
    cohort: "Cohort",
    placementSchool: "Placement school",
    competencyProgress: "Competency progress",
    lastObs: "Last obs",
    nextDue: "Next due",
    readiness: "Readiness",
    action: "Action",
    scheduleObservation: "Schedule observation",
    manageCohorts: "Manage cohorts",
    loading: "Loading training program dashboard...",
    noPlacement: "Unassigned",
    noTrainees: "No trainees are linked to this training organization yet.",
  },
  he: {
    title: "לוח תוכנית הכשרה",
    description: "מבט על מחזורים, שיבוצים, התקדמות כשירויות וקצב הדרכה.",
    cohortOverview: "מבט מחזורי",
    cohortDescription: "בדיקת התקדמות תוכנית ההכשרה לפי מחזור במקום לפי בית ספר.",
    allCohorts: "כל המחזורים",
    totalTrainees: "סך מתמחים",
    observationsThisCycle: "תצפיות במחזור הנוכחי",
    onTrack: "בקצב תקין",
    needsAttention: "דורש תשומת לב",
    traineeName: "שם המתמחה",
    cohort: "מחזור",
    placementSchool: "בית ספר משבץ",
    competencyProgress: "התקדמות כשירות",
    lastObs: "תצפית אחרונה",
    nextDue: "הבאה",
    readiness: "מוכנות",
    action: "פעולה",
    scheduleObservation: "תיאום תצפית",
    manageCohorts: "ניהול מחזורים",
    loading: "טוען את לוח תוכנית ההכשרה...",
    noPlacement: "לא שובץ",
    noTrainees: "עדיין אין מתמחים המשויכים לארגון ההכשרה הזה.",
  },
};

function getCopy(language) {
  return language?.startsWith("he") ? COPY.he : COPY.en;
}

function observationRoute(traineeId) {
  const params = new URLSearchParams({ teacher_id: traineeId });
  return `/observation/new?${params.toString()}`;
}

function formatDate(value, locale) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(parsed);
}

function formatProficiency(value) {
  return typeof value === "number" ? `${value.toFixed(1)} / 4` : "No evidence";
}

function ProgressBar({ value }) {
  const pct = Math.min(100, Math.max(0, ((Number(value) || 0) / 4) * 100));
  const color = pct >= 75 ? "bg-emerald-600" : pct >= 50 ? "bg-amber-500" : "bg-rose-600";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
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

export function TrainingDashboard() {
  const { i18n } = useTranslation();
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const copy = getCopy(i18n.language);
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const isRtl = i18n.dir() === "rtl";

  const { data: cohortsRes, isLoading: cohortsLoading } = useQuery({
    queryKey: ["cohorts"],
    queryFn: () => cohortApi.list().then((res) => res.data),
  });
  const { data: supervisorSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["training-supervisor-summary"],
    queryFn: () => api.get("/api/training/supervisor-summary").then((res) => res.data),
  });

  const cohorts = cohortsRes?.cohorts || [];
  const selectedCohort = useMemo(
    () => cohorts.find((cohort) => cohort.id === selectedCohortId) || cohorts[0] || null,
    [cohorts, selectedCohortId]
  );
  const rows = selectedCohort?.trainees || [];
  const needsAttention = (supervisorSummary?.trainees_at_risk || 0) + (supervisorSummary?.trainees_not_started || 0);

  if (cohortsLoading || summaryLoading) {
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
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-950">
              {copy.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy.description}</p>
          </div>
          <Link
            to="/cohorts"
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            <Layers className="h-4 w-4" />
            {copy.manageCohorts}
          </Link>
        </header>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard icon={Users} label={copy.totalTrainees} value={supervisorSummary?.total_trainees || 0} />
          <StatCard
            icon={ClipboardList}
            label={copy.observationsThisCycle}
            value={supervisorSummary?.observations_this_cycle || 0}
          />
          <StatCard icon={CheckCircle2} label={copy.onTrack} value={supervisorSummary?.trainees_on_track || 0} />
          <StatCard icon={AlertTriangle} label={copy.needsAttention} value={needsAttention} />
        </div>

        <Panel as="section" className="border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionHeader title={copy.cohortOverview} description={copy.cohortDescription} />
            <div className="w-full max-w-xs">
              <Select
                value={selectedCohort?.id || ""}
                onChange={(event) => setSelectedCohortId(event.target.value)}
              >
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {rows.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">{copy.traineeName}</th>
                    <th className="px-3 py-2">{copy.cohort}</th>
                    <th className="px-3 py-2">{copy.placementSchool}</th>
                    <th className="px-3 py-2">{copy.competencyProgress}</th>
                    <th className="px-3 py-2">{copy.lastObs}</th>
                    <th className="px-3 py-2">{copy.nextDue}</th>
                    <th className="px-3 py-2">{copy.action}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.trainee_id} className="align-top">
                      <td className="px-3 py-3">
                        <Link to={`/teachers/${row.trainee_id}`} className="font-semibold text-slate-950 hover:text-primary">
                          {row.trainee_name}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">{row.readiness_rating}</div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{selectedCohort?.name || row.cohort}</td>
                      <td className="px-3 py-3 text-slate-600">{row.placement_school || copy.noPlacement}</td>
                      <td className="px-3 py-3">
                        <div className="w-36">
                          <ProgressBar value={row.competency_progress || 0} />
                          <div className="mt-1 text-xs text-slate-500">{formatProficiency(row.competency_progress)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.last_observation, locale)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.next_due, locale)}</td>
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
            <div className="mt-5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              {copy.noTrainees}
            </div>
          )}
        </Panel>

        <UpcomingObservationsWidget />

        <Panel className="border border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-slate-950">4-point training scale</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {["1 Emerging", "2 Developing", "3 Proficient", "4 Distinguished"].map((label) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                {label}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="border border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-slate-950">Supervision cadence</h2>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Each trainee is measured against {supervisorSummary?.required_per_trainee || 2} required observations this cycle.
          </p>
        </Panel>
      </div>
    </LayoutShell>
  );
}
