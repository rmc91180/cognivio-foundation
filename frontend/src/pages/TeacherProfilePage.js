import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import {
  assessmentApi,
  observationApi,
  scheduleApi,
  teacherApi,
} from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { PeerRecommendations } from "@/components/PeerRecommendations";
import { MonthlySummary } from "@/components/MonthlySummary";
import { toast } from "sonner";

export function TeacherProfilePage() {
  const { teacherId } = useParams();
  const queryClient = useQueryClient();

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    queryFn: () => teacherApi.get(teacherId).then((r) => r.data),
  });

  const { data: dashboardRes } = useQuery({
    queryKey: ["teacher-dashboard", teacherId],
    queryFn: () => assessmentApi.teacherDashboard(teacherId).then((r) => r.data),
  });

  const { data: summaryInsightsRes } = useQuery({
    queryKey: ["teacher-summary-insights", teacherId],
    queryFn: () =>
      assessmentApi.teacherSummaryInsights(teacherId).then((r) => r.data),
  });

  const { data: summaryReflectionRes } = useQuery({
    queryKey: ["teacher-summary-reflection", teacherId],
    queryFn: () =>
      assessmentApi.teacherSummaryReflection(teacherId).then((r) => r.data),
  });

  const { data: observationsRes } = useQuery({
    queryKey: ["teacher-observations", teacherId],
    queryFn: () =>
      observationApi.listForTeacher(teacherId).then((r) => r.data),
  });

  const saveReflectionMutation = useMutation({
    mutationFn: (payload) =>
      assessmentApi.saveTeacherSummaryReflection(teacherId, payload),
    onSuccess: () => {
      toast.success("Reflection saved");
      queryClient.invalidateQueries({
        queryKey: ["teacher-summary-reflection", teacherId],
      });
    },
    onError: () => {
      toast.error("Failed to save reflection");
    },
  });

  const scheduleConferenceMutation = useMutation({
    mutationFn: (payload) => scheduleApi.create(payload),
    onSuccess: () => {
      toast.success("Coaching conference scheduled");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: () => {
      toast.error("Failed to schedule conference");
    },
  });

  const [selfReflection, setSelfReflection] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [nextStepsNote, setNextStepsNote] = useState("");
  const [observationReview, setObservationReview] = useState({});

  React.useEffect(() => {
    if (summaryReflectionRes) {
      setSelfReflection(summaryReflectionRes.self_reflection || "");
      setActionsTaken(summaryReflectionRes.actions_taken || "");
    }
  }, [summaryReflectionRes]);

  React.useEffect(() => {
    if (!teacherId) return;
    const saved = localStorage.getItem(`next-steps-${teacherId}`);
    if (saved) {
      setNextStepsNote(saved);
    }
  }, [teacherId]);

  React.useEffect(() => {
    if (!teacherId) return;
    localStorage.setItem(`next-steps-${teacherId}`, nextStepsNote || "");
  }, [nextStepsNote, teacherId]);

  const elementSummary = dashboardRes?.element_summary ?? [];
  const videos = dashboardRes?.videos ?? [];
  const observations = useMemo(() => observationsRes ?? [], [observationsRes]);

  const observationsByElement = useMemo(() => {
    const map = {};
    observations.forEach((obs) => {
      if (!obs.element_id) return;
      if (!map[obs.element_id]) map[obs.element_id] = [];
      map[obs.element_id].push(obs);
    });
    return map;
  }, [observations]);

  const nextStepsItems = useMemo(() => {
    const items = [];
    if (summaryInsightsRes?.recommendations?.length) {
      items.push(...summaryInsightsRes.recommendations.slice(0, 4));
    }
    if (actionsTaken) {
      items.push(`Admin notes: ${actionsTaken}`);
    }
    if (nextStepsNote) {
      items.push(`Final edit: ${nextStepsNote}`);
    }
    return items;
  }, [summaryInsightsRes, actionsTaken, nextStepsNote]);

  const handleSaveReflection = (e) => {
    e.preventDefault();
    saveReflectionMutation.mutate({
      self_reflection: selfReflection,
      actions_taken: actionsTaken,
    });
  };

  const handleScheduleConference = () => {
    if (!teacherRes) return;
    const start = new Date();
    start.setDate(start.getDate() + 7);
    scheduleConferenceMutation.mutate({
      teacher_id: teacherId,
      course_name: `Coaching conference with ${teacherRes.name}`,
      start_time: start.toISOString(),
    });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              Growth Insights: {teacherRes?.name || "Teacher"}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Growth-oriented insights, human observations, and actionable
              coaching recommendations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleScheduleConference}
              disabled={scheduleConferenceMutation.isPending}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60"
            >
              Schedule Coaching Conference
            </button>
            <Link
              to="/master-schedule"
              className="text-xs text-slate-500 underline underline-offset-4"
            >
              View master schedule
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            <section>
              <MonthlySummary teacherId={teacherId} period="month" />
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                AI Summary & Insights
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Anchored in recent evidence with actionable guidance.
              </p>
              {summaryInsightsRes ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[11px] text-slate-500">
                        Overall trend score
                      </div>
                      <div className="text-sm font-semibold text-slate-900">
                        {summaryInsightsRes.overall_trend_score != null
                          ? `${summaryInsightsRes.overall_trend_score.toFixed(1)}/10`
                          : "No data yet"}
                      </div>
                    </div>
                    <div className="flex-1 text-slate-700">
                      {summaryInsightsRes.summary}
                    </div>
                  </div>
                  {summaryInsightsRes.recommendations?.length ? (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Actionable focus
                      </div>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                        {summaryInsightsRes.recommendations
                          .slice(0, 4)
                          .map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-slate-500">
                  No summary data yet for this teacher.
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Professional insights
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Teacher responses and administrator reflections.
              </p>
              <form onSubmit={handleSaveReflection} className="space-y-3 text-xs">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Teacher reflection
                  </label>
                  <textarea
                    rows={3}
                    value={selfReflection}
                    onChange={(e) => setSelfReflection(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    placeholder="How does the teacher interpret these insights? What patterns are they noticing?"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Administrator reflections
                  </label>
                  <textarea
                    rows={2}
                    value={actionsTaken}
                    onChange={(e) => setActionsTaken(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    placeholder="Summarize admin observations, coaching direction, or agreed adjustments."
                  />
                </div>
                <button
                  type="submit"
                  disabled={saveReflectionMutation.isPending}
                  className="mt-1 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  Save reflections
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Next steps
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Starts with AI recommendations and updates as you add notes.
              </p>
              {nextStepsItems.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                  {nextStepsItems.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-500">
                  Add next steps to combine with AI recommendations.
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  Final edit (admin)
                </label>
                <textarea
                  rows={2}
                  value={nextStepsNote}
                  onChange={(e) => setNextStepsNote(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                  placeholder="Add a final edited summary of next steps."
                />
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="md:col-span-7 rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  Growth insights
                </h2>
                <p className="mb-3 text-xs text-slate-500">
                  Specific, actionable moves to improve performance.
                </p>
                {dashboardRes?.assessments?.length ? (
                  <ul className="space-y-2 text-xs text-slate-700">
                    {dashboardRes.assessments.slice(0, 3).map((a) => (
                      <li
                        key={a.id}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                          <span>{a.analyzed_at}</span>
                          <span>
                            Overall {a.overall_score.toFixed(1)}/10 •{" "}
                            {a.framework_type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-700">
                          {a.summary}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-slate-500">
                    No assessments yet for this teacher.
                  </div>
                )}
              </div>

              <div className="md:col-span-5">
                <PeerRecommendations teacherId={teacherId} />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Human observations
              </h2>
              {observations.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No observations recorded yet.
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  {observations.map((obs) => {
                    const needsAttention =
                      !obs.teacher_response ||
                      (obs.implementation_status &&
                        obs.implementation_status !== "implemented");
                    const reviewState = observationReview[obs.id] || "pending";
                    return (
                      <div
                        key={obs.id}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>{obs.created_at}</span>
                          <div className="flex items-center gap-2">
                            {needsAttention && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Needs attention
                              </span>
                            )}
                            {obs.implementation_status && (
                              <span
                                className={
                                  obs.implementation_status === "implemented"
                                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                                    : "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                                }
                              >
                                {obs.implementation_status}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-700">
                          {obs.admin_comment || "No admin comment"}
                        </div>
                        {obs.teacher_response && (
                          <div className="mt-1 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-700">
                              Teacher response:
                            </span>{" "}
                            {obs.teacher_response}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              setObservationReview((prev) => ({
                                ...prev,
                                [obs.id]: "review",
                              }))
                            }
                            className={`rounded-md border px-2 py-1 ${
                              reviewState === "review"
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-slate-200 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setObservationReview((prev) => ({
                                ...prev,
                                [obs.id]: "agree",
                              }))
                            }
                            className={`rounded-md border px-2 py-1 ${
                              reviewState === "agree"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            Agree
                          </button>
                          <span className="text-[10px] text-slate-500">
                            Status: {reviewState}
                          </span>
                        </div>
                        {obs.video_id && (
                          <div className="mt-2 text-[11px] text-slate-500">
                            <Link
                              to={`/videos/${obs.video_id}`}
                              className="text-primary hover:underline"
                            >
                              View linked clip
                            </Link>
                            {typeof obs.timestamp_seconds === "number" && (
                              <span className="ml-1 text-slate-400">
                                ({Math.round(obs.timestamp_seconds)}s)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-6 self-start">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Domain scores & evidence
              </h2>
              <div className="space-y-2 text-xs">
                {elementSummary.map((es) => {
                  const obsForElement = observationsByElement[es.element_id] || [];
                  return (
                    <div
                      key={es.element_id}
                      className="group rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-medium text-slate-800">
                            {es.element_name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {es.assessment_count} assessments
                          </div>
                        </div>
                        <div className="relative">
                          <span
                            className="inline-flex h-6 w-16 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                            style={{
                              backgroundImage:
                                "linear-gradient(to right, #ef4444, #f97316, #22c55e)",
                              opacity: 0.9,
                            }}
                            title={`${es.average_score.toFixed(1)}/10`}
                          >
                            {es.average_score.toFixed(1)}/10
                          </span>
                          {obsForElement.length > 0 && (
                            <div className="pointer-events-none absolute right-0 top-7 z-20 hidden w-72 rounded-md border border-slate-200 bg-white p-3 text-[11px] text-slate-700 shadow-lg group-hover:block">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Evidence
                              </div>
                              <ul className="space-y-1">
                                {obsForElement.slice(0, 3).map((obs) => (
                                  <li key={obs.id}>
                                    <div className="text-slate-700">
                                      {obs.admin_comment || "Observation"}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {obs.created_at}
                                      {obs.video_id && (
                                        <>
                                          {" "}
                                          •{" "}
                                          <Link
                                            to={`/videos/${obs.video_id}`}
                                            className="text-primary hover:underline"
                                          >
                                            Open clip
                                          </Link>
                                        </>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              {obsForElement.length > 3 && (
                                <div className="mt-1 text-[10px] text-slate-500">
                                  +{obsForElement.length - 3} more observations
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {videos.length > 0 && (
                <div className="mt-4 text-[11px] text-slate-500">
                  Linked videos:{" "}
                  {videos.slice(0, 3).map((v) => (
                    <Link
                      key={v.id}
                      to={`/videos/${v.id}`}
                      className="mr-2 text-primary hover:underline"
                    >
                      {v.filename}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

