import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentApi, frameworkApi, reportApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
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

export function DashboardPage() {
  const queryClient = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const currentRange = useMemo(
    () => ({ start: subDays(now, 30), end: now }),
    [now]
  );
  const previousRange = useMemo(
    () => ({ start: subDays(now, 60), end: subDays(now, 30) }),
    [now]
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

  const roster = useMemo(() => currentData?.roster ?? [], [currentData]);
  const previousRoster = useMemo(
    () => previousData?.roster ?? [],
    [previousData]
  );
  const selectedElements = useMemo(
    () => currentData?.selected_elements ?? [],
    [currentData]
  );
  const [selectedElementsState, setSelectedElementsState] = useState([]);
  const [showFocusDomains, setShowFocusDomains] = useState(true);
  const [reportDepartment, setReportDepartment] = useState("");

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

  // Use custom focus areas if set, otherwise default to first 3
  const focusElementIds = useMemo(
    () => selectedElementsState.slice(0, 3),
    [selectedElementsState]
  );

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
        .map((t) => t.element_scores?.[id]?.score)
        .filter((s) => typeof s === "number");
      const teachersWithScore = roster.filter(
        (t) => typeof t.element_scores?.[id]?.score === "number"
      );
      const assessmentCount = teachersWithScore.reduce(
        (acc, t) => acc + (t.assessment_count || 0),
        0
      );
      const avg = scores.length
        ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
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

  const departmentOptions = useMemo(() => {
    const set = new Set();
    roster.forEach((t) => {
      if (t.department) set.add(t.department);
    });
    return Array.from(set).sort();
  }, [roster]);

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

  const achievements = useMemo(() => {
    if (!focusAreaData.length) return [];
    const sorted = [...focusAreaData]
      .filter((f) => typeof f.averageScore === "number")
      .sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
    const top = sorted.slice(0, 3);
    return top.map((item) => {
      const count = item.teacherCount;
      const label = item.elementName || item.elementId;
      return `${count} teacher${count === 1 ? "" : "s"} observed demonstrating ${label.toLowerCase()}`;
    });
  }, [focusAreaData]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              Teacher Performance Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Macro-level view of growth across priority focus areas and
              departments.
            </p>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => seedDemoMutation.mutate()}
              disabled={seedDemoMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              {seedDemoMutation.isPending ? "Seeding data..." : "Seed demo data"}
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="mt-8 text-sm text-slate-500">Loading roster...</div>
        ) : roster.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
            No teachers found yet. Start by adding teachers and uploading
            classroom videos.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
            <section className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Reports
                  </h2>
                  <p className="text-xs text-slate-500">
                    Export summary reports and drill back into the platform.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      downloadReport("pdf", {}, "summary-report.pdf")
                    }
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Summary PDF
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadReport("csv", {}, "summary-report.csv")
                    }
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Summary CSV
                  </button>
                  <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                    <label className="text-[11px] text-slate-500">
                      Unit
                    </label>
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
                        downloadReport(
                          "pdf",
                          { department: reportDepartment },
                          "unit-report.pdf"
                        );
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
                        downloadReport(
                          "csv",
                          { department: reportDepartment },
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
            </section>
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
            <section className="md:col-span-7 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                School focus areas
              </h2>
              <p className="mb-2 text-xs text-slate-500">
                Aggregate performance on your top three priority rubric
                elements.
              </p>
              <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span>{focusSummary.teacherCount} teachers included</span>
                <span>•</span>
                <span>{focusSummary.assessmentCount} observations analyzed</span>
                <span>•</span>
                <span>{focusSummary.deptCount} departments represented</span>
              </div>
              {focusAreaData.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No focus area data yet.
                </div>
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

            <section className="md:col-span-5 rounded-xl border border-slate-200 bg-white p-5">
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
                    <BarChart data={departmentData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" stroke="#64748b" domain={[0, 10]} />
                      <YAxis
                        dataKey="department"
                        type="category"
                        stroke="#64748b"
                        width={90}
                      />
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
              {departmentData.length > 0 && (
                <div className="mt-4 space-y-2 text-[11px] text-slate-600">
                  {departmentData.slice(0, 4).map((dept) => (
                    <div key={dept.department} className="flex items-center justify-between">
                      <span>{dept.department}</span>
                      <span>
                        {dept.delta == null ? "—" : `${dept.delta > 0 ? "+" : ""}${dept.delta}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
          </div>
        )}
      </div>
    </LayoutShell>
  );
}

