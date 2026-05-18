import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/ui";
import { onboardingApi } from "@/lib/api";

export function SetupAssistantPanel({ mode = "school" }) {
  const query = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => onboardingApi.status().then((res) => res.data),
    retry: false,
  });
  const status = query.data;
  const reviewedLessons = status?.counts?.reviewed_lessons ?? 0;
  const shouldShow = !query.isLoading && !query.isError && status && ((status.progress_pct ?? 0) < 100 || reviewedLessons === 0);
  if (!shouldShow) return null;
  const nextStep = status.next_step || {};
  const isTraining = mode === "training";
  return (
    <Panel className="border-sky-200 bg-sky-50">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Setup assistant</div>
          <h2 className="mt-2 text-lg font-semibold text-sky-950">
            Next step: {nextStep.title || (isTraining ? "plan your first trainee observation" : "plan your first focused observation")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-900">
            {nextStep.description || "Once a recording is reviewed, this dashboard will start showing patterns and coaching priorities."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/onboarding" className="inline-flex min-h-11 items-center justify-center rounded-md bg-sky-950 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-900">
            Continue setup
          </Link>
          {nextStep.href ? (
            <Link to={nextStep.href} className="inline-flex min-h-11 items-center justify-center rounded-md border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-100">
              {nextStep.cta_label || "Open next step"}
            </Link>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export default SetupAssistantPanel;
