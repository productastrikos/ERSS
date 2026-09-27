/**
 * ERSS Dubai — the one backend process.
 *
 * Express 5 (REST) + Socket.IO 4 (realtime) on a SINGLE http.Server, listening on one
 * port. No separate API port, no separate socket port, no Python service.
 * deployment_context.md §2, followed literally.
 */

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';

import { env, validateEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/errors.js';
import { attachUser } from './lib/auth.js';
import { healthcheck, dbTarget, close as closeDb } from './lib/db.js';
import { clock } from './lib/clock.js';

import { registerRoutes } from './routes/index.js';
import { attachRealtime, startSnapshotLoop } from './realtime/index.js';
import { startAckTimeoutSweep } from './services/dispatch.js';
import { startIdempotencyCleanup } from './lib/idempotency.js';
import { status as osrmStatus } from './integrations/osrm.js';
import { startAlertWatch } from './services/alerts.js';
import { startLiveSimulation } from './sim/live.js';
import { extendHistory } from './db/seed/history.js';

const { warnings } = validateEnv(logger);
const startedAt = new Date();

const app = express();
const server = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────────────────────

app.disable('x-powered-by');
app.set('trust proxy', 1);            // behind nginx in production

app.use(helmet({
  // The API serves JSON and GeoJSON, not HTML; CSP belongs on the frontend origin.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin(origin, cb) {
    // Same-origin, curl and native WebView requests arrive with no Origin header.
    if (!origin) return cb(null, true);
    if (env.corsOrigins.includes(origin)) return cb(null, true);
    logger.warn({ origin }, '[cors] rejected origin — add it to CORS_ORIGINS');
    cb(null, false);
  },
  credentials: true,                  // cookie sessions require this, and it is why
                                      // CORS_ORIGINS can never be '*' in production
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use(pinoHttp({
  logger,
  autoLogging: {
    // Health polling and position pings would drown everything else.
    ignore: (req) => req.url === '/health' || req.url.startsWith('/socket.io/'),
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error'
    : res.statusCode >= 400 ? 'warn' : 'info'),
}));

app.use(attachUser);

// ── Liveness ──────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const db = await healthcheck();
    res.json({
      status: 'ok',
      api: 'up',
      database: 'up',
      postgis: db.postgis,
      target: db.target,
      user: db.user,
      clock: clock.snapshot(),
      routing: osrmStatus(),
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (err) {
    // 503, not 500: a database outage must be distinguishable from an application bug
    // at a glance. The target is included so a misconfiguration is self-diagnosing.
    res.status(503).json({
      status: 'degraded',
      api: 'up',
      database: 'down',
      target: dbTarget,
      user: env.db.user,
      detail: String(err.message ?? '').trim(),
      hint: 'Is PostgreSQL running? Check server/.env — see docs/12-DEPLOYMENT.md §3',
    });
  }
});

app.get('/version', (_req, res) => {
  res.json({
    name: 'ERSS Dubai',
    version: process.env.npm_package_version ?? '1.0.0',
    node: process.version,
    env: env.nodeEnv,
    startedAt: startedAt.toISOString(),
  });
});

// ── API ───────────────────────────────────────────────────────────────────────

registerRoutes(app);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
});

app.use(errorHandler(logger));

// ── Realtime ──────────────────────────────────────────────────────────────────

const io = attachRealtime(server);
app.set('io', io);

// ── Background loops ──────────────────────────────────────────────────────────
// Clock-driven and database-polled, so a restart loses nothing and a paused scenario
// pauses them.

startAckTimeoutSweep();     // offers not acknowledged in time → timed_out → re-dispatch
startSnapshotLoop();        // units:snapshot every 30 s — the correctness backstop
startIdempotencyCleanup();
startAlertWatch();          // P1 calls, calls waiting, breaches, coverage gaps, ED load
startLiveSimulation();      // road watch, AI dispatch and crews — starts itself (config/poc.js)

// Seeded history ends when the seed last ran. Carry it forward so "today" is never empty —
// in the background, so a slow catch-up never delays the API coming up.
if (env.historyCatchup) {
  extendHistory({ rngSeed: env.seed.rng, log: (m) => logger.info(m.trim()) })
    .then((r) => { if (r.incidents) logger.info({ incidents: r.incidents, from: r.from }, '[history] caught up to now'); })
    .catch((err) => logger.warn({ err: err.message }, '[history] catch-up failed — "today" figures may be empty'));
}

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(env.port, () => {
  logger.info(
    { port: env.port, db: dbTarget, env: env.nodeEnv, cors: env.corsOrigins },
    `ERSS backend listening on :${env.port}`,
  );
  if (warnings.length) {
    logger.warn(`${warnings.length} configuration warning(s) — see above`);
  }
  if (!env.llm.enabled) {
    logger.info('[llm] no provider configured — the assistant answers from rules. Nothing else is affected.');
  }
});

// ── Shutdown ──────────────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  io.close();
  server.close(async () => {
    try { await closeDb(); } catch { /* already gone */ }
    clearTimeout(force);
    logger.info('closed cleanly');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException');
});

export { app, server, io };
