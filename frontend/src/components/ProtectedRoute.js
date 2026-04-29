import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { RoleMismatchPage } from "@/pages/RoleMismatchPage";
import { canAccess, getHomeRoute } from "@/lib/roleRouter";

export function ProtectedRoute({ children }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-50">
        <div className="animate-pulse text-sm text-slate-400">
          {t("protectedRoute.loadingWorkspace")}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccess(user, location.pathname)) {
    if (process.env.NODE_ENV === "development") {
      const role = user?.tenant_role || user?.role || "unknown";
      console.warn(`Role ${role} attempted to access ${location.pathname} — redirected`);
    }

    return (
      <Navigate
        to={getHomeRoute(user)}
        replace
        state={{ roleMismatch: true, attemptedPath: location.pathname }}
      />
    );
  }

  if (location.state?.roleMismatch) {
    return <RoleMismatchPage />;
  }

  return children;
}

