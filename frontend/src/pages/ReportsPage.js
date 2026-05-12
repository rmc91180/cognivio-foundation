import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const normalizeReports = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.reports)) return payload.reports;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const formatDate = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "";
  }
};

const getReportTitle = (report) =>
  report?.title ||
  report?.name ||
  report?.teacher_name ||
  report?.teacherName ||
  "Observation Report";

const getReportSubtitle = (report) =>
  report?.summary ||
  report?.description ||
  report?.framework_type ||
  report?.frameworkType ||
  "Review classroom evidence, feedback, and growth signals.";

const getReportDate = (report) =>
  report?.created_at ||
  report?.createdAt ||
  report?.updated_at ||
  report?.updatedAt ||
  report?.completed_at ||
  report?.completedAt;

export default function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadReports = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/reports");
        if (!active) return;

        setReports(normalizeReports(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Reports are not available right now."
        );
        setReports([]);
        setStatus("error");
      }
    };

    loadReports();

    return () => {
      active = false;
    };
  }, []);

  const reportCount = useMemo(() => reports.length, [reports]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Cognivio
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Reports</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Review observation summaries, feedback cycles, teacher growth trends, and evidence-based coaching outputs.
          </p>
          <div className="mt-4 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            {reportCount} report{reportCount === 1 ? "" : "s"}
          </div>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading reports…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="font-semibold text-amber-900">Reports could not be loaded</h2>
            <p className="mt-2 text-sm text-amber-800">{error}</p>
          </div>
        )}

        {status === "ready" && reports.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">No reports yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Reports will appear here after observations, assessments, or feedback cycles are completed.
            </p>
          </div>
        )}

        {status === "ready" && reports.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {reports.map((report, index) => {
              const id = report?.id || report?._id || index;
              const date = getReportDate(report);
              const score = report?.overall_score ?? report?.overallScore ?? report?.score;

              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {getReportTitle(report)}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {getReportSubtitle(report)}
                      </p>
                    </div>

                    {score !== undefined && score !== null && (
                      <div className="rounded-xl bg-slate-100 px-3 py-2 text-center">
                        <div className="text-lg font-bold text-slate-900">{score}</div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">
                          Score
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    {date && <span>{formatDate(date)}</span>}
                    {report?.status && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                        {report.status}
                      </span>
                    )}
                    {report?.teacher_email && <span>{report.teacher_email}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}