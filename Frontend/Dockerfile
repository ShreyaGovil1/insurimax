# ── Stage 1: Build the React / Vite application ──
FROM node:22-alpine AS builder

WORKDIR /app

# Optional build-time API URL (can also be injected dynamically at runtime via Cloud Run env vars)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Install dependencies using clean install
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code
COPY . .

# Build production static bundle
RUN npm run build

# ── Stage 2: Serve with lightweight Nginx ──
FROM nginx:1.27-alpine

# Copy compiled static assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Cloud Run Nginx template (listens dynamically on ${PORT} substituted by envsubst)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy startup hook to dynamically generate env-config.js from container environment variables
COPY docker-entrypoint.d/40-generate-env-config.sh /docker-entrypoint.d/40-generate-env-config.sh
# Strip Windows CRLF line endings (\r\n → \n) — avoids "not found" on the shebang line
# when the file was edited on Windows before being built in a Linux container.
RUN sed -i 's/\r//' /docker-entrypoint.d/40-generate-env-config.sh \
    && chmod +x /docker-entrypoint.d/40-generate-env-config.sh

# Google Cloud Run injects $PORT (default: 8080)
ENV PORT=8080
EXPOSE 8080

# Health check probe
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:${PORT}/healthz || exit 1

# Launch Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
