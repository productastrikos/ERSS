/**
 * Insights — the aggregates every chart in the product is made of.
 *
 * Almanac (hour × weekday), monthly counts, daily counts, the call mix, radial search
 * around a point, period-over-period comparison, call-centre and performance tiles, and
 * the ETA model held to account. One service, because every one of them is a read over
 * the SAME definitions in db/views.sql — a screen never invents a KPI.
 *
 * TWO rules hold across all of them, and they are the client's universal requirement:
 *
 *   1. EVERY aggregate takes the universal filter (lib/filters.js). The same filter
 *      object slices the almanac, the forecast, the bar list and the radial circle, so a
 *      filter chosen once on the console means the same thing everywhere, and every
 *      response carries `filters.describe` — a panel can always name its own slice.
 *
 *   2. EVERY series carries a prediction (lib/forecast.js), with its method, its
 *      prediction interval and its own walk-forward backtest error. A forecast is never
 *      presented as a measurement (docs/00 D-09): the client renders it dashed, inside a
 *      band, labelled with the method.
 *
 * Every function returns `{ window, source, filters, ... }`, so a panel can always say
 * what it is showing and where it came from. The demo resting-state incidents are
 * excluded throughout unless `includeResting` is set: they are a synthetic "now", not
 * history.
 */

import { pool } from '../lib/db.js';
import { nowIso } from '../lib/clock.js';
import { buildFilter, windowDays, summarise, DOW_SHORT } from '../lib/filters.js';
import { gstToday, windowDayLabels, fillDays, fillDayHours } from '../lib/timegrid.js';
import { forecast, forecastLabelled, nextDay, nextMonth, projectCategories } from '../lib/forecast.js';
import { jurisdiction } from '../config/jurisdiction.js';

const GST = 'Asia/Dubai';
const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
};
const num = (v) => (v == null ? null : Math.round(Number(v)));
const num1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

/** The filter envelope every response carries, so no panel is ever an anonymous slice. */
const envelope = (f) => ({
  describe: f.describe,
  active: f.active,
  summary: summarise(f.describe),
});

/**
 * Today is not a day yet.
 *
 * `monthly` has always excluded the current month from its actuals — "never plot it as a
 * completed month" — and reported it separately as `partialMonth`. The same rule has to
 * hold for days, and for exactly the same reason plus a sharper one: a forecaster fitted on
 * a series whose last point is a third of a day reads that as a collapse in demand and
 * predicts the collapse continuing. On a 30-day window that one bad point visibly bends
 * every line on the Performance page.
 *
 * So the day series stop at yesterday, today comes back as `partialDay`, and the forecast
 * starts at today — which makes the first prediction directly comparable with what has
 * actually landed so far.
 */
function splitPartialDay(series, today) {
  const partial = series.find((r) => r.day === today) ?? null;
  return { complete: series.filter((r) => r.day !== today), partial };
}

/** The GST day bucket expression — grouped, then gap-filled in JS (lib/timegrid.js). */
const DAY_BUCKET = (alias) => `to_char(date_trunc('day', ${alias}.reported_at AT TIME ZONE '${GST}'), 'YYYY-MM-DD')`;
const HOUR_BUCKET = (alias) => `EXTRACT(HOUR FROM ${alias}.reported_at AT TIME ZONE '${GST}')::int`;

// ── Filter options — what the universal filter bar offers ────────────────────

/**
 * Every value the filter bar can offer, counted over a trailing year so a dimension with
 * no data does not appear as a dead option. Called once on console load and cached there.
 */
export async function filterOptions({ days = 365 } = {}) {
  const d = clamp(days, 30, 1095, 365);
  const since = `now() - interval '${d} days'`;
  const [kinds, priorities, sources, outcomes, zones, classes, unitKinds, agencies, stations, complaints, escalation, floors] =
    await Promise.all([
      pool.query(`SELECT kind AS value, COUNT(*)::int AS n FROM incidents WHERE reported_at >= ${since} GROUP BY 1 ORDER BY n DESC`),
      pool.query(`SELECT priority::text AS value, COUNT(*)::int AS n FROM incidents WHERE reported_at >= ${since} GROUP BY 1 ORDER BY 1`),
      pool.query(`SELECT source AS value, COUNT(*)::int AS n FROM incidents WHERE reported_at >= ${since} GROUP BY 1 ORDER BY n DESC`),
      pool.query(`SELECT outcome AS value, COUNT(*)::int AS n FROM incidents WHERE reported_at >= ${since} AND outcome IS NOT NULL GROUP BY 1 ORDER BY n DESC`),
      pool.query(`SELECT z.ref AS value, z.name AS label, z.level::text AS level, z.class AS class,
                         (SELECT COUNT(*)::int FROM incidents i WHERE i.zone_id = z.id AND i.reported_at >= ${since}) AS n
                    FROM zones z WHERE z.level IN ('sector','community') ORDER BY z.level, z.name`),
      pool.query(`SELECT DISTINCT class AS value FROM zones ORDER BY 1`),
      pool.query(`SELECT DISTINCT u.kind::text AS value FROM units u WHERE u.archived_at IS NULL ORDER BY 1`),
      pool.query(`SELECT code::text AS value, name AS label FROM agencies ORDER BY 1`),
      pool.query(`SELECT s.ref AS value, s.name AS label, a.code::text AS agency FROM stations s JOIN agencies a ON a.id = s.agency_id ORDER BY a.code, s.name`),
      pool.query(`SELECT COALESCE(NULLIF(chief_complaint,''), kind) AS value, COUNT(*)::int AS n
                    FROM incidents WHERE reported_at >= ${since} GROUP BY 1 ORDER BY n DESC LIMIT 40`),
      pool.query(`SELECT DISTINCT escalation_level AS value FROM incidents WHERE reported_at >= ${since} ORDER BY 1`),
      pool.query(`SELECT MAX(floor)::int AS max FROM incidents WHERE reported_at >= ${since}`),
    ]);

  const plain = (rs) => rs.rows.map((r) => ({ value: r.value, label: r.label ?? null, n: r.n ?? null }));
  return {
    window: { days: d, to: nowIso() },
    kinds: plain(kinds),
    priorities: plain(priorities),
    sources: plain(sources),
    outcomes: plain(outcomes),
    zones: zones.rows.map((r) => ({ value: r.value, label: r.label, level: r.level, class: r.class, n: r.n })),
    zoneClasses: plain(classes),
    unitKinds: plain(unitKinds),
    agencies: plain(agencies),
    stations: stations.rows.map((r) => ({ value: r.value, label: r.label, agency: r.agency })),
    complaints: plain(complaints),
    escalation: plain(escalation),
    dow: DOW_SHORT.map((label, value) => ({ value, label })),
    floorMax: floors.rows[0]?.max ?? null,
  };
}

// ── Almanac — the hour × weekday grid, with a per-cell prediction ─────────────

/**
 * Calls by GST weekday and hour over the window, plus a per-cell forecast of NEXT week.
 *
 * The cell forecast is empirical-Bayes: a cell's own per-week rate shrunk towards the
 * independence estimate (its weekday's share × its hour's share × the weekly total) by
 * k/(k+n). With 12 weeks of data a busy cell trusts itself; a cell that saw three calls
 * all year borrows from its neighbours instead of claiming a trend.
 */
export async function almanac({ weeks = 12, filters = {}, ahead = 1 } = {}) {
  const w = clamp(weeks, 1, 104, 12);
  const f = buildFilter(filters, { source: 'response', window: { weeks: w } });
  const { rows } = await pool.query(
    `SELECT r.gst_dow AS dow, r.gst_hour AS hour, COUNT(*)::int AS calls,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
            100.0 * COUNT(*) FILTER (WHERE r.within_target)
                  / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
       FROM v_incident_response r
      WHERE TRUE${f.where}
      GROUP BY 1, 2`,
    f.params,
  );

  const observed = new Map(rows.map((r) => [`${r.dow}:${r.hour}`, r]));
  const total = rows.reduce((s, r) => s + r.calls, 0);
  const byDow = new Array(7).fill(0);
  const byHour = new Array(24).fill(0);
  for (const r of rows) { byDow[r.dow] += r.calls; byHour[r.hour] += r.calls; }

  const K = 6;   // shrinkage strength, in units of observed calls
  const grid = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const r = observed.get(`${dow}:${hour}`);
      const calls = r?.calls ?? 0;
      const ownRate = calls / w;
      const independence = total > 0 ? (byDow[dow] / total) * (byHour[hour] / total) * (total / w) : 0;
      const trust = calls / (calls + K);
      const predicted = Math.round((trust * ownRate + (1 - trust) * independence) * ahead * 10) / 10;
      grid.push({
        dow, hour, calls,
        perWeek: Math.round(ownRate * 10) / 10,
        predicted,
        p50Sec: num(r?.p50),
        p90Sec: num(r?.p90),
        withinTargetPct: num1(r?.within_pct),
      });
    }
  }

  const nonEmpty = grid.filter((c) => c.calls > 0);
  const peak = grid.reduce((m, c) => Math.max(m, c.calls), 0);
  const busiest = [...grid].sort((a, b) => b.calls - a.calls)[0] ?? null;
  const predictedPeak = [...grid].sort((a, b) => b.predicted - a.predicted)[0] ?? null;

  return {
    window: { weeks: w, to: nowIso() },
    source: 'v_incident_response',
    filters: envelope(f),
    grid,
    peak,
    predictedPeakValue: grid.reduce((m, c) => Math.max(m, c.predicted), 0),
    busiest: busiest && busiest.calls ? busiest : null,
    predictedBusiest: predictedPeak && predictedPeak.predicted ? predictedPeak : null,
    weeks: w,
    total,
    cellsWithData: nonEmpty.length,
    forecast: {
      horizonWeeks: ahead,
      method: `Empirical-Bayes per cell: own weekly rate shrunk towards weekday × hour independence by k/(k+n), k=${K}`,
      caveats: nonEmpty.length < 60
        ? ['Fewer than 60 of the 168 cells have any call in this slice — most cells are borrowing from their neighbours']
        : [],
    },
  };
}

