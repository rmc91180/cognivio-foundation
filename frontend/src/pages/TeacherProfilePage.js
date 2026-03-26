import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { AssessmentFeedbackWidget } from "@/components/assessment/AssessmentFeedbackWidget";
import { ObservationFocusPanel } from "@/components/assessment/ObservationFocusPanel";
import { CoachingTaskList } from "@/components/coaching/CoachingTaskList";
import { CoachingTimelinePanel } from "@/components/coaching/CoachingTimelinePanel";
import { MonthlySummary } from "@/components/MonthlySummary";
import { VideoRecorder } from "@/components/VideoRecorder";
import { SectionHeader } from "@/components/ui";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@/lib/runtimeConfig";

export function TeacherProfilePage() {
  const { t, i18n } = useTranslation();
  const { teacherId } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const isRtl = i18n.dir() === "rtl";
  const dateFormatter = new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
    dateStyle: "medium",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat(i18n.language === "he" ? "he-IL" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const scoreFormatter = new Intl.NumberFormat(i18n.language === "he" ? "he-IL" : "en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const [periodMonths, setPeriodMonths] = useState(3);
  const [nextCoachingConference, setNextCoachingConference] = useState("");
  const [showEvidenceOverTime, setShowEvidenceOverTime] = useState(false);
  const [showHumanObservations, setShowHumanObservations] = useState(false);
  const [publishedAgendaDraft, setPublishedAgendaDraft] = useState("");

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
  const { data: conferencePrepRes } = useQuery({
    queryKey: ["teacher-conference-prep", teacherId],
    queryFn: () => teacherApi.conferencePrep(teacherId).then((r) => r.data),
  });
  const { data: coachingTimelineRes } = useQuery({
    queryKey: ["teacher-coaching-timeline", teacherId],
    queryFn: () => teacherApi.coachingTimeline(teacherId).then((r) => r.data),
  });
  const { data: coachingTasksRes } = useQuery({
    queryKey: ["coaching-tasks", teacherId],
    queryFn: () => teacherApi.coachingTasks({ teacher_id: teacherId }).then((r) => r.data),
  });
  useEffect(() => {
    const publishedItems = conferencePrepRes?.published_agenda?.agenda_items || [];
    const sourceItems = publishedItems.length
      ? publishedItems
      : (conferencePrepRes?.agenda || []);
    setPublishedAgendaDraft(sourceItems.join("\n"));
  }, [conferencePrepRes]);

  const { data: reflectionHistoryRes } = useQuery({
    queryKey: ["teacher-reflection-history", teacherId],
    queryFn: () =>
      assessmentApi.teacherReflectionHistory(teacherId).then((r) => r.data),
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

  const saveNextCoachingConferenceMutation = useMutation({
    mutationFn: (payload) => teacherApi.update(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.nextConferenceUpdated"));
      queryClient.invalidateQueries({ queryKey: ["teacher", teacherId] });
    },
    onError: () => {
      toast.error(t("teacherProfile.nextConferenceFailed"));
    },
  });
  const publishConferenceAgendaMutation = useMutation({
    mutationFn: (payload) => teacherApi.publishConferenceAgenda(teacherId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.conferenceAgendaPublished"));
      queryClient.invalidateQueries({ queryKey: ["teacher-conference-prep", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["conference-agenda", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["coaching-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-coaching-timeline", teacherId] });
    },
    onError: () => {
      toast.error(t("teacherProfile.conferenceAgendaPublishFailed"));
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
  const assessmentFeedbackEnabled = runtimeConfig.assessmentFeedbackEnabled;
  const experimentalMomentRankingEnabled = runtimeConfig.experimentalMomentRankingEnabled;

  const adminOverrideMutation = useMutation({
    mutationFn: (payload) =>
      assessmentApi.createAdminOverride(latestAssessmentId, payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.adminAdjustmentSaved"));
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overrides", latestAssessmentId] });
    },
    onError: () => {
      toast.error(t("teacherProfile.adminAdjustmentFailed"));
    },
  });

  const uploadCurriculumMutation = useMutation({
    mutationFn: (payload) => curriculumApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.curriculumUploaded"));
      queryClient.invalidateQueries({ queryKey: ["curricula", teacherId] });
      setCurriculumFile(null);
      setCurriculumTitle("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teacherProfile.curriculumUploadFailed"));
    },
  });

  const uploadLessonPlanMutation = useMutation({
    mutationFn: (payload) => lessonPlanApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.lessonPlanUploaded"));
      queryClient.invalidateQueries({ queryKey: ["lesson-plans", teacherId] });
      setLessonPlanFile(null);
      setLessonPlanTitle("");
      setLessonPlanDate("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teacherProfile.lessonPlanUploadFailed"));
    },
  });

  const uploadSyllabusMutation = useMutation({
    mutationFn: (payload) => syllabusApi.upload(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.syllabusUploaded"));
      queryClient.invalidateQueries({ queryKey: ["syllabi", teacherId] });
      setSyllabusFile(null);
      setSyllabusTitle("");
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teacherProfile.syllabusUploadFailed"));
    },
  });

  const scheduleConferenceMutation = useMutation({
    mutationFn: (payload) => scheduleApi.create(payload),
    onSuccess: () => {
      toast.success(t("teacherProfile.conferenceScheduled"));
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: () => {
      toast.error(t("teacherProfile.conferenceScheduleFailed"));
    },
  });

  const scoringModeMutation = useMutation({
    mutationFn: (mode) => adminApi.setScoringMode(mode),
    onSuccess: () => {
      toast.success(t("teacherProfile.scoringModeUpdated"));
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error(t("teacherProfile.scoringModeFailed"));
    },
  });

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
  const privacyReferenceInputRef = useRef(null);
  const curriculumInputRef = useRef(null);
  const lessonPlanInputRef = useRef(null);
  const syllabusInputRef = useRef(null);
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
  const { data: assessmentFeedbackRes } = useQuery({
    queryKey: ["assessment-feedback", latestAssessmentId],
    enabled: Boolean(latestAssessmentId) && assessmentFeedbackEnabled,
    queryFn: () => assessmentApi.listFeedback(latestAssessmentId).then((r) => r.data),
  });
  const { data: analysisMomentsRes } = useQuery({
    queryKey: ["analysis-moments", latestAssessment?.video_id],
    enabled:
      Boolean(latestAssessment?.video_id) &&
      isAdmin &&
      experimentalMomentRankingEnabled,
    retry: false,
    queryFn: () => videoApi.analysisMoments(latestAssessment.video_id).then((r) => r.data),
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
      if ((ov.override_type || "score") !== "score") return;
      if (!ov.domain_id) return;
      map[ov.domain_id] = ov;
    });
    return map;
  }, [adminOverridesRes]);
  const overrideByTarget = useMemo(() => {
    const map = {};
    const overrides = adminOverridesRes?.overrides || [];
    overrides.forEach((ov) => {
      const key = `${ov.override_type || "score"}:${ov.target_type || "element"}:${
        ov.target_id || ov.domain_id || ""
      }`;
      map[key] = ov;
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
  const openGoalsCount = useMemo(
    () =>
      actionPlanGoals.filter(
        (goal) => goal?.status !== "complete" && goal?.status !== "implemented"
      ).length,
    [actionPlanGoals]
  );
  const completedGoalsCount = useMemo(
    () =>
      actionPlanGoals.filter(
        (goal) => goal?.status === "complete" || goal?.status === "implemented"
      ).length,
    [actionPlanGoals]
  );
  const activeGoalTitles = useMemo(
    () =>
      actionPlanGoals
        .filter(
          (goal) =>
            goal?.title &&
            goal?.status !== "complete" &&
            goal?.status !== "implemented"
        )
        .slice(0, 3)
        .map((goal) => goal.title),
    [actionPlanGoals]
  );
  const recommendedMoments = useMemo(
    () => analysisMomentsRes?.moments || [],
    [analysisMomentsRes]
  );
  const formatMomentPhase = (value) => {
    const map = {
      lesson_launch: t("videoPlayer.momentPhases.lesson_launch"),
      modeling: t("videoPlayer.momentPhases.modeling"),
      guided_practice: t("videoPlayer.momentPhases.guided_practice"),
      student_work: t("videoPlayer.momentPhases.student_work"),
      check_for_understanding: t("videoPlayer.momentPhases.check_for_understanding"),
      closure: t("videoPlayer.momentPhases.closure"),
    };
    return map[value] || String(value || "").replace(/_/g, " ");
  };
  const formatMomentReason = (value) => {
    const map = {
      participant_density_change: t("videoPlayer.momentReasons.participant_density_change"),
      board_content_change: t("videoPlayer.momentReasons.board_content_change"),
      teacher_prominence: t("videoPlayer.momentReasons.teacher_prominence"),
      visual_novelty: t("videoPlayer.momentReasons.visual_novelty"),
      high_activity_window: t("videoPlayer.momentReasons.high_activity_window"),
      scene_transition: t("videoPlayer.momentReasons.scene_transition"),
      timeline_coverage: t("videoPlayer.momentReasons.timeline_coverage"),
    };
    return map[value] || String(value || "").replace(/_/g, " ");
  };
  const recommendedMomentNoteLines = useMemo(
    () =>
      recommendedMoments.slice(0, 3).map((moment) => {
        const jumpTime =
          typeof moment.representative_frame_sec === "number"
            ? moment.representative_frame_sec
            : moment.start_sec;
        return `${formatClock(moment.start_sec)}-${formatClock(moment.end_sec)} • ${formatMomentPhase(
          moment.phase
        )} • ${formatMomentReason(moment.selection_reason)} • ${t(
          "videoPlayer.representativeMoment",
          { time: formatClock(jumpTime) }
        )}`;
      }),
    [recommendedMoments, t]
  );

  const privacyProfileReady = privacyProfileRes?.status === "active";
  const privacyProfileLabel = privacyProfileReady
    ? t("teacherProfile.privacyReady", {
        count: privacyProfileRes?.reference_count || 0,
      })
    : t("teacherProfile.notConfigured");
  const recognitionSummary = recognitionSummaryRes?.summary || {};
  const recognitionBadges = recognitionSummaryRes?.badges || [];
  const feedbackByTarget = {};
  (assessmentFeedbackRes?.feedback || []).forEach((item) => {
    feedbackByTarget[`${item.target_type}:${item.target_id || ""}`] = item;
  });
  const coachingTasks = coachingTasksRes?.tasks || [];
  const coachingTimelineEntries = coachingTimelineRes?.entries || [];
  const currentReflectionEntries = reflectionHistoryRes?.current_entries || [];
  const latestTeacherReflection = currentReflectionEntries.find(
    (entry) => entry.author_role === "teacher"
  ) || (reflectionHistoryRes?.history || []).find((entry) => entry.author_role === "teacher");
  const latestAdminReflection = currentReflectionEntries.find(
    (entry) => entry.author_role !== "teacher"
  ) || (reflectionHistoryRes?.history || []).find((entry) => entry.author_role !== "teacher");

  const formatDate = (value) => {
    if (!value) return t("teacherProfile.notConfigured");
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return dateFormatter.format(new Date(parsed));
  };

  const formatDateTime = (value) => {
    if (!value) return t("teacherProfile.notConfigured");
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return dateTimeFormatter.format(new Date(parsed));
  };

  const formatClock = (seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  };

  const formatScore = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "N/A";
    return scoreFormatter.format(numeric);
  };

  const formatImplementationStatus = (value) => {
    const map = {
      planned: t("teacherProfile.goalStatusPlanned"),
      in_progress: t("teacherProfile.goalStatusInProgress"),
      implemented: t("teacherProfile.goalStatusImplemented"),
      complete: t("teacherProfile.goalStatusComplete"),
      pending: t("teacherProfile.goalStatusPending"),
      review: t("teacherProfile.review"),
      agree: t("teacherProfile.agree"),
    };
    return map[value] || value || t("teacherProfile.notConfigured");
  };

  const latestReviewedAt =
    latestAssessment?.analyzed_at ||
    latestAssessment?.recorded_at ||
    latestAssessment?.created_at ||
    null;
  const latestHighlights = useMemo(
    () => (dashboardRes?.recent_video_highlights || []).slice(0, 3),
    [dashboardRes]
  );
  const sortedObservations = useMemo(
    () =>
      [...observations].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      ),
    [observations]
  );
  const latestObservation = sortedObservations[0] || null;
  const elementNameById = useMemo(
    () =>
      (dashboardRes?.element_summary || []).reduce((acc, item) => {
        if (item?.element_id) {
          acc[item.element_id] = item.element_name || item.element_id;
        }
        return acc;
      }, {}),
    [dashboardRes]
  );
  const latestLessonSignals = useMemo(() => {
    const rows = latestAssessment?.element_scores || [];
    const ranked = rows
      .map((row) => ({
        ...row,
        label: elementNameById[row.element_id] || row.element_name || row.element_id,
      }))
      .filter((row) => row.label && Number.isFinite(Number(row.score)));
    const strengths = [...ranked]
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 2);
    const concerns = [...ranked]
      .sort((a, b) => Number(a.score) - Number(b.score))
      .slice(0, 2);
    return { strengths, concerns };
  }, [latestAssessment, elementNameById]);
  const recurringPatternSummary = useMemo(() => {
    const trendData = dashboardRes?.trend_data || [];
    const domainStats = {};
    trendData.forEach((point) => {
      Object.entries(point.element_scores || {}).forEach(([elementId, score]) => {
        if (!domainStats[elementId]) {
          domainStats[elementId] = {
            elementId,
            baseline: score,
            latest: score,
          };
        } else {
          domainStats[elementId].latest = score;
        }
      });
    });
    const deltas = Object.values(domainStats).map((item) => ({
      ...item,
      label: elementNameById[item.elementId] || item.elementId,
      delta: Number(item.latest || 0) - Number(item.baseline || 0),
    }));
    return {
      strengths: [...deltas]
        .filter((item) => item.delta > 0.2)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3),
      challenges: [...deltas]
        .filter((item) => item.delta < -0.2)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 3),
    };
  }, [dashboardRes, elementNameById]);
  const patternStrengthLabel = useMemo(() => {
    const count = dashboardRes?.assessments?.length || 0;
    if (count <= 1) return t("teacherProfile.singleObservation");
    if (count <= 3) return t("teacherProfile.emergingPattern");
    return t("teacherProfile.establishedPattern");
  }, [dashboardRes, t]);
  const longTermChallengeItems = useMemo(() => {
    const activeGoals = actionPlanGoals
      .filter(
        (goal) =>
          goal?.title &&
          goal?.status !== "complete" &&
          goal?.status !== "implemented"
      )
      .map((goal) => goal.title);
    if (activeGoals.length) {
      return activeGoals.slice(0, 3);
    }
    return recurringPatternSummary.challenges
      .map((item) => item.label)
      .filter(Boolean)
      .slice(0, 3);
  }, [actionPlanGoals, recurringPatternSummary]);

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
      a.download =
        format === "csv"
          ? i18n.language === "he"
            ? "cognivio-summary-report-he.csv"
            : "summary-report.csv"
          : i18n.language === "he"
            ? "cognivio-summary-report-he.pdf"
            : "summary-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(t("teacherProfile.reportExportFailed"));
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
      toast.success(t("teacherProfile.recordingQueued"));
      setUploadProgress(0);
      setRecordedBlob(null);
      setRecordedUrl("");
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", teacherId] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || t("teacherProfile.videoUploadFailed")
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
      toast.success(t("teacherProfile.privacyProfileSaved"));
      setPrivacyReferenceFiles([]);
      queryClient.invalidateQueries({ queryKey: ["teacher-privacy-profile", teacherId] });
    },
    onError: (error) => {
      const detail = error?.response?.data?.detail;
      toast.error(
        typeof detail === "string" ? detail : detail?.message || t("teacherProfile.privacyProfileSaveFailed")
      );
    },
  });

  const handleUploadRecorded = () => {
    if (!privacyProfileReady) {
      toast.error(t("teacherProfile.completePrivacyProfileFirst"));
      return;
    }
    if (!recordedBlob || !teacherId) {
      toast.error(t("teacherProfile.recordVideoFirst"));
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
      toast.error(t("teacherProfile.addReferencePhotosFirst"));
      return;
    }
    savePrivacyProfileMutation.mutate(privacyReferenceFiles);
  };

  const handleMoveDraftToActionPlanNotes = () => {
    const draft = nextStepsNote.trim();
    if (!draft) return;
    setActionPlanNotes((prev) => (prev?.trim() ? `${prev.trim()}\n\n${draft}` : draft));
    toast.success(t("teacherProfile.movedToActionPlanNotes"));
  };
  const handleAddRecommendedMomentsToDraft = () => {
    if (!recommendedMomentNoteLines.length) return;
    setNextStepsNote((prev) => {
      const existing = prev?.trim() ? prev.trim().split("\n").filter(Boolean) : [];
      const merged = [...existing];
      recommendedMomentNoteLines.forEach((line) => {
        if (!merged.includes(line)) {
          merged.push(line);
        }
      });
      return merged.join("\n");
    });
  };
  const handleAddRecommendedMomentsToActionPlanNotes = () => {
    if (!recommendedMomentNoteLines.length) return;
    setActionPlanNotes((prev) => {
      const existing = prev?.trim() ? prev.trim().split("\n").filter(Boolean) : [];
      const merged = [...existing];
      recommendedMomentNoteLines.forEach((line) => {
        if (!merged.includes(line)) {
          merged.push(line);
        }
      });
      return merged.join("\n");
    });
    toast.success(t("teacherProfile.momentsAddedToActionPlanNotes"));
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
        <header className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="mb-2 flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  {t("timeScope.latestClass")}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {t("timeScope.longTermFocus")}
                </span>
              </div>
              <h1 className="font-heading text-2xl font-semibold text-slate-900">
                {t("teacherProfile.title", {
                  name: teacherRes?.name || t("teacherProfile.fallbackTeacher"),
                })}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{t("teacherProfile.subtitle")}</p>
            </div>
            <div className="grid min-w-[250px] gap-2 text-right text-xs text-slate-600">
              <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="uppercase tracking-wide text-slate-500">
                  {t("teacherProfile.coachingStatusLatestLesson")}
                </div>
                <div className="mt-1 font-semibold text-slate-900">
                  {latestReviewedAt
                    ? formatDateTime(latestReviewedAt)
                    : t("teacherProfile.noLessonReviewedYet")}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="uppercase tracking-wide text-slate-500">
                  {t("teacherProfile.coachingStatusConference")}
                </div>
                <div className="mt-1 font-semibold text-slate-900">
                  {nextCoachingConference
                    ? t("teacherProfile.nextConferenceScheduled", {
                        date: formatDateTime(nextCoachingConference),
                      })
                    : t("teacherProfile.nextConferenceNotScheduled")}
                </div>
              </div>
            </div>
          </div>
        </header>

        {scheduleReminders.length > 0 && (
          <details className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
              {t("teacherProfile.upcomingReminders", { count: scheduleReminders.length })}
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
                      {r.reminder_type === "lesson_plan" && t("teacherProfile.reminderLessonPlan")}
                      {r.reminder_type === "action_plan" && t("teacherProfile.reminderActionPlan")}
                      {r.reminder_type === "recording_compliance" &&
                        t("teacherProfile.reminderRecordingCompliance")}
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

        <section className="mb-6 rounded-xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("teacherProfile.coachingWorkspace")}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {t("teacherProfile.coachingWorkspaceDescription")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {latestAssessment?.video_id && (
                <Link
                  to={`/videos/${latestAssessment.video_id}`}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("teacherProfile.openLatestLesson")}
                </Link>
              )}
              <Link
                to={`/teachers/${teacherId}/action-plan`}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              >
                {t("teacherProfile.jumpToActionPlan")}
              </Link>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {t("teacherProfile.coachingStatusLatestLesson")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {latestAssessment?.analyzed_at
                  ? formatDateTime(latestAssessment.analyzed_at)
                  : t("teacherProfile.noLessonReviewedYet")}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {t("teacherProfile.coachingStatusGoals")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {t("teacherProfile.goalsInMotionCount", {
                  open: openGoalsCount,
                  completed: completedGoalsCount,
                })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {t("teacherProfile.coachingStatusConference")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {nextCoachingConference
                  ? t("teacherProfile.nextConferenceScheduled", {
                      date: formatDateTime(nextCoachingConference),
                    })
                  : t("teacherProfile.nextConferenceNotScheduled")}
              </div>
            </div>
          </div>
        </section>

        {isAdmin && (
          <section className="mb-6 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-5">
            <SectionHeader
              title={t("teacherProfile.pageGuideTitle")}
              description={t("teacherProfile.pageGuideDescription")}
              eyebrow={t("teacherProfile.adminActionLane")}
            />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                [
                  t("teacherProfile.pageGuideLatestTitle"),
                  t("teacherProfile.pageGuideLatestDescription"),
                ],
                [
                  t("teacherProfile.pageGuidePatternsTitle"),
                  t("teacherProfile.pageGuidePatternsDescription"),
                ],
                [
                  t("teacherProfile.pageGuideActionsTitle"),
                  t("teacherProfile.pageGuideActionsDescription"),
                ],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700"
                >
                  <div className="font-semibold text-slate-900">{title}</div>
                  <div className="mt-1 text-xs text-slate-500">{description}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {conferencePrepRes?.agenda?.length ? (
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
            <SectionHeader
              title={t("teacherProfile.conferencePrepTitle")}
              description={t("teacherProfile.conferencePrepDescription")}
              eyebrow={t("teacherProfile.conferencePrepEyebrow")}
              actions={
                conferencePrepRes?.next_conference ? (
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
                    {t("teacherProfile.nextConferenceScheduled", {
                      date: formatDateTime(conferencePrepRes.next_conference),
                    })}
                  </div>
                ) : null
              }
            />
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teacherProfile.conferencePrepAgenda")}
                </div>
                <div className="space-y-2">
                  {(conferencePrepRes?.agenda || []).map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.publishAgendaTitle")}
                  </div>
                  <textarea
                    rows={5}
                    value={publishedAgendaDraft}
                    onChange={(e) => setPublishedAgendaDraft(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                    placeholder={t("teacherProfile.publishAgendaPlaceholder")}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        publishConferenceAgendaMutation.mutate({
                          agenda_items: publishedAgendaDraft
                            .split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean),
                          linked_goal_ids: actionPlanGoals
                            .filter((goal) => goal?.status !== "complete" && goal?.status !== "implemented")
                            .map((goal) => goal.id)
                            .slice(0, 4),
                          linked_assessment_id: latestAssessment?.id || null,
                          linked_video_id: latestAssessment?.video_id || null,
                        })
                      }
                      disabled={publishConferenceAgendaMutation.isPending || !publishedAgendaDraft.trim()}
                      className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                    >
                      {publishConferenceAgendaMutation.isPending
                        ? t("teachersPage.saving")
                        : t("teacherProfile.publishAgenda")}
                    </button>
                    {conferencePrepRes?.published_agenda?.published_at ? (
                      <span className="text-[11px] text-slate-500">
                        {t("teacherProfile.publishAgendaStatus", {
                          date: formatDateTime(conferencePrepRes.published_agenda.published_at),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teacherProfile.conferencePrepContinuity")}
                </div>
                <div className="space-y-2">
                  {(conferencePrepRes?.continuity_lines || []).map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
                      {item}
                    </div>
                  ))}
                  {!(conferencePrepRes?.continuity_lines || []).length && (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                      {t("teacherProfile.conferencePrepNoContinuity")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <span>{t("timeScope.fromThisLesson")}</span>
                    {latestReviewedAt ? (
                      <>
                        <span className="text-slate-300">/</span>
                        <span>
                          {t("teacherProfile.latestLessonDate", {
                            date: formatDateTime(latestReviewedAt),
                          })}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {isAdmin
                      ? t("teacherProfile.latestVideoReview")
                      : t("teacherProfile.latestClassReview")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {isAdmin
                      ? t("teacherProfile.latestVideoReviewDescription")
                      : t("teacherProfile.latestClassReviewDescription")}
                  </p>
                </div>
                {latestAssessment?.video_id ? (
                  <Link
                    to={`/videos/${latestAssessment.video_id}`}
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {t("teacherProfile.openLatestLesson")}
                  </Link>
                ) : null}
              </div>
              <div className="space-y-3 text-xs text-slate-700">
                {isAdmin && latestAssessment?.video_id ? (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-xs text-sky-900">
                    <div className="font-semibold">
                      {t("teacherProfile.latestVideoReviewNoteTitle")}
                    </div>
                    <div className="mt-1 text-sky-800">
                      {t("teacherProfile.latestVideoReviewNoteDescription")}
                    </div>
                  </div>
                ) : null}
                <ObservationFocusPanel
                  frameworkType={latestAssessment?.framework_type}
                  priorityElements={latestAssessment?.priority_elements}
                  focusNote={latestAssessment?.focus_note}
                  title={t("teacherProfile.focusContextTitle")}
                  description={t("teacherProfile.focusContextDescription")}
                />
                {summaryInsightsRes ? (
                  <>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        {t("teacherProfile.latestLessonSummary")}
                      </div>
                      <div className="mt-1 text-xs text-slate-700">
                        {summaryInsightsRes.summary}
                      </div>
                      {assessmentFeedbackEnabled && latestAssessmentId && (
                        <AssessmentFeedbackWidget
                          assessmentId={latestAssessmentId}
                          targetType="summary"
                          targetId="teacher-summary"
                          surface="teacher_profile"
                          metadata={{ section: "teacher_summary_insights" }}
                          existingFeedback={feedbackByTarget["summary:teacher-summary"]}
                        />
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          {t("teacherProfile.latestStrengths")}
                        </div>
                        {latestLessonSignals.strengths.length ? (
                          <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                            {latestLessonSignals.strengths.map((item) => (
                              <li key={`latest-strength-${item.element_id}`}>
                                {item.label} ({formatScore(item.score)}/10)
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-slate-500">
                            {t("teacherProfile.noRecentHighlights")}
                          </div>
                        )}
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                          {t("teacherProfile.immediateConcerns")}
                        </div>
                        {latestLessonSignals.concerns.length ? (
                          <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                            {latestLessonSignals.concerns.map((item) => (
                              <li key={`latest-concern-${item.element_id}`}>
                                {item.label} ({formatScore(item.score)}/10)
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-slate-500">
                            {t("teacherProfile.noRecentHighlights")}
                          </div>
                        )}
                      </div>
                    </div>
                    {summaryInsightsRes.recommendations?.length ? (
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("teacherProfile.latestVideoCoachingMoves")}
                        </div>
                        <ul className="space-y-2 text-xs text-slate-700">
                          {summaryInsightsRes.recommendations.slice(0, 4).map((r, idx) => (
                            <li
                              key={idx}
                              className="rounded-md border border-slate-200 bg-white px-3 py-3"
                            >
                              {(() => {
                                const recommendationTargetId = `teacher-recommendation-${idx}`;
                                const recommendationOverride =
                                  overrideByTarget[
                                    `recommendation_usefulness:recommendation:${recommendationTargetId}`
                                  ];
                                return (
                                  <>
                              <div>{r}</div>
                              {assessmentFeedbackEnabled && latestAssessmentId && (
                                <AssessmentFeedbackWidget
                                  assessmentId={latestAssessmentId}
                                  targetType="recommendation"
                                  targetId={recommendationTargetId}
                                  surface="teacher_profile"
                                  metadata={{
                                    section: "teacher_recommendations",
                                    recommendation_index: idx,
                                  }}
                                  existingFeedback={
                                    feedbackByTarget[
                                      `recommendation:teacher-recommendation-${idx}`
                                    ]
                                  }
                                  compact
                                />
                              )}
                              {isAdmin && latestAssessmentId && (
                                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[11px]">
                                  <div className="font-semibold text-slate-700">
                                    {t("teacherProfile.recommendationOverrideTitle")}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        adminOverrideMutation.mutate({
                                          override_type: "recommendation_usefulness",
                                          target_type: "recommendation",
                                          target_id: recommendationTargetId,
                                          original_value: "ai_generated",
                                          adjusted_value: "useful",
                                          rationale: t(
                                            "teacherProfile.recommendationMarkedUsefulRationale"
                                          ),
                                          metadata: {
                                            section: "teacher_recommendations",
                                            recommendation_index: idx,
                                          },
                                        })
                                      }
                                      className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
                                    >
                                      {t("teacherProfile.markRecommendationUseful")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        adminOverrideMutation.mutate({
                                          override_type: "recommendation_usefulness",
                                          target_type: "recommendation",
                                          target_id: recommendationTargetId,
                                          original_value: "ai_generated",
                                          adjusted_value: "needs_rewrite",
                                          rationale: t(
                                            "teacherProfile.recommendationNeedsRewriteRationale"
                                          ),
                                          metadata: {
                                            section: "teacher_recommendations",
                                            recommendation_index: idx,
                                          },
                                        })
                                      }
                                      className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50"
                                    >
                                      {t("teacherProfile.markRecommendationNeedsRewrite")}
                                    </button>
                                  </div>
                                  {recommendationOverride && (
                                    <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] text-emerald-800">
                                      <div className="font-semibold">
                                        {t("teacherProfile.overrideHistory")}
                                      </div>
                                      <div>
                                        {recommendationOverride.adjusted_value === "useful"
                                          ? t("teacherProfile.recommendationMarkedUseful")
                                          : t("teacherProfile.recommendationNeedsRewrite")}
                                      </div>
                                      {recommendationOverride.rationale && (
                                        <div className="text-[10px] text-emerald-700">
                                          {recommendationOverride.rationale}
                                        </div>
                                      )}
                                      <div className="text-[10px] text-emerald-700">
                                        {formatDateTime(recommendationOverride.created_at)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                                  </>
                                );
                              })()}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("teacherProfile.timestampedEvidence")}
                        </div>
                        {latestHighlights.length ? (
                          <ul className="space-y-2 text-xs text-slate-700">
                            {latestHighlights.map((h, idx) => (
                              <li
                                key={`${h.video_id}-${idx}`}
                                className="rounded-md border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="text-[11px] text-slate-500">
                                  {formatDateTime(h.created_at)}
                                  {typeof h.timestamp_seconds === "number" && (
                                    <span className={isRtl ? "mr-2" : "ml-2"}>
                                      • {formatClock(h.timestamp_seconds)}
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
                                    {t("teacherProfile.watchClip")}
                                  </Link>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-slate-500">
                            {t("teacherProfile.noRecentHighlights")}
                          </div>
                        )}
                        {isAdmin && recommendedMoments.length > 0 && latestAssessment?.video_id ? (
                          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {t("teacherProfile.recommendedMomentsTitle")}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {t("teacherProfile.recommendedMomentsDescription")}
                            </p>
                            <ul className="mt-2 space-y-2 text-xs text-slate-700">
                              {recommendedMoments.slice(0, 3).map((moment) => {
                                const jumpTime =
                                  typeof moment.representative_frame_sec === "number"
                                    ? moment.representative_frame_sec
                                    : moment.start_sec;
                                return (
                                  <li
                                    key={moment.moment_id}
                                    className="rounded-md border border-slate-200 bg-white px-3 py-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-slate-900">
                                        {formatClock(moment.start_sec)}-{formatClock(moment.end_sec)}
                                      </span>
                                      <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                        {formatMomentPhase(moment.phase)}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-[11px] text-slate-600">
                                      {formatMomentReason(moment.selection_reason)}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                      <span className="text-slate-500">
                                        {t("videoPlayer.representativeMoment", {
                                          time: formatClock(jumpTime),
                                        })}
                                      </span>
                                      <Link
                                        to={`/videos/${latestAssessment.video_id}?t=${Math.round(jumpTime)}`}
                                        className="font-medium text-primary hover:underline"
                                      >
                                        {t("teacherProfile.openMoment")}
                                      </Link>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleAddRecommendedMomentsToDraft}
                                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                              >
                                {t("teacherProfile.addMomentsToDraft")}
                              </button>
                              <button
                                type="button"
                                onClick={handleAddRecommendedMomentsToActionPlanNotes}
                                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                              >
                                {t("teacherProfile.addMomentsToActionPlanNotes")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {t("teacherProfile.latestAdminComment")}
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            {latestObservation?.admin_comment || t("teacherProfile.noAdminComment")}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {t("teacherProfile.latestTeacherResponse")}
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            {latestObservation?.teacher_response ||
                              t("teacherProfile.noLatestTeacherResponse")}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-500">
                    {t("teacherProfile.noSummaryData")}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <span>{t("timeScope.ongoingGoal")}</span>
                  <span className="text-slate-300">/</span>
                  <span>{patternStrengthLabel}</span>
                </div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {isAdmin
                    ? t("teacherProfile.longTermGoalsAndAdherence")
                    : t("teacherProfile.ongoingCoachingRecord")}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isAdmin
                    ? t("teacherProfile.longTermGoalsAndAdherenceDescription")
                    : t("teacherProfile.ongoingCoachingRecordDescription")}
                </p>
              </div>
              {isAdmin ? (
                <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  {t("teacherProfile.longTermGoalsEvidenceNote")}
                </div>
              ) : null}
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.actionPlanFocus")}
                  </div>
                  {activeGoalTitles.length ? (
                    <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                      {activeGoalTitles.map((item, idx) => (
                        <li key={`active-goal-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">{t("teacherProfile.noNextStepsYet")}</div>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.conferencePrepContinuity")}
                  </div>
                  {(conferencePrepRes?.continuity_lines || []).length ? (
                    <ul className="space-y-2 text-xs text-slate-700">
                      {conferencePrepRes.continuity_lines.slice(0, 3).map((item, idx) => (
                        <li
                          key={`continuity-${idx}`}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">
                      {t("teacherProfile.conferencePrepNoContinuity")}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    {t("teacherProfile.recurringStrengths")}
                  </div>
                  {recurringPatternSummary.strengths.length ? (
                    <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                      {recurringPatternSummary.strengths.map((item) => (
                        <li key={`pattern-strength-${item.elementId}`}>{item.label}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">
                      {t("teacherProfile.noRecurringStrengths")}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    {t("teacherProfile.recurringChallenges")}
                  </div>
                  {longTermChallengeItems.length ? (
                    <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                      {longTermChallengeItems.map((item, idx) => (
                        <li key={`ongoing-challenge-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">
                      {t("teacherProfile.noRecurringChallenges")}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3 text-xs text-slate-700">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestTeacherReflectionTitle")}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    {latestTeacherReflection?.self_reflection || t("teacherProfile.noTeacherReflection")}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.latestAdminReflectionTitle")}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    {latestAdminReflection?.self_reflection || t("teacherProfile.noPrincipalReflection")}
                  </div>
                </div>
              </div>
              {nextStepsItems.length > 0 && (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.longTermCoachingNotes")}
                  </div>
                  <ul className={`space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"} list-disc`}>
                    {nextStepsItems.map((item, idx) => (
                      <li key={`long-term-note-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3">
                <Link
                  to={`/teachers/${teacherId}/reflections`}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("teacherWorkspace.reflectionsOpenRecord")}
                </Link>
              </div>
            </section>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <CoachingTaskList
              title={t("coachingTasks.title")}
              description={t("coachingTasks.description")}
              eyebrow={t("teacherProfile.adminActionLane")}
              tasks={coachingTasks.slice(0, 4)}
              user={user}
              t={t}
              emptyLabel={t("coachingTasks.empty")}
            />
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                title={t("teacherProfile.adminActionLane")}
                description={t("teacherProfile.adminActionLaneDescription")}
                eyebrow={t("teacherProfile.adminActionLane")}
              />
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleScheduleConference}
                  disabled={scheduleConferenceMutation.isPending}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {t("teacherProfile.scheduleConference")}
                </button>
                <Link
                  to="/master-schedule"
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.viewMasterSchedule")}
                </Link>
                <button
                  type="button"
                  onClick={() => handleExportReport("pdf", { teacher_id: teacherId })}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.exportPdf")}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportReport("csv", { teacher_id: teacherId })}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("teacherProfile.exportCsv")}
                </button>
              </div>
              <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  {t("teacherProfile.adminScoring")}
                </label>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                  value={scoringMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setScoringMode(mode);
                    scoringModeMutation.mutate(mode);
                  }}
                >
                  <option value="override">{t("teacherProfile.overrideAi")}</option>
                  <option value="coexist">{t("teacherProfile.coexistWithAi")}</option>
                </select>
              </div>
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.actionPlanFocus")}
                  </div>
                  {activeGoalTitles.length > 0 ? (
                    <ul className={`mt-2 list-disc space-y-1 text-xs text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>
                      {activeGoalTitles.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-1 text-xs text-slate-500">
                      {t("teacherProfile.noNextStepsYet")}
                    </div>
                  )}
                </div>
                {nextStepsItems.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("teacherProfile.coachingActions")}
                    </div>
                    <ul className={`mt-2 list-disc space-y-1 text-xs text-slate-700 ${isRtl ? "pr-5" : "pl-5"}`}>
                      {nextStepsItems.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">
                  {t("teacherProfile.finalNextStepDraft")}
                </label>
                <textarea
                  rows={2}
                  value={nextStepsNote}
                  onChange={(e) => setNextStepsNote(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                  placeholder={t("teacherProfile.nextStepsPlaceholder")}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleMoveDraftToActionPlanNotes}
                  disabled={!nextStepsNote.trim()}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {t("teacherProfile.moveToActionPlanNotes")}
                </button>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("teacherProfile.nextConferenceTitle")}
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                {t("teacherProfile.nextConferenceDescription")}
              </p>
              <div className="space-y-2 text-xs text-slate-700">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {nextCoachingConference
                    ? formatDateTime(nextCoachingConference)
                    : t("teacherProfile.nextConferenceNotScheduled")}
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
                      {t("teacherProfile.saveDate")}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <CoachingTimelinePanel
              title={t("coachingTimeline.title")}
              description={t("coachingTimeline.description")}
              eyebrow={t("teacherProfile.recordHistory")}
              entries={coachingTimelineEntries.slice(0, 6)}
              user={user}
              teacherId={teacherId}
              t={t}
              emptyLabel={t("coachingTimeline.empty")}
              dateFormatter={dateTimeFormatter}
            />
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">
            {t("teacherProfile.breakingItDown")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("teacherProfile.breakingItDownDescription")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                title={t("teacherProfile.currentSharedPlanTitle")}
                description={t("teacherProfile.currentSharedPlanAdminDescription")}
                eyebrow={t("timeScope.ongoingGoal")}
                actions={
                  <Link
                    to={`/teachers/${teacherId}/action-plan`}
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {t("teacherWorkspace.goalsOpenRecord")}
                  </Link>
                }
              />
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                {t("teacherProfile.actionPlanSyncNotice")}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.coachingStatusGoals")}
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    {t("teacherProfile.goalsInMotionCount", {
                      open: openGoalsCount,
                      completed: completedGoalsCount,
                    })}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.nextCheckpoint")}
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    {actionPlanGoals.find((goal) => goal?.due_date)?.due_date || t("teacherProfile.nextConferenceNotScheduled")}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                {actionPlanGoals.length ? (
                  actionPlanGoals.slice(0, 4).map((goal) => (
                    <div
                      key={goal.id}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {goal.title || t("teacherWorkspace.goalUntitled")}
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                          {goal.status === "complete"
                            ? t("teacherProfile.goalStatusComplete")
                            : goal.status === "implemented"
                              ? t("teacherProfile.goalStatusImplemented")
                              : goal.status === "in_progress"
                                ? t("teacherProfile.goalStatusInProgress")
                                : t("teacherProfile.goalStatusPlanned")}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-700">
                        {goal.description || t("teacherWorkspace.goalNoDescription")}
                      </div>
                      {goal.due_date ? (
                        <div className="mt-2 text-[11px] text-slate-500">
                          {t("teacherProfile.dueDate")}: {goal.due_date}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                    {t("teacherProfile.noSharedGoalsYet")}
                  </div>
                )}
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.actionPlanNotes")}
                  </div>
                  <div className="text-xs text-slate-700">
                    {actionPlanNotes || t("teacherProfile.actionPlanNotesPlaceholder")}
                  </div>
                </div>
              </div>

            </section>

            {!isAdmin && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("teacherProfile.lessonVideoHub")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("teacherProfile.lessonVideoHubDescription")}
                  </p>
                </div>
                <Link
                  to={`/videos?teacher_id=${teacherId}`}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("teacherProfile.openRecordingsPage")}
                </Link>
                {videoTab === "record" && (
                  <button
                    type="button"
                    onClick={handleUploadRecorded}
                    disabled={uploadRecordedMutation.isPending || !privacyProfileReady}
                    className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {uploadRecordedMutation.isPending
                      ? t("teacherProfile.uploading")
                      : privacyProfileReady
                        ? t("teacherProfile.uploadRecording")
                        : t("videosPage.privacyProfileRequired")}
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
                  {t("teacherProfile.recordUpload")}
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
                  {t("teacherProfile.videoLibrary")}
                </button>
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-800">
                      {t("teacherProfile.privacyIdentityProfile")}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("teacherProfile.privacyStatusLabel", { status: privacyProfileLabel })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePrivacyProfile}
                    disabled={savePrivacyProfileMutation.isPending}
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                  >
                    {savePrivacyProfileMutation.isPending ? t("teachersPage.saving") : t("teacherProfile.savePrivacyProfile")}
                  </button>
                </div>
                <input
                  ref={privacyReferenceInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => setPrivacyReferenceFiles(Array.from(e.target.files || []))}
                  className="hidden"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => privacyReferenceInputRef.current?.click()}
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {t("teacherProfile.chooseFiles")}
                  </button>
                  <span className="text-[11px] text-slate-500">
                    {privacyReferenceFiles.length > 0
                      ? t("teacherProfile.referenceFilesSelected", { count: privacyReferenceFiles.length })
                      : t("teacherProfile.noFilesSelected")}
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  {privacyReferenceFiles.length > 0
                    ? privacyReferenceFiles.map((file) => file.name).join(", ")
                    : t("teacherProfile.noReferenceFiles")}
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
                        {t("teacherProfile.subject")}
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
                        {t("teacherProfile.recordingReady")}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                        {t("teacherProfile.noRecordingYet")}
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
                          {t("teacherProfile.uploadProgress", { progress: uploadProgress })}
                        </div>
                      </div>
                    )}
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                      {t("teacherProfile.keepTabOpen")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  {videos.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-[11px] text-slate-500">
                      {t("teacherProfile.noVideosForTeacher")}
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
                              {video.filename || t("teacherProfile.lessonRecordingFallback")}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {video.subject ? `${video.subject} • ` : ""}
                              {video.recorded_at || video.upload_date
                                ? formatDateTime(video.recorded_at || video.upload_date)
                                : t("teacherProfile.dateNotSet")}
                            </div>
                            {video.status && (
                              <span className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                                {t(`labels.${video.status}`, { defaultValue: video.status })}
                              </span>
                            )}
                          </div>
                          <Link
                            to={`/videos/${video.id}`}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                            {t("teacherProfile.openVideo")}
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
            )}

            {!isAdmin && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("teacherProfile.supportingMaterials")}
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                {t("teacherProfile.supportingMaterialsDescription")}
              </p>
              

              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.curriculum")}</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    type="text"
                    placeholder={t("teacherProfile.curriculumTitle")}
                    value={curriculumTitle}
                    onChange={(e) => setCurriculumTitle(e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                  />
                  <input
                    ref={curriculumInputRef}
                    type="file"
                    accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                    onChange={(e) => setCurriculumFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => curriculumInputRef.current?.click()}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {t("teacherProfile.chooseFile")}
                    </button>
                    <span className="text-[11px] text-slate-500">
                      {curriculumFile ? curriculumFile.name : t("teacherProfile.noFileSelected")}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!curriculumFile) {
                        toast.error(t("teacherProfile.selectCurriculumFile"));
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
                    {t("teacherProfile.uploadCurriculum")}
                  </button>
                </div>
              </div>

              {user?.role === "teacher" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.lessonPlan")}</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        type="text"
                        placeholder={t("teacherProfile.lessonPlanTitle")}
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
                        ref={lessonPlanInputRef}
                        type="file"
                        accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                        onChange={(e) => setLessonPlanFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => lessonPlanInputRef.current?.click()}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {t("teacherProfile.chooseFile")}
                        </button>
                        <span className="text-[11px] text-slate-500">
                          {lessonPlanFile ? lessonPlanFile.name : t("teacherProfile.noFileSelected")}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!lessonPlanFile || !lessonPlanDate) {
                            toast.error(t("teacherProfile.selectLessonPlanFileDate"));
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
                        {t("teacherProfile.uploadLessonPlan")}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="mb-2 font-semibold text-slate-700">{t("teacherProfile.syllabus")}</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input
                        type="text"
                        placeholder={t("teacherProfile.syllabusTitle")}
                        value={syllabusTitle}
                        onChange={(e) => setSyllabusTitle(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      />
                      <input
                        ref={syllabusInputRef}
                        type="file"
                        accept=".pdf,.docx,.pptx,.jpeg,.jpg"
                        onChange={(e) => setSyllabusFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => syllabusInputRef.current?.click()}
                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {t("teacherProfile.chooseFile")}
                        </button>
                        <span className="text-[11px] text-slate-500">
                          {syllabusFile ? syllabusFile.name : t("teacherProfile.noFileSelected")}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (!syllabusFile) {
                            toast.error(t("teacherProfile.selectSyllabusFile"));
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
                        {t("teacherProfile.uploadSyllabus")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 text-[11px] text-slate-500">
                {t("teacherProfile.materialsSummary", {
                  curricula: (curriculaRes?.curricula || []).length,
                  lessonPlans: (lessonPlansRes?.lesson_plans || []).length,
                  syllabi: (syllabiRes?.syllabi || []).length,
                })}
              </div>
            </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                title={t("teacherProfile.evidenceOverTime")}
                description={t("teacherProfile.evidenceOverTimeDescription")}
                tags={[t("timeScope.acrossRecentObservations"), patternStrengthLabel]}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEvidenceOverTime((prev) => !prev)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t(showEvidenceOverTime ? "teachersPage.collapse" : "teachersPage.expand")}
                    </button>
                    {showEvidenceOverTime ? (
                      <div className="flex items-center gap-2 text-xs">
                        <label className="text-slate-600">{t("teacherProfile.period")}</label>
                        <select
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          value={periodMonths}
                          onChange={(e) => setPeriodMonths(Number(e.target.value))}
                        >
                          <option value={1}>{t("teacherProfile.month1")}</option>
                          <option value={3}>{t("teacherProfile.month3")}</option>
                          <option value={6}>{t("teacherProfile.month6")}</option>
                          <option value={12}>{t("teacherProfile.month12")}</option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                }
              />
              {showEvidenceOverTime ? (
                <MonthlySummary
                  dashboardRes={dashboardRes}
                  periodMonths={periodMonths}
                  evidenceByElement={evidenceByElement}
                  onViewEvidence={setSelectedEvidenceElement}
                />
              ) : (
                <div className="mt-4 text-xs text-slate-500">
                  {t("teacherProfile.breakingItDownDescription")}
                </div>
              )}
            </section>
            {showEvidenceOverTime && selectedEvidenceElement && (
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
                            {t("teacherProfile.noScoreFound")}
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
                            {t("teacherProfile.aiScore", { score: formatScore(scoreRow.score) })}
                          </span>
                          {existingOverride && (
                            <span className="text-[10px] text-emerald-700">
                              {t("teacherProfile.currentOverride", {
                                score: formatScore(existingOverride.adjusted_score),
                              })}
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
                                toast.error(t("teacherProfile.enterValidScore"));
                                return;
                              }
                              adminOverrideMutation.mutate({
                                domain_id: selectedEvidenceElement,
                                original_score: scoreRow.score,
                                adjusted_score: adjusted,
                                rationale: t("teacherProfile.adminAdjustmentRationale"),
                              });
                            }}
                            className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-primary/90"
                          >
                            {t("teacherProfile.apply")}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {isAdmin && overrideByElement[selectedEvidenceElement] && (
                  <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2 text-[11px] text-emerald-800">
                    <div className="font-semibold">{t("teacherProfile.overrideHistory")}</div>
                    <div>
                      {t("teacherProfile.adjustedFromTo", {
                        original: formatScore(overrideByElement[selectedEvidenceElement].original_score),
                        adjusted: formatScore(overrideByElement[selectedEvidenceElement].adjusted_score),
                      })}
                    </div>
                    {overrideByElement[selectedEvidenceElement].rationale && (
                      <div className="text-[10px] text-emerald-700">
                        {overrideByElement[selectedEvidenceElement].rationale}
                      </div>
                    )}
                    <div className="text-[10px] text-emerald-700">
                      {formatDateTime(overrideByElement[selectedEvidenceElement].created_at)}
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <SectionHeader
                title={t("teacherProfile.humanObservations")}
                actions={
                  <button
                    type="button"
                    onClick={() => setShowHumanObservations((prev) => !prev)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {t(showHumanObservations ? "teachersPage.collapse" : "teachersPage.expand")}
                  </button>
                }
              />
              {showHumanObservations ? (
                observations.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {t("teacherProfile.noObservations")}
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
                          <span>{formatDateTime(obs.created_at)}</span>
                          <div className="flex items-center gap-2">
                            {needsAttention && (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                                {t("teacherProfile.needsAttention")}
                              </span>
                            )}
                            {obs.implementation_status && (
                              <span
                                className={
                                  obs.implementation_status === "implemented"
                                    ? "text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700"
                                    : "text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700"
                                }
                              >
                                {formatImplementationStatus(obs.implementation_status)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-700">
                          {obs.admin_comment || t("teacherProfile.noAdminComment")}
                        </div>
                        {obs.teacher_response && (
                          <div className="mt-1 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-700">
                              {t("teacherProfile.teacherResponse")}
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
                            {t("teacherProfile.review")}
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
                            {t("teacherProfile.agree")}
                          </button>
                          <span className="text-[10px] text-slate-500">
                            {t("teacherProfile.status", { status: reviewState })}
                          </span>
                        </div>
                        {obs.video_id && (
                          <div className="mt-2 text-[11px] text-slate-500">
                            <Link
                              to={`/videos/${obs.video_id}`}
                              className="text-primary hover:underline"
                            >
                              {t("teacherProfile.viewLinkedClip")}
                            </Link>
                            {typeof obs.timestamp_seconds === "number" && (
                              <span className={`${isRtl ? "mr-1" : "ml-1"} text-slate-400`}>
                                ({formatClock(obs.timestamp_seconds)})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                )
              ) : (
                <div className="mt-4 text-xs text-slate-500">
                  {t("teacherProfile.breakingItDownDescription")}
                </div>
              )}
            </section>
          </div>

          <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-6 self-start">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-slate-900">
                    {t("teacherProfile.recognition")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("teacherProfile.recognitionDescription")}
                  </p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("teacherProfile.awardedCount", { count: recognitionSummary.five_star_lessons || 0 })}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.five_star_lessons || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.fiveStarLessons")}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.published_exemplars || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.exemplars")}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-900">
                    {recognitionSummary.active_streak || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {t("teacherProfile.activeStreak")}
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {recognitionBadges.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    {t("teacherProfile.noRecognitionBadges")}
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
                            ? t("teacherProfile.fiveStarLessons")
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
                          ? t("teacherProfile.awardedOn", { date: formatDate(badge.awarded_at) })
                          : t("teacherProfile.awaitingAwardDate")}
                      </div>
                      {badge.video_id && (
                        <Link
                          to={`/videos/${badge.video_id}`}
                          className="mt-2 inline-flex text-[11px] font-medium text-primary hover:underline"
                        >
                          {t("teacherProfile.openRecognizedRecording")}
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("teacherProfile.recordingCompliance")}
              </h2>
              {recordingPolicy ? (
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="text-[11px] text-slate-500">
                    {t("teacherProfile.recordingPolicy", {
                      count: recordingPolicy.min_recordings_per_period,
                      days: recordingPolicy.period_length_days,
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("teacherProfile.requiredRecordings")}</span>
                    <span className="text-slate-900">
                      {recordingCompliance?.recordings_completed ?? 0} /{" "}
                      {recordingPolicy.min_recordings_per_period}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {t("teacherProfile.periodLength", { days: recordingPolicy.period_length_days })}
                  </div>
                  {recordingCompliance?.missing_subjects?.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                      {t("teacherProfile.missingSubjects", {
                        subjects: recordingCompliance.missing_subjects.join(", "),
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                      {t("teacherProfile.subjectCoverageComplete")}
                    </div>
                  )}
                  {recordingCompliance?.is_compliant ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      {t("teacherProfile.compliant")}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                      {t("teacherProfile.behindSchedule")}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  {t("teacherProfile.policyNotConfigured")}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("teacherProfile.curriculumAdherence")}
              </h2>
              <p className="mb-3 text-xs text-slate-500">
                {t("teacherProfile.curriculumAdherenceDescription")}
              </p>
              {adherenceRes?.adherence_score != null ? (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">{t("teacherProfile.adherenceScore")}</span>
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
                        {t("teacherProfile.matchedTopics")}
                      </div>
                      <ul className={`list-disc space-y-1 text-xs text-slate-700 ${isRtl ? "pr-4" : "pl-4"}`}>
                        {adherenceRes.matched_topics.slice(0, 3).map((t, idx) => (
                          <li key={idx}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {adherenceRes.evidence_segments?.length ? (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("teacherProfile.evidence")}
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-600">
                        {adherenceRes.evidence_segments.slice(0, 2).map((seg, idx) => (
                          <li key={idx}>
                            {seg.summary} ({formatClock(seg.start_sec)} - {formatClock(seg.end_sec)})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  {t("teacherProfile.uploadLessonPlanToStart")}
                </div>
              )}
            </section>
            
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

