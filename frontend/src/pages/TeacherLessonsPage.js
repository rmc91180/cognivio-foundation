import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, Field, Input, LoadingState, PageContextHeader, Panel } from "@/components/ui";
import { teacherApi } from "@/lib/api";
import {
  artifactLessonStatus,
  artifactSummaryText,
  isArtifactBlocked,
  readArtifact,
} from "@/lib/teacherCoachingArtifact";

const formatDate = (value) => {
  if (!value) return "Recently";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "Recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(parsed));
};

const statusLabel = (status) => {
  if (status === "reviewed") return "Reviewed";
  if (status === "processing") return "Review in progress";
  if (status === "failed") return "Needs attention";
  return "Uploaded";
};

function ReadinessGate({ readiness }) {
  const next = readiness?.missing_items?.[0];
  if (!next) return null;
  return (
    <Panel className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">{next.label}</h2>
      <p className="text-sm leading-6 text-slate-600">
        Take this step so your lesson recordings, feedback, and coaching notes stay connected.
      </p>
      <Link to={next.href} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
        Next step
      </Link>
    </Panel>
  );
}

export function TeacherLessonsPage() {
  const [filters, setFilters] = useState({ q: "", status: "all", subject: "all", period: "all" });
  const lessonsQuery = useQuery({
    queryKey: ["teacher-lessons", filters],
    queryFn: () => teacherApi.myLessons(filters).then((res) => res.data),
    retry: 1,
  });
  const lessons = lessonsQuery.data?.lessons || [];
  const readiness = lessonsQuery.data?.readiness || {};
  const subjects = useMemo(() => lessonsQuery.data?.filters?.subjects || [], [lessonsQuery.data]);
  const showGate = Boolean(readiness?.missing_items?.length && !readiness.teacher_profile_complete);

  const updateFilter = (field) => (event) => setFilters((current) => ({ ...current, [field]: event.target.value }));

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Lessons" }]}
          title="Your lessons"
          description="Review your recordings and the feedback connected to them."
          badge="Teacher lessons"
          actions={
            <Link to="/record" className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">
              Record or upload a lesson
            </Link>
          }
        />

        {lessonsQuery.isLoading ? <LoadingState message="Opening your lesson recordings..." /> : null}
        {lessonsQuery.isError ? <ErrorState title="Your lessons could not be opened" message="Try again in a moment. Your recordings are still saved." /> : null}

        {!lessonsQuery.isLoading && !lessonsQuery.isError && showGate ? <ReadinessGate readiness={readiness} /> : null}

        {!lessonsQuery.isLoading && !lessonsQuery.isError && !showGate ? (
          <div className="space-y-5">
            <Panel className="grid gap-3 md:grid-cols-[1.4fr,0.8fr,0.8fr,0.8fr]">
              <Field label="Search lessons">
                <Input value={filters.q} onChange={updateFilter("q")} placeholder="Search by title, subject, or coaching summary" />
              </Field>
              <Field label="Status">
                <select value={filters.status} onChange={updateFilter("status")} className="min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="all">All statuses</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="processing">Review in progress</option>
                  <option value="uploaded">Uploaded</option>
                  <option value="failed">Needs attention</option>
                </select>
              </Field>
              <Field label="Subject">
                <select value={filters.subject} onChange={updateFilter("subject")} className="min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="all">All subjects</option>
                  {subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                </select>
              </Field>
              <Field label="Period">
                <select value={filters.period} onChange={updateFilter("period")} className="min-h-[44px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="all">All time</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="semester">Semester</option>
                  <option value="year">Year</option>
                </select>
              </Field>
            </Panel>

            {lessons.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {lessons.map((lesson) => {
                  // PR C5: when the artifact is blocked we do not display the
                  // legacy summary text; the status pill drops out of "reviewed".
                  const artifact = readArtifact(lesson);
                  const blocked = isArtifactBlocked(artifact);
                  const safeStatus = artifactLessonStatus(artifact, lesson.status);
                  const artifactSummary = artifactSummaryText(artifact);
                  const displaySummary = blocked
                    ? ""
                    : artifactSummary || lesson.summary || "";
                  return (
                    <article key={lesson.video_id || lesson.assessment_id || lesson.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold text-slate-900">{lesson.title || "Lesson recording"}</h2>
                          <p className="mt-1 text-xs text-slate-500">
                            {[lesson.subject, lesson.class_section, formatDate(lesson.uploaded_at)].filter(Boolean).join(" • ")}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel(safeStatus)}</span>
                      </div>
                      {displaySummary ? (
                        <p className="mt-4 text-sm leading-6 text-slate-700">{displaySummary}</p>
                      ) : blocked ? (
                        <p className="mt-4 text-sm leading-6 text-slate-600">
                          {artifact?.empty_state?.message
                            || "Feedback will appear after a complete review is ready."}
                        </p>
                      ) : (
                        <p className="mt-4 text-sm leading-6 text-slate-600">When this recording is reviewed, your coaching summary and next steps will appear here.</p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Link to={lesson.href || "/videos"} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80">
                          {safeStatus === "reviewed" ? "View feedback" : "Watch recording"}
                        </Link>
                        {lesson.shared_moments_count ? <span className="text-xs font-medium text-slate-500">{lesson.shared_moments_count} moments to revisit</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Your lesson recordings will appear here after your first upload."
                message="When a recording is reviewed, you’ll see the coaching summary and next steps here."
                action={<Link to="/record" className="text-sm font-semibold text-primary hover:text-primary/80">Record or upload a lesson</Link>}
              />
            )}
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherLessonsPage;
