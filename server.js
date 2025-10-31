import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import * as Sentry from "@sentry/node";

// =============================
// Bootstrap & Config
// =============================
dotenv.config();
const app = express();

const PORT = process.env.PORT || 8080;
const ENVIRONMENT = process.env.ENVIRONMENT || "DEV";
const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_LOG_REQUESTS = (process.env.SENTRY_LOG_REQUESTS || "").toLowerCase() === "true";

// Helpful default tags
Sentry.setTag("service", "api");
if (process.env.APP_VERSION) {
  Sentry.setTag("version", process.env.APP_VERSION);
}

// =============================
// Sentry Init
// =============================
Sentry.init({
  dsn: SENTRY_DSN,
  environment: ENVIRONMENT,
  includeLocalVariables: true,
  enableLogs: true,
  integrations: [
    // send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],
  // turn off tracing/profiling unless explicitly enabled via env
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || "0"),
});

// =============================
// Middleware (order matters)
// =============================

app.use(compression({ filter: () => true, threshold: 0 }));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Trust first proxy (for Render/Heroku/NGINX, etc.)
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Rate limiting
const requestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(requestRateLimiter);

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").filter(Boolean);
if (allowedOrigins.length > 0) {
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: false,
      optionsSuccessStatus: 204,
    })
  );
} else {
  app.use(cors());
}

// Body parsers (use built-in Express parsers)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Correlation id for logs
function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
app.use((req, _res, next) => {
  // prefer upstream id if provided
  req.requestId = req.headers["x-request-id"] || generateRequestId();
  next();
});

// Morgan → console + Sentry breadcrumb (optionally event)
app.use(
  morgan("combined", {
    stream: {
      write: (line) => {
        const msg = line.trim();
        if (SENTRY_LOG_REQUESTS) {
          const log = Sentry.logger;
          if (log && typeof log.info === "function") {
            log.info(`[morgan] ${msg}`);
          } else {
            Sentry.captureMessage(`[morgan] ${msg}`, "info");
          }
        }
      },
    },
  })
);

// Custom request logger → breadcrumb + optional event per request
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    if (SENTRY_LOG_REQUESTS || res.statusCode >= 400) {
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warning" : "info";
      const message = Sentry.logger.fmt`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} in ${durationMs}ms`; 
      const log = Sentry.logger;
      if (log) {
        const attributes = {
          requestId: req.requestId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          referer: req.headers["referer"],
        };
        if (level === "error" && typeof log.error === "function") log.error(message, attributes);
        else if (level === "warning" && typeof log.warn === "function") log.warn(message, attributes);
        else if (typeof log.info === "function") log.info(message, attributes);
        else Sentry.captureMessage(message, level);
      } else {
        Sentry.captureMessage(message, level);
      }
    }
  });
  next();
});


// =============================
// Routes
// =============================
export const callback = (req, res) => {
  try {
    if (!req.body.msg || req.body.msg !== "Ping") throw new Error('Request Body should be "Ping"');
    res.status(200).json({ msg: "Pong" });
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
};

app.post("/", callback);

// Health/liveness
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// In-memory store for tasks (demo)
let nextTaskId = 1;
const tasks = new Map();

export const resetTasks = () => {
  tasks.clear();
  nextTaskId = 1;
};

// Create Task
app.post("/tasks", (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title || typeof title !== "string") {
      throw new Error('Field "title" is required');
    }
    const id = String(nextTaskId++);
    const task = { id, title, description: description || "" };
    tasks.set(id, task);

    const { logger } = Sentry;
    if (logger?.info) {
      logger.info(
        logger.fmt`Task created ${id}`,
        {
          requestId: req.requestId,
          titleLength: typeof title === "string" ? title.length : 0,
          hasDescription: Boolean(description),
        }
      );
    }
    res.status(201).json(task);
  } catch (error) {
    Sentry.captureException(error);
    if (Sentry.logger?.warn) {
      Sentry.logger.warn("Task create validation failed", {
        requestId: req.requestId,
        error: error.message,
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// List Tasks
app.get("/tasks", (_req, res) => {
  if (Sentry.logger?.info) {
    Sentry.logger.info("Tasks listed", { requestId: _req.requestId, total: tasks.size });
  }
  res.status(200).json(Array.from(tasks.values()));
});

// Get Task by ID
app.get("/tasks/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    if (Sentry.logger?.warn) {
      Sentry.logger.warn("Task not found", { requestId: req.requestId, id: req.params.id });
    }
    return res.status(404).json({ error: "Task not found" });
  }
  if (Sentry.logger?.info) {
    Sentry.logger.info("Task retrieved", { requestId: req.requestId, id: req.params.id });
  }
  res.status(200).json(task);
});

// Update Task
app.put("/tasks/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { title, description } = req.body || {};
  if (title !== undefined && typeof title !== "string") {
    if (Sentry.logger?.warn) {
      Sentry.logger.warn("Task update validation failed", { requestId: req.requestId, id: req.params.id, field: "title" });
    }
    return res.status(400).json({ error: 'Field "title" must be a string' });
  }
  if (description !== undefined && typeof description !== "string") {
    if (Sentry.logger?.warn) {
      Sentry.logger.warn("Task update validation failed", { requestId: req.requestId, id: req.params.id, field: "description" });
    }
    return res.status(400).json({ error: 'Field "description" must be a string' });
  }
  const updated = { ...task, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) };
  tasks.set(task.id, updated);
  if (Sentry.logger?.info) {
    Sentry.logger.info("Task updated", { requestId: req.requestId, id: task.id, changedFields: Object.keys({ ...(title !== undefined && { title: true }), ...(description !== undefined && { description: true }) }) });
  }
  res.status(200).json(updated);
});

// Delete Task
app.delete("/tasks/:id", (req, res) => {
  const existed = tasks.delete(req.params.id);
  if (!existed) {
    if (Sentry.logger?.warn) {
      Sentry.logger.warn("Task delete missing", { requestId: req.requestId, id: req.params.id });
    }
    return res.status(404).json({ error: "Task not found" });
  }
  if (Sentry.logger?.info) {
    Sentry.logger.info("Task deleted", { requestId: req.requestId, id: req.params.id });
  }
  res.status(204).send();
});

// =============================
// Startup & Shutdown
// =============================
let serverInstance;
/* istanbul ignore next */
if (!process.env.JEST_WORKER_ID) {
  serverInstance = app.listen(PORT, () => {
    const msg = `Server is running on port ${PORT}`;
    console.log(msg);
    Sentry.captureMessage(msg);
  });

  const shutdown = () => {
    const msg = "Received termination signal. Shutting down gracefully...";
    console.log(msg);
    Sentry.captureMessage(msg);
    serverInstance.close(() => {
      process.exit(0);
    });
    // Force exit after timeout
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;
