import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * MonthlySummary - Displays aggregated performance summary for a period
 * @param {object} dashboardRes - Teacher dashboard payload
 * @param {number} periodMonths - Period in months (1, 3, 6, 12)
 */
export function MonthlySummary({
  dashboardRes,
  periodMonths = 3,
  evidenceByElement = {},
  onViewEvidence,
}) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const summaryData = useMemo(() => {
    if (!dashboardRes?.assessments?.length) {
      return null;
    }

    const trendData = dashboardRes.trend_data || [];
    const elementSummary = dashboardRes.element_summary || [];
    const elementNameById = elementSummary.reduce((acc, item) => {
      acc[item.element_id] = item.element_name;
      return acc;
    }, {});

    const domainStats = {};
    trendData.forEach((point) => {
      Object.entries(point.element_scores || {}).forEach(([elementId, score]) => {
        if (!domainStats[elementId]) {
          domainStats[elementId] = {
            elementId,
            name: elementNameById[elementId] || elementId,
            firstScore: score,
            lastScore: score,
            samples: 1,
          };
        } else {
          if (domainStats[elementId].firstScore == null) {
            domainStats[elementId].firstScore = score;
          }
          domainStats[elementId].lastScore = score;
          domainStats[elementId].samples += 1;
        }
      });
    });

    const domainDeltas = Object.values(domainStats).map((item) => {
      const baseline = item.firstScore ?? item.lastScore ?? 0;
      const latest = item.lastScore ?? item.firstScore ?? 0;
      const delta = latest - baseline;
      return {
        ...item,
        baseline,
        latest,
        delta,
      };
    });

    const highlights = [...domainDeltas]
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    const growthAreas = [...domainDeltas]
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3);

    const periodLabel =
      periodMonths === 1
        ? t("monthlySummary.last1Month")
        : periodMonths === 3
          ? t("monthlySummary.last3Months")
          : periodMonths === 6
            ? t("monthlySummary.last6Months")
            : t("monthlySummary.last12Months");

    const observationByElement = (dashboardRes.element_summary || []).reduce(
      (acc, item) => {
        if (item.element_id) {
          acc[item.element_id] = item.recent_observations || [];
        }
        return acc;
      },
      {}
    );

    const makeWhyDetails = (elementId) => {
      const evidenceItems = evidenceByElement[elementId] || [];
      const evidenceLines = evidenceItems.slice(0, 2).map((ev) => {
        const time =
          typeof ev.timestamp_start === "number" && typeof ev.timestamp_end === "number"
            ? ` (${Math.round(ev.timestamp_start)}s-${Math.round(ev.timestamp_end)}s)`
            : "";
        return `${ev.evidence_text}${time}`;
      });
      const observationLines = (observationByElement[elementId] || [])
        .slice(0, 2)
        .map((obs) => obs.admin_comment || obs.summary || "")
        .filter(Boolean);
      return [...evidenceLines, ...observationLines].slice(0, 2);
    };

    const baseRecommendations = (domainName, evidenceLines = []) => {
      const name = (domainName || "").toLowerCase();
      const evidenceText = evidenceLines.join(" ").toLowerCase();
      const recs = [];

      if (name.includes("instruction") || evidenceText.includes("question")) {
        recs.push(t("monthlySummary.recHigherOrderQuestioning"));
      }
      if (name.includes("classroom environment") || evidenceText.includes("routine")) {
        recs.push(t("monthlySummary.recRoutines"));
      }
      if (name.includes("planning") || name.includes("preparation")) {
        recs.push(t("monthlySummary.recObjectives"));
      }
      if (name.includes("professional")) {
        recs.push(t("monthlySummary.recReflection"));
      }
      if (evidenceText.includes("teacher talk")) {
        recs.push(t("monthlySummary.recTeacherTalk"));
      }
      if (evidenceText.includes("engage") || evidenceText.includes("participation")) {
        recs.push(t("monthlySummary.recParticipation"));
      }
      if (evidenceText.includes("checks for understanding") || evidenceText.includes("assessment")) {
        recs.push(t("monthlySummary.recExitTicket"));
      }

      if (!recs.length) {
        recs.push(t("monthlySummary.recFallback", { domain: domainName }));
      }

      return recs.slice(0, 2);
    };

    const growthAreaDetails = growthAreas.map((area) => {
      const whyDetails = makeWhyDetails(area.elementId);
      const recommendations = baseRecommendations(area.name, whyDetails);
      return { ...area, whyDetails, recommendations };
    });

    return {
      domainDeltas,
      highlights,
      growthAreas: growthAreaDetails,
      assessmentCount: dashboardRes.assessments.length,
      periodLabel,
    };
  }, [dashboardRes, periodMonths, evidenceByElement, t]);

  if (!summaryData) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          {t("monthlySummary.title")}
        </h2>
        <div className="text-xs text-slate-500">
          {t("monthlySummary.noData")}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("monthlySummary.title")}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
          {summaryData.periodLabel}
        </span>
      </div>

      <div className="mb-4 text-xs text-slate-500">
        {t("monthlySummary.assessmentCount", {
          count: summaryData.assessmentCount,
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {summaryData.domainDeltas.map((domain) => {
          const trend =
            domain.delta > 0.2 ? "up" : domain.delta < -0.2 ? "down" : "flat";
          const trendClass =
            trend === "up"
              ? "text-emerald-700 bg-emerald-50"
              : trend === "down"
                ? "text-rose-700 bg-rose-50"
                : "text-slate-600 bg-slate-100";
          const deltaLabel =
            domain.delta > 0 ? `+${domain.delta.toFixed(1)}` : domain.delta.toFixed(1);
          const evidenceCount = (evidenceByElement[domain.elementId] || []).length;
          return (
            <div
              key={domain.elementId}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-slate-800">
                  {domain.name}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${trendClass}`}>
                  {trend === "up"
                    ? t("monthlySummary.improving")
                    : trend === "down"
                      ? t("monthlySummary.declining")
                      : t("monthlySummary.stable")}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                <span>{t("monthlySummary.baselineLatest", {
                  baseline: domain.baseline.toFixed(1),
                  latest: domain.latest.toFixed(1),
                })}</span>
                <span className="font-semibold text-slate-700">{deltaLabel}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>{t("monthlySummary.evidenceItems", { count: evidenceCount })}</span>
                {typeof onViewEvidence === "function" && (
                  <button
                    type="button"
                    onClick={() => onViewEvidence(domain.elementId)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    {t("monthlySummary.viewEvidence")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Highlights */}
      {summaryData.highlights.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
            {t("monthlySummary.highlights")}
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryData.highlights.map((h) => (
              <span
                key={h.elementId}
                className="inline-flex items-center rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700"
              >
                {h.name}
                <span className={`${isRtl ? "mr-1.5" : "ml-1.5"} font-semibold`}>
                  {h.delta > 0 ? `+${h.delta.toFixed(1)}` : h.delta.toFixed(1)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Areas for growth */}
      {summaryData.growthAreas.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
            {t("monthlySummary.growthAreas")}
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryData.growthAreas.map((l) => (
              <span
                key={l.elementId}
                className="inline-flex items-center rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700"
              >
                {l.name}
                <span className={`${isRtl ? "mr-1.5" : "ml-1.5"} font-semibold`}>
                  {l.delta > 0 ? `+${l.delta.toFixed(1)}` : l.delta.toFixed(1)}
                </span>
              </span>
            ))}
          </div>
          {summaryData.growthAreas.map((l) => (
            <div
              key={`${l.elementId}-why`}
              className="mt-3 rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-900"
            >
              <div className="font-semibold text-amber-800">
                {t("monthlySummary.whyThisMoved", { name: l.name })}
              </div>
              {l.whyDetails?.length ? (
                <div className="mt-1 space-y-1 text-amber-800">
                  {l.whyDetails.map((line, idx) => (
                    <div key={idx}>• {line}</div>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-amber-700">
                  {t("monthlySummary.limitedEvidence")}
                </div>
              )}
              {l.recommendations?.length ? (
                <div className="mt-2 text-amber-900">
                  <div className="font-semibold">{t("monthlySummary.nextSteps")}</div>
                  <div className="mt-1 space-y-1">
                    {l.recommendations.map((rec, idx) => (
                      <div key={idx}>• {rec}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MonthlySummary;
