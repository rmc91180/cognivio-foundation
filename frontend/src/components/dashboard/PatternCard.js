import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  TrendingDown,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui";

const severityStyles = {
  info: {
    border: "border-l-teal-500",
    icon: "bg-teal-50 text-teal-700",
    label: "text-teal-700",
  },
  warning: {
    border: "border-l-amber-500",
    icon: "bg-amber-50 text-amber-700",
    label: "text-amber-700",
  },
  critical: {
    border: "border-l-red-500",
    icon: "bg-red-50 text-red-700",
    label: "text-red-700",
  },
};

function initials(name) {
  return String(name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function PatternIcon({ type }) {
  if (type === "trend") return <TrendingDown className="h-4 w-4" />;
  if (type === "risk") return <AlertTriangle className="h-4 w-4" />;
  if (type === "cluster") return <Users className="h-4 w-4" />;
  if (type === "improvement") return <CheckCircle2 className="h-4 w-4" />;
  return <Info className="h-4 w-4" />;
}

export function PatternCard({ pattern }) {
  const [expanded, setExpanded] = useState(false);
  const severity = pattern?.severity || "info";
  const styles = severityStyles[severity] || severityStyles.info;
  const names = pattern?.affected_teacher_names || [];
  const visibleNames = names.slice(0, 3);
  const hiddenCount = Math.max(0, names.length - visibleNames.length);

  return (
    <article
      className={`rounded-lg border border-slate-200 border-l-4 ${styles.border} bg-white p-4 shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <div className={`rounded-md p-2 ${styles.icon}`}>
          <PatternIcon type={pattern?.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${styles.label}`}>
              {severity}
            </span>
            {pattern?.element_code ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {pattern.element_code}
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">
            {pattern?.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {pattern?.description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center">
          {visibleNames.map((name, index) => (
            <div
              key={`${name}-${index}`}
              title={name}
              className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-xs font-semibold text-white first:ml-0"
            >
              {initials(name)}
            </div>
          ))}
          {hiddenCount > 0 ? (
            <div className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs font-semibold text-slate-700">
              +{hiddenCount}
            </div>
          ) : null}
          <span className="ml-3 text-xs text-slate-500">
            {pattern?.evidence_count || names.length || 0} evidence points
          </span>
        </div>

        <Button size="sm" variant="secondary" type="button" className="max-w-full justify-start text-left">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {pattern?.recommended_action || "Open action plan"}
        </Button>
      </div>

      {names.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded ? "Hide details" : "Show affected teachers"}
          </button>
          {expanded ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {names.map((name) => (
                <span
                  key={name}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