// ── Monthly counts, with the real forecaster ──────────────────────────────────

/**
 * Monthly calls over the window, the current partial month projected to a full month, and
 * `ahead` months forecast two ways: the shared Holt–Winters forecaster (primary, with
 * intervals and a backtest) and the seasonal-naive rule the Concept Note describes
 * (shown alongside, so the simple explainable number is never lost).
 */
export async function monthly({ months = 18, ahead = 3, filters = {} } = {}) {
  const m = clamp(months, 6, 60, 18);
  const n = clamp(ahead, 0, 12, 3);
  const f = buildFilter(filters, { source: 'incidents', window: { months: m } });

  // Months are GST months, and the label is formatted in SQL — a timestamp handed to
  // JavaScript would be re-read in the server's own timezone and land in the wrong month.
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('month', i.reported_at AT TIME ZONE '${GST}'), 'YYYY-MM') AS month,
            COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)) AS p50
       FROM incidents i
      WHERE TRUE${f.where}
      GROUP BY 1 ORDER BY 1`,
    f.params,
  );

  const actual = rows.map((r) => ({
    month: r.month, calls: r.calls, urgent: r.urgent, p50Sec: num(r.p50),
  }));

  const thisMonth = (await pool.query(`SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM') AS m`, [GST])).rows[0].m;
  const complete = actual.filter((a) => a.month !== thisMonth);

  // ── Year-on-year, for the seasonal-naive comparison the Concept Note names ──
  const byMonth = new Map(complete.map((x) => [x.month, x.calls]));
  const last3 = complete.slice(-3);
  const priorYear = last3.map((x) => byMonth.get(nextMonth(x.month, -12)));
  const haveYear = last3.length === 3 && priorYear.every((v) => typeof v === 'number' && v > 0);
  const yoy = haveYear
    ? last3.reduce((s, x) => s + x.calls, 0) / priorYear.reduce((s, v) => s + v, 0)
    : 1;

  // Starts at the CURRENT month, exactly where the forecaster's first step lands, so the
  // two predictions sit on the same x positions and can be read against each other.
  const seasonalNaive = [];
  for (let k = 0; k < n; k++) {
    const key = nextMonth(thisMonth, k);
    const base = byMonth.get(nextMonth(key, -12)) ?? complete.at(-1)?.calls ?? null;
    seasonalNaive.push({ month: key, calls: base == null ? null : Math.round(base * yoy) });
  }

  // ── Primary: the shared forecaster, with intervals and a backtest ──────────
  const fc = forecastLabelled(complete, {
    labelKey: 'month', valueKey: 'calls', nextLabel: nextMonth, horizon: n, season: 12, integer: true,
  });
  const fcP50 = forecastLabelled(complete.filter((x) => x.p50Sec != null), {
    labelKey: 'month', valueKey: 'p50Sec', nextLabel: nextMonth, horizon: n, season: 12, integer: true,
  });
  const fcUrgent = forecastLabelled(complete, {
    labelKey: 'month', valueKey: 'urgent', nextLabel: nextMonth, horizon: n, season: 12, integer: true,
  });

  // This month so far, scaled to a full month — what the service is tracking towards.
  const partial = actual.at(-1)?.month === thisMonth ? actual.at(-1) : null;
  const { rows: pace } = await pool.query(
    `SELECT EXTRACT(DAY FROM now() AT TIME ZONE $1)::int AS elapsed,
            EXTRACT(DAY FROM (date_trunc('month', now() AT TIME ZONE $1) + interval '1 month - 1 day'))::int AS in_month`,
    [GST],
  );
  const projected = partial && pace[0].elapsed > 0
    ? Math.round((partial.calls / pace[0].elapsed) * pace[0].in_month)
    : null;

  return {
    window: { months: m, to: nowIso() },
    source: 'incidents',
    filters: envelope(f),
    actual: complete,
    partialMonth: partial
      ? { ...partial, elapsedDays: pace[0].elapsed, daysInMonth: pace[0].in_month, projectedCalls: projected }
      : null,
    /** Shaped like `actual` so a chart can concatenate without special-casing. */
    forecast: fc.points.map((p) => ({
      month: p.month, calls: p.predicted,
      lower80: p.lower80, upper80: p.upper80, lower95: p.lower95, upper95: p.upper95,
    })),
    forecastUrgent: fcUrgent.points.map((p) => ({ month: p.month, urgent: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
    forecastP50: fcP50.points.map((p) => ({ month: p.month, p50Sec: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
    forecastMeta: {
      method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct,
      sigma: fc.sigma, season: fc.season, n: fc.n, caveats: fc.caveats,
    },
    seasonalNaive,
    /** Kept for the subtitle every Overview card already prints. */
    method: haveYear
      ? `${fc.method} · seasonal-naive comparison: same month last year × ${yoy.toFixed(2)} year-on-year`
      : `${fc.method} · history too short to measure year-on-year growth`,
    yoy: Number(yoy.toFixed(3)),
  };
}

// ── Daily counts, with a seven-day-seasonal forecast ─────────────────────────

export async function daily({ days = 30, ahead = 7, filters = {} } = {}) {
  // Matches the route's own cap (routes/insights.js) and the client's window preset,
  // which offers up to 730 days ("2y") on every Insights page alike — a lower clamp here
  // than the route accepts meant "2y" silently returned one year of data, mislabelled.
  const d = clamp(days, 7, 730, 30);
  const n = clamp(ahead, 0, 60, 7);
  const f = buildFilter(filters, { source: 'incidents', window: { days: d } });

  const [{ rows }, today] = await Promise.all([
    pool.query(
      `SELECT ${DAY_BUCKET('i')} AS day,
              COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE i.priority = 'P1')::int AS p1,
              COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)) AS p50
         FROM incidents i
        WHERE TRUE${f.where}
        GROUP BY 1 ORDER BY 1`,
      f.params,
    ),
    gstToday(pool),
  ]);

  // Zero-filled against the full calendar: a quiet day is a real zero, not a missing row,
  // and a forecaster fed a series with holes in it reads the holes as a trend.
  const filled = fillDays(rows, windowDayLabels(filters, d, today), 'day', (r, day) => ({
    day,
    calls: r?.calls ?? 0,
    p1: r?.p1 ?? 0,
    urgent: r?.urgent ?? 0,
    p50Sec: num(r?.p50),
  }));
  const { complete: series, partial: partialDay } = splitPartialDay(filled, today);
  // A seven-day mean, so a weekend dip does not read as a trend.
  const smoothed = series.map((row, i) => {
    const slice = series.slice(Math.max(0, i - 6), i + 1);
    return { ...row, mean7: Math.round((slice.reduce((s, x) => s + x.calls, 0) / slice.length) * 10) / 10 };
  });

  const fc = forecastLabelled(smoothed, { labelKey: 'day', valueKey: 'calls', nextLabel: nextDay, horizon: n, season: 7, integer: true });
  const fcP1 = forecastLabelled(smoothed, { labelKey: 'day', valueKey: 'p1', nextLabel: nextDay, horizon: n, season: 7, integer: true });
  const withP50 = smoothed.filter((x) => x.p50Sec != null);
  const fcP50 = forecastLabelled(withP50, { labelKey: 'day', valueKey: 'p50Sec', nextLabel: nextDay, horizon: n, season: 7, integer: true });

  return {
    window: { days: d, to: nowIso() },
    source: 'incidents',
    filters: envelope(f),
    series: smoothed,
    /** Today so far. Never inside `series` — it is not a completed day. */
    partialDay,
    forecast: fc.points.map((p) => ({
      day: p.day, calls: p.predicted,
      lower80: p.lower80, upper80: p.upper80, lower95: p.lower95, upper95: p.upper95,
    })),
    forecastP1: fcP1.points.map((p) => ({ day: p.day, p1: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
    forecastP50: fcP50.points.map((p) => ({ day: p.day, p50Sec: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
    forecastMeta: {
      method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct,
      sigma: fc.sigma, season: fc.season, n: fc.n, caveats: fc.caveats,
    },
  };
}

// ── The call mix — top and bottom types, each with its own projection ────────

export async function callTypes({ days = 90, limit = 10, filters = {} } = {}) {
  const d = clamp(days, 1, 730, 90);
  const n = clamp(limit, 3, 40, 10);

  const query = async (shift) => {
    const f = buildFilter(filters, { source: 'response', window: { days: d }, shift });
    const { rows } = await pool.query(
      `SELECT r.kind, COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE r.priority IN ('P1','P2'))::int AS urgent,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
         FROM v_incident_response r
        WHERE TRUE${f.where}
        GROUP BY r.kind ORDER BY calls DESC`,
      f.params,
    );
    return { rows, f };
  };

  const [now, was] = await Promise.all([query(0), query(1)]);
  const priorByKind = new Map(was.rows.map((r) => [r.kind, r.calls]));
  const total = now.rows.reduce((s, r) => s + r.calls, 0);
  const priorTotal = was.rows.reduce((s, r) => s + r.calls, 0);

  const projected = new Map(
    projectCategories(now.rows.map((r) => ({ key: r.kind, current: r.calls, prior: priorByKind.get(r.kind) ?? null })))
      .map((p) => [p.key, p]),
  );

  const shape = (r) => {
    const p = projected.get(r.kind);
    const prior = priorByKind.get(r.kind) ?? 0;
    return {
      kind: r.kind,
      calls: r.calls,
      priorCalls: prior,
      sharePct: total ? Math.round((1000 * r.calls) / total) / 10 : 0,
      urgent: r.urgent,
      p50Sec: num(r.p50),
      p90Sec: num(r.p90),
      withinTargetPct: num1(r.within_pct),
      /** Next window of the same length, from this kind's own damped growth. */
      predictedCalls: p?.predicted ?? r.calls,
      predictedChangePct: p?.changePct ?? null,
    };
  };

  const fcTotal = projectCategories([{ key: 'total', current: total, prior: priorTotal }])[0];

  return {
    window: { days: d, to: nowIso() },
    source: 'v_incident_response',
    filters: envelope(now.f),
    total,
    priorTotal,
    top: now.rows.slice(0, n).map(shape),
    bottom: now.rows.slice(-n).reverse().map(shape),
    all: now.rows.map(shape),
    forecast: {
      horizonDays: d,
      predictedTotal: fcTotal.predicted,
      predictedChangePct: fcTotal.changePct,
      method: `Per call type: ${fcTotal.method}. Compared against the ${d} days immediately before this window.`,
      caveats: priorTotal === 0 ? ['No prior window to compare — every projection is held flat'] : [],
    },
  };
}

// ── Radial search (Concept Note §07) ─────────────────────────────────────────

/**
 * Everything inside a circle: how many calls, of what kind, how fast the service reached
 * them compared with the emirate, which buildings generate them, the trend, and where
 * that trend is going. This is the screen a planner uses to argue for a standby point.
 */
export async function radial({ lng, lat, radiusM = 750, months = 12, ahead = 3, filters = {} } = {}) {
  const r = clamp(radiusM, 100, 10000, 750);
  const mo = clamp(months, 1, 36, 12);
  const n = clamp(ahead, 0, 12, 3);

  /** Every sub-query needs its own builder (own params) plus the geo predicate. */
  const geo = (f, alias = 'i') =>
    `ST_DWithin(${alias}.geom::geography, ST_SetSRID(ST_MakePoint(${f.push(lng)},${f.push(lat)}),4326)::geography, ${f.push(r)})`;

  const q = async (sql, { source = 'incidents', alias = 'i', withGeo = true } = {}) => {
    const f = buildFilter(filters, { source, alias, window: { months: mo } });
    const g = withGeo ? ` AND ${geo(f, alias)}` : '';
    return (await pool.query(sql.replace('/*FILTER*/', `${f.where}${g}`), f.params)).rows;
  };

  // The five one-dimension counts inside the circle come from ONE scan: the geo predicate
  // is the expensive part and there is no reason to pay it five times. GROUPING() tells
  // each row which breakdown it belongs to (see `performance` for the same pattern).
  const HOUR = `EXTRACT(HOUR FROM i.reported_at AT TIME ZONE '${GST}')::int`;
  const MONTH = `to_char(date_trunc('month', i.reported_at AT TIME ZONE '${GST}'), 'YYYY-MM')`;
  const CUTS = `
    SELECT GROUPING(i.priority) AS g_prio, GROUPING(i.kind) AS g_kind,
           GROUPING(i.source) AS g_src, GROUPING(${HOUR}) AS g_hour, GROUPING(${MONTH}) AS g_month,
           i.priority::text AS priority, i.kind, i.source,
           ${HOUR} AS hour, ${MONTH} AS month,
           COUNT(*)::int AS calls
      FROM incidents i WHERE TRUE/*FILTER*/
     GROUP BY GROUPING SETS ((i.priority), (i.kind), (i.source), (${HOUR}), (${MONTH}))`;

  /**
   * Response performance by priority — the measure the circle exists to argue about.
   *
   * A count per priority says a place is busy; it cannot say whether the service is
   * reaching the urgent calls there in time, which is the question a standby point is
   * argued from. Each priority is measured against ITS OWN target (P1 8:00 … P4 40:00),
   * inside the circle and across the same slice of the emirate, in one scan per side.
   *
   * Read from `incidents` with erss_within_target() inlined rather than through
   * v_incident_response, whose LATERAL costs an order of magnitude here (docs/00 D-11).
   */
  const PRIORITY_PERF = `
    SELECT i.priority::text AS priority,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE i.first_onscene_at IS NOT NULL)::int AS reached,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)) AS p50,
           percentile_cont(0.9) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)) AS p90,
           100.0 * COUNT(*) FILTER (WHERE erss_within_target(i.priority, i.reported_at, i.first_onscene_at))
                 / NULLIF(COUNT(*) FILTER (WHERE i.first_onscene_at IS NOT NULL), 0) AS within_pct
      FROM incidents i WHERE TRUE/*FILTER*/
     GROUP BY 1`;

  const [totals, cuts, buildings, emirate, sample, nearest, prioHere, prioEmirate] = await Promise.all([
    q(`SELECT COUNT(*)::int AS calls,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY vr.response_sec) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY vr.response_sec) AS p90,
              100.0 * COUNT(*) FILTER (WHERE vr.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE vr.within_target IS NOT NULL), 0) AS within_pct,
              COUNT(*) FILTER (WHERE i.floor IS NOT NULL AND i.floor >= 10)::int AS highrise
         FROM incidents i JOIN v_incident_response vr ON vr.id = i.id
        WHERE TRUE/*FILTER*/`),
    q(CUTS),
    q(`SELECT COALESCE(m.building_name, 'Street or open ground') AS name,
              COUNT(*)::int AS calls,
              ST_X(ST_Centroid(ST_Collect(i.geom))) AS lng, ST_Y(ST_Centroid(ST_Collect(i.geom))) AS lat,
              MAX(m.floors) AS floors,
              COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent
         FROM incidents i LEFT JOIN makani_points m ON m.makani = i.makani
        WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY calls DESC LIMIT 12`),
    // The emirate baseline keeps the same filter but drops the circle: the comparison is
    // "this address against the rest of the same slice", not against everything.
    q(`SELECT COUNT(*)::int AS calls,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
         FROM v_incident_response r WHERE TRUE/*FILTER*/`, { source: 'response', alias: 'r', withGeo: false }),
    q(`SELECT i.ref, i.kind, i.priority::text AS priority, i.reported_at, i.floor,
              ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat
         FROM incidents i WHERE TRUE/*FILTER*/
        ORDER BY i.reported_at DESC LIMIT 600`),
    pool.query(
      `SELECT s.ref, s.name, ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat,
              ST_Distance(s.geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS distance_m
         FROM stations s JOIN agencies a ON a.id = s.agency_id
        WHERE a.code = 'DCAS' AND s.dispatchable
        ORDER BY distance_m LIMIT 5`, [lng, lat]).then((x) => x.rows),
    q(PRIORITY_PERF),
    q(PRIORITY_PERF, { withGeo: false }),
  ]);

  const t = totals[0];
  const e = emirate[0];
  const cut = (flag, key) => cuts.filter((r) => r[flag] === 0 && r[key] != null);
  const perfBy = (rows) => new Map(rows.map((x) => [x.priority, x]));
  const here = perfBy(prioHere);
  const wide = perfBy(prioEmirate);
  const byPriority = jurisdiction.priorities.map((p) => {
    const h = here.get(p.code);
    const w = wide.get(p.code);
    return {
      priority: p.code,
      label: p.label,
      targetSec: p.targetSec,
      calls: h?.calls ?? 0,
      reached: h?.reached ?? 0,
      p50Sec: num(h?.p50),
      p90Sec: num(h?.p90),
      withinTargetPct: num1(h?.within_pct),
      /** The same priority across the rest of this slice — "is it us, or is it here?" */
      emirate: { calls: w?.calls ?? 0, p50Sec: num(w?.p50), withinTargetPct: num1(w?.within_pct) },
    };
  });
  const byKind = cut('g_kind', 'kind').sort((a, b) => b.calls - a.calls).slice(0, 12)
    .map((r) => ({ kind: r.kind, calls: r.calls }));
  const bySource = cut('g_src', 'source').sort((a, b) => b.calls - a.calls)
    .map((r) => ({ source: r.source, calls: r.calls }));
  const byHour = cut('g_hour', 'hour').map((r) => ({ hour: r.hour, calls: r.calls }));
  const trendRows = cut('g_month', 'month').sort((a, b) => a.month.localeCompare(b.month))
    .map((x) => ({ month: x.month, calls: x.calls }));
  const fc = forecastLabelled(trendRows, {
    labelKey: 'month', valueKey: 'calls', nextLabel: nextMonth, horizon: n,
    season: trendRows.length >= 24 ? 12 : 0, integer: true,
  });

  // The filter envelope, from a builder with no geo — the circle is described separately.
  const envF = buildFilter(filters, { source: 'incidents', window: { months: mo } });

  const perWeek = Math.round((t.calls / (mo * 4.345)) * 10) / 10;
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour, calls: byHour.find((x) => x.hour === hour)?.calls ?? 0,
  }));

  return {
    at: nowIso(),
    centre: { lng, lat },
    radiusM: r,
    window: { months: mo, to: nowIso() },
    source: 'incidents · v_incident_response',
    filters: envelope(envF),
    totals: {
      calls: t.calls,
      perWeek,
      p50Sec: num(t.p50),
      p90Sec: num(t.p90),
      withinTargetPct: num1(t.within_pct),
      highriseCalls: t.highrise,
    },
    emirate: {
      calls: e.calls, p50Sec: num(e.p50), p90Sec: num(e.p90), withinTargetPct: num1(e.within_pct),
    },
    byPriority,
    byKind,
    bySource,
    hourly,
    trend: trendRows,
    forecast: fc.points.map((p) => ({
      month: p.month, calls: p.predicted,
      lower80: p.lower80, upper80: p.upper80, lower95: p.lower95, upper95: p.upper95,
    })),
    forecastMeta: {
      method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct,
      sigma: fc.sigma, season: fc.season, n: fc.n, caveats: fc.caveats,
    },
    buildings: buildings.map((b) => ({
      name: b.name, calls: b.calls, urgent: b.urgent, floors: b.floors, lng: b.lng, lat: b.lat,
    })),
    incidents: sample.map((s) => ({
      ref: s.ref, kind: s.kind, priority: s.priority, floor: s.floor,
      reportedAt: s.reported_at, lng: s.lng, lat: s.lat,
    })),
    nearestStations: nearest.map((s) => ({
      ref: s.ref, name: s.name, distanceM: Math.round(s.distance_m), lng: s.lng, lat: s.lat,
    })),
  };
}

// ── The demand surface (the geospatial view behind radial search) ────────────

/**
 * Every call in the window, binned to a fine grid — the raw material for the 3D demand
 * surface on the radial-search screen.
 *
 * Why a GRID from the server and HEXAGONS in the browser: the analyst wants to change the
 * hexagon size and the measure while looking at the map, and a round trip for each change
 * makes that feel like a report rather than an instrument. A ~110 m grid is finer than any
 * hexagon anyone reads, so the browser can re-bin it into hexagons of any size without
 * going back to the database, and the emirate fits in one small payload.
 *
 * Sent COLUMNAR (one array per measure) rather than as objects: 12,000 cells as
 * {gx, gy, calls, …} objects is about 1.4 MB of repeated key names; as arrays it is under
 * 400 kB, and it lands as typed data the aggregation can walk directly.
 *
 * `hours` adds a 24-slot histogram per cell for the hour-of-day time-lapse. It roughly
 * triples the payload, so it is only sent when asked for.
 */
export async function geo({ months = 12, cell = 0.001, hours = false, filters = {} } = {}) {
  const mo = clamp(months, 1, 36, 12);
  const g = Math.min(0.01, Math.max(0.0005, Number(cell) || 0.001));

  const f = buildFilter(filters, { source: 'incidents', window: { months: mo } });
  const gx = `floor(ST_X(i.geom) / ${g})::int`;
  const gy = `floor(ST_Y(i.geom) / ${g})::int`;

  // One scan for the surface. Response seconds come from the incident row itself, and
  // target attainment from erss_within_target() — the same definition v_incident_response
  // uses, inlined here so this never pays for that view's LATERAL (docs/00 D-11).
  const surface = pool.query(
    `SELECT ${gx} AS gx, ${gy} AS gy,
            COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent,
            COUNT(*) FILTER (WHERE i.first_onscene_at IS NOT NULL)::int AS resp_n,
            COALESCE(SUM(EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)), 0)::int AS resp_sec,
            COUNT(*) FILTER (WHERE erss_within_target(i.priority, i.reported_at, i.first_onscene_at))::int AS within_n
       FROM incidents i
      WHERE TRUE${f.where} AND i.geom IS NOT NULL
      GROUP BY 1, 2`,
    f.params,
  );

  const byHour = hours
    ? (async () => {
      const h = buildFilter(filters, { source: 'incidents', window: { months: mo } });
      return pool.query(
        `SELECT floor(ST_X(i.geom) / ${g})::int AS gx, floor(ST_Y(i.geom) / ${g})::int AS gy,
                EXTRACT(HOUR FROM i.reported_at AT TIME ZONE '${GST}')::int AS hour,
                COUNT(*)::int AS calls
           FROM incidents i
          WHERE TRUE${h.where} AND i.geom IS NOT NULL
          GROUP BY 1, 2, 3`,
        h.params,
      );
    })()
    : null;

  const [rows, hourRows] = await Promise.all([surface, byHour]);
  const cells = rows.rows;
  const index = new Map(cells.map((c, i) => [`${c.gx}:${c.gy}`, i]));

  const out = {
    gx: cells.map((c) => c.gx),
    gy: cells.map((c) => c.gy),
    calls: cells.map((c) => c.calls),
    urgent: cells.map((c) => c.urgent),
    respSec: cells.map((c) => c.resp_sec),
    respN: cells.map((c) => c.resp_n),
    withinN: cells.map((c) => c.within_n),
  };

  let hourly = null;
  if (hourRows) {
    hourly = new Array(cells.length * 24).fill(0);
    for (const r of hourRows.rows) {
      const i = index.get(`${r.gx}:${r.gy}`);
      if (i !== undefined) hourly[i * 24 + r.hour] = r.calls;
    }
  }

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const respN = sum(out.respN);

  return {
    at: nowIso(),
    window: { months: mo, to: nowIso() },
    source: 'incidents',
    filters: envelope(f),
    cell: g,
    count: cells.length,
    totals: {
      calls: sum(out.calls),
      urgent: sum(out.urgent),
      respMeanSec: respN ? Math.round(sum(out.respSec) / respN) : null,
      withinTargetPct: respN ? Math.round((1000 * sum(out.withinN)) / respN) / 10 : null,
    },
    cells: out,
    hours: hourly,
  };
}

// ── Period-over-period comparison (Concept Note §07) ─────────────────────────

/**
 * The window against the window before it, plus a forecast of the window after — so the
 * comparison answers "and what happens next" rather than stopping at "what changed".
 */
export async function compare({ days = 30, filters = {} } = {}) {
  const d = clamp(days, 7, 730, 30);

  const totalsFor = async (shift) => {
    const f = buildFilter(filters, { source: 'response', window: { days: d }, shift });
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE r.priority = 'P1')::int AS p1,
              COUNT(*) FILTER (WHERE r.priority = 'P2')::int AS p2,
              COUNT(*) FILTER (WHERE r.priority = 'P3')::int AS p3,
              COUNT(*) FILTER (WHERE r.priority = 'P4')::int AS p4,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
         FROM v_incident_response r WHERE TRUE${f.where}`,
      f.params,
    );
    const x = rows[0];
    return {
      calls: x.calls, p1: x.p1, p2: x.p2, p3: x.p3, p4: x.p4,
      p50Sec: num(x.p50), p90Sec: num(x.p90), withinTargetPct: num1(x.within_pct),
      filter: f,
    };
  };

  const byFor = async (column, shift) => {
    const f = buildFilter(filters, { source: 'response', window: { days: d }, shift });
    const { rows } = await pool.query(
      `SELECT ${column} AS key, COUNT(*)::int AS calls,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
         FROM v_incident_response r WHERE TRUE${f.where}
        GROUP BY 1`,
      f.params,
    );
    return new Map(rows.map((x) => [x.key, { calls: x.calls, p50Sec: num(x.p50), withinTargetPct: num1(x.within_pct) }]));
  };

  const [current, prior, before, kindNow, kindWas, zoneNow, zoneWas, hourNow, hourWas, unitNow, unitWas] = await Promise.all([
    totalsFor(0), totalsFor(1), totalsFor(2),
    byFor('r.kind', 0), byFor('r.kind', 1),
    byFor('r.zone_name', 0), byFor('r.zone_name', 1),
    byFor("to_char(r.gst_hour, 'FM00')", 0), byFor("to_char(r.gst_hour, 'FM00')", 1),
    byFor('r.unit_kind::text', 0), byFor('r.unit_kind::text', 1),
  ]);

  const diff = (now, was) => [...new Set([...now.keys(), ...was.keys()])]
    .filter(Boolean)
    .map((key) => {
      const a = now.get(key) ?? { calls: 0, p50Sec: null, withinTargetPct: null };
      const b = was.get(key) ?? { calls: 0, p50Sec: null, withinTargetPct: null };
      const proj = projectCategories([{ key, current: a.calls, prior: b.calls }])[0];
      return {
        key, calls: a.calls, priorCalls: b.calls, delta: a.calls - b.calls,
        deltaPct: b.calls ? Math.round((1000 * (a.calls - b.calls)) / b.calls) / 10 : null,
        p50Sec: a.p50Sec, priorP50Sec: b.p50Sec,
        withinTargetPct: a.withinTargetPct, priorWithinTargetPct: b.withinTargetPct,
        predictedCalls: proj.predicted, predictedChangePct: proj.changePct,
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // Three equal windows is enough for a damped three-point extrapolation — stated as
  // exactly that, not dressed up as a model.
  const nextOf = (key, { integer = true, max = null } = {}) => {
    const series = [before[key], prior[key], current[key]].filter((v) => v != null);
    const fc = forecast(series, { horizon: 1, season: 0, integer, nonNegative: true });
    const p = fc.points[0] ?? null;
    if (!p) return null;
    // A percentage cannot exceed 100: an interval that says 114% of responses met target
    // discredits the whole panel, however defensible the arithmetic behind it.
    const cap = (v) => (max == null ? v : Math.min(max, v));
    return { predicted: cap(p.predicted), lower80: p.lower80, upper80: cap(p.upper80), method: fc.method };
  };

  return {
    at: nowIso(),
    window: { days: d },
    source: 'v_incident_response',
    filters: envelope(current.filter),
    current, prior, before,
    delta: {
      calls: current.calls - prior.calls,
      callsPct: prior.calls ? Math.round((1000 * (current.calls - prior.calls)) / prior.calls) / 10 : null,
      p50Sec: current.p50Sec != null && prior.p50Sec != null ? current.p50Sec - prior.p50Sec : null,
      p90Sec: current.p90Sec != null && prior.p90Sec != null ? current.p90Sec - prior.p90Sec : null,
      withinTargetPp: current.withinTargetPct != null && prior.withinTargetPct != null
        ? Math.round((current.withinTargetPct - prior.withinTargetPct) * 10) / 10 : null,
    },
    next: {
      calls: nextOf('calls'),
      p1: nextOf('p1'),
      p50Sec: nextOf('p50Sec'),
      withinTargetPct: nextOf('withinTargetPct', { integer: false, max: 100 }),
      method: `Three equal ${d}-day windows, damped extrapolation of the third`,
    },
    byKind: diff(kindNow, kindWas),
    byZone: diff(zoneNow, zoneWas).slice(0, 20),
    byHour: diff(hourNow, hourWas).sort((a, b) => a.key.localeCompare(b.key)),
    byUnitKind: diff(unitNow, unitWas),
  };
}

// ── Call centre (UP-112 parity, in DCAS terms) ───────────────────────────────

/**
 * Volume by hour, where the calls come from, how they resolved, and the top complaints —
 * plus tomorrow's hourly profile, forecast from the day × hour history with a 24-step
 * season. That is the one prediction a call centre actually rosters against.
 */
export async function callCentre({ days = 30, ahead = 24, filters = {} } = {}) {
  const d = clamp(days, 1, 730, 30);
  const n = clamp(ahead, 0, 48, 24);

  const q = async (sql, { source = 'incidents', alias = 'i' } = {}) => {
    const f = buildFilter(filters, { source, alias, window: { days: d } });
    return (await pool.query(sql.replace('/*FILTER*/', f.where), f.params)).rows;
  };

  const [hourly, sources, classes, complaints, totals, hourRows, dayRows, today] = await Promise.all([
    q(`SELECT EXTRACT(HOUR FROM i.reported_at AT TIME ZONE '${GST}')::int AS hour, COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM i.triaged_at - i.reported_at)) AS p50_handling
         FROM incidents i WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY 1`),
    q(`SELECT i.source, COUNT(*)::int AS calls FROM incidents i
        WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY calls DESC`),
    q(`SELECT CASE
                WHEN i.kind = 'non_emergency' OR i.priority = 'P4' THEN 'non_emergency'
                WHEN i.outcome IN ('false_alarm','duplicate','cancelled_by_caller','no_patient_found') THEN 'non_actionable'
                WHEN i.outcome = 'refused' THEN 'refused_care'
                WHEN i.outcome = 'transported' THEN 'transported'
                WHEN i.outcome = 'treated_released' THEN 'treated_on_scene'
                ELSE 'in_progress' END AS bucket,
              COUNT(*)::int AS calls
         FROM incidents i WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY calls DESC`),
    q(`SELECT COALESCE(NULLIF(i.chief_complaint, ''), i.kind) AS complaint, COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE i.priority IN ('P1','P2'))::int AS urgent
         FROM incidents i WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY calls DESC LIMIT 20`),
    q(`SELECT COUNT(*)::int AS calls,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM i.triaged_at - i.reported_at)) AS p50_handling,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM i.triaged_at - i.reported_at)) AS p90_handling,
              COUNT(*) FILTER (WHERE i.dispatched_at IS NOT NULL)::int AS dispatched,
              COUNT(*) FILTER (WHERE i.triaged_at IS NULL)::int AS untriaged
         FROM incidents i WHERE TRUE/*FILTER*/`),
    // The hour-by-hour history the 24-step forecast is fitted on — grouped here,
    // zero-filled below, because an hour with no call is information, not a gap.
    q(`SELECT ${DAY_BUCKET('i')} AS day, ${HOUR_BUCKET('i')} AS hour, COUNT(*)::int AS calls
         FROM incidents i WHERE TRUE/*FILTER*/ GROUP BY 1, 2 ORDER BY 1, 2`),
    q(`SELECT ${DAY_BUCKET('i')} AS day, COUNT(*)::int AS calls
         FROM incidents i WHERE TRUE/*FILTER*/ GROUP BY 1 ORDER BY 1`),
    gstToday(pool),
  ]);

  const t = totals[0];
  const effectiveDays = windowDays(filters, d);
  const labels = windowDayLabels(filters, d, today);
  // Today's hours are still filling in, so it is excluded from BOTH histories: a 24-step
  // seasonal fit whose last day stops at 11:00 learns that the afternoon is dead.
  const pastLabels = labels.filter((x) => x !== today);
  const hourSeries = fillDayHours(hourRows, pastLabels, (r, day, hour) => ({ day, hour, calls: r?.calls ?? 0 }));
  const { complete: daily7, partial: partialDay } = splitPartialDay(
    fillDays(dayRows, labels, 'day', (r, day) => ({ day, calls: r?.calls ?? 0 })), today,
  );

  // 24 hourly steps ahead = the next calendar day, hour by hour.
  const fcHour = forecast(hourSeries.map((x) => x.calls), { horizon: n, season: 24, integer: true });
  const lastDay = hourSeries.at(-1)?.day ?? null;
  const lastHour = hourSeries.at(-1)?.hour ?? 23;
  const nextHourly = fcHour.points.map((p) => {
    const abs = lastHour + p.h;
    return {
      hour: ((abs % 24) + 24) % 24,
      dayOffset: Math.floor(abs / 24),
      calls: p.predicted, lower80: p.lower80, upper80: p.upper80, lower95: p.lower95, upper95: p.upper95,
    };
  });

  const fcDay = forecastLabelled(daily7, { labelKey: 'day', valueKey: 'calls', nextLabel: nextDay, horizon: 7, season: 7, integer: true });

  const rate = (n) => Math.round((n / effectiveDays) * 10) / 10;
  const hourlyOut = Array.from({ length: 24 }, (_, hour) => {
    const row = hourly.find((x) => x.hour === hour);
    // The predicted profile for the same hour tomorrow, where the horizon reaches it.
    const pred = nextHourly.find((x) => x.hour === hour && x.dayOffset <= 1);
    return {
      hour,
      /** Window total for this hour. */
      calls: row?.calls ?? 0,
      urgent: row?.urgent ?? 0,
      /** The same, per day — the ONLY form comparable with a one-day forecast, and what
       *  the chart plots. A 30-day total against tomorrow's number is not a comparison. */
      callsPerDay: rate(row?.calls ?? 0),
      urgentPerDay: rate(row?.urgent ?? 0),
      handlingP50Sec: num(row?.p50_handling),
      predictedCalls: pred?.calls ?? null,
      lower80: pred?.lower80 ?? null,
      upper80: pred?.upper80 ?? null,
    };
  });

  return {
    window: { days: d, to: nowIso() },
    source: 'incidents',
    filters: envelope(buildFilter(filters, { source: 'incidents', window: { days: d } })),
    totals: {
      calls: t.calls,
      dispatched: t.dispatched,
      untriaged: t.untriaged,
      perDay: Math.round(t.calls / effectiveDays),
      callHandlingP50Sec: num(t.p50_handling),
      callHandlingP90Sec: num(t.p90_handling),
    },
    hourly: hourlyOut,
    sources,
    classes,
    complaints,
    daily: daily7,
    partialDay,
    forecastDaily: fcDay.points.map((p) => ({
      day: p.day, calls: p.predicted, lower80: p.lower80, upper80: p.upper80, lower95: p.lower95, upper95: p.upper95,
    })),
    forecastHourly: nextHourly,
    forecastMeta: {
      method: `${fcHour.method} on ${hourSeries.length} hourly buckets`,
      mae: fcHour.mae, mape: fcHour.mape, coverage80Pct: fcHour.coverage80Pct,
      sigma: fcHour.sigma, season: fcHour.season, n: fcHour.n, caveats: fcHour.caveats,
      daily: { method: fcDay.method, mae: fcDay.mae, mape: fcDay.mape, coverage80Pct: fcDay.coverage80Pct },
    },
    predictedPeakHour: nextHourly.length
      ? nextHourly.filter((x) => x.dayOffset <= 1).reduce((m, x) => (x.calls > (m?.calls ?? -1) ? x : m), null)
      : null,
  };
}

// ── Performance tiles (UP-112 parity) ────────────────────────────────────────

export async function performance({ days = 30, ahead = 7, filters = {} } = {}) {
  const d = clamp(days, 1, 730, 30);
  const n = clamp(ahead, 0, 60, 7);

  const q = async (sql) => {
    const f = buildFilter(filters, { source: 'response', window: { days: d } });
    return (await pool.query(sql.replace('/*FILTER*/', f.where), f.params)).rows;
  };

  const preemptQuery = pool.query(
    `SELECT COUNT(*)::int AS requests,
            COUNT(*) FILTER (WHERE outcome = 'granted')::int AS granted,
            AVG(saved_sec) FILTER (WHERE outcome = 'granted')::numeric(10,1) AS mean_saved,
            SUM(saved_sec) FILTER (WHERE outcome = 'granted')::int AS total_saved
       FROM preempt_events WHERE requested_at >= now() - ($1 || ' days')::interval`,
    [String(d)],
  );

  // ── One query for the totals, the stage means and four breakdowns ──────────
  //
  // These were six separate queries. Each one re-scanned v_incident_response, whose
  // LATERAL join to the primary assignment is the expensive part, and firing them in
  // parallel alongside the trend, the station join and the three ETA queries put eleven
  // statements on a ten-connection pool — the eleventh queued, and a filtered read that
  // needs 40ms of work took two seconds. GROUPING SETS answers all six from one scan.
  //
  // GROUPING(x) is 0 when x is part of the row's grouping set, so the flags say which
  // breakdown each row belongs to; the `()` set is the totals row.
  const BREAKDOWN = `
    SELECT GROUPING(r.zone_class) AS g_class,
           GROUPING(r.priority)   AS g_prio,
           GROUPING(r.unit_kind)  AS g_unit,
           GROUPING(r.gst_hour)   AS g_hour,
           r.zone_class AS class, r.priority::text AS priority,
           r.unit_kind::text AS unit_kind, r.gst_hour AS hour,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE r.response_sec IS NOT NULL)::int AS responded,
           AVG(r.call_handling_sec)::numeric(10,1) AS call_handling,
           AVG(r.dispatch_sec)::numeric(10,1)      AS dispatch,
           AVG(r.acknowledge_sec)::numeric(10,1)   AS acknowledge,
           AVG(r.turnout_sec)::numeric(10,1)       AS turnout,
           AVG(r.travel_sec)::numeric(10,1)        AS travel,
           AVG(r.vrt_sec)::numeric(10,1)           AS vertical,
           AVG(r.total_sec)::numeric(10,1)         AS close,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec) AS p90,
           100.0 * COUNT(*) FILTER (WHERE r.within_target)
                 / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
      FROM v_incident_response r WHERE TRUE/*FILTER*/
     GROUP BY GROUPING SETS ((), (r.zone_class), (r.priority), (r.unit_kind), (r.gst_hour))`;

  const [breakdown, byStation, trendRaw, preempt, eta, today] = await Promise.all([
    q(BREAKDOWN),
    q(`SELECT s.ref AS station_ref, s.name AS station, COUNT(*)::int AS calls,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
         FROM v_incident_response r
         JOIN units u ON u.id = r.unit_id
         JOIN stations s ON s.id = u.home_station_id
        WHERE TRUE/*FILTER*/ GROUP BY 1, 2 ORDER BY calls DESC LIMIT 20`),
    q(`SELECT ${DAY_BUCKET('r')} AS day,
               COUNT(*)::int AS calls,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
               100.0 * COUNT(*) FILTER (WHERE r.within_target)
                     / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_pct
          FROM v_incident_response r WHERE TRUE/*FILTER*/
         GROUP BY 1 ORDER BY 1`),
    preemptQuery.then((x) => x.rows),
    etaAccuracy({ days: d, filters }),
    gstToday(pool),
  ]);

  // Split the grouping-set rows back out. A null key inside a breakdown means "no value
  // recorded", which is not a category, so those rows are dropped rather than shown as a
  // blank bar.
  const s = breakdown.find((r) => r.g_class === 1 && r.g_prio === 1 && r.g_unit === 1 && r.g_hour === 1) ?? {};
  const pick = (flag, key) => breakdown.filter((r) => r[flag] === 0 && r[key] != null);
  const byClass = pick('g_class', 'class').sort((a, b) => b.calls - a.calls);
  const byPriority = pick('g_prio', 'priority').sort((a, b) => String(a.priority).localeCompare(String(b.priority)));
  const byUnitKind = pick('g_unit', 'unit_kind').sort((a, b) => b.calls - a.calls);
  const byHour = pick('g_hour', 'hour');
  const p = preempt[0];

  const { complete: trendRows, partial: partialDay } = splitPartialDay(
    fillDays(trendRaw, windowDayLabels(filters, d, today), 'day', (r, day) => ({
      day, calls: r?.calls ?? 0, p50Sec: num(r?.p50), withinTargetPct: num1(r?.within_pct),
    })),
    today,
  );
  const fcP50 = forecastLabelled(trendRows.filter((r) => r.p50Sec != null), {
    labelKey: 'day', valueKey: 'p50Sec', nextLabel: nextDay, horizon: n, season: 7, integer: true,
  });
  const fcWithin = forecastLabelled(trendRows.filter((r) => r.withinTargetPct != null), {
    labelKey: 'day', valueKey: 'withinTargetPct', nextLabel: nextDay, horizon: n, season: 7, integer: false,
  });
  const fcCalls = forecastLabelled(trendRows, {
    labelKey: 'day', valueKey: 'calls', nextLabel: nextDay, horizon: n, season: 7, integer: true,
  });

  return {
    window: { days: d, to: nowIso() },
    source: 'v_incident_response · preempt_events · v_eta_accuracy',
    filters: envelope(buildFilter(filters, { source: 'response', window: { days: d } })),
    totals: {
      calls: s.calls, responded: s.responded,
      p50Sec: num(s.p50), p90Sec: num(s.p90),
      withinTargetPct: num1(s.within_pct),
    },
    stages: [
      { key: 'call_handling', label: 'Call handling', meanSec: num(s.call_handling) },
      { key: 'dispatch', label: 'Dispatch decision', meanSec: num(s.dispatch) },
      { key: 'acknowledge', label: 'Crew acknowledge', meanSec: num(s.acknowledge) },
      { key: 'turnout', label: 'Turnout', meanSec: num(s.turnout) },
      { key: 'travel', label: 'Travel', meanSec: num(s.travel) },
      { key: 'vertical', label: 'Vertical access', meanSec: num(s.vertical) },
    ],
    closeMeanSec: num(s.close),
    byZoneClass: byClass.map((r) => ({
      class: r.class, calls: r.calls, p50Sec: num(r.p50), p90Sec: num(r.p90), withinTargetPct: num1(r.within_pct),
    })),
    byPriority: byPriority.map((r) => ({ priority: r.priority, calls: r.calls, p50Sec: num(r.p50), withinTargetPct: num1(r.within_pct) })),
    byUnitKind: byUnitKind.map((r) => ({ unitKind: r.unit_kind, calls: r.calls, p50Sec: num(r.p50), withinTargetPct: num1(r.within_pct) })),
    byHour: Array.from({ length: 24 }, (_, hour) => {
      const r = byHour.find((x) => x.hour === hour);
      return { hour, calls: r?.calls ?? 0, p50Sec: num(r?.p50), withinTargetPct: num1(r?.within_pct) };
    }),
    byStation: byStation.map((r) => ({ stationRef: r.station_ref, station: r.station, calls: r.calls, p50Sec: num(r.p50), withinTargetPct: num1(r.within_pct) })),
    trend: trendRows,
    partialDay,
    forecast: {
      p50Sec: fcP50.points.map((x) => ({ day: x.day, p50Sec: x.predicted, lower80: x.lower80, upper80: x.upper80 })),
      withinTargetPct: fcWithin.points.map((x) => ({ day: x.day, withinTargetPct: x.predicted, lower80: x.lower80, upper80: Math.min(100, x.upper80) })),
      calls: fcCalls.points.map((x) => ({ day: x.day, calls: x.predicted, lower80: x.lower80, upper80: x.upper80 })),
      meta: {
        method: fcP50.method, mae: fcP50.mae, mape: fcP50.mape, coverage80Pct: fcP50.coverage80Pct,
        caveats: fcP50.caveats, n: fcP50.n,
      },
    },
    preempt: {
      requests: p.requests, granted: p.granted,
      grantPct: p.requests ? Math.round((1000 * p.granted) / p.requests) / 10 : null,
      meanSavedSec: num(p.mean_saved), totalSavedSec: p.total_saved ?? 0,
    },
    eta,
  };
}

// ── ETA accuracy — the model held to account (Concept Note §08) ──────────────

export async function etaAccuracy({ days = 90, ahead = 7, filters = {} } = {}) {
  const d = clamp(days, 1, 730, 90);
  const n = clamp(ahead, 0, 30, 7);

  // v_eta_accuracy is keyed on the incident, so the universal filter reaches it through
  // v_incident_response — the same slice, applied to the model's own scoreboard.
  const sub = (alias) => {
    const f = buildFilter(filters, { source: 'incidents', alias: 'fi', window: { days: d } });
    return {
      clause: `EXISTS (SELECT 1 FROM incidents fi WHERE fi.id = ${alias}.incident_id${f.where})`,
      params: f.params,
      f,
    };
  };

  const a = sub('v');
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n,
            AVG(abs_error_sec)::numeric(10,1) AS mae,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY eta_error_sec) AS median_error,
            100.0 * COUNT(*) FILTER (WHERE abs_error_sec <= 60)  / NULLIF(COUNT(*), 0) AS within_60,
            100.0 * COUNT(*) FILTER (WHERE abs_error_sec <= 120) / NULLIF(COUNT(*), 0) AS within_120,
            COUNT(*) FILTER (WHERE eta_error_sec < 0)::int AS early
       FROM v_eta_accuracy v WHERE ${a.clause}`,
    a.params,
  );

  const b = sub('v');
  const buckets = await pool.query(
    `SELECT width_bucket(GREATEST(-300, LEAST(300, eta_error_sec)), -300, 300, 12) AS b,
            COUNT(*)::int AS n
       FROM v_eta_accuracy v WHERE ${b.clause}
      GROUP BY 1 ORDER BY 1`,
    b.params,
  );

  const c = sub('v');
  const daily = await pool.query(
    `SELECT to_char((v.onscene_at AT TIME ZONE '${GST}')::date, 'YYYY-MM-DD') AS day,
            AVG(v.abs_error_sec)::numeric(10,1) AS mae, COUNT(*)::int AS n
       FROM v_eta_accuracy v WHERE ${c.clause}
      GROUP BY 1 ORDER BY 1`,
    c.params,
  );

  const r = rows[0];
  const trend = daily.rows.map((x) => ({ day: x.day, maeSec: num(x.mae), samples: x.n }));
  const fc = forecastLabelled(trend, { labelKey: 'day', valueKey: 'maeSec', nextLabel: nextDay, horizon: n, season: 7, integer: true });

  return {
    window: { days: d, to: nowIso() },
    source: 'v_eta_accuracy',
    filters: envelope(c.f),
    samples: r.n,
    maeSec: num(r.mae),
    medianErrorSec: num(r.median_error),
    within60Pct: num1(r.within_60),
    within120Pct: num1(r.within_120),
    earlyPct: r.n ? Math.round((1000 * r.early) / r.n) / 10 : null,
    histogram: buckets.rows.map((x) => ({ fromSec: -300 + (x.b - 1) * 50, toSec: -300 + x.b * 50, n: x.n })),
    trend,
    forecast: fc.points.map((p) => ({ day: p.day, maeSec: p.predicted, lower80: p.lower80, upper80: p.upper80 })),
    forecastMeta: { method: fc.method, mae: fc.mae, mape: fc.mape, coverage80Pct: fc.coverage80Pct, caveats: fc.caveats },
  };
}

