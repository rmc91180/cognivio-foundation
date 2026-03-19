const windowConfig =
  typeof window !== "undefined" && window.__APP_CONFIG__
    ? window.__APP_CONFIG__
    : {};

function getConfigValue(key, fallback = "") {
  const runtimeValue = windowConfig[key];
  if (runtimeValue !== undefined && runtimeValue !== null && runtimeValue !== "") {
    return runtimeValue;
  }

  const buildValue = process.env[key];
  if (buildValue !== undefined && buildValue !== null && buildValue !== "") {
    return buildValue;
  }

  return fallback;
}

export const runtimeConfig = {
  backendUrl: getConfigValue("REACT_APP_BACKEND_URL"),
  demoMode: getConfigValue("REACT_APP_DEMO_MODE", "false") === "true",
  buildSha: getConfigValue("REACT_APP_BUILD_SHA"),
  buildTime: getConfigValue("REACT_APP_BUILD_TIME"),
  dashboardV2Enabled: getConfigValue("REACT_APP_DASHBOARD_V2", "true") !== "false",
};

