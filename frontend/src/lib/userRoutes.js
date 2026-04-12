const ADMIN_ROLES = new Set(["admin", "principal", "super_admin"]);

export function isAdminUser(user) {
  return ADMIN_ROLES.has(user?.role);
}

export function isSuperAdminUser(user) {
  return user?.role === "super_admin";
}

export function getDefaultHomeRoute(user) {
  if (isSuperAdminUser(user)) {
    return "/master-admin";
  }
  return isAdminUser(user) ? "/dashboard" : "/my-workspace";
}
