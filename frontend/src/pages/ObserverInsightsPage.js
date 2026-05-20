import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const normalizeInsights = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.insights)) return payload.insights;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

export default function ObserverInsightsPage() {
  const [insights, setInsights] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadInsights = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/api/observer/insights");
        if (!active) return;

        setInsights(normalizeInsights(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setInsights([]);
        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Observer insights are not available right now."
        );
        setStatus("error");
      }
    };

    loadInsights();

    return () => {
      active = false;
    };
  }, []);

  const insightCount = useMemo(() => insights.length, [insights]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Observer Tools
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Observer Insights
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Review patterns across observations, coaching priorities, and evidence signals.
          </p>
          <div className="mt-4 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            {insightCount} insight{insightCount === 1 ? "" : "s"}
          </div>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading observer insights…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="font-semibold text-amber-900">
              Insights could not be loaded
            </h2>
            <p className="mt-2 text-sm text-amber-800">{error}</p>
          </div>
        )}

        {status === "ready" && insights.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              No insights yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Insights will appear after observation and feedback data becomes available.
            </p>
          </div>
        )}

        {status === "ready" && insights.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {insights.map((insight, index) => {
              const id = insight?.id || insight?._id || index;
              const title =
                insight?.title ||
                insight?.name ||
                insight?.category ||
                "Observation Insight";
              const summary =
                insight?.summary ||
                insight?.description ||
                insight?.message ||
                "A pattern identified from observation and feedback evidence.";

              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <h2 className="text-lg font-semibold text-slate-900">
                    {title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {summary}
                  </p>

                  {insight?.priority && (
                    <div className="mt-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {insight.priority}
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
