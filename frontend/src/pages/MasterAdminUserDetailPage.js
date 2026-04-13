import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Badge, Button, Dialog, ErrorState, Field, Input, LoadingState, Panel, Textarea } from "@/components/ui";
import { MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function formatTimestamp(value, locale) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function statusVariant(value) {
  if (value === "approved") return "success";
  if (value === "pending") return "warning";
  if (value === "revoked") return "danger";
  return "neutral";
}

export function MasterAdminUserDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const { userId } = useParams();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [dialogMode, setDialogMode] = useState(null);
  const [reason, setReason] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [approvalOrganizationName, setApprovalOrganizationName] = useState("");
  const [approvalSchoolName, setApprovalSchoolName] = useState("");
  const [approvalManagerEmail, setApprovalManagerEmail] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-user-detail", userId],
    queryFn: () => masterAdminApi.userDetail(userId).then((res) => res.data),
    enabled: Boolean(userId),
  });

  const user = data?.user;
  const isSelf = user?.id && currentUser?.id && user.id === currentUser.id;

  const closeDialog = () => {
    setDialogMode(null);
    setReason("");
    setConfirmationText("");
    setApprovalOrganizationName("");
    setApprovalSchoolName("");
    setApprovalManagerEmail("");
  };

  useEffect(() => {
    if (dialogMode !== "approve" || !user) {
      return;
    }
    setApprovalOrganizationName(
      user.organization_name || user.requested_organization_name || ""
    );
    setApprovalSchoolName(user.school_name || user.requested_school_name || "");
    setApprovalManagerEmail(
      user.manager_email || user.requested_manager_email || ""
    );
  }, [dialogMode, user]);

  const actionMutation = useMutation({
    mutationFn: async ({ mode, payload }) => {
      if (mode === "approve") {
        return masterAdminApi.approveUser(userId, payload);
      }
      if (mode === "revoke") {
        return masterAdminApi.revokeUser(userId, payload);
      }
      if (mode === "reactivate") {
        return masterAdminApi.reactivateUser(userId, payload);
      }
      throw new Error(`Unsupported action: ${mode}`);
    },
    onSuccess: (_, variables) => {
      toast.success(t(`masterAdminUserDetail.${variables.mode}Success`));
      queryClient.invalidateQueries({ queryKey: ["master-admin-user-detail", userId] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-auth-events"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-audit-events"] });
      closeDialog();
    },
    onError: (error, variables) => {
      toast.error(error?.response?.data?.detail || t(`masterAdminUserDetail.${variables.mode}Failed`));
    },
  });

  const dialogConfig = useMemo(() => {
    if (!user || !dialogMode) return null;
    if (dialogMode === "approve") {
      return {
        title: t("masterAdminUserDetail.approveDialogTitle", { email: user.email }),
        description: t("masterAdminUserDetail.approveDialogDescription"),
        confirmLabel: t("masterAdminUserDetail.approve"),
      };
    }
    if (dialogMode === "revoke") {
      return {
        title: t("masterAdminUserDetail.revokeDialogTitle", { email: user.email }),
        description: t("masterAdminUserDetail.revokeDialogDescription", { email: user.email }),
        confirmLabel: t("masterAdminUserDetail.revoke"),
      };
    }
    if (dialogMode === "reactivate") {
      return {
        title: t("masterAdminUserDetail.reactivateDialogTitle", { email: user.email }),
        description: t("masterAdminUserDetail.reactivateDialogDescription"),
        confirmLabel: t("masterAdminUserDetail.reactivate"),
      };
    }
    return null;
  }, [dialogMode, t, user]);

  const submitAction = () => {
    if (!dialogMode) return;
    actionMutation.mutate({
      mode: dialogMode,
      payload: {
        reason: reason.trim() || undefined,
        confirmation_text: confirmationText.trim() || undefined,
        ...(dialogMode === "approve"
          ? {
              organization_name: approvalOrganizationName.trim() || undefined,
              school_name: approvalSchoolName.trim() || undefined,
              manager_email: approvalManagerEmail.trim() || undefined,
            }
          : {}),
      },
    });
  };

  const tenantRole = user?.tenant_role || user?.role;
  const needsSchoolName =
    tenantRole === "teacher" || tenantRole === "school_admin";
  const isTrainingAdmin = tenantRole === "training_admin";

  return (
    <>
      <MasterAdminPageScaffold
        title={t("masterAdminUserDetail.title")}
        description={t("masterAdminUserDetail.description")}
        meta={user ? t("masterAdminUserDetail.meta", { email: user.email }) : null}
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFetching ? t("masterAdminUserDetail.refreshing") : t("masterAdminUserDetail.refresh")}
          </button>
        }
        railNote="This page is for sensitive lifecycle actions. Approvals, revocations, and reactivations should always include enough reason text to survive an audit review."
      >
        <div>
          <Link to="/master-admin/users" className="text-sm font-medium text-primary hover:text-primary/80">
            {t("masterAdminUserDetail.backToUsers")}
          </Link>
        </div>

        {isLoading ? <LoadingState message={t("masterAdminUserDetail.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdminUserDetail.loadFailedTitle")}
            message={t("masterAdminUserDetail.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError && user ? (
          <>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-2xl font-semibold text-slate-900">{user.name || "—"}</div>
                  <div className="mt-1 text-sm text-slate-600">{user.email}</div>
                </div>
              <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(user.approval_status)}>
                    {t(`masterAdminUsers.statusMap.${user.approval_status}`)}
                  </Badge>
                  <Badge variant="neutral">{t(`masterAdminUsers.roleMap.${user.role}`)}</Badge>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{t("masterAdminUserDetail.actionsTitle")}</div>
                    <div className="mt-1 text-sm text-slate-500">{t("masterAdminUserDetail.actionsDescription")}</div>
                  </div>
                  {isSelf ? (
                    <Badge variant="warning">{t("masterAdminUserDetail.selfProtected")}</Badge>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {user.approval_status === "pending" ? (
                    <>
                      <Button type="button" onClick={() => setDialogMode("approve")}>
                        {t("masterAdminUserDetail.approve")}
                      </Button>
                      <Button type="button" variant="danger" onClick={() => setDialogMode("revoke")} disabled={isSelf}>
                        {t("masterAdminUserDetail.deny")}
                      </Button>
                    </>
                  ) : null}
                  {user.approval_status === "approved" ? (
                    <Button type="button" variant="danger" onClick={() => setDialogMode("revoke")} disabled={isSelf}>
                      {t("masterAdminUserDetail.revoke")}
                    </Button>
                  ) : null}
                  {user.approval_status === "revoked" ? (
                    <Button type="button" variant="success" onClick={() => setDialogMode("reactivate")}>
                      {t("masterAdminUserDetail.reactivate")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUserDetail.createdAt")}</div>
                  <div className="mt-1 text-sm text-slate-700">{formatTimestamp(user.created_at, locale)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUserDetail.lastLogin")}</div>
                  <div className="mt-1 text-sm text-slate-700">{formatTimestamp(user.last_login_at, locale)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUserDetail.linkedTeacher")}</div>
                  <div className="mt-1 text-sm text-slate-700">{user.linked_teacher_name || "—"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUserDetail.workspaceMode")}</div>
                  <div className="mt-1 text-sm text-slate-700">{user.workspace_mode || "—"}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.tenantRole")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.tenant_role ? t(`masterAdminUserDetail.tenantRoleMap.${user.tenant_role}`) : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.organization")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.organization_name || user.requested_organization_name || "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.school")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.school_name || user.requested_school_name || "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.linkedAdministrator")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.manager_email || user.requested_manager_email || "—"}
                  </div>
                </div>
              </div>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminUserDetail.activityTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminUserDetail.activityDescription")}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUsers.uploads")}</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{user.uploads_total}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminUsers.assessments")}</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{user.assessments_total}</div>
                  </div>
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminUserDetail.recentVideosTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminUserDetail.recentVideosDescription")}</p>
                </div>
                {(data?.related?.recent_videos || []).length ? (
                  <div className="space-y-3">
                    {data.related.recent_videos.map((video) => (
                      <div key={video.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{video.filename || video.id}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatTimestamp(video.created_at, locale)}
                        </div>
                        <div className="mt-2">
                          <Link to={`/videos/${video.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                            {t("masterAdminUserDetail.openVideo")}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("masterAdminUserDetail.noRecentVideos")}
                  </div>
                )}
              </Panel>
            </div>
          </>
        ) : null}
      </MasterAdminPageScaffold>
      <Dialog
        open={Boolean(dialogConfig)}
        onClose={() => (actionMutation.isPending ? null : closeDialog())}
        title={dialogConfig?.title}
        description={dialogConfig?.description}
        closeLabel={t("labels.close")}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={actionMutation.isPending}>
              {t("masterAdminUserDetail.cancel")}
            </Button>
            <Button type="button" variant={dialogMode === "revoke" ? "danger" : dialogMode === "reactivate" ? "success" : "primary"} onClick={submitAction} disabled={actionMutation.isPending}>
              {actionMutation.isPending ? t("masterAdminUserDetail.saving") : dialogConfig?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialogMode === "approve" ? (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                {t("masterAdminUserDetail.approveAssignmentHint")}
              </div>
              <Field label={isTrainingAdmin ? t("masterAdminUserDetail.trainingOrganizationLabel") : t("masterAdminUserDetail.organizationLabel")}>
                <Input
                  value={approvalOrganizationName}
                  onChange={(event) => setApprovalOrganizationName(event.target.value)}
                  placeholder={t("masterAdminUserDetail.organizationPlaceholder")}
                />
              </Field>
              {needsSchoolName ? (
                <Field label={t("masterAdminUserDetail.schoolLabel")}>
                  <Input
                    value={approvalSchoolName}
                    onChange={(event) => setApprovalSchoolName(event.target.value)}
                    placeholder={t("masterAdminUserDetail.schoolPlaceholder")}
                  />
                </Field>
              ) : null}
              {tenantRole === "teacher" ? (
                <Field label={t("masterAdminUserDetail.managerEmailLabel")}>
                  <Input
                    type="email"
                    value={approvalManagerEmail}
                    onChange={(event) => setApprovalManagerEmail(event.target.value)}
                    placeholder={t("masterAdminUserDetail.managerEmailPlaceholder")}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          <Field label={t("masterAdminUserDetail.reasonLabel")}>
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("masterAdminUserDetail.reasonPlaceholder")}
            />
          </Field>
          {dialogMode === "revoke" ? (
            <Field label={t("masterAdminUserDetail.confirmationLabel", { email: user?.email || "" })}>
              <Input
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder={t("masterAdminUserDetail.confirmationPlaceholder")}
              />
            </Field>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
