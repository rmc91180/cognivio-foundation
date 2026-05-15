import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, Field, Input, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { teacherWorkspaceApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const formatDate = (value) => {
  if (!value) return "Recently";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(parsed));
};

const normalizeTasks = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const normalizeBadges = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.badges)) return payload.badges;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const normalizeReflections = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.reflections)) return payload.reflections;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

function WorkspacePanel({ title, description, children }) {
  return (
    <Panel className="space-y-4 border border-slate-200 bg-white">
      <SectionHeader title={title} description={description} />
      {children}
    </Panel>
  );
}

function ReflectionForm({ task, onCancel, onSubmit, busy }) {
  const [tried, setTried] = useState("");
  const [happened, setHappened] = useState("");

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-slate-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(task.id, { tried, happened });
      }}
    >
      <Field label="What did you try?">
        <Input value={tried} onChange={(event) => setTried(event.target.value)} required />
      </Field>
      <Field label="What happened?">
        <textarea
          value={happened}
          onChange={(event) => setHappened(event.target.value)}
          required
          rows={3}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !tried.trim() || !happened.trim()}>
          Save reflection
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function TeacherWorkspacePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [openReflectionTaskId, setOpenReflectionTaskId] = useState(null);
  const [showReflections, setShowReflections] = useState(false);

  const latestLessonQuery = useQuery({
    queryKey: ["teacher-workspace", "latest-lesson", user?.id],
    queryFn: () => teacherWorkspaceApi.latestLesson().then((res) => res.data),
  });

  const tasksQuery = useQuery({
    queryKey: ["teacher-workspace", "tasks", user?.id],
    queryFn: () => teacherWorkspaceApi.coachingTasks().then((res) => res.data),
  });

  const badgesQuery = useQuery({
    queryKey: ["teacher-workspace", "badges", user?.id],
    queryFn: () => teacherWorkspaceApi.recognition().then((res) => res.data),
  });

  const reflectionsQuery = useQuery({
    queryKey: ["teacher-workspace", "reflections", user?.id],
    queryFn: () => teacherWorkspaceApi.reflections().then((res) => res.data),
  });

  const reflectionMutation = useMutation({
    mutationFn: ({ taskId, payload }) => teacherWorkspaceApi.taskReflection(taskId, payload),
    onSuccess: () => {
      toast.success("Reflection saved.");
      setOpenReflectionTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["teacher-workspace", "tasks", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["teacher-workspace", "reflections", user?.id] });
    },
    onError: () => toast.error("Your reflection could not be saved right now."),
  });

  const lesson = latestLessonQuery.data?.lesson || latestLessonQuery.data || null;
  const tasks = useMemo(
    () => normalizeTasks(tasksQuery.data).filter((task) => task.status !== "completed").slice(0, 3),
    [tasksQuery.data]
  );
  const badges = useMemo(() => normalizeBadges(badgesQuery.data).slice(0, 3), [badgesQuery.data]);
  const reflections = useMemo(
    () => normalizeReflections(reflectionsQuery.data).slice(0, 5),
    [reflectionsQuery.data]
  );
  const actions = lesson?.actions || lesson?.recommendations || lesson?.next_steps || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }]}
          title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
          description="Start with your newest lesson, choose one move to try, and keep the thread moving at a pace that feels useful."
          badge="Teacher workspace"
        />

        <div className="space-y-6">
          <WorkspacePanel
            title="Your latest lesson"
            description="A short coaching readout from the most recent reviewed recording."
          >
            {latestLessonQuery.isLoading ? <div className="text-sm text-slate-500">Opening your latest lesson...</div> : null}
            {!latestLessonQuery.isLoading && lesson?.id ? (
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        {lesson.subject || lesson.title || "Reviewed lesson"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(lesson.lesson_date || lesson.recorded_at || lesson.reviewed_at)}</div>
                    </div>
                    {lesson.video_id ? (
                      <Link to={`/videos/${lesson.video_id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                        Watch the lesson
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-700">
                    {lesson.summary || "You have a reviewed lesson ready. Start with one strength to keep using and one small move to try next time."}
                  </p>
                  {lesson.talk_time_summary ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600">{lesson.talk_time_summary}</p>
                  ) : null}
                </div>

                {actions.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {actions.slice(0, 2).map((action, index) => (
                      <div key={`${action}-${index}`} className="rounded-md border border-emerald-100 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                        {typeof action === "string" ? action : action.text || action.title}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!latestLessonQuery.isLoading && !lesson?.id ? (
              <EmptyState
                title="Your first lesson summary will appear here once a recording has been reviewed."
                message="You’ll get specific, helpful feedback about what happened in that lesson."
              />
            ) : null}
          </WorkspacePanel>

          <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <WorkspacePanel
              title="What you’re working on"
              description="Choose one open goal and jot down what you tried while it is still fresh."
            >
              {tasks.length ? (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                      <div className="font-semibold text-slate-900">{task.title}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        {task.suggested_action || task.summary || "Try this once in your next lesson and notice how students respond."}
                      </div>
                      {task.created_at ? <div className="mt-2 text-xs text-slate-500">From {formatDate(task.created_at)}</div> : null}
                      <div className="mt-3">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setOpenReflectionTaskId(task.id)}>
                          I tried this
                        </Button>
                      </div>
                      {openReflectionTaskId === task.id ? (
                        <ReflectionForm
                          task={task}
                          busy={reflectionMutation.isPending}
                          onCancel={() => setOpenReflectionTaskId(null)}
                          onSubmit={(taskId, payload) => reflectionMutation.mutate({ taskId, payload })}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Your goals will appear here after your first reviewed lesson." />
              )}
            </WorkspacePanel>

            <WorkspacePanel
              title="Your recognition"
              description="Moments worth celebrating will stay easy to find."
            >
              {badges.length ? (
                <div className="space-y-3">
                  {badges.map((badge) => (
                    <div key={badge.id} className="rounded-md border border-amber-100 bg-amber-50 p-4">
                      <div className="font-semibold text-amber-950">{badge.badge_type || badge.title || "Recognition earned"}</div>
                      <div className="mt-2 text-sm leading-6 text-amber-900">
                        {badge.awarded_for || "You earned this for a lesson moment worth carrying forward."}
                      </div>
                      <div className="mt-2 text-xs text-amber-800">{formatDate(badge.awarded_at)}</div>
                      {badge.share_url ? (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(badge.share_url)}
                          className="mt-3 text-xs font-semibold text-amber-950 underline"
                        >
                          Copy share link
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Recognition you earn will appear here." />
              )}
            </WorkspacePanel>
          </div>

          <Panel className="space-y-4">
            <button
              type="button"
              onClick={() => setShowReflections((current) => !current)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <div className="text-base font-semibold text-slate-900">Your reflections</div>
                <div className="mt-1 text-sm text-slate-500">A light record of what you tried and what you noticed.</div>
              </div>
              <span className="text-sm font-medium text-primary">{showReflections ? "Hide" : "Show"}</span>
            </button>
            {showReflections ? (
              reflections.length ? (
                <div className="space-y-3">
                  {reflections.map((reflection) => (
                    <div key={reflection.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                      <div className="font-medium text-slate-900">{reflection.tried || reflection.title || "Reflection"}</div>
                      <div className="mt-1">{reflection.happened || reflection.body || reflection.note}</div>
                      <div className="mt-2 text-xs text-slate-500">{formatDate(reflection.created_at)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Your reflections will appear here after you save one." />
              )
            ) : null}
          </Panel>
        </div>
      </div>
    </LayoutShell>
  );
}
