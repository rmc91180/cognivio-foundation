import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, LoadingState, Panel } from "@/components/ui";
import { masterAdminApi } from "@/lib/api";

const stateClass = {
  healthy: "bg-emerald-100 text-emerald-800",
  unhealthy: "bg-rose-100 text-rose-800",
  disabled: "bg-slate-100 text-slate-700",
  available: "bg-sky-100 text-sky-800",
  not_seeded: "bg-slate-100 text-slate-700",
  not_applicable: "bg-slate-100 text-slate-700",
  unknown: "bg-slate-100 text-slate-700",
};

const stateLabel = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
  disabled: "Disabled",
  available: "Available",
  not_seeded: "Not seeded",
  not_applicable: "Not applicable",
  unknown: "Unknown",
};

function StatusPill({ value }) {
  const normalized = value === true ? "healthy" : value === false ? "unhealthy" : String(value || "unknown");
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateClass[normalized] || stateClass.unknown}`}>
      {stateLabel[normalized] || normalized}
    </span>
  );
}

function ReadinessCard({ title, children }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function InternalReadinessPanel() {
  const query = useQuery({
    queryKey: ["master-admin-internal-readiness"],
    queryFn: () => masterAdminApi.internalReadiness().then((res) => res.data),
    retry: 1,
  });

  if (query.isLoading) {
    return <LoadingState message="Checking internal readiness..." />;
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Internal readiness needs a refresh."
        message="Open dependencies and AI quality directly if this panel needs another moment."
      />
    );
  }

  const data = query.data || {};
  return (
    <Panel className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Internal readiness</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            A rehearsal check for demo data, dependencies, quality, and the core product flow. This is not a security certification.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/master-admin/dependencies" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Dependencies</Link>
          <Link to="/master-admin/ai-quality" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">AI Quality</Link>
          <Link to="/dashboard" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Dashboard</Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReadinessCard title="Environment">
          <div className="flex items-center justify-between gap-3"><span>Demo mode</span><StatusPill value={data.environment?.demo_mode_status || data.environment?.demo_mode} /></div>
          <div className="flex items-center justify-between gap-3"><span>Demo reset controls</span><StatusPill value={data.environment?.demo_reset_controls_status || data.demo_data?.reset_controls_status} /></div>
          <div className="flex items-center justify-between gap-3"><span>Railway</span><span>{data.environment?.railway_environment_name || "unknown"}</span></div>
          <div className="flex items-center justify-between gap-3"><span>Frontend URL</span><StatusPill value={data.environment?.frontend_url_configured} /></div>
          <div className="flex items-center justify-between gap-3"><span>Backend URL</span><StatusPill value={data.environment?.backend_public_base_url_configured} /></div>
        </ReadinessCard>

        <ReadinessCard title="Dependencies">
          {Object.entries(data.dependencies || {}).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="capitalize">{key}</span>
              <StatusPill value={value} />
            </div>
          ))}
        </ReadinessCard>

        <ReadinessCard title="Demo data">
          <div className="flex items-center justify-between gap-3"><span>K-12 seeded</span><StatusPill value={data.demo_data?.k12_seeded_status ?? data.demo_data?.k12_seeded} /></div>
          <div className="flex items-center justify-between gap-3"><span>Training seeded</span><StatusPill value={data.demo_data?.training_seeded_status ?? data.demo_data?.training_seeded} /></div>
          <div className="flex items-center justify-between gap-3"><span>Reset controls</span><StatusPill value={data.demo_data?.reset_controls_status} /></div>
          <div>Last reset: {data.demo_data?.last_reset_at || "not recorded"}</div>
        </ReadinessCard>

        <ReadinessCard title="Quality gate">
          <div className="flex items-center justify-between gap-3"><span>Latest gate</span><StatusPill value={data.quality?.latest_quality_gate_status ?? data.quality?.latest_quality_gate_passed} /></div>
          <div>Coach voice: {data.quality?.coach_voice_score ?? "unknown"}</div>
        </ReadinessCard>

        <ReadinessCard title="Product flow">
          {Object.entries(data.product_flow || {}).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span>{key.replace(/_/g, " ")}</span>
              <StatusPill value={value} />
            </div>
          ))}
        </ReadinessCard>

        <ReadinessCard title="Warnings">
          {(data.warnings || []).length ? (
            <ul className="list-disc space-y-1 pl-5">
              {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : (
            <p>Nothing needs attention for an internal rehearsal.</p>
          )}
        </ReadinessCard>
      </div>
    </Panel>
  );
}

export default InternalReadinessPanel;
