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
      const message = `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} in ${durationMs}ms`;
      const log = Sentry.logger;
      if (log) {
        if (level === "error" && typeof log.error === "function") log.error(message);
        else if (level === "warning" && typeof log.warn === "function") log.warn(message);
        else if (typeof log.info === "function") log.info(message);
        else Sentry.captureMessage(message, level);
      } else {
        Sentry.captureMessage(message, level);
      }
    }
  });
  next();
});

// (removed) structured log helper – not used; logging is handled by middleware

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

    // Breadcrumb + structured event
    Sentry.logger.info("Task created", { id, title, description }, new Date().toISOString());
    res.status(201).json(task);
  } catch (error) {
    Sentry.captureException(error);
    Sentry.logger.error(error.message);
    res.status(400).json({ error: error.message });
  }
});

// List Tasks
app.get("/tasks", (_req, res) => {
  Sentry.logger.info("Tasks listed");
  res.status(200).json(Array.from(tasks.values()));
});

// Get Task by ID
app.get("/tasks/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  Sentry.logger.info("Task retrieved", { id: req.params.id, task }, new Date().toISOString());
  res.status(200).json(task);
});

// Update Task
app.put("/tasks/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { title, description } = req.body || {};
  if (title !== undefined && typeof title !== "string") {
    return res.status(400).json({ error: 'Field "title" must be a string' });
  }
  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: 'Field "description" must be a string' });
  }
  const updated = { ...task, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) };
  tasks.set(task.id, updated);
  Sentry.logger.info("Task updated", { id: task.id, updated });
  res.status(200).json(updated);
});

// Delete Task
app.delete("/tasks/:id", (req, res) => {
  const existed = tasks.delete(req.params.id);
  if (!existed) return res.status(404).json({ error: "Task not found" });
  Sentry.logger.info("Task deleted", { id: req.params.id });
  res.status(204).send();
});

// Note: Sentry v9 no longer exposes Handlers.errorHandler in this setup.
// Errors are captured explicitly where thrown.

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
