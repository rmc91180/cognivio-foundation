import React from "react";
import { useQueries } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

const DIMENSION_LABELS = {
  specificity: "Specificity",
  evidence_grounding: "Evidence grounding",
  usefulness: "Usefulness",
  modality_discipline: "Modality discipline",
  coach_voice: "Coach voice",
};

const formatScore = (value) => (typeof value === "number" ? value.toFixed(2) : "—");

export function MasterAdminAIQualityPage() {
  const [latestQuery, historyQuery] = useQueries({
    queries: [
      {
        queryKey: ["master-admin-ai-quality-latest"],
        queryFn: () => masterAdminApi.aiQualityLatest().then((res) => res.data),
      },
      {
        queryKey: ["master-admin-ai-quality-history"],
        queryFn: () => masterAdminApi.aiQualityHistory().then((res) => res.data),
      },
    ],
  });

  const latest = latestQuery.data || {};
  const history = historyQuery.data?.items || [];
  const dimensions = Object.keys(DIMENSION_LABELS);
  const noData = latest?.no_data || (!latestQuery.isLoading && !Object.keys(latest?.scores || {}).length);
  const refetch = () => {
    latestQuery.refetch();
    historyQuery.refetch();
  };

  return (
    <MasterAdminPageScaffold
      title="Master Admin AI quality"
      description="Eval gate scores, coach voice monitoring, and recent quality failures."
      meta="This view is sanitized for operations review."
      actions={
        <button
          type="button"
          onClick={refetch}
          disabled={latestQuery.isFetching || historyQuery.isFetching}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {latestQuery.isFetching || historyQuery.isFetching ? "Refreshing..." : "Refresh"}
        </button>
      }
      railNote="Use this to spot quality drift and coach voice problems. Manual eval runs stay deferred until they can be safely bounded."
    >
      {latestQuery.isLoading || historyQuery.isLoading ? <LoadingState message="Loading AI quality..." /> : null}
      {latestQuery.isError || historyQuery.isError ? <ErrorState title="Unable to load AI quality" message="Refresh and try again." /> : null}
      {!latestQuery.isLoading && !historyQuery.isLoading && !latestQuery.isError && !historyQuery.isError ? (
        <div className="space-y-6">
          {noData ? (
            <Panel>
              <EmptyState
                title="Quality history will appear here after the eval gate runs."
                message="The dashboard is ready, but no saved quality history file was found."
              />
            </Panel>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">
                  Last run: {latest.run_at || "Unknown"}
                </div>
                <div className="mt-1">
                  Git SHA: {latest.git_sha || "Not recorded"} • Trigger: {latest.triggered_by || "Not recorded"} • Status:{" "}
                  <span className={latest.passed ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                    {latest.passed ? "Passed" : "Needs attention"}
                  </span>
                </div>
              </div>

              <MasterAdminMetricGrid className="xl:grid-cols-5">
                {dimensions.map((dimension) => {
                  const score = latest.scores?.[dimension];
                  const threshold = latest.thresholds?.[dimension];
                  const passed = typeof score === "number" && typeof threshold === "number" ? score >= threshold : null;
                  return (
                    <MasterAdminMetricCard
                      key={dimension}
                      label={DIMENSION_LABELS[dimension]}
                      value={formatScore(score)}
                      tone={passed === false ? "danger" : passed ? "success" : "neutral"}
                      hint={typeof threshold === "number" ? `Threshold ${threshold.toFixed(2)}` : "No threshold"}
                    />
                  );
                })}
              </MasterAdminMetricGrid>

              <div className="grid gap-6 xl:grid-cols-[1fr,0.85fr]">
                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Recent failures</h2>
                    <p className="text-sm text-slate-500">Cases below threshold in the latest eval run.</p>
                  </div>
                  {(latest.failures || []).length ? (
                    <div className="space-y-3">
                      {latest.failures.map((failure, index) => {
                        const delta = Number(failure.score || 0) - Number(failure.threshold || 0);
                        return (
                          <div key={`${failure.case_id}-${failure.dimension}-${index}`} className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm">
                            <div className="font-semibold text-rose-950">{failure.case_id || "Unknown case"}</div>
                            <div className="mt-1 text-rose-800">
                              {DIMENSION_LABELS[failure.dimension] || failure.dimension}: {formatScore(failure.score)} / {formatScore(failure.threshold)} ({delta.toFixed(2)})
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title="No recent failures" message="The latest saved eval run met every configured threshold." />
                  )}
                </Panel>

                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Coach Voice monitor</h2>
                    <p className="text-sm text-slate-500">Teacher-facing feedback should sound warm, specific, and actionable.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">
                      Current coach voice score: {formatScore(latest.scores?.coach_voice)}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      The eval checks for direct coaching language, next-lesson usefulness, and banned system phrases.
                    </p>
                  </div>
                  {(latest.banned_phrases || []).length ? (
                    <div className="space-y-2">
                      {latest.banned_phrases.map((item, index) => (
                        <div key={`${item.case_id}-${item.phrase}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          {item.case_id}: “{item.phrase}”
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No banned phrases detected" message="The latest saved run did not flag coach voice banned phrases." />
                  )}
                </Panel>
              </div>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">History</h2>
                  <p className="text-sm text-slate-500">Recent eval runs saved by CI or manual tooling.</p>
                </div>
                {history.length ? (
                  <div className="space-y-2">
                    {history.slice(0, 8).map((run, index) => (
                      <div key={`${run.run_at}-${index}`} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-[1fr_auto]">
                        <div>
                          <div className="font-semibold text-slate-900">{run.run_at || "Unknown run"}</div>
                          <div className="mt-1 text-slate-500">{run.git_sha || "No git sha"} • {run.triggered_by || "Unknown trigger"}</div>
                        </div>
                        <div className={run.passed ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                          {run.passed ? "Passed" : "Needs attention"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Quality history will appear here after the eval gate runs." />
                )}
              </Panel>
            </>
          )}
        </div>
      ) : null}
    </MasterAdminPageScaffold>
  );
}
