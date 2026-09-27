/**
 * eta — travel time prediction. docs/08 §3.2.
 *
 * PURE. Takes a road distance and a calibration table; returns an EngineResult. It never
 * calls OSRM, never reads the clock, never touches the database — services/eta.js
 * fetches, this computes.
 *
 * ── As built, and why it differs from the plan ──────────────────────────────────
 * The plan calibrates OSRM's free-flow DURATION against history (t_actual / t_osrm).
 * History records no OSRM duration, so that ratio cannot be measured. What history does
 * record is road distance and measured travel. The engine is therefore calibrated on
 * PACE — seconds per road metre — keyed on hour band × zone class, which is measurable,
 * and OSRM supplies the road distance. OSRM's own duration is reported alongside as the
 * free-flow reference, never as the prediction.
 *
 *   travel_q = max(short_q, pace_q × distance)       for q ∈ {p10, p25, p50, p75, p90}
 *
 * `short` is the measured travel of sub-kilometre trips: a pure pace model would claim a
 * 300 m call takes 30 s, and nothing turns out of a station and arrives in 30 s.
 *
 * Thin cells shrink toward the all-cells figure (James–Stein style, weight n / (n + K)),
 * so a desert cell with 300 trips does not produce a confident outlier.
 *
 * Confidence = 1 − IQR / p50, floored at 0 — the doc's definition, from the calibration
 * cell's measured spread. When OSRM is unavailable the distance itself is uncertain
 * (straight line × detour factor), and that uncertainty widens the interval rather than
 * being papered over with an invented discount.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'pace-calibrated-v1';
export const VRT_METHOD = 'vrt-floor-band-empirical-v1';

/** Shrinkage constant: a cell with K trips is weighted half its own, half the all-cells figure. */
const SHRINK_K = 200;

/** Straight line → road. The central figure matches how history recorded road distance;
 *  the band is the spread of real urban detour ratios, used only to widen the interval. */
export const DETOUR = { low: 1.15, mid: 1.34, high: 1.55 };

const QUANTILES = ['p10', 'p25', 'p50', 'p75', 'p90'];

/** Must match the CASE in views.sql mv_eta_calibration. */
export function hourBand(gstHour) {
  if (gstHour >= 6 && gstHour <= 9) return 'am_peak';
  if (gstHour >= 10 && gstHour <= 16) return 'midday';
  if (gstHour >= 17 && gstHour <= 20) return 'pm_peak';
  if (gstHour === 21 || gstHour === 22) return 'evening';
  return 'night';
}

export const HOUR_BAND_LABEL = {
  am_peak: 'morning peak (06–09)', midday: 'midday (10–16)', pm_peak: 'evening peak (17–20)',
  evening: 'late evening (21–22)', night: 'night (23–05)',
};

/** Must match views.sql. */
export function floorBand(floor) {
  if (floor < 10) return 'f00-09';
  if (floor < 20) return 'f10-19';
  if (floor < 40) return 'f20-39';
  if (floor < 60) return 'f40-59';
  return 'f60+';
}

/**
 * Index the rows of mv_eta_calibration. Computes the n-weighted all-cells quantiles the
 * shrinkage pulls toward.
 *
 * @param {Array<{kind:string,key:string,n:number,p10:number,p25:number,p50:number,p75:number,p90:number}>} rows
 * @param {{ from: string, to: string }} window  the history the view was built from
 */
export function buildCalibration(rows, window) {
  const byKind = { pace: new Map(), short: new Map(), vrt: new Map(), stage: new Map() };
  for (const r of rows) {
    if (!byKind[r.kind]) continue;
    byKind[r.kind].set(r.key, {
      n: r.n, p10: +r.p10, p25: +r.p25, p50: +r.p50, p75: +r.p75, p90: +r.p90,
    });
  }
  const pooled = (map) => {
    let n = 0;
    const acc = Object.fromEntries(QUANTILES.map((q) => [q, 0]));
    for (const cell of map.values()) {
      n += cell.n;
      for (const q of QUANTILES) acc[q] += cell[q] * cell.n;
    }
    if (n === 0) return null;
    for (const q of QUANTILES) acc[q] /= n;
    return { n, ...acc };
  };
  return {
    ...byKind,
    global: { pace: pooled(byKind.pace), short: pooled(byKind.short), vrt: pooled(byKind.vrt) },
    window,
    rows: rows.reduce((s, r) => s + (r.kind === 'pace' ? r.n : 0), 0),
  };
}

