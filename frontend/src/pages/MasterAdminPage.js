import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { InternalReadinessPanel } from "@/components/master-admin/InternalReadinessPanel";
import { demoApi, masterAdminApi } from "@/lib/api";
import { runtimeConfig } from "@/lib/runtimeConfig";

function SectionCard({ section, t }) {
  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">{section.title}</div>
          <div className="mt-1 text-sm text-slate-600">{section.description}</div>
        </div>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
            section.status === "active"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {section.status === "active"
            ? t("masterAdmin.statusActive")
            : t("masterAdmin.statusPlanned")}
        </span>
      </div>
    </Panel>
  );
}

export function MasterAdminPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: bootstrapData } = useQuery({
    queryKey: ["master-admin-bootstrap"],
    queryFn: () => masterAdminApi.bootstrap().then((res) => res.data),
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-overview"],
    queryFn: () => masterAdminApi.overview().then((res) => res.data),
  });
  const demoMode = Boolean(runtimeConfig.demoMode || bootstrapData?.demo_mode);
  const demoResetMutation = useMutation({
    mutationFn: (persona) => demoApi.reset(persona).then((res) => res.data),
    onSuccess: (result) => {
      toast.success("Demo data reset.");
      queryClient.invalidateQueries();
      refetch();
      queryClient.setQueryData(["master-admin-demo-last-reset"], result);
    },
    onError: () => toast.error("Demo reset is not available right now."),
  });
  const lastReset = queryClient.getQueryData(["master-admin-demo-last-reset"]);

  return (
    <MasterAdminPageScaffold
      title={t("masterAdmin.title")}
      description={t("masterAdmin.description")}
      meta={t("masterAdmin.meta", { email: bootstrapData?.user?.email || "—" })}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {demoMode ? (
            <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              Demo Mode
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFetching ? t("masterAdmin.refreshing") : t("masterAdmin.refresh")}
          </button>
        </div>
      }
      railNoteTitle={t("masterAdmin.internalOnlyTitle")}
      railNote={t("masterAdmin.internalOnlyDescription")}
    >

        {isLoading ? <LoadingState message={t("masterAdmin.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdmin.loadFailedTitle")}
            message={t("masterAdmin.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <>
            {demoMode ? (
              <Panel className="space-y-4 border-amber-200 bg-amber-50">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-amber-950">Pilot demo controls</h2>
                    <p className="mt-1 text-sm text-amber-900">
                      Reset only the marked demo records for a repeatable walkthrough.
                    </p>
                    {lastReset?.reset_at ? (
                      <p className="mt-2 text-xs text-amber-800">Last reset: {lastReset.reset_at}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["k12", "Reset K-12 demo"],
                      ["training", "Reset Training demo"],
                      ["all", "Reset all"],
                    ].map(([persona, label]) => (
                      <button
                        key={persona}
                        type="button"
                        onClick={() => demoResetMutation.mutate(persona)}
                        disabled={demoResetMutation.isPending}
                        className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Panel>
            ) : null}

            <InternalReadinessPanel />

            <MasterAdminMetricGrid>
              {(data?.cards || []).map((card) => (
                <MasterAdminMetricCard
                  key={card.id}
                  label={card.title}
                  value={card.value}
                  hint={card.hint}
                  tone={card.tone === "danger" ? "danger" : card.tone === "warning" ? "warning" : "neutral"}
                />
              ))}
            </MasterAdminMetricGrid>

            <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.alertsTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdmin.alertsDescription")}</p>
                </div>
                <div className="space-y-3">
                  {(data?.alerts || []).map((alert) => (
                    <div
                      key={alert.id}
                      className={[
                        "rounded-2xl border p-4",
                        alert.severity === "danger"
                          ? "border-rose-200 bg-rose-50"
                          : alert.severity === "warning"
                            ? "border-amber-200 bg-amber-50"
                            : "border-emerald-200 bg-emerald-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">{alert.title}</div>
                          <div className="mt-1 text-sm text-slate-600">{alert.message}</div>
                        </div>
                        <Badge
                          variant={
                            alert.severity === "danger"
                              ? "danger"
                              : alert.severity === "warning"
                                ? "warning"
                                : "success"
                          }
                        >
                          {t(`masterAdmin.alertSeverity.${alert.severity}`)}
                        </Badge>
                      </div>
                      {alert.action_path ? (
                        <div className="mt-3">
                          <Link
                            to={alert.action_path}
                            className="text-sm font-medium text-primary hover:text-primary/80"
                          >
                            {alert.action_label || t("masterAdmin.open")}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="space-y-6">
                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.dependenciesTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.dependenciesDescription")}</p>
                  </div>
                  <div className="space-y-2 text-sm text-slate-600">
                    <div>
                      {t("masterAdmin.healthyDependencies")}{" "}
                      <span className="font-semibold text-slate-900">
                        {data?.dependency_summary?.healthy_count ?? 0}
                      </span>
                    </div>
                    <div>
                      {t("masterAdmin.unhealthyDependencies")}{" "}
                      <span className="font-semibold text-slate-900">
                        {(data?.dependency_summary?.unhealthy || []).length}
                      </span>
                    </div>
                    {(data?.dependency_summary?.unhealthy || []).length ? (
                      <div className="rounded-xl bg-white p-3 text-sm text-slate-700">
                        {(data?.dependency_summary?.unhealthy || []).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </Panel>

                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.queueTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.queueDescription")}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queueVideo")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.video_queue_depth ?? 0}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queuePrivacy")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.privacy_queue_depth ?? 0}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queueTranscode")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.transcode_queue_depth ?? 0}
                      </div>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.pendingTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.pendingDescription")}</p>
                  </div>
                  <Link to="/master-admin/users?approval_status=pending" className="text-sm font-medium text-primary">
                    {t("masterAdmin.openUsers")}
                  </Link>
                </div>
                <div className="space-y-3">
                  {(data?.pending_approvals_preview || []).length ? (
                    data.pending_approvals_preview.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.meta}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      {t("masterAdmin.nonePending")}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.pipelineTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.pipelineDescription")}</p>
                  </div>
                  <Link to="/videos" className="text-sm font-medium text-primary">
                    {t("masterAdmin.openVideos")}
                  </Link>
                </div>
                <div className="space-y-3">
                  {(data?.pipeline_blockers_preview || []).length ? (
                    data.pipeline_blockers_preview.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.meta}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      {t("masterAdmin.noneBlocked")}
                    </div>
                  )}
                </div>
              </Panel>
            </div>

            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.sectionsTitle")}</h2>
                <p className="text-sm text-slate-500">{t("masterAdmin.sectionsDescription")}</p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(bootstrapData?.sections || []).map((section) => (
                  <SectionCard key={section.id} section={section} t={t} />
                ))}
              </div>
            </Panel>
          </>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
