import React from "react";

function capacityTone(capacityState) {
  if (capacityState === "at_limit") return "text-rose-700 bg-rose-50 border-rose-200";
  if (capacityState === "near_limit") return "text-amber-700 bg-amber-50 border-amber-200";
  if (capacityState === "available") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

export function InstitutionSuggestionList({
  suggestions = [],
  title,
  emptyLabel,
  onSelect,
  selectLabel = "Use this institution",
}) {
  if (!suggestions.length) {
    return emptyLabel ? <p className="mt-2 text-xs text-slate-500">{emptyLabel}</p> : null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
      {title ? <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div> : null}
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <button
            key={`${suggestion.organization_id || suggestion.organization_name}-${suggestion.school_name || "root"}`}
            type="button"
            onClick={() => onSelect?.(suggestion)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{suggestion.organization_name}</div>
                {suggestion.school_name ? <div className="mt-1 text-xs text-slate-600">{suggestion.school_name}</div> : null}
                {suggestion.manager_email ? <div className="mt-1 text-[11px] text-slate-500">{suggestion.manager_email}</div> : null}
              </div>
              {suggestion.capacity_state ? (
                <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${capacityTone(suggestion.capacity_state)}`}>
                  {suggestion.capacity_state.replace("_", " ")}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500">
                {suggestion.seat_limit
                  ? `${suggestion.active_user_count || 0}/${suggestion.seat_limit} active seats`
                  : `${suggestion.active_user_count || 0} active users`}
              </div>
              <span className="text-[11px] font-semibold text-primary">{selectLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
