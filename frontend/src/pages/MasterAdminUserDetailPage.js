import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
  Textarea,
} from "@/components/ui";
import { InstitutionSuggestionList } from "@/components/ui/InstitutionSuggestionList";
import { MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { authApi, masterAdminApi } from "@/lib/api";
import { setPreviewSession } from "@/lib/previewMode";
import { getDefaultHomeRoute } from "@/lib/userRoutes";

function formatTimestamp(value, locale) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function statusVariant(value) {
  if (value === "approved") return "success";
  if (value === "pending") return "warning";
  if (value === "revoked") return "danger";
  if (value === "frozen") return "warning";
  if (value === "suspended") return "warning";
  return "neutral";
}

function getUserLifecycleStatus(user) {
  if (!user) return "unknown";
  if (user.is_active === false && user.approval_status === "approved") return "frozen";
  return user.approval_status || "unknown";
}

export function MasterAdminUserDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser, refreshUser } = useAuth();
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
  const lifecycleStatus = getUserLifecycleStatus(user);
  const isSelf = Boolean(user?.id && currentUser?.id && user.id === currentUser.id);
  const tenantRole = user?.tenant_role || user?.role;
  const approvalInstitutionType =
    user?.organization_type || (tenantRole === "training_admin" ? "training" : "school");

  const canPreviewUser =
    Boolean(user?.id) &&
    user?.approval_status === "approved" &&
    user?.is_active !== false &&
    !isSelf &&
    tenantRole !== "super_admin";

  const canApprove = user?.approval_status === "pending";
  const canDelete = Boolean(user?.id && !isSelf);
  const canFreeze =
    Boolean(user?.id && !isSelf) &&
    user?.approval_status === "approved" &&
    user?.is_active !== false;
  const canReactivate =
    Boolean(user?.id && !isSelf) &&
    (user?.approval_status === "revoked" || user?.is_active === false);

  const needsConfirmation = dialogMode === "delete";
  const confirmationMatches =
    !needsConfirmation ||
    confirmationText.trim().toLowerCase() === String(user?.email || "").trim().toLowerCase();

  const needsReason = ["approve", "delete", "freeze", "reactivate"].includes(dialogMode || "");
  const canSubmitDialog =
    Boolean(dialogMode) &&
    !actionIsBlocked(dialogMode, reason, confirmationMatches);

  function actionIsBlocked(mode, currentReason, currentConfirmationMatches) {
    if (!mode) return true;
    if (["delete", "freeze", "reactivate"].includes(mode) && !currentReason.trim()) return true;
    if (mode === "delete" && !currentConfirmationMatches) return true;
    return false;
  }

  const { data: institutionLookupRes } = useQuery({
    queryKey: [
      "master-admin-institution-lookup",
      approvalInstitutionType,
      approvalOrganizationName,
    ],
    queryFn: () =>
      authApi
        .institutionLookup({
          organization_type: approvalInstitutionType,
          q: approvalOrganizationName.trim(),
          limit: 6,
        })
        .then((res) => res.data),
    enabled: dialogMode === "approve" && approvalOrganizationName.trim().length >= 2,
  });

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
    setApprovalManagerEmail(user.manager_email || user.requested_manager_email || "");
  }, [dialogMode, user]);

  const startPreview = async () => {
    if (!user?.id) return;

    setPreviewSession({
      userId: user.id,
      name: user.name,
      email: user.email,
      tenantRole: user.tenant_role || user.role,
    });

    queryClient.clear();

    try {
      const previewUser = await refreshUser();
      navigate(getDefaultHomeRoute(previewUser || user));
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          t("masterAdminUserDetail.previewFailed", "Could not preview this account.")
      );
    }
  };

  const applyInstitutionSuggestion = (suggestion) => {
    setApprovalOrganizationName(suggestion.organization_name || "");
    if (suggestion.school_name) {
      setApprovalSchoolName(suggestion.school_name);
    }
    if (suggestion.manager_email) {
      setApprovalManagerEmail(suggestion.manager_email);
    }
  };

  const actionMutation = useMutation({
    mutationFn: async ({ mode, payload }) => {
      if (mode === "approve") {
        return masterAdminApi.approveUser(userId, payload);
      }

      if (mode === "delete") {
        return masterAdminApi.deleteUser(userId, payload);
      }

      if (mode === "freeze") {
        return masterAdminApi.freezeUser(userId, payload);
      }

      if (mode === "reactivate") {
        return masterAdminApi.reactivateUser(userId, payload);
      }

      throw new Error(`Unsupported action: ${mode}`);
    },
    onSuccess: (response, variables) => {
      const payload = response?.data || {};
      const emailStatus = payload.email_status || payload.email || {};
      if (payload.ok === true && emailStatus?.warning) {
        toast.warning(payload.message || emailStatus.warning);
      } else {
        toast.success(
          payload.message || t(`masterAdminUserDetail.${variables.mode}Success`, "Account updated.")
        );
      }

      queryClient.invalidateQueries({ queryKey: ["master-admin-user-detail", userId] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["layout-shell-master-admin-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["teachers"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-auth-events"] });
      queryClient.invalidateQueries({ queryKey: ["master-admin-audit-events"] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey?.[0];
        return [
          "master-admin-organization-detail",
          "master-admin-workspace-detail",
          "layout-shell-master-admin-organization-detail",
        ].includes(key);
      } });

      if (variables.mode === "delete") {
        closeDialog();
        navigate("/master-admin/users", { replace: true });
        return;
      }

      closeDialog();
    },
    onError: (error, variables) => {
      toast.error(
        error?.response?.data?.detail ||
          t(`masterAdminUserDetail.${variables?.mode || "action"}Failed`, "Action failed.")
      );
    },
  });

  const dialogConfig = useMemo(() => {
    if (!user || !dialogMode) return null;

    if (dialogMode === "approve") {
      return {
        title: t("masterAdminUserDetail.approveDialogTitle", {
          email: user.email,
          defaultValue: `Approve ${user.email}`,
        }),
        description: t(
          "masterAdminUserDetail.approveDialogDescription",
          "Approve this user and assign organization details."
        ),
        confirmLabel: t("masterAdminUserDetail.approve", "Approve"),
        variant: "primary",
      };
    }

    if (dialogMode === "freeze") {
      return {
        title: t("masterAdminUserDetail.freezeDialogTitle", {
          email: user.email,
          defaultValue: `Freeze ${user.email}`,
        }),
        description: t(
          "masterAdminUserDetail.freezeDialogDescription",
          "Temporarily disable login for this account. The account record remains available for audit and reactivation."
        ),
        confirmLabel: t("masterAdminUserDetail.freeze", "Freeze account"),
        variant: "danger",
      };
    }

    if (dialogMode === "reactivate") {
      return {
        title: t("masterAdminUserDetail.reactivateDialogTitle", {
          email: user.email,
          defaultValue: `Reactivate ${user.email}`,
        }),
        description: t(
          "masterAdminUserDetail.reactivateDialogDescription",
          "Restore this account so the user can sign in again."
        ),
        confirmLabel: t("masterAdminUserDetail.reactivate", "Reactivate account"),
        variant: "success",
      };
    }

    if (dialogMode === "delete") {
      return {
        title: t("masterAdminUserDetail.deleteDialogTitle", {
          email: user.email,
          defaultValue: `Delete ${user.email}`,
        }),
        description: t(
          "masterAdminUserDetail.deleteDialogDescription",
          {
            email: user.email,
            defaultValue:
              "This permanently removes or revokes this account record. Type the email exactly to confirm.",
          }
        ),
        confirmLabel: t("masterAdminUserDetail.delete", "Delete account"),
        variant: "danger",
      };
    }

    return null;
  }, [dialogMode, t, user]);

  const submitAction = () => {
    if (!dialogMode || !user) return;

    const payload = {
      reason: reason.trim() || undefined,
      confirmation_text: confirmationText.trim() || undefined,
      confirmation_email: confirmationText.trim() || undefined,
      target_email: user.email,
      ...(dialogMode === "approve"
        ? {
            organization_name: approvalOrganizationName.trim() || undefined,
            school_name: approvalSchoolName.trim() || undefined,
            manager_email: approvalManagerEmail.trim() || undefined,
          }
        : {}),
    };

    actionMutation.mutate({
      mode: dialogMode,
      payload,
    });
  };

  const needsSchoolName = tenantRole === "teacher" || tenantRole === "school_admin";
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
            {isFetching
              ? t("masterAdminUserDetail.refreshing")
              : t("masterAdminUserDetail.refresh")}
          </button>
        }
        railNote="This page is for sensitive lifecycle actions. Approvals, freezes, deletions, and reactivations should always include enough reason text to survive an audit review."
      >
        <div>
          <Link
            to="/master-admin/users"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            {t("masterAdminUserDetail.backToUsers")}
          </Link>
        </div>

        {isLoading ? (
          <LoadingState message={t("masterAdminUserDetail.loading")} />
        ) : null}

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
                  <div className="text-2xl font-semibold text-slate-900">
                    {user.name || "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{user.email}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(lifecycleStatus)}>
                    {t(`masterAdminUsers.statusMap.${lifecycleStatus}`, lifecycleStatus)}
                  </Badge>
                  <Badge variant="neutral">
                    {t(`masterAdminUsers.roleMap.${user.role}`, user.role || "—")}
                  </Badge>
                  {user.is_active === false ? (
                    <Badge variant="danger">
                      {t("masterAdminUsers.inactive", "Inactive")}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {t("masterAdminUserDetail.actionsTitle")}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {t("masterAdminUserDetail.actionsDescription")}
                    </div>
                  </div>
                  {isSelf ? (
                    <Badge variant="warning">
                      {t("masterAdminUserDetail.selfProtected")}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {canPreviewUser ? (
                    <Button type="button" variant="secondary" onClick={startPreview}>
                      {t("masterAdminUserDetail.previewAccount")}
                    </Button>
                  ) : null}

                  {canApprove ? (
                    <Button type="button" onClick={() => setDialogMode("approve")}>
                      {t("masterAdminUserDetail.approve", "Approve")}
                    </Button>
                  ) : null}

                  {canFreeze ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setDialogMode("freeze")}
                      disabled={isSelf}
                    >
                      {t("masterAdminUserDetail.freeze", "Freeze account")}
                    </Button>
                  ) : null}

                  {canReactivate ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDialogMode("reactivate")}
                      disabled={isSelf}
                    >
                      {t("masterAdminUserDetail.reactivate", "Reactivate account")}
                    </Button>
                  ) : null}

                  {canDelete ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setDialogMode("delete")}
                      disabled={isSelf}
                    >
                      {canApprove
                        ? t("masterAdminUserDetail.deny", "Deny / delete")
                        : t("masterAdminUserDetail.delete", "Delete account")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.createdAt")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {formatTimestamp(user.created_at, locale)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.lastLogin")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {formatTimestamp(user.last_login_at, locale)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.linkedTeacher")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.linked_teacher_name || "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.workspaceMode")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.workspace_mode || "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("masterAdminUserDetail.tenantRole")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {user.tenant_role
                      ? t(`masterAdminUserDetail.tenantRoleMap.${user.tenant_role}`, user.tenant_role)
                      : "—"}
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

              {user.linked_teacher_id ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {t("masterAdminUserDetail.teacherActionsTitle")}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {t("masterAdminUserDetail.teacherActionsDescription")}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      to={`/teachers/${user.linked_teacher_id}`}
                      className="text-sm font-medium text-primary hover:text-primary/80"
                    >
                      {t("masterAdminUserDetail.openTeacherSummary")}
                    </Link>
                    <Link
                      to={`/teachers/${user.linked_teacher_id}/operations`}
                      className="text-sm font-medium text-primary hover:text-primary/80"
                    >
                      {t("masterAdminUserDetail.openTeacherOperations")}
                    </Link>
                    <Link
                      to={`/videos?teacher_id=${user.linked_teacher_id}`}
                      className="text-sm font-medium text-primary hover:text-primary/80"
                    >
                      {t("masterAdminUserDetail.openTeacherVideos")}
                    </Link>
                  </div>
                </div>
              ) : null}
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {t("masterAdminUserDetail.activityTitle")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {t("masterAdminUserDetail.activityDescription")}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("masterAdminUsers.uploads")}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {user.uploads_total ?? 0}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {t("masterAdminUsers.assessments")}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {user.assessments_total ?? 0}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {t("masterAdminUserDetail.recentVideosTitle")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {t("masterAdminUserDetail.recentVideosDescription")}
                  </p>
                </div>

                {(data?.related?.recent_videos || []).length ? (
                  <div className="space-y-3">
                    {data.related.recent_videos.map((video) => (
                      <div
                        key={video.id}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="font-medium text-slate-900">
                          {video.filename || video.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatTimestamp(video.created_at, locale)}
                        </div>
                        <div className="mt-2">
                          <Link
                            to={`/videos/${video.id}`}
                            className="text-sm font-medium text-primary hover:text-primary/80"
                          >
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
            <Button
              type="button"
              variant="secondary"
              onClick={closeDialog}
              disabled={actionMutation.isPending}
            >
              {t("masterAdminUserDetail.cancel")}
            </Button>
            <Button
              type="button"
              variant={dialogConfig?.variant || "primary"}
              onClick={submitAction}
              disabled={actionMutation.isPending || !canSubmitDialog}
            >
              {actionMutation.isPending
                ? t("masterAdminUserDetail.saving")
                : dialogConfig?.confirmLabel}
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

              <Field
                label={
                  isTrainingAdmin
                    ? t("masterAdminUserDetail.trainingOrganizationLabel")
                    : t("masterAdminUserDetail.organizationLabel")
                }
              >
                <Input
                  value={approvalOrganizationName}
                  onChange={(event) => setApprovalOrganizationName(event.target.value)}
                  placeholder={t("masterAdminUserDetail.organizationPlaceholder")}
                />
              </Field>

              <InstitutionSuggestionList
                suggestions={institutionLookupRes?.suggestions || []}
                title={t("masterAdminUserDetail.institutionMatchesTitle")}
                emptyLabel={
                  approvalOrganizationName.trim().length >= 2
                    ? t("masterAdminUserDetail.institutionMatchesEmpty")
                    : null
                }
                selectLabel={t("masterAdminUserDetail.useInstitutionMatch")}
                onSelect={applyInstitutionSuggestion}
              />

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

          {needsReason ? (
            <Field label={t("masterAdminUserDetail.reasonLabel", "Reason")}>
              <Textarea
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t(
                  "masterAdminUserDetail.reasonPlaceholder",
                  "Enter an audit reason for this action."
                )}
              />
            </Field>
          ) : null}

          {needsConfirmation ? (
            <Field
              label={t("masterAdminUserDetail.confirmationLabel", {
                email: user?.email || "",
                defaultValue: `Type ${user?.email || "the target email"} to confirm`,
              })}
            >
              <Input
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                placeholder={user?.email || ""}
              />
              {confirmationText && !confirmationMatches ? (
                <p className="mt-2 text-xs text-rose-600">
                  {t(
                    "masterAdminUserDetail.confirmationMismatch",
                    "Confirmation text must match the target email exactly."
                  )}
                </p>
              ) : null}
            </Field>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

export default MasterAdminUserDetailPage;
