import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
import { masterAdminApi } from "@/lib/api";

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

export function MasterAdminPage() {
  const { t } = useTranslation();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-bootstrap"],
    queryFn: () => masterAdminApi.bootstrap().then((res) => res.data),
  });

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdmin.title")}
          description={t("masterAdmin.description")}
          meta={t("masterAdmin.meta", { email: data?.user?.email || "—" })}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? t("masterAdmin.refreshing") : t("masterAdmin.refresh")}
            </button>
          }
        />

        <Panel className="space-y-3 border-amber-200 bg-amber-50/80">
          <div className="text-sm font-semibold text-slate-900">{t("masterAdmin.internalOnlyTitle")}</div>
          <div className="text-sm text-slate-700">{t("masterAdmin.internalOnlyDescription")}</div>
        </Panel>

        {isLoading ? <LoadingState message={t("masterAdmin.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdmin.loadFailedTitle")}
            message={t("masterAdmin.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Panel className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdmin.summaryRole")}
                </div>
                <div className="text-2xl font-semibold text-slate-900">{data?.user?.role || "—"}</div>
                <div className="text-sm text-slate-500">{t("masterAdmin.summaryRoleHint")}</div>
              </Panel>
              <Panel className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdmin.summarySections")}
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {data?.sections?.length ?? 0}
                </div>
                <div className="text-sm text-slate-500">{t("masterAdmin.summarySectionsHint")}</div>
              </Panel>
              <Panel className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdmin.summaryScope")}
                </div>
                <div className="text-2xl font-semibold text-slate-900">{t("masterAdmin.summaryScopeValue")}</div>
                <div className="text-sm text-slate-500">{t("masterAdmin.summaryScopeHint")}</div>
              </Panel>
            </div>

            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("masterAdmin.sectionsTitle")}</h2>
                <p className="text-sm text-slate-500">{t("masterAdmin.sectionsDescription")}</p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(data?.sections || []).map((section) => (
                  <SectionCard key={section.id} section={section} t={t} />
                ))}
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    </LayoutShell>
  );
}

