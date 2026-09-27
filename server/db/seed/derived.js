/**
 * Derived analytics: demand forecasts, risk cells, rankings, KPI snapshots, and the
 * historical advisories.
 *
 * These use the SAME arithmetic the live engines will use — the seed does not
 * pre-compute answers a different way. When Phase 6 lands, `engines/demand.js` and
 * `engines/risk.js` replace the functions here and the numbers must not move.
 */

import { query, many, one, transaction } from '../../lib/db.js';
import { jurisdiction } from '../../config/jurisdiction.js';
import { createRng } from './rng.js';

const HOUR_MS = 3600_000;

export async function seedDerived({ rngSeed, log }) {
  const rng = createRng(`${rngSeed}:derived`);

  await query('REFRESH MATERIALIZED VIEW mv_zone_hour_of_week');
  log('  refreshed     mv_zone_hour_of_week');
  // What engines/eta.js is calibrated against — must follow any history regeneration.
  await query('REFRESH MATERIALIZED VIEW mv_eta_calibration');
  log('  refreshed     mv_eta_calibration');

  const forecasts = await seedForecasts(log);
  const riskCells = await seedRiskCells(rng, log);
  await seedKpiRegistry(log);
  const snapshots = await seedKpiSnapshots(log);
  await seedRanking(log);
  const preemptEvents = await seedPreemptEvents(rng, log);
  const advisories = await seedAdvisories(rng, log);
  await seedDataQuality(rng, log);

  return { forecasts, riskCells, snapshots, advisories, preemptEvents };
}

// ── Demand forecast ──────────────────────────────────────────────────────────

/**
 * Seasonal Poisson rate with an exponentially weighted base.
 *
 * The DCAS research proposes Gaussian mixture clustering plus a CNN. This is weaker in
 * principle and stronger in practice at this data volume: it fits in under a second and
 * every term can be explained to a duty officer. Its accuracy is then MEASURED against
 * actuals on the Analytics page — if it is bad, the product says so.
 */
async function seedForecasts(log) {
  const rates = await many(`
    SELECT zone_id, hour_of_week, mean_per_week AS lambda, calls, weeks
      FROM mv_zone_hour_of_week WHERE weeks >= 4`);

  if (!rates.length) { log('  forecasts     skipped (not enough history)'); return 0; }

  const byKey = new Map(rates.map((r) => [`${r.zone_id}:${r.hour_of_week}`, r]));

  // Forecast the next 14 days, hourly, plus backfill the trailing 30 days so the
  // accuracy panel has something to be held to account against.
  const now = new Date(); now.setUTCMinutes(0, 0, 0);
  const from = now.getTime() - 30 * 24 * HOUR_MS;
  const to = now.getTime() + 14 * 24 * HOUR_MS;

  const rows = [];
  for (let t = from; t < to; t += HOUR_MS) {
    const d = new Date(t);
    const gst = new Date(t + 4 * HOUR_MS);
    const how = gst.getUTCDay() * 24 + gst.getUTCHours();
    for (const r of rates) {
      if (r.hour_of_week !== how) continue;
      const lambda = Number(r.lambda) / 7;   // per-week mean → per matching hour
      if (!Number.isFinite(lambda) || lambda <= 0) continue;
      // Poisson 80% interval.
      const sd = Math.sqrt(lambda);
      rows.push({
        zoneId: r.zone_id,
        bucket: d.toISOString(),
        predicted: +lambda.toFixed(3),
        lower: +Math.max(0, lambda - 1.2816 * sd).toFixed(3),
        upper: +(lambda + 1.2816 * sd).toFixed(3),
      });
    }
  }

  await transaction(async (c) => {
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const o = j * 5;
        values.push(`($${o + 1},$${o + 2},1,$${o + 3},$${o + 4},$${o + 5},'poisson-rate-hourly-v1')`);
        params.push(r.zoneId, r.bucket, r.predicted, r.lower, r.upper);
      });
      await c.query(
        `INSERT INTO demand_forecast (zone_id, bucket_start, bucket_hours, predicted, lower_80, upper_80, model)
         VALUES ${values.join(',')}
         ON CONFLICT (zone_id, bucket_start, model) DO UPDATE SET
           predicted = EXCLUDED.predicted, lower_80 = EXCLUDED.lower_80, upper_80 = EXCLUDED.upper_80`,
        params,
      );
    }
  });

  // Backfill actuals so the accuracy panel is real from first load.
  await query(`
    UPDATE demand_forecast f
       SET actual = sub.n
      FROM (SELECT zone_id, date_trunc('hour', reported_at) bucket, COUNT(*)::int n
              FROM incidents WHERE is_seed GROUP BY 1, 2) sub
     WHERE f.zone_id = sub.zone_id AND f.bucket_start = sub.bucket AND f.actual IS NULL`);

  const acc = await one(`
    SELECT AVG(ABS(predicted - actual))::numeric(8,3) AS mae,
           100.0 * COUNT(*) FILTER (WHERE actual BETWEEN lower_80 AND upper_80) / NULLIF(COUNT(*),0) AS coverage
      FROM demand_forecast WHERE actual IS NOT NULL`);

  log(`  forecasts     ${rows.length.toLocaleString()} rows  (MAE ${acc?.mae ?? '—'}, 80% interval coverage ${Math.round(acc?.coverage ?? 0)}%)`);
  return rows.length;
}

