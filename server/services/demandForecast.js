/**
 * The demand forecast, kept current — the rows behind Analytics → Demand, the coverage
 * engine's demand weights and the Executive "held to account" tile.
 *
 * The seed used to write this table once: two weeks ahead, from the day it ran. Two weeks
 * later the forecast simply ended, and every panel that reads it went blank. It also scaled
 * a per-week rate down by 7 for an hour-of-week bucket that occurs once a week, so it
 * predicted a third of the calls that arrived, and its actuals were matched in the host's
 * time zone, so not one bucket was ever held to account.
 *
 * This is engines/demand.js's model, run over the database: for every community and every
 * hour, the exponentially weighted mean of the SAME hour on the SAME weekday in the weeks
 * before it (12-week half-life), with the Poisson 80% interval around it. Past hours are
 * forecast only from weeks that came before them, so the accuracy panel is a true backtest
 * rather than the model marking its own homework.
 *
 * Run by `npm run seed:derived` and by the server at start-up and every hour after.
 */

import { pool } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ewmaBaseRate, poissonQuantile, METHOD } from '../engines/demand.js';

const HOUR_MS = 3600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** Weeks of the same hour-of-week fed to the average — about two half-lives. */
const LOOKBACK_WEEKS = 26;
/** Past hours kept forecast and scored — the accuracy panel's 30-day window. */
const BACKTEST_DAYS = 30;
/** How far ahead the forecast runs — the Demand tab asks for at most 14 days. */
const AHEAD_DAYS = 14;
/** A community with fewer calls than this in the lookback is too sparse to forecast. */
const MIN_CALLS = 4;

/**
 * Recompute the forecast from BACKTEST_DAYS ago to AHEAD_DAYS ahead, and record what
 * actually arrived in every hour the history covers.
 *
 * @returns {{ rows: number, zones: number, scored: number }}
 */
export async function rollDemandForecast({ log = () => {} } = {}) {
  const hourNow = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const from = hourNow - BACKTEST_DAYS * 24 * HOUR_MS;
  const to = hourNow + AHEAD_DAYS * 24 * HOUR_MS;

  // Actuals only as far as the recorded history reaches. The history is carried forward at
  // start-up (db/seed/history.js), not continuously, so an hour after that point is not an
  // hour with no calls — it is an hour not yet written, and scoring it as zero would make
  // the model look biased high.
  const mark = await pool.query(`SELECT max(reported_at) AS mx FROM incidents WHERE is_seed`);
  const watermark = mark.rows[0]?.mx ? Math.floor(new Date(mark.rows[0].mx).getTime() / HOUR_MS) * HOUR_MS : from;
  const observedTo = Math.min(hourNow, watermark);   // first hour NOT fully observed

  const { rows: counts } = await pool.query(
    `SELECT i.zone_id AS "zoneId", floor(extract(epoch FROM i.reported_at) / 3600)::bigint AS h, COUNT(*)::int AS n
       FROM incidents i
       JOIN zones z ON z.id = i.zone_id
      WHERE i.is_seed AND z.level = 'community'
        AND i.reported_at >= $1 AND i.reported_at < $2
      GROUP BY 1, 2`,
    [new Date(from - LOOKBACK_WEEKS * WEEK_MS), new Date(observedTo)],
  );

  const byZone = new Map();
  for (const r of counts) {
    let m = byZone.get(r.zoneId);
    if (!m) byZone.set(r.zoneId, (m = new Map()));
    m.set(Number(r.h), r.n);
  }

  const zoneIds = [], buckets = [], predicted = [], lower = [], upper = [], actual = [];
  let zones = 0, scored = 0;
  for (const [zoneId, hours] of byZone) {
    let total = 0;
    for (const n of hours.values()) total += n;
    if (total < MIN_CALLS) continue;
    zones++;

    for (let b = from; b < to; b += HOUR_MS) {
      // The same hour on the same weekday, in each earlier week that has been observed —
      // an hour with no row had no calls, and that zero is data.
      const weekly = [];
      for (let k = 1; k <= LOOKBACK_WEEKS; k++) {
        const t = b - k * WEEK_MS;
        if (t >= observedTo) continue;
        weekly.push({ weeksAgo: weekly.length, count: hours.get(t / HOUR_MS) ?? 0 });
      }
      const lambda = ewmaBaseRate(weekly);
      if (lambda == null) continue;

      zoneIds.push(zoneId);
      buckets.push(new Date(b).toISOString());
      predicted.push(+lambda.toFixed(3));
      lower.push(poissonQuantile(lambda, 0.1));
      upper.push(poissonQuantile(lambda, 0.9));
      if (b + HOUR_MS <= observedTo) { actual.push(hours.get(b / HOUR_MS) ?? 0); scored++; }
      else actual.push(null);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Earlier versions wrote under another model name; two models for one hour would be
    // summed together by every reader of this table.
    await client.query('DELETE FROM demand_forecast WHERE model <> $1', [METHOD]);
    await client.query(
      `INSERT INTO demand_forecast (zone_id, bucket_start, bucket_hours, predicted, lower_80, upper_80, actual, model, computed_at)
       SELECT z, b, 1, p, lo, hi, a, $7, now()
         FROM unnest($1::uuid[], $2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::int[]) AS t(z, b, p, lo, hi, a)
       ON CONFLICT (zone_id, bucket_start, model) DO UPDATE SET
         predicted = EXCLUDED.predicted, lower_80 = EXCLUDED.lower_80, upper_80 = EXCLUDED.upper_80,
         actual = EXCLUDED.actual, computed_at = EXCLUDED.computed_at`,
      [zoneIds, buckets, predicted, lower, upper, actual, METHOD],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  log(`  forecasts     ${zoneIds.length.toLocaleString()} rows over ${zones} communities, ${scored.toLocaleString()} hours held to account`);
  return { rows: zoneIds.length, zones, scored };
}

let timer = null;

/** Keep the forecast current: once now (after the history catch-up, if any), then hourly. */
export function startDemandForecastLoop(after = Promise.resolve()) {
  const run = () => rollDemandForecast()
    .then((r) => logger.info(r, '[forecast] demand forecast rolled forward'))
    .catch((err) => logger.warn({ err: err.message }, '[forecast] demand forecast roll failed — the last one stands'));
  void after.catch(() => {}).then(run);
  timer = setInterval(run, HOUR_MS);
  timer.unref?.();
}
