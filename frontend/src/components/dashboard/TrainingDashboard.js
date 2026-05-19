import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, Field, Input, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { adminWorkspaceApi, demoApi } from "@/lib/api";
import { SetupAssistantPanel } from "@/components/dashboard/SetupAssistantPanel";

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
    <Panel className="min-h-[126px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value ?? 0}</div>
      {hint ? <div className="mt-2 text-sm leading-6 text-slate-600">{hint}</div> : null}
    </Panel>
  );
}

function SimpleList({ items, emptyTitle, render }) {
  if (!items?.length) return <EmptyState title={emptyTitle} />;
  return <div className="space-y-3">{items.map(render)}</div>;
}

export function TrainingDashboard() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("semester");
  const [query, setQuery] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-workspace-dashboard", "training", period],
    queryFn: () => adminWorkspaceApi.dashboard({ period }).then((res) => res.data),
    retry: 1,
  });
  const searchQuery = useQuery({
    queryKey: ["admin-workspace-search", "training", query],
    queryFn: () => adminWorkspaceApi.search({ q: query }).then((res) => res.data),
    enabled: query.trim().length > 1,
  });
  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed({ persona: "training", scope: "current_workspace" }),
    onSuccess: (response) => {
      const counts = response?.data?.counts || {};
      toast.success(`Demo workspace filled with ${counts.teachers || 0} trainee and ${counts.videos || 0} lessons.`);
      invalidateWorkspaceQueries(queryClient);
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Demo seeding is available only in demo workspaces.");
    },
  });
  const summary = data?.summary || {};
  const results = searchQuery.data?.results || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="Supervisor Dashboard"
          description="A focused view of trainee progress, placement observations, and who needs your next touchpoint."
          actions={
            <div className="flex flex-wrap gap-3">
              {data?.demo_eligible ? (
                <Button type="button" variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                  {seedMutation.isPending ? "Filling..." : "Fill demo workspace"}
                </Button>
              ) : null}
              <Link to="/observation/new" className="inline-flex min-h-[44px] items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan observation</Link>
            </div>
          }
        />

        {isLoading ? <LoadingState message="Preparing your cohort view..." /> : null}

        {isError ? (
          <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-900">
            The cohort view is not available right now. Try again in a moment.
          </Panel>
        ) : null}

        {!isLoading && !isError ? (
          <div className="space-y-6">
            <SetupAssistantPanel mode="training" />

            <Panel>
              <Field label="Search this training workspace">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trainees, observations, coaching, reports..." className="pl-9" />
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
                  {!searchQuery.isLoading && !results.length ? <div className="text-sm text-slate-500">Try a trainee name, observation, coaching note, or report.</div> : null}
                </div>
              ) : null}
            </Panel>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Active trainees" value={summary.active_trainees} hint="Student teachers connected to your program." />
              <StatCard label="Reviewed observations" value={summary.reviewed_lessons} hint="Observation feedback ready this period." />
              <StatCard label="Open coaching tasks" value={summary.open_coaching_tasks} hint="Next steps still in motion." />
              <StatCard label="Reports ready" value={summary.reports_ready} hint="Cohort snapshots ready to review." />
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Next best actions" description="Choose the first useful move for this cohort." />
              <SimpleList
                items={data?.next_best_actions || []}
                emptyTitle="Once a few observations are reviewed, cohort priorities and patterns will appear here."
                render={(item) => (
                  <Link key={item.id || item.title} to={item.href || "/dashboard"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  </Link>
                )}
              />
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Trainees needing attention" description="Start with trainees who need a fresh observation or coaching follow-up." />
                <SimpleList
                  items={data?.teacher_attention || []}
                  emptyTitle="Trainee attention items will appear here as observations build."
                  render={(item) => (
                    <Link key={item.teacher_id || item.teacher_name} to={item.href || "/teachers"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.teacher_name}</div>
                      <p className="mt-2 text-sm text-slate-600">{item.reason}</p>
                    </Link>
                  )}
                />
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Recent observations" description="A quick read on what your trainees are working on now." />
                <SimpleList
                  items={data?.recent_lessons || []}
                  emptyTitle="Recent observation summaries will appear after lessons are reviewed."
                  render={(item) => (
                    <Link key={item.assessment_id || item.video_id || item.title} to={item.href || "/reports"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.teacher_name}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>
                    </Link>
                  )}
                />
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Observation gaps" description="Plan the next touchpoints across placements." />
                <SimpleList
                  items={data?.observation_gaps || []}
                  emptyTitle="Planned observations will appear here."
                  render={(item) => (
                    <Link key={item.teacher_id} to={item.recommended_href || `/observation/new?teacher_id=${item.teacher_id}`} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.teacher_name}</div>
                      <p className="mt-2 text-sm text-slate-600">{item.days_since_last_observation == null ? "No observation yet this cycle." : `${item.days_since_last_observation} days since the last observation.`}</p>
                    </Link>
                  )}
                />
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Cohort reports and trends" description="Snapshots and patterns for your next supervisor meeting." />
                <SimpleList
                  items={[...(data?.reports || []), ...(data?.trends || [])]}
                  emptyTitle="Cohort reports and trends will appear after reviewed observations."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/reports"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="mt-2 text-sm text-slate-600">{item.description}</p>
                    </Link>
                  )}
                />
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Recognition candidates" description="Strong trainee moments worth celebrating." />
                <SimpleList
                  items={data?.recognition_candidates || []}
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
                <SectionHeader title="Gradebook reminders" description="Demo-ready reminders for future program sync." />
                <SimpleList
                  items={data?.gradebook_reminders || []}
                  emptyTitle="Gradebook reminders will appear here for demo workspaces."
                  render={(item) => (
                    <Link key={item.id || item.title} to={item.href || "/dashboard"} className="block rounded-md border border-slate-200 bg-white p-4 hover:bg-slate-50">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="mt-2 text-xs font-semibold text-slate-500">Demo reminder — LMS sync is not connected yet.</p>
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

export default TrainingDashboard;
