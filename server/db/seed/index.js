#!/usr/bin/env node
/**
 * Seed orchestrator.
 *
 *   npm run seed              full rebuild
 *   npm run seed:reference    zones, facilities, fleet, Makani, users — fast
 *   npm run seed:history      regenerate the 24 months
 *   npm run seed:derived      recompute forecasts, risk cells, rankings, KPI snapshots
 *   npm run seed:reset        remove everything a scenario created
 *   npm run seed:verify       assert the calibration targets, print the report
 *
 * Idempotent, deterministic (fixed RNG seed), and re-runnable. This is a first-class
 * deliverable, not a throwaway script: every analytics, ranking and forecasting screen
 * is only as credible as what it produces.
 */

import { env } from '../../config/env.js';
import { query, one, close, dbTarget } from '../../lib/db.js';
import { seedReference } from './reference.js';
import { seedWeatherAndEvents } from './weather.js';
import { seedHistory, extendHistory } from './history.js';
import { seedDerived } from './derived.js';
import { verifySeed } from './verify.js';
import { restoreRestingState } from './resting.js';

const MODE = process.argv[2] ?? 'all';

const t0 = Date.now();
const log = (...a) => console.log(...a);
const step = (name) => {
  const s = Date.now();
  return (extra = '') => log(`  ✓ ${name}${extra ? ` — ${extra}` : ''} (${((Date.now() - s) / 1000).toFixed(1)}s)`);
};

async function main() {
  log(`\n  ERSS seed — mode "${MODE}" → ${dbTarget}`);
  log(`  rng="${env.seed.rng}"  months=${env.seed.months}\n`);

  await assertSchema();

  switch (MODE) {
    case 'all':
      await runReference();
      await runWeather();
      await runHistory();
      await runDerived();
      await runVerify();
      await runResting();   // last, so its incidents are relative to when the seed finished
      break;
    case 'reference': await runReference(); break;
    case 'weather':   await runWeather(); break;
    case 'history':   await runHistory(); await runDerived(); break;
    case 'derived':   await runDerived(); break;
    case 'verify':    await runVerify(); break;
    case 'resting':   await runResting(); break;
    case 'reset':     await runReset(); break;
    case 'catchup': {
      log('  History catch-up (carries the seeded history forward to now)');
      const r = await extendHistory({ rngSeed: env.seed.rng, log });
      log(r.skipped ? `  nothing to do — ${r.skipped}` : `  ✓ ${r.incidents} incidents since ${r.from}`);
      break;
    }
    default:
      console.error(`  unknown mode "${MODE}" — expected all|reference|weather|history|derived|verify|resting|reset|catchup`);
      process.exitCode = 2;
      return;
  }

  log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

/** Fail with an instruction rather than a wall of "relation does not exist". */
async function assertSchema() {
  try {
    const row = await one(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('zones','incidents','units','agencies')`,
    );
    if ((row?.n ?? 0) < 4) {
      console.error('\n  The schema has not been applied.\n');
      console.error('    npm run db:schema');
      console.error('    npm run db:views\n');
      process.exit(1);
    }
    const gis = await one(`SELECT extversion FROM pg_extension WHERE extname='postgis'`);
    if (!gis) {
      console.error('\n  PostGIS is not enabled on this database.');
      console.error('  It does not ship with PostgreSQL — install via Application Stack Builder,');
      console.error('  then run ops/scripts/setup-db.ps1\n');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n  Cannot reach the database at ${dbTarget}`);
    console.error(`  ${err.message}`);
    console.error('\n  Check server/.env, or run ops/scripts/setup-db.ps1\n');
    process.exit(1);
  }
}

async function runReference() {
  log('  Reference data');
  const done = step('reference');
  const r = await seedReference({ rngSeed: env.seed.rng, log });
  done(`${r.zones} zones, ${r.makani} Makani points`);
}

async function runWeather() {
  log('\n  Weather & events');
  const done = step('weather + events');
  const r = await seedWeatherAndEvents({ rngSeed: env.seed.rng, months: env.seed.months, log });
  done(`${r.hours} hours, ${r.events} events`);
}

async function runHistory() {
  log('\n  Operational history');
  const done = step('history');
  const r = await seedHistory({ rngSeed: env.seed.rng, months: env.seed.months, log });
  done(`${r.incidents.toLocaleString()} incidents, ${r.assignments.toLocaleString()} assignments`);
}

async function runDerived() {
  log('\n  Derived analytics');
  const done = step('derived');
  const r = await seedDerived({ rngSeed: env.seed.rng, log });
  done(`${r.forecasts} forecast rows, ${r.riskCells} risk cells, ${r.advisories} advisories`);
}

async function runVerify() {
  log('\n  Verification');
  const report = await verifySeed({ log });
  if (!report.ok) {
    console.error('\n  [31mCALIBRATION FAILED[0m — the seed does not match its published targets.');
    console.error('  A seed that silently drifts produces analytics that look authoritative and are not.\n');
    process.exitCode = 1;
  }
}

/**
 * Remove everything scenario runs created. Seeded history (is_seed = true) is NEVER
 * touched, so a demo can be run, reset and re-run indefinitely without the analytics
 * drifting.
 */
async function runReset() {
  log('  Resetting scenario data (seeded history is untouched)');

  const before = await one(`SELECT COUNT(*)::int n FROM incidents WHERE run_id IS NOT NULL`);

  await query(`DELETE FROM telemetry     WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM patients      WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM preempt_events WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM unit_positions WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM assignments   WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM advisories    WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM incidents     WHERE run_id IS NOT NULL`);
  await query(`UPDATE scenario_runs SET state='ended', ended_at=now() WHERE state IN ('running','paused')`);
  log(`  removed ${before?.n ?? 0} scenario incidents and their descendants`);

  // Fleet and mid-flight incidents back to the resting state, relative to now.
  await restoreRestingState({ rngSeed: env.seed.rng, log });
}

async function runResting() {
  log('\n  Resting state');
  await restoreRestingState({ rngSeed: env.seed.rng, log });
}

main()
  .catch((err) => {
    console.error(`\n  seed failed: ${err.message}`);
    if (process.env.LOG_LEVEL === 'debug') console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => close());
