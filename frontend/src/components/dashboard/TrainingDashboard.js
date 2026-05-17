import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { reportApi } from "@/lib/api";

const formatDate = (value) => {
  if (!value) return "Not scheduled";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(parsed));
};

function StatCard({ label, value, hint }) {
  return (
    <Panel className="min-h-[126px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
      {hint ? <div className="mt-2 text-sm leading-6 text-slate-600">{hint}</div> : null}
    </Panel>
  );
}

export function TrainingDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["training-cohort-snapshot"],
    queryFn: () => reportApi.cohortSnapshot().then((res) => res.data),
  });
  const summary = data?.summary || {};
  const trainees = data?.trainee_rows || [];
  const upcomingObservations =
    data?.upcoming_observations ||
    trainees
      .filter((trainee) => trainee.next_observation_at)
      .map((trainee) => ({
        trainee_id: trainee.trainee_id,
        trainee_name: trainee.trainee_name,
        school_site: trainee.placement_site,
        scheduled_date: trainee.next_observation_at,
        focus_elements: [],
      }));

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="Supervisor Dashboard"
          description="A focused view of trainee progress, placement observations, and who needs your next touchpoint."
          actions={<Link to="/observation/new" className="inline-flex min-h-[44px] items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan observation</Link>}
        />

        {isLoading ? <LoadingState message="Preparing your cohort view..." /> : null}

        {isError ? (
          <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-900">
            The cohort view is not available right now. Try again in a moment.
          </Panel>
        ) : null}

        {!isLoading && !isError ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total trainees" value={summary.active_trainees ?? 0} hint="Student teachers connected to your program." />
              <StatCard label="Observations this cycle" value={summary.completed_observations ?? 0} hint={`${summary.upcoming_observations ?? 0} upcoming observations planned.`} />
              <StatCard label="On track" value={summary.trainees_on_track ?? 0} hint="Trainees with steady observation progress." />
              <StatCard label="Needs attention" value={summary.trainees_at_risk ?? 0} hint="Start here when planning your next check-ins." />
            </div>

            <Panel className="space-y-4">
              <SectionHeader
                title="Compliance table"
                description="Use this as the quick planning list for your observation cycle."
              />
              {trainees.length ? (
                <>
                <div className="space-y-3 md:hidden">
                  {trainees.map((trainee) => (
                    <div key={trainee.trainee_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{trainee.trainee_name}</div>
                          <div className="mt-1 text-sm text-slate-600">{trainee.placement_site || "Placement not set"}</div>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {trainee.status}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div className="rounded-md bg-white px-3 py-2">
                          <div className="font-semibold text-slate-900">{trainee.required_observations}</div>
                          <div>Required</div>
                        </div>
                        <div className="rounded-md bg-white px-3 py-2">
                          <div className="font-semibold text-slate-900">{trainee.completed_observations}</div>
                          <div>Completed</div>
                        </div>
                      </div>
                      <Link
                        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-primary ring-1 ring-slate-200 hover:bg-slate-100"
                        to={`/observation/new?teacher_id=${trainee.trainee_id}`}
                      >
                        Schedule observation
                      </Link>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-2 pr-4">Trainee</th>
                        <th className="py-2 pr-4">Placement site</th>
                        <th className="py-2 pr-4">Required</th>
                        <th className="py-2 pr-4">Completed</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trainees.map((trainee) => (
                        <tr key={trainee.trainee_id}>
                          <td className="py-3 pr-4 font-medium text-slate-900">{trainee.trainee_name}</td>
                          <td className="py-3 pr-4 text-slate-600">{trainee.placement_site || "Placement not set"}</td>
                          <td className="py-3 pr-4 text-slate-600">{trainee.required_observations}</td>
                          <td className="py-3 pr-4 text-slate-600">{trainee.completed_observations}</td>
                          <td className="py-3 pr-4">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {trainee.status}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <Link className="font-medium text-primary hover:text-primary/80" to={`/observation/new?teacher_id=${trainee.trainee_id}`}>
                              Schedule observation
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (
                <EmptyState
                  title="No trainees yet"
                  message="Trainees will appear here once they are linked to your training organization."
                />
              )}
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Upcoming observations" description="The next planned touchpoints across placements." />
                {upcomingObservations.length ? (
                  <div className="space-y-3">
                    {upcomingObservations.map((item, index) => (
                      <div key={`${item.trainee_id}-${item.scheduled_date || index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.school_site || "Placement site not set"} • {formatDate(item.scheduled_date)}</div>
                        {(item.focus_elements || []).length ? <div className="mt-2 text-xs text-slate-500">{item.focus_elements.join(", ")}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Planned observations will appear here." message="Scheduled observations for this week will appear here." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Recent observation summaries" description="A quick read on what your trainees are working on now." />
                {(data?.recent_observations || []).length ? (
                  <div className="space-y-3">
                    {data.recent_observations.map((item, index) => (
                      <div key={`${item.trainee_id}-${item.completed_date || index}`} className="rounded-md border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{item.trainee_name}</div>
                            <div className="mt-1 text-sm leading-6 text-slate-600">{item.summary || "Once a reviewed observation is saved, the summary will appear here."}</div>
                          </div>
                          <span className="shrink-0 text-xs text-slate-500">{formatDate(item.completed_date)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No recent summaries" message="Recent observation notes will appear here after lessons are reviewed." />
                )}
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TrainingDashboard;
