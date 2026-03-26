import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assessmentApi,
  adminApi,
  frameworkApi,
  reportApi,
  gradebookApi,
  teacherApi,
  recordingComplianceApi,
  recognitionApi,
  opsApi,
} from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { LeadershipInsightsCard } from "@/components/dashboard/LeadershipInsightsCard";
import { DomainTrendsChart } from "@/components/dashboard/DomainTrendsChart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { subDays } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { Button, EmptyState, LoadingState, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { Link } from "react-router-dom";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { resolveCoachingLink } from "@/lib/coachingRoutes";

const DASHBOARD_SIGNAL_WINDOW_DAYS = 14;

function parseIsoDate(value) {
  if (!value) return null;
  try {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function getTrendDelta(row, windowKey = "30d") {
  const delta = row?.trend_windows?.[windowKey]?.delta;
  return typeof delta === "number" ? delta : null;
}

function formatScoreShort(value) {
  return typeof value === "number" ? value.toFixed(1) : "—";
}

function buildGroupedTeacherLabel(tasks, t) {
  const teacherNames = Array.from(
    new Set(tasks.map((task) => task.teacher_name).filter(Boolean))
  );
  if (!teacherNames.length) return null;
  const visibleNames = teacherNames.slice(0, 3).join(", ");
  const remainingCount = teacherNames.length - Math.min(teacherNames.length, 3);
  return t("dashboard.taskQueueGroupedTeachersContext", {
    count: teacherNames.length,
    teachers: visibleNames,
    overflow:
      remainingCount > 0
        ? t("dashboard.taskQueueTeacherOverflow", { count: remainingCount })
        : "",
  });
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const buildSha = runtimeConfig.buildSha;
  const buildTime = runtimeConfig.buildTime;
  const buildStamp = buildSha
    ? `${buildSha}${buildTime ? ` • ${buildTime}` : ""}`
    : null;
  const isDashboardV2Enabled = runtimeConfig.dashboardV2Enabled;
  const now = useMemo(() => new Date(), []);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language?.startsWith("he") ? "he-IL" : "en-US", {
        month: "short",
        day: "numeric",
      }),
    [i18n.language]
  );
  const currentRange = useMemo(
    () => ({ start: subDays(now, 30), end: now }),
    [now]
  );
  const previousRange = useMemo(
    () => ({ start: subDays(now, 60), end: subDays(now, 30) }),
    [now]
  );
  const recentSignalWindowStart = useMemo(
    () => subDays(now, DASHBOARD_SIGNAL_WINDOW_DAYS),
    [now]
  );
  const [trendWindowMonths, setTrendWindowMonths] = useState(3);
  const [trendTeacherId, setTrendTeacherId] = useState("");
  const [trendSubjects, setTrendSubjects] = useState([]);
  const [domainTrendViewMode, setDomainTrendViewMode] = useState("chart");
  const [departmentProgressViewMode, setDepartmentProgressViewMode] = useState("chart");
  const trendSubjectsParam = useMemo(
    () => trendSubjects.slice().sort((a, b) => a.localeCompare(b)).join(","),
    [trendSubjects]
  );

  const { data: currentData, isLoading } = useQuery({
    queryKey: [
      "roster",
      "current",
      currentRange.start.toISOString(),
      currentRange.end.toISOString(),
    ],
    queryFn: () =>
      assessmentApi
        .roster({
          start_date: currentRange.start.toISOString(),
          end_date: currentRange.end.toISOString(),
        })
        .then((res) => res.data),
  });
  const { data: previousData } = useQuery({
    queryKey: [
      "roster",
      "previous",
      previousRange.start.toISOString(),
      previousRange.end.toISOString(),
    ],
    queryFn: () =>
      assessmentApi
        .roster({
          start_date: previousRange.start.toISOString(),
          end_date: previousRange.end.toISOString(),
        })
        .then((res) => res.data),
  });
  const { data: frameworkSelectionRes } = useQuery({
    queryKey: ["framework-selection"],
    queryFn: () => frameworkApi.currentSelection().then((res) => res.data),
  });
  const frameworkType = frameworkSelectionRes?.framework_type || "danielson";
  const { data: frameworkDetailRes, isLoading: frameworkLoading } = useQuery({
    queryKey: ["framework-detail", frameworkType],
    queryFn: () => frameworkApi.get(frameworkType).then((res) => res.data),
  });
  const { data: gradebookData } = useQuery({
    queryKey: ["gradebook-integrations"],
    queryFn: () => gradebookApi.list().then((res) => res.data),
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const { data: recordingComplianceRes } = useQuery({
    queryKey: ["recording-compliance-summary"],
    enabled: isAdmin,
    queryFn: () => recordingComplianceApi.summary().then((res) => res.data),
  });
  const trendQueryParams = useMemo(() => {
    const params = {
      window_months: trendWindowMonths,
    };
    if (trendTeacherId) params.teacher_id = trendTeacherId;
    if (trendSubjectsParam) params.subjects = trendSubjectsParam;
    return params;
  }, [trendWindowMonths, trendTeacherId, trendSubjectsParam]);
  const { data: domainTrendsRes, isLoading: domainTrendsLoading } = useQuery({
    queryKey: ["dashboard-domain-trends", trendWindowMonths, trendTeacherId, trendSubjectsParam],
    queryFn: () => assessmentApi.dashboardDomainTrends(trendQueryParams).then((res) => res.data),
    enabled: isDashboardV2Enabled && Boolean(currentData?.roster?.length),
  });
  const { data: leadershipInsightsRes, isLoading: leadershipInsightsLoading } = useQuery({
    queryKey: ["dashboard-leadership-insights", trendWindowMonths, trendTeacherId, trendSubjectsParam],
    queryFn: () =>
      assessmentApi.dashboardLeadershipInsights(trendQueryParams).then((res) => res.data),
    enabled: isDashboardV2Enabled && Boolean(currentData?.roster?.length),
  });
  const { data: opsReadinessRes } = useQuery({
    queryKey: ["ops-readiness"],
    enabled: isAdmin,
    queryFn: () => opsApi.readiness().then((res) => res.data),
    refetchInterval: 30000,
  });
  const { data: opsHealthRes } = useQuery({
    queryKey: ["ops-launch-health"],
    enabled: isAdmin,
    queryFn: () => opsApi.launchHealth().then((res) => res.data),
    refetchInterval: 30000,
  });
  const { data: recognitionQueueRes } = useQuery({
    queryKey: ["recognition-review-queue"],
    enabled: isAdmin,
    queryFn: () => recognitionApi.reviewQueue().then((res) => res.data),
    refetchInterval: 30000,
  });
  const { data: cohortAnalyticsRes } = useQuery({
    queryKey: ["dashboard-cohort-analytics"],
    enabled: isAdmin && (user?.workspace_mode === "training" || runtimeConfig.trainingModeFoundationEnabled),
    queryFn: () => assessmentApi.cohortAnalytics().then((res) => res.data),
  });
  const { data: supervisorCalibrationRes } = useQuery({
    queryKey: ["dashboard-supervisor-calibration"],
    enabled: isAdmin && (user?.workspace_mode === "training" || runtimeConfig.trainingModeFoundationEnabled),
    queryFn: () => assessmentApi.supervisorCalibration().then((res) => res.data),
  });
  const { data: feedbackDigestRes } = useQuery({
    queryKey: ["admin-feedback-digest"],
    enabled: isAdmin,
    queryFn: () => adminApi.feedbackDigest().then((res) => res.data),
  });
  const { data: coachingTasksRes } = useQuery({
    queryKey: ["coaching-tasks", "admin"],
    enabled: isAdmin,
    queryFn: () => teacherApi.coachingTasks().then((res) => res.data),
  });

  const roster = useMemo(() => currentData?.roster ?? [], [currentData]);
  const previousRoster = useMemo(
    () => previousData?.roster ?? [],
    [previousData]
  );
  const selectedElements = useMemo(
    () => currentData?.selected_elements ?? [],
    [currentData]
  );
  const teacherOptions = useMemo(() => {
    if (Array.isArray(teachersData)) return teachersData;
    if (Array.isArray(teachersData?.teachers)) return teachersData.teachers;
    return [];
  }, [teachersData]);
  const subjectOptions = useMemo(() => {
    const set = new Set();
    teacherOptions.forEach((teacher) => {
      const rawSubject = teacher?.subject || "";
      rawSubject
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => set.add(item));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teacherOptions]);
  const [selectedElementsState, setSelectedElementsState] = useState([]);
  const [showFocusDomains, setShowFocusDomains] = useState(true);
  const [reportDepartment, setReportDepartment] = useState("");
  const [gradebookProvider, setGradebookProvider] = useState("powerschool");
  const [gradebookApiKey, setGradebookApiKey] = useState("");
  const [expandedComplianceTeacherId, setExpandedComplianceTeacherId] = useState("");
  // Focus areas are driven by framework selection
  const seedDemoMutation = useMutation({
    mutationFn: () => assessmentApi.seedDemoData(),
    onSuccess: (res) => {
      toast.success(res?.data?.message || t("dashboard.demoDataCreated"));
      queryClient.invalidateQueries();
    },
    onError: () => {
      toast.error(t("dashboard.demoDataCreateFailed"));
    },
  });
  const saveDomainSelectionMutation = useMutation({
    mutationFn: () =>
      frameworkApi.saveSelection({
        framework_type: frameworkType,
        selected_elements: selectedElementsState,
      }),
    onSuccess: () => {
      toast.success(t("dashboard.focusDomainsUpdated"));
      queryClient.invalidateQueries({ queryKey: ["framework-selection"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error(t("dashboard.focusDomainsUpdateFailed"));
    },
  });
  const connectGradebookMutation = useMutation({
    mutationFn: (payload) => gradebookApi.connect(payload),
    onSuccess: () => {
      toast.success(t("dashboard.gradebookSaved"));
      queryClient.invalidateQueries({ queryKey: ["gradebook-integrations"] });
      setGradebookApiKey("");
    },
    onError: () => {
      toast.error(t("dashboard.gradebookSaveFailed"));
    },
  });

  const sendComplianceReminderMutation = useMutation({
    mutationFn: (teacherId) => recordingComplianceApi.remind(teacherId),
    onSuccess: () => {
      toast.success(t("dashboard.reminderSent"));
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: () => {
      toast.error(t("dashboard.reminderSendFailed"));
    },
  });

  const frameworkDomains = useMemo(
    () => frameworkDetailRes?.domains || [],
    [frameworkDetailRes]
  );

  useEffect(() => {
    if (selectedElements.length) {
      setSelectedElementsState(selectedElements);
    } else if (frameworkSelectionRes?.selected_elements) {
      setSelectedElementsState(frameworkSelectionRes.selected_elements);
    }
  }, [selectedElements, frameworkSelectionRes]);

  const toggleDomainSelection = (domain) => {
    const elementIds = (domain.elements || []).map((el) => el.id);
    if (!elementIds.length) {
      return;
    }
    const allSelected = elementIds.every((id) =>
      selectedElementsState.includes(id)
    );
    const nextSelected = allSelected
      ? selectedElementsState.filter((id) => !elementIds.includes(id))
      : Array.from(new Set([...selectedElementsState, ...elementIds]));
    setSelectedElementsState(nextSelected);
  };

  const focusDomainStats = useMemo(() => {
    return frameworkDomains.map((domain) => {
      const total = domain.elements?.length || 0;
      const selected = domain.elements?.filter((el) =>
        selectedElementsState.includes(el.id)
      ).length;
      return { id: domain.id, selected, total };
    });
  }, [frameworkDomains, selectedElementsState]);
  const focusElementIds = useMemo(
    () => selectedElementsState.slice(0, 3),
    [selectedElementsState]
  );
  const elementNameById = useMemo(() => {
    const map = {};
    frameworkDomains.forEach((domain) => {
      (domain.elements || []).forEach((el) => {
        map[el.id] = el.name;
      });
    });
    return map;
  }, [frameworkDomains]);
  const focusAreaData = useMemo(() => {
    if (!roster.length || !focusElementIds.length) return [];
    return focusElementIds.map((id) => {
      const label = id.toUpperCase();
      const scores = roster
        .map((teacher) => teacher.element_scores?.[id]?.score)
        .filter((score) => typeof score === "number");
      const teachersWithScore = roster.filter(
        (teacher) => typeof teacher.element_scores?.[id]?.score === "number"
      );
      const assessmentCount = teachersWithScore.reduce(
        (acc, teacher) => acc + (teacher.assessment_count || 0),
        0
      );
      const avg = scores.length
        ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
        : null;
      return {
        elementId: id,
        label,
        averageScore: avg,
        teacherCount: teachersWithScore.length,
        assessmentCount,
        elementName: elementNameById[id] || id,
      };
    });
  }, [roster, focusElementIds, elementNameById]);

  const focusSummary = useMemo(() => {
    const teacherCount = roster.length;
    const assessmentCount = roster.reduce(
      (acc, t) => acc + (t.assessment_count || 0),
      0
    );
    const deptCount = new Set(
      roster.map((row) => row.department || t("labels.noDepartment"))
    ).size;
    return { teacherCount, assessmentCount, deptCount };
  }, [roster]);
  const prioritySupportCount = useMemo(
    () =>
      roster.filter(
        (teacher) =>
          typeof teacher?.overall_score === "number" && teacher.overall_score < 6
      ).length,
    [roster]
  );
  const teacherMetaById = useMemo(() => {
    const map = {};
    teacherOptions.forEach((teacher) => {
      map[teacher.id] = teacher;
    });
    return map;
  }, [teacherOptions]);
  const teacherKpiRows = useMemo(
    () =>
      roster
        .map((teacher) => {
          const meta = teacherMetaById[teacher.teacher_id] || {};
          return {
            id: teacher.teacher_id,
            name: teacher.teacher_name || meta.name || t("teachersPage.teacher"),
            subject: teacher.subject || meta.subject || t("labels.noSubject"),
            department: teacher.department || meta.department || t("labels.noDepartment"),
            overallScore: teacher.overall_score,
            assessmentCount: teacher.assessment_count || 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roster, teacherMetaById]
  );
  const supportKpiRows = useMemo(
    () =>
      teacherKpiRows
        .filter((row) => typeof row.overallScore === "number" && row.overallScore < 6)
        .sort((a, b) => (a.overallScore || 0) - (b.overallScore || 0)),
    [teacherKpiRows]
  );
  const trendDomains = useMemo(() => domainTrendsRes?.domains || [], [domainTrendsRes]);
  const trendPeriods = useMemo(() => domainTrendsRes?.periods || [], [domainTrendsRes]);
  const selectedTrendTeacherName = useMemo(() => {
    const selectedFromTrend = domainTrendsRes?.selected_teacher?.name;
    if (selectedFromTrend) return selectedFromTrend;
    const matched = teacherOptions.find((teacher) => teacher.id === trendTeacherId);
    return matched?.name || t("dashboard.selectedTeacher");
  }, [domainTrendsRes, teacherOptions, trendTeacherId]);
  const domainTrendChartData = useMemo(() => {
    if (!trendPeriods.length || !trendDomains.length) return [];
    return trendPeriods.map((period) => {
      const row = {
        label: period.label,
        overall_all: period.all_teachers?.overall_score ?? null,
        overall_teacher: period.selected_teacher?.overall_score ?? null,
      };
      trendDomains.forEach((domain) => {
        row[`all_${domain.id}`] = period.all_teachers?.domain_scores?.[domain.id] ?? null;
        row[`teacher_${domain.id}`] =
          period.selected_teacher?.domain_scores?.[domain.id] ?? null;
      });
      return row;
    });
  }, [trendPeriods, trendDomains]);
  const domainTrendEvidenceLines = useMemo(() => {
    if (!trendPeriods.length || !trendDomains.length) return [];
    const firstPeriod = trendPeriods[0];
    const lastPeriod = trendPeriods[trendPeriods.length - 1];
    const lines = [
      t("dashboard.domainTrendEvidenceOverview", {
        start: firstPeriod.label,
        end: lastPeriod.label,
        teachers: focusSummary.teacherCount,
        observations: focusSummary.assessmentCount,
      }),
    ];
    trendDomains.forEach((domain) => {
      const allStart = firstPeriod.all_teachers?.domain_scores?.[domain.id];
      const allEnd = lastPeriod.all_teachers?.domain_scores?.[domain.id];
      if (typeof allStart === "number" && typeof allEnd === "number") {
        lines.push(
          t("dashboard.domainTrendEvidenceLine", {
            domain: domain.name,
            start: formatScoreShort(allStart),
            end: formatScoreShort(allEnd),
          })
        );
      }
      if (trendTeacherId) {
        const teacherStart = firstPeriod.selected_teacher?.domain_scores?.[domain.id];
        const teacherEnd = lastPeriod.selected_teacher?.domain_scores?.[domain.id];
        if (typeof teacherStart === "number" && typeof teacherEnd === "number") {
          lines.push(
            t("dashboard.domainTrendEvidenceCompareLine", {
              teacher: selectedTrendTeacherName,
              domain: domain.name,
              start: formatScoreShort(teacherStart),
              end: formatScoreShort(teacherEnd),
            })
          );
        }
      }
    });
    return lines;
  }, [
    focusSummary.assessmentCount,
    focusSummary.teacherCount,
    selectedTrendTeacherName,
    t,
    trendDomains,
    trendPeriods,
    trendTeacherId,
  ]);
  const achievements = useMemo(() => {
    if (!focusAreaData.length) return [];
    const sorted = [...focusAreaData]
      .filter((item) => typeof item.averageScore === "number")
      .sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
    return sorted.slice(0, 3).map((item) => {
      const count = item.teacherCount;
      const label = item.elementName || item.elementId;
      return t("dashboard.achievementLine", {
        count,
        label: label.toLowerCase(),
      });
    });
  }, [focusAreaData]);


  const departmentData = useMemo(() => {
    if (!roster.length && !previousRoster.length) return [];
    const buildBuckets = (rows) => {
      const buckets = {};
      rows.forEach((row) => {
        const dept = row.department || t("labels.noDepartment");
        const bucket = buckets[dept] || { department: dept, total: 0, count: 0 };
        if (typeof row.overall_score === "number") {
          bucket.total += row.overall_score;
          bucket.count += 1;
        }
        buckets[dept] = bucket;
      });
      return buckets;
    };

    const currentBuckets = buildBuckets(roster);
    const previousBuckets = buildBuckets(previousRoster);
    const departments = new Set([
      ...Object.keys(currentBuckets),
      ...Object.keys(previousBuckets),
    ]);
    return Array.from(departments).map((dept) => {
      const current = currentBuckets[dept];
      const previous = previousBuckets[dept];
      const currentAvg =
        current && current.count > 0
          ? Number((current.total / current.count).toFixed(2))
          : null;
      const previousAvg =
        previous && previous.count > 0
          ? Number((previous.total / previous.count).toFixed(2))
          : null;
      const delta =
        currentAvg != null && previousAvg != null
          ? Number((currentAvg - previousAvg).toFixed(2))
          : null;
      return {
        department: dept,
        averageScore: currentAvg,
        previousAverage: previousAvg,
        delta,
      };
    });
  }, [roster, previousRoster]);
  const departmentKpiRows = useMemo(() => {
    const counts = {};
    teacherKpiRows.forEach((row) => {
      const key = row.department || t("labels.noDepartment");
      counts[key] = (counts[key] || 0) + 1;
    });
    return departmentData
      .map((row) => ({
        department: row.department,
        teacherCount: counts[row.department] || 0,
        averageScore: row.averageScore,
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }, [departmentData, teacherKpiRows]);

  const departmentOptions = useMemo(() => {
    const set = new Set();
    roster.forEach((t) => {
      if (t.department) set.add(t.department);
    });
    return Array.from(set).sort();
  }, [roster]);
  const complianceSummaryRows = useMemo(() => {
    if (!Array.isArray(recordingComplianceRes?.summary)) return [];
    return recordingComplianceRes.summary;
  }, [recordingComplianceRes]);
  const recognitionQueueItems = useMemo(
    () => recognitionQueueRes?.items || [],
    [recognitionQueueRes]
  );
  const departmentProgressEvidenceLines = useMemo(() => {
    if (!departmentData.length) return [];
    return departmentData.map((row) =>
      t("dashboard.departmentProgressEvidenceLine", {
        department: row.department,
        teachers: departmentKpiRows.find((item) => item.department === row.department)?.teacherCount || 0,
        current: formatScoreShort(row.averageScore),
        previous: formatScoreShort(row.previousAverage),
        delta:
          typeof row.delta === "number"
            ? row.delta > 0
              ? `+${row.delta.toFixed(1)}`
              : row.delta.toFixed(1)
            : "—",
      })
    );
  }, [departmentData, departmentKpiRows, t]);
  const behindComplianceRows = useMemo(
    () => complianceSummaryRows.filter((row) => (row.missing_subjects?.length || 0) > 0),
    [complianceSummaryRows]
  );
  const expandedComplianceRow = useMemo(
    () =>
      behindComplianceRows.find((row) => row.teacher_id === expandedComplianceTeacherId) || null,
    [behindComplianceRows, expandedComplianceTeacherId]
  );

  useEffect(() => {
    if (!expandedComplianceTeacherId) return;
    if (!expandedComplianceRow) setExpandedComplianceTeacherId("");
  }, [expandedComplianceTeacherId, expandedComplianceRow]);


  const downloadReport = async (format, params, filename) => {
    try {
      const res = await reportApi.export(format, params);
      const blob = new Blob([res.data], { type: res.headers["content-type"] });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(t("dashboard.exportFailed"));
    }
  };

  const dashboardRoleShellEnabled = runtimeConfig.dashboardRoleShellEnabled;
  const dashboardSmartQueueEnabled = runtimeConfig.dashboardSmartQueueEnabled;
  const guidedOnboardingEnabled = runtimeConfig.guidedOnboardingEnabled;
  const improvedEmptyStatesEnabled = runtimeConfig.improvedEmptyStatesEnabled;
  const trainingModeFoundationEnabled =
    user?.workspace_mode === "training" || runtimeConfig.trainingModeFoundationEnabled;
  const pageTitle = trainingModeFoundationEnabled
    ? t("dashboard.trainingTitle")
    : t("dashboard.title");
  const pageDescription = trainingModeFoundationEnabled
    ? t("dashboard.trainingDescription")
    : t("dashboard.description");
  const hasTeachers = teacherOptions.length > 0;
  const hasAnyObservations = roster.some((teacher) => (teacher.assessment_count || 0) > 0);
  const focusAreasConfigured =
    selectedElementsState.length > 0 ||
    Boolean(selectedElements.length) ||
    Boolean(frameworkSelectionRes?.selected_elements?.length);
  const teachersMissingPrivacyProfiles =
    opsReadinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0;
  const privacyReviewsPending = opsHealthRes?.metrics?.privacy_reviews_pending ?? 0;
  const workspaceModeLabel = trainingModeFoundationEnabled
    ? t("dashboard.workspaceModeProgram")
    : t("dashboard.workspaceModeSchool");
  const workspaceStatusLabel = !hasTeachers
    ? t("dashboard.workspaceStatusSetup")
    : teachersMissingPrivacyProfiles > 0 ||
        behindComplianceRows.length > 0 ||
        privacyReviewsPending > 0
      ? t("dashboard.workspaceStatusAttention")
      : t("dashboard.workspaceStatusReady");
  const workspaceRoleLabel = isAdmin
    ? t("dashboard.workspaceRoleAdmin")
    : t("dashboard.workspaceRoleTeacher");
  const onboardingItems = useMemo(() => {
    if (!isAdmin) return [];
    return [
      {
        id: "teachers",
        title: t("dashboard.onboardingTeachersTitle"),
        description: t("dashboard.onboardingTeachersDescription"),
        complete: hasTeachers,
        actionLabel: hasTeachers
          ? t("dashboard.onboardingReviewTeachers")
          : t("dashboard.onboardingAddTeachers"),
        to: "/teachers",
      },
      {
        id: "focus",
        title: t("dashboard.onboardingFocusTitle"),
        description: t("dashboard.onboardingFocusDescription"),
        complete: focusAreasConfigured,
        actionLabel: t("dashboard.onboardingOpenSetup"),
        to: "/school-setup",
      },
      {
        id: "privacy",
        title: t("dashboard.onboardingPrivacyTitle"),
        description: t("dashboard.onboardingPrivacyDescription"),
        complete: hasTeachers && teachersMissingPrivacyProfiles === 0,
        actionLabel: t("dashboard.onboardingReviewTeachers"),
        to: "/teachers",
      },
      {
        id: "evidence",
        title: t("dashboard.onboardingEvidenceTitle"),
        description: t("dashboard.onboardingEvidenceDescription"),
        complete: hasAnyObservations,
        actionLabel: t("dashboard.onboardingOpenVideos"),
        to: "/videos",
      },
    ];
  }, [
    focusAreasConfigured,
    hasAnyObservations,
    hasTeachers,
    isAdmin,
    t,
    teachersMissingPrivacyProfiles,
  ]);
  const formatShortDate = (value) => {
    const parsed = parseIsoDate(value);
    return parsed ? dateFormatter.format(parsed) : t("dashboard.dateUnavailable");
  };
  const recentLessonSignals = useMemo(() => {
    return roster
      .map((teacher) => {
        const latestObservation = teacher.recent_observations?.[0] || null;
        const latestDate = latestObservation?.created_at || teacher.last_assessment_date;
        const parsedLatestDate = parseIsoDate(latestDate);
        if (!parsedLatestDate) return null;
        const delta30 = getTrendDelta(teacher);
        const overallScore = teacher?.overall_score;
        const immediateState =
          (typeof overallScore === "number" && overallScore < 6) ||
          (typeof delta30 === "number" && delta30 < -0.2)
            ? "follow_up"
            : typeof delta30 === "number" && delta30 > 0.3
              ? "improving"
              : "monitor";
        return {
          teacherId: teacher.teacher_id,
          teacherName: teacher.teacher_name,
          subject: teacher.subject || t("labels.noSubject"),
          latestDate,
          latestSummary:
            latestObservation?.summary ||
            latestObservation?.admin_comment ||
            t("dashboard.signalNoLessonComment"),
          latestAdminComment:
            latestObservation?.admin_comment || latestObservation?.summary || null,
          nextAction: teacher.action_items?.[0]?.title || null,
          assessmentCount: teacher.assessment_count || 0,
          immediateState,
          isFresh: parsedLatestDate >= recentSignalWindowStart,
        };
      })
      .filter(Boolean)
      .sort((a, b) => parseIsoDate(b.latestDate) - parseIsoDate(a.latestDate))
      .slice(0, 4);
  }, [recentSignalWindowStart, roster, t]);
  const recurringPatternCards = useMemo(() => {
    return roster
      .map((teacher) => {
        const observationCount = teacher.assessment_count || 0;
        const delta30 = getTrendDelta(teacher);
        const latestObservation = teacher.recent_observations?.[0] || null;
        const ongoingGoal = teacher.action_items?.[0]?.title || null;
        if (!ongoingGoal && observationCount < 2 && delta30 == null) {
          return null;
        }
        const overallScore = teacher?.overall_score;
        const patternState =
          ongoingGoal ||
          (typeof overallScore === "number" && overallScore < 6) ||
          (typeof delta30 === "number" && delta30 < -0.2)
            ? "challenge"
            : typeof delta30 === "number" && delta30 > 0.3
              ? "improving"
              : "emerging";
        return {
          teacherId: teacher.teacher_id,
          teacherName: teacher.teacher_name,
          subject: teacher.subject || t("labels.noSubject"),
          ongoingGoal: ongoingGoal || t("dashboard.patternNoGoal"),
          recurringEvidence:
            latestObservation?.admin_comment ||
            latestObservation?.summary ||
            t("dashboard.patternNoEvidence"),
          observationCount,
          delta30,
          patternState,
          patternStrength:
            observationCount >= 4
              ? t("dashboard.establishedPattern")
              : t("dashboard.emergingPattern"),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const priority = { challenge: 0, improving: 1, emerging: 2 };
        const stateDelta = (priority[a.patternState] ?? 9) - (priority[b.patternState] ?? 9);
        if (stateDelta !== 0) return stateDelta;
        return (b.observationCount || 0) - (a.observationCount || 0);
      })
      .slice(0, 4);
  }, [roster, t]);
  const triageCards = useMemo(() => {
    const freshSignalsCount = roster.filter((teacher) => {
      const latestDate =
        teacher.recent_observations?.[0]?.created_at || teacher.last_assessment_date;
      const parsedLatestDate = parseIsoDate(latestDate);
      return parsedLatestDate ? parsedLatestDate >= recentSignalWindowStart : false;
    }).length;
    const recurringThemesCount = roster.filter((teacher) => {
      const delta30 = getTrendDelta(teacher);
      return (
        (teacher.action_items?.length || 0) > 0 ||
        (teacher.assessment_count || 0) >= 2 ||
        delta30 != null
      );
    }).length;
    const improvingMomentumCount = roster.filter((teacher) => {
      const delta30 = getTrendDelta(teacher);
      return typeof delta30 === "number" && delta30 > 0.3;
    }).length;
    return [
      {
        id: "follow-up",
        title: t("dashboard.triageFollowUpTitle"),
        description: t("dashboard.triageFollowUpDescription"),
        value: recentLessonSignals.filter((item) => item.immediateState === "follow_up").length,
        tone: "rose",
      },
      {
        id: "fresh-signals",
        title: t("dashboard.triageRecentSignalsTitle"),
        description: t("dashboard.triageRecentSignalsDescription"),
        value: freshSignalsCount,
        tone: "sky",
      },
      {
        id: "recurring-themes",
        title: t("dashboard.triageRecurringThemesTitle"),
        description: t("dashboard.triageRecurringThemesDescription"),
        value: recurringThemesCount,
        tone: "amber",
      },
      {
        id: "improving-momentum",
        title: t("dashboard.triageMomentumTitle"),
        description: t("dashboard.triageMomentumDescription"),
        value: improvingMomentumCount,
        tone: "emerald",
      },
    ];
  }, [recentLessonSignals, recentSignalWindowStart, roster, t]);
  const triageToneClasses = {
    rose: "border-rose-200 bg-rose-50/70",
    sky: "border-sky-200 bg-sky-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
  };
  const attentionCount =
    teachersMissingPrivacyProfiles + behindComplianceRows.length + privacyReviewsPending;
  const dashboardOverviewCards = useMemo(
    () => [
      {
        id: "teachers",
        title: t("dashboard.workspaceTeachersLabel"),
        value: teacherOptions.length,
        description: t("dashboard.workspaceTeachersDescription"),
        to: "/teachers",
      },
      {
        id: "evidence",
        title: t("dashboard.workspaceEvidenceLabel"),
        value: focusSummary.assessmentCount,
        description: t("dashboard.workspaceEvidenceDescription"),
        to: "/videos",
      },
      {
        id: "attention",
        title: t("dashboard.workspaceAttentionLabel"),
        value: attentionCount,
        description: t("dashboard.workspaceAttentionDescription"),
        to: privacyReviewsPending > 0 ? "/privacy-review" : "/teachers",
      },
      {
        id: "support",
        title: t("dashboard.kpiSupportTitle"),
        value: prioritySupportCount,
        description: t("dashboard.dashboardSupportOverviewDescription"),
        to: supportKpiRows[0]?.id ? `/teachers/${supportKpiRows[0].id}` : "/teachers",
      },
    ],
    [
      attentionCount,
      focusSummary.assessmentCount,
      prioritySupportCount,
      privacyReviewsPending,
      supportKpiRows,
      t,
      teacherOptions.length,
    ]
  );
  const smartQueueItems = useMemo(() => {
    if (isAdmin) {
      const groupedSharedTasks = [];
      const privacyTasks = (coachingTasksRes?.tasks || []).filter(
        (task) => task.state === "privacy_blocker"
      );
      if (privacyTasks.length) {
        groupedSharedTasks.push({
          id: "grouped-privacy-blockers",
          title: t("dashboard.taskQueuePrivacyTitle"),
          description: t("dashboard.taskQueuePrivacyDescription", {
            count: privacyTasks.length,
          }),
          contextLabel: buildGroupedTeacherLabel(privacyTasks, t),
          actionLabel: t("dashboard.taskQueueOpenRoster"),
          to: "/teachers",
          tone: "amber",
        });
      }
      const specificSharedTasks = (coachingTasksRes?.tasks || [])
        .filter((task) => task.state !== "privacy_blocker")
        .slice(0, 4)
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.support_prompt || task.summary,
          contextLabel: task.context_label || task.teacher_name,
          actionLabel: t("coachingTasks.openTask"),
          to: resolveCoachingLink(user, task.teacher_id, task.route_hint, {
            videoId: task.video_id,
          }),
          tone:
            task.state === "conference_upcoming"
              ? "emerald"
              : task.state === "goal_checkpoint_due"
                ? "sky"
                : "rose",
        }));
      const sharedTasks = [...groupedSharedTasks, ...specificSharedTasks].slice(0, 4);
      if (sharedTasks.length) {
        return sharedTasks;
      }
      const items = [];
      if (!hasAnyObservations) {
        items.push({
          id: "capture-evidence",
          title: t("dashboard.taskQueueEvidenceTitle"),
          description: t("dashboard.taskQueueEvidenceDescription"),
          actionLabel: t("dashboard.smartQueueOpenVideos"),
          to: "/videos",
          tone: "sky",
        });
      }
      if (!focusAreasConfigured) {
        items.push({
          id: "configure-focus",
          title: t("dashboard.taskQueueFocusTitle"),
          description: t("dashboard.taskQueueFocusDescription"),
          actionLabel: t("dashboard.smartQueueOpenSetup"),
          to: "/school-setup",
          tone: "sky",
        });
      }
      return items.slice(0, 4);
    }

    return [
      {
        id: "teacher-videos",
        title: t("dashboard.smartQueueTeacherVideosTitle"),
        description: hasAnyObservations
          ? t("dashboard.smartQueueTeacherVideosReady")
          : t("dashboard.smartQueueTeacherVideosDescription"),
        actionLabel: t("dashboard.smartQueueOpenVideos"),
        to: "/videos",
        tone: "sky",
      },
      {
        id: "teacher-dashboard",
        title: t("dashboard.smartQueueTeacherDashboardTitle"),
        description: t("dashboard.smartQueueTeacherDashboardDescription"),
        actionLabel: t("dashboard.smartQueueRefreshDashboard"),
        to: "/dashboard",
        tone: "emerald",
      },
    ];
  }, [
    focusAreasConfigured,
    hasAnyObservations,
    isAdmin,
    coachingTasksRes,
    t,
    user,
  ]);
  const queueToneClasses = {
    rose: "border-rose-200 bg-rose-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    sky: "border-sky-200 bg-sky-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={pageTitle}
          description={pageDescription}
          meta={buildStamp ? t("dashboard.buildMeta", { build: buildStamp }) : null}
          actions={
            <Button
              variant="success"
              size="sm"
              onClick={() => seedDemoMutation.mutate()}
              disabled={seedDemoMutation.isPending}
            >
              {seedDemoMutation.isPending ? t("dashboard.seedingData") : t("dashboard.seedDemoData")}
            </Button>
          }
        />

        {dashboardRoleShellEnabled && (
          <Panel className="mb-6 border border-slate-200 bg-white">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <span>{workspaceRoleLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="text-emerald-700">{workspaceModeLabel}</span>
              <span className="text-slate-300">/</span>
              <span>{workspaceStatusLabel}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {dashboardOverviewCards.map((card) => (
                <Link
                  key={card.id}
                  to={card.to}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition-colors hover:bg-slate-100"
                >
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {card.title}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {card.value}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {card.description}
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        )}

        {isAdmin && trainingModeFoundationEnabled && (
          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <Panel>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.cohortAnalyticsTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.cohortAnalyticsDescription")}
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortTeacherCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {cohortAnalyticsRes?.overview?.teacher_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortAssessmentCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {cohortAnalyticsRes?.overview?.assessment_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortSupportCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-rose-700">
                    {cohortAnalyticsRes?.overview?.support_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortImprovingCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-emerald-700">
                    {cohortAnalyticsRes?.overview?.improving_count ?? 0}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortSkillGaps")}
                  </div>
                  <div className="space-y-2">
                    {(cohortAnalyticsRes?.skill_gaps || []).map((item) => (
                      <div key={item.element_id} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <div className="text-sm font-medium text-slate-800">{item.element_name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t("dashboard.cohortAverageScore", {
                            score: item.average_score ?? "—",
                            count: item.assessment_count ?? 0,
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("dashboard.cohortBreakdown")}
                  </div>
                  <div className="space-y-2">
                    {(cohortAnalyticsRes?.category_breakdown || []).map((item) => (
                      <div key={item.category} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <div className="text-sm font-medium text-slate-800">{item.category}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t("dashboard.cohortCategoryLine", {
                            teachers: item.teacher_count ?? 0,
                            score: item.average_score ?? "—",
                            improving: item.improving_count ?? 0,
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.calibrationTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.calibrationDescription")}
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.calibrationReviewerCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {supervisorCalibrationRes?.overview?.reviewer_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.calibrationFeedbackCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {supervisorCalibrationRes?.overview?.feedback_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    {t("dashboard.calibrationOverrideCount")}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {supervisorCalibrationRes?.overview?.override_count ?? 0}
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {(supervisorCalibrationRes?.reviewers || []).map((row) => (
                  <div key={row.reviewer_id} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">{row.reviewer_name}</div>
                      <div className="text-[11px] text-slate-500">
                        {t("dashboard.calibrationReviewerLine", {
                          observations: row.observation_count ?? 0,
                          feedback: row.feedback_count ?? 0,
                          overrides: row.override_count ?? 0,
                        })}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">{row.calibration_note}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {isAdmin && feedbackDigestRes?.items?.length ? (
          <Panel className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.feedbackDigestTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.feedbackDigestDescription")}
                </p>
              </div>
              <div className="text-[11px] text-slate-500">
                {t("dashboard.feedbackDigestCounts", {
                  feedback: feedbackDigestRes?.totals?.feedback_records ?? 0,
                  overrides: feedbackDigestRes?.totals?.override_records ?? 0,
                })}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {feedbackDigestRes.items.slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-sm font-medium text-slate-800">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{item.summary}</div>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {isAdmin && (
          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.privacyOperationsTitle")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("dashboard.privacyOperationsDescription")}
                  </p>
                </div>
                <Link
                  to="/privacy-review"
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("dashboard.openPrivacyReview")}
                </Link>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.pendingReviews")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {opsHealthRes?.metrics?.privacy_reviews_pending ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.privacyQueue")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {opsHealthRes?.metrics?.privacy_queue_depth ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.privacyFailures24h")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {opsHealthRes?.metrics?.failed_privacy_jobs_24h ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.missingProfiles")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {opsReadinessRes?.metrics?.teachers_missing_privacy_profiles ?? 0}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.recognitionOperationsTitle")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("dashboard.recognitionOperationsDescription")}
                  </p>
                </div>
                <Link
                  to="/recognition-review"
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("dashboard.openRecognitionReview")}
                </Link>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.pendingReviews")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {recognitionQueueItems.length}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.libraryScope")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {recognitionQueueItems.filter((item) => item.sharing_scope === "cognivio_library").length}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{t("dashboard.schoolScope")}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {recognitionQueueItems.filter((item) => item.sharing_scope === "school_only").length}
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {!isLoading && dashboardSmartQueueEnabled && (
          <Panel className="mb-6 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.taskQueueTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.taskQueueDescription")}
                </p>
              </div>
              {smartQueueItems.length > 0 ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {t("dashboard.smartQueueCount", { count: smartQueueItems.length })}
                </span>
              ) : null}
            </div>
            {smartQueueItems.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {smartQueueItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-4 py-4 ${queueToneClasses[item.tone] || "border-slate-200 bg-slate-50"}`}
                  >
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-600">{item.description}</p>
                    {item.contextLabel ? (
                      <div className="mt-2 text-[11px] text-slate-500">{item.contextLabel}</div>
                    ) : null}
                    <div className="mt-4">
                      <Link
                        to={item.to}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        {item.actionLabel}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                {t("dashboard.taskQueueClear")}
              </div>
            )}
          </Panel>
        )}

        {!isLoading && guidedOnboardingEnabled && isAdmin && onboardingItems.length > 0 && (
          <Panel className="mb-6 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.onboardingTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.onboardingDescription")}
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                {t("dashboard.onboardingProgress", {
                  completed: onboardingItems.filter((item) => item.complete).length,
                  total: onboardingItems.length,
                })}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {onboardingItems.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border px-4 py-4 ${
                    item.complete
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.complete
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.complete
                        ? t("dashboard.onboardingDone")
                        : t("dashboard.onboardingNext")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                  <div className="mt-4">
                    <Link
                      to={item.to}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {isLoading ? (
          <LoadingState className="mt-8" message={t("dashboard.loadingRoster")} />
        ) : roster.length === 0 ? (
          improvedEmptyStatesEnabled ? (
            <Panel className="mt-8 border border-dashed border-slate-300 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {hasTeachers
                      ? t("dashboard.emptyRosterTitle")
                      : t("dashboard.noTeachersTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {hasTeachers
                      ? t("dashboard.emptyRosterMessage")
                      : t("dashboard.noTeachersMessage")}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {t("dashboard.emptyStateStatus")}
                </span>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.emptyStateTeachersTitle")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("dashboard.emptyStateTeachersDescription")}
                  </p>
                  <div className="mt-4">
                    <Link
                      to="/teachers"
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("dashboard.smartQueueOpenTeachers")}
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.emptyStateVideosTitle")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("dashboard.emptyStateVideosDescription")}
                  </p>
                  <div className="mt-4">
                    <Link
                      to="/videos"
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("dashboard.smartQueueOpenVideos")}
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.emptyStateSetupTitle")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("dashboard.emptyStateSetupDescription")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to="/school-setup"
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("dashboard.smartQueueOpenSetup")}
                    </Link>
                    {!hasTeachers && (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => seedDemoMutation.mutate()}
                        disabled={seedDemoMutation.isPending}
                      >
                        {seedDemoMutation.isPending
                          ? t("dashboard.seedingData")
                          : t("dashboard.seedDemoData")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          ) : (
            <EmptyState
              className="mt-8"
              title={t("dashboard.noTeachersTitle")}
              message={t("dashboard.noTeachersMessage")}
            />
          )
        ) : (
          <>
            {isAdmin && (
              <>
                <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
                  <SectionHeader
                    title={t("dashboard.triageTitle")}
                    description={t("dashboard.triageDescription")}
                    tags={[t("timeScope.latestClass"), t("timeScope.recurringPattern")]}
                  />
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {triageCards.map((card) => (
                      <div
                        key={card.id}
                        className={`rounded-xl border px-4 py-4 ${triageToneClasses[card.tone]}`}
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {card.title}
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {card.value}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{card.description}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
                  <SectionHeader
                    title={t("dashboard.recentLessonSignalsTitle")}
                    description={t("dashboard.recentLessonSignalsDescription")}
                    tags={[t("timeScope.fromThisLesson"), t("timeScope.immediateFollowUp")]}
                    actions={
                      <Link
                        to="/teachers"
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        {t("dashboard.smartQueueOpenTeachers")}
                      </Link>
                    }
                  />
                  {recentLessonSignals.length === 0 ? (
                    <div className="mt-4 text-xs text-slate-500">
                      {t("dashboard.recentLessonSignalsEmpty")}
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {recentLessonSignals.map((signal) => (
                        <div
                          key={`recent-signal-${signal.teacherId}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {signal.teacherName}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {signal.subject} • {t("dashboard.latestLessonDate", {
                                  date: formatShortDate(signal.latestDate),
                                })}
                              </div>
                            </div>
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                signal.immediateState === "follow_up"
                                  ? "text-rose-700"
                                  : signal.immediateState === "improving"
                                    ? "text-emerald-700"
                                    : "text-slate-500"
                              }`}
                            >
                              {signal.immediateState === "follow_up"
                                ? t("dashboard.signalFollowUpNow")
                                : signal.immediateState === "improving"
                                  ? t("dashboard.signalImproving")
                                  : t("dashboard.signalMonitor")}
                            </span>
                          </div>
                          <p className="mt-3 text-sm text-slate-700">{signal.latestSummary}</p>
                          <div className="mt-3 space-y-2 text-xs text-slate-600">
                            {signal.latestAdminComment ? (
                              <div>
                                <span className="font-semibold text-slate-800">
                                  {t("dashboard.latestAdminCommentLabel")}:
                                </span>{" "}
                                {signal.latestAdminComment}
                              </div>
                            ) : null}
                            <div>
                              <span className="font-semibold text-slate-800">
                                {t("dashboard.nextImmediateStep")}:
                              </span>{" "}
                              {signal.nextAction || t("dashboard.signalNoImmediateAction")}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {t("dashboard.patternEvidenceLine", {
                                count: signal.assessmentCount,
                              })}
                            </div>
                          </div>
                          <div className="mt-4">
                            <Link
                              to={`/teachers/${signal.teacherId}`}
                              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                            >
                              {t("dashboard.openTeacherDeepDive")}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
                  <SectionHeader
                    title={t("dashboard.recurringPatternsTitle")}
                    description={t("dashboard.recurringPatternsDescription")}
                    tags={[t("timeScope.ongoingGoal"), t("timeScope.acrossRecentObservations")]}
                    actions={
                      <Link
                        to="/teachers"
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        {t("dashboard.reviewTeacherRoster")}
                      </Link>
                    }
                  />
                  {recurringPatternCards.length === 0 ? (
                    <div className="mt-4 text-xs text-slate-500">
                      {t("dashboard.recurringPatternsEmpty")}
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {recurringPatternCards.map((pattern) => (
                        <div
                          key={`recurring-pattern-${pattern.teacherId}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {pattern.teacherName}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {pattern.subject}
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                pattern.patternState === "challenge"
                                  ? "bg-rose-100 text-rose-700"
                                  : pattern.patternState === "improving"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {pattern.patternState === "challenge"
                                ? t("dashboard.patternChallenge")
                                : pattern.patternState === "improving"
                                  ? t("dashboard.signalImproving")
                                  : t("dashboard.patternEmerging")}
                            </span>
                          </div>
                          <div className="mt-3 space-y-2 text-xs text-slate-600">
                            <div>
                              <span className="font-semibold text-slate-800">
                                {t("dashboard.ongoingGoalLabel")}:
                              </span>{" "}
                              {pattern.ongoingGoal}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">
                                {t("dashboard.recurringEvidenceLabel")}:
                              </span>{" "}
                              {pattern.recurringEvidence}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                              <span>
                                {t("dashboard.patternStrengthLabel")}: {pattern.patternStrength}
                              </span>
                              <span>
                                {t("dashboard.patternEvidenceLine", {
                                  count: pattern.observationCount,
                                })}
                              </span>
                              <span>
                                {typeof pattern.delta30 === "number"
                                  ? pattern.delta30 > 0
                                    ? t("dashboard.patternTrendUp", {
                                        value: pattern.delta30.toFixed(1),
                                      })
                                    : pattern.delta30 < 0
                                      ? t("dashboard.patternTrendDown", {
                                          value: Math.abs(pattern.delta30).toFixed(1),
                                        })
                                      : t("dashboard.patternTrendFlat")
                                  : t("dashboard.patternTrendFlat")}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4">
                            <Link
                              to={`/teachers/${pattern.teacherId}`}
                              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                            >
                              {t("dashboard.openTeacherDeepDive")}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">
                  {t("dashboard.quickActions")}
                </span>
                <Link
                  to="/teachers"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboard.reviewTeacherRoster")}
                </Link>
                <Link
                  to="/videos"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboard.openRecordingsLibrary")}
                </Link>
                <Link
                  to="/school-setup"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboard.updateSchoolSetup")}
                </Link>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              {isDashboardV2Enabled ? (
                <>
                <LeadershipInsightsCard
                  insights={leadershipInsightsRes}
                  isLoading={leadershipInsightsLoading}
                />
                <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {t("dashboard.domainTrendsTitle")}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {t("dashboard.domainTrendsDescription", {
                          count: trendWindowMonths,
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() => setDomainTrendViewMode("evidence")}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                            domainTrendViewMode === "evidence"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-600"
                          }`}
                        >
                          {t("dashboard.evidenceView")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDomainTrendViewMode("chart")}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                            domainTrendViewMode === "chart"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-600"
                          }`}
                        >
                          {t("dashboard.graphView")}
                        </button>
                      </div>
                      <label className="text-[11px] text-slate-500">
                        {t("dashboard.trendWindow")}
                        <select
                          className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          value={trendWindowMonths}
                          onChange={(e) => setTrendWindowMonths(Number(e.target.value))}
                        >
                          <option value={3}>{t("dashboard.monthsOption", { count: 3 })}</option>
                          <option value={6}>{t("dashboard.monthsOption", { count: 6 })}</option>
                          <option value={9}>{t("dashboard.monthsOption", { count: 9 })}</option>
                          <option value={12}>{t("dashboard.monthsOption", { count: 12 })}</option>
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        {t("dashboard.teacherFilter")}
                        <select
                          className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          value={trendTeacherId}
                          onChange={(e) => setTrendTeacherId(e.target.value)}
                        >
                          <option value="">{t("dashboard.allTeachers")}</option>
                          {teacherOptions.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        {t("dashboard.subjectsFilter")}
                        <select
                          multiple
                          value={trendSubjects}
                          onChange={(e) =>
                            setTrendSubjects(
                              Array.from(e.target.selectedOptions).map((option) => option.value)
                            )
                          }
                          className="ml-2 h-16 min-w-40 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        >
                          {subjectOptions.map((subject) => (
                            <option key={subject} value={subject}>
                              {subject}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    <span>{t("dashboard.rosterTeacherCount", { count: focusSummary.teacherCount })}</span>
                    <span>•</span>
                    <span>{t("dashboard.observationsAnalyzed", { count: focusSummary.assessmentCount })}</span>
                    <span>•</span>
                    <span>{t("dashboard.departmentsRepresentedCount", { count: focusSummary.deptCount })}</span>
                  </div>
                  {domainTrendViewMode === "chart" ? (
                    <DomainTrendsChart
                      chartData={domainTrendChartData}
                      domains={trendDomains}
                      selectedTeacherId={trendTeacherId}
                      selectedTeacherName={selectedTrendTeacherName}
                      isLoading={domainTrendsLoading}
                    />
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("dashboard.whatInformedThisChart")}
                      </div>
                      {domainTrendEvidenceLines.length ? (
                        <ul className="space-y-2 text-sm text-slate-700">
                          {domainTrendEvidenceLines.map((line, idx) => (
                            <li
                              key={`domain-trend-evidence-${idx}`}
                              className="rounded-md border border-slate-200 bg-white px-3 py-2"
                            >
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-slate-500">
                          {t("dashboard.noTrendDataForFilters")}
                        </div>
                      )}
                    </div>
                  )}
                </section>
                </>
              ) : (
                <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  {t("dashboard.schoolFocusAreasTitle")}
                </h2>
                <p className="mb-2 text-xs text-slate-500">
                  {t("dashboard.schoolFocusAreasDescription")}
                </p>
                <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span>{t("dashboard.rosterTeacherCountShort", { count: focusSummary.teacherCount })}</span>
                  <span>•</span>
                  <span>{t("dashboard.observationsAnalyzed", { count: focusSummary.assessmentCount })}</span>
                  <span>•</span>
                  <span>{t("dashboard.departmentsRepresentedCount", { count: focusSummary.deptCount })}</span>
                </div>
                {focusAreaData.length === 0 ? (
                  <div className="text-xs text-slate-500">{t("dashboard.noFocusAreaData")}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {focusAreaData.map((item) => (
                        <div
                          key={item.elementId}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="text-xs font-semibold text-slate-700">
                            {item.elementName}
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-slate-900">
                            {item.averageScore != null ? item.averageScore.toFixed(1) : "—"}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {t("dashboard.focusAreaStatLine", {
                              teachers: item.teacherCount,
                              observations: item.assessmentCount,
                            })}
                          </div>
                          <div className="mt-2 h-1 w-full rounded-full bg-slate-200">
                            <div
                              className="h-1 rounded-full bg-primary"
                              style={{
                                width: `${Math.min(100, (item.averageScore || 0) * 10)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={focusAreaData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" stroke="#64748b" />
                          <YAxis stroke="#64748b" domain={[0, 10]} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              borderColor: "#e2e8f0",
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="averageScore" fill="#4f46e5" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
                </section>
              )}

            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.departmentalProgressTitle")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("dashboard.departmentalProgressDescription")}
                  </p>
                </div>
                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setDepartmentProgressViewMode("evidence")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                      departmentProgressViewMode === "evidence"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600"
                    }`}
                  >
                    {t("dashboard.evidenceView")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepartmentProgressViewMode("chart")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                      departmentProgressViewMode === "chart"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600"
                    }`}
                  >
                    {t("dashboard.graphView")}
                  </button>
                </div>
              </div>
              <p className="mb-4 text-[11px] text-slate-500">
                {t("dashboard.departmentalProgressRange", {
                  previousStart: dateFormatter.format(previousRange.start),
                  previousEnd: dateFormatter.format(previousRange.end),
                  currentStart: dateFormatter.format(currentRange.start),
                  currentEnd: dateFormatter.format(currentRange.end),
                })}
              </p>
              {departmentData.length === 0 ? (
                <div className="text-xs text-slate-500">
                  {t("dashboard.noDepartmentalData")}
                </div>
              ) : departmentProgressViewMode === "evidence" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("dashboard.whatInformedThisChart")}
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {departmentProgressEvidenceLines.map((line, idx) => (
                      <li
                        key={`department-evidence-${idx}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={departmentData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="department" stroke="#64748b" />
                      <YAxis stroke="#64748b" domain={[0, 10]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          borderColor: "#e2e8f0",
                          fontSize: 12,
                        }}
                      />
                      <Legend />
                      <Bar dataKey="averageScore" name={t("dashboard.currentPeriod")} fill="#22c55e" />
                      <Bar dataKey="previousAverage" name={t("dashboard.previousPeriod")} fill="#94a3b8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <h2 className="mr-auto text-sm font-semibold text-slate-900">
                  {t("dashboard.reportsTitle")}
                </h2>
                <button
                  type="button"
                  onClick={() => downloadReport("pdf", {}, "summary-report.pdf")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboard.summaryPdf")}
                </button>
                <button
                  type="button"
                  onClick={() => downloadReport("csv", {}, "summary-report.csv")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboard.summaryCsv")}
                </button>
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <label className="text-[11px] text-slate-500">{t("dashboard.unitLabel")}</label>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                    value={reportDepartment}
                    onChange={(e) => setReportDepartment(e.target.value)}
                  >
                    <option value="">{t("dashboard.selectDepartment")}</option>
                    {departmentOptions.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!reportDepartment) {
                        toast.error(t("dashboard.selectDepartmentToExport"));
                        return;
                      }
                      downloadReport("pdf", { department: reportDepartment }, "unit-report.pdf");
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!reportDepartment) {
                        toast.error(t("dashboard.selectDepartmentToExport"));
                        return;
                      }
                      downloadReport("csv", { department: reportDepartment }, "unit-report.csv");
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    CSV
                  </button>
                </div>
              </div>
            </section>
            {isAdmin && (
              <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {t("dashboard.recordingComplianceTitle")}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {t("dashboard.recordingComplianceDescription")}
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                    {t("dashboard.behindCount", { count: behindComplianceRows.length })}
                  </span>
                </div>
                {complianceSummaryRows.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {t("dashboard.noComplianceData")}
                  </div>
                ) : behindComplianceRows.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {t("dashboard.noTeachersBehind")}
                  </div>
                ) : (
                  <div className="space-y-2 text-xs text-slate-600">
                    {behindComplianceRows.map((row) => {
                      const missingCount = row.missing_subjects?.length || 0;
                      const isExpanded = expandedComplianceTeacherId === row.teacher_id;
                      return (
                        <div
                          key={row.teacher_id}
                          className="overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedComplianceTeacherId((prev) =>
                                prev === row.teacher_id ? "" : row.teacher_id
                              )
                            }
                            className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-100"
                          >
                            <div>
                              <div className="text-xs font-medium text-slate-800">
                                {row.teacher_name}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {row.subject || t("dashboard.subjectNotSet")}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                                {t("dashboard.subjectsBehind", { count: missingCount })}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {isExpanded ? t("dashboard.hideDetails") : t("dashboard.viewDetails")}
                              </span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                                <span>
                                  {t("dashboard.recordingsCompleted", {
                                    completed: row.recordings_completed,
                                    required: row.recordings_required,
                                  })}
                                </span>
                                {row.period_end && (
                                  <span>
                                    {t("dashboard.periodEnd", {
                                      date: String(row.period_end).slice(0, 10),
                                    })}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {row.missing_subjects.map((subject) => (
                                  <span
                                    key={`${row.teacher_id}-${subject}`}
                                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700"
                                  >
                                    {subject}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendComplianceReminderMutation.mutate(row.teacher_id)
                                  }
                                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-100"
                                >
                                  {t("dashboard.sendReminder")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.focusDomainsTitle")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("dashboard.focusDomainsDescription")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFocusDomains((prev) => !prev)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {showFocusDomains
                      ? t("dashboard.collapse")
                      : t("dashboard.showSelections")}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDomainSelectionMutation.mutate()}
                    disabled={saveDomainSelectionMutation.isPending}
                    className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {saveDomainSelectionMutation.isPending
                      ? t("dashboard.saving")
                      : t("dashboard.saveFocusDomains")}
                  </button>
                </div>
              </div>
              {frameworkLoading ? (
                <div className="text-xs text-slate-500">
                  {t("dashboard.loadingFrameworkDomains")}
                </div>
              ) : showFocusDomains ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {frameworkDomains.map((domain) => {
                    const stats = focusDomainStats.find((d) => d.id === domain.id);
                    const allSelected = stats?.selected === stats?.total && stats?.total > 0;
                    return (
                      <button
                        key={domain.id}
                        type="button"
                        onClick={() => toggleDomainSelection(domain)}
                        className={[
                          "rounded-lg border px-4 py-3 text-left transition-colors",
                          allSelected
                            ? "border-primary/40 bg-primary/5 text-primary"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        <div className="text-sm font-semibold">{domain.name}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {t("dashboard.elementsSelected", {
                            selected: stats?.selected || 0,
                            total: stats?.total || 0,
                          })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  {t("dashboard.focusDomainsCollapsed")}
                </div>
              )}
            </section>

            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.gradebookTitle")}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("dashboard.gradebookDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                    value={gradebookProvider}
                    onChange={(e) => setGradebookProvider(e.target.value)}
                  >
                    <option value="powerschool">PowerSchool</option>
                    <option value="canvas">Canvas</option>
                  </select>
                  <input
                    type="password"
                    placeholder={t("dashboard.gradebookApiKeyOptional")}
                    value={gradebookApiKey}
                    onChange={(e) => setGradebookApiKey(e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      connectGradebookMutation.mutate({
                        provider: gradebookProvider,
                        api_key: gradebookApiKey,
                        status: "connected",
                      })
                    }
                    className="rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  >
                    {t("dashboard.connect")}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                {(gradebookData || []).length === 0 ? (
                  <span className="text-slate-500">
                    {t("dashboard.noGradebookIntegrations")}
                  </span>
                ) : (
                  gradebookData.map((integration) => (
                    <span
                      key={integration.id}
                      className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700"
                    >
                      {integration.provider} • {integration.status === "connected"
                        ? t("dashboard.connected")
                        : integration.status}
                    </span>
                  ))
                )}
              </div>
            </section>
              {!isDashboardV2Enabled && (
                <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  {t("dashboard.keyAchievementsTitle")}
                </h2>
                <p className="mb-3 text-xs text-slate-500">
                  {t("dashboard.keyAchievementsDescription")}
                </p>
                {achievements.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {t("dashboard.noAchievementHighlights")}
                  </div>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
                    {achievements.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </LayoutShell>
  );
}

