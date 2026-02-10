import React from "react";
import { Link, NavLink } from "react-router-dom";
import { Layers, LayoutDashboard, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function LayoutShell({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-64 border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center justify-between px-4 border-b border-slate-200">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold">
              Co
            </span>
            <span className="font-heading text-lg font-semibold tracking-tight text-slate-900">
              Cognivio
            </span>
          </Link>
        </div>
        <nav className="mt-4 space-y-1 px-2 text-sm">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/teachers" icon={Users} label="Teachers" />
          <NavItem to="/videos" icon={PlayCircle} label="Videos & Assessments" />
          <NavItem to="/frameworks" icon={Layers} label="Frameworks" />
        </nav>
        <div className="mt-auto border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
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
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
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
          "flex items-center gap-2 rounded-md px-3 py-2 transition-colors",
          isActive
            ? "bg-slate-100 text-slate-900"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        ].join(" ")
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

