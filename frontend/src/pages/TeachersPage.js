import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assessmentApi,
  reportApi,
  scheduleApi,
  teacherApi,
  schoolApi,
} from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button, EmptyState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@/lib/runtimeConfig";

export function TeachersPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const isRtl = i18n.dir() === "rtl";
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const trainingModeFoundationEnabled =
    user?.workspace_mode === "training" || runtimeConfig.trainingModeFoundationEnabled;
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

  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    grade_level: "",
    department: "",
    school_id: "",
    category: "",
    category_custom: "",
  });
  const [newSchoolName, setNewSchoolName] = useState("");
  const [categoryEdits, setCategoryEdits] = useState({});

  const createMutation = useMutation({
    mutationFn: teacherApi.create,
    onSuccess: () => {
      toast.success(t("teachersPage.teacherCreated"));
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
      setForm({
        name: "",
        email: "",
        subject: "",
        grade_level: "",
        department: "",
        school_id: "",
        category: "",
        category_custom: "",
      });
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

  const createSchoolMutation = useMutation({
    mutationFn: schoolApi.create,
    onSuccess: () => {
      toast.success(t("teachersPage.schoolAdded"));
      setNewSchoolName("");
      queryClient.invalidateQueries({ queryKey: ["schools"] });
    },
    onError: () => {
      toast.error(t("teachersPage.schoolAddFailed"));
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const [departmentFilter, setDepartmentFilter] = useState("");
  const [performanceLevelFilter, setPerformanceLevelFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [exportTeacherId, setExportTeacherId] = useState("");

  // Load filter preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("teachersPageFilters");
    if (saved) {
      try {
        const { department, performanceLevel, trend, sort, category } = JSON.parse(saved);
        if (department) setDepartmentFilter(department);
        if (performanceLevel) setPerformanceLevelFilter(performanceLevel);
        if (trend) setTrendFilter(trend);
        if (sort) setSortBy(sort);
        if (category) setCategoryFilter(category);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, []);

  // Save filter preferences to localStorage
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
  }, [departmentFilter, performanceLevelFilter, trendFilter, sortBy, categoryFilter]);

  const toggleRowExpanded = (teacherId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  };

  const teachers = useMemo(() => teachersData ?? [], [teachersData]);
  const rosterByTeacher = useMemo(() => {
    const map = {};
    rosterData?.roster?.forEach((row) => {
      map[row.teacher_id] = row;
    });
    return map;
  }, [rosterData]);
  const schedulesByTeacher = useMemo(() => {
    const map = {};
    (schedulesData ?? []).forEach((s) => {
      if (!map[s.teacher_id]) map[s.teacher_id] = [];
      map[s.teacher_id].push(s);
    });
    return map;
  }, [schedulesData]);

  const categoryOptions = useMemo(() => {
    const defaults = [
      "first_year",
      "second_year",
      "third_year",
      "tenure",
      "dept_head",
    ];
    const set = new Set(defaults);
    teachers.forEach((t) => {
      if (t.category) set.add(t.category);
      if (t.category_custom) set.add(t.category_custom);
    });
    return Array.from(set);
  }, [teachers]);

  const categorySelectOptions = [
    { value: "first_year", label: t("teachersPage.firstYear") },
    { value: "second_year", label: t("teachersPage.secondYear") },
    { value: "third_year", label: t("teachersPage.thirdYear") },
    { value: "tenure", label: t("teachersPage.tenure") },
    { value: "dept_head", label: t("teachersPage.deptHead") },
    { value: "custom", label: t("teachersPage.custom") },
  ];

  const departmentOptions = useMemo(() => {
    const set = new Set();
    teachers.forEach((t) => {
      if (t.department) set.add(t.department);
    });
    return Array.from(set).sort();
  }, [teachers]);

  const tableRows = useMemo(() => {
    let rows = teachers.map((t) => {
      const roster = rosterByTeacher[t.id];
      const overallScore = roster?.overall_score ?? null;

      // Determine performance level
      let performanceLevel = "unknown";
      if (typeof overallScore === "number") {
        if (overallScore >= 8) performanceLevel = "distinguished";
        else if (overallScore >= 6) performanceLevel = "proficient";
        else if (overallScore >= 4) performanceLevel = "basic";
        else performanceLevel = "unsatisfactory";
      }

      // Determine trend (using previous_score if available)
      let trend = "stable";
      const prevScore = roster?.previous_overall_score;
      if (typeof overallScore === "number" && typeof prevScore === "number") {
        const change = overallScore - prevScore;
        if (change > 0.5) trend = "improving";
        else if (change < -0.5) trend = "declining";
      }

      return {
        teacher: t,
        roster,
        overallScore,
        performanceLevel,
        trend,
        categoryLabel:
          t.category_custom ||
          (t.category ? t.category.replace("_", " ") : ""),
      };
    });

    // Apply department filter
    if (departmentFilter) {
      rows = rows.filter((r) => r.teacher.department === departmentFilter);
    }

    // Apply performance level filter
    if (performanceLevelFilter) {
      rows = rows.filter((r) => r.performanceLevel === performanceLevelFilter);
    }

    // Apply trend filter
    if (trendFilter) {
      rows = rows.filter((r) => r.trend === trendFilter);
    }
    if (categoryFilter) {
      rows = rows.filter(
        (r) => r.categoryLabel?.toLowerCase() === categoryFilter.toLowerCase()
      );
    }

    // Apply sorting
    if (sortBy === "name") {
      rows.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));
    } else if (sortBy === "concern") {
      rows.sort((a, b) => {
        const aScore = a.overallScore ?? 999;
        const bScore = b.overallScore ?? 999;
        return aScore - bScore;
      });
    } else if (sortBy === "score_high") {
      rows.sort((a, b) => {
        const aScore = a.overallScore ?? -1;
        const bScore = b.overallScore ?? -1;
        return bScore - aScore;
      });
    } else if (sortBy === "trend") {
      const trendOrder = { improving: 0, stable: 1, declining: 2 };
      rows.sort(
        (a, b) =>
          (trendOrder[a.trend] ?? 3) - (trendOrder[b.trend] ?? 3)
      );
    }

    return rows;
  }, [teachers, rosterByTeacher, departmentFilter, performanceLevelFilter, trendFilter, categoryFilter, sortBy]);
  const teacherFlowSummary = useMemo(() => {
    const withScores = tableRows.filter((row) => typeof row.overallScore === "number");
    const supportCount = withScores.filter((row) => row.overallScore < 6).length;
    const improvingCount = tableRows.filter((row) => row.trend === "improving").length;
    return {
      total: tableRows.length,
      withScores: withScores.length,
      supportCount,
      improvingCount,
    };
  }, [tableRows]);

  const trendLabelMap = {
    improving: t("teachersPage.improving"),
    stable: t("teachersPage.stable"),
    declining: t("teachersPage.declining"),
  };

  const formatScore = (value) =>
    typeof value === "number"
      ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(value)
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAddTeacher((prev) => !prev)}
            >
              {showAddTeacher ? hideAddTeacherLabel : addTeacherLabel}
            </Button>
          }
        />
        {trainingModeFoundationEnabled && (
          <div className="mb-4 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
            {t("teachersPage.trainingModeBadge")}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          {showAddTeacher && (
            <div className="md:col-span-4">
              <Panel>
                <h2 className="mb-3 text-sm font-semibold text-slate-900">
                  {addTeacherPanelLabel}
                </h2>
                <form onSubmit={onSubmit} className="space-y-3 text-sm">
                  <Input
                    label={t("teachersPage.name")}
                    required
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                  <Input
                    label={t("teachersPage.email")}
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                  <Input
                    label={t("teachersPage.subject")}
                    value={form.subject}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, subject: e.target.value }))
                    }
                  />
                  <Input
                    label={t("teachersPage.gradeLevel")}
                    value={form.grade_level}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, grade_level: e.target.value }))
                    }
                  />
                  <Input
                    label={t("teachersPage.department")}
                    value={form.department}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, department: e.target.value }))
                    }
                  />
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      {t("teachersPage.category")}
                    </label>
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
                  {form.category === "custom" && (
                    <Input
                      label={t("teachersPage.customCategory")}
                      value={form.category_custom}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, category_custom: e.target.value }))
                      }
                    />
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      {t("teachersPage.school")}
                    </label>
                    <select
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                      value={form.school_id}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, school_id: e.target.value }))
                      }
                    >
                      <option value="">{t("teachersPage.selectSchool")}</option>
                      {(schoolsData || []).map((school) => (
                        <option key={school.id} value={school.id}>
                          {school.name}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={newSchoolName}
                        onChange={(e) => setNewSchoolName(e.target.value)}
                        placeholder={t("teachersPage.addNewSchool")}
                        className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newSchoolName.trim()) return;
                          createSchoolMutation.mutate({ name: newSchoolName.trim() });
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        {t("teachersPage.add")}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" disabled={createMutation.isPending} fullWidth className="mt-2">
                    {createMutation.isPending ? t("teachersPage.saving") : t("teachersPage.saveTeacher")}
                  </Button>
                </form>
              </Panel>
            </div>
          )}

          <div className={showAddTeacher ? "md:col-span-8" : "md:col-span-12"}>
            <Panel>
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{rosterLabel}</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.department")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                    >
                      <option value="">{t("teachersPage.all")}</option>
                      {departmentOptions.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.category")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="">{t("teachersPage.all")}</option>
                      {categoryOptions.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.performance")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={performanceLevelFilter}
                      onChange={(e) => setPerformanceLevelFilter(e.target.value)}
                    >
                      <option value="">{t("teachersPage.all")}</option>
                      <option value="distinguished">{t("teachersPage.distinguished")}</option>
                      <option value="proficient">{t("teachersPage.proficient")}</option>
                      <option value="basic">{t("teachersPage.basic")}</option>
                      <option value="unsatisfactory">{t("teachersPage.unsatisfactory")}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.trend")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={trendFilter}
                      onChange={(e) => setTrendFilter(e.target.value)}
                    >
                      <option value="">{t("teachersPage.all")}</option>
                      <option value="improving">{t("teachersPage.improving")}</option>
                      <option value="stable">{t("teachersPage.stable")}</option>
                      <option value="declining">{t("teachersPage.declining")}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.sortBy")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="name">{t("teachersPage.nameSort")}</option>
                      <option value="concern">{t("teachersPage.concern")}</option>
                      <option value="score_high">{t("teachersPage.highestScore")}</option>
                      <option value="trend">{t("teachersPage.trend")}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{t("teachersPage.exportTeacher")}</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={exportTeacherId}
                      onChange={(e) => setExportTeacherId(e.target.value)}
                    >
                      <option value="">{t("videoRecorderPage.selectTeacher")}</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
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
                        await downloadReport(
                          "pdf",
                          { teacher_id: exportTeacherId },
                          "teacher-report.pdf"
                        );
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
                        await downloadReport(
                          "csv",
                          { teacher_id: exportTeacherId },
                          "teacher-report.csv"
                        );
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      CSV
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">{exportUnitLabel}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!departmentFilter) {
                          toast.error(t("teachersPage.selectDepartmentToExport"));
                          return;
                        }
                        await downloadReport(
                          "pdf",
                          { department: departmentFilter },
                          "unit-report.pdf"
                        );
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
                        await downloadReport(
                          "csv",
                          { department: departmentFilter },
                          "unit-report.csv"
                        );
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      CSV
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDepartmentFilter("");
                      setPerformanceLevelFilter("");
                      setTrendFilter("");
                      setCategoryFilter("");
                      setSortBy("name");
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                  >
                    {t("teachersPage.resetFilters")}
                  </button>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{t("teachersPage.visibleRoster")}</div>
                  <div className="text-lg font-semibold text-slate-900">{teacherFlowSummary.total}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{t("teachersPage.scored")}</div>
                  <div className="text-lg font-semibold text-slate-900">{teacherFlowSummary.withScores}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{t("teachersPage.needsSupport")}</div>
                  <div className="text-lg font-semibold text-rose-700">{teacherFlowSummary.supportCount}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{t("teachersPage.improvingTrend")}</div>
                  <div className="text-lg font-semibold text-emerald-700">{teacherFlowSummary.improvingCount}</div>
                </div>
              </div>

              {isLoading ? (
                <LoadingState message={t("labels.loadingTeachers")} />
              ) : tableRows.length === 0 ? (
                <EmptyState
                  title={noTeachersTitle}
                  message={noTeachersMessage}
                />
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {tableRows.map(({ teacher, overallScore, trend, roster }) => {
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
                      return (
                        <div
                          key={`mobile-${teacher.id}`}
                          className="rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <Link
                                to={`/teachers/${teacher.id}`}
                                className="text-sm font-semibold text-slate-900 hover:underline"
                              >
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
                            <span>
                              {t("labels.score")}: {formatScore(overallScore)}
                            </span>
                            <span>{t("labels.trend")}: {trendLabelMap[trend] || trend}</span>
                            <span>{t("labels.observationsShort")}: {roster?.assessment_count ?? 0}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Link
                              to={`/teachers/${teacher.id}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                            >
                              {t("teachersPage.viewProfile")}
                            </Link>
                            <Link
                              to={`/videos?teacher_id=${teacher.id}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                            >
                              {t("teachersPage.viewVideos")}
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
                  <table className={`min-w-full text-xs ${isRtl ? "text-right" : "text-left"}`}>
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">{teacherColumnLabel}</th>
                        <th className="px-3 py-2">{t("teachersPage.dept")}</th>
                        <th className="px-3 py-2">{t("teachersPage.flag")}</th>
                        <th className="px-3 py-2">{t("teachersPage.recentObservations")}</th>
                        <th className="px-3 py-2">{t("teachersPage.trends")}</th>
                        <th className="px-3 py-2">{t("teachersPage.actionItems")}</th>
                        <th className="px-3 py-2">{coursesLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(({ teacher, roster, overallScore }) => {
                        const level =
                          typeof overallScore === "number"
                            ? overallScore
                            : null;
                        const assessmentCount = roster?.assessment_count ?? 0;
                        let flagLabel = t("teachersPage.flagStable");
                        let flagReason = t("teachersPage.flagOnTrack");
                        let flagColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        const daysSinceInteraction = roster?.days_since_interaction;
                        const noInteraction =
                          typeof daysSinceInteraction === "number" &&
                          daysSinceInteraction >= 14;
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
      const courses = (schedulesByTeacher[teacher.id] || [])
        .filter((s) => s.recording_status !== "completed")
        .sort((a, b) =>
          (a.start_time || "").localeCompare(
            b.start_time || ""
          )
        );
      const isExpanded = expandedRows.has(teacher.id);
                        const colSpan = 8;
      const categoryEdit = categoryEdits[teacher.id] || {
        category: teacher.category_custom ? "custom" : (teacher.category || ""),
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
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 5l7 7-7 7"
                                    />
                                  </svg>
                                </button>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="mb-0.5 flex items-center gap-1.5">
                                  <Link
                                    to={`/teachers/${teacher.id}`}
                                    className="text-xs font-medium text-slate-900 hover:underline"
                                  >
                                    {teacher.name}
                                  </Link>
                                  {teacher.category || teacher.category_custom ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                      {teacher.category_custom ||
                                        teacher.category?.replace(/_/g, " ")}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {teacher.subject} • {teacher.grade_level}
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {teacher.department || "—"}
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className={`inline-flex flex-col gap-1 rounded-md border px-2 py-1 ${flagColor}`}>
                                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                                    {flagLabel}
                                  </span>
                                  <span className="text-[10px] opacity-80">
                                    {flagReason}
                                  </span>
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
                                      <Link
                                        to={`/teachers/${teacher.id}`}
                                        className="text-[10px] text-primary hover:underline"
                                      >
                                        {t("teachersPage.viewAllObservations")}
                                      </Link>
                                    </li>
                                  </ul>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    {t("teachersPage.noRecentObservations")}
                                  </span>
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
                                      <li key={idx} className="rounded bg-slate-50 px-2 py-1">
                                        {item.title}
                                      </li>
                                    ))}
                                    <li>
                                      <Link
                                        to={`/teachers/${teacher.id}`}
                                        className="text-[10px] text-primary hover:underline"
                                      >
                                        {t("teachersPage.viewFullActionPlan")}
                                      </Link>
                                    </li>
                                  </ul>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    {t("teachersPage.noActionItems")}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {courses.length === 0 ? (
                                  <span className="text-slate-500">
                                    {t("teachersPage.noUpcoming")}
                                  </span>
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-slate-700">
                                      {t("teachersPage.upcoming", { count: courses.length })}
                                    </summary>
                                    <div className="mt-1 space-y-0.5 text-[11px]">
                                      {courses.map((c) => (
                                        <div
                                          key={c.id}
                                          className="rounded bg-slate-50 px-2 py-1"
                                        >
                                          <div className="font-medium text-slate-800">
                                            {c.course_name}
                                          </div>
                                          <div className="text-[10px] text-slate-500">
                                            {formatScheduleTime(c.start_time)}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="border-t border-slate-200 bg-slate-50">
                                <td colSpan={colSpan} className="px-6 py-4">
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div>
                                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        {t("teachersPage.trendSnapshot")}
                                      </h4>
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
                                              <div
                                                key={trend.element_id}
                                                className="rounded-md border border-slate-200 bg-white px-2 py-1"
                                              >
                                                <div className="flex items-center justify-between text-[11px] text-slate-700">
                                                  <span className="font-medium">
                                                    {trend.element_id.toUpperCase()}
                                                  </span>
                                                  <span className={deltaClass}>
                                                    {deltaLabel}
                                                  </span>
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
                                        <p className="text-[11px] text-slate-500">
                                          {t("teachersPage.notEnoughTrendData")}
                                        </p>
                                      )}
                                      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        {t("teachersPage.recentObservationsTitle")}
                                      </h4>
                                      {roster?.recent_observations?.length ? (
                                        <ul className="space-y-1 text-[11px] text-slate-600">
                                          {roster.recent_observations.slice(0, 3).map((obs, i) => (
                                            <li key={i} className="rounded bg-white px-2 py-1 border border-slate-200">
                                              {obs.summary || obs.admin_comment || t("teachersPage.observationRecorded")}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="text-[11px] text-slate-500">{t("teachersPage.noRecentObservations")}</p>
                                      )}
                                    </div>
                                    <div>
                                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        {t("teachersPage.quickActionsTitle")}
                                      </h4>
                                      <div className="flex flex-wrap gap-2">
                                        <Link
                                          to={`/teachers/${teacher.id}`}
                                          className="inline-flex items-center rounded bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20"
                                        >
                                          {t("teachersPage.viewProfile")}
                                        </Link>
                                        <Link
                                          to={`/videos?teacher_id=${teacher.id}`}
                                          className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200"
                                        >
                                          {t("teachersPage.viewVideos")}
                                        </Link>
                                      </div>
                                      {isAdmin && (
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
                                                    category_custom:
                                                      nextCategory === "custom"
                                                        ? categoryEdit.category_custom
                                                        : "",
                                                  },
                                                }));
                                              }}
                                            >
                                              <option value="">{t("teachersPage.selectCategory")}</option>
                                              {categorySelectOptions.map((opt) => (
                                                <option key={opt.value} value={opt.value}>
                                                  {opt.label}
                                                </option>
                                              ))}
                                            </select>
                                            {isCustomCategory && (
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
                                            )}
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
                                                    payload: {
                                                      category: null,
                                                      category_custom: customValue,
                                                    },
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
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

function Input({ label, ...props }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        {...props}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-primary/40 focus:ring"
      />
    </div>
  );
}

