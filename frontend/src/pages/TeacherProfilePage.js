import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import {
  assessmentApi,
  observationApi,
  scheduleApi,
  teacherApi,
  curriculumApi,
  lessonPlanApi,
  syllabusApi,
  adherenceApi,
  evidenceApi,
  reportApi,
  adminApi,
  actionPlanApi,
  videoApi,
  privacyProfileApi,
  recognitionApi,
} from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { MonthlySummary } from "@/components/MonthlySummary";
import { VideoRecorder } from "@/components/VideoRecorder";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export function TeacherProfilePage() {
  const { teacherId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const [periodMonths, setPeriodMonths] = useState(3);
  const [nextCoachingConference, setNextCoachingConference] = useState("");

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    queryFn: () => teacherApi.get(teacherId).then((r) => r.data),
  });

  useEffect(() => {
    setNextCoachingConference(teacherRes?.next_coaching_conference || "");
  }, [teacherRes]);

  const { data: dashboardRes } = useQuery({
    queryKey: ["teacher-dashboard", teacherId, periodMonths],
    queryFn: () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - periodMonths);
      return assessmentApi
        .teacherDashboard(teacherId, {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        })
        .then((r) => r.data);
    },
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

  const { data: curriculaRes } = useQuery({
    queryKey: ["curricula", teacherId],
    queryFn: () => curriculumApi.list(teacherId).then((r) => r.data),
  });

  const { data: lessonPlansRes } = useQuery({
    queryKey: ["lesson-plans", teacherId],
    queryFn: () => lessonPlanApi.list(teacherId).then((r) => r.data),
  });

  const { data: syllabiRes } = useQuery({
    queryKey: ["syllabi", teacherId],
    queryFn: () => syllabusApi.list(teacherId).then((r) => r.data),
  });

  const { data: actionPlanRes } = useQuery({
    queryKey: ["action-plan", teacherId],
    queryFn: () => actionPlanApi.get(teacherId).then((r) => r.data),
  });

  const { data: schedulesRes } = useQuery({
    queryKey: ["schedules", teacherId],
    queryFn: () => scheduleApi.list({ teacher_id: teacherId }).then((r) => r.data),
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

  const saveNextCoachingConferenceMutation = useMutation({
    mutationFn: (payload) => teacherApi.update(teacherId, payload),
    onSuccess: () => {
      toast.success("Next coaching conference updated");
      queryClient.invalidateQueries({ queryKey: ["teacher", teacherId] });
    },
    onError: () => {
      toast.error("Failed to update coaching conference");
    },
  });

  const latestAssessmentId = useMemo(() => {
    if (!dashboardRes?.assessments?.length) return null;
    return dashboardRes.assessments[dashboardRes.assessments.length - 1].id;
  }, [dashboardRes]);

  const latestAssessment = useMemo(() => {
    if (!dashboardRes?.assessments?.length) return null;
    return dashboardRes.assessments[dashboardRes.assessments.length - 1];
  }, [dashboardRes]);

  const adminOverrideMutation = useMutation({
    mutationFn: (payload) =>
      assessmentApi.createAdminOverride(latestAssessmentId, payload),
    onSuccess: () => {
      toast.success("Admin adjustment saved");
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error("Failed to save admin adjustment");
    },
  });

  const uploadCurriculumMutation = useMutation({
    mutationFn: (payload) => curriculumApi.upload(payload),
    onSuccess: () => {
      toast.success("Curriculum uploaded");
      queryClient.invalidateQueries({ queryKey: ["curricula", teacherId] });
      setCurriculumFile(null);
      setCurriculumTitle("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Failed to upload curriculum");
    },
  });

  const uploadLessonPlanMutation = useMutation({
    mutationFn: (payload) => lessonPlanApi.upload(payload),
    onSuccess: () => {
      toast.success("Lesson plan uploaded");
      queryClient.invalidateQueries({ queryKey: ["lesson-plans", teacherId] });
      setLessonPlanFile(null);
      setLessonPlanTitle("");
      setLessonPlanDate("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Failed to upload lesson plan");
    },
  });

  const uploadSyllabusMutation = useMutation({
    mutationFn: (payload) => syllabusApi.upload(payload),
    onSuccess: () => {
      toast.success("Syllabus uploaded");
      queryClient.invalidateQueries({ queryKey: ["syllabi", teacherId] });
      setSyllabusFile(null);
      setSyllabusTitle("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Failed to upload syllabus");
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

  const scoringModeMutation = useMutation({
    mutationFn: (mode) => adminApi.setScoringMode(mode),
    onSuccess: () => {
      toast.success("Scoring mode updated");
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error("Failed to update scoring mode");
    },
  });

  const saveActionPlanMutation = useMutation({
    mutationFn: (payload) => actionPlanApi.save(teacherId, payload),
    onSuccess: () => {
      toast.success("Action plan saved");
      queryClient.invalidateQueries({ queryKey: ["action-plan", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["schedules", teacherId] });
    },
    onError: () => {
      toast.error("Failed to save action plan");
    },
  });

  const [selfReflection, setSelfReflection] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [nextStepsNote, setNextStepsNote] = useState("");
  const [observationReview, setObservationReview] = useState({});
  const [curriculumFile, setCurriculumFile] = useState(null);
  const [lessonPlanFile, setLessonPlanFile] = useState(null);
  const [syllabusFile, setSyllabusFile] = useState(null);
  const [lessonPlanDate, setLessonPlanDate] = useState("");
  const [curriculumTitle, setCurriculumTitle] = useState("");
  const [lessonPlanTitle, setLessonPlanTitle] = useState("");
  const [syllabusTitle, setSyllabusTitle] = useState("");
  const [scoringMode, setScoringMode] = useState("override");
  const [overrideScores, setOverrideScores] = useState({});
  const [actionPlanGoals, setActionPlanGoals] = useState([]);
  const [actionPlanNotes, setActionPlanNotes] = useState("");
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoSubject, setVideoSubject] = useState("");
  const [videoTab, setVideoTab] = useState("record");
  const [privacyReferenceFiles, setPrivacyReferenceFiles] = useState([]);

  const makeGoalId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `goal_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  };

  const nextLessonPlan = useMemo(() => {
    const plans = lessonPlansRes?.lesson_plans || [];
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = plans
      .filter((p) => p.date && p.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] || null;
  }, [lessonPlansRes]);

  useEffect(() => {
    if (teacherRes?.subject) {
      setVideoSubject(teacherRes.subject);
    }
  }, [teacherRes]);

  useEffect(() => {
    if (summaryReflectionRes) {
      setSelfReflection(summaryReflectionRes.self_reflection || "");
      setActionsTaken(summaryReflectionRes.actions_taken || "");
    }
  }, [summaryReflectionRes]);

  useEffect(() => {
    if (dashboardRes?.scoring_mode) {
      setScoringMode(dashboardRes.scoring_mode);
    }
  }, [dashboardRes]);

  useEffect(() => {
    if (!teacherId) return;
    const saved = localStorage.getItem(`next-steps-${teacherId}`);
    if (saved) {
      setNextStepsNote(saved);
    }
  }, [teacherId]);

  useEffect(() => {
    if (!teacherId) return;
    localStorage.setItem(`next-steps-${teacherId}`, nextStepsNote || "");
  }, [nextStepsNote, teacherId]);

  useEffect(() => {
    if (actionPlanRes) {
      setActionPlanGoals(actionPlanRes.goals || []);
      setActionPlanNotes(actionPlanRes.notes || "");
    }
  }, [actionPlanRes]);

  const videos = dashboardRes?.videos ?? [];
  const recordingPolicy = dashboardRes?.recording_policy;
  const recordingCompliance = dashboardRes?.recording_compliance;
  const observations = useMemo(() => observationsRes ?? [], [observationsRes]);

  const { data: adherenceRes } = useQuery({
    queryKey: ["curriculum-adherence", latestAssessmentId],
    enabled: Boolean(latestAssessmentId),
    queryFn: () => adherenceApi.get(latestAssessmentId).then((r) => r.data),
  });

  const { data: evidenceRes } = useQuery({
    queryKey: ["assessment-evidence", latestAssessmentId],
    enabled: Boolean(latestAssessmentId),
    queryFn: () => evidenceApi.get(latestAssessmentId).then((r) => r.data),
  });

  const { data: adminOverridesRes } = useQuery({
    queryKey: ["admin-overrides", latestAssessmentId],
    enabled: Boolean(latestAssessmentId) && isAdmin,
    queryFn: () =>
      assessmentApi.listAdminOverrides(latestAssessmentId).then((r) => r.data),
  });

  const { data: privacyProfileRes } = useQuery({
    queryKey: ["teacher-privacy-profile", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => privacyProfileApi.get(teacherId).then((r) => r.data),
  });

  const { data: recognitionSummaryRes } = useQuery({
    queryKey: ["teacher-recognition-summary", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => recognitionApi.teacherSummary(teacherId).then((r) => r.data),
  });

  const [selectedEvidenceElement, setSelectedEvidenceElement] = useState(null);

  const evidenceByElement = useMemo(() => {
    const map = {};
    const items = evidenceRes?.evidence || [];
    items.forEach((ev) => {
      if (!ev.element_id) return;
      if (!map[ev.element_id]) map[ev.element_id] = [];
      map[ev.element_id].push(ev);
    });
    return map;
  }, [evidenceRes]);

  const scheduleReminders = useMemo(() => {
    const schedules = schedulesRes ?? [];
    return schedules
      .filter((s) =>
        ["lesson_plan", "action_plan", "recording_compliance"].includes(
          s.reminder_type
        )
      )
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .slice(0, 6);
  }, [schedulesRes]);

  const overrideByElement = useMemo(() => {
    const map = {};
    const overrides = adminOverridesRes?.overrides || [];
    overrides.forEach((ov) => {
      map[ov.domain_id] = ov;
    });
    return map;
  }, [adminOverridesRes]);

  const nextStepsItems = useMemo(() => {
    const items = [];
    if (actionPlanGoals?.length) {
      items.push(
        ...actionPlanGoals
          .filter((g) => g?.title)
          .slice(0, 4)
          .map((g) => g.title)
      );
    }
    if (nextStepsNote) {
      items.push(nextStepsNote);
    }
    return items;
  }, [actionPlanGoals, nextStepsNote]);

  const privacyProfileReady = privacyProfileRes?.status === "active";
  const privacyProfileLabel = privacyProfileReady
    ? `Ready • ${privacyProfileRes?.reference_count || 0} references`
    : "Not configured";
  const recognitionSummary = recognitionSummaryRes?.summary || {};
  const recognitionBadges = recognitionSummaryRes?.badges || [];

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

  const handleExportReport = async (format, params = {}) => {
    try {
      const res = await reportApi.export(format, params);
      const blob = new Blob([res.data], { type: res.headers["content-type"] });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "csv" ? "summary-report.csv" : "summary-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error("Failed to export report");
    }
  };

  const uploadRecordedMutation = useMutation({
    mutationFn: ({ file, teacherId, subjectValue, recordedAt }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("teacher_id", teacherId);
      if (subjectValue) formData.append("subject", subjectValue);
      if (recordedAt) formData.append("recorded_at", recordedAt);
      return videoApi.upload(formData, {
        onUploadProgress: (event) => {
          if (event.total) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(pct);
          }
        },
      });
    },
    onSuccess: () => {
      toast.success("Uploaded. Queued for analysis.");
      setUploadProgress(0);
      setRecordedBlob(null);
      setRecordedUrl("");
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || "Failed to upload video"
      );
      setUploadProgress(0);
    },
  });

  const savePrivacyProfileMutation = useMutation({
    mutationFn: (files) => {
      const formData = new FormData();
      files.forEach((selectedFile) => {
        formData.append("files", selectedFile);
      });
      formData.append("replace_existing", "true");
      return privacyProfileApi.upload(teacherId, formData);
    },
    onSuccess: () => {
      toast.success("Privacy profile saved");
      setPrivacyReferenceFiles([]);
      queryClient.invalidateQueries({ queryKey: ["teacher-privacy-profile", teacherId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || "Failed to save privacy profile"
      );
    },
  });

  const handleUploadRecorded = () => {
    if (!privacyProfileReady) {
      toast.error("Complete the teacher privacy profile before uploading recordings.");
      return;
    }
    if (!recordedBlob || !teacherId) {
      toast.error("Record a video first.");
      return;
    }
    const ext = recordedBlob.type?.includes("mp4") ? "mp4" : "webm";
    const file = new File([recordedBlob], `teacher-recording.${ext}`, {
      type: recordedBlob.type || "video/webm",
    });
    uploadRecordedMutation.mutate({
      file,
      teacherId,
      subjectValue: videoSubject,
      recordedAt: new Date().toISOString(),
    });
  };

  const handleSavePrivacyProfile = () => {
    if (!teacherId || privacyReferenceFiles.length === 0) {
      toast.error("Add 3 to 5 reference photos first.");
      return;
    }
    savePrivacyProfileMutation.mutate(privacyReferenceFiles);
  };

  const handleSaveActionPlan = () => {
    saveActionPlanMutation.mutate({
      goals: actionPlanGoals,
      notes: actionPlanNotes,
    });
  };

  const updateGoal = (goalId, patch) => {
    setActionPlanGoals((prev) =>
      prev.map((goal) => (goal.id === goalId ? { ...goal, ...patch } : goal))
    );
  };

  const removeGoal = (goalId) => {
    setActionPlanGoals((prev) => prev.filter((goal) => goal.id !== goalId));
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
            <button
              type="button"
              onClick={() => handleExportReport("pdf", { teacher_id: teacherId })}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => handleExportReport("csv", { teacher_id: teacherId })}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Export CSV
            </button>
          </div>
        </header>

        {scheduleReminders.length > 0 && (
          <details className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
              Upcoming reminders ({scheduleReminders.length})
            </summary>
            <div className="mt-3 space-y-2 text-xs text-emerald-800">
              {scheduleReminders.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-emerald-900">
                      {r.course_name}
                    </div>
                    <div className="text-[11px] text-emerald-700">
                      {r.reminder_type === "lesson_plan" && "Lesson plan"}
                      {r.reminder_type === "action_plan" && "Action plan"}
                      {r.reminder_type === "recording_compliance" &&
                        "Recording compliance"}
                    </div>
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    {r.start_time}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Performance summary period
              </div>
              <div className="text-xs text-slate-500">
                Adjust the review period to compare against historical performance.
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="text-slate-600">Period</label>
              <select
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                value={periodMonths}
                onChange={(e) => setPeriodMonths(Number(e.target.value))}
              >
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2 text-xs">
                <label className="text-slate-600">Admin scoring</label>
                <select
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                  value={scoringMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setScoringMode(mode);
                    scoringModeMutation.mutate(mode);
                  }}
                >
                  <option value="override">Override AI</option>
                  <option value="coexist">Coexist with AI</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                AI Insights
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Recent performance summary, growth recommendations, and highlights.
              </p>
              {summaryInsightsRes ? (
                <div className="space-y-3 text-xs text-slate-700">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Recent performance summary
                    </div>
                    <div className="mt-1 text-xs text-slate-700">
                      {summaryInsightsRes.summary}
                    </div>
                  </div>
                  {summaryInsightsRes.recommendations?.length ? (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Long-term goals (semester and beyond)
                      </div>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                        {summaryInsightsRes.recommendations.slice(0, 4).map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Highlights from recent observations
                    </div>
                    {(dashboardRes?.recent_video_highlights || []).length ? (
                      <ul className="space-y-2 text-xs text-slate-700">
                        {dashboardRes.recent_video_highlights.map((h, idx) => (
                          <li
                            key={`${h.video_id}-${idx}`}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="text-[11px] text-slate-500">
                              {h.created_at}
                              {typeof h.timestamp_seconds === "number" && (
                                <span className="ml-2">
                                  • {Math.round(h.timestamp_seconds)}s
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-700">
                              {h.summary}
                            </div>
                            {h.video_id && (
                              <Link
                                to={`/videos/${h.video_id}`}
                                className="mt-1 inline-flex text-[11px] text-primary hover:underline"
                              >
                                Watch clip
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-slate-500">
                        No highlights from recent videos yet.
                      </div>
                    )}
                  </div>
                </div>
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
                Teacher and principal reflections (food for thought).
              </p>
              <div className="space-y-3 text-xs text-slate-700">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Teacher
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    {selfReflection || "No teacher reflection yet."}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Principal
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    {actionsTaken || "No principal reflection yet."}
                  </div>
                </div>
              </div>
              <form onSubmit={handleSaveReflection} className="mt-3 space-y-3 text-xs">
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
          </div>

          <div className="lg:col-span-4 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Next steps
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Concrete action items for the teacher.
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

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Next coaching conference
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Scheduled coaching checkpoint for this teacher.
              </p>
              <div className="space-y-2 text-xs text-slate-700">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {nextCoachingConference
                    ? nextCoachingConference
                    : "Not scheduled yet."}
                </div>
                {isAdmin && (
                  <div className="space-y-2">
                    <input
                      type="datetime-local"
                      value={nextCoachingConference
                        ? nextCoachingConference.replace("Z", "").slice(0, 16)
                        : ""}
                      onChange={(e) => setNextCoachingConference(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const value = nextCoachingConference
                          ? new Date(nextCoachingConference).toISOString()
                          : null;
                        saveNextCoachingConferenceMutation.mutate({
                          next_coaching_conference: value,
                        });
                      }}
                      disabled={saveNextCoachingConferenceMutation.isPending}
                      className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                    >
                      Save date
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">
            Breaking it down
          </h2>
          <p className="text-xs text-slate-500">
            Drill into domain evidence, curriculum adherence, and detailed observations.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Action plan
                  </h2>
                  <p className="text-xs text-slate-500">
                    Track concrete goals and next steps for this teacher.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveActionPlan}
                  disabled={saveActionPlanMutation.isPending}
                  className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  Save action plan
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                {actionPlanGoals.map((goal) => (
                  <div
                    key={goal.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        type="text"
                        value={goal.title}
                        onChange={(e) => updateGoal(goal.id, { title: e.target.value })}
                        placeholder="Goal title"
                        className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                      />
                      <select
                        value={goal.status || "planned"}
                        onChange={(e) => updateGoal(goal.id, { status: e.target.value })}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      >
                        <option value="planned">Planned</option>
                        <option value="in_progress">In progress</option>
                        <option value="complete">Complete</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeGoal(goal.id)}
                        className="text-[11px] text-slate-500 hover:text-slate-700"
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={goal.description || ""}
                      onChange={(e) =>
                        updateGoal(goal.id, { description: e.target.value })
                      }
                      placeholder="Why this matters and what to do next"
                      className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <label className="text-slate-500">Due date</label>
                      <input
                        type="date"
                        value={goal.due_date || ""}
                        onChange={(e) => updateGoal(goal.id, { due_date: e.target.value })}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setActionPlanGoals((prev) => [
                      ...prev,
                      {
                        id: makeGoalId(),
                        title: "",
                        description: "",
                        due_date: "",
                        status: "planned",
                      },
                    ])
                  }
                  className="inline-flex items-center rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  Add goal
                </button>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Action plan notes
                  </label>
                  <textarea
                    rows={2}
                    value={actionPlanNotes}
                    onChange={(e) => setActionPlanNotes(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                    placeholder="Summary notes, ownership, and follow-up cadence."
                  />
                </div>
              </div>

            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Lesson video hub
                  </h2>
                  <p className="text-xs text-slate-500">
                    Record in-browser or review the teacher’s full video library.
                  </p>
                </div>
                <Link
                  to={`/videos?teacher_id=${teacherId}`}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  Open recordings page
                </Link>
                {videoTab === "record" && (
                  <button
                    type="button"
                    onClick={handleUploadRecorded}
                    disabled={uploadRecordedMutation.isPending || !privacyProfileReady}
                    className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {uploadRecordedMutation.isPending
                      ? "Uploading..."
                      : privacyProfileReady
                        ? "Upload recording"
                        : "Privacy profile required"}
                  </button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setVideoTab("record")}
                  className={`rounded-md px-3 py-1.5 ${
                    videoTab === "record"
                      ? "bg-primary text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Record & upload
                </button>
                <button
                  type="button"
                  onClick={() => setVideoTab("library")}
                  className={`rounded-md px-3 py-1.5 ${
                    videoTab === "library"
                      ? "bg-primary text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Video library
                </button>
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-800">
                      Privacy identity profile
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Status: {privacyProfileLabel}. Upload 3 to 5 clear teacher photos before recording uploads.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePrivacyProfile}
                    disabled={savePrivacyProfileMutation.isPending}
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                  >
                    {savePrivacyProfileMutation.isPending ? "Saving..." : "Save privacy profile"}
                  </button>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => setPrivacyReferenceFiles(Array.from(e.target.files || []))}
                  className="mt-3 w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                />
                <div className="mt-2 text-[11px] text-slate-500">
                  {privacyReferenceFiles.length > 0
                    ? `${privacyReferenceFiles.length} reference files selected`
                    : "No new reference photos selected."}
                </div>
              </div>
              {videoTab === "record" ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <VideoRecorder
                      onRecordingReady={(blob, url) => {
                        setRecordedBlob(blob);
                        setRecordedUrl(url);
                      }}
                    />
                  </div>
                  <div className="space-y-3 text-xs text-slate-600">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={videoSubject}
                        onChange={(e) => setVideoSubject(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                      />
                    </div>
                    {recordedUrl ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        Recording ready to upload.
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                        No recording yet.
                      </div>
                    )}
                    {uploadProgress > 0 && (
                      <div>
                        <div className="h-2 w-full rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Upload progress: {uploadProgress}%
                        </div>
                      </div>
                    )}
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                      Large recordings can take time to upload. Keep this tab open
                      until the upload completes.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  {videos.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-[11px] text-slate-500">
                      No videos uploaded yet for this teacher.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {videos.map((video) => (
                        <div
                          key={video.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <div>
                            <div className="text-xs font-medium text-slate-800">
                              {video.filename || "Lesson recording"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {video.subject ? `${video.subject} • ` : ""}
                              {video.recorded_at || video.upload_date || "Date not set"}
                            </div>
                            {video.status && (
                              <span className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                                {video.status}
                              </span>
                            )}
                          </div>
                          <Link
                            to={`/videos/${video.id}`}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Open video
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Curriculum, lesson plans, and syllabus
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Upload supporting materials for curriculum adherence checks.
              </p>
              

              {(isAdmin || user?.role === "teacher") && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="mb-2 font-semibold text-slate-700">Curriculum (admin or teacher)</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <input
                      type="text"
                      placeholder="Curriculum title"
                      value={curriculumTitle}
                      onChange={(e) => setCurriculumTitle(e.target.value)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    />
                    <input
                      type="file"
                      accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                      onChange={(e) => setCurriculumFile(e.target.files?.[0] || null)}
                      className="md:col-span-2 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!curriculumFile) {
                          toast.error("Select a curriculum file");
                          return;
                        }
                        const formData = new FormData();
                        formData.append("teacher_id", teacherId);
                        formData.append("title", curriculumTitle || "");
                        formData.append("file", curriculumFile);
                        uploadCurriculumMutation.mutate(formData);
                      }}
                      className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
                    >
                      Upload curriculum
                    </button>
                  </div>
                </div>
              )}

              {user?.role === "teacher" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="mb-2 font-semibold text-slate-700">Lesson plan (teacher only)</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        type="text"
                        placeholder="Lesson plan title"
                        value={lessonPlanTitle}
                        onChange={(e) => setLessonPlanTitle(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      />
                      <input
                        type="date"
                        value={lessonPlanDate}
                        onChange={(e) => setLessonPlanDate(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      />
                      <input
                        type="file"
                        accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                        onChange={(e) => setLessonPlanFile(e.target.files?.[0] || null)}
                        className="text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!lessonPlanFile || !lessonPlanDate) {
                            toast.error("Select a lesson plan file and date");
                            return;
                          }
                          const formData = new FormData();
                          formData.append("teacher_id", teacherId);
                          formData.append("title", lessonPlanTitle || "");
                          formData.append("date", lessonPlanDate);
                          formData.append("file", lessonPlanFile);
                          uploadLessonPlanMutation.mutate(formData);
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
                      >
                        Upload lesson plan
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="mb-2 font-semibold text-slate-700">Syllabus (teacher only)</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        type="text"
                        placeholder="Syllabus title"
                        value={syllabusTitle}
                        onChange={(e) => setSyllabusTitle(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      />
                      <input
                        type="file"
                        accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                        onChange={(e) => setSyllabusFile(e.target.files?.[0] || null)}
                        className="md:col-span-2 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!syllabusFile) {
                            toast.error("Select a syllabus file");
                            return;
                          }
                          const formData = new FormData();
                          formData.append("teacher_id", teacherId);
                          formData.append("title", syllabusTitle || "");
                          formData.append("file", syllabusFile);
                          uploadSyllabusMutation.mutate(formData);
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90"
                      >
                        Upload syllabus
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 text-[11px] text-slate-500">
                Curricula: {(curriculaRes?.curricula || []).length} • Lesson plans:{" "}
                {(lessonPlansRes?.lesson_plans || []).length} • Syllabi:{" "}
                {(syllabiRes?.syllabi || []).length}
              </div>
            </section>

            <section>
              <MonthlySummary
                dashboardRes={dashboardRes}
                periodMonths={periodMonths}
                evidenceByElement={evidenceByElement}
                onViewEvidence={setSelectedEvidenceElement}
              />
            </section>
            {selectedEvidenceElement && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Evidence breakdown
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEvidenceElement(null)}
                    className="text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    Close
                  </button>
                </div>
                {(evidenceByElement[selectedEvidenceElement] || []).length ? (
                  <ul className="space-y-2 text-[11px] text-slate-700">
                    {evidenceByElement[selectedEvidenceElement].map((ev) => (
                      <li key={ev.id} className="rounded-md bg-slate-50 px-2 py-2">
                        <div className="text-slate-800">{ev.evidence_text}</div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          {typeof ev.timestamp_start === "number" && (
                            <span>
                              {Math.round(ev.timestamp_start)}s -{" "}
                              {Math.round(ev.timestamp_end)}s
                            </span>
                          )}
                          {ev.assessment_date && (
                            <span className="ml-2">• {ev.assessment_date}</span>
                          )}
                          {ev.video_id && (
                            <span className="ml-2">
                              •{" "}
                              <Link
                                to={`/videos/${ev.video_id}?t=${Math.round(
                                  ev.timestamp_start || 0
                                )}`}
                                className="text-primary hover:underline"
                              >
                                Open clip
                              </Link>
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    No evidence captured yet for this domain.
                  </div>
                )}
                {isAdmin && latestAssessment && (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
                    <div className="mb-2 font-semibold text-slate-700">
                      Admin score adjustment
                    </div>
                    {(() => {
                      const scoreRow = latestAssessment.element_scores?.find(
                        (row) => row.element_id === selectedEvidenceElement
                      );
                      if (!scoreRow) {
                        return (
                          <div className="text-[11px] text-slate-500">
                            No score found for this domain.
                          </div>
                        );
                      }
                      const existingOverride = overrideByElement[selectedEvidenceElement];
                      const value =
                        overrideScores[selectedEvidenceElement] ??
                        existingOverride?.adjusted_score ??
                        scoreRow.score;
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-500">
                            AI score: {scoreRow.score.toFixed(1)}/10
                          </span>
                          {existingOverride && (
                            <span className="text-[10px] text-emerald-700">
                              Current override: {existingOverride.adjusted_score.toFixed(1)}/10
                            </span>
                          )}
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            max="10"
                            value={value}
                            onChange={(e) =>
                              setOverrideScores((prev) => ({
                                ...prev,
                                [selectedEvidenceElement]: e.target.value,
                              }))
                            }
                            className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const adjusted = parseFloat(value);
                              if (Number.isNaN(adjusted)) {
                                toast.error("Enter a valid score");
                                return;
                              }
                              adminOverrideMutation.mutate({
                                domain_id: selectedEvidenceElement,
                                original_score: scoreRow.score,
                                adjusted_score: adjusted,
                                rationale: "Admin adjustment",
                              });
                            }}
                            className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-primary/90"
                          >
                            Apply
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {isAdmin && overrideByElement[selectedEvidenceElement] && (
                  <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] text-emerald-800">
                    <div className="font-semibold">Override history</div>
                    <div>
                      Adjusted from{" "}
                      {overrideByElement[selectedEvidenceElement].original_score?.toFixed(1)}
                      /10 to{" "}
                      {overrideByElement[selectedEvidenceElement].adjusted_score?.toFixed(1)}/10
                    </div>
                    {overrideByElement[selectedEvidenceElement].rationale && (
                      <div className="text-[10px] text-emerald-700">
                        {overrideByElement[selectedEvidenceElement].rationale}
                      </div>
                    )}
                    <div className="text-[10px] text-emerald-700">
                      {overrideByElement[selectedEvidenceElement].created_at}
                    </div>
                  </div>
                )}
              </section>
            )}

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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-slate-900">
                    Recognition
                  </h2>
                  <p className="text-xs text-slate-500">
                    Track 5-star lesson badges and readiness for exemplar publication.
                  </p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {recognitionSummary.five_star_lessons || 0} awarded
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.five_star_lessons || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    5-Star Lessons
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.published_exemplars || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Exemplars
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.active_streak || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Active Streak
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {recognitionBadges.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No recognition badges have been awarded yet. Qualifying lessons will appear here once privacy and analysis are complete and admin review confirms the lesson.
                  </div>
                ) : (
                  recognitionBadges.slice(0, 4).map((badge) => (
                    <div
                      key={badge.id}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-800">
                          {badge.badge_type === "five_star_lesson"
                            ? "5-Star Lesson"
                            : badge.badge_type.replace(/_/g, " ")}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            badge.status === "awarded"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {badge.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {badge.awarded_at
                          ? `Awarded ${String(badge.awarded_at).slice(0, 10)}`
                          : "Awaiting award date"}
                      </div>
                      {badge.video_id && (
                        <Link
                          to={`/videos/${badge.video_id}`}
                          className="mt-2 inline-flex text-[11px] font-medium text-primary hover:underline"
                        >
                          Open recognized recording
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Recording compliance
              </h2>
              {recordingPolicy ? (
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="text-[11px] text-slate-500">
                    Policy: {recordingPolicy.min_recordings_per_period} recordings every{" "}
                    {recordingPolicy.period_length_days} days.
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Required recordings</span>
                    <span className="text-slate-900">
                      {recordingCompliance?.recordings_completed ?? 0} /{" "}
                      {recordingPolicy.min_recordings_per_period}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Period length: {recordingPolicy.period_length_days} days
                  </div>
                  {recordingCompliance?.missing_subjects?.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                      Missing subjects: {recordingCompliance.missing_subjects.join(", ")}
                    </div>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                      Subject coverage complete for this period.
                    </div>
                  )}
                  {recordingCompliance?.is_compliant ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      Compliant
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                      Behind schedule
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Recording policy not configured yet.
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Curriculum adherence
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                Separate adherence score contributing to overall performance.
              </p>
              {adherenceRes?.adherence_score != null ? (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Adherence score</span>
                    <span className="text-sm font-semibold text-slate-900">
                      {Math.round(adherenceRes.adherence_score * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${Math.round(adherenceRes.adherence_score * 100)}%` }}
                    />
                  </div>
                  {adherenceRes.matched_topics?.length ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Matched topics
                      </div>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {adherenceRes.matched_topics.slice(0, 3).map((t, idx) => (
                          <li key={idx}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {adherenceRes.evidence_segments?.length ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Evidence
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-600">
                        {adherenceRes.evidence_segments.slice(0, 2).map((seg, idx) => (
                          <li key={idx}>
                            {seg.summary} ({Math.round(seg.start_sec)}s - {Math.round(seg.end_sec)}s)
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Upload a lesson plan to begin adherence scoring.
                </div>
              )}
            </section>
            
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

