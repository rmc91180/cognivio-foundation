import React from "react";
import { useMutation } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { BookOpen, Layers, LayoutDashboard, PlayCircle, ShieldCheck, Trophy, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@/lib/api";
import { toast } from "sonner";

export function LayoutShell({ children }) {
  const { t } = useTranslation();
  const { user, logout, setUserProfile } = useAuth();
  const isAdmin = ["admin", "principal", "super_admin"].includes(user?.role);
  const workspaceMode = user?.workspace_mode || "school";
  const workspaceModeMutation = useMutation({
    mutationFn: (payload) => authApi.setWorkspaceMode(payload),
    onSuccess: (res) => {
      setUserProfile({
        ...user,
        workspace_mode: res.data.effective_mode,
      });
      toast.success(t("nav.workspaceModeUpdated"));
    },
    onError: () => {
      toast.error(t("nav.workspaceModeUpdateFailed"));
    },
  });

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-72 border-r border-slate-200 bg-white/95 backdrop-blur-sm shadow-panel flex flex-col">
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-200">
          <BrandMark to="/" />
          <LanguageSwitcher compact />
        </div>
        <nav className="mt-5 space-y-1.5 px-3 text-sm">
          <NavItem to="/dashboard" icon={LayoutDashboard} label={t("nav.dashboard")} />
          <NavItem to="/teachers" icon={Users} label={t("nav.teachers")} />
          <NavItem to="/videos" icon={PlayCircle} label={t("nav.videos")} />
          <NavItem to="/all-star-library" icon={BookOpen} label={t("nav.allStarLibrary")} />
          {isAdmin && <NavItem to="/privacy-review" icon={ShieldCheck} label={t("nav.privacyReview")} />}
          {isAdmin && <NavItem to="/recognition-review" icon={Trophy} label={t("nav.recognitionReview")} />}
          <NavItem to="/school-setup" icon={Layers} label={t("nav.schoolSetup")} />
        </nav>
        {isAdmin && (
          <div className="mx-3 mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("nav.workspaceMode")}
            </div>
            <select
              value={workspaceMode}
              onChange={(e) =>
                workspaceModeMutation.mutate({
                  mode: e.target.value,
                  set_org_default: true,
                })
              }
              disabled={workspaceModeMutation.isPending}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700"
            >
              <option value="school">{t("nav.workspaceModeSchool")}</option>
              <option value="training">{t("nav.workspaceModeTraining")}</option>
            </select>
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

