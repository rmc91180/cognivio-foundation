import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

const ITEMS = [
  { to: "/master-admin", key: "overview" },
  { to: "/master-admin/users", key: "users" },
  { to: "/master-admin/workspaces", key: "workspaces" },
  { to: "/master-admin/videos", key: "videos" },
  { to: "/master-admin/storage", key: "storage" },
  { to: "/master-admin/dependencies", key: "dependencies" },
  { to: "/master-admin/ai-quality", key: "aiQuality" },
  { to: "/master-admin/incidents", key: "incidents" },
  { to: "/master-admin/support", key: "support" },
  { to: "/master-admin/auth-activity", key: "auth" },
  { to: "/master-admin/audit", key: "audit" },
];

export function MasterAdminSectionNav() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/master-admin"}
          className={({ isActive }) =>
            [
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
            ].join(" ")
          }
        >
          {t(`masterAdmin.nav.${item.key}`)}
        </NavLink>
      ))}
    </div>
  );
}
