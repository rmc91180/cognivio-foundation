#!/bin/sh
set -eu

cat > /app/build/runtime-config.js <<EOF
window.__APP_CONFIG__ = {
  REACT_APP_BACKEND_URL: "${REACT_APP_BACKEND_URL:-}",
  REACT_APP_DEMO_MODE: "${REACT_APP_DEMO_MODE:-false}",
  REACT_APP_BUILD_SHA: "${REACT_APP_BUILD_SHA:-}",
  REACT_APP_BUILD_TIME: "${REACT_APP_BUILD_TIME:-}",
  REACT_APP_DASHBOARD_V2: "${REACT_APP_DASHBOARD_V2:-true}"
};
EOF

exec npx serve -s build -l "${PORT:-3000}"
