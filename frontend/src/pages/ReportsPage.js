import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileArchive, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { DataTable, EmptyState, PageHeader, Panel, TableShell } from "@/components/ui";
import { reportApi, teacherApi } from "@/lib/api";

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

export function ReportsPage() {
  const [cycleYear, setCycleYear] = useState(new Date().getFullYear());
  const queryClient = useQueryClient();
  const { data: historyRes } = useQuery({
    queryKey: ["report-history"],
    queryFn: () => reportApi.history().then((res) => res.data),
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const schoolSummaryMutation = useMutation({
    mutationFn: () => reportApi.schoolSummary({ cycle_year: cycleYear }),
    onSuccess: (res) => {
      downloadBlob(res.data, `cognivio-school-summary-${cycleYear}.pdf`);
      queryClient.invalidateQueries({ queryKey: ["report-history"] });
      toast.success("School summary generated");
    },
    onError: () => toast.error("Could not generate school summary"),
  });
  const bulkReportsMutation = useMutation({
    mutationFn: () => reportApi.bulkTeacherReports({ cycle_year: cycleYear }),
    onSuccess: (res) => {
      downloadBlob(res.data, `cognivio-teacher-reports-${cycleYear}.zip`);
      queryClient.invalidateQueries({ queryKey: ["report-history"] });
      toast.success("Teacher report ZIP generated");
    },
    onError: () => toast.error("Could not generate teacher reports"),
  });
  const csvMutation = useMutation({
    mutationFn: (type) => reportApi.csv(type).then((res) => ({ type, blob: res.data })),
    onSuccess: ({ type, blob }) => {
      downloadBlob(blob, `cognivio-${type}.csv`);
      queryClient.invalidateQueries({ queryKey: ["report-history"] });
    },
    onError: () => toast.error("CSV export failed"),
  });

  const history = historyRes?.items || [];

  return (
    <LayoutShell>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <PageHeader
          title="Reports"
          description="Generate PDFs for leadership review and CSV exports for analysis or accreditation files."
        />

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Panel className="space-y-4">
            <label className="block text-xs font-semibold text-slate-600">
              Cycle year
              <input
                type="number"
                min="2020"
                max="2100"
                value={cycleYear}
                onChange={(event) => setCycleYear(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => schoolSummaryMutation.mutate()}
              disabled={schoolSummaryMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              Generate school summary
            </button>
            <button
              type="button"
              onClick={() => bulkReportsMutation.mutate()}
              disabled={bulkReportsMutation.isPending || !teachers.length}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileArchive className="h-4 w-4" />
              Generate all teacher reports
            </button>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Export data</h2>
                <p className="mt-1 text-xs text-slate-500">Download CSVs with the required reporting columns.</p>
              </div>
              <FileSpreadsheet className="h-5 w-5 text-teal-700" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                ["assessments", "All assessments"],
                ["compliance", "Observation compliance"],
                ["coaching", "Coaching tasks"],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => csvMutation.mutate(type)}
                  className="flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <Panel className="mt-5">
          <h2 className="text-sm font-semibold text-slate-900">Report history</h2>
          <div className="mt-4">
            {history.length ? (
              <TableShell>
                <DataTable>
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Report</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Generated</th>
                      <th className="px-3 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id} className="border-t border-slate-200">
                        <td className="px-3 py-2 text-sm font-medium text-slate-900">{item.filename}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{item.report_type}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : "Unknown"}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {item.metadata?.teacher_id || item.metadata?.count ? JSON.stringify(item.metadata) : "Workspace report"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </TableShell>
            ) : (
              <EmptyState title="No reports yet" message="Generated PDFs and CSV exports will appear here." />
            )}
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
