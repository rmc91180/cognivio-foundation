export const ROLE = {
  SUPER_ADMIN: "super_admin",
  SCHOOL_ADMIN: "school_admin",
  TRAINING_ADMIN: "training_admin",
  TEACHER: "teacher",
  GUEST: "guest",
};

export function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizePath(value) {
  const path = String(value || "").trim();
  if (!path) return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash === "/" ? withSlash : withSlash.replace(/\/+$/, "");
}

export function getUserTenantRole(user) {
  if (!user) return ROLE.GUEST;

  const tenantRole = normalizeRole(user.tenant_role || user.tenantRole);
  const legacyRole = normalizeRole(user.role);
  const email = String(user.email || "").trim().toLowerCase();

  if (
    tenantRole === ROLE.SUPER_ADMIN ||
    legacyRole === ROLE.SUPER_ADMIN ||
    email === "rmc91180@gmail.com"
  ) {
    return ROLE.SUPER_ADMIN;
  }

  if (tenantRole === ROLE.TRAINING_ADMIN || legacyRole === ROLE.TRAINING_ADMIN) {
    return ROLE.TRAINING_ADMIN;
  }

  if (
    tenantRole === ROLE.SCHOOL_ADMIN ||
    tenantRole === "admin" ||
    tenantRole === "principal" ||
    legacyRole === ROLE.SCHOOL_ADMIN ||
    legacyRole === "admin" ||
    legacyRole === "principal"
  ) {
    return ROLE.SCHOOL_ADMIN;
  }

  if (tenantRole === ROLE.TEACHER || legacyRole === ROLE.TEACHER) {
    return ROLE.TEACHER;
  }

  return ROLE.TEACHER;
}

export function isSuperAdminUser(user) {
  return getUserTenantRole(user) === ROLE.SUPER_ADMIN;
}

export function isSchoolAdminUser(user) {
  return getUserTenantRole(user) === ROLE.SCHOOL_ADMIN;
}

export function isTrainingAdminUser(user) {
  return getUserTenantRole(user) === ROLE.TRAINING_ADMIN;
}

export function isTeacherUser(user) {
  return getUserTenantRole(user) === ROLE.TEACHER;
}

export function isAdminUser(user) {
  return isSchoolAdminUser(user) || isTrainingAdminUser(user) || isSuperAdminUser(user);
}

export function getDashboardHomeRoute(user) {
  if (isSchoolAdminUser(user) || isTrainingAdminUser(user)) {
    return "/dashboard";
  }

  if (isSuperAdminUser(user)) {
    return "/master-admin";
  }

  return "/my-workspace";
}

export function getDefaultHomeRoute(user) {
  if (isSuperAdminUser(user)) {
    return "/master-admin";
  }

  if (isSchoolAdminUser(user) || isTrainingAdminUser(user)) {
    return "/dashboard";
  }

  if (isTeacherUser(user)) {
    return "/my-workspace";
  }

  return "/login";
}

export function getAllowedTenantRoles(user) {
  const role = getUserTenantRole(user);
  return role === ROLE.GUEST ? [] : [role];
}

export function canAccessTenantRole(user, allowedTenantRoles = []) {
  const allowed = Array.isArray(allowedTenantRoles) ? allowedTenantRoles : [];

  if (!allowed.length) {
    return true;
  }

  if (!user) {
    return false;
  }

  if (isSuperAdminUser(user)) {
    return true;
  }

  return allowed.includes(getUserTenantRole(user));
}

export function isAuthRoute(path) {
  const currentPath = normalizePath(path).toLowerCase();

  return (
    currentPath === "/login" ||
    currentPath.startsWith("/request-access") ||
    currentPath.startsWith("/forgot-password") ||
    currentPath.startsWith("/reset-password")
  );
}

export function isPublicRoute(path) {
  return isAuthRoute(path);
}