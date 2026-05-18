import React, { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { onboardingApi, teacherApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { getEffectiveWorkspaceMode, getHomeRoute } from "@/lib/roleRouter";
import { runtimeConfig } from "@/lib/runtimeConfig";

const DEFAULT_PERSON_FORM = {
  name: "",
  email: "",
  subject: "",
  grade_level: "",
  department: "",
};

const statusTone = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-900",
  incomplete: "border-amber-200 bg-amber-50 text-amber-950",
  optional: "border-slate-200 bg-slate-50 text-slate-600",
};

function statusLabel(status) {
  if (status === "complete") return "Complete";
  if (status === "optional") return "Optional";
  return "Next";
}

function QuickAction({ to, children, primary = false }) {
  return (
    <Link
      to={to}
      className={[
        "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold",
        primary
          ? "bg-slate-900 text-white hover:bg-slate-800"
          : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function SetupChecklist({ steps = [] }) {
  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Setup checklist</h2>
        <p className="mt-1 text-sm text-slate-600">Each step keeps the path to your first useful observation clear.</p>
      </div>
      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                {Number.isInteger(step.count) ? (
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">Count: {step.count}</p>
                ) : null}
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone[step.status] || statusTone.incomplete}`}>
                {statusLabel(step.status)}
              </span>
            </div>
            {step.status === "incomplete" && step.href ? (
              <Link to={step.href} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:text-primary/80">
                Continue this step
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddPersonPanel({ mode }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULT_PERSON_FORM);
  const isTraining = mode === "training";
  const personLabel = isTraining ? "trainee" : "teacher";

  const createMutation = useMutation({
    mutationFn: (payload) => teacherApi.create(payload).then((res) => res.data),
    onSuccess: () => {
      toast.success(`${isTraining ? "Trainee" : "Teacher"} added`);
      setForm(DEFAULT_PERSON_FORM);
      queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["reports-coaching-snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["training-cohort-snapshot"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || `Could not add this ${personLabel} right now.`);
    },
  });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const canSubmit = form.name.trim().length > 1;

  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Add a {personLabel}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Add one person now, then plan a focused observation from the checklist.
        </p>
      </div>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          createMutation.mutate({
            name: form.name.trim(),
            email: form.email.trim() || undefined,
            subject: form.subject.trim() || (isTraining ? "Clinical Practice" : "General"),
            grade_level: form.grade_level.trim() || (isTraining ? "Residency" : "TBD"),
            department: form.department.trim() || undefined,
            category_custom: isTraining ? "Trainee" : undefined,
          });
        }}
      >
        <label className="text-sm font-semibold text-slate-700">
          Name
          <input value={form.name} onChange={(event) => update("name", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Email optional
          <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Subject or placement focus
          <input value={form.subject} onChange={(event) => update("subject", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Department or cohort
          <input value={form.department} onChange={(event) => update("department", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {createMutation.isPending ? "Adding..." : `Add ${personLabel}`}
          </button>
        </div>
      </form>
    </Panel>
  );
}

export function OnboardingPage() {
  const { user } = useAuth();
  const mode = getEffectiveWorkspaceMode(user);
  const isTraining = mode === "training";
  const isSchool = mode === "school";
  const isMaster = mode === "master";
  const query = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => onboardingApi.status().then((res) => res.data),
    retry: false,
  });

  const status = query.data;
  const nextStep = status?.next_step;
  const quickActions = useMemo(() => {
    if (isTraining) {
      return [
        ["Add trainee", "/teachers"],
        ["Plan trainee observation", "/observation/new"],
        ["Record or upload observation", "/record"],
        ["View training dashboard", "/dashboard"],
        ["View cohort report", "/reports"],
      ];
    }
    return [
      ["Add teacher", "/teachers"],
      ["Plan observation", "/observation/new"],
      ["Record or upload lesson", "/record"],
      ["View dashboard", "/dashboard"],
      ["View reports", "/reports"],
    ];
  }, [isTraining]);

  if (mode === "teacher") {
    return <Navigate to={getHomeRoute(user)} replace />;
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title={isTraining ? "Set up your first trainee observation" : "Set up your first Cognivio observation"}
          description="We’ll walk you from setup to your first useful coaching conversation."
          actions={<QuickAction to="/dashboard">Go to dashboard</QuickAction>}
        />

        {query.isLoading ? <LoadingState message="Preparing your setup checklist..." /> : null}
        {query.isError ? (
          <ErrorState title="Setup guide needs a refresh" message="Try again in a moment, then use the dashboard to keep moving." />
        ) : null}

        {!query.isLoading && !query.isError ? (
          <div className="space-y-6">
            {isMaster && runtimeConfig.demoMode ? (
              <Panel className="border-amber-200 bg-amber-50">
                <h2 className="text-lg font-semibold text-amber-950">Demo mode helper</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  Use Master Admin to reset demo data and verify the internal rehearsal environment.
                </p>
                <Link to="/master-admin" className="mt-3 inline-flex min-h-11 items-center rounded-md bg-amber-950 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900">
                  Open Master Admin
                </Link>
              </Panel>
            ) : null}

            <Panel className="overflow-hidden">
              <div className="grid gap-6 lg:grid-cols-[0.55fr,1fr]">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Setup progress</div>
                  <div className="mt-3 text-5xl font-semibold text-slate-950">{status?.progress_pct ?? 0}%</div>
                  <div className="mt-4 h-3 rounded-full bg-slate-100">
                    <div className="h-3 rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, status?.progress_pct || 0))}%` }} />
                  </div>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">{nextStep?.title || "You’re ready for the next step."}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    {nextStep?.description || "Use the dashboard to plan the next observation and review coaching priorities."}
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {nextStep?.href ? <QuickAction to={nextStep.href} primary>{nextStep.cta_label || "Continue"}</QuickAction> : null}
                    <QuickAction to="/dashboard">Dashboard</QuickAction>
                  </div>
                </div>
              </div>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
              <SetupChecklist steps={status?.steps || []} />
              <div className="space-y-6">
                {(isSchool || isTraining) ? <AddPersonPanel mode={mode} /> : null}
                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Quick actions</h2>
                    <p className="mt-1 text-sm text-slate-600">Jump to the part of the rehearsal you need next.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {quickActions.map(([label, href], index) => (
                      <QuickAction key={label} to={href} primary={index === 0}>{label}</QuickAction>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default OnboardingPage;
