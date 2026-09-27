#!/usr/bin/env node
/**
 * Apply a .sql file to the database.
 *
 * Deliberately not a migration framework: at this size, idempotent SQL applied in
 * order is less machinery and less to go wrong. `schema.sql` and `views.sql` are both
 * safe to re-run.
 *
 *   node db/run-sql.js db/schema.sql
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool, dbTarget, close } from '../lib/db.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node db/run-sql.js <file.sql>');
  process.exit(2);
}

const path = resolve(process.cwd(), file);
const sql = await readFile(path, 'utf8');

console.log(`[sql] applying ${file} → ${dbTarget}`);
const started = Date.now();

const client = await pool.connect();
try {
  await client.query(sql);
  console.log(`[sql] ok (${Date.now() - started} ms)`);
} catch (err) {
  console.error(`[sql] FAILED: ${err.message}`);
  if (err.position) {
    // Point at the offending line rather than making someone count characters.
    const upto = sql.slice(0, Number(err.position));
    const line = upto.split('\n').length;
    const lines = sql.split('\n');
    console.error(`[sql] near line ${line}:`);
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) {
      console.error(`  ${String(i + 1).padStart(5)} ${i + 1 === line ? '>' : ' '} ${lines[i]}`);
    }
  }
  process.exitCode = 1;
} finally {
  client.release();
  await close();
}
