const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const normalizePath = (value) => {
  const path = String(value || "").trim();
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export const getUserRole = (user) => {
  if (!user) return "guest";

  const tenantRole = normalizeRole(user.tenant_role || user.tenantRole);
  const role = normalizeRole(user.role);

  if (tenantRole) return tenantRole;
  if (role) return role;

  return "guest";
};

export const isSuperAdmin = (user) => {
  const role = getUserRole(user);
  const email = String(user?.email || "").trim().toLowerCase();

  return (
    role === "super_admin" ||
    role === "master_admin" ||
    email === "rmc91180@gmail.com"
  );
};

export const isAdmin = (user) => {
  const role = getUserRole(user);

  return [
    "admin",
    "school_admin",
    "training_admin",
    "principal",
    "super_admin",
    "master_admin",
  ].includes(role);
};

export const isTeacher = (user) => {
  const role = getUserRole(user);
  return role === "teacher";
};

export const getHomeRoute = (user) => {
  const role = getUserRole(user);

  if (isSuperAdmin(user)) return "/master-admin";
  if (["school_admin", "training_admin", "admin", "principal"].includes(role)) {
    return "/admin";
  }
  if (role === "teacher") return "/teacher";

  return "/login";
};

export const getDefaultRouteForUser = getHomeRoute;
export const getRoleHomePath = getHomeRoute;

export const canAccess = (user, routePath = "") => {
  const path = normalizePath(routePath).toLowerCase();

  if (!path || path === "/") return true;
  if (
    path.startsWith("/login") ||
    path.startsWith("/request-access") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/reset-password") ||
    path.startsWith("/privacy") ||
    path.startsWith("/consent")
  ) {
    return true;
  }

  if (!user) return false;

  if (path.startsWith("/master-admin")) return isSuperAdmin(user);
  if (path.startsWith("/admin")) return isAdmin(user);
  if (path.startsWith("/teacher")) return isTeacher(user) || isAdmin(user);

  return true;
};

export const canAccessRoute = canAccess;

export const getRoleShell = (user) => {
  const role = getUserRole(user);

  if (isSuperAdmin(user)) {
    return {
      role: "super_admin",
      homeRoute: "/master-admin",
      dashboardRoute: "/master-admin",
      label: "Master Admin",
      navItems: [
        { label: "Dashboard", to: "/master-admin" },
        { label: "Organizations", to: "/master-admin/organizations" },
        { label: "Approvals", to: "/master-admin/access" },
      ],
    };
  }

  if (["school_admin", "training_admin", "admin", "principal"].includes(role)) {
    return {
      role,
      homeRoute: "/admin",
      dashboardRoute: "/admin",
      label: "Admin",
      navItems: [
        { label: "Dashboard", to: "/admin" },
        { label: "Teachers", to: "/admin/teachers" },
        { label: "Reports", to: "/admin/reports" },
      ],
    };
  }

  if (role === "teacher") {
    return {
      role: "teacher",
      homeRoute: "/teacher",
      dashboardRoute: "/teacher",
      label: "Teacher",
      navItems: [
        { label: "Dashboard", to: "/teacher" },
        { label: "My Videos", to: "/teacher/videos" },
        { label: "My Feedback", to: "/teacher/feedback" },
      ],
    };
  }

  return {
    role: "guest",
    homeRoute: "/login",
    dashboardRoute: "/login",
    label: "Guest",
    navItems: [],
  };
};

const roleRouter = {
  getUserRole,
  isSuperAdmin,
  isAdmin,
  isTeacher,
  getHomeRoute,
  getDefaultRouteForUser,
  getRoleHomePath,
  canAccess,
  canAccessRoute,
  getRoleShell,
};

export default roleRouter;