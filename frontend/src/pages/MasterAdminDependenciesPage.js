import React from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
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
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Admin dependencies"
          description="Platform dependency health across database, storage, email, AI runtime, and hosting."
          meta="This is the platform-level dependency panel, not the school admin ops view."
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
        {isLoading ? <LoadingState message="Loading dependency health..." /> : null}
        {isError ? <ErrorState title="Unable to load dependency health" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Panel className="space-y-1 bg-slate-50">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Healthy</div>
                <div className="text-2xl font-semibold text-slate-900">{data?.summary?.healthy ?? 0}</div>
              </Panel>
              <Panel className="space-y-1 bg-slate-50">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unhealthy</div>
                <div className="text-2xl font-semibold text-slate-900">{data?.summary?.unhealthy ?? 0}</div>
              </Panel>
            </div>
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
      </div>
    </LayoutShell>
  );
}
