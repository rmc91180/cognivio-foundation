import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { adminWorkspaceApi, demoApi } from "@/lib/api";
import { SetupAssistantPanel } from "@/components/dashboard/SetupAssistantPanel";

const severityStyles = {
  critical: "border-rose-200 bg-rose-50 text-rose-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-sky-200 bg-sky-50 text-sky-950",
};

const invalidateWorkspaceQueries = (queryClient) => {
  [
    "teacher-self-profile",
    "teacher-dashboard",
    "teacher-lessons",
    "teacher-coaching",
    "teacher-recognition",
    "dashboard-intelligence",
    "admin-workspace-dashboard",
    "admin-workspace-search",
    "teachers",
    "reports",
    "coaching",
    "recognition",
  ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
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

function SimpleList({ items, emptyTitle, render }) {
  if (!items?.length) return <EmptyState title={emptyTitle} />;
  return <div className="space-y-3">{items.map(render)}</div>;
}

function SearchPanel({ query, setQuery, searchQuery }) {
  const results = searchQuery.data?.results || [];
  return (
    <Panel>
      <Field label="Search this workspace">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teachers, lessons, coaching, recognition, reports..." className="pl-9" />
        </div>
      </Field>
      {query.trim().length > 1 ? (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
          {searchQuery.isLoading ? <div className="text-sm text-slate-500">Searching...</div> : null}
          {!searchQuery.isLoading && results.length ? results.map((result, index) => (
            <Link key={`${result.type}-${index}`} to={result.href || "/dashboard"} className="block rounded-md bg-white p-3 text-sm hover:bg-slate-100">
              <div className="font-semibold text-slate-900">{result.title}</div>
              <div className="mt-1 text-slate-600">{result.snippet}</div>
              <div className="mt-1 text-xs font-medium text-slate-500">{[result.source_label, result.teacher_name].filter(Boolean).join(" • ")}</div>
            </Link>
          )) : null}
          {!searchQuery.isLoading && !results.length ? <div className="text-sm text-slate-500">Try a teacher name, lesson, coaching note, or report.</div> : null}
        </div>
      ) : null}
    </Panel>
  );
}

export function SchoolAdminPilotDashboard() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("semester");
  const [query, setQuery] = useState("");
  const dashboardQuery = useQuery({
    queryKey: ["admin-workspace-dashboard", "school", period],
    queryFn: () => adminWorkspaceApi.dashboard({ period }).then((res) => res.data),
    retry: 1,
  });
  const searchQuery = useQuery({
    queryKey: ["admin-workspace-search", "school", query],
    queryFn: () => adminWorkspaceApi.search({ q: query }).then((res) => res.data),
    enabled: query.trim().length > 1,
  });
  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed({ persona: "k12", scope: "current_workspace" }),
    onSuccess: (response) => {
      const counts = response?.data?.counts || {};
      toast.success(`Demo workspace filled with ${counts.teachers || 0} teacher and ${counts.videos || 0} lessons.`);
      invalidateWorkspaceQueries(queryClient);
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Demo seeding is available only in demo workspaces.");
    },
  });
  const data = dashboardQuery.data || {};
  const summary = data.summary || {};

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="School Dashboard"
          description="Start with the patterns, lessons, and follow-up moves that need your attention today."
          actions={
            <div className="flex flex-wrap gap-3">
              {data.demo_eligible ? (
                <Button type="button" variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                  {seedMutation.isPending ? "Filling..." : "Fill demo workspace"}
                </Button>
              ) : null}
              <Link to="/observation/new" className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan observation</Link>
            </div>
          }
        />

        {dashboardQuery.isLoading ? <LoadingState message="Preparing coaching priorities..." /> : null}
        {dashboardQuery.isError ? <ErrorState title="Dashboard needs a refresh" message="Try again in a moment, then start from the teacher list if the dashboard still needs time." /> : null}

        {!dashboardQuery.isLoading && !dashboardQuery.isError ? (
          <div className="space-y-6">
            <SetupAssistantPanel mode="school" />
            <SearchPanel query={query} setQuery={setQuery} searchQuery={searchQuery} />

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Active teachers" value={summary.active_teachers} hint="Teachers connected to this workspace" />
              <StatCard label="Reviewed lessons" value={summary.reviewed_lessons} hint="Lesson feedback ready this period" />
              <StatCard label="Open coaching tasks" value={summary.open_coaching_tasks} hint="Next steps still in motion" />
              <StatCard label="Reports ready" value={summary.reports_ready} hint="Snapshots ready to review" />
            </section>

            <section>
              <SectionHeader title="Next best actions" description="Choose the first useful move for today." />
              <SimpleList
                items={data.next_best_actions || []}
                emptyTitle="Once a few lessons are reviewed, coaching priorities and patterns will appear here."
                render={(item) => (
                  <Panel key={item.id || item.title} className="border-primary/20 bg-primary/5">
                    <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                    {item.href ? <Link to={item.href} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary">{item.cta_label || "Open"}</Link> : null}
                  </Panel>
                )}
              />
            </section>

            <section>
              <SectionHeader title="Today’s coaching priorities" description="Use these cards to choose the first useful move, not to chase every metric at once." />
              {(data.priority_cards || []).length ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.priority_cards.map((card) => <PriorityCard key={card.id || card.title} card={card} />)}
                </div>
              ) : (
                <EmptyState title="Priorities will appear as lesson feedback builds." message="Once a few lessons have been reviewed, patterns and follow-up priorities will appear here." />
              )}
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Teachers needing attention" description="Start with teachers who need a fresh look or a coaching follow-up." />
                <SimpleList
                  items={data.teacher_attention || []}
                  emptyTitle="Teacher attention items will appear here as observations and coaching notes build."
                  render={(item) => (
                    <Link key={item.teacher_id || item.teacher_name} to={item.href || "/teachers"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.teacher_name}</div>
                      <p className="mt-2 text-sm text-slate-600">{item.reason}</p>
                    </Link>
                  )}
                />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Recent lessons" description="Open a lesson, then choose one follow-up move." />
                <SimpleList
                  items={data.recent_lessons || []}
                  emptyTitle="Recent lessons will appear after recordings are reviewed."
                  render={(lesson) => (
                    <Link key={lesson.assessment_id || lesson.video_id || lesson.title} to={lesson.href || "/reports"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{lesson.teacher_name}</div>
                      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{lesson.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{lesson.summary}</p>
                    </Link>
                  )}
                />
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Observation gaps" description="Plan short visits for teachers who have gone longest without a fresh look." />
                <SimpleList
                  items={data.observation_gaps || []}
                  emptyTitle="Observation coverage is current."
                  render={(gap) => (
                    <Link key={gap.teacher_id} to={gap.recommended_href || `/observation/new?teacher_id=${gap.teacher_id}`} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{gap.teacher_name}</div>
                      <p className="mt-2 text-sm text-slate-600">{gap.days_since_last_observation == null ? "No observation yet this cycle." : `${gap.days_since_last_observation} days since the last observation.`}</p>
                    </Link>
                  )}
                />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Coaching activity" description="Goals and follow-up notes that are still moving." />
                <SimpleList
                  items={data.coaching_activity || []}
                  emptyTitle="Coaching activity will appear after the first shared follow-up."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/coaching"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="mt-2 text-sm text-slate-600">{[item.teacher_name, item.status].filter(Boolean).join(" • ")}</p>
                    </Link>
                  )}
                />
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <Panel className="space-y-4">
                <SectionHeader title="Recognition candidates" description="Strong moments worth celebrating." />
                <SimpleList
                  items={data.recognition_candidates || []}
                  emptyTitle="Recognition candidates will appear here."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/recognition"} className="block rounded-md border border-emerald-100 bg-emerald-50 p-4">
                      <div className="font-semibold text-emerald-950">{item.teacher_name || item.title}</div>
                      <p className="mt-2 text-sm leading-6 text-emerald-900">{item.description}</p>
                    </Link>
                  )}
                />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Gradebook reminders" description="Demo-ready reminders for future gradebook sync." />
                <SimpleList
                  items={data.gradebook_reminders || []}
                  emptyTitle="Gradebook reminders will appear here for demo workspaces."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/dashboard"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="mt-2 text-xs font-semibold text-slate-500">Demo reminder — LMS sync is not connected yet.</p>
                    </Link>
                  )}
                />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Reports and trends" description="Snapshots and patterns for your next team conversation." />
                <SimpleList
                  items={[...(data.reports || []), ...(data.trends || [])]}
                  emptyTitle="Reports and trends will appear after a few reviewed lessons."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/reports"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="mt-2 text-sm text-slate-600">{item.description}</p>
                    </Link>
                  )}
                />
              </Panel>
            </div>

            <div className="flex justify-end">
              <select value={period} onChange={(event) => setPeriod(event.target.value)} className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="semester">Semester</option>
                <option value="year">Year</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default SchoolAdminPilotDashboard;