// ── The playbook corpus — what has been recorded, and how complete it is ─────

/**
 * Every completed response is a record of what happened: the route proposed against the
 * route driven, the breadcrumb trail, the stage timings, the arrival predicted against
 * the arrival achieved, and the partner-agency service levels. That corpus is what the
 * demand, ETA and dispatch models are fitted and held to account against.
 *
 * This read answers the question the corpus has to survive: HOW COMPLETE IS IT. A count
 * of incidents means nothing if none of them carry a driven route — so every column is
 * reported as a coverage percentage, and the panel says plainly which signals are thin.
 * A training set nobody can audit is not an asset.
 */
export async function playbook({ limit = 20, filters = {} } = {}) {
  const f = buildFilter(filters, { source: 'incidents', window: { days: 365 } });
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int                                                    AS responses,
            COUNT(*) FILTER (WHERE i.closed_at IS NOT NULL)::int             AS closed,
            COUNT(a.id) FILTER (WHERE a.route_proposed IS NOT NULL)::int     AS with_proposed,
            COUNT(a.id) FILTER (WHERE a.route_taken IS NOT NULL)::int        AS with_driven,
            COUNT(a.id) FILTER (WHERE a.eta_predicted_at IS NOT NULL)::int   AS with_eta,
            COUNT(a.id) FILTER (WHERE a.vrt_sec IS NOT NULL)::int            AS with_vrt,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY a.route_taken_sec - a.route_proposed_sec)             AS median_route_delta,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(a.eta_error_sec)) AS median_eta_error
       FROM incidents i
       LEFT JOIN assignments a ON a.incident_id = i.id AND a.is_primary
      WHERE TRUE${f.where}`,
    f.params,
  );

  // Breadcrumbs and timeline rows are counted separately: they are per-position and
  // per-event, so joining them into the query above would multiply every other count.
  const g = buildFilter(filters, { source: 'incidents', window: { days: 365 } });
  const { rows: trails } = await pool.query(
    `SELECT COUNT(DISTINCT a.id)::int AS with_trail,
            COUNT(p.*)::int           AS positions
       FROM incidents i
       JOIN assignments a ON a.incident_id = i.id AND a.is_primary
       JOIN unit_positions p ON p.unit_id = a.unit_id
        AND p.ts BETWEEN a.offered_at AND COALESCE(a.cleared_at, a.onscene_at, a.offered_at)
      WHERE TRUE${g.where}`,
    g.params,
  );

  const e = buildFilter(filters, { source: 'incidents', window: { days: 365 } });
  const { rows: events } = await pool.query(
    `SELECT COUNT(*)::int AS timeline_events
       FROM incident_timeline t
      WHERE EXISTS (SELECT 1 FROM incidents i WHERE i.id = t.incident_id${e.where})`,
    e.params,
  );

  const r = rows[0];
  const t = trails[0];
  const pctOf = (n) => (r.responses ? Math.round((1000 * n) / r.responses) / 10 : null);

  const recent = await replayable({ limit, filters });

  const signals = [
    { key: 'timeline', label: 'Stage timeline', n: events[0].timeline_events, coveragePct: null,
      note: 'Every state change, with its actor — the spine of an after-action review' },
    { key: 'proposedRoute', label: 'Route proposed', n: r.with_proposed, coveragePct: pctOf(r.with_proposed),
      note: 'What the dispatch engine sent the crew down' },
    { key: 'drivenRoute', label: 'Route driven', n: r.with_driven, coveragePct: pctOf(r.with_driven),
      note: 'What the crew actually did — the proposed-vs-driven delta trains the ETA model' },
    { key: 'trail', label: 'GPS breadcrumbs', n: t.with_trail, coveragePct: pctOf(t.with_trail),
      note: `${t.positions} positions — playback, and speed profiles per corridor` },
    { key: 'etaPrediction', label: 'Arrival predicted', n: r.with_eta, coveragePct: pctOf(r.with_eta),
      note: 'Predicted against achieved — the model held to account' },
    { key: 'verticalAccess', label: 'Vertical access time', n: r.with_vrt, coveragePct: pctOf(r.with_vrt),
      note: 'The last-hundred-metres delay, measured separately from travel' },
  ];

  return {
    at: nowIso(),
    source: 'incidents · assignments · unit_positions · incident_timeline',
    filters: envelope(f),
    totals: {
      responses: r.responses,
      closed: r.closed,
      medianRouteDeltaSec: num(r.median_route_delta),
      medianEtaErrorSec: num(r.median_eta_error),
    },
    signals,
    /** Named plainly, because a thin signal is a limit on what can be learned. */
    gaps: signals
      .filter((x) => x.coveragePct != null && x.coveragePct < 50)
      .map((x) => `${x.label}: ${x.coveragePct}% of responses`),
    recent,
  };
}

// ── After-action replay (Concept Note §07 route/SLA, §08 replay) ─────────────

/**
 * One incident, reconstructed: the stages, the route proposed against the route taken with
 * the minutes between them, the breadcrumb trail for playback, the predicted arrival
 * against the actual, and the partner agencies' service levels where any were involved.
 */
export async function replay(ref) {
  const incident = await pool.query(
    `SELECT i.id, i.ref, i.kind, i.priority, i.state, i.outcome, i.floor, i.makani,
            ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat, i.reported_at, i.triaged_at, i.dispatched_at,
            i.first_onscene_at, i.first_at_patient_at, i.closed_at, i.chief_complaint,
            z.name AS zone_name, m.building_name, m.floors AS building_floors
       FROM incidents i
       LEFT JOIN zones z ON z.id = i.zone_id
       LEFT JOIN makani_points m ON m.makani = i.makani
      WHERE i.ref = $1`, [ref]);
  if (!incident.rows.length) return null;
  const inc = incident.rows[0];

  const [assignments, timeline, sla, positions] = await Promise.all([
    pool.query(
      `SELECT a.ref, a.state, a.offered_at, a.acknowledged_at, a.enroute_at, a.onscene_at,
              a.at_patient_at, a.transporting_at, a.at_hospital_at, a.cleared_at,
              a.route_proposed_sec, a.route_taken_sec, a.route_proposed_m, a.route_taken_m,
              a.eta_predicted_at, a.eta_error_sec, a.vrt_sec, a.is_primary,
              CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS route_proposed,
              CASE WHEN a.route_taken IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_taken)::json END AS route_taken,
              CASE WHEN a.route_hospital IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_hospital)::json END AS route_hospital,
              a.route_hospital_sec, a.route_hospital_m,
              u.id AS unit_id, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
              h.name AS hospital_name, ST_X(h.geom) AS hospital_lng, ST_Y(h.geom) AS hospital_lat
         FROM assignments a
         JOIN units u ON u.id = a.unit_id
         LEFT JOIN hospitals h ON h.id = a.hospital_id
        WHERE a.incident_id = $1 ORDER BY a.offered_at`, [inc.id]),
    pool.query(
      `SELECT ts, stage, label, detail FROM incident_timeline WHERE incident_id = $1 ORDER BY ts, id`, [inc.id]),
    pool.query(
      `SELECT agency_code, agency_name, notified_at, acknowledged_at, ack_sec, sla_sec, met
         FROM v_agency_sla WHERE incident_id = $1 ORDER BY notified_at`, [inc.id]),
    pool.query(
      `SELECT p.unit_id, u.ref AS unit_ref, p.ts, ST_X(p.geom) AS lng, ST_Y(p.geom) AS lat, p.speed, p.status
         FROM unit_positions p JOIN units u ON u.id = p.unit_id
        WHERE p.unit_id IN (SELECT unit_id FROM assignments WHERE incident_id = $1)
          AND p.ts BETWEEN (SELECT MIN(offered_at) FROM assignments WHERE incident_id = $1)
                       AND COALESCE((SELECT MAX(cleared_at) FROM assignments WHERE incident_id = $1), now())
        ORDER BY p.ts`, [inc.id]),
  ]);

  const primary = assignments.rows.find((a) => a.is_primary) ?? assignments.rows[0] ?? null;
  const savedSec = primary && primary.route_taken_sec != null && primary.route_proposed_sec != null
    ? primary.route_taken_sec - primary.route_proposed_sec : null;

  return {
    incident: {
      ref: inc.ref, kind: inc.kind, priority: inc.priority, state: inc.state, outcome: inc.outcome,
      lng: inc.lng, lat: inc.lat, floor: inc.floor, makani: inc.makani,
      buildingName: inc.building_name, buildingFloors: inc.building_floors, zoneName: inc.zone_name,
      chiefComplaint: inc.chief_complaint,
      reportedAt: inc.reported_at, triagedAt: inc.triaged_at, dispatchedAt: inc.dispatched_at,
      firstOnsceneAt: inc.first_onscene_at, firstAtPatientAt: inc.first_at_patient_at, closedAt: inc.closed_at,
      responseSec: inc.first_onscene_at ? Math.round((new Date(inc.first_onscene_at) - new Date(inc.reported_at)) / 1000) : null,
    },
    assignments: assignments.rows.map((a) => ({
      ref: a.ref, state: a.state, unitRef: a.unit_ref, callsign: a.callsign, unitKind: a.unit_kind,
      isPrimary: a.is_primary, hospitalName: a.hospital_name,
      offeredAt: a.offered_at, acknowledgedAt: a.acknowledged_at, enrouteAt: a.enroute_at,
      onsceneAt: a.onscene_at, atPatientAt: a.at_patient_at, transportingAt: a.transporting_at,
      atHospitalAt: a.at_hospital_at, clearedAt: a.cleared_at,
      routeProposed: a.route_proposed?.coordinates ?? null,
      routeTaken: a.route_taken?.coordinates ?? null,
      routeHospital: a.route_hospital?.coordinates ?? null,
      routeProposedSec: a.route_proposed_sec, routeTakenSec: a.route_taken_sec,
      routeHospitalSec: a.route_hospital_sec, routeHospitalM: a.route_hospital_m,
      routeProposedM: a.route_proposed_m, routeTakenM: a.route_taken_m,
      hospital: a.hospital_lng == null ? null : { name: a.hospital_name, lng: a.hospital_lng, lat: a.hospital_lat },
      etaPredictedAt: a.eta_predicted_at, etaErrorSec: a.eta_error_sec, vrtSec: a.vrt_sec,
    })),
    route: primary ? {
      unitRef: primary.unit_ref,
      proposedSec: primary.route_proposed_sec, takenSec: primary.route_taken_sec,
      proposedM: primary.route_proposed_m, takenM: primary.route_taken_m,
      savedSec,
      predictedAt: primary.eta_predicted_at, actualAt: primary.onscene_at, errorSec: primary.eta_error_sec,
    } : null,
    timeline: timeline.rows.map((t) => ({ ts: t.ts, stage: t.stage, label: t.label, detail: t.detail })),
    agencySla: sla.rows.map((s) => ({
      agencyCode: s.agency_code, agencyName: s.agency_name, notifiedAt: s.notified_at,
      acknowledgedAt: s.acknowledged_at, ackSec: s.ack_sec, slaSec: s.sla_sec, met: s.met,
    })),
    track: positions.rows.map((p) => ({
      unitRef: p.unit_ref, ts: p.ts, lng: p.lng, lat: p.lat, speed: p.speed, status: p.status,
    })),
  };
}

/** Incidents worth replaying in a demonstration: recent, with a route actually recorded. */
export async function replayable({ limit = 20, filters = {} } = {}) {
  // No default window here: "most recent N with a route" is the point, so the time
  // predicate only appears when the caller actually asked for a range.
  const f = buildFilter(filters, { source: 'incidents', skipWindow: !(filters.from || filters.to) });
  const lim = f.push(clamp(limit, 1, 100, 20));
  const { rows } = await pool.query(
    `SELECT i.ref, i.kind, i.priority, i.reported_at, z.name AS zone_name,
            EXTRACT(EPOCH FROM i.first_onscene_at - i.reported_at)::int AS response_sec,
            a.route_taken_sec - a.route_proposed_sec AS delta_sec, u.ref AS unit_ref
       FROM incidents i
       JOIN assignments a ON a.incident_id = i.id AND a.is_primary
       JOIN units u ON u.id = a.unit_id
       LEFT JOIN zones z ON z.id = i.zone_id
      WHERE a.route_taken IS NOT NULL AND a.route_proposed IS NOT NULL${f.where}
      ORDER BY i.reported_at DESC LIMIT ${lim}`, f.params);
  return rows.map((r) => ({
    ref: r.ref, kind: r.kind, priority: r.priority, reportedAt: r.reported_at,
    zoneName: r.zone_name, responseSec: r.response_sec, deltaSec: r.delta_sec, unitRef: r.unit_ref,
  }));
}
