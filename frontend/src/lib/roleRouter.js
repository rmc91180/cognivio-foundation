function normalizeRole(user) {
  const tenantRole = String(user?.tenant_role || "").trim().toLowerCase();
  const legacyRole = String(user?.role || "").trim().toLowerCase();
  const role = tenantRole || legacyRole;

  if (role === "master_admin" || role === "super_admin") {
    return "master_admin";
  }

  if (role === "training_admin") {
    return "training_admin";
  }

  if (role === "school_admin" || role === "admin" || role === "principal") {
    return "school_admin";
  }

  return "teacher";
}

function normalizePath(routePath) {
  const [withoutHash] = String(routePath || "/").split("#");
  const [pathname] = withoutHash.split("?");
  return pathname.replace(/\/+$/, "") || "/";
}

function matchesRoute(pathname, route) {
  const routePath = normalizePath(route.path);

  if (route.exact) {
    return pathname === routePath;
  }

  return pathname === routePath || pathname.startsWith(`${routePath}/`);
}

const ROUTE_ACCESS = {
  master: [{ path: "/master-admin" }],
  admin: [
    { path: "/dashboard", exact: true },
    { path: "/teachers" },
    { path: "/videos" },
    { path: "/privacy-review" },
    { path: "/recognition-review" },
    { path: "/ops/metrics" },
    { path: "/all-star-library" },
    { path: "/school-setup" },
    { path: "/master-schedule" },
    { path: "/observation" },
    { path: "/record", exact: true },
  ],
  training: [
    { path: "/dashboard", exact: true },
    { path: "/dashboard/training", exact: true },
    { path: "/teachers" },
    { path: "/videos" },
    { path: "/all-star-library" },
    { path: "/master-schedule" },
    { path: "/observation" },
    { path: "/record", exact: true },
  ],
  teacher: [
    { path: "/my-workspace" },
    { path: "/videos" },
    { path: "/all-star-library" },
  ],
};

const ROUTE_DENIALS = {
  admin: [/^\/teachers\/[^/]+\/operations(?:\/|$)/],
  training: [/^\/teachers\/[^/]+\/operations(?:\/|$)/],
};

export function getHomeRoute(user) {
  const role = normalizeRole(user);

  if (role === "master_admin") {
    return "/master-admin";
  }

  if (role === "school_admin" || role === "training_admin") {
    return "/dashboard";
  }

  return "/my-workspace";
}

export function getRoleShell(user) {
  const role = normalizeRole(user);

  if (role === "master_admin") {
    return "master";
  }

  if (role === "training_admin") {
    return "training";
  }

  if (role === "school_admin") {
    return "admin";
  }

  return "teacher";
}

export function canAccess(user, routePath) {
  if (!user) {
    return false;
  }

  const shell = getRoleShell(user);
  const pathname = normalizePath(routePath);
  const deniedRoutes = ROUTE_DENIALS[shell] || [];
  const allowedRoutes = ROUTE_ACCESS[shell] || [];

  if (deniedRoutes.some((routePattern) => routePattern.test(pathname))) {
    return false;
  }

  return allowedRoutes.some((route) => matchesRoute(pathname, route));
}
