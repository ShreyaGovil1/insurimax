#!/bin/sh
set -e

# Dynamically inject runtime environment variables into window.__ENV__
cat <<EOF > /usr/share/nginx/html/env-config.js
window.__ENV__ = {
  VITE_API_URL: "${VITE_API_URL:-}"
};
EOF
