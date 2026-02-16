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

  const items = Array.isArray(insights?.items)
    ? insights.items
        .filter(
          (item) =>
            item &&
            typeof item.insight === "string" &&
            item.insight.trim() &&
            typeof item.action === "string" &&
            item.action.trim()
        )
        .slice(0, 7)
        .map((item) => ({
          insight: item.insight.trim(),
          action: item.action.trim(),
          priority: ["high", "medium", "low"].includes(item.priority) ? item.priority : "medium",
          owner: ["principal", "coach", "teacher"].includes(item.owner) ? item.owner : "principal",
          due_window_days: Number.isInteger(item.due_window_days) ? item.due_window_days : 14,
          target_teacher_name:
            typeof item.target_teacher_name === "string" && item.target_teacher_name.trim()
              ? item.target_teacher_name.trim()
              : null,
        }))
    : [];
  const fallbackBullets = Array.isArray(insights?.bullets)
    ? insights.bullets.filter((item) => typeof item === "string" && item.trim()).slice(0, 7)
    : [];
  const actionableItems =
    items.length > 0
      ? items
      : fallbackBullets.map((bullet) => ({
          insight: bullet,
          action: "Assign an owner and review this signal in the next leadership check-in.",
          priority: "medium",
          owner: "principal",
          due_window_days: 14,
          target_teacher_name: null,
        }));
  const generatedBy = insights?.generated_by === "ai" ? "AI generated" : "Rules fallback";
  const priorityClassByValue = {
    high: "bg-rose-50 text-rose-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-emerald-50 text-emerald-700",
  };
  const ownerLabelByValue = {
    principal: "Principal",
    coach: "Coach",
    teacher: "Teacher",
  };

  return (
    <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Leadership insights</h2>
          <p className="text-xs text-slate-500">
            High-level movement, intervention priorities, and emerging focus areas.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-medium ${
            insights?.generated_by === "ai"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {generatedBy}
        </span>
      </div>

      {actionableItems.length === 0 ? (
        <div className="text-xs text-slate-500">No leadership insights yet for this filter set.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {actionableItems.map((item, index) => (
            <article key={`${item.insight}-${index}`} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-900">
                  {index + 1}. {item.insight}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    priorityClassByValue[item.priority] || priorityClassByValue.medium
                  }`}
                >
                  {item.priority}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Action:</span> {item.action}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span>Owner: {ownerLabelByValue[item.owner] || ownerLabelByValue.principal}</span>
                <span>Due: {item.due_window_days}d</span>
                {item.target_teacher_name && <span>Teacher: {item.target_teacher_name}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
