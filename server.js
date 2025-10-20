import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

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
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app }),
    new ProfilingIntegration(),
    // Capture console.* as breadcrumbs for extra context
    new Sentry.Integrations.Console({ levels: ["log", "info", "warn", "error"] }),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// =============================
// Middleware (order matters)
// =============================
app.use(Sentry.Handlers.requestHandler()); // Must be first
app.use(Sentry.Handlers.tracingHandler());

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
        Sentry.addBreadcrumb({ category: "morgan", level: "info", message: msg });
        if (SENTRY_LOG_REQUESTS) {
          Sentry.captureMessage(`[morgan] ${msg}`, "info");
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
    Sentry.addBreadcrumb({
      category: "http",
      message: `${req.method} ${req.originalUrl}`,
      level: "info",
      data: {
        status: res.statusCode,
        durationMs,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });
    if (SENTRY_LOG_REQUESTS || res.statusCode >= 400) {
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warning" : "info";
      Sentry.captureMessage(
        `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} in ${durationMs}ms`,
        level
      );
    }
  });
  next();
});

// =============================
// Sentry structured log helper
// =============================
function logToSentry({ level = "info", message, req, res, tags = {}, data = {} }) {
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    // Common tags for filtering
    scope.setTag("environment", ENVIRONMENT);
    scope.setTag("service", "api");
    scope.setTag("method", req?.method || "-");
    scope.setTag("route", req?.route?.path || req?.originalUrl || "-");
    Object.entries(tags).forEach(([k, v]) => scope.setTag(k, String(v)));

    // Structured contexts
    if (req) {
      scope.setContext("http", {
        method: req.method,
        url: req.originalUrl,
        query: req.query,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }
    if (res) {
      scope.setContext("response", {
        status: res.statusCode,
      });
    }
    if (data && Object.keys(data).length) {
      scope.setContext("data", data);
    }
    Sentry.captureMessage(message || "app.log");
  });
}

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
    Sentry.addBreadcrumb({
      category: "tasks",
      message: "Task created",
      data: { id, title, description },
    });
    res.status(201).json(task);
  } catch (error) {
    Sentry.captureException(error);
    res.status(400).json({ error: error.message });
  }
});

// List Tasks
app.get("/tasks", (_req, res) => {
  Sentry.addBreadcrumb({ category: "tasks", message: "Tasks listed" });
  res.status(200).json(Array.from(tasks.values()));
});

// Get Task by ID
app.get("/tasks/:id", (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
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
  Sentry.addBreadcrumb({ category: "tasks", message: "Task updated", data: { id: task.id } });
  res.status(200).json(updated);
});

// Delete Task
app.delete("/tasks/:id", (req, res) => {
  const existed = tasks.delete(req.params.id);
  if (!existed) return res.status(404).json({ error: "Task not found" });
  Sentry.addBreadcrumb({ category: "tasks", message: "Task deleted", data: { id: req.params.id } });
  res.status(204).send();
});

// =============================
// Sentry error handler MUST be after routes
// =============================
app.use(
  Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      // Capture all 4xx/5xx
      if (+error.status > 399) return true;
      return false;
    },
  })
);

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
