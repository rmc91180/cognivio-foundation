import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Panel } from "@/components/ui";
import { MasterAdminMetricCard, MasterAdminMetricGrid, MasterAdminPageScaffold } from "@/components/master-admin/MasterAdminPageScaffold";
import { masterAdminApi } from "@/lib/api";

function capacityVariant(value) {
  if (value === "at_limit") return "danger";
  if (value === "near_limit") return "warning";
  if (value === "available") return "success";
  return "neutral";
}

function roleVariant(role) {
  if (role === "teacher") return "neutral";
  if (role === "training_admin") return "success";
  if (role === "school_admin" || role === "admin") return "warning";
  if (role === "super_admin") return "danger";
  return "neutral";
}

function MemberList({ title, members, emptyLabel, linkBase }) {
  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      {members.length ? (
        <div className="space-y-3">
          {members.map((member) => (
            <div key={member.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">{member.name || "—"}</div>
                  <div className="mt-1 text-sm text-slate-600">{member.email}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                    {member.school_name || member.requested_school_name || "—"}
                  </div>
                </div>
                <Badge variant={roleVariant(member.tenant_role)}>{member.tenant_role || member.role || "—"}</Badge>
              </div>
              <div className="mt-3">
                <Link to={`${linkBase}/${member.id}`} className="text-sm font-medium text-primary hover:text-primary/80">
                  Open user detail
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={emptyLabel} message="" />
      )}
    </Panel>
  );
}

export function MasterAdminOrganizationDetailPage() {
  const { t } = useTranslation();
  const { organizationId } = useParams();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["master-admin-organization-detail", organizationId],
    queryFn: () => masterAdminApi.organizationDetail(organizationId).then((res) => res.data),
    enabled: Boolean(organizationId),
  });

  const organization = data?.organization;
  const activeUsers = data?.related?.active_users || [];
  const pendingUsers = data?.related?.pending_users || [];
  const schools = data?.related?.schools || [];

  const admins = useMemo(
    () =>
      activeUsers.filter((member) =>
        ["school_admin", "training_admin", "admin", "super_admin"].includes(member.tenant_role)
      ),
    [activeUsers]
  );
  const teachers = useMemo(
    () => activeUsers.filter((member) => member.tenant_role === "teacher"),
    [activeUsers]
  );

  return (
    <MasterAdminPageScaffold
      title={organization?.name || t("masterAdminOrganizations.detailTitle")}
      description={organization ? t("masterAdminOrganizations.detailDescription") : t("masterAdminOrganizations.detailLoadingDescription")}
      meta={organization ? `${t("masterAdminOrganizations.identifier")}: ${organization.id}` : null}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? t("masterAdminOrganizations.refreshing") : t("masterAdminOrganizations.refresh")}
          </Button>
          <Link to="/master-admin/organizations" className="inline-flex">
            <Button type="button" variant="secondary">
              {t("masterAdminOrganizations.backToList")}
            </Button>
          </Link>
        </>
      }
      railNote={t("masterAdminOrganizations.detailRailNote")}
    >
      {isLoading ? <LoadingState message={t("masterAdminOrganizations.loading")} /> : null}
      {isError ? (
        <ErrorState
          title={t("masterAdminOrganizations.loadFailedTitle")}
          message={t("masterAdminOrganizations.loadFailedMessage")}
        />
      ) : null}

      {!isLoading && !isError && organization ? (
        <>
          <Panel className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {t("masterAdminOrganizations.detailHeader")}
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{organization.name}</div>
                <div className="mt-1 text-sm text-slate-600">
                  {organization.organization_type === "training"
                    ? t("masterAdminOrganizations.types.training")
                    : t("masterAdminOrganizations.types.school")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral">{organization.id}</Badge>
                <Badge variant={capacityVariant(organization.capacity_state)}>
                  {t(`masterAdminOrganizations.capacityStates.${organization.capacity_state}`)}
                </Badge>
              </div>
            </div>

            <MasterAdminMetricGrid className="xl:grid-cols-5">
              <MasterAdminMetricCard label={t("masterAdminOrganizations.activeUsers")} value={organization.active_user_count} />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.pendingUsers")} value={organization.pending_user_count} tone="warning" />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.activeTeachers")} value={organization.active_teacher_count} />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.activeAdmins")} value={organization.active_admin_count} />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.schoolCountCard")} value={organization.school_count} />
            </MasterAdminMetricGrid>

            <MasterAdminMetricGrid className="xl:grid-cols-4">
              <MasterAdminMetricCard label={t("masterAdminOrganizations.seatLimit")} value={organization.seat_limit || t("masterAdminOrganizations.unlimited")} />
              <MasterAdminMetricCard
                label={t("masterAdminOrganizations.seatStatusLabel")}
                value={organization.seat_limit ? organization.seats_remaining ?? 0 : t("masterAdminOrganizations.unlimited")}
                hint={
                  organization.seat_limit
                    ? t("masterAdminOrganizations.seatStatus", {
                        remaining: organization.seats_remaining ?? 0,
                        limit: organization.seat_limit,
                      })
                    : t("masterAdminOrganizations.unlimitedStatus")
                }
              />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.uploadsTotal")} value={organization.uploads_total} />
              <MasterAdminMetricCard label={t("masterAdminOrganizations.assessmentsTotal")} value={organization.assessments_total} />
            </MasterAdminMetricGrid>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdminOrganizations.privacyReadyTeachers")}
                </div>
                <div className="mt-1 text-sm text-slate-700">{organization.privacy_ready_teacher_count}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdminOrganizations.recentLogins30d")}
                </div>
                <div className="mt-1 text-sm text-slate-700">{organization.recent_logins_30d}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("masterAdminOrganizations.lastActivity")}
                </div>
                <div className="mt-1 text-sm text-slate-700">{organization.last_activity_at || "—"}</div>
              </div>
            </div>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <MemberList
              title={`${t("masterAdminOrganizations.activeAdmins")} (${admins.length})`}
              members={admins}
              emptyLabel={t("masterAdminOrganizations.noAdmins")}
              linkBase="/master-admin/users"
            />
            <MemberList
              title={`${t("masterAdminOrganizations.activeTeachers")} (${teachers.length})`}
              members={teachers}
              emptyLabel={t("masterAdminOrganizations.noTeachers")}
              linkBase="/master-admin/users"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <MemberList
              title={`${t("masterAdminOrganizations.pendingUsers")} (${pendingUsers.length})`}
              members={pendingUsers}
              emptyLabel={t("masterAdminOrganizations.noPendingUsers")}
              linkBase="/master-admin/users"
            />
            <Panel className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("masterAdminOrganizations.schoolsTitle")}</h2>
                <p className="text-sm text-slate-500">{t("masterAdminOrganizations.schoolsDescription")}</p>
              </div>
              {schools.length ? (
                <div className="space-y-3">
                  {schools.map((school) => (
                    <div key={school.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-semibold text-slate-900">{school.name}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {school.district_name || organization.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{school.id}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title={t("masterAdminOrganizations.noSchools")} message="" />
              )}
            </Panel>
          </div>
        </>
      ) : null}
    </MasterAdminPageScaffold>
  );
}
