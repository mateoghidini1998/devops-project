# devops-project

## Requisitos
- Node.js 18+
- Docker y Docker Compose

## Variables de entorno
Usa un archivo `.env` (no se commitea). Ver `.env.example`.

- `PORT` (por defecto 8080)
- `ENVIRONMENT` (DEV/PROD)
- `SENTRY_DSN` (requerido para logs en Sentry)
- `SENTRY_LOG_REQUESTS` (`true|false`) log por request con Sentry.logger
- `SENTRY_TRACES_SAMPLE_RATE` y `SENTRY_PROFILES_SAMPLE_RATE` (por defecto 0)
- `SENTRY_DEBUG` (`true|false`) verbose del SDK (usar `false` en prod)
- `CORS_ORIGIN` (lista separada por comas)

## Ejecutar en desarrollo
```bash
npm ci
npm run dev
```

Endpoints:
- `POST /` body `{ "msg": "Ping" }` -> `{ "msg": "Pong" }`
- `GET /health` -> `{ "status": "ok" }`
- CRUD `tasks`: `POST /tasks`, `GET /tasks`, `GET /tasks/:id`, `PUT /tasks/:id`, `DELETE /tasks/:id`

## Tests
```bash
npm test
```
Cobertura mínima configurada en `jest.config.cjs`.

## Linting
```bash
npm run lint
```

## Docker (Producción)
Construir y correr:
```bash
docker build -t your-image .
docker run -p 8080:8080 --env PORT=8080 your-image
```

Compose:
```bash
docker compose up --build -d
```

Healthcheck:
- `GET /health`
- Dockerfile incluye `HEALTHCHECK`.

## Observabilidad (Sentry)
- Logs con `Sentry.logger` (info/warn/error). Activar con `SENTRY_LOG_REQUESTS=true`.
- Integración de consola: `enableLogs: true` y `consoleLoggingIntegration`.
- Recomendado en prod: `SENTRY_DEBUG=false`, sample rates en 0.

## Seguridad
- `helmet`, rate limit básico, CORS configurable por `CORS_ORIGIN`.
- La imagen corre como usuario no-root.

## CI/CD
Workflow en `.github/workflows/node.js.yml`:
- Lint + Tests en matriz de Node 18/20/22.
- Build & Push a Docker Hub si existen secretos `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN`.
- Tags: `latest` y SHA corto.

Protección de rama `main` (Branch develop):
- Require PR antes de merge
- Require status checks (build 18.x, 20.x, 22.x) y up-to-date
- Block force pushes y deletions

Deploy (opcional):
- Render con auto-deploy a main; health `GET /health`.

## Notas
- Usa `ENVIRONMENT=PROD` en producción y ajusta muestreos de Sentry según necesidad.

