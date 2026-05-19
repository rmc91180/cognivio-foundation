import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/LayoutShell";
import { EmptyState, ErrorState, LoadingState, PageContextHeader, Panel } from "@/components/ui";
import { teacherApi } from "@/lib/api";

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

function ProfileGate({ privacyRequired }) {
  const href = privacyRequired ? "/privacy" : "/my-profile?returnTo=/my-lessons";
  return (
    <Panel className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">
        {privacyRequired ? "Finish privacy setup first" : "Finish your teacher profile first"}
      </h2>
      <p className="text-sm leading-6 text-slate-600">
        {privacyRequired
          ? "Once your privacy setup is ready, your lesson recordings can stay connected to the right classroom context."
          : "Add your subject and grade level so your lesson recordings can stay connected to your coaching workspace."}
      </p>
      <Link
        to={href}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
      >
        {privacyRequired ? "Open privacy setup" : "Complete teacher profile"}
      </Link>
    </Panel>
  );
}

export function TeacherLessonsPage() {
  const navigate = useNavigate();
  const lessonsQuery = useQuery({
    queryKey: ["teacher-lessons"],
    queryFn: () => teacherApi.myLessons().then((res) => res.data),
    retry: 1,
  });
  const lessons = lessonsQuery.data?.lessons || [];
  const profileRequired = Boolean(lessonsQuery.data?.profile_required);
  const privacyRequired = Boolean(lessonsQuery.data?.privacy_profile_required && !profileRequired);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <PageContextHeader
          breadcrumbs={[{ label: "My Workspace", to: "/my-workspace" }, { label: "Lessons" }]}
          title="Your lessons"
          description="Review your recordings and the feedback connected to them."
          badge="Teacher lessons"
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                to="/record"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
              >
                Record or upload a lesson
              </Link>
              <button
                type="button"
                onClick={() => navigate("/videos")}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Open video library
              </button>
            </div>
          }
        />

        {lessonsQuery.isLoading ? <LoadingState message="Opening your lesson recordings..." /> : null}
        {lessonsQuery.isError ? (
          <ErrorState
            title="Your lessons could not be opened"
            message="Try again in a moment. Your recordings are still saved."
          />
        ) : null}

        {!lessonsQuery.isLoading && !lessonsQuery.isError && (profileRequired || privacyRequired) ? (
          <ProfileGate privacyRequired={privacyRequired} />
        ) : null}

        {!lessonsQuery.isLoading && !lessonsQuery.isError && !profileRequired && !privacyRequired ? (
          lessons.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {lessons.map((lesson) => (
                <article key={lesson.video_id || lesson.assessment_id || lesson.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{lesson.title || "Lesson recording"}</h2>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(lesson.uploaded_at)}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {statusLabel(lesson.status)}
                    </span>
                  </div>
                  {lesson.summary ? (
                    <p className="mt-4 text-sm leading-6 text-slate-700">{lesson.summary}</p>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-slate-600">
                      When this recording is reviewed, your coaching summary and next steps will appear here.
                    </p>
                  )}
                  <Link
                    to={lesson.href || "/videos"}
                    className="mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary/80"
                  >
                    {lesson.status === "reviewed" ? "View feedback" : "Watch recording"}
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Your lesson recordings will appear here after your first upload."
              message="When a recording is reviewed, you’ll see the coaching summary and next steps here."
              action={<Link to="/record" className="text-sm font-semibold text-primary hover:text-primary/80">Record or upload a lesson</Link>}
            />
          )
        ) : null}
      </div>
    </LayoutShell>
  );
}

export default TeacherLessonsPage;
