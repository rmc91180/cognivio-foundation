import React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import { Button, PageContextHeader, Panel } from "@/components/ui";
import { consentApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { getUserTenantRole } from "@/lib/userRoutes";

const LABELS = {
  video_recording: "Video recording",
  data_processing: "Data processing",
  ai_analysis: "AI analysis",
};

export function TeacherPrivacyPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantRole = getUserTenantRole(user);
  const isAdmin = tenantRole !== "teacher";
  const { data } = useQuery({ queryKey: ["consent-status"], queryFn: () => consentApi.status().then((res) => res.data) });
  const { data: adminRecords } = useQuery({
    queryKey: ["consent-records"],
    enabled: isAdmin,
    queryFn: () => consentApi.records().then((res) => res.data),
  });
  const withdrawMutation = useMutation({
    mutationFn: (consent_type) => consentApi.withdraw({ consent_type, reason: "User requested withdrawal" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consent-status"] });
      toast.success("Consent withdrawn. Anonymization is scheduled within 72 hours.");
    },
  });
  const eraseMutation = useMutation({
    mutationFn: () => consentApi.erase(),
    onSuccess: () => toast.success("Data deletion request completed"),
  });

  async function downloadData() {
    const response = await consentApi.dataExport();
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cognivio-data-export.zip";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <LayoutShell>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PageContextHeader
          title="Privacy"
          description="Manage consent, data export, and deletion rights."
          actions={!isAdmin ? <Link to="/my-profile" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Back to Teacher Profile</Link> : null}
        />
        <div className="grid gap-6 lg:grid-cols-[1fr,0.8fr]">
          <Panel>
            <h2 className="text-lg font-semibold text-slate-950">Current consents</h2>
            <div className="mt-4 space-y-3">
              {Object.entries(LABELS).map(([key, label]) => {
                const record = data?.consents?.[key] || {};
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{label}</div>
                        <div className="text-sm text-slate-500">
                          {record.granted ? `Granted ${record.granted_at || ""}` : record.withdrawn_at ? `Withdrawn ${record.withdrawn_at}` : "Not granted"}
                        </div>
                      </div>
                      <Button variant="secondary" onClick={() => window.confirm("Withdraw consent? This schedules anonymization within 72 hours.") && withdrawMutation.mutate(key)}>
                        Withdraw consent
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={downloadData}>Download my data</Button>
              <Button variant="danger" onClick={() => window.confirm("Request data deletion? Videos and profile images will be removed and records anonymized.") && eraseMutation.mutate()}>
                Request data deletion
              </Button>
            </div>
          </Panel>
          {isAdmin ? (
            <Panel>
              <h2 className="text-lg font-semibold text-slate-950">Compliance overview</h2>
              <div className="mt-4 rounded-lg bg-slate-50 p-4">
                <div className="text-3xl font-semibold text-slate-950">
                  {Math.round((adminRecords?.summary?.completion_rate ?? 0) * 100)}%
                </div>
                <div className="text-sm text-slate-500">
                  {adminRecords?.summary?.consented_count || 0} of {adminRecords?.summary?.teacher_count || 0} teachers consented
                </div>
              </div>
              <div className="mt-4 text-sm text-slate-600">
                Pending consent requests: {adminRecords?.summary?.pending_count || 0}
              </div>
              <div className="mt-4 space-y-2">
                {(adminRecords?.data_subject_requests || []).slice(0, 5).map((request) => (
                  <div key={request.id} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    {request.request_type} · {request.status}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </LayoutShell>
  );
}
