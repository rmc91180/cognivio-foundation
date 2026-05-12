import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { RoleMismatchPage } from "@/pages/RoleMismatchPage";
import { canAccess, getHomeRoute } from "@/lib/roleRouter";
import { consentApi, onboardingApi } from "@/lib/api";
import { getUserTenantRole } from "@/lib/userRoutes";

export function ProtectedRoute({ children }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, initializing } = useAuth();
  const tenantRole = getUserTenantRole(user);
  const onboardingQuery = useQuery({
    queryKey: ["protected-onboarding-status"],
    enabled: Boolean(user) && ["school_admin", "training_admin"].includes(tenantRole) && location.pathname !== "/onboarding",
    queryFn: () => onboardingApi.status().then((res) => res.data),
    staleTime: 60_000,
  });
  const consentQuery = useQuery({
    queryKey: ["protected-consent-status"],
    enabled: Boolean(user) && tenantRole === "teacher" && !["/consent", "/privacy"].includes(location.pathname),
    queryFn: () => consentApi.status().then((res) => res.data),
    staleTime: 60_000,
  });

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

  if (
    ["school_admin", "training_admin"].includes(tenantRole) &&
    location.pathname !== "/onboarding" &&
    onboardingQuery.data &&
    !onboardingQuery.data.is_complete
  ) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  if (
    tenantRole === "teacher" &&
    !["/consent", "/privacy"].includes(location.pathname) &&
    consentQuery.data &&
    !consentQuery.data.all_granted
  ) {
    return <Navigate to="/consent" replace state={{ from: location.pathname }} />;
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