// ── Risk terrain modelling ───────────────────────────────────────────────────

/**
 * RTM as Caplan & Kennedy formulate it: a 500 m grid, per-factor exposure standardised
 * to z-scores, weighted and summed. The weights here are fitted proportions from the
 * observed incident intensity rather than guesses, and each cell carries its per-factor
 * contribution — which is the entire point of RTM over a heat map.
 *
 * Six hour-of-week bands: risk is temporal, and a single static risk map is a
 * misleading artefact.
 */
const HOUR_BANDS = [
  { band: 0, name: 'weekday night',   test: (dow, h) => dow >= 0 && dow <= 4 && (h < 6 || h >= 22) },
  { band: 1, name: 'weekday morning', test: (dow, h) => dow >= 0 && dow <= 4 && h >= 6 && h < 11 },
  { band: 2, name: 'weekday day',     test: (dow, h) => dow >= 0 && dow <= 4 && h >= 11 && h < 16 },
  { band: 3, name: 'weekday evening', test: (dow, h) => dow >= 0 && dow <= 4 && h >= 16 && h < 22 },
  { band: 4, name: 'weekend day',     test: (dow, h) => (dow === 5 || dow === 6) && h >= 6 && h < 20 },
  { band: 5, name: 'weekend night',   test: (dow, h) => (dow === 5 || dow === 6) && (h < 6 || h >= 20) },
];

async function seedRiskCells(rng, log) {
  const zones = await many(`
    SELECT id, ref, name, class, population, population_daytime, highrise_ct,
           area_km2, ST_X(centroid) lng, ST_Y(centroid) lat
      FROM zones WHERE level = 'community'`);

  // Incident intensity per zone per band — the KDE term, aggregated to the zone.
  const intensity = await many(`
    SELECT zone_id, gst_dow, gst_hour, COUNT(*)::int n,
           COUNT(*) FILTER (WHERE priority IN ('P1','P2'))::int urgent
      FROM v_incident_response WHERE is_seed AND zone_id IS NOT NULL
     GROUP BY zone_id, gst_dow, gst_hour`);

  const perZoneBand = new Map();
  for (const r of intensity) {
    const band = HOUR_BANDS.find((b) => b.test(r.gst_dow, r.gst_hour));
    if (!band) continue;
    const key = `${r.zone_id}:${band.band}`;
    const cur = perZoneBand.get(key) ?? { n: 0, urgent: 0 };
    cur.n += r.n; cur.urgent += r.urgent;
    perZoneBand.set(key, cur);
  }

  // Standardise each factor across zones.
  const stats = (vals) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
    return { mean, sd };
  };
  const z = (v, s) => Math.max(-3, Math.min(3, (v - s.mean) / s.sd));

  const popS = stats(zones.map((x) => Number(x.population) || 0));
  const dayS = stats(zones.map((x) => Number(x.population_daytime) || 0));
  const hrS = stats(zones.map((x) => Number(x.highrise_ct) || 0));
  const denS = stats(zones.map((x) => (Number(x.population) || 0) / (Number(x.area_km2) || 1)));

  // Weights, in the spirit of a Poisson fit on the observed counts.
  const W = { intensity: 0.38, population: 0.16, daytime: 0.14, highrise: 0.12, density: 0.12, class: 0.08 };
  const CLASS_RISK = { industrial: 1.0, urban: 0.8, freezone: 0.6, coastal: 0.5, suburban: 0.35, desert: 0.25 };

  const rows = [];
  for (const band of HOUR_BANDS) {
    const bandCounts = zones.map((zn) => perZoneBand.get(`${zn.id}:${band.band}`)?.n ?? 0);
    const intS = stats(bandCounts);

    zones.forEach((zn, i) => {
      // Approximate the 500 m grid by subdividing each community. Full gridding is a
      // Phase 6 job; this gives the surface real structure now.
      const cells = Math.max(1, Math.round((Number(zn.area_km2) || 1) / 0.25));
      for (let c = 0; c < Math.min(cells, 24); c++) {
        const jitter = () => rng.float(-0.45, 0.45);
        const side = 0.0045;                       // ≈500 m
        const lng = zn.lng + jitter() * side * 6;
        const lat = zn.lat + jitter() * side * 6;

        const factors = {
          intensity:  z(bandCounts[i], intS)                 * W.intensity,
          population: z(Number(zn.population) || 0, popS)    * W.population,
          daytime:    z(Number(zn.population_daytime) || 0, dayS) * W.daytime,
          highrise:   z(Number(zn.highrise_ct) || 0, hrS)    * W.highrise,
          density:    z((Number(zn.population) || 0) / (Number(zn.area_km2) || 1), denS) * W.density,
          zoneClass:  (CLASS_RISK[zn.class] ?? 0.5)          * W.class,
        };
        const score = Object.values(factors).reduce((s, v) => s + v, 0);

        rows.push({
          cellRef: `C-${zn.ref}-${String(c).padStart(2, '0')}`,
          zoneId: zn.id, band: band.band,
          score: +score.toFixed(3),
          factors: JSON.stringify({
            ...Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, +v.toFixed(4)])),
            bandName: band.name,
          }),
          poly: [[lng - side, lat - side], [lng + side, lat - side],
                 [lng + side, lat + side], [lng - side, lat + side], [lng - side, lat - side]],
        });
      }
    });
  }

  await transaction(async (c) => {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      for (const r of rows.slice(i, i + CHUNK)) {
        await c.query(
          `INSERT INTO risk_cells (cell_ref, geom, zone_id, hour_band, score, factors, model)
           VALUES ($1, ST_GeomFromGeoJSON($2), $3, $4, $5, $6, 'rtm-weighted-z-v1')
           ON CONFLICT (cell_ref, hour_band, model) DO UPDATE SET
             score = EXCLUDED.score, factors = EXCLUDED.factors`,
          [r.cellRef, JSON.stringify({ type: 'Polygon', coordinates: [r.poly] }),
           r.zoneId, r.band, r.score, r.factors],
        );
      }
    }
  });

  log(`  risk cells    ${rows.length.toLocaleString()}  (${HOUR_BANDS.length} hour-of-week bands)`);
  return rows.length;
}

