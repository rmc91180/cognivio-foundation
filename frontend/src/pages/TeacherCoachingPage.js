import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageContextHeader, Panel, SectionHeader } from "@/components/ui";
import { teacherApi } from "@/lib/api";

const formatTimestamp = (seconds) => {
  const value = Number(seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
};

const formatDate = (value) => {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(parsed));
};

function ProfileGate() {
  return (
    <Panel className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Finish your teacher profile first</h2>
      <p className="text-sm leading-6 text-slate-600">
        Once your subject and grade level are saved, your coaching notes can stay connected to your lesson recordings.
      </p>
      <Link
        to="/my-profile?returnTo=/my-workspace/coaching"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
      >
        Complete teacher profile
      </Link>
    </Panel>
  );
}

export function TeacherCoachingPage() {
  const coachingQuery = useQuery({
    queryKey: ["teacher-coaching"],
    queryFn: () => teacherApi.myCoaching().then((res) => res.data),
    retry: 1,
  });
  const data = coachingQuery.data || {};
  const tasks = data.active_tasks || [];
  const moments = data.shared_moments || [];
  const reflections = data.reflections || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Coaching" }]}
          title="Your coaching"
          description="See the goals, moments, and reflections connected to your recent lessons."
          badge="Teacher coaching"
        />

        {coachingQuery.isLoading ? <LoadingState message="Opening your coaching notes..." /> : null}
        {coachingQuery.isError ? (
          <ErrorState
            title="Your coaching notes could not be opened"
            message="Try again in a moment. Your saved reflections and goals are still available."
          />
        ) : null}

        {!coachingQuery.isLoading && !coachingQuery.isError && data.profile_required ? <ProfileGate /> : null}

        {!coachingQuery.isLoading && !coachingQuery.isError && !data.profile_required ? (
          <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
            <Panel className="space-y-4">
              <SectionHeader title="What you’re working on" description="Choose one goal and keep the next step small enough to try in your next lesson." />
              {tasks.length ? (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="font-semibold text-slate-900">{task.title || "Coaching goal"}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{task.body || "Try one move, then notice how students respond."}</p>
                      {task.due_date ? <div className="mt-2 text-xs text-slate-500">Next check-in {formatDate(task.due_date)}</div> : null}
                      <Link to={task.href || "/my-workspace/goals"} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80">
                        Reflect on this goal
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Your coaching notes will appear here after your first reviewed lesson."
                  message="When your observer shares a moment to revisit, you’ll see it here."
                />
              )}
            </Panel>

            <div className="space-y-6">
              <Panel className="space-y-4">
                <SectionHeader title="Moments to revisit" description="Shared notes from video review stay here so you can return to the exact moment." />
                {moments.length ? (
                  <div className="space-y-3">
                    {moments.map((moment) => (
                      <Link key={moment.comment_id} to={moment.href || "/videos"} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:bg-white">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {formatTimestamp(moment.timestamp_seconds)}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{moment.body}</p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Shared lesson moments will appear here." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Your reflections" description="A light record of what you tried and what you noticed." />
                {reflections.length ? (
                  <div className="space-y-3">
                    {reflections.slice(0, 5).map((reflection) => (
                      <div key={reflection.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="font-medium text-slate-900">{reflection.tried || "Reflection"}</div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{reflection.happened || reflection.text || reflection.body}</p>
                        {reflection.created_at ? <div className="mt-2 text-xs text-slate-500">{formatDate(reflection.created_at)}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Your reflections will appear here after you save one." />
                )}
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherCoachingPage;
