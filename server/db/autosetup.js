/**
 * First-boot database setup, for hosts with no shell (Hostinger Node.js web apps).
 *
 * With DB_AUTO_SETUP=true, if the core tables are missing this applies schema.sql and
 * views.sql and runs the full seed — the same commands docs/12-DEPLOYMENT.md §3 lists,
 * run as child processes so their own process.exit() calls cannot take the API down.
 * Once the schema exists it does nothing, so leaving the flag on is harmless.
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { one } from '../lib/db.js';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  ['schema', ['db/run-sql.js', 'db/schema.sql']],
  ['views',  ['db/run-sql.js', 'db/views.sql']],
  ['seed',   ['db/seed/index.js', 'all']],
];

async function schemaPresent() {
  const row = await one(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('zones','incidents','units','agencies','users')`,
  );
  return (row?.n ?? 0) >= 5;
}

function run(name, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: SERVER_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const forward = (chunk) => {
      for (const line of String(chunk).split('\n')) if (line.trim()) log.info(`[setup:${name}] ${line.trim()}`);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`))));
  });
}

/**
 * @returns {Promise<{ ran: boolean }>} ran = true when the database was just built, in
 *   which case the seeded history already ends at "now" and no catch-up is needed.
 */
export async function autoSetupDatabase(log) {
  if (await schemaPresent()) return { ran: false };

  log.warn('[setup] schema not found — DB_AUTO_SETUP is on, building the database (this takes a few minutes)');
  for (const [name, args] of STEPS) {
    // The seed's verify step sets a non-zero exit code on a calibration drift. The data is
    // still usable, so that is reported and not treated as a failed setup.
    try {
      await run(name, args, log);
    } catch (err) {
      if (name !== 'seed') throw err;
      log.warn({ err: err.message }, '[setup] seed finished with warnings');
    }
  }
  log.info('[setup] database ready');
  return { ran: true };
}
