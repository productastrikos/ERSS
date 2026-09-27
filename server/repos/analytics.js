/**
 * Reads for the intelligence engines (docs/08). SQL lives here; the engines in
 * engines/ are pure — they take rows shaped by these functions and never touch the
 * database themselves.
 *
 * The WHERE clause comes from the universal filter (lib/filters.js), so the response-time
 * decomposition slices by exactly the same vocabulary as every other chart: multi-value
 * kinds and priorities, zone subtrees, weekday and hour bands, floor and response bands.
 * The legacy single-value query keys the console used to send are mapped onto it in
 * services/analytics.js, so old links keep working.
 */

import { buildFilter } from '../lib/filters.js';
import { gstToday, windowDayLabels, fillDays } from '../lib/timegrid.js';

// Must match engines/eta.js hourBand() and mv_eta_calibration's CASE.
export const HOUR_BANDS = {
  am_peak: [6, 9],
  midday: [10, 16],
  pm_peak: [17, 20],
  evening: [21, 22],
  night: [23, 5],     // wraps midnight — buildFilter handles that
};

const GST = 'Asia/Dubai';

const STAGE_ROW_SELECT = `
  SELECT r.call_handling_sec AS "callHandlingSec", r.dispatch_sec AS "dispatchSec",
         r.acknowledge_sec AS "acknowledgeSec", r.turnout_sec AS "turnoutSec",
         r.travel_sec AS "travelSec", r.vrt_sec AS "vrtSec", r.response_sec AS "responseSec",
         r.gst_hour AS "gstHour", r.gst_dow AS "gstDow", r.zone_id AS "zoneId",
         r.priority::text AS priority, r.kind AS kind, r.unit_kind::text AS "unitKind"
    FROM v_incident_response r`;

/**
 * Stage-decomposition rows for responseTime (docs/08 §2.1).
 *
 * Resting-state incidents are excluded by default — their stage timings are scripted for
 * the demo picture, and an engine run on them would present a prop as a measurement (the
 * same rule repos/incidents.js kpisBetween applies).
 */
export async function stageRows(db, { filters = {}, defaultDays = 30 } = {}) {
  const f = buildFilter(filters, { source: 'response', window: { days: defaultDays } });
  const { rows } = await db.query(
    `${STAGE_ROW_SELECT} WHERE r.response_sec IS NOT NULL${f.where}`,
    f.params,
  );
  return rows;
}

/**
 * The emirate-wide baseline for the biggest-contributor comparison: the same window and
 * hour band as the filtered population, with the narrowing dimensions dropped — a stage
 * is only "excessive" relative to the rest of the service at the same time of day.
 */
export async function baselineStageRows(db, { filters = {}, defaultDays = 30 } = {}) {
  const keep = ['from', 'to', 'hourFrom', 'hourTo', 'dow', 'includeResting'];
  const trimmed = Object.fromEntries(Object.entries(filters).filter(([k]) => keep.includes(k)));
  return stageRows(db, { filters: trimmed, defaultDays });
}

/**
 * Daily stage medians over the window, zero-filled — the series the response-time page
 * forecasts. Every stage gets its own column so one query feeds every line on the card.
 */
export async function stageTrendRows(db, { filters = {}, defaultDays = 30 } = {}) {
  const f = buildFilter(filters, { source: 'response', window: { days: defaultDays } });
  const [{ rows }, today] = await Promise.all([
    db.query(
      `SELECT to_char(date_trunc('day', r.reported_at AT TIME ZONE '${GST}'), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec)      AS response,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.call_handling_sec) AS call_handling,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.dispatch_sec)      AS dispatch,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.acknowledge_sec)   AS acknowledge,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.turnout_sec)       AS turnout,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.travel_sec)        AS travel,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.vrt_sec)           AS vertical
         FROM v_incident_response r
        WHERE r.response_sec IS NOT NULL${f.where}
        GROUP BY 1 ORDER BY 1`,
      f.params,
    ),
    gstToday(db),
  ]);
  // Gap-filled in JS, not by a generated calendar: see lib/timegrid.js for why.
  return fillDays(rows, windowDayLabels(filters, defaultDays, today), 'day', (r, day) => ({
    day,
    n: r?.n ?? 0,
    response: r?.response ?? null,
    call_handling: r?.call_handling ?? null,
    dispatch: r?.dispatch ?? null,
    acknowledge: r?.acknowledge ?? null,
    turnout: r?.turnout ?? null,
    travel: r?.travel ?? null,
    vertical: r?.vertical ?? null,
  }));
}
