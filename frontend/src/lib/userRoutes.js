import { getHomeRoute } from "@/lib/roleRouter";

function normalizeTenantRole(user) {
  const tenantRole = String(user?.tenant_role || "").trim().toLowerCase();
  if (tenantRole === "master_admin") return "super_admin";
  if (tenantRole) return tenantRole;

  const legacyRole = String(user?.role || "").trim().toLowerCase();
  if (legacyRole === "master_admin" || legacyRole === "super_admin") return "super_admin";
  if (legacyRole === "admin" || legacyRole === "principal") return "school_admin";
  return "teacher";
}

export function getUserTenantRole(user) {
  return normalizeTenantRole(user);
}

export function isSuperAdminUser(user) {
  return normalizeTenantRole(user) === "super_admin";
}

export function isSchoolAdminUser(user) {
  return normalizeTenantRole(user) === "school_admin";
}

export function isTrainingAdminUser(user) {
  return normalizeTenantRole(user) === "training_admin";
}

export function isTeacherUser(user) {
  return normalizeTenantRole(user) === "teacher";
}

export function isAdminUser(user) {
  return isSchoolAdminUser(user) || isTrainingAdminUser(user) || isSuperAdminUser(user);
}

export function getDashboardHomeRoute() {
  return "/dashboard";
}

export function canAccessTenantRole(user, allowedTenantRoles = []) {
  if (!allowedTenantRoles?.length) return true;
  if (isSuperAdminUser(user)) return true;
  return allowedTenantRoles.includes(normalizeTenantRole(user));
}

export function getDefaultHomeRoute(user) {
  return getHomeRoute(user);
}
