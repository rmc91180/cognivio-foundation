import { isAdminUser } from "@/lib/userRoutes";

export function getActionPlanRoute(user, teacherId) {
  return isAdminUser(user) ? `/teachers/${teacherId}/action-plan` : "/my-workspace/goals";
}

export function getReflectionRoute(user, teacherId) {
  return isAdminUser(user) ? `/teachers/${teacherId}/reflections` : "/my-workspace/reflections";
}

export function getTeacherHomeRoute(user, teacherId) {
  return isAdminUser(user) ? `/teachers/${teacherId}` : "/my-workspace";
}

export function getMaterialsRoute(user, teacherId) {
  return isAdminUser(user) ? `/teachers/${teacherId}` : "/my-workspace/materials";
}

export function getConferenceRoute(user, teacherId) {
  return isAdminUser(user) ? `/teachers/${teacherId}` : "/my-workspace/goals";
}

export function resolveCoachingLink(user, teacherId, routeHint, payload = {}) {
  if (routeHint === "video") {
    return payload.videoId ? `/videos/${payload.videoId}` : "/videos";
  }
  if (routeHint === "action_plan") {
    return getActionPlanRoute(user, teacherId);
  }
  if (routeHint === "reflection") {
    return getReflectionRoute(user, teacherId);
  }
  if (routeHint === "privacy_profile") {
    return getMaterialsRoute(user, teacherId);
  }
  if (routeHint === "conference") {
    return getConferenceRoute(user, teacherId);
  }
  return getTeacherHomeRoute(user, teacherId);
}
