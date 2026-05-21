export const buildInfo = {
  appVersion: process.env.REACT_APP_VERSION || process.env.npm_package_version || "0.1.0",
  commitSha:
    process.env.REACT_APP_GIT_COMMIT ||
    process.env.REACT_APP_COMMIT_SHA ||
    process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA ||
    "",
  buildId:
    process.env.REACT_APP_BUILD_ID ||
    process.env.REACT_APP_CF_PAGES_COMMIT_SHA ||
    "",
  builtAt: process.env.REACT_APP_BUILD_TIME || "",
};

export function exposeBuildInfo() {
  if (typeof window === "undefined") {
    return;
  }
  window.__COGNIVIO_BUILD__ = buildInfo;
  if (process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line no-console
    console.info("Cognivio build", buildInfo);
  }
}
