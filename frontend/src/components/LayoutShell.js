import React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardList,
  Database,
  History,
  Layers,
  LayoutDashboard,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Button } from "@/components/ui";
import { masterAdminApi } from "@/lib/api";
import {
  getUserTenantRole,
  isSchoolAdminUser,
  isSuperAdminUser,
  isTrainingAdminUser,
} from "@/lib/userRoutes";
import { getRoleShell } from "@/lib/roleRouter";
import { clearPreviewSession } from "@/lib/previewMode";

const ROLE_NAV_ITEMS = {
  master: [
    { to: "/master-admin/organizations", icon: Database, label: "Organizations" },
    { to: "/master-admin/users", icon: Users, label: "Users" },
    { to: "/master-admin/videos", icon: PlayCircle, label: "Videos" },
    { to: "/master-admin/audit", icon: ClipboardList, label: "Audit" },
    { to: "/master-admin/incidents", icon: History, label: "Incidents" },
    { to: "/master-admin/storage", icon: Database, label: "Storage" },
    { to: "/master-admin/support", icon: MessageSquareText, label: "Support" },
    { to: "/master-admin", icon: ShieldCheck, label: "Ops", end: true },
  ],
  admin: [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", end: true },
    { to: "/teachers", icon: Users, label: "Teachers" },
    { to: "/master-schedule", icon: ClipboardList, label: "Schedule" },
    { to: "/teachers?focus=coaching", icon: MessageSquareText, label: "Coaching" },
    { to: "/my-insights", icon: Target, label: "My Insights" },
    { to: "/recognition-review", icon: Trophy, label: "Recognition" },
    { to: "/reports", icon: BookOpen, label: "Reports" },
    { to: "/school-setup", icon: Layers, label: "Settings" },
  ],
  training: [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", end: true },
    { to: "/cohorts", icon: Layers, label: "Cohorts" },
    { to: "/teachers", icon: Users, label: "Trainees" },
    { to: "/master-schedule", icon: ClipboardList, label: "Schedule" },
    { to: "/my-insights", icon: Target, label: "My Insights" },
    { to: "/reports", icon: BookOpen, label: "Reports" },
    { to: "/dashboard?view=settings", icon: Layers, label: "Settings" },
  ],
  teacher: [
    { to: "/my-workspace", icon: LayoutDashboard, label: "My Workspace", end: true },
    { to: "/videos", icon: PlayCircle, label: "My Lessons" },
    { to: "/my-workspace/coaching", icon: MessageSquareText, label: "My Coaching" },
    { to: "/my-badges", icon: Trophy, label: "My Recognition" },
    { to: "/my-workspace/settings", icon: Layers, label: "Settings" },
  ],
};

