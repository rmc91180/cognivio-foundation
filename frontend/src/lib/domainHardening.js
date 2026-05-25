export const APP_ORIGIN = "https://app.cognivio.live";

const MARKETING_HOSTS = new Set(["cognivio.live", "www.cognivio.live"]);
const APP_HOSTS = new Set(["app.cognivio.live"]);

const APP_ROUTE_PREFIXES = [
  "/login",
  "/request-access",
  "/dashboard",
  "/settings",
  "/my-workspace",
  "/my-lessons",
  "/my-coaching",
  "/my-badges",
  "/my-profile",
  "/record",
  "/teachers",
  "/observation",
  "/coaching",
  "/reports",
  "/recognition",
  "/master-admin",
  "/privacy",
  "/consent",
  "/onboarding",
];

export function isCanonicalAppHost(hostname) {
  return APP_HOSTS.has(String(hostname || "").toLowerCase());
}

export function isMarketingHost(hostname) {
  return MARKETING_HOSTS.has(String(hostname || "").toLowerCase());
}

export function isAppRoute(pathname) {
  const path = String(pathname || "/");
  return APP_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function getAppRedirectUrl(locationLike) {
  const location = locationLike || {};
  const hostname = String(location.hostname || "").toLowerCase();
  if (!isMarketingHost(hostname) || !isAppRoute(location.pathname || "/")) {
    return null;
  }
  const path = location.pathname || "/";
  const search = location.search || "";
  const hash = location.hash || "";
  return `${APP_ORIGIN}${path}${search}${hash}`;
}

export function redirectWrongOriginAppRoute(locationLike = window.location) {
  const target = getAppRedirectUrl(locationLike);
  if (target && locationLike.href !== target) {
    locationLike.replace(target);
    return true;
  }
  return false;
}

