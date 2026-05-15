import React, { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { assessmentApi, reportApi, teacherApi, trainingApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { getEffectiveWorkspaceMode, getHomeRoute } from "@/lib/roleRouter";

const countReviewedLessons = (payload) => {
  const roster = payload?.roster || [];
  return roster.reduce((total, row) => total + Number(row.assessment_count || 0), 0);
};

function SnapshotCard({ label, value, hint }) {
  return (
    <Panel className="min-h-[118px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
      {hint ? <div className="mt-2 text-sm text-slate-600">{hint}</div> : null}
    </Panel>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const mode = getEffectiveWorkspaceMode(user);

  const rosterQuery = useQuery({
    queryKey: ["reports-roster"],
    enabled: mode === "school",
    queryFn: () => assessmentApi.roster({}).then((res) => res.data),
  });
  const tasksQuery = useQuery({
    queryKey: ["reports-coaching-tasks"],
    enabled: mode === "school",
    queryFn: () => teacherApi.coachingTasks().then((res) => res.data),
  });
  const trainingQuery = useQuery({
    queryKey: ["reports-training-summary"],
    enabled: mode === "training",
    queryFn: () => trainingApi.supervisorSummary().then((res) => res.data),
  });
  const historyQuery = useQuery({
    queryKey: ["reports-history"],
    enabled: mode === "school",
    queryFn: () => reportApi.history().then((res) => res.data),
    retry: 1,
  });

  const roster = rosterQuery.data?.roster || [];
  const openTasks = tasksQuery.data?.tasks?.filter((task) => task.status !== "completed") || [];
  const patterns = useMemo(() => {
    const needsDiscussion = roster.filter((row) => (row.action_items || []).length || row.trend_30d === "declining");
    return needsDiscussion.length
      ? [
          {
            title: "Student discussion is a common growth area this period.",
            body: `${needsDiscussion.length} teacher${needsDiscussion.length === 1 ? "" : "s"} would benefit from a focused follow-up conversation.`,
          },
        ]
      : [];
  }, [roster]);

  if (mode === "teacher") {
    return <Navigate to={getHomeRoute(user)} replace />;
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={mode === "training" ? "Cohort Snapshot" : "Coaching Snapshot"}
          description={mode === "training" ? "A concise view of cohort observation progress." : "A concise view of reviewed lessons, open coaching work, and patterns worth discussing."}
        />

        {mode === "training" ? (
          <>
            {trainingQuery.isLoading ? <LoadingState message="Preparing cohort report..." /> : null}
            {!trainingQuery.isLoading ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SnapshotCard label="Active trainees" value={trainingQuery.data?.total_trainees ?? 0} />
                  <SnapshotCard label="Completed observations" value={trainingQuery.data?.observations_this_cycle ?? 0} />
                  <SnapshotCard label="At-risk trainees" value={trainingQuery.data?.trainees_at_risk ?? 0} />
                  <SnapshotCard label="Upcoming observations" value={(trainingQuery.data?.upcoming_observations || []).length} />
                </div>
                <Panel className="space-y-4">
                  <SectionHeader title="Recent observation summaries" description="Use these notes to plan your next supervisor check-ins." />
                  {(trainingQuery.data?.recent_observations || []).length ? (
                    <div className="space-y-3">
                      {trainingQuery.data.recent_observations.map((item, index) => (
                        <div key={`${item.trainee_id}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                          <div className="mt-1 text-sm leading-6 text-slate-600">{item.summary || "A short summary will appear after the observation is reviewed."}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No recent cohort summaries yet" message="Recent observation summaries will appear here after lessons are reviewed." />
                  )}
                </Panel>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {rosterQuery.isLoading ? <LoadingState message="Preparing coaching report..." /> : null}
            {!rosterQuery.isLoading ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SnapshotCard label="Reviewed lessons" value={countReviewedLessons(rosterQuery.data)} />
                  <SnapshotCard label="Open coaching tasks" value={openTasks.length} />
                  <SnapshotCard label="Teachers with recent feedback" value={roster.filter((row) => row.last_assessment_date).length} />
                  <SnapshotCard label="Recognition earned" value={roster.reduce((total, row) => total + Number(row.recognition_count || 0), 0)} />
                </div>
                <Panel className="space-y-4">
                  <SectionHeader title="Patterns worth noticing" description="Use these as starting points for grade-team or one-on-one coaching conversations." />
                  {patterns.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {patterns.map((pattern) => (
                        <div key={pattern.title} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                          <div className="font-semibold text-slate-900">{pattern.title}</div>
                          <div className="mt-2 text-sm leading-6 text-slate-600">{pattern.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Patterns will appear after reviewed lessons build up." />
                  )}
                </Panel>
                <Panel className="space-y-4">
                  <SectionHeader title="Exports" description="Use existing exports when you need a portable record." />
                  {(historyQuery.data?.reports || historyQuery.data?.items || []).length ? (
                    <div className="text-sm text-slate-600">Recent exports are available in report history.</div>
                  ) : (
                    <div className="text-sm text-slate-600">CSV export is available from existing report tools when report history is present.</div>
                  )}
                </Panel>
              </div>
            ) : null}
          </>
        )}
      </div>
    </LayoutShell>
  );
}
