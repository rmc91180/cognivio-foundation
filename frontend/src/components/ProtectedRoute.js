import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { RoleMismatchPage } from "@/pages/RoleMismatchPage";
import { canAccess, getHomeRoute } from "@/lib/roleRouter";
import { consentApi } from "@/lib/api";
import {
  canAccessTenantRole,
  getUserTenantRole,
  isSuperAdminUser,
  normalizePath,
} from "@/lib/userRoutes";

const isSamePath = (left, right) => normalizePath(left) === normalizePath(right);

const loadingScreen = (message) => (
  <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-50">
    <div className="animate-pulse text-sm text-slate-400">{message}</div>
  </div>
);

function safeRedirect(to, currentPath, state = undefined) {
  const target = normalizePath(to);

  if (isSamePath(target, currentPath)) {
    return null;
  }

  return <Navigate to={target} replace state={state} />;
}

export function ProtectedRoute({
  children,
  superAdminOnly = false,
  allowedTenantRoles = [],
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, initializing, loading, isLoading } = useAuth();

  const currentPath = normalizePath(location.pathname);
  const tenantRole = getUserTenantRole(user);
  const authIsLoading = Boolean(initializing || loading || isLoading);

  const isConsentRoute = isSamePath(currentPath, "/consent");
  const isPrivacyRoute = isSamePath(currentPath, "/privacy");

  const consentQuery = useQuery({
    queryKey: ["protected-consent-status", user?.id],
    enabled:
      Boolean(user) &&
      tenantRole === "teacher" &&
      !isConsentRoute &&
      !isPrivacyRoute,
    queryFn: () => consentApi.status().then((res) => res.data),
    staleTime: 60_000,
    retry: 1,
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

  if (superAdminOnly && !isSuperAdminUser(user)) {
    const homeRoute = getHomeRoute(user);
    const redirect = safeRedirect(homeRoute, currentPath, {
      roleMismatch: true,
      attemptedPath: currentPath,
    });

    return redirect || <RoleMismatchPage user={user} currentRole={tenantRole} />;
  }

  if (
    Array.isArray(allowedTenantRoles) &&
    allowedTenantRoles.length > 0 &&
    !canAccessTenantRole(user, allowedTenantRoles)
  ) {
    const homeRoute = getHomeRoute(user);
    const redirect = safeRedirect(homeRoute, currentPath, {
      roleMismatch: true,
      attemptedPath: currentPath,
    });

    return redirect || <RoleMismatchPage user={user} currentRole={tenantRole} />;
  }

  if (
    tenantRole === "teacher" &&
    !isConsentRoute &&
    !isPrivacyRoute &&
    !consentQuery.isLoading &&
    !consentQuery.isFetching &&
    consentQuery.data &&
    consentQuery.data.all_granted === false
  ) {
    const redirect = safeRedirect("/consent", currentPath, { from: currentPath });
    return redirect || children;
  }

  if (!canAccess(user, currentPath, allowedTenantRoles)) {
    const homeRoute = getHomeRoute(user);
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn("Role route mismatch", {
        role: tenantRole,
        attemptedPath: currentPath,
        homeRoute,
      });
    }
    const redirect = safeRedirect(homeRoute, currentPath, {
      roleMismatch: true,
      attemptedPath: currentPath,
    });

    return redirect || <RoleMismatchPage user={user} currentRole={tenantRole} />;
  }

  if (location.state?.roleMismatch) {
    return <RoleMismatchPage user={user} currentRole={tenantRole} />;
  }

  return children;
}

export default ProtectedRoute;
