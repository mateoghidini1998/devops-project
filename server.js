import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

const app = express();

dotenv.config();

const sentryDSN = process.env.SENTRY_DSN;

Sentry.init({
    dsn: sentryDSN,
    environment: process.env.ENVIRONMENT || "DEV",
    includeLocalVariables: true,
    integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app }),
        new ProfilingIntegration()
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());

app.use(
    Sentry.Handlers.errorHandler({
        shouldHandleError(error) {
            // Capture all 404 and 500 errors
            if (+error.status > 399) {
                return true;
            }
            return false;
        },
    })
);

app.use(Sentry.Handlers.tracingHandler());

app.use(compression({
    filter: () => true,
    threshold: 0
}));
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
const requestRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(requestRateLimiter);
app.use(morgan("dev"));
app.enable('trust proxy');
app.disable('x-powered-by');
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(',').filter(Boolean);
if (allowedOrigins.length > 0) {
    app.use(cors({ origin: allowedOrigins }));
    app.options('*', cors({ origin: allowedOrigins }));
} else {
    app.use(cors());
    app.options('*', cors());
}

app.use(bodyParser.raw());
app.use(bodyParser.text());

app.use(bodyParser.json({
    limit: '10mb'
}));

app.use(bodyParser.urlencoded({
    limit: '10mb',
    extended: true
}));

const port = process.env.PORT || 8080;

export const callback = (req, res) => {
    try {
        if (!req.body.msg || req.body.msg != "Ping") throw new Error('Request Body should be "Ping"');
        res.status(200).json({ msg: "Pong" });
    } catch (error) {
        Sentry.captureException(error);
        res.status(400).json({ error: error.message})
    }
};

app.post('/', callback);

// Basic liveness endpoint for orchestrators and load balancers
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

let serverInstance;
if (!process.env.JEST_WORKER_ID) {
    serverInstance = app.listen(port, () => {
        const msg = `Server is running on port ${port}`;
        console.log(msg);
        Sentry.captureMessage(msg);
    });

    const shutdown = () => {
        const msg = 'Received termination signal. Shutting down gracefully...';
        console.log(msg);
        Sentry.captureMessage(msg);
        serverInstance.close(() => {
            process.exit(0);
        });
        // Force exit after timeout
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

export default app;