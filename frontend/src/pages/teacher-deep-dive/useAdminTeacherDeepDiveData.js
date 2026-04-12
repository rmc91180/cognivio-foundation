import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  actionPlanApi,
  assessmentApi,
  observationApi,
  teacherApi,
  videoApi,
} from "@/lib/api";
import { runtimeConfig } from "@/lib/runtimeConfig";

export function useAdminTeacherDeepDiveData({ teacherId, periodMonths = 3 }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "he" ? "he-IL" : "en-US";

  const { data: teacherRes } = useQuery({
    queryKey: ["teacher", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.get(teacherId).then((r) => r.data),
  });

  const { data: dashboardRes } = useQuery({
    queryKey: ["teacher-dashboard", teacherId, periodMonths],
    enabled: Boolean(teacherId),
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
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherSummaryInsights(teacherId).then((r) => r.data),
  });

  const { data: conferencePrepRes } = useQuery({
    queryKey: ["teacher-conference-prep", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.conferencePrep(teacherId).then((r) => r.data),
  });

  const { data: coachingTimelineRes } = useQuery({
    queryKey: ["teacher-coaching-timeline", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.coachingTimeline(teacherId).then((r) => r.data),
  });

  const { data: coachingTasksRes } = useQuery({
    queryKey: ["coaching-tasks", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => teacherApi.coachingTasks({ teacher_id: teacherId }).then((r) => r.data),
  });

  const { data: reflectionHistoryRes } = useQuery({
    queryKey: ["teacher-reflection-history", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => assessmentApi.teacherReflectionHistory(teacherId).then((r) => r.data),
  });

  const { data: observationsRes } = useQuery({
    queryKey: ["teacher-observations", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => observationApi.listForTeacher(teacherId).then((r) => r.data),
  });

  const { data: actionPlanRes } = useQuery({
    queryKey: ["action-plan", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => actionPlanApi.get(teacherId).then((r) => r.data),
  });

  const { data: actionPlanHistoryRes } = useQuery({
    queryKey: ["action-plan-history", teacherId],
    enabled: Boolean(teacherId),
    queryFn: () => actionPlanApi.history(teacherId).then((r) => r.data),
  });

  const latestAssessment = useMemo(() => {
    const assessments = dashboardRes?.assessments || [];
    return assessments.length ? assessments[assessments.length - 1] : null;
  }, [dashboardRes]);

  const { data: analysisMomentsRes } = useQuery({
    queryKey: ["analysis-moments", latestAssessment?.video_id],
    enabled:
      Boolean(latestAssessment?.video_id) &&
      runtimeConfig.experimentalMomentRankingEnabled,
    retry: false,
    queryFn: () => videoApi.analysisMoments(latestAssessment.video_id).then((r) => r.data),
  });

  const observations = useMemo(() => observationsRes ?? [], [observationsRes]);

  const sortedObservations = useMemo(
    () =>
      [...observations].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      ),
    [observations]
  );

  const latestReviewedAt =
    latestAssessment?.analyzed_at ||
    latestAssessment?.recorded_at ||
    latestAssessment?.created_at ||
    null;

  const latestLessonObservations = useMemo(() => {
    if (!latestAssessment?.video_id) {
      return sortedObservations.slice(0, 4);
    }
    const scoped = sortedObservations.filter(
      (observation) => observation.video_id === latestAssessment.video_id
    );
    return scoped.length ? scoped : sortedObservations.slice(0, 4);
  }, [latestAssessment, sortedObservations]);

  const latestObservation = latestLessonObservations[0] || null;
  const currentReflectionEntries = useMemo(
    () => reflectionHistoryRes?.current_entries || [],
    [reflectionHistoryRes]
  );
  const reflectionHistory = useMemo(
    () => reflectionHistoryRes?.history || [],
    [reflectionHistoryRes]
  );

  const latestTeacherReflection = useMemo(
    () =>
      currentReflectionEntries.find((entry) => entry.author_role === "teacher") ||
      reflectionHistory.find((entry) => entry.author_role === "teacher") ||
      null,
    [currentReflectionEntries, reflectionHistory]
  );

  const latestAdminReflection = useMemo(
    () =>
      currentReflectionEntries.find((entry) => entry.author_role !== "teacher") ||
      reflectionHistory.find((entry) => entry.author_role !== "teacher") ||
      null,
    [currentReflectionEntries, reflectionHistory]
  );

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
    return {
      strengths: [...ranked].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 3),
      concerns: [...ranked].sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 3),
    };
  }, [elementNameById, latestAssessment]);

  const recurringPatternSummary = useMemo(() => {
    const trendData = dashboardRes?.trend_data || [];
    const elementStats = {};
    trendData.forEach((point) => {
      Object.entries(point.element_scores || {}).forEach(([elementId, score]) => {
        if (!elementStats[elementId]) {
          elementStats[elementId] = {
            elementId,
            baseline: score,
            latest: score,
          };
        } else {
          elementStats[elementId].latest = score;
        }
      });
    });

    const deltas = Object.values(elementStats).map((item) => ({
      ...item,
      label: elementNameById[item.elementId] || item.elementId,
      delta: Number(item.latest || 0) - Number(item.baseline || 0),
    }));

    return {
      strengths: [...deltas]
        .filter((item) => item.delta > 0.2)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 4),
      challenges: [...deltas]
        .filter((item) => item.delta < -0.2)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 4),
    };
  }, [dashboardRes, elementNameById]);

  const goals = useMemo(() => actionPlanRes?.goals || [], [actionPlanRes]);

  const openGoals = useMemo(
    () =>
      goals.filter(
        (goal) => goal?.status !== "complete" && goal?.status !== "implemented"
      ),
    [goals]
  );

  const completedGoals = useMemo(
    () =>
      goals.filter(
        (goal) => goal?.status === "complete" || goal?.status === "implemented"
      ),
    [goals]
  );

  const patternStrengthLabel = useMemo(() => {
    const count = dashboardRes?.assessments?.length || 0;
    if (count <= 1) return t("teacherProfile.singleObservation");
    if (count <= 3) return t("teacherProfile.emergingPattern");
    return t("teacherProfile.establishedPattern");
  }, [dashboardRes, t]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
      }),
    [locale]
  );

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const scoreFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale]
  );

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

  const formatScore = (value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "N/A";
    return scoreFormatter.format(numeric);
  };

  const formatClock = (seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  };

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

  return {
    teacherRes,
    dashboardRes,
    summaryInsightsRes,
    conferencePrepRes,
    coachingTimelineEntries: coachingTimelineRes?.entries || [],
    coachingTasks: coachingTasksRes?.tasks || [],
    reflectionHistoryRes,
    actionPlanRes,
    actionPlanHistoryRes,
    observations,
    latestAssessment,
    latestReviewedAt,
    latestLessonObservations,
    latestObservation,
    latestTeacherReflection,
    latestAdminReflection,
    latestLessonSignals,
    recurringPatternSummary,
    goals,
    openGoals,
    completedGoals,
    patternStrengthLabel,
    analysisMoments: analysisMomentsRes?.moments || [],
    formatDate,
    formatDateTime,
    formatScore,
    formatClock,
    formatMomentPhase,
    formatMomentReason,
  };
}