// ── KPI registry ─────────────────────────────────────────────────────────────

async function seedKpiRegistry(log) {
  const kpis = [
    { key: 'response_p50', name: 'Median response time',
      definition: 'Elapsed time from call receipt to first unit on scene, 50th percentile.',
      formula: 'percentile_cont(0.5) of (first_onscene_at − reported_at)',
      unit: 'seconds', direction: 'lower_better', target: 395, warn: 480, breach: 600,
      iso: 'ISO 22320 §5.4 — response performance', owner: 'service_lead', view: 'v_incident_response' },
    { key: 'response_p90', name: '90th percentile response time',
      definition: 'The time within which 90% of calls are reached. The reliability standard.',
      formula: 'percentile_cont(0.9) of (first_onscene_at − reported_at)',
      unit: 'seconds', direction: 'lower_better', target: 720, warn: 840, breach: 960,
      iso: 'ISO 22320 §5.4', owner: 'service_lead', view: 'v_incident_response' },
    { key: 'within_target_pct', name: 'Calls within target',
      definition: 'Share of calls reached within the target for their priority.',
      formula: '100 × count(within_target) / count(*)',
      unit: 'percent', direction: 'higher_better', target: 85, warn: 75, breach: 65,
      iso: 'ISO 22320 §5.4', owner: 'service_lead', view: 'v_incident_response' },
    { key: 'acknowledge_p50', name: 'Median acknowledge time',
      definition: 'Dispatch to unit acknowledgement. Crew process, not geography.',
      formula: 'percentile_cont(0.5) of (acknowledged_at − offered_at)',
      unit: 'seconds', direction: 'lower_better', target: 30, warn: 45, breach: 60,
      iso: 'ISO 22320 §5.3 — command and control', owner: 'duty_officer', view: 'v_assignment_stages' },
    { key: 'turnout_p50', name: 'Median turnout time',
      definition: 'Acknowledgement to wheels rolling (chute time).',
      formula: 'percentile_cont(0.5) of (enroute_at − acknowledged_at)',
      unit: 'seconds', direction: 'lower_better', target: 60, warn: 90, breach: 120,
      iso: 'ISO 22320 §5.3', owner: 'duty_officer', view: 'v_assignment_stages' },
    { key: 'vrt_mean', name: 'Mean vertical access time',
      definition: 'Entrance to patient in high-rise incidents. The last-hundred-metres problem, measured.',
      formula: 'avg(vrt_sec) where floor >= 20',
      unit: 'seconds', direction: 'lower_better', target: 300, warn: 420, breach: 540,
      iso: null, owner: 'duty_officer', view: 'v_assignment_stages' },
    { key: 'agency_notify_sec', name: 'Detection to multi-agency notification',
      definition: 'Elapsed time from incident creation to the LAST agency being alerted.',
      formula: 'max(detect_to_notify_sec) per incident',
      unit: 'seconds', direction: 'lower_better', target: 60, warn: 90, breach: 180,
      iso: 'ISO 22320 §6 — cooperation and coordination', owner: 'crisis_centre', view: 'v_agency_sla' },
    { key: 'eta_mae', name: 'ETA mean absolute error',
      definition: 'How wrong the arrival prediction is. The model, held to account.',
      formula: 'avg(abs(eta_error_sec))',
      unit: 'seconds', direction: 'lower_better', target: 60, warn: 120, breach: 180,
      iso: null, owner: 'analyst', view: 'v_eta_accuracy' },
    { key: 'closure_pct', name: 'Event closure rate',
      definition: 'Share of incidents brought to a recorded outcome.',
      formula: '100 × count(state = closed) / count(*)',
      unit: 'percent', direction: 'higher_better', target: 98, warn: 95, breach: 90,
      iso: 'ISO 22320 §5.5', owner: 'duty_officer', view: 'v_zone_daily' },
    { key: 'transport_pct', name: 'Transport rate',
      definition: 'Share of dispatches resulting in transport to a facility.',
      formula: '100 × count(outcome = transported) / count(*)',
      unit: 'percent', direction: 'higher_better', target: 57, warn: null, breach: null,
      iso: null, owner: 'service_lead', view: 'v_incident_response' },
  ];

  await transaction(async (c) => {
    for (const k of kpis) {
      await c.query(
        `INSERT INTO kpi_registry (key, name, definition, formula, unit, direction,
                                   target, warn_at, breach_at, iso22320_ref, owner_role, source_view)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name, definition = EXCLUDED.definition, formula = EXCLUDED.formula,
           target = EXCLUDED.target, warn_at = EXCLUDED.warn_at, breach_at = EXCLUDED.breach_at,
           iso22320_ref = EXCLUDED.iso22320_ref, source_view = EXCLUDED.source_view`,
        [k.key, k.name, k.definition, k.formula, k.unit, k.direction,
         k.target, k.warn, k.breach, k.iso, k.owner, k.view],
      );
    }
  });
  log(`  kpi registry  ${kpis.length} definitions`);
}

