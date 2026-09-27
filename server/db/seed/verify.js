/**
 * The honesty check.
 *
 * Prints the achieved aggregates against the published targets and FAILS on drift.
 * A seed that silently drifts away from its calibration produces analytics that look
 * authoritative and are not — which is worse than no analytics at all, because nobody
 * questions them.
 *
 * Targets: docs/09-DATA-AND-SEED.md §2, from ambulance.gov.ae open data and the
 * peer-reviewed clinical literature.
 */

import { one, many } from '../../lib/db.js';
import { jurisdiction } from '../../config/jurisdiction.js';

export async function verifySeed({ log = console.log }) {
  const checks = [];

  const add = (name, actual, target, tolerance, unit = '', note = '') => {
    const ok = actual != null && Math.abs(actual - target) <= tolerance;
    checks.push({ name, actual, target, tolerance, unit, ok, note });
  };

  // ── Volume ─────────────────────────────────────────────────────────────────
  const vol = await one(`
    SELECT COUNT(*)::int                                            AS n,
           MIN(reported_at)                                         AS first,
           MAX(reported_at)                                         AS last,
           COUNT(*) FILTER (WHERE is_seed)::int                     AS seeded
      FROM incidents`);

  const days = vol?.first
    ? (new Date(vol.last) - new Date(vol.first)) / 86_400_000
    : 0;
  const perDay = days > 0 ? vol.n / days : 0;
  const annualised = perDay * 365;

  // 2024 actual was 198,540; the window extrapolates forward at the observed growth.
  add('annualised call volume', Math.round(annualised), 216_400, 216_400 * 0.12, ' calls/yr',
      '2024 actual 198,540, extrapolated at the observed growth rate');

  // ── Response time — THE number the product is judged on ────────────────────
  const resp = await one(`
    SELECT AVG(EXTRACT(EPOCH FROM first_onscene_at - reported_at))::numeric       AS mean_sec,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_onscene_at - reported_at)) AS p50,
           PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_onscene_at - reported_at)) AS p90,
           COUNT(*)::int AS n
      FROM incidents
     WHERE first_onscene_at IS NOT NULL AND is_seed`);

  add('mean response time', round1(resp?.mean_sec / 60), 6.59, 0.45, ' min',
      '2024 published actual');
  add('p90 response time', round1(resp?.p90 / 60), 12.5, 3.0, ' min', 'reliability benchmark');

  // Critical-call median must be materially worse than the fleet mean — the published
  // OHCA figures make that explicit, and a seed that misses it is modelling the wrong
  // system.
  const ohca = await one(`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_onscene_at - reported_at)) AS p50,
           AVG(EXTRACT(EPOCH FROM first_onscene_at - reported_at))::numeric AS mean_sec,
           COUNT(*)::int AS n
      FROM incidents
     WHERE kind = 'cardiac_arrest' AND first_onscene_at IS NOT NULL AND is_seed`);

  add('cardiac arrest median response', round1(ohca?.p50 / 60), 9.0, 2.5, ' min',
      'PAROS / GCC systematic review');

  // ── Case mix — inside the bands the research gives ─────────────────────────
  const mix = await many(`
    SELECT kind, COUNT(*)::int n, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) pct
      FROM incidents WHERE is_seed GROUP BY kind ORDER BY n DESC`);

  const share = (kinds) => mix.filter((m) => kinds.includes(m.kind))
    .reduce((s, m) => s + Number(m.pct), 0);

  add('RTC + trauma share', round1(share(['rta', 'trauma_fall'])), 27, 6, '%',
      'research band: RTC and trauma 15–20% of CRITICAL volume');
  add('cardiac + respiratory share', round1(share(['cardiac', 'cardiac_arrest', 'respiratory'])),
      18, 5, '%', 'research band: 25–30% of critical volume');

  // ── Patient contacts per dispatch ──────────────────────────────────────────
  const pat = await one(`
    SELECT COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM incidents WHERE is_seed), 0) AS ratio,
           AVG(CASE WHEN sex = 'M' THEN 1.0 ELSE 0.0 END) AS male_share
      FROM patients p JOIN incidents i ON i.id = p.incident_id WHERE i.is_seed`);

  add('patient contacts per dispatch', round2(pat?.ratio), 1.05, 0.04, '',
      'derived: 4–6% of dispatches are multi-casualty');
  add('male patient share', round1(pat?.male_share * 100), 64, 3, '%',
      'reflects the expatriate workforce demographic');

  // ── Transport rate ─────────────────────────────────────────────────────────
  const trans = await one(`
    SELECT 100.0 * COUNT(*) FILTER (WHERE outcome = 'transported') / NULLIF(COUNT(*), 0) AS pct
      FROM incidents WHERE is_seed AND closed_at IS NOT NULL`);
  add('transport rate', round1(trans?.pct), 57, 8, '%',
      '2023: 96,463 transports from 169,556 emergency calls');

  // ── Vertical Response Time ─────────────────────────────────────────────────
  const vrt = await one(`
    SELECT AVG(vrt_sec)::numeric AS mean_sec, COUNT(*)::int AS n
      FROM assignments a JOIN incidents i ON i.id = a.incident_id
     WHERE a.vrt_sec IS NOT NULL AND i.floor >= 20 AND i.is_seed`);
  add('VRT above floor 20', round1(vrt?.mean_sec / 60), 6.0, 2.0, ' min',
      'research: 4–8 min in Dubai high-rise clusters');

  // ── Structural integrity ───────────────────────────────────────────────────
  const orphans = await one(`
    SELECT (SELECT COUNT(*)::int FROM assignments WHERE incident_id IS NULL)           AS asg,
           (SELECT COUNT(*)::int FROM incidents WHERE zone_id IS NULL AND is_seed)     AS no_zone,
           (SELECT COUNT(*)::int FROM incidents
             WHERE is_seed AND first_onscene_at IS NOT NULL AND first_onscene_at < reported_at) AS time_travel,
           (SELECT COUNT(*)::int FROM incidents
             WHERE is_seed AND first_at_patient_at IS NOT NULL
               AND first_at_patient_at < first_onscene_at)                             AS vrt_negative`);

  checks.push({ name: 'no orphaned assignments', actual: orphans.asg, target: 0, ok: orphans.asg === 0, unit: '' });
  checks.push({ name: 'every incident in a zone', actual: orphans.no_zone, target: 0, ok: orphans.no_zone === 0, unit: ' unassigned' });
  checks.push({ name: 'no on-scene before reported', actual: orphans.time_travel, target: 0, ok: orphans.time_travel === 0, unit: '' });
  checks.push({ name: 'no at-patient before on-scene', actual: orphans.vrt_negative, target: 0, ok: orphans.vrt_negative === 0, unit: '' });

  // ── Fleet is genuinely busy ────────────────────────────────────────────────
  const busy = await one(`
    SELECT COUNT(DISTINCT unit_id)::int AS units_used,
           (SELECT COUNT(*)::int FROM units u JOIN agencies a ON a.id=u.agency_id WHERE a.code='DCAS') AS total
      FROM assignments`);
  const coverage = busy.total ? (busy.units_used / busy.total) * 100 : 0;
  checks.push({
    name: 'fleet utilisation breadth', actual: round1(coverage), target: 95,
    ok: coverage >= 85, unit: '% of units used',
    note: 'a unit that never ran a job means the dispatch simulation is not exercising the fleet',
  });

  // ── Report ─────────────────────────────────────────────────────────────────
  const width = Math.max(...checks.map((c) => c.name.length));
  log('');
  for (const c of checks) {
    const mark = c.ok ? '[32mPASS[0m' : '[31mFAIL[0m';
    const actual = `${c.actual ?? '—'}${c.unit}`;
    const target = c.tolerance !== undefined
      ? `target ${c.target}${c.unit} ±${round2(c.tolerance)}`
      : `expected ${c.target}`;
    log(`  ${mark}  ${c.name.padEnd(width)}  ${String(actual).padStart(14)}   ${target}`);
    if (!c.ok && c.note) log(`        ${c.note}`);
  }

  log('');
  log('  Case mix as generated:');
  for (const m of mix.slice(0, 8)) {
    log(`    ${String(m.pct).padStart(5)}%  ${m.kind.replace(/_/g, ' ')}  (${m.n.toLocaleString()})`);
  }

  const failed = checks.filter((c) => !c.ok);
  log('');
  log(failed.length
    ? `  [31m${failed.length} of ${checks.length} checks failed[0m`
    : `  [32mAll ${checks.length} calibration checks pass[0m`);

  return { ok: failed.length === 0, checks, mix };
}

const round1 = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 10) / 10);
const round2 = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
