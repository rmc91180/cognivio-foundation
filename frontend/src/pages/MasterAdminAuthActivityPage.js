import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

function formatTimestamp(value, locale) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function resultVariant(value) {
  return value === "success" ? "success" : "danger";
}

export function MasterAdminAuthActivityPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const [filters, setFilters] = useState({ q: "", event_type: "", result: "" });
  const queryFilters = useMemo(
    () => ({
      q: filters.q || undefined,
      event_type: filters.event_type || undefined,
      result: filters.result || undefined,
    }),
    [filters]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-auth-events", queryFilters],
    queryFn: () => masterAdminApi.authEvents(queryFilters).then((res) => res.data),
  });

  const events = data?.items || [];
  const successCount = events.filter((item) => item.result === "success").length;
  const failureCount = events.filter((item) => item.result === "failure").length;

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdminAuth.title")}
          description={t("masterAdminAuth.description")}
          meta={t("masterAdminAuth.meta")}
          actions={
            <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? t("masterAdminAuth.refreshing") : t("masterAdminAuth.refresh")}
            </Button>
          }
        />

        <MasterAdminSectionNav />

        <Panel className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr,auto]">
            <Field label={t("masterAdminAuth.searchLabel")}>
              <Input
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder={t("masterAdminAuth.searchPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminAuth.eventTypeLabel")}>
              <select
                value={filters.event_type}
                onChange={(event) => setFilters((prev) => ({ ...prev, event_type: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminAuth.allEventTypes")}</option>
                <option value="login_success">{t("masterAdminAuth.eventTypes.login_success")}</option>
                <option value="login_failed">{t("masterAdminAuth.eventTypes.login_failed")}</option>
                <option value="request_access">{t("masterAdminAuth.eventTypes.request_access")}</option>
                <option value="approval_granted">{t("masterAdminAuth.eventTypes.approval_granted")}</option>
                <option value="approval_denied">{t("masterAdminAuth.eventTypes.approval_denied")}</option>
                <option value="access_revoked">{t("masterAdminAuth.eventTypes.access_revoked")}</option>
                <option value="access_reactivated">{t("masterAdminAuth.eventTypes.access_reactivated")}</option>
              </select>
            </Field>
            <Field label={t("masterAdminAuth.resultLabel")}>
              <select
                value={filters.result}
                onChange={(event) => setFilters((prev) => ({ ...prev, result: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">{t("masterAdminAuth.allResults")}</option>
                <option value="success">{t("masterAdminAuth.success")}</option>
                <option value="failure">{t("masterAdminAuth.failure")}</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.totalEvents")}</div>
              <div className="text-2xl font-semibold text-slate-900">{data?.total ?? 0}</div>
            </Panel>
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.successfulEvents")}</div>
              <div className="text-2xl font-semibold text-slate-900">{successCount}</div>
            </Panel>
            <Panel className="space-y-1 bg-slate-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.failedEvents")}</div>
              <div className="text-2xl font-semibold text-slate-900">{failureCount}</div>
            </Panel>
          </div>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdminAuth.loading")} /> : null}
        {isError ? (
          <ErrorState title={t("masterAdminAuth.loadFailedTitle")} message={t("masterAdminAuth.loadFailedMessage")} />
        ) : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminAuth.tableTitle")}</h2>
              <p className="text-sm text-slate-500">{t("masterAdminAuth.tableDescription")}</p>
            </div>
            {events.length ? (
              <div className="space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          {t(`masterAdminAuth.eventTypes.${event.event_type}`)}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{event.email || event.user_id || "—"}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={resultVariant(event.result)}>{event.result || "—"}</Badge>
                        {event.role_selected ? <Badge variant="neutral">{event.role_selected}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.timestamp")}</div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(event.created_at, locale)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.reason")}</div>
                        <div className="mt-1 text-sm text-slate-700">{event.reason || "—"}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.ipAddress")}</div>
                        <div className="mt-1 text-sm text-slate-700">{event.ip_address || "—"}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAuth.userAgent")}</div>
                        <div className="mt-1 text-sm text-slate-700 break-words">{event.user_agent || "—"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={t("masterAdminAuth.emptyTitle")} message={t("masterAdminAuth.emptyMessage")} />
            )}
          </Panel>
        ) : null}
      </div>
    </LayoutShell>
  );
}