export function LayoutShell({ children }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, refreshUser } = useAuth();
  const roleShell = getRoleShell(user);
  const isSuperAdmin = isSuperAdminUser(user);
  const isSchoolAdmin = isSchoolAdminUser(user);
  const isTrainingAdmin = isTrainingAdminUser(user);
  const tenantRole = getUserTenantRole(user);
  const isPreviewMode = Boolean(user?.is_preview_mode);
  const navItems = ROLE_NAV_ITEMS[roleShell] || [];

  const organizationListQuery = useQuery({
    queryKey: ["layout-shell-master-admin-organizations"],
    queryFn: () => masterAdminApi.organizations({ limit: 200, offset: 0 }).then((res) => res.data),
    enabled: isSuperAdmin,
    staleTime: 60_000,
  });

  const organizationItems = organizationListQuery.data?.items || [];

  const organizationDetailQueries = useQueries({
    queries: isSuperAdmin
      ? organizationItems.map((organization) => ({
          queryKey: ["layout-shell-master-admin-organization-detail", organization.id],
          queryFn: () => masterAdminApi.organizationDetail(organization.id).then((res) => res.data),
          staleTime: 60_000,
        }))
      : [],
  });

  const organizationTree = React.useMemo(
    () =>
      organizationItems.map((organization, index) => {
        const detailQuery = organizationDetailQueries[index];
        const activeUsers = detailQuery?.data?.related?.active_users || [];
        const administrators = activeUsers.filter((member) =>
          ["school_admin", "training_admin", "super_admin", "admin"].includes(member.tenant_role)
        );
        const teachers = activeUsers.filter((member) => member.tenant_role === "teacher");
        return {
          organization,
          loading: Boolean(detailQuery?.isLoading || detailQuery?.isFetching),
          error: Boolean(detailQuery?.isError),
          administrators,
          teachers,
        };
      }),
    [organizationItems, organizationDetailQueries]
  );

  const exitPreviewMode = async () => {
    clearPreviewSession();
    queryClient.clear();
    try {
      await refreshUser();
    } catch {
      return;
    }
    navigate("/master-admin", { replace: true });
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-72 border-r border-slate-200 bg-white/95 backdrop-blur-sm shadow-panel flex flex-col">
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-200">
          <BrandMark to="/" />
          <LanguageSwitcher compact />
        </div>
        <div className="mt-5 flex-1 overflow-y-auto px-3">
          <nav className="space-y-1.5 text-sm">
            {navItems.map((item) => (
              <NavItem
                key={`${item.to}-${item.label}`}
                to={item.to}
                icon={item.icon}
                label={item.label}
                end={item.end}
              />
            ))}
          </nav>

          {isSuperAdmin ? (
            <div className="mt-5 space-y-3 pb-4">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("nav.organizationDirectory")}
              </div>
              {organizationListQuery.isLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {t("nav.organizationsLoading")}
                </div>
              ) : null}
              {organizationListQuery.isError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {t("nav.organizationsLoadFailed")}
                </div>
              ) : null}
              {!organizationListQuery.isLoading && !organizationTree.length ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {t("nav.organizationsEmpty")}
                </div>
              ) : null}
              {organizationTree.map((entry) => (
                <div key={entry.organization.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                  <NavLink
                    to={`/master-admin/organizations/${entry.organization.id}`}
                    className="block rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-800 hover:bg-white"
                  >
                    {entry.organization.name}
                  </NavLink>
                  <div className="px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    {entry.organization.organization_type === "training"
                      ? t("nav.trainingAdminScope")
                      : t("nav.schoolAdminScope")}
                  </div>
                  {entry.loading ? (
                    <div className="mt-2 px-2 text-xs text-slate-500">{t("nav.organizationsLoading")}</div>
                  ) : null}
                  {entry.error ? (
                    <div className="mt-2 px-2 text-xs text-rose-700">{t("nav.organizationsLoadFailed")}</div>
                  ) : null}
                  {!entry.loading && !entry.error ? (
                    <div className="mt-2 space-y-2 px-2">
                      <RoleMemberList
                        title={t("nav.organizationAdmins")}
                        members={entry.administrators}
                        emptyLabel={t("nav.organizationNoAdmins")}
                      />
                      <RoleMemberList
                        title={t("nav.organizationTeachers")}
                        members={entry.teachers}
                        emptyLabel={t("nav.organizationNoTeachers")}
                      />
                      <NavLink
                        to={`/master-admin/organizations/${entry.organization.id}`}
                        className="block pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary hover:text-primary/80"
                      >
                        {t("nav.openOrganization")}
                      </NavLink>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {isSchoolAdmin && (
          <div className="mx-3 mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
              {t("nav.schoolAdminScope")}
            </div>
            <div className="mt-2 text-xs text-sky-800">
              {t("nav.schoolAdminScopeDescription")}
            </div>
          </div>
        )}
        {isTrainingAdmin && (
          <div className="mx-3 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              {t("nav.trainingAdminScope")}
            </div>
            <div className="mt-2 text-xs text-emerald-800">
              {t("nav.trainingAdminScopeDescription")}
            </div>
          </div>
        )}
        <div className="mt-auto border-t border-slate-200 px-4 py-3 text-xs text-slate-500 bg-slate-50/70">
          {user ? (
            <div className="flex items-center justify-between gap-2">
              <div className="truncate">
                <div className="font-medium text-slate-900 truncate">
                  {user.name}
                </div>
                <div className="truncate text-slate-500">{user.email}</div>
                <div className="truncate text-[11px] text-slate-400">
                  {tenantRole === "school_admin"
                    ? t("nav.schoolAdminScope")
                    : tenantRole === "training_admin"
                      ? t("nav.trainingAdminScope")
                      : tenantRole === "teacher"
                        ? t("nav.teacherScope")
                        : t("nav.masterAdminScope")}
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-white"
              >
                {t("nav.logout")}
              </button>
              <NotificationBell />
            </div>
          ) : (
            <span>{t("nav.notAuthenticated")}</span>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <OfflineBanner />
        {isPreviewMode ? (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                  {t("nav.previewModeEyebrow")}
                </div>
                <div className="mt-1 text-sm text-amber-950">
                  {t("nav.previewModeDescription", {
                    name: user?.name || user?.email || t("nav.previewModeTargetFallback"),
                  })}
                </div>
                <div className="mt-1 text-xs text-amber-800">
                  {t("nav.previewModeReadOnly")}
                </div>
              </div>
              <Button type="button" variant="secondary" onClick={exitPreviewMode}>
                {t("nav.exitPreviewMode")}
              </Button>
            </div>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors",
          isActive
            ? "bg-primary/10 text-primary font-semibold border border-primary/20"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4 stroke-[2.25]" />
      <span>{label}</span>
    </NavLink>
  );
}

function RoleMemberList({ title, members, emptyLabel }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</div>
      {members.length ? (
        <div className="mt-1 space-y-1">
          {members.map((member) => (
            <NavLink
              key={member.id}
              to={`/master-admin/users/${member.id}`}
              className="block rounded-md px-1.5 py-1 text-xs text-slate-700 hover:bg-white hover:text-slate-900"
            >
              {member.name || member.email}
            </NavLink>
          ))}
        </div>
      ) : (
        <div className="mt-1 px-1.5 text-xs text-slate-500">{emptyLabel}</div>
      )}
    </div>
  );
}

