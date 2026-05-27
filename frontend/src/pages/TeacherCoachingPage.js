import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { teacherApi } from "@/lib/api";
import {
  artifactActionItems,
  artifactDeepDive,
  artifactNextBestAction,
  artifactReflectionPrompts,
  isArtifactAllowed,
  isArtifactBlocked,
  readArtifact,
} from "@/lib/teacherCoachingArtifact";

const formatTimestamp = (seconds) => {
  const value = Number(seconds || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};

function ReflectionComposer({ taskId, commentId, videoId, onCancel }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("private");
  const mutation = useMutation({
    mutationFn: () => teacherApi.createReflection({ text, task_id: taskId, comment_id: commentId, video_id: videoId, visibility }),
    onSuccess: () => {
      toast.success("Reflection saved.");
      setText("");
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] });
      onCancel?.();
    },
    onError: () => toast.error("Your reflection could not be saved right now."),
  });
  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) mutation.mutate();
      }}
    >
      <Field label="Reflection">
        <textarea aria-label="Reflection" value={text} onChange={(event) => setText(event.target.value)} rows={3} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="What did you try, notice, or want to revisit?" />
      </Field>
      <Field label="Visibility">
        <select aria-label="Visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)} className="min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="private">Private</option>
          <option value="shared_with_admin">Shared with admin</option>
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={mutation.isPending || !text.trim()}>{mutation.isPending ? "Saving..." : "Save reflection"}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function TeacherCoachingPage() {
  const [composer, setComposer] = useState(null);
  const queryClient = useQueryClient();
  const coachingQuery = useQuery({
    queryKey: ["teacher-coaching"],
    queryFn: () => teacherApi.myCoaching().then((res) => res.data),
    retry: 1,
  });
  const data = coachingQuery.data || {};
  // PR C5: read from the canonical artifact when present and allowed. Blocked
  // artifact wins over legacy fields — we must not bypass the gate.
  const artifact = readArtifact(data);
  const artifactAllowed = isArtifactAllowed(artifact);
  const artifactBlocked = isArtifactBlocked(artifact);
  const legacyTasks = data.active_tasks || [];
  const legacyRecommendations = data.recommendations || [];
  const legacyImprovements = data.suggested_improvements || [];
  // Use artifact action items as the primary list of active tasks /
  // recommendations when artifact is allowed; suppress legacy lists when
  // the artifact blocks teacher feedback.
  const artifactActions = artifactAllowed ? artifactActionItems(artifact) : [];
  const artifactAssessmentId = artifact?.lesson?.assessment_id || null;
  const tasks = artifactBlocked
    ? []
    : artifactActions.length
      ? artifactActions.map((item) => ({
          id: item.id,
          title: item.title || "Coaching goal",
          body: item.try_next_lesson || item.body || "",
          why_it_matters: item.why_it_matters,
          video_href: item.video_href || null,
          // PR C7: mark the source so the "I tried this" handler routes
          // to the artifact action-item endpoint (C6) instead of the
          // legacy coaching_tasks endpoint.
          source_kind: "artifact_action_item",
          action_item_id: item.id,
          assessment_id: artifactAssessmentId,
          href: `/my-coaching${item.id ? `?task_id=${item.id}` : ""}`,
        }))
      : legacyTasks;
  const moments = data.shared_moments || [];
  const reflections = data.teacher_reflections || data.reflections || [];
  const recommendations = artifactBlocked
    ? []
    : artifactActions.length
      ? artifactActions.map((item) => ({
          id: item.id,
          title: item.title || "Next-lesson move",
          body: item.try_next_lesson || item.body || "",
          href: item.video_href || `/my-coaching${item.id ? `?task_id=${item.id}` : ""}`,
        }))
      : legacyRecommendations;
  const improvements = artifactBlocked
    ? []
    : artifactActions.length
      ? artifactActions.map((item) => ({
          id: `${item.id}-why`,
          title: item.title || "Next-lesson move",
          description: item.why_it_matters || item.body || "",
          focus_area: "Coaching practice",
        }))
      : legacyImprovements;
  // Deep dive comes from the artifact when allowed. When blocked, an honest
  // empty state is shown.
  const deepDive = artifactDeepDive(artifact);
  // Reflection prompts: artifact wins when allowed.
  const reflectionPrompts = artifactReflectionPrompts(artifact);
  const nextBestAction = artifactNextBestAction(artifact, data.next_best_action);
  const readiness = data.readiness || {};
  const markTriedMutation = useMutation({
    // PR C7: artifact-derived action items go through the C6 endpoint so we
    // get the dedupe-safe persistence + admin status updates. Legacy
    // coaching_tasks rows continue to use the original endpoint.
    mutationFn: (task) => {
      if (task && task.source_kind === "artifact_action_item" && task.action_item_id) {
        return teacherApi.actionItemTried(task.action_item_id, {
          assessment_id: task.assessment_id || undefined,
        });
      }
      const taskId = typeof task === "string" ? task : task && task.id;
      return teacherApi.updateCoachingTask(taskId, { status: "tried" });
    },
    onSuccess: () => {
      toast.success("Marked as tried.");
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] });
    },
    onError: () => toast.error("That action could not be updated right now."),
  });

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Coaching" }]}
          title="Your coaching"
          description="See goals, moments, reflections, and next-lesson moves connected to your recent lessons."
          badge="Teacher coaching"
        />

        {coachingQuery.isLoading ? <LoadingState message="Opening your coaching notes..." /> : null}
        {coachingQuery.isError ? <ErrorState title="Your coaching notes could not be opened" message="Try again in a moment. Your saved reflections and goals are still available." /> : null}

        {!coachingQuery.isLoading && !coachingQuery.isError ? (
          <div className="space-y-6">
            {readiness.missing_items?.length ? (
              <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-slate-900">Next step: {readiness.missing_items[0].label}</div>
                  <p className="mt-1 text-sm text-slate-600">This keeps your coaching workspace connected to the right profile and privacy settings.</p>
                </div>
                <Link to={readiness.missing_items[0].href} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">Continue</Link>
              </Panel>
            ) : null}

            {nextBestAction ? (
              <Panel className="border-primary/20 bg-primary/5">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Next best action</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">{nextBestAction.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">{nextBestAction.description}</p>
                {nextBestAction.href ? <Link to={nextBestAction.href} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80">Open next step</Link> : null}
              </Panel>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
              <Panel className="space-y-4">
                <SectionHeader title="What you’re working on" description="Choose one goal and keep the next step small enough to try in your next lesson." />
                {artifactBlocked ? (
                  <EmptyState
                    title={artifact?.empty_state?.title || "This lesson’s feedback isn’t ready yet."}
                    message={artifact?.empty_state?.message || "Once a complete review is ready, you’ll see specific coaching moments and next steps here."}
                  />
                ) : tasks.length ? (
                  <div className="space-y-3">
                    {tasks.map((task) => (
                      <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="font-semibold text-slate-900">{task.title || "Coaching goal"}</div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{task.body || "Try one move, then notice how students respond."}</p>
                        {task.why_it_matters ? <p className="mt-2 text-xs leading-5 text-slate-500">{task.why_it_matters}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="secondary" data-testid="teacher-coaching-tried-button" onClick={() => markTriedMutation.mutate(task)} disabled={markTriedMutation.isPending}>I tried this</Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setComposer({ taskId: task.id })}>Reflect</Button>
                          {task.video_href ? <Link to={task.video_href} className="inline-flex min-h-[36px] items-center text-sm font-semibold text-primary hover:text-primary/80">Watch the moment</Link> : null}
                          {task.id && task.href ? <Link to={task.href} className="inline-flex min-h-[36px] items-center text-sm font-semibold text-primary hover:text-primary/80">Open goal</Link> : null}
                        </div>
                        {composer?.taskId === task.id ? <ReflectionComposer taskId={task.id} onCancel={() => setComposer(null)} /> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Your coaching notes will appear here after your first reviewed lesson." message="When your observer shares a moment to revisit, you’ll see it here." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Moments to revisit" description="Shared notes from video review stay here so you can return to the exact moment." />
                {moments.length ? (
                  <div className="space-y-3">
                    {moments.map((moment) => (
                      <div key={moment.comment_id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <Link to={moment.href || "/videos"} className="block hover:text-primary">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatTimestamp(moment.timestamp_seconds)}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{moment.body}</p>
                        </Link>
                        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setComposer({ commentId: moment.comment_id, videoId: moment.video_id })}>Reply with reflection</Button>
                        {composer?.commentId === moment.comment_id ? <ReflectionComposer commentId={moment.comment_id} videoId={moment.video_id} onCancel={() => setComposer(null)} /> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Shared lesson moments will appear here." />
                )}
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel className="space-y-4">
                <SectionHeader title="Actionable feedback" description="Small moves you can try in the next lesson." />
                {recommendations.length ? recommendations.map((item) => (
                  <Link key={item.id} to={item.href || "/my-lessons"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.body}</p>
                  </Link>
                )) : <EmptyState title="Feedback suggestions will appear after reviewed lessons." />}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Suggested improvements" description="Focus areas grouped in plain coaching language." />
                {improvements.length ? improvements.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.focus_area}</div>
                    <div className="mt-1 font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{item.description}</p>
                  </div>
                )) : <EmptyState title="Suggested improvements will appear as your reviewed lessons build up." />}
              </Panel>
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Deep-dive moments" description="Watch the exact moment to revisit, when valid evidence is available." />
              {artifactBlocked ? (
                <EmptyState
                  title={artifact?.empty_state?.title || "Deep-dive moments will appear after a complete review is ready."}
                  message={artifact?.empty_state?.message}
                />
              ) : deepDive.available && deepDive.moments.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {deepDive.moments.map((moment) => (
                    <div key={moment.id || `${moment.start_sec}-${moment.end_sec}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatTimestamp(moment.start_sec)} – {formatTimestamp(moment.end_sec)}</div>
                      <div className="mt-1 font-semibold text-slate-900">{moment.title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{moment.what_happened}</p>
                      {moment.why_it_matters ? <p className="mt-2 text-xs leading-5 text-slate-500">{moment.why_it_matters}</p> : null}
                      {moment.video_href ? (
                        <Link to={moment.video_href} className="mt-3 inline-flex min-h-[36px] items-center text-sm font-semibold text-primary hover:text-primary/80">Watch the moment</Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={deepDive.empty_state || "Detailed lesson moments will appear after a complete review is ready."}
                />
              )}
            </Panel>

            {reflectionPrompts.length ? (
              <Panel className="space-y-4">
                <SectionHeader title="Reflect on what you tried" description="Private by default — share with admin only when you choose to." />
                <ul className="space-y-2 text-sm leading-6 text-slate-700">
                  {reflectionPrompts.slice(0, 3).map((prompt, index) => (
                    <li key={`${index}-${prompt}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">{prompt}</li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel className="space-y-4">
              <SectionHeader title="Your reflections" description="A light record of what you tried and what you noticed." />
              {reflections.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {reflections.slice(0, 6).map((reflection) => (
                    <div key={reflection.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="font-medium text-slate-900">{reflection.tried || "Reflection"}</div>
                      <div className="mt-1 inline-flex rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{reflection.visibility === "shared_with_admin" ? "Shared with admin" : "Private"}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{reflection.happened || reflection.text || reflection.body}</p>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="Your reflections will appear here after you save one." />}
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherCoachingPage;
