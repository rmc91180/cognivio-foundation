import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function formatMeta(metadata) {
  return Object.entries(metadata || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" • ");
}

export function MasterAdminDependenciesPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-dependencies"],
    queryFn: () => masterAdminApi.dependencies().then((res) => res.data),
  });

  return (
    <MasterAdminPageScaffold
      title="Master Admin dependencies"
      description="Platform dependency health across database, storage, email, AI runtime, and hosting."
      meta="This is the platform-level dependency panel, not the school admin ops view."
      actions={
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      }
      railNote="Use dependencies to confirm whether a failure is systemic. If Atlas, R2, Resend, or OpenAI is degraded, troubleshoot there before touching user records."
    >
        {isLoading ? <LoadingState message="Loading dependency health..." /> : null}
        {isError ? <ErrorState title="Unable to load dependency health" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <>
            <MasterAdminMetricGrid className="xl:grid-cols-2">
              <MasterAdminMetricCard label="Healthy" value={data?.summary?.healthy ?? 0} tone="success" />
              <MasterAdminMetricCard label="Unhealthy" value={data?.summary?.unhealthy ?? 0} tone="danger" />
            </MasterAdminMetricGrid>
            <div className="grid gap-6 xl:grid-cols-2">
              {(data?.items || []).map((item) => (
                <Panel key={item.id} className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{item.name}</h2>
                      <p className="text-sm text-slate-500">Last probe {item.latest_probe_at || "—"}</p>
                    </div>
                    <Badge variant={item.healthy ? "success" : "danger"}>{item.status}</Badge>
                  </div>
                  <div className="text-sm text-slate-700">
                    {item.latest_failure_note || "No active failure note."}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">Suggested remediation</div>
                    <div className="mt-1">{item.remediation}</div>
                  </div>
                  {formatMeta(item.metadata) ? (
                    <div className="text-xs text-slate-500">{formatMeta(item.metadata)}</div>
                  ) : null}
                </Panel>
              ))}
            </div>
          </>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