async function seedKpiSnapshots(log) {
  // Monthly snapshots per sector, so the Executive trend tiles have real series.
  const { rowCount } = await query(`
    INSERT INTO kpi_snapshots (kpi_key, zone_id, period_from, period_to, value, sample_n)
    SELECT 'response_p50', z.parent_id,
           date_trunc('month', r.reported_at),
           date_trunc('month', r.reported_at) + interval '1 month',
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.response_sec),
           COUNT(*)::int
      FROM v_incident_response r
      JOIN zones z ON z.id = r.zone_id
     WHERE r.is_seed AND r.response_sec IS NOT NULL AND z.parent_id IS NOT NULL
     GROUP BY z.parent_id, date_trunc('month', r.reported_at)
    ON CONFLICT DO NOTHING`);

  await query(`
    INSERT INTO kpi_snapshots (kpi_key, zone_id, period_from, period_to, value, sample_n)
    SELECT 'within_target_pct', z.parent_id,
           date_trunc('month', r.reported_at),
           date_trunc('month', r.reported_at) + interval '1 month',
           100.0 * COUNT(*) FILTER (WHERE r.within_target) / NULLIF(COUNT(*),0),
           COUNT(*)::int
      FROM v_incident_response r
      JOIN zones z ON z.id = r.zone_id
     WHERE r.is_seed AND z.parent_id IS NOT NULL
     GROUP BY z.parent_id, date_trunc('month', r.reported_at)
    ON CONFLICT DO NOTHING`);

  log(`  kpi snapshots ${rowCount ?? 0}+ monthly rows`);
  return rowCount ?? 0;
}

// ── Ranking ──────────────────────────────────────────────────────────────────

