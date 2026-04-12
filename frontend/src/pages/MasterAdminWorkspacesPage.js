import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Panel,
} from "@/components/ui";
import { MasterAdminSectionNav } from "@/components/master-admin/MasterAdminSectionNav";
import { masterAdminApi } from "@/lib/api";

function stateVariant(value) {
  if (value === "healthy" || value === "live" || value === "active") return "success";
  if (value === "attention" || value === "configured" || value === "stale") return "warning";
  if (value === "blocked" || value === "setup_needed" || value === "inactive") return "danger";
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

export function MasterAdminWorkspacesPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");

  const filters = useMemo(
    () => ({
      q: searchParams.get("q") || undefined,
      health_state: searchParams.get("health_state") || undefined,
      activity_state: searchParams.get("activity_state") || undefined,
      pilot_state: searchParams.get("pilot_state") || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-workspaces", filters],
    queryFn: () => masterAdminApi.workspaces(filters).then((res) => res.data),
  });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setFilter("q", query.trim() || "");
  };

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdminWorkspaces.title")}
          description={t("masterAdminWorkspaces.description")}
          meta={t("masterAdminWorkspaces.meta")}
          actions={
            <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? t("masterAdminWorkspaces.refreshing") : t("masterAdminWorkspaces.refresh")}
            </Button>
          }
        />

        <MasterAdminSectionNav />

        <Panel className="space-y-4">
          <form className="grid gap-4 lg:grid-cols-[1.5fr,0.8fr,0.8fr,0.8fr,auto]" onSubmit={handleSearchSubmit}>
            <Field label={t("masterAdminWorkspaces.searchLabel")}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("masterAdminWorkspaces.searchPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminWorkspaces.healthLabel")}>
              <select
                value={filters.health_state || ""}
                onChange={(event) => setFilter("health_state", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminWorkspaces.allHealthStates")}</option>
                <option value="healthy">{t("masterAdminWorkspaces.healthStates.healthy")}</option>
                <option value="attention">{t("masterAdminWorkspaces.healthStates.attention")}</option>
                <option value="blocked">{t("masterAdminWorkspaces.healthStates.blocked")}</option>
                <option value="stale">{t("masterAdminWorkspaces.healthStates.stale")}</option>
              </select>
            </Field>
            <Field label={t("masterAdminWorkspaces.activityLabel")}>
              <select
                value={filters.activity_state || ""}
                onChange={(event) => setFilter("activity_state", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminWorkspaces.allActivityStates")}</option>
                <option value="active">{t("masterAdminWorkspaces.activityStates.active")}</option>
                <option value="stale">{t("masterAdminWorkspaces.activityStates.stale")}</option>
                <option value="inactive">{t("masterAdminWorkspaces.activityStates.inactive")}</option>
              </select>
            </Field>
            <Field label={t("masterAdminWorkspaces.pilotLabel")}>
              <select
                value={filters.pilot_state || ""}
                onChange={(event) => setFilter("pilot_state", event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminWorkspaces.allPilotStates")}</option>
                <option value="live">{t("masterAdminWorkspaces.pilotStates.live")}</option>
                <option value="configured">{t("masterAdminWorkspaces.pilotStates.configured")}</option>
                <option value="setup_needed">{t("masterAdminWorkspaces.pilotStates.setup_needed")}</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("masterAdminWorkspaces.applyFilters")}</Button>
            </div>
          </form>

          <div className="grid gap-4 md:grid-cols-4">
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.total")}</div>
              <div className="text-2xl font-semibold text-slate-900">{data?.total ?? 0}</div>
            </Panel>
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.summaryBlocked")}</div>
              <div className="text-2xl font-semibold text-slate-900">{data?.summary?.blocked ?? 0}</div>
            </Panel>
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.summaryAttention")}</div>
              <div className="text-2xl font-semibold text-slate-900">{data?.summary?.attention ?? 0}</div>
            </Panel>
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.summaryLive")}</div>
              <div className="text-2xl font-semibold text-slate-900">{data?.summary?.live ?? 0}</div>
            </Panel>
          </div>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdminWorkspaces.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdminWorkspaces.loadFailedTitle")}
            message={t("masterAdminWorkspaces.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminWorkspaces.tableTitle")}</h2>
              <p className="text-sm text-slate-500">{t("masterAdminWorkspaces.tableDescription")}</p>
            </div>
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((workspace) => (
                  <div key={workspace.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{workspace.owner_name || t("masterAdminWorkspaces.unknownOwner")}</div>
                        <div className="mt-1 text-sm text-slate-600">{workspace.owner_email || "—"}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={stateVariant(workspace.health_state)}>
                          {t(`masterAdminWorkspaces.healthStates.${workspace.health_state}`)}
                        </Badge>
                        <Badge variant={stateVariant(workspace.activity_state)}>
                          {t(`masterAdminWorkspaces.activityStates.${workspace.activity_state}`)}
                        </Badge>
                        <Badge variant={stateVariant(workspace.pilot_state)}>
                          {t(`masterAdminWorkspaces.pilotStates.${workspace.pilot_state}`)}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.teacherCount")}</div>
                        <div className="mt-1 text-sm text-slate-700">{workspace.teacher_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.uploadCount")}</div>
                        <div className="mt-1 text-sm text-slate-700">{workspace.upload_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.assessmentCount")}</div>
                        <div className="mt-1 text-sm text-slate-700">{workspace.assessment_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.privacyGaps")}</div>
                        <div className="mt-1 text-sm text-slate-700">{workspace.privacy_gap_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.unlinkedUsers")}</div>
                        <div className="mt-1 text-sm text-slate-700">{workspace.unlinked_user_count}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.lastActivity")}</div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(workspace.last_activity_at, locale)}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-slate-600">{workspace.issue_summary || t("masterAdminWorkspaces.noOpenIssues")}</div>
                      <Link to={`/master-admin/workspaces/${workspace.owner_user_id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                        {t("masterAdminWorkspaces.openDetail")}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("masterAdminWorkspaces.emptyTitle")}
                message={t("masterAdminWorkspaces.emptyMessage")}
              />
            )}
          </Panel>
        ) : null}
      </div>
    </LayoutShell>
  );
}
