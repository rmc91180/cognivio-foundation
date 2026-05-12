export { Button } from "./Button";
export { Panel } from "./Panel";
export { Field, Input, Select, Textarea } from "./Field";
export { Badge } from "./Badge";
export { PageHeader } from "./PageHeader";
export { PageContextHeader } from "./PageContextHeader";
export { SectionHeader } from "./SectionHeader";
export { Dialog } from "./Dialog";
export { LoadingState, EmptyState, ErrorState, SuccessState } from "./StatePanel";
export { TableShell, DataTable } from "./Table";

export function SkeletonTable({ rows = 5, columns = 4, className = "" }) {
  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      </div>

      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="grid gap-4 px-4 py-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <div
                key={columnIndex}
                className="h-4 animate-pulse rounded bg-slate-200"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}