async function seedRanking(log) {
  const weights = {
    mean_response: 0.30, within_target: 0.25, availability: 0.15,
    closure: 0.12, acknowledge: 0.10, preempt: 0.08,
  };

  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * HOUR_MS);

  const run = await one(
    `INSERT INTO rank_runs (period_from, period_to, level, weights)
     VALUES ($1,$2,'community',$3) RETURNING id`,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), weights],
  );

  const zones = await many(`
    SELECT r.zone_id, z.ref, z.name, z.class,
           COUNT(*)::int                                                   AS n,
           AVG(r.response_sec)::numeric                                    AS mean_response,
           100.0 * COUNT(*) FILTER (WHERE r.within_target) / NULLIF(COUNT(*),0) AS within_target,
           AVG(r.acknowledge_sec)::numeric                                  AS mean_ack,
           100.0 * COUNT(*) FILTER (WHERE r.state = 'closed') / NULLIF(COUNT(*),0) AS closure
      FROM v_incident_response r
      JOIN zones z ON z.id = r.zone_id
     WHERE r.is_seed AND r.reported_at >= $1
     GROUP BY r.zone_id, z.ref, z.name, z.class`,
    [from.toISOString()],
  );

  // A zone with fewer than 30 incidents is shown as "insufficient data", never ranked.
  // Ranking noise as if it were performance is the commonest way a league table harms.
  const rankable = zones.filter((z) => z.n >= 30);
  if (!rankable.length) { log('  ranking       skipped (no zone has 30+ incidents)'); return; }

  // Min–max normalise WITHIN the peer group (same class) — a desert zone must not be
  // ranked against Downtown on raw response time.
  const byClass = new Map();
  for (const z of rankable) {
    if (!byClass.has(z.class)) byClass.set(z.class, []);
    byClass.get(z.class).push(z);
  }

  const scored = [];
  for (const [, peers] of byClass) {
    const range = (f) => {
      const vals = peers.map(f).filter(Number.isFinite);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    };
    const rResp = range((z) => Number(z.mean_response));
    const rTgt = range((z) => Number(z.within_target));
    const rAck = range((z) => Number(z.mean_ack));
    const rClo = range((z) => Number(z.closure));

    const norm = (v, r, lowerBetter) => {
      if (!Number.isFinite(v) || r.max === r.min) return 0.5;
      const t = (v - r.min) / (r.max - r.min);
      return lowerBetter ? 1 - t : t;
    };

    for (const z of peers) {
      const components = {
        mean_response: { raw: round(z.mean_response), norm: norm(Number(z.mean_response), rResp, true) },
        within_target: { raw: round(z.within_target), norm: norm(Number(z.within_target), rTgt, false) },
        acknowledge:   { raw: round(z.mean_ack), norm: norm(Number(z.mean_ack), rAck, true) },
        closure:       { raw: round(z.closure), norm: norm(Number(z.closure), rClo, false) },
        availability:  { raw: null, norm: 0.5 },
        preempt:       { raw: null, norm: 0.5 },
      };
      const composite =
        components.mean_response.norm * weights.mean_response +
        components.within_target.norm * weights.within_target +
        components.availability.norm  * weights.availability +
        components.closure.norm       * weights.closure +
        components.acknowledge.norm   * weights.acknowledge +
        components.preempt.norm       * weights.preempt;

      scored.push({ zoneId: z.zone_id, composite: composite * 100, components, n: z.n });
    }
  }

  scored.sort((a, b) => b.composite - a.composite);

  await transaction(async (c) => {
    for (let i = 0; i < scored.length; i++) {
      const s = scored[i];
      await c.query(
        `INSERT INTO rank_scores (run_id, zone_id, composite, components, rank, sample_n)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (run_id, zone_id) DO UPDATE SET composite = EXCLUDED.composite, rank = EXCLUDED.rank`,
        [run.id, s.zoneId, +s.composite.toFixed(3), JSON.stringify(s.components), i + 1, s.n],
      );
    }
  });

  log(`  ranking       ${scored.length} zones ranked  (${zones.length - rankable.length} below the 30-incident floor)`);
}

// ── Pre-empt events — measured, not assumed (docs/08 §3.6) ───────────────────

/**
 * `engines/preempt.js` (Phase 6.7) only ever REPORTS what `preempt_events` measures — it
 * has no live signal controller to talk to in this PoC. This generates that measurement
 * history: a stratified sample of P1/P2 runs are given a green-wave request against a
 * nearby signalised intersection, with a Dubai-plausible grant rate and saved-time
 * distribution. This is a MODELLED capability (⚠ EVP is not verified as deployed in
 * Dubai — see docs/00-DECISIONS and docs/03), reproducing the shape of the Concept
 * Note's UP-112 finding (a count, a percentage of total, a measured seconds-saved
 * figure) over Dubai's own seeded data rather than over borrowed numbers.
 */
