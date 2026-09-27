/**
 * pm2, both processes, one file.  (deployment_context.md §7, docs/12 §4)
 *
 *   pm2 start ops/pm2/ecosystem.config.cjs && pm2 save
 *
 * Two ports, two pm2 names, derived exactly as the convention says:
 *
 *   erss_3327     frontend   static SPA from web/dist, served on 3327
 *   erss_be_4327  backend    REST *and* websocket on 4327, one process, one port
 *
 * The ports live HERE and in the two nginx blocks, nowhere else. The frontend bundle
 * addresses the backend by SUBDOMAIN (web/.env.production), never by port, so renumbering
 * the backend's local port needs no rebuild — only this file and the nginx `proxy_pass`.
 *
 * `cwd` is relative to this file, so the command works from any directory.
 */

const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const FRONTEND_PORT = 3327;
const BACKEND_PORT = 4327;

module.exports = {
  apps: [
    {
      // `serve` (npm i -g serve) with -s: every unknown path returns index.html, which is
      // what makes /dashboard and /app survive a refresh — the SPA owns its routing
      // (web/src/lib/router.ts) and nginx must not answer 404 for a client-side path.
      name: `erss_${FRONTEND_PORT}`,
      script: 'serve',
      args: `./dist -s -p ${FRONTEND_PORT}`,
      cwd: join(ROOT, 'web'),
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: `erss_be_${BACKEND_PORT}`,
      script: 'index.js',
      cwd: join(ROOT, 'server'),
      // config/env.js reads PORT; a real environment variable beats server/.env, so this
      // is the authority on which port the backend listens on.
      env: { PORT: String(BACKEND_PORT), NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      // One process only. The simulation clock, the dispatch engine and the socket rooms
      // are in-process state (server/sim, server/realtime) — a second instance would run
      // a second simulation against the same database and fight the first one over it.
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 5000,
    },
  ],
};
