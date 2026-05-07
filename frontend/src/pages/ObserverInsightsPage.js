import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Brain, CheckCircle2, ClipboardList, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from "@/components/ui";
import { observerApi } from "@/lib/api";

const GOAL_TYPES = [
  { value: "feedback_quality", label: "Feedback quality" },
  { value: "observation_frequency", label: "Observation frequency" },
  { value: "element_focus", label: "Element focus" },
  { value: "coaching_action", label: "Coaching action" },
];

function StatCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{value}</div>
        </div>
        <div className="rounded-md bg-teal-50 p-2 text-teal-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function GoalCard({ goal }) {
  const signals = goal.progress_signals || [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">{goal.goal_text}</div>
          <div className="mt-1 text-xs text-slate-500">{goal.target_metric}</div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
          {Math.round(goal.progress_pct || 0)}%
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, goal.progress_pct || 0))}%` }}
        />
      </div>
      <div className="mt-4 space-y-2">
        {signals.slice(0, 3).map((signal, index) => (
          <div key={`${signal.signal_type}-${signal.recorded_at}-${index}`} className="rounded-md bg-white px-3 py-2 text-xs text-slate-600">
            <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5 text-teal-600" />
            {signal.note}
          </div>
        ))}
        {!signals.length ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            Progress evidence will appear as sessions are completed.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ObserverInsightsPage() {
  const queryClient = useQueryClient();
  const [goalText, setGoalText] = useState("");
  const [goalType, setGoalType] = useState("feedback_quality");
  const [targetMetric, setTargetMetric] = useState("");

  const { data: insights, isLoading } = useQuery({
    queryKey: ["observer-insights"],
    queryFn: () => observerApi.insights().then((res) => res.data),
  });
  const { data: goalsRes } = useQuery({
    queryKey: ["observer-goals"],
    queryFn: () => observerApi.goals().then((res) => res.data),
  });

  const createGoalMutation = useMutation({
    mutationFn: (payload) => observerApi.createGoal(payload),
    onSuccess: () => {
      toast.success("Observer goal created.");
      setGoalText("");
      setTargetMetric("");
      queryClient.invalidateQueries({ queryKey: ["observer-goals"] });
      queryClient.invalidateQueries({ queryKey: ["observer-insights"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not create observer goal.");
    },
  });

  const activeGoals = useMemo(
    () => goalsRes?.goals || insights?.active_goals || [],
    [goalsRes, insights]
  );
  const mostObserved = insights?.most_observed_elements || [];
  const underobserved = insights?.underobserved_elements || [];
  const frequency = insights?.observation_frequency || {};
  const feedbackLength = insights?.avg_feedback_length || {};

  const submitGoal = (event) => {
    event.preventDefault();
    createGoalMutation.mutate({
      goal_text: goalText,
      goal_type: goalType,
      target_metric: targetMetric,
    });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title="My observer insights"
          description="Track your observation patterns, growth goals, and coverage habits across the current cycle."
        />

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard
            icon={ClipboardList}
            label="This cycle"
            value={frequency.this_cycle || 0}
            detail={`${frequency.trend >= 0 ? "+" : ""}${frequency.trend || 0} versus last cycle`}
          />
          <StatCard
            icon={TrendingUp}
            label="Last cycle"
            value={frequency.last_cycle || 0}
            detail="Completed observations"
          />
          <StatCard
            icon={Brain}
            label="Feedback length"
            value={Math.round(feedbackLength.this_cycle || 0)}
            detail={`${feedbackLength.trend >= 0 ? "+" : ""}${feedbackLength.trend || 0} characters versus last cycle`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Coaching completion"
            value={`${Math.round(insights?.coaching_completion_rate || 0)}%`}
            detail="Closed coaching tasks"
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <Panel className="border border-slate-200 bg-white lg:col-span-8">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-slate-950">Your active goals</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {activeGoals.length ? (
                activeGoals.map((goal) => <GoalCard key={goal.id} goal={goal} />)
              ) : (
                <EmptyState
                  title="No active observer goals"
                  description="Set one focused goal below and progress will attach to completed observation sessions."
                />
              )}
            </div>
          </Panel>

          <Panel className="border border-slate-200 bg-white lg:col-span-4">
            <h2 className="text-sm font-semibold text-slate-950">Set a new goal</h2>
            <form className="mt-4 space-y-4" onSubmit={submitGoal}>
              <Field label="Goal">
                <Textarea
                  rows={4}
                  value={goalText}
                  onChange={(event) => setGoalText(event.target.value)}
                  placeholder="Improve the specificity of feedback in post-observation conferences."
                />
              </Field>
              <Field label="Type">
                <Select value={goalType} onChange={(event) => setGoalType(event.target.value)}>
                  {GOAL_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Target metric">
                <Input
                  value={targetMetric}
                  onChange={(event) => setTargetMetric(event.target.value)}
                  placeholder="4 completed signals this cycle"
                />
              </Field>
              <Button
                type="submit"
                fullWidth
                disabled={createGoalMutation.isPending || !goalText.trim() || !targetMetric.trim()}
              >
                Create goal
              </Button>
            </form>
          </Panel>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel className="border border-slate-200 bg-white">
            <h2 className="text-sm font-semibold text-slate-950">What you've been focusing on</h2>
            <div className="mt-4 h-72">
              {mostObserved.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mostObserved} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  title="No focus data yet"
                  description="Completed observation sessions will populate this chart."
                />
              )}
            </div>
          </Panel>

          <Panel className="border border-slate-200 bg-white">
            <h2 className="text-sm font-semibold text-slate-950">Gaps in your coverage</h2>
            <div className="mt-4 space-y-3">
              {underobserved.length ? (
                underobserved.map((element) => (
                  <div key={element.code} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-sm font-semibold text-slate-950">
                      {element.code} - {element.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Not observed in the current cycle.
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                  Your current-cycle element coverage is broad.
                </div>
              )}
            </div>
          </Panel>
        </div>

        <Panel className="mt-6 border border-teal-100 bg-teal-50">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
            <Brain className="h-4 w-4" />
            AI reflection
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-teal-950">
            {isLoading
              ? "Loading your reflection..."
              : insights?.suggested_goal || "Complete a few observations this cycle to unlock a reflection."}
          </p>
        </Panel>
      </div>
    </LayoutShell>
  );
}

