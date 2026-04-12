import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

function formatTimestamp(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

export function MasterAdminIncidentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => ({
      state: searchParams.get("state") || undefined,
      severity: searchParams.get("severity") || undefined,
    }),
    [searchParams]
  );
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-incidents", filters],
    queryFn: () => masterAdminApi.incidents(filters).then((res) => res.data),
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Master Admin incidents"
          description="Centralized queue for pipeline and operational issues."
          meta="Use this to triage active failures before they become support tickets."
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
        <Panel className="grid gap-4 md:grid-cols-4">
          {[
            ["Active", data?.summary?.active ?? 0],
            ["Resolved", data?.summary?.resolved ?? 0],
            ["Danger", data?.summary?.danger ?? 0],
            ["Warning", data?.summary?.warning ?? 0],
          ].map(([label, value]) => (
            <Panel key={label} className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="text-2xl font-semibold text-slate-900">{value}</div>
            </Panel>
          ))}
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => setFilter("state", "")}>All states</button>
            <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => setFilter("state", "active")}>Active</button>
            <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => setFilter("severity", "danger")}>Danger only</button>
          </div>
        </Panel>
        {isLoading ? <LoadingState message="Loading incidents..." /> : null}
        {isError ? <ErrorState title="Unable to load incidents" message="Refresh and try again." /> : null}
        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((incident) => (
                  <div key={incident.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{incident.incident_type}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {incident.filename || incident.video_id} • {incident.teacher_name || "Unknown teacher"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant={incident.severity === "danger" ? "danger" : "warning"}>{incident.severity}</Badge>
                        <Badge variant={incident.state === "active" ? "danger" : "success"}>{incident.state}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">{incident.latest_error || "No explicit error message recorded."}</div>
                    <div className="mt-2 text-xs text-slate-500">First seen {formatTimestamp(incident.first_seen_at)} • Last seen {formatTimestamp(incident.last_seen_at)}</div>
                    <div className="mt-3">
                      <Link to={`/master-admin/videos/${incident.video_id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                        Open video detail
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No incidents match these filters" message="The incident queue is clear for the selected view." />
            )}
          </Panel>
        ) : null}
      </div>
    </LayoutShell>
  );
}
