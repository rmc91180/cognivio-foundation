import {
  ROLE,
  canAccessTenantRole,
  getDefaultHomeRoute,
  getUserTenantRole,
  isAdminUser,
  isSchoolAdminUser,
  isSuperAdminUser,
  isTeacherUser,
  isTrainingAdminUser,
  normalizePath,
} from "@/lib/userRoutes";

const ADMIN_ROUTES = [
  "/dashboard",
  "/teachers",
  "/coaching",
  "/master-schedule",
  "/my-insights",
  "/observation",
  "/record",
  "/reports",
  "/videos",
  "/all-star-library",
  "/school-setup",
  "/privacy-review",
  "/recognition-review",
  "/ops",
  "/settings/notifications",
  "/notifications",
  "/onboarding",
];

const TRAINING_ROUTES = [
  "/dashboard",
  "/teachers",
  "/cohorts",
  "/coaching",
  "/master-schedule",
  "/my-insights",
  "/observation",
  "/record",
  "/reports",
  "/videos",
  "/all-star-library",
  "/settings/notifications",
  "/notifications",
  "/onboarding",
];

const TEACHER_ROUTES = [
  "/my-workspace",
  "/my-profile",
  "/my-badges",
  "/videos",
  "/record",
  "/all-star-library",
  "/settings/notifications",
  "/notifications",
  "/consent",
  "/privacy",
];

const SUPER_ADMIN_ROUTES = [
  "/master-admin",
  "/onboarding",
  "/teachers",
  "/my-insights",
  "/settings/notifications",
  "/notifications",
];

const PUBLIC_ROUTES = [
  "/login",
  "/request-access",
  "/forgot-password",
  "/reset-password",
  "/privacy",
];

const startsWithAny = (path, prefixes) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export const getUserRole = (user) => getUserTenantRole(user);

export const isSuperAdmin = (user) => isSuperAdminUser(user);

export const isAdmin = (user) => isAdminUser(user);

export const isTeacher = (user) => isTeacherUser(user);

export const getHomeRoute = (user) => getDefaultHomeRoute(user);

export const getDefaultRouteForUser = getDefaultHomeRoute;

export const getRoleHomePath = getDefaultHomeRoute;

export const getRoleShell = (user) => {
  const role = getUserTenantRole(user);

  if (role === ROLE.SUPER_ADMIN) return "master";
  if (role === ROLE.TRAINING_ADMIN) return "training";
  if (role === ROLE.SCHOOL_ADMIN) return "admin";
  if (role === ROLE.TEACHER) return "teacher";
  return "teacher";
};

export const getEffectiveWorkspaceMode = (user) => {
  const role = getUserTenantRole(user);

  if (role === ROLE.SUPER_ADMIN) return "master";
  if (role === ROLE.TRAINING_ADMIN) return "training";
  if (role === ROLE.SCHOOL_ADMIN) return "school";
  return "teacher";
};

export const canAccess = (user, routePath = "", allowedTenantRoles = []) => {
  const path = normalizePath(routePath).toLowerCase();

  if (path === "/") {
    return Boolean(user);
  }

  if (startsWithAny(path, PUBLIC_ROUTES)) {
    return true;
  }

  if (!user) {
    return false;
  }

  if (Array.isArray(allowedTenantRoles) && allowedTenantRoles.length > 0) {
    if (
      isSuperAdminUser(user) &&
      !allowedTenantRoles.includes(ROLE.SUPER_ADMIN) &&
      !user?.is_preview_mode
    ) {
      return startsWithAny(path, SUPER_ADMIN_ROUTES);
    }
    return canAccessTenantRole(user, allowedTenantRoles);
  }

  if (isSuperAdminUser(user)) {
    return startsWithAny(path, SUPER_ADMIN_ROUTES);
  }

  if (isSchoolAdminUser(user)) {
    return startsWithAny(path, ADMIN_ROUTES);
  }

  if (isTrainingAdminUser(user)) {
    return startsWithAny(path, TRAINING_ROUTES);
  }

  if (isTeacherUser(user)) {
    return startsWithAny(path, TEACHER_ROUTES);
  }

  return false;
};

export const canAccessRoute = canAccess;

export const getRoleShellConfig = (user) => {
  const role = getUserTenantRole(user);

  if (role === ROLE.SUPER_ADMIN) {
    return {
      role,
      navKey: getRoleShell(user),
      homeRoute: "/master-admin",
      dashboardRoute: "/master-admin",
      label: "Master Admin",
      navItems: [
        { label: "Dashboard", to: "/master-admin" },
        { label: "Organizations", to: "/master-admin/organizations" },
        { label: "Users", to: "/master-admin/users" },
      ],
    };
  }

  if (role === ROLE.TRAINING_ADMIN) {
    return {
      role,
      navKey: getRoleShell(user),
      homeRoute: "/dashboard",
      dashboardRoute: "/dashboard",
      label: "Training Admin",
      navItems: [
        { label: "Dashboard", to: "/dashboard" },
        { label: "Cohorts", to: "/cohorts" },
        { label: "Trainees", to: "/teachers" },
      ],
    };
  }

  if (role === ROLE.SCHOOL_ADMIN) {
    return {
      role,
      navKey: getRoleShell(user),
      homeRoute: "/dashboard",
      dashboardRoute: "/dashboard",
      label: "School Admin",
      navItems: [
        { label: "Dashboard", to: "/dashboard" },
        { label: "Teachers", to: "/teachers" },
        { label: "Reports", to: "/reports" },
      ],
    };
  }

  if (role === ROLE.TEACHER) {
    return {
      role,
      navKey: getRoleShell(user),
      homeRoute: "/my-workspace",
      dashboardRoute: "/my-workspace",
      label: "Teacher",
      navItems: [
        { label: "My Workspace", to: "/my-workspace" },
        { label: "My Lessons", to: "/my-lessons" },
        { label: "My Coaching", to: "/my-workspace/coaching" },
      ],
    };
  }

  return {
    role: ROLE.GUEST,
    navKey: "guest",
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
  getRoleShell,
  getRoleShellConfig,
  getEffectiveWorkspaceMode,
  canAccess,
  canAccessRoute,
};

export default roleRouter;
