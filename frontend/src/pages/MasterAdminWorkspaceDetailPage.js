import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutShell } from "@/components/LayoutShell";
import { Badge, ErrorState, LoadingState, PageHeader, Panel } from "@/components/ui";
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

export function MasterAdminWorkspaceDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("he") ? "he-IL" : "en-US";
  const { ownerUserId } = useParams();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-workspace-detail", ownerUserId],
    queryFn: () => masterAdminApi.workspaceDetail(ownerUserId).then((res) => res.data),
    enabled: Boolean(ownerUserId),
  });

  const workspace = data?.workspace;
  const related = data?.related || {};

  return (
    <LayoutShell>
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("masterAdminWorkspaceDetail.title")}
          description={t("masterAdminWorkspaceDetail.description")}
          meta={workspace ? t("masterAdminWorkspaceDetail.meta", { email: workspace.owner_email || "—" }) : null}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetching ? t("masterAdminWorkspaceDetail.refreshing") : t("masterAdminWorkspaceDetail.refresh")}
            </button>
          }
        />

        <MasterAdminSectionNav />

        <div>
          <Link to="/master-admin/workspaces" className="text-sm font-medium text-primary hover:text-primary/80">
            {t("masterAdminWorkspaceDetail.backToWorkspaces")}
          </Link>
        </div>

        {isLoading ? <LoadingState message={t("masterAdminWorkspaceDetail.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("masterAdminWorkspaceDetail.loadFailedTitle")}
            message={t("masterAdminWorkspaceDetail.loadFailedMessage")}
          />
        ) : null}

        {!isLoading && !isError && workspace ? (
          <>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-2xl font-semibold text-slate-900">{workspace.owner_name || t("masterAdminWorkspaces.unknownOwner")}</div>
                  <div className="mt-1 text-sm text-slate-600">{workspace.owner_email || "—"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={stateVariant(workspace.health_state)}>{t(`masterAdminWorkspaces.healthStates.${workspace.health_state}`)}</Badge>
                  <Badge variant={stateVariant(workspace.activity_state)}>{t(`masterAdminWorkspaces.activityStates.${workspace.activity_state}`)}</Badge>
                  <Badge variant={stateVariant(workspace.pilot_state)}>{t(`masterAdminWorkspaces.pilotStates.${workspace.pilot_state}`)}</Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaceDetail.workspaceMode")}</div>
                  <div className="mt-1 text-sm text-slate-700">{workspace.workspace_mode || "—"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.teacherCount")}</div>
                  <div className="mt-1 text-sm text-slate-700">{workspace.teacher_count}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.uploadCount")}</div>
                  <div className="mt-1 text-sm text-slate-700">{workspace.upload_count}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.assessmentCount")}</div>
                  <div className="mt-1 text-sm text-slate-700">{workspace.assessment_count}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.privacyGaps")}</div>
                  <div className="mt-1 text-sm text-slate-700">{workspace.privacy_gap_count}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("masterAdminWorkspaces.lastActivity")}</div>
                  <div className="mt-1 text-sm text-slate-700">{formatTimestamp(workspace.last_activity_at, locale)}</div>
                </div>
              </div>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminWorkspaceDetail.teachersTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminWorkspaceDetail.teachersDescription")}</p>
                </div>
                {(related.teachers || []).length ? (
                  <div className="space-y-3">
                    {related.teachers.map((teacher) => (
                      <div key={teacher.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-900">{teacher.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{teacher.email || "—"}</div>
                          </div>
                          <Badge variant={teacher.privacy_ready ? "success" : "warning"}>
                            {teacher.privacy_ready
                              ? t("masterAdminWorkspaceDetail.privacyReady")
                              : t("masterAdminWorkspaceDetail.privacyMissing")}
                          </Badge>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {teacher.subject || "—"} · {formatTimestamp(teacher.created_at, locale)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("masterAdminWorkspaceDetail.noTeachers")}
                  </div>
                )}
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminWorkspaceDetail.linkageTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminWorkspaceDetail.linkageDescription")}</p>
                </div>
                {(related.unlinked_users || []).length ? (
                  <div className="space-y-3">
                    {related.unlinked_users.map((user) => (
                      <div key={user.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <div className="font-medium text-slate-900">{user.name || "—"}</div>
                        <div className="mt-1 text-xs text-slate-600">{user.email}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {t(`masterAdminUsers.statusMap.${user.approval_status}`)} · {formatTimestamp(user.last_login_at, locale)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("masterAdminWorkspaceDetail.noLinkageIssues")}
                  </div>
                )}
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminWorkspaceDetail.failuresTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminWorkspaceDetail.failuresDescription")}</p>
                </div>
                {(related.recent_failures || []).length ? (
                  <div className="space-y-3">
                    {related.recent_failures.map((video) => (
                      <div key={video.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                        <div className="font-medium text-slate-900">{video.filename || video.id}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          {video.transcode_status || "—"} · {video.privacy_status || "—"} · {video.analysis_status || "—"}
                        </div>
                        <div className="mt-2">
                          <Link to={`/videos/${video.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                            {t("masterAdminWorkspaceDetail.openVideo")}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("masterAdminWorkspaceDetail.noFailures")}
                  </div>
                )}
              </Panel>

              <Panel className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminWorkspaceDetail.memoryTitle")}</h2>
                  <p className="text-sm text-slate-500">{t("masterAdminWorkspaceDetail.memoryDescription")}</p>
                </div>
                {(related.memory_entries || []).length ? (
                  <div className="space-y-3">
                    {related.memory_entries.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-medium text-slate-900">{entry.memory_type}</div>
                        <div className="mt-1 text-xs text-slate-600">{entry.scope_type} · {entry.scope_id}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatTimestamp(entry.updated_at, locale)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {t("masterAdminWorkspaceDetail.noMemory")}
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
