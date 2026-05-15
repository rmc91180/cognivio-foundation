import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { assessmentApi, recognitionApi, teacherApi } from "@/lib/api";

function PriorityCard({ label, value, summary, to }) {
  return (
    <Panel className="min-h-[150px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{summary}</p>
      {to ? <Link to={to} className="mt-3 inline-flex text-sm font-medium text-primary hover:text-primary/80">Next action</Link> : null}
    </Panel>
  );
}

export function SchoolAdminPilotDashboard() {
  const rosterQuery = useQuery({
    queryKey: ["pilot-dashboard-roster"],
    queryFn: () => assessmentApi.roster({}).then((res) => res.data),
  });
  const tasksQuery = useQuery({
    queryKey: ["pilot-dashboard-coaching-tasks"],
    queryFn: () => teacherApi.coachingTasks().then((res) => res.data),
  });
  const recognitionQuery = useQuery({
    queryKey: ["pilot-dashboard-recognition"],
    queryFn: () => recognitionApi.reviewQueue().then((res) => res.data),
    retry: 1,
  });

  const roster = rosterQuery.data?.roster || [];
  const tasks = tasksQuery.data?.tasks || [];
  const recognitionItems = recognitionQuery.data?.items || [];
  const recentLessons = useMemo(
    () =>
      roster
        .filter((row) => row.last_assessment_date || row.recent_observations?.length)
        .slice(0, 5),
    [roster]
  );
  const followUpTeachers = roster.filter((row) => (row.action_items || []).length || row.trend_30d === "declining");
  const openTasks = tasks.filter((task) => task.status !== "completed");
  const lessonsReady = recentLessons.length;
  const patterns = followUpTeachers.length
    ? [
        {
          title: "Student discussion is showing up as a common growth area.",
          body: `${followUpTeachers.length} teacher${followUpTeachers.length === 1 ? "" : "s"} would benefit from a short follow-up focused on student talk and wait time.`,
          count: followUpTeachers.length,
          next: "Start with the teacher whose latest goal was student discussion.",
        },
      ]
    : [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <PageHeader
          title="School Dashboard"
          description="Start with the teachers and lessons that need your next coaching move."
          actions={<Link to="/observation/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan observation</Link>}
        />

        {rosterQuery.isLoading ? <LoadingState message="Preparing coaching priorities..." /> : null}

        {!rosterQuery.isLoading ? (
          <div className="space-y-6">
            <section>
              <SectionHeader
                title="Today’s coaching priorities"
                description="A practical starting point for your next walkthroughs and conversations."
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <PriorityCard
                  label="Teachers needing follow-up"
                  value={followUpTeachers.length}
                  summary={followUpTeachers.length ? "Start with the teacher whose last goal was student discussion." : "No urgent follow-ups are waiting right now."}
                  to="/teachers"
                />
                <PriorityCard
                  label="Lessons ready for review"
                  value={lessonsReady}
                  summary={lessonsReady ? "New lesson feedback is ready for a coaching conversation." : "Reviewed lessons will appear here as recordings are processed."}
                  to="/videos"
                />
                <PriorityCard
                  label="Open coaching tasks"
                  value={openTasks.length}
                  summary={openTasks.length ? "Use these tasks to keep coaching work visible between observations." : "Open goals will appear after reviewed lessons create next steps."}
                  to="/coaching"
                />
                <PriorityCard
                  label="Recognition candidates"
                  value={recognitionItems.length}
                  summary={recognitionItems.length ? "Celebrate a strong lesson moment while it is still fresh." : "Recognition candidates will appear after standout lessons are reviewed."}
                  to="/recognition-review"
                />
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
              <Panel className="space-y-4">
                <SectionHeader title="Patterns worth noticing" description="Use these to plan team-level support." />
                {patterns.length ? (
                  <div className="space-y-3">
                    {patterns.map((pattern) => (
                      <div key={pattern.title} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="font-semibold text-slate-900">{pattern.title}</div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{pattern.body}</p>
                        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {pattern.count} teacher{pattern.count === 1 ? "" : "s"}
                        </div>
                        <p className="mt-2 text-sm text-slate-700">{pattern.next}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Patterns will appear after reviewed lessons build up." />
                )}
              </Panel>

              <Panel className="space-y-4">
                <SectionHeader title="Recent lessons" description="Open a lesson, then choose one follow-up move." />
                {recentLessons.length ? (
                  <div className="space-y-3">
                    {recentLessons.map((lesson) => (
                      <div key={lesson.teacher_id} className="rounded-md border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{lesson.teacher_name}</div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              {lesson.subject || "Latest lesson"}: start with one strength, then choose the next student-thinking move to try.
                            </p>
                          </div>
                          <Link to={`/teachers/${lesson.teacher_id}/latest-lesson`} className="text-sm font-medium text-primary hover:text-primary/80">
                            Open
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Recent lessons will appear after recordings are reviewed."
                    message="You’ll see the teacher, lesson context, and a short coaching summary here."
                  />
                )}
              </Panel>
            </div>

            <Panel className="space-y-4">
              <SectionHeader title="Recognition" description="Keep strong teaching moments visible." />
              {recognitionItems.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {recognitionItems.slice(0, 4).map((item) => (
                    <div key={item.video_id} className="rounded-md border border-amber-100 bg-amber-50 p-4">
                      <div className="font-semibold text-amber-950">{item.teacher_name || "Teacher"} has a lesson moment ready to review.</div>
                      <Link to="/recognition-review" className="mt-2 inline-flex text-sm font-medium text-amber-950 underline">
                        Review recognition
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Recognition candidates will appear here." />
              )}
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default SchoolAdminPilotDashboard;
