import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { frameworkApi } from "@/lib/api";
import { HEBREW_FRAMEWORK_LABELS } from "@/features/school-setup/constants";

export function ObservationFocusPanel({
  frameworkType = "danielson",
  priorityElements = [],
  focusNote,
  title,
  description,
  className = "",
}) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.resolvedLanguage === "he";
  const normalizedFocusNote = (focusNote || "").trim();
  const normalizedPriorityElements = useMemo(
    () => (Array.isArray(priorityElements) ? priorityElements.filter(Boolean) : []),
    [priorityElements]
  );
  const shouldRender = Boolean(normalizedFocusNote || normalizedPriorityElements.length);

  const { data: frameworkDetailRes } = useQuery({
    queryKey: ["framework-detail", frameworkType],
    queryFn: () => frameworkApi.get(frameworkType).then((res) => res.data),
    enabled: shouldRender && Boolean(frameworkType),
  });

  const priorityLabels = useMemo(() => {
    if (!normalizedPriorityElements.length) return [];
    const labelMap = {};
    (frameworkDetailRes?.domains || []).forEach((domain) => {
      (domain.elements || []).forEach((element) => {
        labelMap[element.id] =
          isHebrew && frameworkType !== "custom"
            ? HEBREW_FRAMEWORK_LABELS[frameworkType]?.[element.id] || element.name
            : element.name;
      });
    });
    return normalizedPriorityElements.map((elementId) => labelMap[elementId] || elementId);
  }, [frameworkDetailRes, frameworkType, isHebrew, normalizedPriorityElements]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className={`rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-xs text-sky-900 ${className}`}>
      <div className="font-semibold text-sky-950">
        {title || t("observationFocus.title")}
      </div>
      {description ? (
        <div className="mt-1 text-[11px] leading-5 text-sky-800">
          {description}
        </div>
      ) : null}
      {normalizedFocusNote ? (
        <div className="mt-3 rounded-md border border-sky-200 bg-white/70 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            {t("observationFocus.focusNote")}
          </div>
          <div className="mt-1 text-xs leading-5 text-sky-900">
            {normalizedFocusNote}
          </div>
        </div>
      ) : null}
      {priorityLabels.length ? (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            {t("observationFocus.priorityElements")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {priorityLabels.map((label, idx) => (
              <span
                key={`${label}-${idx}`}
                className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-900"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
