import React from "react";
import { NavLink } from "react-router-dom";
import { Layers, LayoutDashboard, PlayCircle, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";

export function LayoutShell({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-72 border-r border-slate-200 bg-white/95 backdrop-blur-sm shadow-panel flex flex-col">
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-200">
          <BrandMark to="/" />
        </div>
        <nav className="mt-5 space-y-1.5 px-3 text-sm">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/teachers" icon={Users} label="Teachers" />
          <NavItem to="/videos" icon={PlayCircle} label="Videos & Assessments" />
          <NavItem to="/school-setup" icon={Layers} label="School Setup" />
        </nav>
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
                Logout
              </button>
            </div>
          ) : (
            <span>Not authenticated</span>
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

