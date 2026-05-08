import React, { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Printer,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, PageContextHeader, Panel } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { reportApi, teacherApi } from "@/lib/api";
import { isAdminUser } from "@/lib/userRoutes";

const COLUMNS = [
  { id: "needs_attention", label: "Needs attention", statuses: ["open", "snoozed"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { id: "completed", label: "Completed this cycle", statuses: ["completed"] },
];

const priorityRank = { high: 0, medium: 1, low: 2 };

function initials(name) {
  return String(name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const parsed = parseDate(value);
  if (!parsed) return "No date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

function isOverdue(task) {
  const due = parseDate(task?.due_date);
  return Boolean(due && due < new Date() && task?.status !== "completed");
}

function scoreTrendIcon(task) {
  if (Number(task?.score) < 4) return <ArrowDownRight className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-amber-600" />;
}

function TaskCard({ task, onComplete, onSnooze, isBusy }) {
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(task);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {initials(task.teacher_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">{task.teacher_name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
              task.priority === "high"
                ? "bg-red-50 text-red-700"
                : task.priority === "medium"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-teal-50 text-teal-700"
            }`}>
              {task.priority}
            </span>
          </div>
          <div className="mt-2 inline-flex max-w-full items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
            <span className="mr-1 font-semibold">{task.element_code}</span>
            <span className="truncate">{task.element_name}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Score</div>
          <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-slate-950">
            {Number(task.score || 0).toFixed(1)}
            {scoreTrendIcon(task)}
          </div>
        </div>
        <div className={`rounded-md border px-3 py-2 ${
          overdue ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
        }`}>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Due</div>
          <div className={`mt-1 flex items-center gap-1 text-sm font-semibold ${
            overdue ? "text-red-700" : "text-slate-950"
          }`}>
            <Clock3 className="h-4 w-4" />
            {formatDate(task.due_date)}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-4 flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
      >
        AI suggested action
        <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {task.suggested_action || task.summary || "Plan a focused coaching conversation for this element."}
        </p>
      ) : null}

      {task.notes ? (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{task.notes}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/observation/new?teacher_id=${encodeURIComponent(task.teacher_id)}`}
          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CalendarPlus className="mr-2 h-4 w-4" />
          Plan observation
        </Link>
        {task.status !== "completed" ? (
          <Button size="sm" variant="success" onClick={() => onComplete(task)} disabled={isBusy}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Mark complete
          </Button>
        ) : null}
        {task.status !== "completed" ? (
          <Button size="sm" variant="secondary" onClick={() => onSnooze(task)} disabled={isBusy}>
            Snooze 1 week
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function TalkTimeBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span>Teacher talk time</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConferencePrepTab({ teacherId }) {
  const { data, isLoading } = useQuery({
    queryKey: ["conference-prep", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.conferencePrep(teacherId).then((res) => res.data),
  });

  const exportPdf = async () => {
    const response = await reportApi.teacherReport(teacherId);
    const url = URL.createObjectURL(response.data);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!teacherId) {
    return (
      <Panel>
        <EmptyState title="Choose a teacher" description="Open conference prep from a teacher or add ?teacher_id= to this page." />
      </Panel>
    );
  }
  if (isLoading) {
    return <Panel className="text-sm text-slate-500">Preparing conference sheet...</Panel>;
  }
  const snapshot = data?.last_observation || {};
  const stats = data?.since_last_conversation || {};

  return (
    <div className="conference-prep-sheet space-y-6">
      <style>{`
        @media print {
          nav, aside, header, .print-hide { display: none !important; }
          .conference-prep-sheet { padding: 0 !important; color: #0f172a; }
          .conference-prep-sheet section { break-inside: avoid; box-shadow: none !important; }
          body { background: white !important; }
        }
      `}</style>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Conference prep: {data?.teacher_name || "Teacher"}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{data?.coaching_thread}</p>
          </div>
          <div className="print-hide flex gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print prep sheet
            </Button>
            <Button onClick={exportPdf}>Export to PDF</Button>
          </div>
        </div>
      </Panel>
      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["Observations completed", stats.observations_completed || 0],
          ["Goals tried", stats.goals_tried || 0],
          ["Goals completed", stats.goals_completed || 0],
          ["Recognition earned", stats.recognition_earned || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
          </div>
        ))}
      </section>
      <Panel as="section">
        <h3 className="text-base font-semibold text-slate-950">Latest lesson snapshot</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,220px]">
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <div className="font-medium text-slate-900">{formatDate(snapshot.date)}</div>
            <p>{snapshot.summary}</p>
            <p><span className="font-semibold">Top strength: </span>{snapshot.top_strength}</p>
            <p><span className="font-semibold">Top growth area: </span>{snapshot.top_growth_area}</p>
            {snapshot.video_id ? <Link className="font-medium text-primary" to={`/videos/${snapshot.video_id}`}>Watch the lesson</Link> : null}
          </div>
          <TalkTimeBar value={snapshot.talk_time_pct} />
        </div>
      </Panel>
      <Panel as="section">
        <h3 className="text-base font-semibold text-slate-950">Open goals and what they said</h3>
        <div className="mt-4 space-y-3">
          {(data?.open_goals || []).map((goal) => (
            <div key={goal.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-900">{goal.goal_text}</div>
                {goal.teacher_marked_tried_at ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">Tried</span> : null}
              </div>
              <p className="mt-2 text-sm text-slate-700">{goal.recommended_action}</p>
              <p className="mt-2 text-sm text-slate-500">{goal.teacher_notes || "Teacher hasn't added a note yet"}</p>
            </div>
          ))}
          {!data?.open_goals?.length ? <div className="text-sm text-slate-500">No open goals right now.</div> : null}
        </div>
      </Panel>
      <Panel as="section">
        <h3 className="text-base font-semibold text-slate-950">Their reflection</h3>
        <p className="mt-2 text-sm leading-6 text-slate-700">{data?.teacher_reflection || "Teacher hasn't written a reflection yet"}</p>
      </Panel>
      <Panel as="section">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Suggested based on this teacher's recent lessons and goals
        </div>
        <h3 className="mt-1 text-base font-semibold text-slate-950">Conversation starters</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {(data?.suggested_conversation_starters || []).map((question) => (
            <button
              key={question}
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(question);
                toast.success("Copied to clipboard");
              }}
              className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800"
            >
              {question}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function CoachingHubPage() {
  const { user } = useAuth();
  const { teacherId: routeTeacherId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isAdmin = isAdminUser(user);
  const scopedTeacherId = routeTeacherId || searchParams.get("teacher_id") || (!isAdmin ? user?.teacher_id : null);
  const [mobileColumn, setMobileColumn] = useState("needs_attention");
  const activeTab = searchParams.get("tab") || "queue";

  const { data: tasksRes, isLoading } = useQuery({
    queryKey: ["coaching-tasks", scopedTeacherId || "all"],
    queryFn: () =>
      teacherApi
        .coachingTasks(scopedTeacherId ? { teacher_id: scopedTeacherId } : undefined)
        .then((res) => res.data),
  });

  const tasks = tasksRes?.tasks || [];
  const activeTasks = tasks.filter((task) => task.status !== "completed");
  const counts = {
    high: activeTasks.filter((task) => task.priority === "high").length,
    medium: activeTasks.filter((task) => task.priority === "medium").length,
    low: activeTasks.filter((task) => task.priority === "low").length,
  };

  const groupedTasks = useMemo(() => {
    const groups = {};
    COLUMNS.forEach((column) => {
      groups[column.id] = tasks
        .filter((task) => column.statuses.includes(task.status))
        .sort((a, b) => {
          const priorityDelta = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
          if (priorityDelta !== 0) return priorityDelta;
          return (parseDate(a.due_date)?.getTime() || 0) - (parseDate(b.due_date)?.getTime() || 0);
        });
    });
    return groups;
  }, [tasks]);

  const invalidateTasks = () => {
    queryClient.invalidateQueries({ queryKey: ["coaching-tasks"] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => teacherApi.updateCoachingTask(id, payload).then((res) => res.data),
    onSuccess: () => {
      invalidateTasks();
      toast.success("Task updated");
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, payload }) => teacherApi.completeCoachingTask(id, payload).then((res) => res.data),
    onSuccess: () => {
      invalidateTasks();
      toast.success("Task completed");
    },
  });

  const handleComplete = (task) => {
    const completionNote = window.prompt("Completion note", "");
    completeMutation.mutate({ id: task.id, payload: { completion_note: completionNote || "" } });
  };

  const handleSnooze = (task) => {
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 7);
    updateMutation.mutate({
      id: task.id,
      payload: {
        status: "snoozed",
        due_date: nextDue.toISOString(),
        notes: task.notes || "Snoozed for one week.",
      },
    });
  };

  const clearTeacherFilter = () => {
    searchParams.delete("teacher_id");
    setSearchParams(searchParams);
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Coaching" }]}
          title="Coaching Hub"
          description="A live workflow queue for observation follow-through, coaching moves, and completed support."
          meta={scopedTeacherId ? "Filtered to one teacher" : "All visible teachers"}
          actions={
            <>
              {scopedTeacherId && !routeTeacherId ? (
                <Button variant="secondary" size="sm" onClick={clearTeacherFilter}>
                  Clear teacher filter
                </Button>
              ) : null}
              <Link
                to="/master-schedule"
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Master schedule
              </Link>
            </>
          }
          stats={[
            { label: "High priority", value: counts.high },
            { label: "Medium", value: counts.medium },
            { label: "Low", value: counts.low },
          ]}
        />

        <div className="mb-5 flex gap-2 print-hide">
          {[
            ["queue", "Task queue"],
            ["conference", "Conference prep"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("tab", id);
                setSearchParams(next);
              }}
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                activeTab === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "conference" ? <ConferencePrepTab teacherId={scopedTeacherId} /> : (
          <>

        <div className="mb-4 flex gap-2 md:hidden">
          {COLUMNS.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => setMobileColumn(column.id)}
              className={`flex-1 rounded-md border px-3 py-2 text-xs font-semibold ${
                mobileColumn === column.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {column.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((column) => (
            <Panel
              key={column.id}
              className={`${mobileColumn === column.id ? "block" : "hidden"} border border-slate-200 bg-slate-50 md:block`}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">{column.label}</h2>
                  <p className="text-xs text-slate-500">{groupedTasks[column.id]?.length || 0} tasks</p>
                </div>
              </div>
              <div className="space-y-3">
                {isLoading ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
                    Loading coaching queue...
                  </div>
                ) : groupedTasks[column.id]?.length ? (
                  groupedTasks[column.id].map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={handleComplete}
                      onSnooze={handleSnooze}
                      isBusy={updateMutation.isPending || completeMutation.isPending}
                    />
                  ))
                ) : (
                  <EmptyState
                    title="Nothing here"
                    description="Tasks will appear here as assessments create coaching follow-up."
                  />
                )}
              </div>
            </Panel>
          ))}
        </div>
          </>
        )}
      </div>
    </LayoutShell>
  );
}
