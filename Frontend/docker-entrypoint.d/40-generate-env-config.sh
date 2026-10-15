#!/bin/sh
set -e

# Dynamically inject runtime environment variables into window.__ENV__
# This runs at container startup so VITE_API_URL can be overridden per-environment
# without rebuilding the image.
cat <<EOF > /usr/share/nginx/html/env-config.js
window.__ENV__ = {
  VITE_API_URL: "${VITE_API_URL:-}",
  VITE_DEMO_PERSONAS: "${VITE_DEMO_PERSONAS:-true}"
};
EOF
