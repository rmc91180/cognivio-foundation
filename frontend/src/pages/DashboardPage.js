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
import { Button, EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { Link } from "react-router-dom";
import { runtimeConfig } from "@/lib/runtimeConfig";

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
  const [trendWindowMonths, setTrendWindowMonths] = useState(3);
  const [trendTeacherId, setTrendTeacherId] = useState("");
  const [trendSubjects, setTrendSubjects] = useState([]);
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
  const [selectedKpi, setSelectedKpi] = useState("teachers");

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
  const observationKpiRows = useMemo(
    () => teacherKpiRows.filter((row) => row.assessmentCount > 0),
    [teacherKpiRows]
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
  const workspaceTitle = isAdmin
    ? t("dashboard.workspaceTitleAdmin")
    : t("dashboard.workspaceTitleTeacher");
  const workspaceDescription = isAdmin
    ? t("dashboard.workspaceDescriptionAdmin")
    : t("dashboard.workspaceDescriptionTeacher");
  const smartQueueItems = useMemo(() => {
    if (isAdmin) {
      const items = [];
      if (!hasTeachers) {
        items.push({
          id: "seed-demo",
          title: t("dashboard.smartQueueSeedTitle"),
          description: t("dashboard.smartQueueSeedDescription"),
          actionLabel: t("dashboard.seedDemoData"),
          actionType: "seed",
        });
      } else {
        items.push({
          id: "review-roster",
          title: t("dashboard.smartQueueRosterTitle"),
          description: t("dashboard.smartQueueRosterDescription", {
            count: teacherOptions.length,
          }),
          actionLabel: t("dashboard.smartQueueOpenTeachers"),
          to: "/teachers",
        });
      }
      if (!focusAreasConfigured) {
        items.push({
          id: "configure-focus",
          title: t("dashboard.smartQueueFocusTitle"),
          description: t("dashboard.smartQueueFocusDescription"),
          actionLabel: t("dashboard.smartQueueOpenSetup"),
          to: "/school-setup",
        });
      }
      if (teachersMissingPrivacyProfiles > 0) {
        items.push({
          id: "privacy-profiles",
          title: t("dashboard.smartQueuePrivacyTitle"),
          description: t("dashboard.smartQueuePrivacyDescription", {
            count: teachersMissingPrivacyProfiles,
          }),
          actionLabel: t("dashboard.smartQueueOpenTeachers"),
          to: "/teachers",
        });
      }
      if (!hasAnyObservations) {
        items.push({
          id: "capture-evidence",
          title: t("dashboard.smartQueueEvidenceTitle"),
          description: t("dashboard.smartQueueEvidenceDescription"),
          actionLabel: t("dashboard.smartQueueOpenVideos"),
          to: "/videos",
        });
      }
      if (privacyReviewsPending > 0) {
        items.push({
          id: "privacy-review",
          title: t("dashboard.smartQueuePrivacyReviewTitle"),
          description: t("dashboard.smartQueuePrivacyReviewDescription", {
            count: privacyReviewsPending,
          }),
          actionLabel: t("dashboard.openPrivacyReview"),
          to: "/privacy-review",
        });
      }
      if (!items.length) {
        items.push(
          {
            id: "open-videos",
            title: t("dashboard.smartQueueReviewEvidenceTitle"),
            description: t("dashboard.smartQueueReviewEvidenceDescription"),
            actionLabel: t("dashboard.smartQueueOpenVideos"),
            to: "/videos",
          },
          {
            id: "open-teachers",
            title: t("dashboard.smartQueueCoachingTitle"),
            description: t("dashboard.smartQueueCoachingDescription"),
            actionLabel: t("dashboard.smartQueueOpenTeachers"),
            to: "/teachers",
          },
          {
            id: "open-setup",
            title: t("dashboard.smartQueueTuneSetupTitle"),
            description: t("dashboard.smartQueueTuneSetupDescription"),
            actionLabel: t("dashboard.smartQueueOpenSetup"),
            to: "/school-setup",
          }
        );
      }
      return items.slice(0, 3);
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
      },
      {
        id: "teacher-dashboard",
        title: t("dashboard.smartQueueTeacherDashboardTitle"),
        description: t("dashboard.smartQueueTeacherDashboardDescription"),
        actionLabel: t("dashboard.smartQueueRefreshDashboard"),
        to: "/dashboard",
      },
    ];
  }, [
    focusAreasConfigured,
    hasAnyObservations,
    hasTeachers,
    isAdmin,
    privacyReviewsPending,
    t,
    teacherOptions.length,
    teachersMissingPrivacyProfiles,
  ]);
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
          <Panel className="mb-6 border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {workspaceRoleLabel}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {workspaceModeLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {workspaceStatusLabel}
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-slate-900">{workspaceTitle}</h2>
                <p className="mt-1 text-sm text-slate-600">{workspaceDescription}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-right">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.workspaceFocusLabel")}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {focusAreasConfigured
                    ? t("dashboard.workspaceFocusConfigured")
                    : t("dashboard.workspaceFocusNotConfigured")}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.workspaceTeachersLabel")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {teacherOptions.length}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t("dashboard.workspaceTeachersDescription")}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.workspaceEvidenceLabel")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.assessmentCount}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t("dashboard.workspaceEvidenceDescription")}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-4">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.workspaceAttentionLabel")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {teachersMissingPrivacyProfiles + behindComplianceRows.length}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {t("dashboard.workspaceAttentionDescription")}
                </div>
              </div>
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

        {!isLoading && dashboardSmartQueueEnabled && smartQueueItems.length > 0 && (
          <Panel className="mb-6 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("dashboard.smartQueueTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("dashboard.smartQueueDescription")}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {t("dashboard.smartQueueCount", { count: smartQueueItems.length })}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {smartQueueItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                  <div className="mt-4">
                    {item.actionType === "seed" ? (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => seedDemoMutation.mutate()}
                        disabled={seedDemoMutation.isPending}
                      >
                        {seedDemoMutation.isPending
                          ? t("dashboard.seedingData")
                          : item.actionLabel}
                      </Button>
                    ) : (
                      <Link
                        to={item.to}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        {item.actionLabel}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
            <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => setSelectedKpi("teachers")}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                  selectedKpi === "teachers"
                    ? "border-primary/40 ring-2 ring-primary/20"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.kpiTeachersTitle")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.teacherCount}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("dashboard.kpiTeachersDescription")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedKpi("observations")}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                  selectedKpi === "observations"
                    ? "border-primary/40 ring-2 ring-primary/20"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.kpiObservationsTitle")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.assessmentCount}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("dashboard.kpiObservationsDescription")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedKpi("departments")}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                  selectedKpi === "departments"
                    ? "border-primary/40 ring-2 ring-primary/20"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.kpiDepartmentsTitle")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.deptCount}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("dashboard.kpiDepartmentsDescription")}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedKpi("support")}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                  selectedKpi === "support"
                    ? "border-primary/40 ring-2 ring-primary/20"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t("dashboard.kpiSupportTitle")}
                </div>
                <div className="mt-1 text-2xl font-semibold text-rose-700">
                  {prioritySupportCount}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("dashboard.kpiSupportDescription")}
                </div>
              </button>
            </section>

            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              {selectedKpi === "teachers" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.teachersInRoster")}
                  </h2>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {teacherKpiRows.map((row) => (
                      <div
                        key={`teacher-kpi-${row.id}`}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {row.subject} • {row.department}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {selectedKpi === "observations" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.observationCountByTeacher")}
                  </h2>
                  <div className="mt-3 space-y-2">
                    {observationKpiRows.map((row) => (
                      <div
                        key={`obs-kpi-${row.id}`}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <span className="font-medium text-slate-900">{row.name}</span>
                        <span>{t("dashboard.observationsCount", { count: row.assessmentCount })}</span>
                      </div>
                    ))}
                    {observationKpiRows.length === 0 && (
                      <div className="text-xs text-slate-500">
                        {t("dashboard.noObservationData")}
                      </div>
                    )}
                  </div>
                </>
              )}
              {selectedKpi === "departments" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.departmentsRepresented")}
                  </h2>
                  <div className="mt-3 space-y-2">
                    {departmentKpiRows.map((row) => (
                      <div
                        key={`dept-kpi-${row.department}`}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <span className="font-medium text-slate-900">{row.department}</span>
                        <span>
                          {t("dashboard.teachersCount", { count: row.teacherCount })}
                          {typeof row.averageScore === "number"
                            ? ` • ${t("dashboard.averageScoreShort", {
                                score: row.averageScore.toFixed(1),
                              })}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {selectedKpi === "support" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {t("dashboard.kpiSupportDescription")}
                  </h2>
                  <div className="mt-3 space-y-2">
                    {supportKpiRows.map((row) => (
                      <div
                        key={`support-kpi-${row.id}`}
                        className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                      >
                        <span className="font-medium">{row.name}</span>
                        <span>{row.overallScore.toFixed(1)}</span>
                      </div>
                    ))}
                    {supportKpiRows.length === 0 && (
                      <div className="text-xs text-slate-500">
                        {t("dashboard.noTeachersInSupportRange")}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

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
                  <DomainTrendsChart
                    chartData={domainTrendChartData}
                    domains={trendDomains}
                    selectedTeacherId={trendTeacherId}
                    selectedTeacherName={selectedTrendTeacherName}
                    isLoading={domainTrendsLoading}
                  />
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
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t("dashboard.departmentalProgressTitle")}
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                {t("dashboard.departmentalProgressDescription")}
              </p>
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

