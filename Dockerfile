FROM node:22.11.0-alpine AS build

WORKDIR /app

COPY package*.json ./

ENV NODE_ENV=production
# Install only production dependencies for smaller image size
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY src ./

FROM node:22.11.0-alpine

ENV NODE_ENV=production
# Default runtime port; can be overridden by -e PORT=...
ENV PORT=8080

WORKDIR /app

# Create non-root user (use built-in 'node' user) and install minimal runtime tools
RUN apk add --no-cache curl tini

# Copy app files with correct ownership for non-root execution
COPY --chown=node:node --from=build /app /app

# Switch to non-root user provided by the Node image
USER node

EXPOSE 8080

# Container liveness check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS http://localhost:${PORT:-8080}/health || exit 1'

# OCI labels
LABEL org.opencontainers.image.title="devops-project"
LABEL org.opencontainers.image.description="Express API with Sentry logging"
LABEL org.opencontainers.image.source="https://example.com/repo"

# Use tini as PID 1 for proper signal handling and reaping
ENTRYPOINT ["tini","--"]
CMD ["node", "server.js"]

#COMO PROBARLO: docker run -p 8080:8080 -e PORT=8080 -e SENTRY_DSN=your_runtime_sentry_dsn your_image_name