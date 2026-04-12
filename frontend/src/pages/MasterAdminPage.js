import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

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

  const { data: bootstrapData } = useQuery({
    queryKey: ["master-admin-bootstrap"],
    queryFn: () => masterAdminApi.bootstrap().then((res) => res.data),
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-overview"],
    queryFn: () => masterAdminApi.overview().then((res) => res.data),
  });

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdmin.title")}
          description={t("masterAdmin.description")}
          meta={t("masterAdmin.meta", { email: bootstrapData?.user?.email || "—" })}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? t("masterAdmin.refreshing") : t("masterAdmin.refresh")}
            </button>
          }
        />

        <MasterAdminSectionNav />

        <Panel className="space-y-3 border-amber-200 bg-amber-50/80">
          <div className="text-sm font-semibold text-slate-900">{t("masterAdmin.internalOnlyTitle")}</div>
          <div className="text-sm text-slate-700">{t("masterAdmin.internalOnlyDescription")}</div>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdmin.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdmin.loadFailedTitle")}
            message={t("masterAdmin.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(data?.cards || []).map((card) => (
                <Panel key={card.id} className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {card.title}
                  </div>
                  <div className="text-3xl font-semibold text-slate-900">{card.value}</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-slate-500">{card.hint}</div>
                    {card.tone !== "neutral" ? (
                      <Badge variant={card.tone === "danger" ? "danger" : "warning"}>
                        {card.tone === "danger"
                          ? t("masterAdmin.cardDanger")
                          : t("masterAdmin.cardAttention")}
                      </Badge>
                    ) : null}
                  </div>
                </Panel>
              ))}
            </div>

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
      </div>
    </LayoutShell>
  );
}
