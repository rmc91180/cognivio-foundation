import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { dashboardApi } from "@/lib/api";

const severityStyles = {
  critical: "border-rose-200 bg-rose-50 text-rose-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-sky-200 bg-sky-50 text-sky-950",
};

function StatCard({ label, value, hint }) {
  return (
    <Panel className="min-h-[120px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value ?? 0}</div>
      {hint ? <p className="mt-2 text-sm leading-6 text-slate-600">{hint}</p> : null}
    </Panel>
  );
}

function PriorityCard({ card }) {
  const tone = severityStyles[card.severity] || severityStyles.info;
  return (
    <Panel className={`min-h-[170px] border ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{card.type?.replace(/_/g, " ")}</div>
          <h3 className="mt-2 text-base font-semibold">{card.title}</h3>
        </div>
        <div className="rounded-md bg-white/70 px-3 py-1 text-lg font-semibold">{card.count ?? 0}</div>
      </div>
      <p className="mt-3 text-sm leading-6 opacity-85">{card.summary}</p>
      {card.cta_href ? (
        <Link to={card.cta_href} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline">
          {card.cta_label || "Open"}
        </Link>
      ) : null}
    </Panel>
  );
}

function PatternCard({ pattern }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{pattern.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{pattern.description}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {pattern.severity || "info"}
        </span>
      </div>
      {pattern.affected_teacher_names?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pattern.affected_teacher_names.slice(0, 5).map((name) => (
            <span key={name} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {name}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-sm font-medium text-slate-800">{pattern.recommended_action}</p>
      {pattern.recommended_href ? (
        <Link to={pattern.recommended_href} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:text-primary/80">
          Take next step
        </Link>
      ) : null}
    </div>
  );
}

function formatLessonDate(value) {
  if (!value) return "Recent lesson";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent lesson";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SchoolAdminPilotDashboard() {
  const intelligenceQuery = useQuery({
    queryKey: ["dashboard-intelligence", "school"],
    queryFn: () => dashboardApi.intelligence().then((res) => res.data),
  });

  const data = intelligenceQuery.data || {};
  const summary = data.cycle_summary || {};
  const priorities = data.priority_cards || [];
  const patterns = data.patterns || [];
  const recentLessons = data.recent_lessons || [];
  const observationGaps = data.observation_gaps || [];
  const highlights = data.highlights || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="School Dashboard"
          description="Start with the patterns, lessons, and follow-up moves that need your attention today."
          actions={<Link to="/observation/new" className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan observation</Link>}
        />

        {intelligenceQuery.isLoading ? <LoadingState message="Preparing coaching priorities..." /> : null}
        {intelligenceQuery.isError ? (
          <ErrorState title="Dashboard needs a refresh" message="Try again in a moment, then start from the teacher list if the dashboard still needs time." />
        ) : null}

        {!intelligenceQuery.isLoading && !intelligenceQuery.isError ? (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Reviewed lessons" value={summary.reviewed_lessons} hint="Lesson feedback ready this cycle" />
              <StatCard label="Teachers observed" value={summary.teachers_observed} hint={`${summary.coverage_pct || 0}% coverage`} />
              <StatCard label="Open coaching tasks" value={summary.open_coaching_tasks} hint="Next steps still in motion" />
              <StatCard label="Recognition earned" value={summary.recognition_count} hint="Strong moments to celebrate" />
              <StatCard label="Days left" value={summary.days_remaining_in_cycle} hint="Current coaching cycle" />
            </section>

            <section>
              <SectionHeader title="Today’s coaching priorities" description="Use these cards to choose the first useful move, not to chase every metric at once." />
              {priorities.length ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {priorities.map((card) => <PriorityCard key={card.id || card.title} card={card} />)}
                </div>
              ) : (
                <EmptyState
                  title="Priorities will appear as lesson feedback builds."
                  message="Once a few lessons have been reviewed, patterns and follow-up priorities will appear here."
                />
              )}
            </section>

            <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
              <Panel className="space-y-4">
                <SectionHeader title="Patterns worth noticing" description="Look for the pattern, why it matters, and one practical next action." />
                {patterns.length ? (
                  <div className="space-y-3">
                    {patterns.map((pattern) => <PatternCard key={pattern.id || pattern.title} pattern={pattern} />)}
                  </div>
                ) : (
                  <EmptyState
                    title="Patterns will appear after reviewed lessons build up."
                    message="You’ll see plain-language trends that can shape walkthroughs and coaching conversations."
                  />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Recent lessons" description="Open a lesson, then choose one follow-up move." />
                {recentLessons.length ? (
                  <div className="space-y-3">
                    {recentLessons.map((lesson) => (
                      <div key={lesson.assessment_id || lesson.video_id || `${lesson.teacher_id}-${lesson.lesson_date}`} className="rounded-md border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{lesson.teacher_name}</div>
                            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{formatLessonDate(lesson.lesson_date)} · {lesson.title}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{lesson.summary}</p>
                          </div>
                          {lesson.href ? (
                            <Link to={lesson.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:text-primary/80">
                              Open
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Recent lessons will appear after recordings are reviewed."
                    message="You’ll see the teacher, lesson context, and a short coaching summary here."
                  />
                )}
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Observation gaps" description="Plan short visits for teachers who have gone longest without a fresh look." />
                {observationGaps.length ? (
                  <div className="space-y-3">
                    {observationGaps.map((gap) => (
                      <div key={gap.teacher_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4">
                        <div>
                          <div className="font-semibold text-slate-900">{gap.teacher_name}</div>
                          <p className="mt-1 text-sm text-slate-600">
                            {gap.days_since_last_observation == null ? "No observation yet this cycle." : `${gap.days_since_last_observation} days since the last observation.`}
                          </p>
                        </div>
                        <Link to={gap.recommended_href || `/observation/new?teacher_id=${gap.teacher_id}`} className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                          Plan observation
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Observation coverage is current." message="As the cycle continues, teachers who need a fresh observation will appear here." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Highlights" description="Keep growth and recognition visible." />
                {highlights.length ? (
                  <div className="space-y-3">
                    {highlights.map((item) => (
                      <div key={item.id || `${item.type}-${item.teacher_id}`} className="rounded-md border border-emerald-100 bg-emerald-50 p-4">
                        <div className="font-semibold text-emerald-950">{item.teacher_name}</div>
                        <p className="mt-2 text-sm leading-6 text-emerald-900">{item.description}</p>
                        {item.href ? <Link to={item.href} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-950 underline">Open</Link> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Highlights will appear here." message="Recognition and growth moments will show up as lessons are reviewed." />
                )}
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default SchoolAdminPilotDashboard;
