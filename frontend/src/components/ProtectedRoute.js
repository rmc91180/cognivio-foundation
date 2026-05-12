import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { RoleMismatchPage } from "@/pages/RoleMismatchPage";
import { canAccess, getHomeRoute } from "@/lib/roleRouter";
import { consentApi, onboardingApi } from "@/lib/api";
import { getUserTenantRole } from "@/lib/userRoutes";

const normalizePath = (value) => {
  const path = String(value || "").trim();
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const stripTrailingSlash = (value) => {
  const path = normalizePath(value);
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
};

const isSamePath = (left, right) =>
  stripTrailingSlash(left) === stripTrailingSlash(right);

const loadingScreen = (message) => (
  <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-50">
    <div className="animate-pulse text-sm text-slate-400">{message}</div>
  </div>
);

export function ProtectedRoute({ children }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, initializing, loading, isLoading } = useAuth();

  const currentPath = normalizePath(location.pathname);
  const tenantRole = getUserTenantRole(user);

  const authIsLoading = Boolean(initializing || loading || isLoading);

  const onboardingQuery = useQuery({
    queryKey: ["protected-onboarding-status", user?.id],
    enabled:
      Boolean(user) &&
      ["school_admin", "training_admin"].includes(tenantRole) &&
      !isSamePath(currentPath, "/onboarding"),
    queryFn: () => onboardingApi.status().then((res) => res.data),
    staleTime: 60_000,
  });

  const consentQuery = useQuery({
    queryKey: ["protected-consent-status", user?.id],
    enabled:
      Boolean(user) &&
      tenantRole === "teacher" &&
      !["/consent", "/privacy"].some((path) => isSamePath(currentPath, path)),
    queryFn: () => consentApi.status().then((res) => res.data),
    staleTime: 60_000,
  });

  if (authIsLoading) {
    return loadingScreen(t("protectedRoute.loadingWorkspace"));
  }

  if (!user) {
    if (isSamePath(currentPath, "/login")) {
      return children;
    }

    return (
      <Navigate
        to="/login"
        replace
        state={{ from: currentPath }}
      />
    );
  }

  if (
    ["school_admin", "training_admin"].includes(tenantRole) &&
    !isSamePath(currentPath, "/onboarding") &&
    onboardingQuery.data &&
    !onboardingQuery.data.is_complete
  ) {
    return (
      <Navigate
        to="/onboarding"
        replace
        state={{ from: currentPath }}
      />
    );
  }

  if (
    tenantRole === "teacher" &&
    !["/consent", "/privacy"].some((path) => isSamePath(currentPath, path)) &&
    consentQuery.data &&
    !consentQuery.data.all_granted
  ) {
    return (
      <Navigate
        to="/consent"
        replace
        state={{ from: currentPath }}
      />
    );
  }

  if (!canAccess(user, currentPath)) {
    const homeRoute = normalizePath(getHomeRoute(user));

    if (isSamePath(currentPath, homeRoute)) {
      return <RoleMismatchPage user={user} currentRole={tenantRole} />;
    }

    if (process.env.NODE_ENV === "development") {
      const role = user?.tenant_role || user?.role || "unknown";
      console.warn(`Role ${role} attempted to access ${currentPath} — redirected`);
    }

    return (
      <Navigate
        to={homeRoute}
        replace
        state={{ roleMismatch: true, attemptedPath: currentPath }}
      />
    );
  }

  if (location.state?.roleMismatch) {
    return <RoleMismatchPage user={user} currentRole={tenantRole} />;
  }

  return children;
}

export default ProtectedRoute;