FROM node:18.18.2 as build

WORKDIR /app

COPY package*.json ./

ENV NODE_ENV=production
RUN npm ci --only=production --no-audit --no-fund

COPY server.js ./
COPY src ./

FROM node:18.18.2-alpine

ARG PORT
ARG SENTRY_DSN

ENV NODE_ENV=production
ENV PORT=$PORT
ENV SENTRY_DSN=$SENTRY_DSN

COPY --from=build /app /app

WORKDIR /app

# Add curl for HEALTHCHECK
RUN apk add --no-cache curl

# Create non-root user and switch to it
RUN addgroup -S nodegroup && adduser -S nodeuser -G nodegroup
USER nodeuser

EXPOSE 8080

# Container liveness check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS http://localhost:${PORT:-8080}/health || exit 1'

CMD ["node", "server.js"]

#COMO PROBARLO: docker run -p 8080:8080 -e PORT=8080 -e SENTRY_DSN=your_runtime_sentry_dsn your_image_name