/**
 * Root entry point for single-process hosts (Hostinger Node.js web apps, Render, …).
 *
 *   npm run build   → web/dist
 *   npm start       → this file: REST + Socket.IO + the built SPA on one port ($PORT)
 *
 * Loads server/.env (or ./.env) when present. Variables set in the host's panel always
 * win, because process.loadEnvFile never overwrites an existing variable. The backend is
 * imported dynamically so config/env.js reads process.env only after the file is loaded.
 *
 * NO top-level await in this file. Hostinger starts apps through LiteSpeed's lsnode,
 * which require()s the entry file, and require() of an ES module with top-level await
 * throws ERR_REQUIRE_ASYNC_MODULE before anything listens — the host then answers 503.
 * server.cjs is the same entry in CommonJS, for runtimes without require(esm).
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

for (const file of [join(ROOT, 'server', '.env'), join(ROOT, '.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

import('./server/index.js').catch((err) => {
  console.error('[boot] the backend failed to load:', err);
  process.exit(1);
});
