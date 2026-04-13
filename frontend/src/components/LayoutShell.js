import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui";
import {
  getDashboardHomeRoute,
  getUserTenantRole,
  isAdminUser,
  isSchoolAdminUser,
  isSuperAdminUser,
  isTrainingAdminUser,
} from "@/lib/userRoutes";
import { clearPreviewSession } from "@/lib/previewMode";

export function LayoutShell({ children }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, refreshUser } = useAuth();
  const isAdmin = isAdminUser(user);
  const isSuperAdmin = isSuperAdminUser(user);
  const isSchoolAdmin = isSchoolAdminUser(user);
  const isTrainingAdmin = isTrainingAdminUser(user);
  const tenantRole = getUserTenantRole(user);
  const dashboardHomeRoute = getDashboardHomeRoute(user);
  const isPreviewMode = Boolean(user?.is_preview_mode);

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
        <nav className="mt-5 space-y-1.5 px-3 text-sm">
          {isSuperAdmin ? (
            <div className="mb-3">
              <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("nav.platformBackend")}
              </div>
              <NavItem to="/master-admin" icon={ShieldCheck} label={t("nav.masterAdmin")} />
              <div className="mt-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("nav.operationalAccess")}
              </div>
              <NavItem to="/teachers" icon={Users} label={t("nav.teachers")} />
              <NavItem to="/videos" icon={PlayCircle} label={t("nav.videos")} />
              <NavItem to="/privacy-review" icon={ShieldCheck} label={t("nav.privacyReview")} />
            </div>
          ) : null}
          {isAdmin ? (
            <>
              <NavItem
                to={dashboardHomeRoute}
                icon={LayoutDashboard}
                label={isTrainingAdmin ? t("nav.trainingDashboard") : t("nav.dashboard")}
              />
              <NavItem
                to="/teachers"
                icon={Users}
                label={isTrainingAdmin ? t("nav.trainingParticipants") : t("nav.teachers")}
              />
              <NavItem to="/videos" icon={PlayCircle} label={t("nav.videos")} />
              <NavItem to="/all-star-library" icon={BookOpen} label={t("nav.allStarLibrary")} />
              {isSchoolAdmin ? (
                <>
                  <NavItem to="/privacy-review" icon={ShieldCheck} label={t("nav.privacyReview")} />
                  <NavItem to="/recognition-review" icon={Trophy} label={t("nav.recognitionReview")} />
                  <NavItem to="/school-setup" icon={Layers} label={t("nav.schoolSetup")} />
                </>
              ) : null}
            </>
          ) : (
            <>
              <NavItem to="/my-workspace" icon={LayoutDashboard} label={t("nav.myWorkspace")} />
              <NavItem to="/videos" icon={PlayCircle} label={t("nav.myVideos")} />
              <NavItem to="/my-workspace/materials" icon={BookOpen} label={t("nav.myMaterials")} />
              <NavItem to="/my-workspace/goals" icon={ClipboardList} label={t("nav.myGoals")} />
              <NavItem to="/my-workspace/reflections" icon={MessageSquareText} label={t("nav.myReflections")} />
              <NavItem to="/my-workspace/history" icon={History} label={t("nav.myHistory")} />
            </>
          )}
        </nav>
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
            </div>
          ) : (
            <span>{t("nav.notAuthenticated")}</span>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-slate-50">
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

function NavItem({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
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

