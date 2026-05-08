import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { adminApi, masterAdminApi, teacherApi } from "@/lib/api";

function SectionCard({ section, t }) {
  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">{section.title}</div>
          <div className="mt-1 text-sm text-slate-600">{section.description}</div>
        </div>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
            section.status === "active"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {section.status === "active"
            ? t("masterAdmin.statusActive")
            : t("masterAdmin.statusPlanned")}
        </span>
      </div>
    </Panel>
  );
}

function requestOrgName(user) {
  return user.school_name || user.training_provider_name || user.organization_name || "New organisation";
}

function dayTone(days) {
  if (days > 5) return "bg-rose-100 text-rose-800";
  if (days > 2) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function ApprovalModal({ user, organizations, onClose, onApprove, busy }) {
  const suggested = user?.suggested_organization_id || "";
  const [organizationId, setOrganizationId] = useState(suggested || "__create_new__");
  const [organizationName, setOrganizationName] = useState(requestOrgName(user || {}));
  const [tenantRole, setTenantRole] = useState(user?.tenant_role || user?.role_requested || "teacher");
  const [approvalNote, setApprovalNote] = useState("");

  if (!user) return null;
  const creating = organizationId === "__create_new__";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-semibold text-slate-900">Approve access</div>
        <p className="mt-1 text-sm text-slate-600">
          Assign {user.name || user.email} to the right organisation before they enter Cognivio.
        </p>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Assign to organisation
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="__create_new__">Create new organisation</option>
              {(organizations || []).map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name || org.organization_name}
                  {org.id === suggested ? " (match)" : ""}
                </option>
              ))}
            </select>
          </label>
          {creating ? (
            <label className="block text-sm font-medium text-slate-700">
              New organisation name
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : null}
          <label className="block text-sm font-medium text-slate-700">
            Tenant role
            <select
              value={tenantRole}
              onChange={(event) => setTenantRole(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="teacher">Teacher</option>
              <option value="school_admin">School administrator</option>
              <option value="training_admin">Training administrator</option>
              <option value="super_admin">Master administrator</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Approval note
            <textarea
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional note included in the welcome email"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onApprove({
                id: user.id,
                organization_id: organizationId,
                organization_name: creating ? organizationName : undefined,
                tenant_role: tenantRole,
                approval_note: approvalNote,
              })
            }
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Confirm approval
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ user, onClose, onReject, busy }) {
  const [reason, setReason] = useState("");
  if (!user) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-semibold text-slate-900">Reject request</div>
        <p className="mt-1 text-sm text-slate-600">Add a short reason for {user.email}.</p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject({ id: user.id, reason })}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send rejection
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessManagementSection() {
  const queryClient = useQueryClient();
  const [approvalUser, setApprovalUser] = useState(null);
  const [rejectUser, setRejectUser] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkProgress, setBulkProgress] = useState(null);

  const { data: accessData, isLoading } = useQuery({
    queryKey: ["admin-access-users"],
    queryFn: () => adminApi.accessUsers().then((res) => res.data),
  });
  const { data: orgData } = useQuery({
    queryKey: ["master-admin-organizations"],
    queryFn: () => masterAdminApi.organizations({ limit: 250 }).then((res) => res.data),
  });
  const { data: teacherData } = useQuery({
    queryKey: ["master-admin-teacher-linkage"],
    queryFn: () => teacherApi.list().then((res) => res.data),
  });

  const organizations = orgData?.items || orgData?.organizations || [];
  const users = accessData?.users || accessData?.items || [];
  const pending = users.filter((user) => (user.approval_status || user.status) === "pending");
  const schoolGroups = useMemo(() => {
    const counts = {};
    pending.forEach((user) => {
      const name = requestOrgName(user);
      counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
  }, [pending]);

  const approveMutation = useMutation({
    mutationFn: ({ id, ...payload }) => adminApi.approveAccessUser(id, payload).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-access-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-overview"] });
      toast.success("Access approved and assigned");
    },
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => adminApi.revokeAccessUser(id, { reason }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-access-users"] });
      toast.success("Rejection email sent");
    },
  });
  const linkMutation = useMutation({
    mutationFn: ({ teacherId, organization_id }) => adminApi.linkTeacher(teacherId, { organization_id }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-admin-teacher-linkage"] });
      toast.success("Teacher linked");
    },
  });

  const teachers = teacherData?.teachers || teacherData?.items || teacherData || [];
  const unresolvedTeachers = Array.isArray(teachers)
    ? teachers.filter((teacher) => !teacher.linked_admin_user_id)
    : [];

  async function bulkApprove(schoolName) {
    const selected = pending.filter((user) => selectedIds.includes(user.id) && requestOrgName(user) === schoolName);
    if (!selected.length) return;
    setBulkProgress({ current: 0, total: selected.length });
    for (let index = 0; index < selected.length; index += 1) {
      const user = selected[index];
      await approveMutation.mutateAsync({
        id: user.id,
        organization_id: user.suggested_organization_id || "__create_new__",
        organization_name: requestOrgName(user),
        tenant_role: user.tenant_role || user.role_requested,
      });
      setBulkProgress({ current: index + 1, total: selected.length });
    }
    setSelectedIds([]);
    setBulkProgress(null);
    toast.success(`${selected.length} users approved and assigned to ${schoolName}`);
  }

  return (
    <Panel className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Access management</h2>
        <p className="text-sm text-slate-500">Approve people into the right organisation and resolve teacher-admin linkage.</p>
      </div>
      {isLoading ? <LoadingState message="Loading access requests" /> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {pending.map((user) => {
          const orgName = requestOrgName(user);
          const groupCount = schoolGroups[orgName] || 0;
          const checked = selectedIds.includes(user.id);
          return (
            <div key={user.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{user.name || "Pending user"}</div>
                  <div className="text-sm text-slate-500">{user.email}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${dayTone(user.days_waiting || 0)}`}>
                  {user.days_waiting || 0}d waiting
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge>{user.tenant_role || user.role_requested || "teacher"}</Badge>
                <Badge>{user.institution_type || user.org_type || "k12"}</Badge>
                {user.suggested_organization_id ? <Badge variant="success">Match</Badge> : null}
              </div>
              <div className="mt-3 text-sm text-slate-700">
                <div className="font-medium">{orgName}</div>
                {user.linked_admin_email ? <div className="text-slate-500">Linked admin: {user.linked_admin_email}</div> : null}
              </div>
              {groupCount > 1 ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setSelectedIds((ids) => {
                        const groupIds = pending.filter((item) => requestOrgName(item) === orgName).map((item) => item.id);
                        return event.target.checked
                          ? [...new Set([...ids, ...groupIds])]
                          : ids.filter((id) => !groupIds.includes(id));
                      })
                    }
                  />
                  Select all from {orgName}
                </label>
              ) : null}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setApprovalUser(user)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
                  Approve
                </button>
                <button onClick={() => setRejectUser(user)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  Reject
                </button>
                {groupCount > 1 && selectedIds.includes(user.id) ? (
                  <button onClick={() => bulkApprove(orgName)} className="rounded-lg border border-teal-600 px-3 py-2 text-sm font-semibold text-teal-700">
                    Bulk approve
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {!pending.length && !isLoading ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            No pending access requests.
          </div>
        ) : null}
      </div>
      {bulkProgress ? (
        <div className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          Approving {bulkProgress.current} of {bulkProgress.total} users...
        </div>
      ) : null}
      <div className="border-t border-slate-200 pt-5">
        <h3 className="text-base font-semibold text-slate-900">Unresolved teacher linkage</h3>
        <div className="mt-3 space-y-2">
          {unresolvedTeachers.slice(0, 8).map((teacher) => (
            <div key={teacher.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <span>{teacher.name} <span className="text-slate-500">({teacher.email || "no email"})</span></span>
              <select
                className="rounded-lg border border-slate-300 px-3 py-2"
                defaultValue=""
                onChange={(event) => event.target.value && linkMutation.mutate({ teacherId: teacher.id, organization_id: event.target.value })}
              >
                <option value="">Assign school</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name || org.organization_name}</option>
                ))}
              </select>
            </div>
          ))}
          {!unresolvedTeachers.length ? <div className="text-sm text-slate-500">Every listed teacher has an administrator link.</div> : null}
        </div>
      </div>
      <ApprovalModal
        user={approvalUser}
        organizations={organizations}
        busy={approveMutation.isPending}
        onClose={() => setApprovalUser(null)}
        onApprove={(payload) => approveMutation.mutate(payload, { onSuccess: () => setApprovalUser(null) })}
      />
      <RejectModal
        user={rejectUser}
        busy={rejectMutation.isPending}
        onClose={() => setRejectUser(null)}
        onReject={(payload) => rejectMutation.mutate(payload, { onSuccess: () => setRejectUser(null) })}
      />
    </Panel>
  );
}

export function MasterAdminPage() {
  const { t } = useTranslation();

  const { data: bootstrapData } = useQuery({
    queryKey: ["master-admin-bootstrap"],
    queryFn: () => masterAdminApi.bootstrap().then((res) => res.data),
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-overview"],
    queryFn: () => masterAdminApi.overview().then((res) => res.data),
  });

  return (
    <MasterAdminPageScaffold
      title={t("masterAdmin.title")}
      description={t("masterAdmin.description")}
      meta={t("masterAdmin.meta", { email: bootstrapData?.user?.email || "—" })}
      actions={
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFetching ? t("masterAdmin.refreshing") : t("masterAdmin.refresh")}
        </button>
      }
      railNoteTitle={t("masterAdmin.internalOnlyTitle")}
      railNote={t("masterAdmin.internalOnlyDescription")}
    >

        {isLoading ? <LoadingState message={t("masterAdmin.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdmin.loadFailedTitle")}
            message={t("masterAdmin.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <>
            <MasterAdminMetricGrid>
              {(data?.cards || []).map((card) => (
                <MasterAdminMetricCard
                  key={card.id}
                  label={card.title}
                  value={card.value}
                  hint={card.hint}
                  tone={card.tone === "danger" ? "danger" : card.tone === "warning" ? "warning" : "neutral"}
                />
              ))}
            </MasterAdminMetricGrid>

            <AccessManagementSection />

            <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.alertsTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdmin.alertsDescription")}</p>
                </div>
                <div className="space-y-3">
                  {(data?.alerts || []).map((alert) => (
                    <div
                      key={alert.id}
                      className={[
                        "rounded-2xl border p-4",
                        alert.severity === "danger"
                          ? "border-rose-200 bg-rose-50"
                          : alert.severity === "warning"
                            ? "border-amber-200 bg-amber-50"
                            : "border-emerald-200 bg-emerald-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">{alert.title}</div>
                          <div className="mt-1 text-sm text-slate-600">{alert.message}</div>
                        </div>
                        <Badge
                          variant={
                            alert.severity === "danger"
                              ? "danger"
                              : alert.severity === "warning"
                                ? "warning"
                                : "success"
                          }
                        >
                          {t(`masterAdmin.alertSeverity.${alert.severity}`)}
                        </Badge>
                      </div>
                      {alert.action_path ? (
                        <div className="mt-3">
                          <Link
                            to={alert.action_path}
                            className="text-sm font-medium text-primary hover:text-primary/80"
                          >
                            {alert.action_label || t("masterAdmin.open")}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="space-y-6">
                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.dependenciesTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.dependenciesDescription")}</p>
                  </div>
                  <div className="space-y-2 text-sm text-slate-600">
                    <div>
                      {t("masterAdmin.healthyDependencies")}{" "}
                      <span className="font-semibold text-slate-900">
                        {data?.dependency_summary?.healthy_count ?? 0}
                      </span>
                    </div>
                    <div>
                      {t("masterAdmin.unhealthyDependencies")}{" "}
                      <span className="font-semibold text-slate-900">
                        {(data?.dependency_summary?.unhealthy || []).length}
                      </span>
                    </div>
                    {(data?.dependency_summary?.unhealthy || []).length ? (
                      <div className="rounded-xl bg-white p-3 text-sm text-slate-700">
                        {(data?.dependency_summary?.unhealthy || []).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </Panel>

                <Panel className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.queueTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.queueDescription")}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queueVideo")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.video_queue_depth ?? 0}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queuePrivacy")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.privacy_queue_depth ?? 0}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("masterAdmin.queueTranscode")}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {data?.queue_summary?.transcode_queue_depth ?? 0}
                      </div>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.pendingTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.pendingDescription")}</p>
                  </div>
                  <Link to="/master-admin/users?approval_status=pending" className="text-sm font-medium text-primary">
                    {t("masterAdmin.openUsers")}
                  </Link>
                </div>
                <div className="space-y-3">
                  {(data?.pending_approvals_preview || []).length ? (
                    data.pending_approvals_preview.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.meta}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      {t("masterAdmin.nonePending")}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.pipelineTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("masterAdmin.pipelineDescription")}</p>
                  </div>
                  <Link to="/videos" className="text-sm font-medium text-primary">
                    {t("masterAdmin.openVideos")}
                  </Link>
                </div>
                <div className="space-y-3">
                  {(data?.pipeline_blockers_preview || []).length ? (
                    data.pipeline_blockers_preview.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.meta}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      {t("masterAdmin.noneBlocked")}
                    </div>
                  )}
                </div>
              </Panel>
            </div>

            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.sectionsTitle")}</h2>
                <p className="text-sm text-slate-500">{t("masterAdmin.sectionsDescription")}</p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(bootstrapData?.sections || []).map((section) => (
                  <SectionCard key={section.id} section={section} t={t} />
                ))}
              </div>
            </Panel>
          </>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
