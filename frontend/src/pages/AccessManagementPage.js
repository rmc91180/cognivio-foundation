import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LayoutShell } from "@/components/LayoutShell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "@/components/ui";
import { adminApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

function formatTimestamp(value, locale) {
  if (!value) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return "—";
  }
}

function UserRecordCard({
  user,
  section,
  locale,
  currentUserId,
  actionUserId,
  onApprove,
  onRevoke,
  t,
}) {
  const isBusy = actionUserId === user.id;
  const canRemove = section === "approved" && user.id !== currentUserId;
  const canApprove = section === "pending" || section === "revoked";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">
            {user.name || t("accessManagement.unknownName")}
          </div>
          <div className="mt-1 text-sm text-slate-600">{user.email}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              section === "approved"
                ? "success"
                : section === "pending"
                  ? "warning"
                  : "danger"
            }
          >
            {t(`accessManagement.statuses.${section}`)}
          </Badge>
          {user.role ? (
            <Badge variant="neutral">{t("accessManagement.roleLabel", { role: user.role })}</Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("accessManagement.requestedAt")}
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {formatTimestamp(user.approval_requested_at || user.created_at, locale)}
          </div>
        </div>
        <div className="rounded-xl bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {section === "approved"
              ? t("accessManagement.approvedAt")
              : section === "revoked"
                ? t("accessManagement.removedAt")
                : t("accessManagement.workspaceLink")}
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {section === "approved"
              ? formatTimestamp(user.approved_at, locale)
              : section === "revoked"
                ? formatTimestamp(user.revoked_at, locale)
                : user.teacher_id || t("accessManagement.noTeacherLink")}
          </div>
        </div>
      </div>

      {section === "approved" && (user.teacher_id || user.workspace_mode) ? (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          {user.teacher_id ? (
            <span>{t("accessManagement.teacherLinkLabel", { teacherId: user.teacher_id })}</span>
          ) : null}
          {user.workspace_mode ? (
            <span>{t("accessManagement.workspaceModeLabel", { mode: user.workspace_mode })}</span>
          ) : null}
        </div>
      ) : null}

      {section === "revoked" && user.revoked_by ? (
        <div className="mt-3 text-xs text-slate-500">
          {t("accessManagement.removedBy", { email: user.revoked_by })}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {canApprove ? (
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => onApprove(user.id)}
          >
            {isBusy ? t("accessManagement.updating") : t("accessManagement.approve")}
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => onRevoke(user.id)}
          >
            {isBusy ? t("accessManagement.updating") : t("accessManagement.removeAccess")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AccessSection({
  title,
  description,
  users,
  section,
  locale,
  currentUserId,
  actionUserId,
  onApprove,
  onRevoke,
  t,
}) {
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <Badge variant="neutral">{t("accessManagement.countLabel", { count: users.length })}</Badge>
      </div>
      {users.length ? (
        <div className="space-y-3">
          {section === "pending" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              {t("accessManagement.pendingApprovalNote")}
            </div>
          ) : null}
          {users.map((user) => (
            <UserRecordCard
              key={user.id}
              user={user}
              section={section}
              locale={locale}
              currentUserId={currentUserId}
              actionUserId={actionUserId}
              onApprove={onApprove}
              onRevoke={onRevoke}
              t={t}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t("accessManagement.emptySectionTitle")}
          message={t(`accessManagement.emptyStates.${section}`)}
        />
      )}
    </Panel>
  );
}

export function AccessManagementPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-access-users"],
    queryFn: () => adminApi.accessUsers().then((res) => res.data),
  });

  const approvalMutation = useMutation({
    mutationFn: (userId) => adminApi.approveAccessUser(userId),
    onSuccess: () => {
      toast.success(t("accessManagement.approveSuccess"));
      queryClient.invalidateQueries({ queryKey: ["admin-access-users"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("accessManagement.approveFailed"));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (userId) => adminApi.revokeAccessUser(userId),
    onSuccess: () => {
      toast.success(t("accessManagement.removeSuccess"));
      queryClient.invalidateQueries({ queryKey: ["admin-access-users"] });
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || t("accessManagement.removeFailed"));
    },
  });

  const actionUserId =
    approvalMutation.isPending
      ? approvalMutation.variables
      : revokeMutation.isPending
        ? revokeMutation.variables
        : null;

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("accessManagement.title")}
          description={t("accessManagement.description")}
          meta={t("accessManagement.meta")}
          actions={
            <Button
              type="button"
              variant="secondary"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? t("accessManagement.refreshing") : t("accessManagement.refresh")}
            </Button>
          }
        />

        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("accessManagement.pendingTitle")}
            </div>
            <div className="text-3xl font-semibold text-slate-900">{data?.pending?.length || 0}</div>
            <div className="text-sm text-slate-500">{t("accessManagement.pendingSummary")}</div>
          </Panel>
          <Panel className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("accessManagement.approvedTitle")}
            </div>
            <div className="text-3xl font-semibold text-slate-900">{data?.approved?.length || 0}</div>
            <div className="text-sm text-slate-500">{t("accessManagement.approvedSummary")}</div>
          </Panel>
          <Panel className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("accessManagement.revokedTitle")}
            </div>
            <div className="text-3xl font-semibold text-slate-900">{data?.revoked?.length || 0}</div>
            <div className="text-sm text-slate-500">{t("accessManagement.revokedSummary")}</div>
          </Panel>
        </div>

        <Panel className="space-y-2 bg-amber-50/60">
          <div className="text-sm font-semibold text-slate-900">
            {t("accessManagement.policyTitle")}
          </div>
          <div className="text-sm text-slate-600">
            {t("accessManagement.policyDescription")}
          </div>
          <div className="text-sm text-slate-600">
            {t("accessManagement.policyRemoval")}
          </div>
        </Panel>

        {isLoading ? <LoadingState message={t("accessManagement.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("accessManagement.loadFailedTitle")}
            message={t("accessManagement.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <div className="space-y-6">
            <AccessSection
              title={t("accessManagement.pendingTitle")}
              description={t("accessManagement.pendingDescription")}
              users={data?.pending || []}
              section="pending"
              locale={locale}
              currentUserId={user?.id}
              actionUserId={actionUserId}
              onApprove={(userId) => approvalMutation.mutate(userId)}
              onRevoke={(userId) => revokeMutation.mutate(userId)}
              t={t}
            />
            <AccessSection
              title={t("accessManagement.approvedTitle")}
              description={t("accessManagement.approvedDescription")}
              users={data?.approved || []}
              section="approved"
              locale={locale}
              currentUserId={user?.id}
              actionUserId={actionUserId}
              onApprove={(userId) => approvalMutation.mutate(userId)}
              onRevoke={(userId) => revokeMutation.mutate(userId)}
              t={t}
            />
            <AccessSection
              title={t("accessManagement.revokedTitle")}
              description={t("accessManagement.revokedDescription")}
              users={data?.revoked || []}
              section="revoked"
              locale={locale}
              currentUserId={user?.id}
              actionUserId={actionUserId}
              onApprove={(userId) => approvalMutation.mutate(userId)}
              onRevoke={(userId) => revokeMutation.mutate(userId)}
              t={t}
            />
          </div>
        ) : null}
      </div>
    </LayoutShell>
  );
}
