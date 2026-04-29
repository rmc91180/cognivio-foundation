import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarClock, PlayCircle, Plus, Target } from "lucide-react";
import { observationSessionApi } from "@/lib/api";
import { Panel, SectionHeader, SkeletonCard } from "@/components/ui";

const COPY = {
  en: {
    title: "Upcoming observations",
    description: "Planned sessions for the next 14 days.",
    newObservation: "New observation",
    startObservation: "Start observation",
    focusAreas: "Focus areas",
    noSessions: "Planned observations will appear here once they are scheduled.",
    loading: "Loading upcoming observations...",
    teacherFallback: "Teacher",
    unscheduled: "Date not set",
  },
  he: {
    title: "תצפיות קרובות",
    description: "תצפיות מתוכננות ל-14 הימים הקרובים.",
    newObservation: "תצפית חדשה",
    startObservation: "התחלת תצפית",
    focusAreas: "מוקדי תצפית",
    noSessions: "תצפיות מתוכננות יופיעו כאן לאחר תזמון.",
    loading: "טוען תצפיות קרובות...",
    teacherFallback: "מורה",
    unscheduled: "ללא מועד",
  },
};

function getCopy(language) {
  return language?.startsWith("he") ? COPY.he : COPY.en;
}

function formatDate(value, locale, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function startRoute(session) {
  const params = new URLSearchParams({
    teacher_id: session.teacher_id,
    observation_session_id: session.id,
  });
  return `/record?${params.toString()}`;
}

export function UpcomingObservationsWidget({ className = "" }) {
  const { i18n } = useTranslation();
  const copy = getCopy(i18n.language);
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const isRtl = i18n.dir() === "rtl";

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["upcoming-observation-sessions"],
    queryFn: () => observationSessionApi.upcoming().then((res) => res.data),
  });

  return (
    <Panel className={`border border-slate-200 bg-white ${className}`} dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Link
            to="/observation/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {copy.newObservation}
          </Link>
        }
      />

      {isLoading ? (
        <div className="mt-5">
          <SkeletonCard height={160} />
          <p className="mt-3 text-xs text-slate-500">{copy.loading}</p>
        </div>
      ) : sessions.length ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {sessions.slice(0, 7).map((session) => (
            <div
              key={session.id}
              className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {session.teacher_name || copy.teacherFallback}
                  </div>
                  {session.school_site ? (
                    <div className="mt-1 text-sm text-slate-600">{session.school_site}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  {formatDate(session.scheduled_date, locale, copy.unscheduled)}
                </div>
              </div>

              <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {copy.focusAreas}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(session.focus_elements || []).map((focus) => (
                  <span
                    key={focus}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700"
                  >
                    <Target className="h-3 w-3 text-primary" />
                    {focus}
                  </span>
                ))}
              </div>

              <Link
                to={startRoute(session)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                {copy.startObservation}
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          {copy.noSessions}
        </div>
      )}
    </Panel>
  );
}
