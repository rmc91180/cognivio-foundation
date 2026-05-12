import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const normalizeCohorts = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.cohorts)) return payload.cohorts;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

export default function CohortManagementPage() {
  const [cohorts, setCohorts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadCohorts = async () => {
      setStatus("loading");
      setError("");

      try {
        const response = await api.get("/cohorts");
        if (!active) return;

        setCohorts(normalizeCohorts(response?.data));
        setStatus("ready");
      } catch (err) {
        if (!active) return;

        setError(
          err?.response?.data?.detail ||
            err?.message ||
            "Cohorts are not available right now."
        );
        setCohorts([]);
        setStatus("error");
      }
    };

    loadCohorts();

    return () => {
      active = false;
    };
  }, []);

  const cohortCount = useMemo(() => cohorts.length, [cohorts]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Cohort Management
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Organize teachers into coaching groups, training cohorts, or observation cycles.
          </p>
          <div className="mt-4 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            {cohortCount} cohort{cohortCount === 1 ? "" : "s"}
          </div>
        </div>

        {status === "loading" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-slate-600">Loading cohorts…</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="font-semibold text-amber-900">
              Cohorts could not be loaded
            </h2>
            <p className="mt-2 text-sm text-amber-800">{error}</p>
          </div>
        )}

        {status === "ready" && cohorts.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              No cohorts yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Cohorts will appear here when they are created for training, observation, or coaching workflows.
            </p>
          </div>
        )}

        {status === "ready" && cohorts.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {cohorts.map((cohort, index) => {
              const id = cohort?.id || cohort?._id || index;
              const title = cohort?.name || cohort?.title || "Untitled Cohort";
              const description =
                cohort?.description ||
                cohort?.summary ||
                "A group of educators organized for shared coaching and growth work.";
              const teacherCount =
                cohort?.teacher_count ??
                cohort?.teacherCount ??
                cohort?.members?.length ??
                0;

              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {description}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-100 px-3 py-2 text-center">
                      <div className="text-lg font-bold text-slate-900">
                        {teacherCount}
                      </div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Teachers
                      </div>
                    </div>
                  </div>

                  {cohort?.status && (
                    <div className="mt-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {cohort.status}
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}