function shrink(cell, global) {
  if (!global) return cell ? { ...cell, weight: 1 } : null;
  if (!cell) return { ...global, n: 0, weight: 0 };
  const w = cell.n / (cell.n + SHRINK_K);
  const out = { n: cell.n, weight: w };
  for (const q of QUANTILES) out[q] = w * cell[q] + (1 - w) * global[q];
  return out;
}

const round = (v) => Math.round(v);
const km = (m) => `${(m / 1000).toFixed(1)} km`;

/**
 * Predict road travel time.
 *
 * @param {object} p
 * @param {number} p.distanceM        road distance (OSRM) or straight-line distance (fallback)
 * @param {'osrm'|'straight_line'} p.distanceSource
 * @param {number|null} [p.freeFlowSec]  OSRM's own duration, reported for reference
 * @param {number} p.gstHour
 * @param {string} p.zoneClass
 * @param {ReturnType<typeof buildCalibration>} cal
 */
export function predictTravel({ distanceM, distanceSource, freeFlowSec = null, gstHour, zoneClass }, cal) {
  const band = hourBand(gstHour);
  const key = `${band}|${zoneClass}`;
  const pace = shrink(cal.pace.get(key), cal.global.pace);
  const short = shrink(cal.short.get(key), cal.global.short);

  if (!pace || !short) {
    return insufficientData({
      method: METHOD,
      window: cal.window ?? { from: null, to: null },
      inputs: [{ source: 'mv_eta_calibration', rows: 0 }],
      reason: 'No calibration data — run `npm run seed:derived`',
    });
  }

  const straight = distanceSource === 'straight_line';
  // A straight line becomes a road-distance RANGE; the low end feeds the fast
  // quantiles and the high end the slow ones, so the interval carries the uncertainty.
  const dist = straight
    ? { lo: distanceM * DETOUR.low, mid: distanceM * DETOUR.mid, hi: distanceM * DETOUR.high }
    : { lo: distanceM, mid: distanceM, hi: distanceM };

  const at = (q, d) => Math.max(short[q], pace[q] * d);
  const value = {
    p10: at('p10', dist.lo), p25: at('p25', dist.lo), p50: at('p50', dist.mid),
    p75: at('p75', dist.hi), p90: at('p90', dist.hi),
  };
  const seconds = round(value.p50);
  const confidence = Math.max(0, Math.min(0.98, 1 - (value.p75 - value.p25) / value.p50));

  // Contributions in seconds: what the distance costs at the all-day pace, and what this
  // hour and this kind of district add or save on top of it.
  const base = Math.max(short.p50, cal.global.pace.p50 * dist.mid);
  const adjustment = seconds - base;
  const factors = [
    {
      name: 'Road distance',
      contribution: round(base),
      direction: 'up',
      detail: straight
        ? `${km(distanceM)} straight line × ${DETOUR.mid} detour — road routing unavailable`
        : `${km(distanceM)} by road`,
    },
    {
      name: 'Time of day and district',
      contribution: round(adjustment),
      direction: adjustment >= 0 ? 'up' : 'down',
      detail: `${HOUR_BAND_LABEL[band]}, ${zoneClass} — ${pace.p50.toFixed(3)} s/m against ${cal.global.pace.p50.toFixed(3)} s/m all-day`
        + (pace.weight < 0.5 ? ` (thin cell, n=${pace.n}, shrunk toward the all-cells figure)` : ''),
    },
  ];

  const caveats = [];
  if (straight) caveats.push('Road routing unavailable — distance estimated from a straight line; interval widened accordingly');
  if (seconds === round(short.p50) && dist.mid < 1000) caveats.push('Short trip — the measured sub-kilometre floor applies, not distance');

  return engineResult({
    value: { seconds, p10: round(value.p10), p25: round(value.p25), p75: round(value.p75), p90: round(value.p90),
             distanceM: round(dist.mid), freeFlowSec: freeFlowSec === null ? null : round(freeFlowSec),
             band, zoneClass },
    unit: 'seconds',
    confidence: +confidence.toFixed(3),
    window: cal.window,
    inputs: [
      { source: 'mv_eta_calibration', rows: pace.n },
      { source: straight ? 'straight_line' : 'osrm', rows: 1 },
    ],
    factors,
    method: `${METHOD}${straight ? '+straight-line' : '+osrm'}`,
    caveats,
    meta: { cell: key, cellWeight: +pace.weight.toFixed(3) },
  });
}

