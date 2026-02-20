export function LeadershipInsightsCard({ insights, isLoading }) {
  if (isLoading) {
    return (
      <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Leadership insights</h2>
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
      insight: "Review where progress has slowed across departments.",
      action: "Set one support priority per department for the next leadership check-in.",
    },
    {
      insight: "Confirm recording and observation coverage is consistent.",
      action: "Close evidence gaps so trend decisions are based on complete data.",
    },
    {
      insight: "Focus coaching on domains with the largest decline.",
      action: "Assign owners and define a short cycle to monitor impact.",
    },
    {
      insight: "Protect and replicate what is improving school-wide.",
      action: "Identify the strongest routines and scale them through PLCs.",
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
    action: "Decide the next principal-led action and review progress in the next leadership meeting.",
  }));
  const dedupedItems = [];
  const seenInsights = new Set();
  [...nonTeacherSpecificItems, ...fallbackItems, ...defaultFallbackItems].forEach((item) => {
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
          <h2 className="text-sm font-semibold text-slate-900">Leadership insights</h2>
          <p className="text-xs text-slate-500">
            Four principal priorities in plain language.
          </p>
        </div>
      </div>

      {actionableItems.length === 0 ? (
        <div className="text-xs text-slate-500">No leadership insights yet for this filter set.</div>
      ) : (
        <div className="space-y-2">
          {actionableItems.map((item, index) => (
            <article key={`${item.insight}-${index}`} className="rounded-lg border border-slate-200 p-3">
              <h3 className="text-sm font-medium text-slate-900">
                {index + 1}. {item.insight}
              </h3>
              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Focus:</span> {item.action}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
