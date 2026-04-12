import React from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

export function MasterAdminAIQualityPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-ai-quality"],
    queryFn: () => masterAdminApi.aiQuality().then((res) => res.data),
  });

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Admin AI quality"
          description="Global AI quality, specialist activity, and failure clustering across the platform."
          meta="This is the platform-wide intelligence review layer."
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? "Refreshing..." : "Refresh"}
            </button>
          }
        />
        <MasterAdminSectionNav />
        {isLoading ? <LoadingState message="Loading AI quality..." /> : null}
        {isError ? <ErrorState title="Unable to load AI quality" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Feedback records", data?.metrics?.total_feedback ?? 0],
                ["Useful feedback", data?.metrics?.useful_feedback ?? 0],
                ["Not useful", data?.metrics?.not_useful_feedback ?? 0],
                ["Useful rate", data?.metrics?.useful_feedback_rate ?? "—"],
                ["Overrides", data?.metrics?.total_overrides ?? 0],
                ["Active incidents", data?.metrics?.active_incidents ?? 0],
              ].map(([label, value]) => (
                <Panel key={label} className="space-y-1 bg-slate-50">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-2xl font-semibold text-slate-900">{value}</div>
                </Panel>
              ))}
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Failure clusters</h2>
                  <p className="text-sm text-slate-500">See which issue types are repeating across the platform.</p>
                </div>
                {(data?.failure_clusters || []).length ? (
                  <div className="space-y-3">
                    {data.failure_clusters.map((cluster) => (
                      <div key={cluster.incident_type} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{cluster.incident_type}</div>
                        <div className="mt-1 text-sm text-slate-600">{cluster.count} active incident(s)</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No active failure clusters" message="The current platform issue queue is clear." />
                )}
              </Panel>
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Specialist activity</h2>
                  <p className="text-sm text-slate-500">Review specialist usage and trace volume without leaving the backend console.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div>Total traces: {data?.specialist_activity?.total_traces ?? 0}</div>
                  <div>Total specialist steps: {data?.specialist_activity?.total_specialist_steps ?? 0}</div>
                </div>
                {(data?.specialist_activity?.specialists || []).length ? (
                  <div className="space-y-3">
                    {data.specialist_activity.specialists.map((item) => (
                      <div key={item.specialist_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{item.name || item.specialist_id}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {item.invocations} invocations • {item.modified_count} modified outputs
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No specialist activity" message="Specialist traces will appear here once they are recorded." />
                )}
              </Panel>
            </div>
            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">By workspace</h2>
                <p className="text-sm text-slate-500">Compare quality and failure pressure across workspaces.</p>
              </div>
              {(data?.by_workspace || []).length ? (
                <div className="space-y-3">
                  {data.by_workspace.map((row) => (
                    <div key={row.owner_user_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="font-medium text-slate-900">{row.owner_email || row.owner_user_id}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.workspace_mode} • {row.upload_count} uploads • {row.assessment_count} assessments • {row.failure_count} failures
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No workspace quality data yet" message="Workspace comparisons will appear here as platform usage grows." />
              )}
            </Panel>
          </>
        ) : null}
      </div>
    </LayoutShell>
  );
}
