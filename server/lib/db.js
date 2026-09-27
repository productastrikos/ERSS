/**
 * PostgreSQL access. One pool, created once.
 *
 * Replaces the single global connection the DSO FastAPI used, which serialised every
 * request through one socket and raced on reconnect.
 */

import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Return numerics as JS numbers rather than strings. Safe here because every numeric
// column in this schema is a count, a duration or a score — none exceed 2^53.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
// int8 / bigint — counts from aggregates. Same reasoning.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

export const pool = new pg.Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  max: env.db.poolMax,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  application_name: 'erss',
});

pool.on('error', (err) => {
  // An idle client erroring is not fatal — the pool replaces it. Log so a flapping
  // database is visible rather than silently degrading throughput.
  logger.error({ err }, '[db] idle client error');
});

/** The connection target, for error messages and /health. Never includes the password. */
export const dbTarget = `${env.db.host}:${env.db.port}/${env.db.name}`;

/**
 * Run a query. Slow queries are logged with their text so a demo that drags has a
 * diagnosable cause rather than a vague impression.
 */
export async function query(text, params) {
  const started = performance.now();
  try {
    const res = await pool.query(text, params);
    const ms = performance.now() - started;
    if (ms > 500) logger.warn({ ms: Math.round(ms), rows: res.rowCount, sql: squash(text) }, '[db] slow query');
    return res;
  } catch (err) {
    logger.error({ err, sql: squash(text) }, '[db] query failed');
    throw err;
  }
}

/** First row, or null. */
export async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** All rows. */
export async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/** Single scalar from the first row, or null. */
export async function value(text, params) {
  const row = await one(text, params);
  if (!row) return null;
  return Object.values(row)[0];
}

/**
 * Run `fn` inside a transaction with a dedicated client.
 * Commits on resolve, rolls back on throw, always releases.
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Liveness + PostGIS presence. Used by /health. */
export async function healthcheck() {
  const row = await one(`
    SELECT current_user                          AS db_user,
           current_database()                    AS db_name,
           (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis
  `);
  return {
    ok: true,
    target: dbTarget,
    user: row.db_user,
    database: row.db_name,
    postgis: row.postgis ?? null,
  };
}

export async function close() {
  await pool.end();
}

function squash(sql) {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 300);
}
