/**
 * ERSS Dubai — the one backend process.
 *
 * Express 5 (REST) + Socket.IO 4 (realtime) on a SINGLE http.Server, listening on one
 * port. No separate API port, no separate socket port, no Python service.
 * deployment_context.md §2, followed literally.
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';

import { env, validateEnv, configProblems } from './config/env.js';
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
import { autoSetupDatabase } from './db/autosetup.js';

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

/** True when the browser's Origin is this server itself — the SPA served from here. */
function isSameOrigin(req, origin) {
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

app.use(cors((req, cb) => cb(null, {
  origin(origin, done) {
    // Same-origin, curl and native WebView requests arrive with no Origin header.
    if (!origin) return done(null, true);
    if (env.corsOrigins.includes(origin) || isSameOrigin(req, origin)) return done(null, true);
    logger.warn({ origin }, '[cors] rejected origin — add it to CORS_ORIGINS');
    done(null, false);
  },
  credentials: true,                  // cookie sessions require this, and it is why
                                      // CORS_ORIGINS can never be '*' in production
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
})));

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
      ...(configProblems.length ? { config: configProblems } : {}),
    });
  } catch (err) {
    // 503, not 500: a database outage must be distinguishable from an application bug
    // at a glance. The target is included so a misconfiguration is self-diagnosing.
    res.status(503).json({
      status: 'degraded',
      api: 'up',
      database: 'down',
      target: dbTarget,
      user: env.db.url ? undefined : env.db.user,
      detail: String(err.message ?? '').trim(),
      hint: 'Is PostgreSQL running? Check DATABASE_URL or server/.env — see HOSTINGER.md',
      ...(configProblems.length ? { config: configProblems } : {}),
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

// ── Frontend ──────────────────────────────────────────────────────────────────
// On a single-process host (Hostinger) this process also serves the built SPA, so the
// console, the /app surface, REST and the socket all share one origin and one port.
// Behind the astrikos nginx setup the SPA is served separately; SERVE_WEB=off keeps
// this process API-only.

const webDist = env.webDist
  ? resolve(env.webDist)
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const serveWeb = env.serveWeb === 'on' || (env.serveWeb === 'auto' && existsSync(join(webDist, 'index.html')));

if (serveWeb) {
  // Hashed bundles are immutable; index.html must always be revalidated or a deploy
  // leaves browsers pointing at chunks that no longer exist.
  app.use('/assets', express.static(join(webDist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use('/assets', (_req, res) => res.status(404).end());   // a stale chunk, never index.html
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  // SPA fallback: every client-side route (/dashboard, /app, …) returns index.html.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/socket.io/')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use(errorHandler(logger));

// ── Realtime ──────────────────────────────────────────────────────────────────

const io = attachRealtime(server);
app.set('io', io);

// ── Background loops ──────────────────────────────────────────────────────────
// Clock-driven and database-polled, so a restart loses nothing and a paused scenario
// pauses them.

function startBackground({ freshSeed = false } = {}) {
  startAckTimeoutSweep();     // offers not acknowledged in time → timed_out → re-dispatch
  startSnapshotLoop();        // units:snapshot every 30 s — the correctness backstop
  startIdempotencyCleanup();
  startAlertWatch();          // P1 calls, calls waiting, breaches, coverage gaps, ED load
  startLiveSimulation();      // road watch, AI dispatch and crews — starts itself (config/poc.js)

  // Seeded history ends when the seed last ran. Carry it forward so "today" is never empty —
  // in the background, so a slow catch-up never delays the API coming up.
  if (env.historyCatchup && !freshSeed) {
    extendHistory({ rngSeed: env.seed.rng, log: (m) => logger.info(m.trim()) })
      .then((r) => { if (r.incidents) logger.info({ incidents: r.incidents, from: r.from }, '[history] caught up to now'); })
      .catch((err) => logger.warn({ err: err.message }, '[history] catch-up failed — "today" figures may be empty'));
  }
}

// With DB_AUTO_SETUP the database may still be being built; the loops wait for it. The
// HTTP server listens meanwhile, so the host's health check and /health answer at once.
if (env.db.autoSetup) {
  autoSetupDatabase(logger)
    .then(({ ran }) => startBackground({ freshSeed: ran }))
    .catch((err) => {
      logger.error({ err: err.message }, '[setup] database setup failed — check DATABASE_URL / DB_* and that PostGIS is available');
      startBackground();
    });
} else {
  startBackground();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(env.port, () => {
  logger.info(
    { port: env.port, db: dbTarget, env: env.nodeEnv, cors: env.corsOrigins, web: serveWeb ? webDist : 'off' },
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