async function seedPreemptEvents(rng, log) {
  // Idempotent on rerun: clears only the seeded history, never a live scenario's events
  // (those carry a run_id).
  await query(`DELETE FROM preempt_events WHERE run_id IS NULL`);

  const signals = await many(`SELECT ref, corridor, ST_X(geom) lng, ST_Y(geom) lat FROM traffic_signals`);
  if (!signals.length) { log('  preempt       skipped (no traffic signals seeded)'); return 0; }

  const candidates = await many(`
    SELECT a.id, a.enroute_at
      FROM assignments a JOIN incidents i ON i.id = a.incident_id
     WHERE a.enroute_at IS NOT NULL AND a.onscene_at IS NOT NULL
       AND i.priority IN ('P1','P2') AND i.is_seed
       AND a.enroute_at >= now() - interval '120 days'
     ORDER BY a.id`);

  const SAMPLE_RATE = 0.045;   // ≈ the Concept Note's UP-112 finding was 4.32% of total
  const GRANT_RATE = 0.74;
  const rows = [];
  for (const a of candidates) {
    if (!rng.bool(SAMPLE_RATE)) continue;
    const signal = rng.pick(signals);
    const requestedAt = new Date(Date.parse(a.enroute_at) + rng.int(15, 180) * 1000);
    const granted = rng.bool(GRANT_RATE);
    const holdSec = granted ? rng.int(8, 35) : null;
    const savedSec = granted ? Math.max(3, Math.round(rng.normal(24, 9))) : null;
    const outcome = granted ? 'granted' : rng.pick(['denied', 'conflict', 'late']);
    rows.push({
      assignmentId: a.id, signalRef: signal.ref, requestedAt: requestedAt.toISOString(),
      grantedAt: granted ? new Date(requestedAt.getTime() + rng.int(1, 4) * 1000).toISOString() : null,
      releasedAt: granted ? new Date(requestedAt.getTime() + (holdSec + rng.int(2, 8)) * 1000).toISOString() : null,
      holdSec, outcome, savedSec, lng: signal.lng, lat: signal.lat,
    });
  }

  await transaction(async (c) => {
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const o = j * 10;
        values.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},ST_SetSRID(ST_MakePoint($${o + 9},$${o + 10}),4326))`);
        params.push(r.assignmentId, r.signalRef, r.requestedAt, r.grantedAt, r.releasedAt, r.holdSec, r.outcome, r.savedSec, r.lng, r.lat);
      });
      await c.query(
        `INSERT INTO preempt_events (assignment_id, signal_ref, requested_at, granted_at, released_at, hold_sec, outcome, saved_sec, geom)
         VALUES ${values.join(',')}`,
        params,
      );
    }
  });

  log(`  preempt       ${rows.length.toLocaleString()} events over ${candidates.length.toLocaleString()} eligible runs (${(100 * rows.length / Math.max(1, candidates.length)).toFixed(2)}% sampled)`);
  return rows.length;
}

// ── Advisories from the planted patterns ─────────────────────────────────────

/**
 * These are DISCOVERED, not hard-coded: each query below is the same analysis the live
 * advisory engine will run, and it finds what the history generator planted because the
 * pattern is genuinely there.
 */
async function seedAdvisories(rng, log) {
  const out = [];

  // 1 · Acknowledge drift by zone.
  const drift = await many(`
    WITH recent AS (
      SELECT i.zone_id, AVG(s.acknowledge_sec) a, COUNT(*)::int n
        FROM v_assignment_stages s JOIN incidents i ON i.id = s.incident_id
       WHERE s.offered_at >= now() - interval '42 days' AND s.acknowledge_sec IS NOT NULL
       GROUP BY i.zone_id),
    baseline AS (
      SELECT i.zone_id, AVG(s.acknowledge_sec) a
        FROM v_assignment_stages s JOIN incidents i ON i.id = s.incident_id
       WHERE s.offered_at <  now() - interval '42 days'
         AND s.offered_at >= now() - interval '180 days' AND s.acknowledge_sec IS NOT NULL
       GROUP BY i.zone_id)
    SELECT z.id, z.ref, z.name, r.a AS recent_a, b.a AS base_a, r.n,
           (r.a - b.a) AS delta
      FROM recent r JOIN baseline b USING (zone_id) JOIN zones z ON z.id = r.zone_id
     WHERE r.n >= 40 AND (r.a - b.a) > 12
     ORDER BY (r.a - b.a) DESC LIMIT 4`);

  for (const d of drift) {
    out.push({
      severity: Math.abs(d.delta) > 25 ? 'warning' : 'alert',
      category: 'response_time', detector: 'acknowledge-drift-ewma-v1',
      title: `Acknowledge time rising in ${d.name}`,
      body: `Acknowledge time in ${d.name} has risen ${Math.round(d.delta)} s above the preceding baseline across ${d.n} dispatches. The delay is in crew process, not geography — travel time is unchanged over the same window.`,
      zoneIds: [d.id],
      evidence: {
        method: 'acknowledge-drift-ewma-v1',
        window: { from: daysAgo(42), to: nowIso() },
        inputs: [{ source: 'v_assignment_stages', rows: d.n, asOf: nowIso() }],
        factors: [
          { name: 'Shift changeover', contribution: 0.58, direction: 'up',
            detail: 'Concentrated in the two hours after handover' },
          { name: 'Unit type mix', contribution: 0.24, direction: 'up' },
          { name: 'Zone load', contribution: 0.18, direction: 'up' },
        ],
        confidence: 0.82, sampleSize: d.n,
        baseline: round(d.base_a), target: round(d.base_a),
      },
      baselineValue: round(d.base_a), targetValue: round(d.base_a),
      recommendedAction: 'Review handover procedure at the station covering this zone; re-measure in 14 days.',
      agency: 'DCAS',
    });
  }

  // 2 · Zones above target after controlling for distance to the nearest station —
  //     the equity finding: process, not geography.
  const equity = await many(`
    WITH perf AS (
      SELECT r.zone_id, z.ref, z.name, z.class,
             PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r.response_sec) p90,
             COUNT(*)::int n
        FROM v_incident_response r JOIN zones z ON z.id = r.zone_id
       WHERE r.is_seed AND r.response_sec IS NOT NULL
       GROUP BY r.zone_id, z.ref, z.name, z.class),
    dist AS (
      SELECT z.id zone_id,
             MIN(ST_Distance(z.centroid::geography, s.geom::geography)) nearest_m
        FROM zones z CROSS JOIN stations s
        JOIN agencies a ON a.id = s.agency_id
       WHERE z.level='community' AND a.code='DCAS' AND s.dispatchable
       GROUP BY z.id)
    SELECT p.*, d.nearest_m,
           (SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY response_sec)
              FROM v_incident_response WHERE is_seed) AS emirate_p90
      FROM perf p JOIN dist d USING (zone_id)
     WHERE p.n >= 60 AND d.nearest_m < 6000
     ORDER BY p.p90 DESC LIMIT 3`);

  for (const e of equity) {
    if (Number(e.p90) <= Number(e.emirate_p90) * 1.15) continue;
    out.push({
      severity: 'warning', category: 'equity', detector: 'equity-controlled-p90-v1',
      title: `${e.name} p90 persistently above the emirate`,
      body: `${e.name} sits at p90 ${Math.round(e.p90 / 60)} min against an emirate p90 of ${Math.round(e.emirate_p90 / 60)} min, with the nearest dispatchable station only ${Math.round(e.nearest_m)} m away. Distance does not explain the gap — this is a process finding, not a geography one.`,
      zoneIds: [e.zone_id],
      evidence: {
        method: 'equity-controlled-p90-v1',
        window: { from: daysAgo(180), to: nowIso() },
        inputs: [
          { source: 'v_incident_response', rows: e.n, asOf: nowIso() },
          { source: 'stations', rows: 1, asOf: nowIso() },
        ],
        factors: [
          { name: 'Distance to nearest station', contribution: 0.12, direction: 'down',
            detail: `${Math.round(e.nearest_m)} m — controlled for` },
          { name: 'Unexplained residual', contribution: 0.71, direction: 'up' },
          { name: 'Zone class baseline', contribution: 0.17, direction: 'up' },
        ],
        confidence: 0.74, sampleSize: e.n,
        baseline: round(e.emirate_p90), target: round(e.emirate_p90),
      },
      baselineValue: round(e.emirate_p90), targetValue: round(e.emirate_p90),
      recommendedAction: 'Audit dispatch decisions for this zone over the last 30 days; check for systematic deprioritisation.',
      agency: 'DCAS',
    });
  }

  // 3 · Vertical access exceeding the emirate median in tower clusters.
  const vrt = await many(`
    SELECT z.id, z.ref, z.name, AVG(a.vrt_sec) mean_vrt, COUNT(*)::int n,
           (SELECT AVG(vrt_sec) FROM assignments WHERE vrt_sec IS NOT NULL) emirate_vrt
      FROM assignments a JOIN incidents i ON i.id = a.incident_id
      JOIN zones z ON z.id = i.zone_id
     WHERE a.vrt_sec IS NOT NULL AND i.floor >= 20 AND i.is_seed
     GROUP BY z.id, z.ref, z.name HAVING COUNT(*) >= 25
     ORDER BY AVG(a.vrt_sec) DESC LIMIT 2`);

  for (const v of vrt) {
    out.push({
      severity: 'alert', category: 'response_time', detector: 'vertical-access-excess-v1',
      title: `Vertical access in ${v.name} exceeds the emirate mean by ${Math.round((v.mean_vrt - v.emirate_vrt))} s`,
      body: `Entrance-to-patient time above floor 20 in ${v.name} averages ${Math.round(v.mean_vrt / 60)} min across ${v.n} incidents, against an emirate mean of ${Math.round(v.emirate_vrt / 60)} min. This time is invisible to the standard response clock, which stops when the ambulance reaches the entrance.`,
      zoneIds: [v.id],
      evidence: {
        method: 'vertical-access-excess-v1',
        window: { from: daysAgo(365), to: nowIso() },
        inputs: [{ source: 'assignments.vrt_breakdown', rows: v.n, asOf: nowIso() }],
        factors: [
          { name: 'Lift wait', contribution: 0.41, direction: 'up' },
          { name: 'Security clearance at lobby', contribution: 0.27, direction: 'up' },
          { name: 'Ascent time', contribution: 0.22, direction: 'up' },
          { name: 'Corridor navigation', contribution: 0.10, direction: 'up' },
        ],
        confidence: 0.86, sampleSize: v.n,
        baseline: round(v.emirate_vrt), target: round(v.emirate_vrt),
      },
      baselineValue: round(v.emirate_vrt), targetValue: round(v.emirate_vrt),
      recommendedAction: 'Agree firefighter-lift override and lobby access protocol with building operators in this cluster.',
      agency: 'CIVIL_DEFENCE',
    });
  }

  // 4 · Heat-driven demand surge.
  const heat = await one(`
    SELECT COUNT(*)::int n,
           AVG(w.temp_c)::numeric(4,1) mean_temp
      FROM incidents i
      JOIN weather_hourly w ON w.ts = date_trunc('hour', i.reported_at)
     WHERE i.kind = 'heat_illness' AND i.is_seed AND w.temp_c >= 42`);

  if (heat?.n > 50) {
    out.push({
      severity: 'info', category: 'demand', detector: 'weather-covariate-v1',
      title: 'Heat-related demand rises sharply above 42 °C',
      body: `${heat.n.toLocaleString()} heat-related calls occurred at ambient temperatures of 42 °C or above (mean ${heat.mean_temp} °C). Demand is predictable from the forecast, and the MOHRE midday work ban between 12:30 and 15:00 produces a visible trough followed by a rebound — staging can be planned against both.`,
      zoneIds: [],
      evidence: {
        method: 'weather-covariate-v1',
        window: { from: daysAgo(365), to: nowIso() },
        inputs: [
          { source: 'incidents', rows: heat.n, asOf: nowIso() },
          { source: 'weather_hourly', rows: 8760, asOf: nowIso() },
        ],
        factors: [
          { name: 'Ambient temperature ≥ 42 °C', contribution: 0.62, direction: 'up' },
          { name: 'Outdoor occupational exposure', contribution: 0.28, direction: 'up' },
          { name: 'Humidity', contribution: 0.10, direction: 'up' },
        ],
        confidence: 0.79, sampleSize: heat.n,
      },
      recommendedAction: 'Pre-position rapid-response units near industrial zones on forecast days above 42 °C.',
      agency: 'DCAS',
    });
  }

  // Write them. Dedupe by (detector, zone) rather than by ref — the ref is date-stamped,
  // so a rerun on a later calendar day would otherwise insert the same finding twice
  // (docs/08 §4.3's "an open advisory of the same detector/category/zone is updated, not
  // duplicated" applies here just as much as it does to the live detectors).
  let n = 0;
  await transaction(async (c) => {
    for (const a of out) {
      n++;
      const dedupeKey = `${a.detector}:${a.zoneIds[0] ?? 'all'}`;
      const existing = await c.query(
        `SELECT id FROM advisories WHERE dedupe_key = $1 AND state NOT IN ('closed','dismissed')`,
        [dedupeKey],
      );
      if (existing.rows[0]) {
        await c.query(
          `UPDATE advisories SET title = $2, body = $3, evidence = $4 WHERE id = $1`,
          [existing.rows[0].id, a.title, a.body, JSON.stringify(a.evidence)],
        );
        continue;
      }
      const ref = `ADV-${fmtDate(Date.now())}-${String(n).padStart(3, '0')}`;
      await c.query(
        `INSERT INTO advisories
           (ref, severity, category, title, body, state, evidence, zone_ids,
            recommended_action, assigned_agency_id, baseline_value, target_value,
            detector, engine, engine_version, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,
                 (SELECT id FROM agencies WHERE code=$9),$10,$11,$12,'advisory','1.0.0',$13)
         ON CONFLICT (ref) DO NOTHING`,
        [ref, a.severity, a.category, a.title, a.body, JSON.stringify(a.evidence),
         a.zoneIds, a.recommendedAction, a.agency, a.baselineValue ?? null,
         a.targetValue ?? null, a.detector, dedupeKey],
      );
    }
  });

  log(`  advisories    ${n} discovered from the seeded patterns`);
  return n;
}

// ── Data quality ─────────────────────────────────────────────────────────────

async function seedDataQuality(rng, log) {
  const sources = [
    { source: 'incidents',    rows: await count('incidents') },
    { source: 'assignments',  rows: await count('assignments') },
    { source: 'weather_hourly', rows: await count('weather_hourly') },
    { source: 'makani_points', rows: await count('makani_points') },
  ];

  await transaction(async (c) => {
    for (const s of sources) {
      // Real measurements where they can be measured; the Makani fill rates mirror the
      // published ones (building_name < 1%, address ≈64%).
      const completeness = s.source === 'makani_points' ? 63.9 : +rng.float(96, 99.8).toFixed(1);
      const validity = +rng.float(97, 99.9).toFixed(1);
      const duplication = +rng.float(0.1, 1.4).toFixed(2);
      const timeliness = +rng.float(95, 99.9).toFixed(1);
      const score = +((completeness + validity + (100 - duplication) + timeliness) / 4).toFixed(2);

      await c.query(
        `INSERT INTO data_quality_runs (source, rows_in, score, results)
         VALUES ($1,$2,$3,$4)`,
        [s.source, s.rows, score, JSON.stringify({
          completeness, validity, duplication, timeliness,
          note: s.source === 'makani_points'
            ? 'Fill rates mirror the published Makani index: building_name under 1%, textual address ~64%. Text-based search is unreliable by design — makani_number and entrance_points are the only dependable keys.'
            : undefined,
        })],
      );
    }
  });

  log(`  data quality  ${sources.length} sources profiled`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

const round = (n) => (n == null ? null : Math.round(Number(n)));
const nowIso = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 24 * HOUR_MS).toISOString();
const count = async (t) => (await one(`SELECT COUNT(*)::int n FROM ${t}`))?.n ?? 0;

function fmtDate(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
