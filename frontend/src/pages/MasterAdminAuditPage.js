import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

export function MasterAdminAuditPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const [filters, setFilters] = useState({ q: "", action: "", target_type: "" });
  const queryFilters = useMemo(
    () => ({
      q: filters.q || undefined,
      action: filters.action || undefined,
      target_type: filters.target_type || undefined,
    }),
    [filters]
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-audit-events", queryFilters],
    queryFn: () => masterAdminApi.auditEvents(queryFilters).then((res) => res.data),
  });

  return (
    <MasterAdminPageScaffold
      title={t("masterAdminAudit.title")}
      description={t("masterAdminAudit.description")}
      meta={t("masterAdminAudit.meta")}
      actions={
        <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? t("masterAdminAudit.refreshing") : t("masterAdminAudit.refresh")}
        </Button>
      }
      railNote="Audit is the system of record for operator behavior. If a support or access action might be questioned later, the reason text here matters."
    >

        <Panel className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.4fr,0.9fr,0.9fr]">
            <Field label={t("masterAdminAudit.searchLabel")}>
              <Input
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder={t("masterAdminAudit.searchPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminAudit.actionLabel")}>
              <Input
                value={filters.action}
                onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))}
                placeholder={t("masterAdminAudit.actionPlaceholder")}
              />
            </Field>
            <Field label={t("masterAdminAudit.targetTypeLabel")}>
              <Input
                value={filters.target_type}
                onChange={(event) => setFilters((prev) => ({ ...prev, target_type: event.target.value }))}
                placeholder={t("masterAdminAudit.targetTypePlaceholder")}
              />
            </Field>
          </div>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdminAudit.loading")} /> : null}
        {isError ? (
          <ErrorState title={t("masterAdminAudit.loadFailedTitle")} message={t("masterAdminAudit.loadFailedMessage")} />
        ) : null}

        {!isLoading && !isError ? (
          <Panel className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminAudit.tableTitle")}</h2>
              <p className="text-sm text-slate-500">{t("masterAdminAudit.tableDescription")}</p>
            </div>
            {(data?.items || []).length ? (
              <div className="space-y-3">
                {data.items.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{event.action}</div>
                        <div className="mt-1 text-sm text-slate-600">{event.actor_email || event.actor_user_id || "—"}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="neutral">{event.target_type}</Badge>
                        {event.actor_role ? <Badge variant="success">{event.actor_role}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAudit.timestamp")}</div>
                        <div className="mt-1 text-sm text-slate-700">{formatTimestamp(event.created_at, locale)}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAudit.targetId")}</div>
                        <div className="mt-1 text-sm text-slate-700 break-words">{event.target_id}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAudit.reason")}</div>
                        <div className="mt-1 text-sm text-slate-700">{event.reason || "—"}</div>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminAudit.metadata")}</div>
                        <div className="mt-1 text-sm text-slate-700 break-words">
                          {Object.keys(event.metadata || {}).length ? JSON.stringify(event.metadata) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={t("masterAdminAudit.emptyTitle")} message={t("masterAdminAudit.emptyMessage")} />
            )}
          </Panel>
        ) : null}
    </MasterAdminPageScaffold>
  );
}
