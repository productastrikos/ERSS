/**
 * Root entry point for single-process hosts (Hostinger Node.js web apps, Render, …).
 *
 *   npm run build   → web/dist
 *   npm start       → this file: REST + Socket.IO + the built SPA on one port ($PORT)
 *
 * Loads server/.env (or ./.env) when present. Variables set in the host's panel always
 * win, because process.loadEnvFile never overwrites an existing variable. The backend is
 * imported dynamically so config/env.js reads process.env only after the file is loaded.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

for (const file of [join(ROOT, 'server', '.env'), join(ROOT, '.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

await import('./server/index.js');
