const ADMIN_ROLES = new Set(["admin", "principal", "super_admin"]);

export function isAdminUser(user) {
  return ADMIN_ROLES.has(user?.role);
}

export function getDefaultHomeRoute(user) {
  return isAdminUser(user) ? "/dashboard" : "/my-workspace";
}
