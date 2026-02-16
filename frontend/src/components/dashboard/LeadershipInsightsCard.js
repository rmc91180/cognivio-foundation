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

  const bullets = Array.isArray(insights?.bullets)
    ? insights.bullets.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
    : [];
  const generatedBy = insights?.generated_by === "ai" ? "AI generated" : "Rules fallback";

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

      {bullets.length === 0 ? (
        <div className="text-xs text-slate-500">No leadership insights yet for this filter set.</div>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
