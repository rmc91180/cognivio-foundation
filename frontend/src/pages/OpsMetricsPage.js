import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { LoadingState, ErrorState, PageHeader, Panel } from "@/components/ui";
import { opsApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

function formatNumber(value, locale) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0";
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value % 1 === 0 ? 0 : 3,
  }).format(value);
}

function MetricCard({ title, value, hint }) {
  return (
    <Panel className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="text-3xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-sm text-slate-500">{hint}</div> : null}
    </Panel>
  );
}

export function OpsMetricsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["ops-observability"],
    enabled: isAdmin,
    queryFn: () => opsApi.observability().then((res) => res.data),
    refetchInterval: 30000,
  });

  const generatedAt = data?.generated_at
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.generated_at))
    : null;

  const persistentMetrics = data?.persistent_metrics || {};
  const counters = persistentMetrics.counters || {};
  const queues = persistentMetrics.queues || {};
  const dependencies = persistentMetrics.dependencies || {};
  const observability = data?.observability || {};
  const recentFailures = observability.analysis?.recent_failures || [];

  if (!isAdmin) {
    return (
      <LayoutShell>
        <div className="p-6">
          <ErrorState
            title={t("opsMetrics.adminRequiredTitle")}
            message={t("opsMetrics.adminRequiredMessage")}
          />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="p-6 space-y-6">
        <PageHeader
          title={t("opsMetrics.title")}
          description={t("opsMetrics.description")}
          meta={generatedAt ? t("opsMetrics.generatedAt", { date: generatedAt }) : null}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? t("opsMetrics.refreshing") : t("opsMetrics.refresh")}
            </button>
          }
        />

        {isLoading ? <LoadingState message={t("opsMetrics.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("opsMetrics.loadFailedTitle")}
            message={t("opsMetrics.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title={t("opsMetrics.analysisRuns")}
                value={formatNumber(counters.analysis_runs_total || 0, locale)}
                hint={t("opsMetrics.cumulativeCounterHint")}
              />
              <MetricCard
                title={t("opsMetrics.uploads")}
                value={formatNumber(counters.uploads_total || 0, locale)}
                hint={t("opsMetrics.cumulativeCounterHint")}
              />
              <MetricCard
                title={t("opsMetrics.transcriptions")}
                value={formatNumber(counters.transcription_runs_total || 0, locale)}
                hint={t("opsMetrics.cumulativeCounterHint")}
              />
              <MetricCard
                title={t("opsMetrics.estimatedCost")}
                value={`$${formatNumber(counters.analysis_estimated_cost_usd_total || 0, locale)}`}
                hint={t("opsMetrics.trailingCostHint")}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("opsMetrics.queueBacklogTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("opsMetrics.queueBacklogDescription")}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {["video", "privacy", "maintenance"].map((jobType) => (
                    <div key={jobType} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-medium text-slate-700">{t(`opsMetrics.jobTypes.${jobType}`)}</div>
                      <div className="mt-3 space-y-2 text-sm text-slate-600">
                        <div>{t("opsMetrics.queued")}: {formatNumber(queues.queued?.[jobType] || 0, locale)}</div>
                        <div>{t("opsMetrics.processing")}: {formatNumber(queues.processing?.[jobType] || 0, locale)}</div>
                        <div>{t("opsMetrics.stuck")}: {formatNumber(queues.stuck?.[jobType] || 0, locale)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("opsMetrics.dependencyHealthTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("opsMetrics.dependencyHealthDescription")}</p>
                </div>
                <div className="space-y-3">
                  {["mongodb", "openai", "storage", "railway_runtime"].map((dependency) => {
                    const healthy = Number(dependencies?.[dependency] || 0) === 1;
                    return (
                      <div
                        key={dependency}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="text-sm font-medium text-slate-700">
                          {t(`opsMetrics.dependencies.${dependency}`)}
                        </div>
                        <div
                          className={[
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            healthy
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-rose-100 text-rose-700",
                          ].join(" ")}
                        >
                          {healthy ? t("opsMetrics.healthy") : t("opsMetrics.unhealthy")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("opsMetrics.analysisRollingTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("opsMetrics.analysisRollingDescription")}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">{t("opsMetrics.averageDuration")}</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {formatNumber(observability.analysis?.average_duration_seconds || 0, locale)}s
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">{t("opsMetrics.averageInputTokens")}</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {formatNumber(observability.analysis?.average_estimated_input_tokens || 0, locale)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">{t("opsMetrics.averageOutputTokens")}</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {formatNumber(observability.analysis?.average_estimated_output_tokens || 0, locale)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">{t("opsMetrics.failedRuns")}</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {formatNumber(observability.analysis?.failed_runs || 0, locale)}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("opsMetrics.recentFailuresTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("opsMetrics.recentFailuresDescription")}</p>
                </div>
                {recentFailures.length ? (
                  <div className="space-y-3">
                    {recentFailures.slice(0, 5).map((failure, index) => (
                      <div key={`${failure.video_id || "unknown"}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-sm font-medium text-slate-800">
                          {failure.video_id || t("opsMetrics.unknownVideo")}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{failure.failure_reason || t("opsMetrics.unknownFailure")}</div>
                        <div className="mt-2 text-xs text-slate-400">{failure.recorded_at || ""}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("opsMetrics.noRecentFailures")}
                  </div>
                )}
              </Panel>
            </div>
          </>
        ) : null}
      </div>
    </LayoutShell>
  );
}

