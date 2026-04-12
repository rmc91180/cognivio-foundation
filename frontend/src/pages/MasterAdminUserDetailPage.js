import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
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

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-user-detail", userId],
    queryFn: () => masterAdminApi.userDetail(userId).then((res) => res.data),
    enabled: Boolean(userId),
  });

  const user = data?.user;

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdminUserDetail.title")}
          description={t("masterAdminUserDetail.description")}
          meta={user ? t("masterAdminUserDetail.meta", { email: user.email }) : null}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? t("masterAdminUserDetail.refreshing") : t("masterAdminUserDetail.refresh")}
            </button>
          }
        />

        <MasterAdminSectionNav />

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
      </div>
    </LayoutShell>
  );
}

