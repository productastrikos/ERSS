/**
 * The Phase 6 raw engines, wired to real (seeded) data. docs/08 §2–3.
 *
 * Every report here takes the slice of the universal filter it can honestly honour —
 * window, zone, zone class — and says in `filters.honoured` / `filters.ignored` which
 * dimensions it applied. Silently dropping a filter is worse than refusing it: the
 * operator would read a chart as filtered when it is not.
 *
 * Where a report carries a series, it also carries a forecast of it (lib/forecast.js),
 * with the same method/interval/backtest envelope every other chart in the product uses.
 */

import { pool } from '../lib/db.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { pocFleet } from '../config/poc.js';
import * as repo from '../repos/intelligence.js';
import { detectAnomaly } from '../engines/anomaly.js';
import { assessEquity } from '../engines/equity.js';
import { computeCoverage } from '../engines/coverage.js';
import { assessCrowd } from '../engines/crowd.js';
import { summarisePreemptImpact } from '../engines/preempt.js';
import { forecastAccuracy, poissonQuantile } from '../engines/demand.js';
import { forecast } from '../lib/forecast.js';
import { summarise } from '../lib/filters.js';

const nowWindow = (days = 7) => ({
  from: new Date(Date.now() - days * 86_400_000).toISOString(),
  to: new Date().toISOString(),
});

/** The window a report should use: an explicit from/to wins, else N days back. */
const windowFrom = (filters, defaultDays) =>
  (filters?.from || filters?.to
    ? { from: filters.from ?? new Date(Date.now() - defaultDays * 86_400_000).toISOString(), to: filters.to ?? new Date().toISOString() }
    : nowWindow(defaultDays));

/**
 * Say what was applied and what could not be. `ignored` is not an apology — it is the
 * difference between a chart that is filtered and a chart that merely looks filtered.
 */
function envelope(filters = {}, honoured = []) {
  const set = Object.entries(filters).filter(([, v]) => v != null && (!Array.isArray(v) || v.length));
  const applied = set.filter(([k]) => honoured.includes(k));
  const ignored = set.filter(([k]) => !honoured.includes(k)).map(([k]) => k);
  return {
    describe: applied.map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join(', ') : String(v) })),
    active: applied.length > 0,
    summary: summarise(applied.map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join(', ') : String(v) }))),
    honoured,
    /** Dimensions this engine cannot slice by — the UI greys them out rather than lying. */
    ignored,
  };
}

const WINDOW_KEYS = ['from', 'to'];
const ZONE_KEYS = ['zone', 'zoneClass'];

