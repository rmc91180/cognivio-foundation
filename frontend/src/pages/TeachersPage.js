import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, reportApi, scheduleApi, teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ScoreCell } from "@/components/ScoreCell";
import { TrendIndicator } from "@/components/TrendIndicator";

export function TeachersPage() {
  const queryClient = useQueryClient();
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

  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    grade_level: "",
    department: "",
  });

  const createMutation = useMutation({
    mutationFn: teacherApi.create,
    onSuccess: () => {
      toast.success("Teacher created");
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
      setForm({
        name: "",
        email: "",
        subject: "",
        grade_level: "",
        department: "",
      });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Failed to create teacher");
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const [departmentFilter, setDepartmentFilter] = useState("");
  const [performanceLevelFilter, setPerformanceLevelFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [exportTeacherId, setExportTeacherId] = useState("");

  // Load filter preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("teachersPageFilters");
    if (saved) {
      try {
        const { department, performanceLevel, trend, sort } = JSON.parse(saved);
        if (department) setDepartmentFilter(department);
        if (performanceLevel) setPerformanceLevelFilter(performanceLevel);
        if (trend) setTrendFilter(trend);
        if (sort) setSortBy(sort);
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
      })
    );
  }, [departmentFilter, performanceLevelFilter, trendFilter, sortBy]);

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
  const selectedElements = useMemo(
    () => rosterData?.selected_elements ?? [],
    [rosterData]
  );

  const schedulesByTeacher = useMemo(() => {
    const map = {};
    (schedulesData ?? []).forEach((s) => {
      if (!map[s.teacher_id]) map[s.teacher_id] = [];
      map[s.teacher_id].push(s);
    });
    return map;
  }, [schedulesData]);

  const reminderRows = useMemo(() => {
    const reminders = (schedulesData ?? [])
      .filter((s) => s.reminder_type === "lesson_plan")
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
    return reminders.slice(0, 6);
  }, [schedulesData]);

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
        previousScore: prevScore,
        performanceLevel,
        trend,
        elementScores: roster?.element_scores || {},
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
  }, [teachers, rosterByTeacher, departmentFilter, performanceLevelFilter, trendFilter, sortBy]);

  const displayedElements = useMemo(
    () => selectedElements.slice(0, 6),
    [selectedElements]
  );

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
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              Teachers
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage the teachers in your evaluation roster.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddTeacher((prev) => !prev)}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            {showAddTeacher ? "Hide add teacher" : "Add teacher"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          {showAddTeacher && (
            <div className="md:col-span-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">
                  Add teacher
                </h2>
                <form onSubmit={onSubmit} className="space-y-3 text-sm">
                  <Input
                    label="Name"
                    required
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                  <Input
                    label="Email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                  <Input
                    label="Subject"
                    value={form.subject}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, subject: e.target.value }))
                    }
                  />
                  <Input
                    label="Grade level"
                    value={form.grade_level}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, grade_level: e.target.value }))
                    }
                  />
                  <Input
                    label="Department"
                    value={form.department}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, department: e.target.value }))
                    }
                  />
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createMutation.isPending ? "Saving..." : "Save teacher"}
                  </button>
                </form>
              </div>
            </div>
          )}

          <div className={showAddTeacher ? "md:col-span-8" : "md:col-span-12"}>
            {reminderRows.length > 0 && (
              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 text-sm font-semibold text-emerald-900">
                  Upcoming lesson plan reminders
                </div>
                <div className="space-y-2 text-xs text-emerald-800">
                  {reminderRows.map((r) => {
                    const teacher = teachers.find((t) => t.id === r.teacher_id);
                    return (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2"
                      >
                        <div>
                          <div className="font-medium text-emerald-900">
                            {teacher?.name || "Teacher"}
                          </div>
                          <div className="text-[11px] text-emerald-700">
                            {r.course_name}
                          </div>
                        </div>
                        <div className="text-[11px] text-emerald-700">
                          {r.start_time}
                        </div>
                        <Link
                          to={`/teachers/${r.teacher_id}`}
                          className="text-[11px] text-emerald-800 underline underline-offset-4"
                        >
                          View profile
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Roster</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Department</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      {departmentOptions.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Performance</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={performanceLevelFilter}
                      onChange={(e) => setPerformanceLevelFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="distinguished">Distinguished</option>
                      <option value="proficient">Proficient</option>
                      <option value="basic">Basic</option>
                      <option value="unsatisfactory">Unsatisfactory</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Trend</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={trendFilter}
                      onChange={(e) => setTrendFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="improving">Improving</option>
                      <option value="stable">Stable</option>
                      <option value="declining">Declining</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Sort by</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="name">Name</option>
                      <option value="concern">Flag severity</option>
                      <option value="score_high">Highest score</option>
                      <option value="trend">Trend</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">Export teacher</span>
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={exportTeacherId}
                      onChange={(e) => setExportTeacherId(e.target.value)}
                    >
                      <option value="">Select teacher</option>
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
                          toast.error("Select a teacher to export");
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
                          toast.error("Select a teacher to export");
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
                    <span className="text-slate-500">Export unit</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!departmentFilter) {
                          toast.error("Select a department to export");
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
                          toast.error("Select a department to export");
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
                </div>
              </div>

              {isLoading ? (
                <div className="text-xs text-slate-500">Loading teachers...</div>
              ) : tableRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                  No teachers yet. Add your first teacher using the form.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Teacher</th>
                        <th className="px-3 py-2">Dept</th>
                        <th className="px-3 py-2">Flag</th>
                        <th className="px-3 py-2">Trend</th>
                        {displayedElements.map((el) => (
                          <th key={el} className="px-3 py-2 text-center">
                            {el.toUpperCase()}
                          </th>
                        ))}
                        {selectedElements.length > displayedElements.length && (
                          <th className="px-3 py-2 text-center">More</th>
                        )}
                        <th className="px-3 py-2">Courses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(({ teacher, roster, overallScore, previousScore, elementScores }) => {
                        const level =
                          typeof overallScore === "number"
                            ? overallScore
                            : null;
                        const assessmentCount = roster?.assessment_count ?? 0;
                        const elementEntries = Object.entries(elementScores || {});
                        const lowestElement = elementEntries
                          .filter(([, es]) => typeof es.score === "number")
                          .sort((a, b) => a[1].score - b[1].score)[0];
                        const lowElementLabel =
                          lowestElement && typeof lowestElement[1].score === "number" && lowestElement[1].score < 5
                            ? `Low ${lowestElement[0].toUpperCase()} scores`
                            : null;

                        let flagLabel = "Stable";
                        let flagReason = "On track";
                        let flagColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        if (level == null) {
                          flagLabel = "Needs data";
                          flagReason = "No observations yet";
                          flagColor = "bg-slate-50 text-slate-600 border-slate-200";
                        } else if (assessmentCount < 2) {
                          flagLabel = "Needs data";
                          flagReason = "Low observation count";
                          flagColor = "bg-slate-50 text-slate-600 border-slate-200";
                        } else if (level < 5) {
                          flagLabel = "Support";
                          flagReason = lowElementLabel || "Low overall score";
                          flagColor = "bg-rose-50 text-rose-700 border-rose-200";
                        } else if (level < 8) {
                          flagLabel = "Watch";
                          flagReason = lowElementLabel || "Mixed performance";
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
                        const extraColumns =
                          selectedElements.length > displayedElements.length ? 1 : 0;
                        const colSpan = 6 + displayedElements.length + extraColumns;

                        return (
                          <React.Fragment key={teacher.id}>
                            <tr className="border-t border-slate-200 hover:bg-slate-50">
                              <td className="px-3 py-2 align-top">
                                <button
                                  type="button"
                                  onClick={() => toggleRowExpanded(teacher.id)}
                                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title={isExpanded ? "Collapse" : "Expand"}
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
                              <td className="px-3 py-2 align-top">
                                <TrendIndicator
                                  currentScore={overallScore}
                                  previousScore={previousScore}
                                  size="sm"
                                />
                              </td>
                              {displayedElements.map((elementId) => {
                                const es = elementScores?.[elementId] || {};
                                return (
                                  <td key={elementId} className="px-3 py-2 text-center">
                                    <div className="flex justify-center">
                                      <ScoreCell
                                        score={es.score}
                                        elementId={elementId}
                                        evidence={es.observations?.[0]}
                                        videoId={es.video_id}
                                        timestamp={es.timestamp}
                                        confidence={es.confidence}
                                        previousScore={es.previous_score}
                                      />
                                    </div>
                                  </td>
                                );
                              })}
                              {selectedElements.length > displayedElements.length && (
                                <td className="px-3 py-2 text-center text-[11px] text-slate-500">
                                  +{selectedElements.length - displayedElements.length}
                                </td>
                              )}
                              <td className="px-3 py-2 align-top text-[11px] text-slate-600">
                                {courses.length === 0 ? (
                                  <span className="text-slate-500">
                                    No upcoming
                                  </span>
                                ) : (
                                  <details>
                                    <summary className="cursor-pointer text-slate-700">
                                      {courses.length} upcoming
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
                                            {c.start_time}
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
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                    <div>
                                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        Element Breakdown
                                      </h4>
                                      <div className="space-y-1.5">
                                        {Object.entries(elementScores).map(([elementId, es]) => (
                                          <div
                                            key={elementId}
                                            className="flex items-center justify-between rounded bg-white px-2 py-1 text-[11px] border border-slate-200"
                                          >
                                            <span className="text-slate-700">{elementId.toUpperCase()}</span>
                                            <div className="flex items-center gap-2">
                                              <span className="text-slate-600">
                                                {es.score?.toFixed(1) || "—"}/10
                                              </span>
                                              {es.previous_score != null && (
                                                <TrendIndicator
                                                  currentScore={es.score}
                                                  previousScore={es.previous_score}
                                                  size="sm"
                                                />
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        Recent Observations
                                      </h4>
                                      {roster?.recent_observations?.length ? (
                                        <ul className="space-y-1 text-[11px] text-slate-600">
                                          {roster.recent_observations.slice(0, 3).map((obs, i) => (
                                            <li key={i} className="rounded bg-white px-2 py-1 border border-slate-200">
                                              {obs.summary || obs.admin_comment || "Observation recorded"}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="text-[11px] text-slate-500">No recent observations</p>
                                      )}
                                    </div>
                                    <div>
                                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        Quick Actions
                                      </h4>
                                      <div className="flex flex-wrap gap-2">
                                        <Link
                                          to={`/teachers/${teacher.id}`}
                                          className="inline-flex items-center rounded bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20"
                                        >
                                          View Profile
                                        </Link>
                                        <Link
                                          to={`/videos?teacher_id=${teacher.id}`}
                                          className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200"
                                        >
                                          View Videos
                                        </Link>
                                      </div>
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
              )}
            </div>
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

