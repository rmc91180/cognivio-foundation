import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assessmentApi,
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
import { subDays, format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { Button, EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { Link } from "react-router-dom";
import { runtimeConfig } from "@/lib/runtimeConfig";

export function DashboardPage() {
  const { t } = useTranslation();
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
      toast.success(res?.data?.message || "Demo data created");
      queryClient.invalidateQueries();
    },
    onError: () => {
      toast.error("Failed to seed demo data");
    },
  });
  const saveDomainSelectionMutation = useMutation({
    mutationFn: () =>
      frameworkApi.saveSelection({
        framework_type: frameworkType,
        selected_elements: selectedElementsState,
      }),
    onSuccess: () => {
      toast.success("Focus domains updated");
      queryClient.invalidateQueries({ queryKey: ["framework-selection"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: () => {
      toast.error("Failed to update focus domains");
    },
  });
  const connectGradebookMutation = useMutation({
    mutationFn: (payload) => gradebookApi.connect(payload),
    onSuccess: () => {
      toast.success("Gradebook integration saved");
      queryClient.invalidateQueries({ queryKey: ["gradebook-integrations"] });
      setGradebookApiKey("");
    },
    onError: () => {
      toast.error("Failed to save integration");
    },
  });

  const sendComplianceReminderMutation = useMutation({
    mutationFn: (teacherId) => recordingComplianceApi.remind(teacherId),
    onSuccess: () => {
      toast.success("Reminder sent");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: () => {
      toast.error("Failed to send reminder");
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
      roster.map((t) => t.department || "Unassigned")
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
            name: teacher.teacher_name || meta.name || "Unknown teacher",
            subject: teacher.subject || meta.subject || "N/A",
            department: teacher.department || meta.department || "Unassigned",
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
    return matched?.name || "Selected teacher";
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
      return `${count} teacher${count === 1 ? "" : "s"} observed demonstrating ${label.toLowerCase()}`;
    });
  }, [focusAreaData]);


  const departmentData = useMemo(() => {
    if (!roster.length && !previousRoster.length) return [];
    const buildBuckets = (rows) => {
      const buckets = {};
      rows.forEach((t) => {
        const dept = t.department || "Unassigned";
        const bucket = buckets[dept] || { department: dept, total: 0, count: 0 };
        if (typeof t.overall_score === "number") {
          bucket.total += t.overall_score;
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
      const key = row.department || "Unassigned";
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
      toast.error("Failed to export report");
    }
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={t("dashboard.title")}
          description={t("dashboard.description")}
          meta={buildStamp ? `Build: ${buildStamp}` : null}
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

        {isLoading ? (
          <LoadingState className="mt-8" message={t("dashboard.loadingRoster")} />
        ) : roster.length === 0 ? (
          <EmptyState
            className="mt-8"
            title={t("dashboard.noTeachersTitle")}
            message={t("dashboard.noTeachersMessage")}
          />
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
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Teachers</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.teacherCount}
                </div>
                <div className="text-[11px] text-slate-500">Active roster count</div>
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
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Observations</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.assessmentCount}
                </div>
                <div className="text-[11px] text-slate-500">In the current reporting window</div>
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
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Departments</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {focusSummary.deptCount}
                </div>
                <div className="text-[11px] text-slate-500">Represented in observed data</div>
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
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Needs support</div>
                <div className="mt-1 text-2xl font-semibold text-rose-700">
                  {prioritySupportCount}
                </div>
                <div className="text-[11px] text-slate-500">Teachers below 6.0 overall</div>
              </button>
            </section>

            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              {selectedKpi === "teachers" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">Teachers in active roster</h2>
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
                  <h2 className="text-sm font-semibold text-slate-900">Observation count by teacher</h2>
                  <div className="mt-3 space-y-2">
                    {observationKpiRows.map((row) => (
                      <div
                        key={`obs-kpi-${row.id}`}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <span className="font-medium text-slate-900">{row.name}</span>
                        <span>{row.assessmentCount} observations</span>
                      </div>
                    ))}
                    {observationKpiRows.length === 0 && (
                      <div className="text-xs text-slate-500">No observation data yet.</div>
                    )}
                  </div>
                </>
              )}
              {selectedKpi === "departments" && (
                <>
                  <h2 className="text-sm font-semibold text-slate-900">Departments represented</h2>
                  <div className="mt-3 space-y-2">
                    {departmentKpiRows.map((row) => (
                      <div
                        key={`dept-kpi-${row.department}`}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <span className="font-medium text-slate-900">{row.department}</span>
                        <span>
                          {row.teacherCount} teachers
                          {typeof row.averageScore === "number"
                            ? ` • Avg ${row.averageScore.toFixed(1)}`
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
                    Teachers below 6.0 overall
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
                        No teachers currently flagged in this range.
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">Quick actions:</span>
                <Link
                  to="/teachers"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Review teacher roster
                </Link>
                <Link
                  to="/videos"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Open recordings library
                </Link>
                <Link
                  to="/school-setup"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  Update school setup
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
                      <h2 className="text-sm font-semibold text-slate-900">Domain trends</h2>
                      <p className="text-xs text-slate-500">
                        Monthly domain trajectory over the last {trendWindowMonths} month
                        {trendWindowMonths === 1 ? "" : "s"} with optional teacher comparison.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[11px] text-slate-500">
                        Window
                        <select
                          className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          value={trendWindowMonths}
                          onChange={(e) => setTrendWindowMonths(Number(e.target.value))}
                        >
                          <option value={3}>3 months</option>
                          <option value={6}>6 months</option>
                          <option value={9}>9 months</option>
                          <option value={12}>12 months</option>
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Teacher
                        <select
                          className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          value={trendTeacherId}
                          onChange={(e) => setTrendTeacherId(e.target.value)}
                        >
                          <option value="">All teachers</option>
                          {teacherOptions.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Subjects
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
                    <span>{focusSummary.teacherCount} teachers included in roster</span>
                    <span>•</span>
                    <span>{focusSummary.assessmentCount} observations analyzed</span>
                    <span>•</span>
                    <span>{focusSummary.deptCount} departments represented</span>
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
                  School focus areas
                </h2>
                <p className="mb-2 text-xs text-slate-500">
                  Aggregate performance on your top three priority rubric elements.
                </p>
                <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  <span>{focusSummary.teacherCount} teachers included</span>
                  <span>•</span>
                  <span>{focusSummary.assessmentCount} observations analyzed</span>
                  <span>•</span>
                  <span>{focusSummary.deptCount} departments represented</span>
                </div>
                {focusAreaData.length === 0 ? (
                  <div className="text-xs text-slate-500">No focus area data yet.</div>
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
                            {item.teacherCount} teachers • {item.assessmentCount} observations
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
                Departmental progress
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                Compare average performance across departments to identify
                pockets of strength and support needs.
              </p>
              <p className="mb-4 text-[11px] text-slate-500">
                Showing {format(previousRange.start, "MMM d")}–{format(previousRange.end, "MMM d")} vs{" "}
                {format(currentRange.start, "MMM d")}–{format(currentRange.end, "MMM d")}.
              </p>
              {departmentData.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No departmental data yet.
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
                      <Bar dataKey="averageScore" name="Current" fill="#22c55e" />
                      <Bar dataKey="previousAverage" name="Month ago" fill="#94a3b8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <h2 className="mr-auto text-sm font-semibold text-slate-900">Reports</h2>
                <button
                  type="button"
                  onClick={() => downloadReport("pdf", {}, "summary-report.pdf")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Summary PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadReport("csv", {}, "summary-report.csv")}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Summary CSV
                </button>
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <label className="text-[11px] text-slate-500">Unit</label>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                    value={reportDepartment}
                    onChange={(e) => setReportDepartment(e.target.value)}
                  >
                    <option value="">Select dept</option>
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
                        toast.error("Select a department to export");
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
                        toast.error("Select a department to export");
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
                      Recording compliance dashboard
                    </h2>
                    <p className="text-xs text-slate-500">
                      Only teachers with at least one subject behind are shown. Click to expand.
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                    {behindComplianceRows.length} behind
                  </span>
                </div>
                {complianceSummaryRows.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    No compliance data yet. Save a policy to begin tracking.
                  </div>
                ) : behindComplianceRows.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    No teachers are currently behind on required subjects.
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
                                {row.subject || "Subject not set"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">
                                {missingCount} subject{missingCount === 1 ? "" : "s"} behind
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {isExpanded ? "Hide details" : "View details"}
                              </span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                                <span>
                                  {row.recordings_completed}/{row.recordings_required} recordings
                                </span>
                                {row.period_end && (
                                  <span>Period end: {String(row.period_end).slice(0, 10)}</span>
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
                                  Send reminder
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
                    Focus domains
                  </h2>
                  <p className="text-xs text-slate-500">
                    Selected domains power roster scoring and dashboard focus
                    areas.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFocusDomains((prev) => !prev)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {showFocusDomains ? "Collapse" : "Show selections"}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDomainSelectionMutation.mutate()}
                    disabled={saveDomainSelectionMutation.isPending}
                    className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {saveDomainSelectionMutation.isPending
                      ? "Saving..."
                      : "Save focus domains"}
                  </button>
                </div>
              </div>
              {frameworkLoading ? (
                <div className="text-xs text-slate-500">
                  Loading framework domains...
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
                          {stats?.selected || 0} of {stats?.total || 0} elements selected
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Focus domain selections are collapsed to save space. Expand to review or edit.
                </div>
              )}
            </section>

            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Gradebook integrations
                  </h2>
                  <p className="text-xs text-slate-500">
                    Connect PowerSchool or Canvas to sync gradebook signals.
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
                    placeholder="API key (optional)"
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
                    Connect
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                {(gradebookData || []).length === 0 ? (
                  <span className="text-slate-500">
                    No gradebook integrations connected yet.
                  </span>
                ) : (
                  gradebookData.map((integration) => (
                    <span
                      key={integration.id}
                      className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700"
                    >
                      {integration.provider} • {integration.status}
                    </span>
                  ))
                )}
              </div>
            </section>
              {!isDashboardV2Enabled && (
                <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  Key achievements
                </h2>
                <p className="mb-3 text-xs text-slate-500">
                  Highlights pulled from recent observations and strongest focus areas.
                </p>
                {achievements.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    No achievement highlights yet.
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

