import React from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { reportApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { getEffectiveWorkspaceMode, getHomeRoute } from "@/lib/roleRouter";

function SnapshotCard({ label, value, hint }) {
  return (
    <Panel className="min-h-[118px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value ?? 0}</div>
      {hint ? <div className="mt-2 text-sm text-slate-600">{hint}</div> : null}
    </Panel>
  );
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function ExportButton({ mode }) {
  const [isExporting, setIsExporting] = React.useState(false);
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response =
        mode === "training"
          ? await reportApi.exportCohortSnapshotCsv()
          : await reportApi.exportCoachingSnapshotCsv();
      downloadBlob(response.data, mode === "training" ? "cohort-snapshot.csv" : "coaching-snapshot.csv");
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isExporting}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
    >
      {isExporting ? "Preparing CSV..." : "Export CSV"}
    </button>
  );
}

function PatternList({ patterns }) {
  if (!patterns?.length) {
    return (
      <EmptyState
        title="Patterns will appear after reviewed lessons build up."
        message="The snapshot will highlight plain-language trends and the next action they point toward."
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {patterns.map((pattern) => (
        <div key={pattern.id || pattern.title} className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="font-semibold text-slate-900">{pattern.title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{pattern.description}</p>
          <p className="mt-3 text-sm font-medium text-slate-800">{pattern.recommended_action}</p>
        </div>
      ))}
    </div>
  );
}

function CoachingSnapshotReport({ snapshot }) {
  const summary = snapshot?.summary || {};
  const teacherRows = snapshot?.teacher_rows || [];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <SnapshotCard label="Reviewed lessons" value={summary.reviewed_lessons} />
        <SnapshotCard label="Teachers with feedback" value={summary.teachers_with_feedback} />
        <SnapshotCard label="Open coaching tasks" value={summary.open_coaching_tasks} />
        <SnapshotCard label="Completed tasks" value={summary.completed_coaching_tasks} />
        <SnapshotCard label="Recognition earned" value={summary.recognition_earned} />
        <SnapshotCard label="Observation gaps" value={summary.observation_gaps} />
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Patterns worth noticing" description="Use these as starting points for team or one-on-one coaching conversations." />
          <ExportButton mode="school" />
        </div>
        <PatternList patterns={snapshot?.patterns || []} />
      </Panel>

      <Panel className="space-y-4">
        <SectionHeader title="Teacher rows" description="A concise planning list with the next useful action for each teacher." />
        {teacherRows.length ? (
          <>
            <div className="space-y-3 md:hidden">
              {teacherRows.map((row) => (
                <div key={row.teacher_id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{row.teacher_name}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{row.latest_summary || "Lesson feedback will appear here after a reviewed recording."}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="rounded-md bg-white px-3 py-2"><strong className="block text-slate-900">{row.reviewed_lessons}</strong>Reviewed lessons</div>
                    <div className="rounded-md bg-white px-3 py-2"><strong className="block text-slate-900">{row.open_tasks}</strong>Open tasks</div>
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-800">{row.next_action}</p>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Teacher</th>
                    <th className="py-2 pr-4">Reviewed lessons</th>
                    <th className="py-2 pr-4">Open tasks</th>
                    <th className="py-2 pr-4">Latest coaching summary</th>
                    <th className="py-2 pr-4">Next action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teacherRows.map((row) => (
                    <tr key={row.teacher_id}>
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.teacher_name}</td>
                      <td className="py-3 pr-4 text-slate-600">{row.reviewed_lessons}</td>
                      <td className="py-3 pr-4 text-slate-600">{row.open_tasks}</td>
                      <td className="max-w-sm py-3 pr-4 text-slate-600">{row.latest_summary || "Lesson feedback will appear here after a reviewed recording."}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.next_action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="Teacher rows will appear here." message="Once teachers are connected to this workspace, their snapshot rows will be ready." />
        )}
      </Panel>
    </div>
  );
}

function CohortSnapshotReport({ snapshot }) {
  const summary = snapshot?.summary || {};
  const traineeRows = snapshot?.trainee_rows || [];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SnapshotCard label="Active trainees" value={summary.active_trainees} />
        <SnapshotCard label="Completed observations" value={summary.completed_observations} />
        <SnapshotCard label="Upcoming observations" value={summary.upcoming_observations} />
        <SnapshotCard label="At risk" value={summary.trainees_at_risk} />
        <SnapshotCard label="Not started" value={summary.trainees_not_started} />
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Trainee status" description="A planning view for supervisor check-ins and placement observations." />
          <ExportButton mode="training" />
        </div>
        {traineeRows.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {traineeRows.map((row) => (
              <div key={row.trainee_id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{row.trainee_name}</div>
                    <p className="mt-1 text-sm text-slate-600">{row.placement_site || "Placement site will appear once assigned."}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{row.status}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{row.latest_summary || "Recent observation feedback will appear here after review."}</p>
                <p className="mt-3 text-sm font-medium text-slate-800">{row.next_action}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Trainee rows will appear here." message="Once trainees are connected to this workspace, their status rows will be ready." />
        )}
      </Panel>

      <Panel className="space-y-4">
        <SectionHeader title="Recent observation summaries" description="A quick read on what trainees are working on now." />
        {(snapshot?.recent_observations || []).length ? (
          <div className="space-y-3">
            {snapshot.recent_observations.map((item, index) => (
              <div key={`${item.trainee_id}-${index}`} className="rounded-md border border-slate-200 bg-white p-4">
                <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Recent summaries will appear here." message="Reviewed observations will create short summaries for supervisor planning." />
        )}
      </Panel>
    </div>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const mode = getEffectiveWorkspaceMode(user);

  const schoolQuery = useQuery({
    queryKey: ["reports-coaching-snapshot"],
    enabled: mode === "school" || mode === "master",
    queryFn: () => reportApi.coachingSnapshot().then((res) => res.data),
  });
  const trainingQuery = useQuery({
    queryKey: ["reports-cohort-snapshot"],
    enabled: mode === "training",
    queryFn: () => reportApi.cohortSnapshot().then((res) => res.data),
  });

  if (mode === "teacher") {
    return <Navigate to={getHomeRoute(user)} replace />;
  }

  const isTraining = mode === "training";
  const activeQuery = isTraining ? trainingQuery : schoolQuery;

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title={isTraining ? "Cohort Snapshot" : "Coaching Snapshot"}
          description={isTraining ? "A concise view of trainee observation progress and next supervisor moves." : "A concise view of reviewed lessons, open coaching work, and patterns worth discussing."}
        />

        {activeQuery.isLoading ? <LoadingState message={isTraining ? "Preparing cohort report..." : "Preparing coaching report..."} /> : null}
        {activeQuery.isError ? (
          <ErrorState title="Report needs a refresh" message="Try again in a moment. The dashboard can still help you choose the next coaching move." />
        ) : null}

        {!activeQuery.isLoading && !activeQuery.isError ? (
          isTraining ? <CohortSnapshotReport snapshot={trainingQuery.data} /> : <CoachingSnapshotReport snapshot={schoolQuery.data} />
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default ReportsPage;