/** One result per zone with enough history — the Analytics → Anomaly tab. */
export async function anomalyReport({ hours = 168, ahead = 12, filters = {} } = {}) {
  const window = windowFrom(filters, Math.ceil(hours / 24));
  const byZone = await repo.zoneHourlySeries(pool, { hours, zones: filters.zone, zoneClasses: filters.zoneClass });
  const results = [];
  for (const [zoneId, z] of byZone) {
    const r = detectAnomaly({ zoneId, zoneRef: z.zoneRef, seriesName: 'calls/hour', points: z.points }, window);
    // Every anomaly panel is also a forecast panel: where the series is going, with the
    // band, so "is this deviation about to persist" is answerable on the same card.
    const fc = forecast(z.points.map((p) => p.value), { horizon: ahead, season: 24, integer: true });
    results.push({
      zoneRef: z.zoneRef,
      zoneName: z.zoneName,
      result: r,
      series: z.points.map((p) => ({ bucket: p.bucket, calls: p.value })),
      forecast: fc.points.map((p) => ({ h: p.h, calls: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
      forecastMeta: { method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct, caveats: fc.caveats },
    });
  }
  results.sort((a, b) => Math.abs(b.result.value?.latestZ ?? 0) - Math.abs(a.result.value?.latestZ ?? 0));
  return { window, filters: envelope(filters, [...ZONE_KEYS]), hours, zones: results };
}

export async function equityReport({ filters = {} } = {}) {
  const window = windowFrom(filters, 90);
  const { emirateP90Sec, zones } = await repo.equityInputs(pool, window);
  const out = assessEquity(zones, emirateP90Sec, window);
  return { ...out, filters: envelope(filters, WINDOW_KEYS) };
}

export async function coverageReport({ filters = {} } = {}) {
  const window = nowWindow(1);
  const [units, demandPoints] = await Promise.all([repo.coverageUnits(pool), repo.coverageDemandPoints(pool)]);
  const out = computeCoverage({ units, demandPoints, targetSec: jurisdiction.targets.targetResponseSec }, window);
  // Coverage is a NOW computation over the live fleet: a historical window would be a
  // different question, so none of the filter is honoured and the UI says so.
  return { ...out, filters: envelope(filters, []) };
}

/** One crowd assessment per currently active/upcoming event. */
export async function crowdReport({ filters = {} } = {}) {
  const window = nowWindow(1);
  const events = await repo.activeEvents(pool);
  const DEFAULT_VENUE_M2 = 60_000; // a mall/stadium perimeter footprint, absent real venue geometry
  const picked = filters.zone?.length ? events.filter((e) => filters.zone.includes(e.zoneRef)) : events;
  return {
    window,
    filters: envelope(filters, filters.zone?.length ? ['zone'] : []),
    events: picked.map((e) => ({
      ref: e.ref, name: e.name, zoneRef: e.zoneRef,
      result: assessCrowd({
        zoneId: e.zoneId, zoneRef: e.zoneRef,
        areaM2: DEFAULT_VENUE_M2,
        footfall: Math.round((e.expectedFootfall ?? 0) * (e.demandMultiplier ?? 1)),
        footfallTrendPerMin: 0,
      }, window),
    })),
  };
}

export async function preemptReport({ filters = {} } = {}) {
  const window = windowFrom(filters, 365);
  const { rows, totalAssignments } = await repo.preemptImpactRows(pool, window);
  const out = summarisePreemptImpact(rows, totalAssignments, window);
  return { ...out, filters: envelope(filters, WINDOW_KEYS) };
}

export async function riskReport({ limit = 25, hourBand = null, filters = {} } = {}) {
  const cells = await repo.riskCellsForNow(pool, {
    limit, hourBand, zones: filters.zone, zoneClasses: filters.zoneClass,
  });
  return { cells, filters: envelope(filters, ZONE_KEYS), hourBand };
}

/** Analytics → Forecast: the trailing accuracy panel, and the next N hours by zone. */
export async function demandReport({ hours = 24, days = 30, filters = {} } = {}) {
  const [accuracyRows, rows] = await Promise.all([
    repo.demandAccuracyRows(pool, { days }),
    repo.demandForecastRows(pool, { hours, zones: filters.zone, zoneClasses: filters.zoneClass }),
  ]);

  // Roll the zone × bucket grid up two ways, because a bar chart wants one and a trend
  // line wants the other — and both want the 80% band, not just the point estimate.
  const byZone = new Map();
  const byBucket = new Map();
  for (const r of rows) {
    const z = byZone.get(r.zoneRef) ?? { zoneRef: r.zoneRef, zoneName: r.zoneName, zoneClass: r.zoneClass, predicted: 0, lower80: 0, upper80: 0, buckets: 0 };
    z.predicted += Number(r.predicted) || 0;
    z.lower80 += Number(r.lower80) || 0;
    z.upper80 += Number(r.upper80) || 0;
    z.buckets += 1;
    byZone.set(r.zoneRef, z);

    const key = new Date(r.bucketStart).toISOString();
    const b = byBucket.get(key) ?? { bucketStart: key, predicted: 0, lower80: 0, upper80: 0 };
    b.predicted += Number(r.predicted) || 0;
    b.lower80 += Number(r.lower80) || 0;
    b.upper80 += Number(r.upper80) || 0;
    byBucket.set(key, b);
  }
  const round1 = (v) => Math.round(v * 10) / 10;
  // A total of Poisson counts is itself Poisson, so its 80% interval is read off the summed
  // rate. Adding the per-zone bounds instead put every zone at its 10th and 90th percentile
  // at once — a band from 0 to four times the forecast that no hour would ever produce.
  const band = (x) => ({ ...x, predicted: round1(x.predicted), lower80: poissonQuantile(x.predicted, 0.1), upper80: poissonQuantile(x.predicted, 0.9) });

  return {
    accuracy: forecastAccuracy(accuracyRows),
    forecast: rows,
    byZone: [...byZone.values()]
      .map(band)
      .sort((a, b) => b.predicted - a.predicted),
    byBucket: [...byBucket.values()]
      .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
      .map(band),
    horizonHours: hours,
    accuracyWindowDays: days,
    filters: envelope(filters, ZONE_KEYS),
    method: 'Per zone × hour demand model (server/engines/demand.js), 80% interval as stored by the forecast run',
  };
}

/** A minute is fresh enough for a glossary and a quality panel, and saves recomputing
 *  thirty days of percentiles for every viewer who opens the page. */
const CACHE_MS = 60_000;
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Intelligence → KPI library: the registry (definition, formula, target) with each KPI's
 *  current reading — computed over the trailing 30 days from the view it names, so the
 *  number and the formula beside it are the same calculation. */
export async function kpiLibrary() {
  return cached('kpi', async () => {
    const [registry, live] = await Promise.all([repo.kpiRegistryWithLatest(pool), repo.kpiLiveValues(pool)]);
    const periodTo = new Date().toISOString();
    return registry.map((k) => {
      const v = live[k.key];
      return v == null ? k : { ...k, value: Math.round(Number(v) * 100) / 100, periodTo, window: 'trailing 30 days' };
    });
  });
}

/** Intelligence → Data quality: every source profiled now. Timeliness is how recent the
 *  newest record is against how often that source should report; a source with no cadence
 *  (reference data) is not judged on it. */
export async function dataQualityReport() {
  return cached('dq', async () => {
    const fleet = pocFleet() ?? (await pool.query(
      `SELECT array_agg(u.ref) AS refs FROM units u JOIN agencies a ON a.id = u.agency_id WHERE a.code = 'DCAS'`)).rows[0]?.refs ?? [];
    const rows = await repo.dataQualityLive(pool, fleet);
    const ranAt = new Date().toISOString();
    const r1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return rows.map((r) => {
      const latest = r.latest ? new Date(r.latest) : null;
      const ageMin = latest ? (Date.now() - latest.getTime()) / 60_000 : null;
      const cadence = r.cadence_min == null ? null : Number(r.cadence_min);
      // Full marks inside the reporting cadence, falling to zero a day past it.
      const timeliness = cadence == null ? null
        : ageMin == null ? 0
          : Math.max(0, Math.min(100, 100 * (1 - Math.max(0, ageMin - cadence) / 1440)));
      const parts = [r.completeness, r.validity, r.duplication == null ? null : 100 - Number(r.duplication), timeliness]
        .filter((v) => v != null).map(Number);
      const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
      const stale = cadence != null && (ageMin == null || ageMin > cadence * 3);
      return {
        source: r.source, ranAt, rowsIn: r.rows_in, score: r1(score),
        results: {
          completeness: r1(r.completeness), validity: r1(r.validity), duplication: r1(r.duplication),
          timeliness: r1(timeliness), latestAt: latest?.toISOString() ?? null, stale,
          note: r.source === 'makani_points'
            ? 'Reference data, refreshed on import. Completeness is the textual-address fill rate — under two thirds, as in the published index, which is why the platform keys on the Makani number and entrance points instead.'
            : r.source === 'weather_hourly' && stale
              ? 'Historical feed in this trial — the live weather integration is not connected, and the panel says so.'
              : undefined,
        },
      };
    }).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  });
}
