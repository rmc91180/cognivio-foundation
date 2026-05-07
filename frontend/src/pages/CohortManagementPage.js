import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Printer, Users } from "lucide-react";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { FrameworkImporter } from "@/components/FrameworkImporter";
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  SectionHeader,
  SkeletonCard,
} from "@/components/ui";
import { cohortApi, teacherApi } from "@/lib/api";

function formatProficiency(value) {
  return typeof value === "number" ? `${value.toFixed(1)} / 4` : "No evidence";
}

function exportCsv(cohort, trainees) {
  const headers = [
    "Trainee",
    "Cohort",
    "Placement school",
    "Competency proficiency",
    "Readiness rating",
    "Observations",
    "Last observation",
    "Next due",
  ];
  const rows = trainees.map((trainee) => [
    trainee.trainee_name,
    cohort?.name || trainee.cohort || "",
    trainee.placement_school || "",
    trainee.competency_progress || "",
    trainee.readiness_rating || "",
    trainee.observation_count || 0,
    trainee.last_observation || "",
    trainee.next_due || "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(cohort?.name || "cohort").replace(/\s+/g, "-").toLowerCase()}-accreditation-summary.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ProgressBar({ value }) {
  const pct = Math.min(100, Math.max(0, ((Number(value) || 0) / 4) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CohortManagementPage() {
  const queryClient = useQueryClient();
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [cohortName, setCohortName] = useState("");

  const { data: cohortsRes, isLoading } = useQuery({
    queryKey: ["cohorts"],
    queryFn: () => cohortApi.list().then((res) => res.data),
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const cohorts = cohortsRes?.cohorts || [];
  const selectedCohort = useMemo(
    () => cohorts.find((cohort) => cohort.id === (selectedCohortId || cohorts[0]?.id)) || cohorts[0],
    [cohorts, selectedCohortId]
  );
  const selectedTrainees = selectedCohort?.trainees || [];
  const teacherOptions = Array.isArray(teachersData) ? teachersData : teachersData?.teachers || [];

  const createCohortMutation = useMutation({
    mutationFn: () =>
      cohortApi.create({
        name: cohortName,
        trainee_ids: teacherOptions.map((teacher) => teacher.id),
      }),
    onSuccess: () => {
      toast.success("Cohort created.");
      setCohortName("");
      queryClient.invalidateQueries({ queryKey: ["cohorts"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not create cohort.");
    },
  });

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <PageHeader
          title="Cohort management"
          description="Manage training cohorts, competency progress, placements, and accreditation-ready exports."
        />

        <FrameworkImporter />

        <div className="grid gap-6 lg:grid-cols-12">
          <Panel className="border border-slate-200 bg-white lg:col-span-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-slate-950">Cohorts</h2>
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? <SkeletonCard height={180} /> : null}
              {!isLoading && cohorts.length ? (
                cohorts.map((cohort) => (
                  <button
                    key={cohort.id}
                    type="button"
                    onClick={() => setSelectedCohortId(cohort.id)}
                    className={[
                      "w-full rounded-lg border px-4 py-4 text-left transition",
                      selectedCohort?.id === cohort.id
                        ? "border-teal-300 bg-teal-50"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <div className="font-semibold text-slate-950">{cohort.name}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {cohort.trainee_count || 0} trainees - Avg {formatProficiency(cohort.avg_progress)}
                    </div>
                    <div className="mt-3">
                      <ProgressBar value={cohort.avg_progress || 0} />
                    </div>
                  </button>
                ))
              ) : null}
              {!isLoading && !cohorts.length ? (
                <EmptyState title="No cohorts yet" description="Create a cohort to group trainees for accreditation reporting." />
              ) : null}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <Field label="New cohort name">
                <Input
                  value={cohortName}
                  onChange={(event) => setCohortName(event.target.value)}
                  placeholder="Fall 2026 Residency"
                />
              </Field>
              <Button
                type="button"
                className="mt-3 gap-2"
                fullWidth
                disabled={!cohortName.trim() || createCohortMutation.isPending}
                onClick={() => createCohortMutation.mutate()}
              >
                <Plus className="h-4 w-4" />
                Create cohort
              </Button>
            </div>
          </Panel>

          <Panel className="border border-slate-200 bg-white lg:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <SectionHeader
                title={selectedCohort?.name || "Cohort trainees"}
                description="Domain progress is shown on the 1-4 training competency scale."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => exportCsv(selectedCohort, selectedTrainees)}
                  disabled={!selectedTrainees.length}
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => window.print()}
                  disabled={!selectedTrainees.length}
                >
                  <Printer className="h-4 w-4" />
                  Print summary
                </Button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              {selectedTrainees.length ? (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Trainee</th>
                      <th className="px-3 py-2">Placement</th>
                      <th className="px-3 py-2">Progress</th>
                      <th className="px-3 py-2">Readiness</th>
                      <th className="px-3 py-2">Domain evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedTrainees.map((trainee) => (
                      <tr key={trainee.trainee_id} className="align-top">
                        <td className="px-3 py-3">
                          <a href={`/teachers/${trainee.trainee_id}`} className="font-semibold text-slate-950 hover:text-primary">
                            {trainee.trainee_name}
                          </a>
                          <div className="mt-1 text-xs text-slate-500">{trainee.email}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{trainee.placement_school || "Unassigned"}</td>
                        <td className="px-3 py-3">
                          <div className="w-36">
                            <ProgressBar value={trainee.competency_progress || 0} />
                            <div className="mt-1 text-xs text-slate-500">{formatProficiency(trainee.competency_progress)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">{trainee.readiness_rating}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-2">
                            {(trainee.domain_progress || []).slice(0, 3).map((domain) => (
                              <div key={domain.domain}>
                                <div className="mb-1 flex justify-between gap-2 text-xs text-slate-500">
                                  <span>{domain.domain}</span>
                                  <span>{formatProficiency(domain.proficiency)}</span>
                                </div>
                                <ProgressBar value={domain.proficiency || 0} />
                              </div>
                            ))}
                            {!(trainee.domain_progress || []).length ? (
                              <span className="text-xs text-slate-500">No competency evidence yet</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="No trainees in this cohort" description="Add trainees to this cohort to build an accreditation export." />
              )}
            </div>
          </Panel>
        </div>

        <Panel className="border border-slate-200 bg-white print:block">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-slate-950">Print-ready trainee summary</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {selectedTrainees.slice(0, 8).map((trainee) => (
              <div key={trainee.trainee_id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="font-semibold text-slate-950">{trainee.trainee_name}</div>
                <div className="mt-1 text-xs text-slate-500">{trainee.placement_school || "Unassigned placement"}</div>
                <div className="mt-3 text-sm text-slate-700">
                  {formatProficiency(trainee.competency_progress)} - {trainee.readiness_rating}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </LayoutShell>
  );
}
