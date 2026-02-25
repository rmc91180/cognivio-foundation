import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { scheduleApi, teacherApi } from "@/lib/api";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, DataTable, EmptyState, PageHeader, Panel, TableShell } from "@/components/ui";

export function MasterSchedulePage() {
  const { data: teachersRes } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((r) => r.data),
  });

  const { data: schedulesRes } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => scheduleApi.list().then((r) => r.data),
  });

  const [showPast, setShowPast] = useState(false);

  const teacherById = useMemo(() => {
    const map = {};
    (teachersRes ?? []).forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [teachersRes]);

  const upcoming = useMemo(() => {
    const list = (schedulesRes ?? []).map((s) => ({
      ...s,
      start: new Date(s.start_time),
    }));
    const now = new Date();
    return list
      .filter((s) => (showPast ? true : s.start >= now))
      .sort((a, b) => a.start - b.start);
  }, [schedulesRes, showPast]);

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title="Master recording schedule"
          description="Upcoming class recordings across the school with one-click join."
          actions={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showPast}
                onChange={(e) => setShowPast(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 bg-white text-primary"
              />
              Show past sessions
            </label>
          }
        />

        <Panel className="text-sm">
          {upcoming.length === 0 ? (
            <EmptyState
              title="No scheduled recordings"
              message="No recording sessions are on the calendar yet."
            />
          ) : (
            <TableShell>
              <DataTable>
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Teacher / Course</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Join</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((s) => {
                    const teacher = teacherById[s.teacher_id];
                    const startStr = s.start.toLocaleString();
                    return (
                    <tr
                      key={s.id}
                      className="border-t border-slate-200 hover:bg-slate-50"
                    >
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {startStr}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs font-medium text-slate-900">
                            {teacher?.name || "Unknown teacher"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {s.course_name}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {s.location || "—"}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          <Badge variant="neutral">{s.recording_status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {s.join_url ? (
                            <a
                              href={s.join_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-primary/90"
                            >
                              Join
                            </a>
                          ) : (
                            <span className="text-slate-500">No link</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </TableShell>
          )}
        </Panel>
      </div>
    </LayoutShell>
  );
}

