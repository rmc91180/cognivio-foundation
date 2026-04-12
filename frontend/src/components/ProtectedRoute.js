import React from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getDefaultHomeRoute, isAdminUser, isSuperAdminUser } from "@/lib/userRoutes";

export function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { t } = useTranslation();
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

  if (superAdminOnly && !isSuperAdminUser(user)) {
    return <Navigate to={getDefaultHomeRoute(user)} replace />;
  }

  if (adminOnly && !isAdminUser(user)) {
    return <Navigate to={getDefaultHomeRoute(user)} replace />;
  }

  return children;
}

