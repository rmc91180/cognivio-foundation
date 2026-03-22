import { useTranslation } from "react-i18next";

function isLikelyEnglish(value) {
  return typeof value === "string" && /[A-Za-z]{3,}/.test(value) && !/[\u0590-\u05FF]/.test(value);
}

export function LeadershipInsightsCard({ insights, isLoading }) {
  const { t, i18n } = useTranslation();

  if (isLoading) {
    return (
      <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("dashboard.leadershipInsightsTitle")}
        </h2>
        <div className="mt-3 space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
        </div>
      </section>
    );
  }

  const normalizeText = (value) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  const teacherNamePattern = /\b(Mr|Ms|Mrs|Mx|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/;
  const defaultFallbackItems = [
    {
      insight: t("dashboard.leadershipFallback1Insight"),
      action: t("dashboard.leadershipFallback1Action"),
    },
    {
      insight: t("dashboard.leadershipFallback2Insight"),
      action: t("dashboard.leadershipFallback2Action"),
    },
    {
      insight: t("dashboard.leadershipFallback3Insight"),
      action: t("dashboard.leadershipFallback3Action"),
    },
    {
      insight: t("dashboard.leadershipFallback4Insight"),
      action: t("dashboard.leadershipFallback4Action"),
    },
  ];

  const items = Array.isArray(insights?.items)
    ? insights.items
        .filter((item) => item && normalizeText(item.insight) && normalizeText(item.action))
        .map((item) => ({
          insight: normalizeText(item.insight),
          action: normalizeText(item.action),
          target_teacher_name: normalizeText(item.target_teacher_name),
        }))
    : [];
  const nonTeacherSpecificItems = items.filter((item) => {
    if (item.target_teacher_name) return false;
    const combinedText = `${item.insight} ${item.action}`;
    return !teacherNamePattern.test(combinedText);
  });
  const fallbackBullets = Array.isArray(insights?.bullets)
    ? insights.bullets.filter((item) => normalizeText(item))
    : [];
  const fallbackItems = fallbackBullets.map((bullet) => ({
    insight: normalizeText(bullet),
    action: t("dashboard.leadershipBulletFallbackAction"),
  }));
  const dedupedItems = [];
  const seenInsights = new Set();
  const normalizedItems = [...nonTeacherSpecificItems, ...fallbackItems].map((item) => {
    if (
      i18n.language?.startsWith("he") &&
      (isLikelyEnglish(item.insight) || isLikelyEnglish(item.action))
    ) {
      return null;
    }
    return item;
  });
  [...normalizedItems.filter(Boolean), ...defaultFallbackItems].forEach((item) => {
    const key = item.insight.toLowerCase();
    if (seenInsights.has(key)) return;
    seenInsights.add(key);
    dedupedItems.push(item);
  });
  const actionableItems = dedupedItems.slice(0, 4);

  return (
    <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {t("dashboard.leadershipInsightsTitle")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("dashboard.leadershipInsightsDescription")}
          </p>
        </div>
      </div>

      {actionableItems.length === 0 ? (
        <div className="text-xs text-slate-500">
          {t("dashboard.leadershipInsightsEmpty")}
        </div>
      ) : (
        <div className="space-y-2">
          {actionableItems.map((item, index) => (
            <article key={`${item.insight}-${index}`} className="rounded-lg border border-slate-200 p-3">
              <h3 className="text-sm font-medium text-slate-900">
                {index + 1}. {item.insight}
              </h3>
              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">
                  {t("dashboard.leadershipFocusLabel")}
                </span>{" "}
                {item.action}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
