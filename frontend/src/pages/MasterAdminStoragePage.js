import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const next = bytes / 1024 ** exponent;
  return `${next.toFixed(next >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function MasterAdminStoragePage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-storage"],
    queryFn: () => masterAdminApi.storage().then((res) => res.data),
  });

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Admin storage"
          description="Inspect storage footprint, retention pressure, and asset cleanup risks."
          meta="Storage health should be visible here without shell access."
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
        {isLoading ? <LoadingState message="Loading storage summary..." /> : null}
        {isError ? <ErrorState title="Unable to load storage summary" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Raw assets", data?.summary?.raw_asset_count ?? 0],
                ["Processed assets", data?.summary?.processed_asset_count ?? 0],
                ["Raw bytes", formatBytes(data?.summary?.raw_bytes)],
                ["Processed bytes", formatBytes(data?.summary?.processed_bytes)],
                ["Retention backlog", data?.summary?.retention_backlog_count ?? 0],
                ["Orphan candidates", data?.summary?.orphan_candidate_count ?? 0],
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
                  <h2 className="text-lg font-semibold text-slate-900">Top storage consumers</h2>
                  <p className="text-sm text-slate-500">See which teachers are currently driving storage footprint.</p>
                </div>
                {(data?.top_consumers || []).length ? (
                  <div className="space-y-3">
                    {data.top_consumers.map((row) => (
                      <div key={row.teacher_id || row.teacher_name} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{row.teacher_name}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {row.video_count} video(s) • Raw {formatBytes(row.raw_bytes)} • Processed {formatBytes(row.processed_bytes)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No storage consumers yet" message="Storage usage will appear here as uploads accumulate." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Retention backlog</h2>
                  <p className="text-sm text-slate-500">Raw files that have reached the cleanup window.</p>
                </div>
                {(data?.retention_backlog || []).length ? (
                  <div className="space-y-3">
                    {data.retention_backlog.map((row) => (
                      <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{row.filename || row.id}</div>
                        <div className="mt-1 text-sm text-slate-600">Retention expired at {row.retention_expires_at}</div>
                        <div className="mt-2">
                          <Link to={`/master-admin/videos/${row.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                            Open video detail
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No retention backlog" message="No raw assets are currently waiting past their cleanup window." />
                )}
              </Panel>
            </div>

            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Orphan candidates</h2>
                <p className="text-sm text-slate-500">Assets that look incomplete or inconsistent and should be checked manually.</p>
              </div>
              {(data?.orphan_candidates || []).length ? (
                <div className="space-y-3">
                  {data.orphan_candidates.map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="font-medium text-slate-900">{row.filename || row.id}</div>
                      <div className="mt-1 text-sm text-slate-600">{row.reason}</div>
                      <div className="mt-2">
                        <Link to={`/master-admin/videos/${row.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                          Open video detail
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No orphan candidates" message="No obvious asset inconsistencies are currently flagged." />
              )}
            </Panel>
          </>
        ) : null}
      </div>
    </LayoutShell>
  );
}
