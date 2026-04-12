import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Panel,
} from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function statusVariant(value) {
  if (value === "approved") return "success";
  if (value === "pending") return "warning";
  if (value === "revoked") return "danger";
  return "neutral";
}

function formatTimestamp(value, locale) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

export function MasterAdminUsersPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");

  const filters = useMemo(
    () => ({
      q: searchParams.get("q") || undefined,
      role: searchParams.get("role") || undefined,
      approval_status: searchParams.get("approval_status") || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-users", filters],
    queryFn: () => masterAdminApi.users(filters).then((res) => res.data),
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setFilter("q", query.trim() || "");
  };

  return (
    <MasterAdminPageScaffold
      title={t("masterAdminUsers.title")}
      description={t("masterAdminUsers.description")}
      meta={t("masterAdminUsers.meta")}
      actions={
        <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? t("masterAdminUsers.refreshing") : t("masterAdminUsers.refresh")}
        </Button>
      }
      railNote="Manage global access from here. Approvals, revocations, and user detail remain separate from school-level coaching pages."
    >

        <Panel className="space-y-4">
          <form className="grid gap-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr,auto]" onSubmit={handleSearchSubmit}>
            <Field label={t("masterAdminUsers.searchLabel")}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("masterAdminUsers.searchPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminUsers.roleLabel")}>
              <select
                value={filters.role || ""}
                onChange={(event) => setFilter("role", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminUsers.allRoles")}</option>
                <option value="teacher">{t("masterAdminUsers.roleTeacher")}</option>
                <option value="admin">{t("masterAdminUsers.roleAdmin")}</option>
                <option value="super_admin">{t("masterAdminUsers.roleSuperAdmin")}</option>
              </select>
            </Field>
            <Field label={t("masterAdminUsers.statusLabel")}>
              <select
                value={filters.approval_status || ""}
                onChange={(event) => setFilter("approval_status", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminUsers.allStatuses")}</option>
                <option value="approved">{t("masterAdminUsers.statusApproved")}</option>
                <option value="pending">{t("masterAdminUsers.statusPending")}</option>
                <option value="revoked">{t("masterAdminUsers.statusRevoked")}</option>
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit">{t("masterAdminUsers.applyFilters")}</Button>
            </div>
          </form>

          <MasterAdminMetricGrid className="xl:grid-cols-5">
            <MasterAdminMetricCard label={t("masterAdminUsers.total")} value={data?.total ?? 0} />
            <MasterAdminMetricCard label={t("masterAdminUsers.approved")} value={data?.summary?.approved ?? 0} tone="success" />
            <MasterAdminMetricCard label={t("masterAdminUsers.pending")} value={data?.summary?.pending ?? 0} tone="warning" />
            <MasterAdminMetricCard label={t("masterAdminUsers.admins")} value={data?.summary?.admins ?? 0} />
            <MasterAdminMetricCard label={t("masterAdminUsers.teachers")} value={data?.summary?.teachers ?? 0} />
          </MasterAdminMetricGrid>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdminUsers.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdminUsers.loadFailedTitle")}
            message={t("masterAdminUsers.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminUsers.directoryTitle")}</h2>
              <p className="text-sm text-slate-500">{t("masterAdminUsers.directoryDescription")}</p>
            </div>
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((user) => (
                  <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{user.name || "—"}</div>
                        <div className="mt-1 text-sm text-slate-600">{user.email}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(user.approval_status)}>
                          {t(`masterAdminUsers.statusMap.${user.approval_status}`)}
                        </Badge>
                        <Badge variant="neutral">{t(`masterAdminUsers.roleMap.${user.role}`)}</Badge>
                        {user.is_active ? null : <Badge variant="danger">{t("masterAdminUsers.inactive")}</Badge>}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.createdAt")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(user.created_at, locale)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.lastLogin")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(user.last_login_at, locale)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.linkedTeacher")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{user.linked_teacher_name || "—"}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.workspaceMode")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{user.workspace_mode || "—"}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.uploads")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{user.uploads_total}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("masterAdminUsers.assessments")}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{user.assessments_total}</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <Link to={`/master-admin/users/${user.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                        {t("masterAdminUsers.openDetail")}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("masterAdminUsers.emptyTitle")}
                message={t("masterAdminUsers.emptyMessage")}
              />
            )}
          </Panel>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
