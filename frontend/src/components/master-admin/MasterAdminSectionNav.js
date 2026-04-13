import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui";

const GROUPS = [
  {
    label: "Command center",
    items: [
      { to: "/master-admin", key: "overview", caption: "Platform pulse and active risk." },
      { to: "/master-admin/users?approval_status=pending", key: "approvals", caption: "Pending access requests awaiting master-admin review." },
      { to: "/master-admin/users", key: "users", caption: "Global user lifecycle and access." },
      { to: "/master-admin/organizations", key: "institutions", caption: "Institution identity, seat caps, and usage." },
      { to: "/master-admin/workspaces", key: "workspaces", caption: "Workspace health and linkage." },
      { to: "/master-admin/videos", key: "videos", caption: "Uploads, processing, and playback." },
      { to: "/master-admin/incidents", key: "incidents", caption: "Current failures and investigations." },
    ],
  },
  {
    label: "Systems",
    items: [
      { to: "/master-admin/storage", key: "storage", caption: "R2 usage, cleanup, and retention." },
      { to: "/master-admin/dependencies", key: "dependencies", caption: "Atlas, R2, email, AI, and hosting." },
      { to: "/master-admin/ai-quality", key: "aiQuality", caption: "Overrides, feedback, and specialist traces." },
      { to: "/master-admin/support", key: "support", caption: "Support workflow and diagnostic export." },
    ],
  },
  {
    label: "Security and audit",
    items: [
      { to: "/master-admin/auth-activity", key: "auth", caption: "Login history and approval activity." },
      { to: "/master-admin/audit", key: "audit", caption: "Who changed what, and why." },
    ],
  },
];

export function MasterAdminSectionNav() {
  const { t } = useTranslation();

  return (
    <Panel className="border-slate-200 bg-white">
      <div className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {group.label}
            </div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/master-admin"}
                  className={({ isActive }) =>
                    [
                      "block rounded-2xl border px-4 py-3 transition-colors",
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="text-sm font-semibold">{t(`masterAdmin.nav.${item.key}`)}</div>
                      <div className={["mt-1 text-xs leading-5", isActive ? "text-slate-300" : "text-slate-500"].join(" ")}>
                        {item.caption}
                      </div>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
