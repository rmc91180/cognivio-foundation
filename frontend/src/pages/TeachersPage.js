import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, reportApi, scheduleApi, schoolApi, teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button, Dialog, EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { getUserTenantRole } from "@/lib/userRoutes";

const DEFAULT_FORM = {
  name: "",
  email: "",
  subject: "",
  grade_level: "",
  department: "",
  school_id: "",
  category: "",
  category_custom: "",
};

export function TeachersPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantRole = getUserTenantRole(user);
  const isSchoolAdmin = tenantRole === "school_admin";
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const isRtl = i18n.dir() === "rtl";
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const teacherCreationModalEnabled = runtimeConfig.teacherCreationModalEnabled;
  const schoolManagementSubflowEnabled = runtimeConfig.schoolManagementSubflowEnabled;
  const teacherRowQuickActionsEnabled = runtimeConfig.teacherRowQuickActionsEnabled;
  const rosterHierarchyCleanupEnabled = runtimeConfig.rosterHierarchyCleanupEnabled;
  const trainingModeFoundationEnabled =
    tenantRole === "training_admin" || user?.workspace_mode === "training";

  const { data: teachersData, isLoading } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });
  const { data: rosterData } = useQuery({
    queryKey: ["roster"],
    queryFn: () => assessmentApi.roster().then((res) => res.data),
  });
  const { data: schedulesData } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => scheduleApi.list().then((res) => res.data),
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: () => schoolApi.list().then((res) => res.data),
  });

  const [form, setForm] = useState(DEFAULT_FORM);
  const [categoryEdits, setCategoryEdits] = useState({});
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [performanceLevelFilter, setPerformanceLevelFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [showExportTools, setShowExportTools] = useState(false);
  const [exportTeacherId, setExportTeacherId] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("teachersPageFilters");
    if (!saved) return;
    try {
      const { department, performanceLevel, trend, sort, category } = JSON.parse(saved);
      if (department) setDepartmentFilter(department);
      if (performanceLevel) setPerformanceLevelFilter(performanceLevel);
      if (trend) setTrendFilter(trend);
      if (sort) setSortBy(sort);
      if (category) setCategoryFilter(category);
    } catch {
      // ignore invalid saved state
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "teachersPageFilters",
      JSON.stringify({
        department: departmentFilter,
        performanceLevel: performanceLevelFilter,
        trend: trendFilter,
        sort: sortBy,
        category: categoryFilter,
      })
    );
  }, [categoryFilter, departmentFilter, performanceLevelFilter, sortBy, trendFilter]);

  const createMutation = useMutation({
    mutationFn: teacherApi.create,
    onSuccess: () => {
      toast.success(t("teachersPage.teacherCreated"));
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      setForm(DEFAULT_FORM);
      setShowAddTeacher(false);
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teachersPage.teacherCreateFailed"));
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, payload }) => teacherApi.update(id, payload),
    onSuccess: () => {
      toast.success(t("teachersPage.categoryUpdated"));
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("teachersPage.categoryUpdateFailed"));
    },
  });

  const teachers = useMemo(() => teachersData ?? [], [teachersData]);
  const rosterByTeacher = useMemo(() => {
    const map = {};
    (rosterData?.roster || []).forEach((row) => {
      map[row.teacher_id] = row;
    });
    return map;
  }, [rosterData]);
  const schedulesByTeacher = useMemo(() => {
    const map = {};
    (schedulesData ?? []).forEach((schedule) => {
      if (!map[schedule.teacher_id]) map[schedule.teacher_id] = [];
      map[schedule.teacher_id].push(schedule);
    });
    return map;
  }, [schedulesData]);

  const categorySelectOptions = [
    { value: "first_year", label: t("teachersPage.firstYear") },
    { value: "second_year", label: t("teachersPage.secondYear") },
    { value: "third_year", label: t("teachersPage.thirdYear") },
    { value: "tenure", label: t("teachersPage.tenure") },
    { value: "dept_head", label: t("teachersPage.deptHead") },
    { value: "custom", label: t("teachersPage.custom") },
  ];

  const categoryOptions = useMemo(() => {
    const defaults = ["first_year", "second_year", "third_year", "tenure", "dept_head"];
    const set = new Set(defaults);
    teachers.forEach((teacher) => {
      if (teacher.category) set.add(teacher.category);
      if (teacher.category_custom) set.add(teacher.category_custom);
    });
    return Array.from(set);
  }, [teachers]);

  const departmentOptions = useMemo(() => {
    const set = new Set();
    teachers.forEach((teacher) => {
      if (teacher.department) set.add(teacher.department);
    });
    return Array.from(set).sort();
  }, [teachers]);

  const tableRows = useMemo(() => {
    let rows = teachers.map((teacher) => {
      const roster = rosterByTeacher[teacher.id];
      const overallScore = roster?.overall_score ?? null;
      let performanceLevel = "unknown";
      if (typeof overallScore === "number") {
        if (overallScore >= 8) performanceLevel = "distinguished";
        else if (overallScore >= 6) performanceLevel = "proficient";
        else if (overallScore >= 4) performanceLevel = "basic";
        else performanceLevel = "unsatisfactory";
      }
      let trend = "stable";
      const prevScore = roster?.previous_overall_score;
      if (typeof overallScore === "number" && typeof prevScore === "number") {
        const change = overallScore - prevScore;
        if (change > 0.5) trend = "improving";
        else if (change < -0.5) trend = "declining";
      }
      return {
        teacher,
        roster,
        overallScore,
        performanceLevel,
        trend,
        categoryLabel:
          teacher.category_custom || (teacher.category ? teacher.category.replace("_", " ") : ""),
      };
    });

    if (departmentFilter) rows = rows.filter((row) => row.teacher.department === departmentFilter);
    if (performanceLevelFilter) rows = rows.filter((row) => row.performanceLevel === performanceLevelFilter);
    if (trendFilter) rows = rows.filter((row) => row.trend === trendFilter);
    if (categoryFilter) {
      rows = rows.filter(
        (row) => row.categoryLabel?.toLowerCase() === categoryFilter.toLowerCase()
      );
    }

    if (sortBy === "name") rows.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));
    else if (sortBy === "concern") rows.sort((a, b) => (a.overallScore ?? 999) - (b.overallScore ?? 999));
    else if (sortBy === "score_high") rows.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
    else if (sortBy === "trend") {
      const trendOrder = { improving: 0, stable: 1, declining: 2 };
      rows.sort((a, b) => (trendOrder[a.trend] ?? 3) - (trendOrder[b.trend] ?? 3));
    }
    return rows;
  }, [
    categoryFilter,
    departmentFilter,
    performanceLevelFilter,
    rosterByTeacher,
    sortBy,
    teachers,
    trendFilter,
  ]);

  const teacherFlowSummary = useMemo(() => {
    const withScores = tableRows.filter((row) => typeof row.overallScore === "number");
    return {
      total: tableRows.length,
      withScores: withScores.length,
      supportCount: withScores.filter((row) => row.overallScore < 6).length,
      improvingCount: tableRows.filter((row) => row.trend === "improving").length,
    };
  }, [tableRows]);

  const primaryRosterStats = useMemo(
    () => [
      { id: "visible", label: t("teachersPage.visibleRoster"), value: teacherFlowSummary.total, tone: "text-slate-900" },
      { id: "support", label: t("teachersPage.needsSupport"), value: teacherFlowSummary.supportCount, tone: "text-rose-700" },
      { id: "improving", label: t("teachersPage.improvingTrend"), value: teacherFlowSummary.improvingCount, tone: "text-emerald-700" },
    ],
    [t, teacherFlowSummary.improvingCount, teacherFlowSummary.supportCount, teacherFlowSummary.total]
  );

  const trendLabelMap = {
    improving: t("teachersPage.improving"),
    stable: t("teachersPage.stable"),
    declining: t("teachersPage.declining"),
  };

  const formatScore = (value) =>
    typeof value === "number"
      ? new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
      : "—";

  const formatScheduleTime = (value) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  };

  const getTeacherQuickLinks = (teacher, roster) => {
    const latestObservation = roster?.recent_observations?.[0] || null;
    const latestVideoId = latestObservation?.video_id || roster?.latest_video_id || null;
    return [
      { id: "deep-dive", label: t("teachersPage.openDeepDive"), to: `/teachers/${teacher.id}`, tone: "primary" },
      { id: "latest-lesson", label: t("teachersPage.openLatestLesson"), to: latestVideoId ? `/videos/${latestVideoId}` : `/videos?teacher_id=${teacher.id}` },
      { id: "coaching-record", label: t("teachersPage.openCoachingRecord"), to: `/teachers/${teacher.id}/action-plan` },
      { id: "schedule", label: t("teachersPage.openSchedule"), to: "/master-schedule" },
    ];
  };

  const toggleRowExpanded = (teacherId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  };

  const onSubmit = (event) => {
    event.preventDefault();
    createMutation.mutate(form);
  };

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
    } catch {
      toast.error(t("teachersPage.reportExportFailed"));
    }
  };

  const pageTitle = trainingModeFoundationEnabled
    ? t("teachersPage.trainingTitle")
    : t("teachersPage.title");
  const pageDescription = trainingModeFoundationEnabled
    ? t("teachersPage.trainingDescription")
    : t("teachersPage.description");
  const addTeacherLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingAddTeacher")
    : t("teachersPage.addTeacher");
  const hideAddTeacherLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingHideAddTeacher")
    : t("teachersPage.hideAddTeacher");
  const addTeacherPanelLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingAddTeacherPanel")
    : t("teachersPage.addTeacherPanel");
  const rosterLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingRoster")
    : t("teachersPage.roster");
  const teacherColumnLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingTeacherLabel")
    : t("teachersPage.teacher");
  const exportUnitLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingExportUnit")
    : t("teachersPage.exportUnit");
  const coursesLabel = trainingModeFoundationEnabled
    ? t("teachersPage.trainingCourses")
    : t("teachersPage.courses");
  const noTeachersTitle = trainingModeFoundationEnabled
    ? t("teachersPage.trainingNoTeachersTitle")
    : t("teachersPage.noTeachersTitle");
  const noTeachersMessage = trainingModeFoundationEnabled
    ? t("teachersPage.trainingNoTeachersMessage")
    : t("teachersPage.noTeachersMessage");

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title={pageTitle}
          description={pageDescription}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {schoolManagementSubflowEnabled && isSchoolAdmin ? (
                <Link
                  to="/school-setup"
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("teachersPage.manageSetup")}
                </Link>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setShowAddTeacher((prev) => !prev)}>
                {showAddTeacher ? hideAddTeacherLabel : addTeacherLabel}
              </Button>
            </div>
          }
        />
        {trainingModeFoundationEnabled ? (
          <div className="mb-4 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
            {t("teachersPage.trainingModeBadge")}
          </div>
        ) : null}

        {teacherCreationModalEnabled ? (
          <Dialog
            open={showAddTeacher}
            onClose={() => setShowAddTeacher(false)}
            title={addTeacherPanelLabel}
            description={t("teachersPage.creationDialogDescription")}
            closeLabel={t("labels.close")}
          >
            <AddTeacherForm
              t={t}
              form={form}
              setForm={setForm}
              schoolsData={schoolsData}
              categorySelectOptions={categorySelectOptions}
              onSubmit={onSubmit}
              isSaving={createMutation.isPending}
            />
            {schoolManagementSubflowEnabled && isSchoolAdmin ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("teachersPage.schoolManagementTitle")}
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {t("teachersPage.schoolManagementDescription")}
                </p>
                <div className="mt-3">
                  <Link
                    to="/school-setup"
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {t("teachersPage.openSchoolSetup")}
                  </Link>
                </div>
              </div>
            ) : null}
          </Dialog>
        ) : null}

        {!teacherCreationModalEnabled && showAddTeacher ? (
          <Panel className="mb-6">
            <AddTeacherForm
              t={t}
              form={form}
              setForm={setForm}
              schoolsData={schoolsData}
              categorySelectOptions={categorySelectOptions}
              onSubmit={onSubmit}
              isSaving={createMutation.isPending}
            />
          </Panel>
        ) : null}

        <Panel>
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{rosterLabel}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {rosterHierarchyCleanupEnabled
                    ? t("teachersPage.rosterDescription")
                    : t("teachersPage.description")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {rosterHierarchyCleanupEnabled ? (
                  <button
                    type="button"
                    onClick={() => setShowExportTools((prev) => !prev)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    {showExportTools
                      ? t("teachersPage.hideExportTools")
                      : t("teachersPage.showExportTools")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setDepartmentFilter("");
                    setPerformanceLevelFilter("");
                    setTrendFilter("");
                    setCategoryFilter("");
                    setSortBy("name");
                  }}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {t("teachersPage.resetFilters")}
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {primaryRosterStats.map((stat) => (
                <div key={stat.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</div>
                  <div className={`mt-2 text-2xl font-semibold ${stat.tone}`}>{stat.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teachersPage.filtersTitle")}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{t("teachersPage.filtersDescription")}</p>
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("teachersPage.scoredCountLine", { count: teacherFlowSummary.withScores })}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <FilterSelect
                  label={t("teachersPage.department")}
                  value={departmentFilter}
                  onChange={setDepartmentFilter}
                  allLabel={t("teachersPage.all")}
                  options={departmentOptions.map((dept) => ({ value: dept, label: dept }))}
                />
                <FilterSelect
                  label={t("teachersPage.category")}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  allLabel={t("teachersPage.all")}
                  options={categoryOptions.map((category) => ({ value: category, label: category.replace(/_/g, " ") }))}
                />
                <FilterSelect
                  label={t("teachersPage.performance")}
                  value={performanceLevelFilter}
                  onChange={setPerformanceLevelFilter}
                  allLabel={t("teachersPage.all")}
                  options={[
                    { value: "distinguished", label: t("teachersPage.distinguished") },
                    { value: "proficient", label: t("teachersPage.proficient") },
                    { value: "basic", label: t("teachersPage.basic") },
                    { value: "unsatisfactory", label: t("teachersPage.unsatisfactory") },
                  ]}
                />
                <FilterSelect
                  label={t("teachersPage.trend")}
                  value={trendFilter}
                  onChange={setTrendFilter}
                  allLabel={t("teachersPage.all")}
                  options={[
                    { value: "improving", label: t("teachersPage.improving") },
                    { value: "stable", label: t("teachersPage.stable") },
                    { value: "declining", label: t("teachersPage.declining") },
                  ]}
                />
                <FilterSelect
                  label={t("teachersPage.sortBy")}
                  value={sortBy}
                  onChange={setSortBy}
                  options={[
                    { value: "name", label: t("teachersPage.nameSort") },
                    { value: "concern", label: t("teachersPage.concern") },
                    { value: "score_high", label: t("teachersPage.highestScore") },
                    { value: "trend", label: t("teachersPage.trend") },
                  ]}
                />
              </div>
            </div>

            {(showExportTools || !rosterHierarchyCleanupEnabled) ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="mb-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("teachersPage.exportToolsTitle")}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{t("teachersPage.exportToolsDescription")}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("teachersPage.exportTeacher")}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="min-w-44 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        value={exportTeacherId}
                        onChange={(e) => setExportTeacherId(e.target.value)}
                      >
                        <option value="">{t("videoRecorderPage.selectTeacher")}</option>
                        {teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!exportTeacherId) {
                            toast.error(t("teachersPage.selectTeacherToExport"));
                            return;
                          }
                          await downloadReport("pdf", { teacher_id: exportTeacherId }, "teacher-report.pdf");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!exportTeacherId) {
                            toast.error(t("teachersPage.selectTeacherToExport"));
                            return;
                          }
                          await downloadReport("csv", { teacher_id: exportTeacherId }, "teacher-report.csv");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        CSV
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {exportUnitLabel}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!departmentFilter) {
                            toast.error(t("teachersPage.selectDepartmentToExport"));
                            return;
                          }
                          await downloadReport("pdf", { department: departmentFilter }, "unit-report.pdf");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!departmentFilter) {
                            toast.error(t("teachersPage.selectDepartmentToExport"));
                            return;
                          }
                          await downloadReport("csv", { department: departmentFilter }, "unit-report.csv");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        CSV
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {isLoading ? (
              <LoadingState message={t("labels.loadingTeachers")} />
            ) : tableRows.length === 0 ? (
              <EmptyState title={noTeachersTitle} message={noTeachersMessage} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {tableRows.map(({ teacher, roster, overallScore, trend }) => (
                    <TeacherMobileCard
                      key={teacher.id}
                      teacher={teacher}
                      roster={roster}
                      overallScore={overallScore}
                      trend={trend}
                      teacherRowQuickActionsEnabled={teacherRowQuickActionsEnabled}
                      getTeacherQuickLinks={getTeacherQuickLinks}
                      formatScore={formatScore}
                      trendLabelMap={trendLabelMap}
                      t={t}
                    />
                  ))}
                </div>

                <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
                  <table className={`min-w-full text-xs ${isRtl ? "text-right" : "text-left"}`}>
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="px-3 py-2">{teacherColumnLabel}</th>
                        <th className="px-3 py-2">{t("teachersPage.dept")}</th>
                        <th className="px-3 py-2">{t("teachersPage.flag")}</th>
                        <th className="px-3 py-2">{t("teachersPage.recentObservations")}</th>
                        <th className="px-3 py-2">{t("teachersPage.trends")}</th>
                        <th className="px-3 py-2">{t("teachersPage.actionItems")}</th>
                        <th className="px-3 py-2">{coursesLabel}</th>
                        {teacherRowQuickActionsEnabled ? (
                          <th className="px-3 py-2">{t("teachersPage.quickActionsTitle")}</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(({ teacher, roster, overallScore }) => {
                        const courses = (schedulesByTeacher[teacher.id] || [])
                          .filter((schedule) => schedule.recording_status !== "completed")
                          .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
                        const isExpanded = expandedRows.has(teacher.id);
                        const colSpan = teacherRowQuickActionsEnabled ? 9 : 8;
                        const level = typeof overallScore === "number" ? overallScore : null;
                        const assessmentCount = roster?.assessment_count ?? 0;
                        let flagLabel = t("teachersPage.flagStable");
                        let flagReason = t("teachersPage.flagOnTrack");
                        let flagColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        const daysSinceInteraction = roster?.days_since_interaction;
                        const noInteraction =
                          typeof daysSinceInteraction === "number" && daysSinceInteraction >= 14;
                        if (level == null) {
                          flagLabel = t("teachersPage.flagNeedsData");
                          flagReason = t("teachersPage.noObservationsYet");
                          flagColor = "bg-slate-50 text-slate-600 border-slate-200";
                        } else if (assessmentCount < 2) {
                          flagLabel = t("teachersPage.flagNeedsData");
                          flagReason = t("teachersPage.lowObservationCount");
                          flagColor = "bg-slate-50 text-slate-600 border-slate-200";
                        } else if (level < 5) {
                          flagLabel = t("teachersPage.flagSupport");
                          flagReason = t("teachersPage.lowOverallScore");
                          flagColor = "bg-rose-50 text-rose-700 border-rose-200";
                        } else if (level < 8) {
                          flagLabel = t("teachersPage.flagWatch");
                          flagReason = t("teachersPage.mixedPerformance");
                          flagColor = "bg-amber-50 text-amber-700 border-amber-200";
                        }
                        if (noInteraction) {
                          flagLabel = t("teachersPage.flagNoTouch");
                          flagReason = t("teachersPage.daysSinceInteraction", { count: daysSinceInteraction });
                          flagColor = "bg-amber-50 text-amber-700 border-amber-200";
                        }
                        const categoryEdit = categoryEdits[teacher.id] || {
                          category: teacher.category_custom ? "custom" : teacher.category || "",
                          category_custom: teacher.category_custom || "",
                        };
                        const isCustomCategory = categoryEdit.category === "custom";

                        return (
                          <React.Fragment key={teacher.id}>
                            <tr className="border-t border-slate-200 hover:bg-slate-50">
                              <td className="px-3 py-2 align-top">
                                <button
                                  type="button"
                                  onClick={() => toggleRowExpanded(teacher.id)}
                                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title={isExpanded ? t("teachersPage.collapse") : t("teachersPage.expand")}
                                >
                                  <svg
                                    className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="mb-0.5 flex items-center gap-1.5">
                                  <Link to={`/teachers/${teacher.id}`} className="text-xs font-medium text-slate-900 hover:underline">
                                    {teacher.name}
                                  </Link>
                                  {teacher.category || teacher.category_custom ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                      {teacher.category_custom || teacher.category?.replace(/_/g, " ")}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[11px] text-slate-500">{teacher.subject} • {teacher.grade_level}</div>
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">{teacher.department || "—"}</td>
                              <td className="px-3 py-2 align-top">
                                <div className={`inline-flex flex-col gap-1 rounded-md border px-2 py-1 ${flagColor}`}>
                                  <span className="text-[10px] font-semibold uppercase tracking-wide">{flagLabel}</span>
                                  <span className="text-[10px] opacity-80">{flagReason}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {roster?.recent_observations?.length ? (
                                  <ul className="space-y-1">
                                    {roster.recent_observations.slice(0, 2).map((obs, idx) => (
                                      <li key={idx} className="rounded bg-slate-50 px-2 py-1">
                                        {obs.summary || obs.admin_comment || t("teachersPage.observationRecorded")}
                                      </li>
                                    ))}
                                    <li>
                                      <Link to={`/teachers/${teacher.id}`} className="text-[10px] text-primary hover:underline">
                                        {t("teachersPage.viewAllObservations")}
                                      </Link>
                                    </li>
                                  </ul>
                                ) : (
                                  <span className="text-[10px] text-slate-400">{t("teachersPage.noRecentObservations")}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {roster?.trend_windows ? (
                                  <div className="flex flex-col gap-1 text-[10px]">
                                    {[
                                      ["30d", t("teachersPage.day30Short")],
                                      ["60d", t("teachersPage.day60Short")],
                                      ["90d", t("teachersPage.day90Short")],
                                    ].map(([key, label]) => {
                                      const trend = roster.trend_windows?.[key] || {};
                                      const delta = trend.delta;
                                      const deltaLabel =
                                        typeof delta === "number"
                                          ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
                                          : "—";
                                      const deltaClass =
                                        typeof delta !== "number"
                                          ? "text-slate-400"
                                          : delta > 0
                                            ? "text-emerald-600"
                                            : delta < 0
                                              ? "text-rose-600"
                                              : "text-slate-500";
                                      return (
                                        <div key={key} className="flex items-center justify-between gap-2">
                                          <span className="text-slate-500">{label}</span>
                                          <span className={deltaClass}>{deltaLabel}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-400">{t("teachersPage.noTrendData")}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {roster?.action_items?.length ? (
                                  <ul className="space-y-1">
                                    {roster.action_items.map((item, idx) => (
                                      <li key={idx} className="rounded bg-slate-50 px-2 py-1">{item.title}</li>
                                    ))}
                                    <li>
                                      <Link to={`/teachers/${teacher.id}/action-plan`} className="text-[10px] text-primary hover:underline">
                                        {t("teachersPage.viewFullActionPlan")}
                                      </Link>
                                    </li>
                                  </ul>
                                ) : (
                                  <span className="text-[10px] text-slate-400">{t("teachersPage.noActionItems")}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {courses.length === 0 ? (
                                  <span className="text-slate-500">{t("teachersPage.noUpcoming")}</span>
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-slate-700">
                                      {t("teachersPage.upcoming", { count: courses.length })}
                                    </summary>
                                    <div className="mt-1 space-y-0.5 text-[11px]">
                                      {courses.map((course) => (
                                        <div key={course.id} className="rounded bg-slate-50 px-2 py-1">
                                          <div className="font-medium text-slate-800">{course.course_name}</div>
                                          <div className="text-[10px] text-slate-500">{formatScheduleTime(course.start_time)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </td>
                              {teacherRowQuickActionsEnabled ? (
                                <td className="px-3 py-2 align-top">
                                  <div className="flex flex-wrap gap-2">
                                    {getTeacherQuickLinks(teacher, roster).map((action) => (
                                      <QuickActionLink key={action.id} to={action.to} tone={action.tone}>
                                        {action.label}
                                      </QuickActionLink>
                                    ))}
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                            {isExpanded ? (
                              <tr className="border-t border-slate-200 bg-slate-50">
                                <td colSpan={colSpan} className="px-6 py-4">
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div>
                                      <div className="mb-3">
                                        <div className="mb-2 flex flex-wrap gap-2">
                                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                            {t("timeScope.fromThisLesson")}
                                          </span>
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                                            {t("timeScope.immediateFollowUp")}
                                          </span>
                                        </div>
                                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                          {t("teachersPage.latestClassSnapshot")}
                                        </h4>
                                      </div>
                                      {roster?.recent_observations?.length ? (
                                        <ul className="space-y-1 text-[11px] text-slate-600">
                                          {roster.recent_observations.slice(0, 3).map((obs, index) => (
                                            <li key={index} className="rounded border border-slate-200 bg-white px-2 py-1">
                                              {obs.summary || obs.admin_comment || t("teachersPage.observationRecorded")}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="text-[11px] text-slate-500">{t("teachersPage.noRecentObservations")}</p>
                                      )}
                                    </div>
                                    <div>
                                      <div className="mb-3">
                                        <div className="mb-2 flex flex-wrap gap-2">
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                            {t("timeScope.ongoingGoal")}
                                          </span>
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                                            {t("timeScope.acrossRecentObservations")}
                                          </span>
                                        </div>
                                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                          {t("teachersPage.recurringPatternSnapshot")}
                                        </h4>
                                      </div>
                                      {roster?.trend_30d?.length ? (
                                        <div className="grid gap-2">
                                          {roster.trend_30d.slice(0, 6).map((trend) => {
                                            const delta = trend.delta;
                                            const deltaLabel =
                                              typeof delta === "number"
                                                ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
                                                : "—";
                                            const deltaClass =
                                              typeof delta !== "number"
                                                ? "text-slate-400"
                                                : delta > 0
                                                  ? "text-emerald-600"
                                                  : delta < 0
                                                    ? "text-rose-600"
                                                    : "text-slate-500";
                                            return (
                                              <div key={trend.element_id} className="rounded-md border border-slate-200 bg-white px-2 py-1">
                                                <div className="flex items-center justify-between text-[11px] text-slate-700">
                                                  <span className="font-medium">{trend.element_id.toUpperCase()}</span>
                                                  <span className={deltaClass}>{deltaLabel}</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500">
                                                  {t("teachersPage.averageShort", {
                                                    score: trend.avg_score,
                                                    count: trend.recent_count,
                                                  })}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[11px] text-slate-500">{t("teachersPage.notEnoughTrendData")}</p>
                                      )}
                                      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        {t("teachersPage.actionItems")}
                                      </h4>
                                      {roster?.action_items?.length ? (
                                        <ul className="space-y-1 text-[11px] text-slate-600">
                                          {roster.action_items.map((item, idx) => (
                                            <li key={idx} className="rounded border border-slate-200 bg-white px-2 py-1">
                                              {item.title}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="text-[11px] text-slate-500">{t("teachersPage.noActionItems")}</p>
                                      )}
                                      {isAdmin ? (
                                        <div className="mt-4">
                                          <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                            {t("teachersPage.categoryTitle")}
                                          </h5>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <select
                                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                                              value={categoryEdit.category}
                                              onChange={(e) => {
                                                const nextCategory = e.target.value;
                                                setCategoryEdits((prev) => ({
                                                  ...prev,
                                                  [teacher.id]: {
                                                    ...categoryEdit,
                                                    category: nextCategory,
                                                    category_custom: nextCategory === "custom" ? categoryEdit.category_custom : "",
                                                  },
                                                }));
                                              }}
                                            >
                                              <option value="">{t("teachersPage.selectCategory")}</option>
                                              {categorySelectOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                  {option.label}
                                                </option>
                                              ))}
                                            </select>
                                            {isCustomCategory ? (
                                              <input
                                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                                                placeholder={t("teachersPage.customCategory")}
                                                value={categoryEdit.category_custom}
                                                onChange={(e) =>
                                                  setCategoryEdits((prev) => ({
                                                    ...prev,
                                                    [teacher.id]: {
                                                      ...categoryEdit,
                                                      category_custom: e.target.value,
                                                    },
                                                  }))
                                                }
                                              />
                                            ) : null}
                                            <button
                                              type="button"
                                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200"
                                              onClick={() => {
                                                if (categoryEdit.category === "custom") {
                                                  const customValue = categoryEdit.category_custom.trim();
                                                  if (!customValue) {
                                                    toast.error(t("teachersPage.enterCustomCategory"));
                                                    return;
                                                  }
                                                  updateCategoryMutation.mutate({
                                                    id: teacher.id,
                                                    payload: { category: null, category_custom: customValue },
                                                  });
                                                  return;
                                                }
                                                updateCategoryMutation.mutate({
                                                  id: teacher.id,
                                                  payload: {
                                                    category: categoryEdit.category || null,
                                                    category_custom: null,
                                                  },
                                                });
                                              }}
                                              disabled={updateCategoryMutation.isPending}
                                            >
                                              {t("teachersPage.save")}
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}

function AddTeacherForm({
  t,
  form,
  setForm,
  schoolsData,
  categorySelectOptions,
  onSubmit,
  isSaving,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 text-sm">
      <Input label={t("teachersPage.name")} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <Input label={t("teachersPage.email")} type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <Input label={t("teachersPage.subject")} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
      <Input label={t("teachersPage.gradeLevel")} value={form.grade_level} onChange={(e) => setForm((f) => ({ ...f, grade_level: e.target.value }))} />
      <Input label={t("teachersPage.department")} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
      <div>
        <label className="block text-xs font-medium text-slate-600">{t("teachersPage.category")}</label>
        <select
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
          value={form.category}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              category: e.target.value,
              category_custom: e.target.value === "custom" ? f.category_custom : "",
            }))
          }
        >
          <option value="">{t("teachersPage.selectCategory")}</option>
          {categorySelectOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {form.category === "custom" ? (
        <Input
          label={t("teachersPage.customCategory")}
          value={form.category_custom}
          onChange={(e) => setForm((f) => ({ ...f, category_custom: e.target.value }))}
        />
      ) : null}
      <div>
        <label className="block text-xs font-medium text-slate-600">{t("teachersPage.school")}</label>
        <select
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
          value={form.school_id}
          onChange={(e) => setForm((f) => ({ ...f, school_id: e.target.value }))}
        >
          <option value="">{t("teachersPage.selectSchool")}</option>
          {(schoolsData || []).map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={isSaving} fullWidth className="mt-2">
        {isSaving ? t("teachersPage.saving") : t("teachersPage.saveTeacher")}
      </Button>
    </form>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      <select
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allLabel ? <option value="">{allLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TeacherMobileCard({
  teacher,
  roster,
  overallScore,
  trend,
  teacherRowQuickActionsEnabled,
  getTeacherQuickLinks,
  formatScore,
  trendLabelMap,
  t,
}) {
  const levelLabel =
    typeof overallScore !== "number"
      ? t("teachersPage.flagNeedsData")
      : overallScore >= 8
        ? t("teachersPage.distinguished")
        : overallScore >= 6
          ? t("teachersPage.proficient")
          : overallScore >= 4
            ? t("teachersPage.basic")
            : t("teachersPage.flagSupport");
  const levelColor =
    levelLabel === t("teachersPage.distinguished")
      ? "text-emerald-700 bg-emerald-100"
      : levelLabel === t("teachersPage.proficient")
        ? "text-blue-700 bg-blue-100"
        : levelLabel === t("teachersPage.basic")
          ? "text-amber-700 bg-amber-100"
          : levelLabel === t("teachersPage.flagSupport")
            ? "text-rose-700 bg-rose-100"
            : "text-slate-700 bg-slate-100";

  const actions = teacherRowQuickActionsEnabled
    ? getTeacherQuickLinks(teacher, roster)
    : [
        { id: "deep-dive", label: t("teachersPage.openDeepDive"), to: `/teachers/${teacher.id}`, tone: "primary" },
        { id: "videos", label: t("teachersPage.viewVideos"), to: `/videos?teacher_id=${teacher.id}` },
      ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link to={`/teachers/${teacher.id}`} className="text-sm font-semibold text-slate-900 hover:underline">
            {teacher.name}
          </Link>
          <div className="text-[11px] text-slate-500">
            {teacher.subject || t("labels.noSubject")} • {teacher.department || t("labels.noDepartment")}
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${levelColor}`}>
          {levelLabel}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span>{t("labels.score")}: {formatScore(overallScore)}</span>
        <span>{t("labels.trend")}: {trendLabelMap[trend] || trend}</span>
        <span>{t("labels.observationsShort")}: {roster?.assessment_count ?? 0}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <QuickActionLink key={action.id} to={action.to} tone={action.tone}>
            {action.label}
          </QuickActionLink>
        ))}
      </div>
    </div>
  );
}

function QuickActionLink({ to, children, tone = "default" }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
        tone === "primary"
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </Link>
  );
}

function Input({ label, ...props }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <input
        {...props}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
      />
    </div>
  );
}
