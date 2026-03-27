import { isAdminUser } from "@/lib/userRoutes";

export function getCoachingHubRoute(user, teacherId, tab = "") {
  const base = isAdminUser(user)
    ? `/teachers/${teacherId}/coaching`
    : "/my-workspace/coaching";
  if (!tab) {
    return base;
  }
  return `${base}?tab=${encodeURIComponent(tab)}`;
}

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
  return getCoachingHubRoute(user, teacherId, "conference");
}

export function resolveCoachingLink(user, teacherId, routeHint, payload = {}) {
  if (routeHint === "video") {
    if (!payload.videoId) {
      return "/videos";
    }
    const search = new URLSearchParams();
    if (
      typeof payload.timestampSeconds === "number" &&
      Number.isFinite(payload.timestampSeconds)
    ) {
      search.set("t", String(Math.max(0, Math.floor(payload.timestampSeconds))));
    }
    const query = search.toString();
    return query ? `/videos/${payload.videoId}?${query}` : `/videos/${payload.videoId}`;
  }
  if (routeHint === "action_plan") {
    return getCoachingHubRoute(user, teacherId, "goals");
  }
  if (routeHint === "reflection") {
    return getCoachingHubRoute(user, teacherId, "reflections");
  }
  if (routeHint === "privacy_profile") {
    return getMaterialsRoute(user, teacherId);
  }
  if (routeHint === "conference") {
    return getConferenceRoute(user, teacherId);
  }
  return getTeacherHomeRoute(user, teacherId);
}
