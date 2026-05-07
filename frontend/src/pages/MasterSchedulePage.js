import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, DataTable, EmptyState, PageHeader, Panel, TableShell } from "@/components/ui";
import { scheduleApi, teacherApi } from "@/lib/api";

const TABS = [
  { id: "calendar", label: "Calendar view" },
  { id: "compliance", label: "Compliance view" },
  { id: "bulk", label: "Bulk schedule" },
];

const OBSERVER_COLORS = ["bg-teal-600", "bg-indigo-600", "bg-amber-600", "bg-rose-600", "bg-sky-600"];

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusVariant(status) {
  if (status === "on_track") return "success";
  if (status === "at_risk") return "warning";
  return "danger";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const format = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cognivio//Observation Schedule//EN"];
  events.forEach((event) => {
    if (!event.start) return;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@cognivio`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${format(event.start)}`,
      `DTEND:${format(event.end || event.start)}`,
      `SUMMARY:${event.title || "Cognivio observation"}`,
      `DESCRIPTION:Teacher: ${event.teacher_name || ""}\\nFocus: ${(event.focus_elements || []).join(", ")}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
}

function addInterval(start, frequency, index) {
  const next = new Date(start);
  if (frequency === "weekly") next.setDate(next.getDate() + index * 7);
  else if (frequency === "biweekly") next.setDate(next.getDate() + index * 14);
  else next.setMonth(next.getMonth() + index);
  return next;
}

export function MasterSchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "calendar";
  const [activeTab, setActiveTab] = useState(TABS.some((tab) => tab.id === initialTab) ? initialTab : "calendar");
  const [month, setMonth] = useState(monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState(new Date().toISOString().slice(0, 10));
  const [riskOnly, setRiskOnly] = useState(false);
  const [selectedTeachers, setSelectedTeachers] = useState([]);
  const [bulkForm, setBulkForm] = useState({
    start_date: toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    frequency: "monthly",
    count: 3,
    focus_elements: "1b",
    focus_note: "",
  });
  const queryClient = useQueryClient();

  const monthRange = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }, [month]);

  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });
  const { data: calendarRes } = useQuery({
    queryKey: ["schedule-calendar", monthRange.start.toISOString(), monthRange.end.toISOString()],
    queryFn: () =>
      scheduleApi
        .calendar({ start: monthRange.start.toISOString(), end: monthRange.end.toISOString() })
        .then((res) => res.data),
  });
  const { data: complianceRes } = useQuery({
    queryKey: ["schedule-compliance"],
    queryFn: () => scheduleApi.compliance().then((res) => res.data),
  });
  const { data: conflictsRes } = useQuery({
    queryKey: ["schedule-conflicts", monthRange.start.toISOString(), monthRange.end.toISOString()],
    queryFn: () =>
      scheduleApi
        .conflicts({ start: monthRange.start.toISOString(), end: monthRange.end.toISOString() })
        .then((res) => res.data),
  });

  const bulkMutation = useMutation({
    mutationFn: (payload) => scheduleApi.bulk(payload),
    onSuccess: (res) => {
      toast.success(`${res.data.created} observation sessions scheduled`);
      queryClient.invalidateQueries({ queryKey: ["schedule-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-compliance"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-conflicts"] });
      setActiveTab("calendar");
      setSearchParams({ tab: "calendar" });
    },
    onError: () => toast.error("Bulk scheduling failed"),
  });

  const events = calendarRes?.events || [];
  const eventsByDay = useMemo(() => {
    const grouped = {};
    events.forEach((event) => {
      if (!event.start) return;
      const key = new Date(event.start).toISOString().slice(0, 10);
      grouped[key] = grouped[key] || [];
      grouped[key].push(event);
    });
    return grouped;
  }, [events]);

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = [];
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    while (days.length < 42) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [month]);

  const complianceItems = complianceRes?.items || [];
  const visibleCompliance = riskOnly
    ? complianceItems.filter((item) => item.compliance_status !== "on_track")
    : complianceItems;
  const complianceSummary = complianceRes?.summary || { total: 0, on_track: 0, at_risk: 0, non_compliant: 0 };
  const preview = useMemo(() => {
    const start = new Date(bulkForm.start_date);
    const count = Number(bulkForm.count || 1);
    if (!start || Number.isNaN(start.getTime())) return [];
    return selectedTeachers.flatMap((teacherId) =>
      Array.from({ length: count }, (_, index) => ({
        teacher: teachers.find((teacher) => teacher.id === teacherId),
        date: addInterval(start, bulkForm.frequency, index),
      }))
    );
  }, [bulkForm, selectedTeachers, teachers]);

  const selectTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const submitBulk = () => {
    if (!selectedTeachers.length) {
      toast.error("Select at least one teacher");
      return;
    }
    bulkMutation.mutate({
      teacher_ids: selectedTeachers,
      start_date: new Date(bulkForm.start_date).toISOString(),
      frequency: bulkForm.frequency,
      count: Number(bulkForm.count || 1),
      focus_elements: bulkForm.focus_elements.split(",").map((value) => value.trim()).filter(Boolean),
      focus_note: bulkForm.focus_note,
      recurrence_rule: `FREQ=${bulkForm.frequency === "weekly" ? "WEEKLY" : "MONTHLY"};COUNT=${Number(bulkForm.count || 1)}`,
    });
  };

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl px-6 py-6">
        <PageHeader
          title="Master schedule"
          description="Plan observations, monitor cycle compliance, and export calendar files."
          actions={
            <button
              type="button"
              onClick={() => downloadBlob(buildIcs(events), "cognivio-observations.ics")}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <Download className="h-4 w-4" />
              Export calendar
            </button>
          }
        />

        <div className="mb-5 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1 text-sm">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              className={`rounded-md px-3 py-2 font-medium ${
                activeTab === tab.id ? "bg-teal-50 text-teal-800" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "calendar" ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <Panel>
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  className="rounded-md border border-slate-200 p-2 hover:bg-slate-50"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CalendarDays className="h-4 w-4 text-teal-700" />
                  {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </div>
                <button
                  type="button"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  className="rounded-md border border-slate-200 p-2 hover:bg-slate-50"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="bg-slate-50 px-2 py-2 font-semibold text-slate-500">
                    {day}
                  </div>
                ))}
                {calendarDays.map((day) => {
                  const dayKey = day.toISOString().slice(0, 10);
                  const dayEvents = eventsByDay[dayKey] || [];
                  const isCurrentMonth = day.getMonth() === month.getMonth();
                  const isSelected = selectedDay === dayKey;
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => setSelectedDay(dayKey)}
                      className={`min-h-[104px] bg-white p-2 text-left transition ${
                        isSelected ? "ring-2 ring-inset ring-teal-500" : ""
                      } ${isCurrentMonth ? "" : "opacity-45"}`}
                    >
                      <div className="text-[11px] font-semibold text-slate-600">{day.getDate()}</div>
                      <div className="mt-2 space-y-1">
                        {dayEvents.slice(0, 3).map((event, index) => (
                          <div key={event.id} className="flex items-center gap-1 truncate text-[11px] text-slate-700">
                            <span className={`h-2 w-2 rounded-full ${OBSERVER_COLORS[index % OBSERVER_COLORS.length]}`} />
                            <span className="truncate">{event.teacher_name}</span>
                          </div>
                        ))}
                        {dayEvents.length > 3 ? <div className="text-[10px] text-slate-500">+{dayEvents.length - 3} more</div> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Planned observations</p>
                </div>
                <button
                  type="button"
                  onClick={() => selectTab("bulk")}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {(eventsByDay[selectedDay] || []).length ? (
                  eventsByDay[selectedDay].map((event) => (
                    <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">{event.teacher_name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {(event.focus_elements || []).join(", ")}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No observations" message="Use Add or Bulk schedule to plan this day." />
                )}
              </div>
              {conflictsRes?.count ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {conflictsRes.count} observer conflict{conflictsRes.count === 1 ? "" : "s"} detected this month.
                </div>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {activeTab === "compliance" ? (
          <Panel>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <div className="font-semibold text-slate-900">{complianceSummary.total}</div>
                  <div className="text-slate-500">Teachers</div>
                </div>
                <div className="rounded-md bg-emerald-50 px-3 py-2">
                  <div className="font-semibold text-emerald-700">{complianceSummary.on_track}</div>
                  <div className="text-emerald-700">On track</div>
                </div>
                <div className="rounded-md bg-amber-50 px-3 py-2">
                  <div className="font-semibold text-amber-700">{complianceSummary.at_risk}</div>
                  <div className="text-amber-700">At risk</div>
                </div>
                <div className="rounded-md bg-rose-50 px-3 py-2">
                  <div className="font-semibold text-rose-700">{complianceSummary.non_compliant}</div>
                  <div className="text-rose-700">Late</div>
                </div>
              </div>
              <div className="flex gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} />
                  At-risk only
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const riskyIds = complianceItems
                      .filter((item) => item.compliance_status !== "on_track")
                      .map((item) => item.teacher_id);
                    setSelectedTeachers(riskyIds);
                    selectTab("bulk");
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  <Wand2 className="h-4 w-4" />
                  Schedule all at-risk
                </button>
              </div>
            </div>
            <TableShell>
              <DataTable>
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Teacher</th>
                    <th className="px-3 py-2">Required</th>
                    <th className="px-3 py-2">Completed</th>
                    <th className="px-3 py-2">Planned</th>
                    <th className="px-3 py-2">Remaining</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Next</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCompliance.map((item) => (
                    <tr key={item.teacher_id} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-sm font-medium text-slate-900">{item.teacher_name}</td>
                      <td className="px-3 py-2 text-xs">{item.required_observations}</td>
                      <td className="px-3 py-2 text-xs">{item.completed}</td>
                      <td className="px-3 py-2 text-xs">{item.planned}</td>
                      <td className="px-3 py-2 text-xs">{item.remaining}</td>
                      <td className="px-3 py-2 text-xs">
                        <Badge variant={statusVariant(item.compliance_status)}>{item.compliance_status.replace("_", " ")}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {item.next_observation ? new Date(item.next_observation).toLocaleDateString() : "Not planned"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTeachers([item.teacher_id]);
                            selectTab("bulk");
                          }}
                          className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Schedule
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </TableShell>
          </Panel>
        ) : null}

        {activeTab === "bulk" ? (
          <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
            <Panel className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Bulk schedule</h2>
                <p className="mt-1 text-xs text-slate-500">Choose teachers, cadence, and focus before confirming.</p>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3">
                {teachers.map((teacher) => (
                  <label key={teacher.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedTeachers.includes(teacher.id)}
                      onChange={(event) =>
                        setSelectedTeachers((current) =>
                          event.target.checked
                            ? [...current, teacher.id]
                            : current.filter((id) => id !== teacher.id)
                        )
                      }
                    />
                    {teacher.name}
                  </label>
                ))}
              </div>
              <label className="block text-xs font-semibold text-slate-600">
                First observation
                <input
                  type="datetime-local"
                  value={bulkForm.start_date}
                  onChange={(event) => setBulkForm((current) => ({ ...current, start_date: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600">
                  Frequency
                  <select
                    value={bulkForm.frequency}
                    onChange={(event) => setBulkForm((current) => ({ ...current, frequency: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Sessions
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={bulkForm.count}
                    onChange={(event) => setBulkForm((current) => ({ ...current, count: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold text-slate-600">
                Focus elements
                <input
                  value={bulkForm.focus_elements}
                  onChange={(event) => setBulkForm((current) => ({ ...current, focus_elements: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="1b, 2a"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Notes
                <textarea
                  value={bulkForm.focus_note}
                  onChange={(event) => setBulkForm((current) => ({ ...current, focus_note: event.target.value }))}
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={submitBulk}
                disabled={bulkMutation.isPending || !preview.length}
                className="w-full rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {bulkMutation.isPending ? "Scheduling..." : "Create scheduled sessions"}
              </button>
            </Panel>
            <Panel>
              <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
              <div className="mt-4 space-y-2">
                {preview.length ? (
                  preview.slice(0, 80).map((item, index) => (
                    <div key={`${item.teacher?.id}-${item.date.toISOString()}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">{item.teacher?.name || "Teacher"}</span>
                      <span className="text-xs text-slate-500">{item.date.toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No preview yet" message="Select teachers and cadence to see generated sessions." />
                )}
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}
