import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { demoApi, teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const formatDate = (value) => {
  if (!value) return "Soon";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(parsed));
};

function CardList({ items, emptyTitle }) {
  if (!items?.length) return <EmptyState title={emptyTitle} />;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <Link key={item.id || `${item.title}-${index}`} to={item.href || "/my-workspace"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
          <div className="font-semibold text-slate-900">{item.title}</div>
          {item.description ? <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p> : null}
        </Link>
      ))}
    </div>
  );
}

export function TeacherWorkspacePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("semester");
  const [query, setQuery] = useState("");
  const dashboardQuery = useQuery({
    queryKey: ["teacher-dashboard", period],
    queryFn: () => teacherApi.myDashboard({ period }).then((res) => res.data),
    retry: 1,
  });
  const searchQuery = useQuery({
    queryKey: ["teacher-search", query],
    queryFn: () => teacherApi.mySearch({ q: query }).then((res) => res.data),
    enabled: query.trim().length > 1,
  });
  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed({ persona: "teacher", scope: "current_teacher" }),
    onSuccess: (response) => {
      const counts = response?.data?.counts || {};
      toast.success(`Demo workspace filled with ${counts.videos || 0} lessons and ${counts.coaching_tasks || 0} goals.`);
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
      ].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      );
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Demo seeding is available only in demo workspaces.");
    },
  });

  const data = dashboardQuery.data || {};
  const readiness = data.readiness || {};
  const missingItem = readiness.missing_items?.[0];
  const latestLesson = data.latest_lesson;
  const gradebook = data.gradebook_reminders || [];
  const searchResults = searchQuery.data?.results || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }]}
          title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
          description="Start with your next best action, then move between lessons, coaching, recognition, and reminders."
          badge="Teacher workspace"
          actions={
            data.demo_eligible ? (
              <Button type="button" variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? "Filling..." : "Fill my demo workspace"}
              </Button>
            ) : null
          }
        />

        {dashboardQuery.isLoading ? <LoadingState message="Opening your workspace..." /> : null}
        {dashboardQuery.isError ? <ErrorState title="Your workspace could not be opened" message="Try again in a moment. Your lessons and coaching notes are still saved." /> : null}

        {!dashboardQuery.isLoading && !dashboardQuery.isError ? (
          <div className="space-y-6">
            <Panel className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
              <div>
                <Field label="Search your workspace">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lessons, moments, goals, reflections, recognition..." className="pl-9" />
                  </div>
                </Field>
                {query.trim().length > 1 ? (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {searchQuery.isLoading ? <div className="text-sm text-slate-500">Searching...</div> : null}
                    {!searchQuery.isLoading && searchResults.length ? searchResults.map((result, index) => (
                      <Link key={`${result.type}-${index}`} to={result.href} className="block rounded-md bg-white p-3 text-sm hover:bg-slate-100">
                        <div className="font-semibold text-slate-900">{result.title}</div>
                        <div className="mt-1 text-slate-600">{result.snippet}</div>
                        <div className="mt-1 text-xs font-medium text-slate-500">{result.source_label}</div>
                      </Link>
                    )) : null}
                    {!searchQuery.isLoading && !searchResults.length ? <div className="text-sm text-slate-500">Try a lesson title, coaching goal, or recognition name.</div> : null}
                  </div>
                ) : null}
              </div>
              {missingItem ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Setup next step</div>
                  <div className="mt-2 font-semibold text-amber-950">{missingItem.label}</div>
                  <p className="mt-2 text-sm leading-6 text-amber-900">This helps your recordings, feedback, and privacy settings stay connected.</p>
                  <Link to={missingItem.href} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-amber-950 underline">Continue</Link>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ready to record</div>
                  <div className="mt-2 font-semibold text-emerald-950">Reference images are ready for the privacy blur pipeline.</div>
                  <Link to="/record" className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-emerald-950 underline">Record or upload a lesson</Link>
                </div>
              )}
            </Panel>

            {data.next_best_action ? (
              <Panel className="border-primary/20 bg-primary/5">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Next best action</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">{data.next_best_action.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">{data.next_best_action.description}</p>
                {data.next_best_action.href ? <Link to={data.next_best_action.href} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80">Open next step</Link> : null}
              </Panel>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
              <Panel className="space-y-4">
                <SectionHeader title="Latest lesson" description="Newest recording or feedback connected to your workspace." />
                {latestLesson ? (
                  <Link to={latestLesson.href || "/my-lessons"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{latestLesson.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{[latestLesson.subject, formatDate(latestLesson.uploaded_at)].filter(Boolean).join(" • ")}</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{latestLesson.summary || "Open this recording when you are ready to revisit it."}</p>
                  </Link>
                ) : <EmptyState title="Your first lesson summary will appear here once a recording has been reviewed." message="You’ll get specific, helpful feedback about what happened in that lesson." />}
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Highlights" description="Recognition and moments worth carrying forward." />
                <CardList items={data.highlights || []} emptyTitle="Highlights will appear as your reviewed lessons build up." />
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Action items" description="Goals, reflections, reminders, and meeting prep in one place." />
                <CardList items={data.action_items || []} emptyTitle="Action items will appear after your first reviewed lesson." />
              </Panel>
              <Panel className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeader title="Trends" description="Friendly patterns from your reviewed lessons and reflections." />
                  <select value={period} onChange={(event) => setPeriod(event.target.value)} className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                    <option value="month">Month</option>
                    <option value="quarter">Quarter</option>
                    <option value="semester">Semester</option>
                    <option value="year">Year</option>
                  </select>
                </div>
                <CardList items={(data.trends || []).map((trend) => ({ ...trend, href: "/my-coaching" }))} emptyTitle="Trends will appear after a few reviewed lessons." />
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Schedule and coaching conversations" description="Upcoming observations, meetings, and recording reminders." />
                <CardList items={(data.schedule || []).map((item) => ({ ...item, description: formatDate(item.scheduled_at) }))} emptyTitle="Upcoming coaching conversations will appear here." />
              </Panel>
              <Panel className="space-y-4">
                <SectionHeader title="Gradebook reminders" description="Demo-ready reminders for future gradebook sync." />
                {gradebook.length ? gradebook.map((item) => (
                  <Link key={item.id} to={item.href || "/my-workspace"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">Demo reminder — LMS sync is not connected yet.</p>
                  </Link>
                )) : <EmptyState title="Gradebook reminders will appear here for demo workspaces." />}
              </Panel>
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Reports" description="Teacher-facing snapshots and progress notes." />
              <CardList items={data.reports || []} emptyTitle="Progress reports will appear after reviewed lessons." />
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherWorkspacePage;