/** Floor bands in ascending order, with a representative floor for extrapolation. */
const FLOOR_BANDS = [['f00-09', 5], ['f10-19', 15], ['f20-39', 30], ['f40-59', 50], ['f60+', 70]];
const VRT_MIN_N = 30;

/**
 * Vertical Response Time — entrance to patient. docs/08 §3.2.
 *
 * Empirical by floor band from recorded vrt_sec. Reported SEPARATELY from travel, always:
 * conflating them is exactly how the last-hundred-metres problem stays invisible.
 * Returns null for incidents with no floor — a villa has no vertical stage to predict.
 *
 * NOT shrunk toward an all-floors figure: height is the thing that drives VRT, so pooling
 * across floors would pull every tall-tower prediction down. A band with fewer than 30
 * recorded ascents is instead extrapolated from the nearest populated band BELOW it, plus
 * the extra floors at the configured ascent rate — and says so.
 *
 * @param {{ floor: number|null, ascentSecPerFloor: number }} p
 * @param {ReturnType<typeof buildCalibration>} cal
 */
export function predictVrt({ floor, ascentSecPerFloor }, cal) {
  if (floor === null || floor === undefined) return null;
  const band = floorBand(floor);
  const idx = FLOOR_BANDS.findIndex(([b]) => b === band);

  let source = null;
  for (let i = idx; i >= 0; i--) {
    const cell = cal.vrt.get(FLOOR_BANDS[i][0]);
    if (cell && cell.n >= VRT_MIN_N) { source = { cell, band: FLOOR_BANDS[i][0], mid: FLOOR_BANDS[i][1], own: i === idx }; break; }
  }
  if (!source) return null;

  const extra = source.own ? 0 : Math.max(0, floor - source.mid) * ascentSecPerFloor;
  const { cell } = source;
  const caveats = source.own ? [] : [
    `Band ${band} has ${cal.vrt.get(band)?.n ?? 0} recorded ascents — extrapolated from ${source.band} plus ${round(extra)} s of extra climb`,
  ];

  return engineResult({
    value: { seconds: round(cell.p50 + extra), p25: round(cell.p25 + extra), p75: round(cell.p75 + extra), band },
    unit: 'seconds',
    confidence: +Math.max(0, Math.min(0.98, 1 - (cell.p75 - cell.p25) / (cell.p50 + extra))).toFixed(3),
    window: cal.window,
    inputs: [{ source: 'mv_eta_calibration', rows: cell.n }],
    factors: [
      { name: 'Floor', contribution: round(cell.p50), direction: 'up', detail: `floor ${floor}: measured median for ${source.band}` },
      ...(extra ? [{ name: 'Extra climb', contribution: round(extra), direction: 'up', detail: `${ascentSecPerFloor} s per floor above floor ${source.mid}` }] : []),
    ],
    method: VRT_METHOD,
    caveats,
  });
}

/**
 * Seconds from NOW until the unit is at the entrance: acknowledge and turnout (the
 * measured medians) when the unit has not yet moved, plus predicted travel.
 *
 * @param {{ travelSec: number, stage: 'offer'|'acknowledged'|'moving' }} p
 * @param {ReturnType<typeof buildCalibration>} cal
 */
export function arrivalSec({ travelSec, stage }, cal) {
  const ack = cal.stage.get('acknowledge')?.p50 ?? 0;
  const turnout = cal.stage.get('turnout')?.p50 ?? 0;
  const pre = stage === 'offer' ? ack + turnout : stage === 'acknowledged' ? turnout : 0;
  return round(pre + travelSec);
}
