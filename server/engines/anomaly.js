/**
 * anomaly — deviation detection. docs/08 §3.8.
 *
 * PURE. Seasonal-baseline EWMA with a robust z-score, deliberately simple: a median and
 * MAD over the trailing baseline, an EWMA of the recent points to smooth single-call
 * noise, and a flag only when two consecutive buckets both cross the threshold — the
 * "sustained" requirement is what keeps this from flagging on one busy hour.
 *
 * Kept to one series dimension (zone × hour bucket) rather than the full
 * zone × incident-kind × hour-of-week cross in the plan — the arithmetic is identical,
 * this is a narrower slice of it. Extending the dimension is additive, not structural.
 */

import { engineResult, insufficientData, confidenceFromSample } from '../lib/result.js';

export const METHOD = 'ewma-robust-z-v1';
export const MIN_POINTS = 8;
export const ALPHA = 0.3;
export const Z_THRESHOLD = 3;

/** Median of a numeric array. */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation, scaled by 1.4826 so it estimates σ under normality. */
export function robustSpread(values, med) {
  const mad = median(values.map((v) => Math.abs(v - med)));
  return 1.4826 * mad;
}

/** EWMA of a series, most-recent-last. Returns the smoothed value at each index. */
export function ewma(values, alpha = ALPHA) {
  const out = [];
  let prev;
  for (const v of values) {
    prev = out.length === 0 ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

/**
 * Detect a sustained anomaly in one series.
 *
 * @param {{ zoneId?: string, zoneRef?: string, seriesName: string,
 *           points: Array<{ bucket: string, value: number }> }} series  oldest → newest
 * @param {{from:string,to:string}} window
 */
export function detectAnomaly({ zoneId, zoneRef, seriesName, points }, window) {
  if (!points || points.length < MIN_POINTS) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'v_zone_hourly', rows: points?.length ?? 0 }],
      minimum: MIN_POINTS, actual: points?.length ?? 0,
    });
  }

  const values = points.map((p) => p.value);
  // The baseline excludes the last two buckets — what we are asking "is this sustained
  // deviation surprising against" must not include the thing being tested.
  const baseline = values.slice(0, -2);
  const med = median(baseline.length ? baseline : values);
  const spread = robustSpread(baseline.length ? baseline : values, med) || 1;

  const smoothed = ewma(values);
  const z = smoothed.map((v) => (v - med) / spread);

  const latest = z.at(-1);
  const prior = z.at(-2);
  const sustained = Math.abs(latest) > Z_THRESHOLD && Math.abs(prior) > Z_THRESHOLD;
  const direction = latest > 0 ? 'up' : 'down';

  const caveats = [];
  if (baseline.length < 12 * 7) caveats.push('baseline is shorter than the recommended 12-week window');

  return engineResult({
    value: {
      zoneId, zoneRef, seriesName,
      median: +med.toFixed(2), spread: +spread.toFixed(2),
      latestValue: values.at(-1), latestZ: +latest.toFixed(2), priorZ: +prior.toFixed(2),
      sustained, direction,
      series: points.map((p, i) => ({ bucket: p.bucket, value: p.value, z: +z[i].toFixed(2) })),
    },
    unit: 'z-score',
    confidence: sustained ? confidenceFromSample(baseline.length, 84) : null,
    window,
    inputs: [{ source: 'v_zone_hourly', rows: points.length }],
    factors: [
      { name: 'Deviation from baseline median', contribution: Math.abs(latest), direction, detail: `z = ${latest.toFixed(2)} against a baseline median of ${med.toFixed(2)}` },
    ],
    method: METHOD,
    caveats,
    meta: { alpha: ALPHA, threshold: Z_THRESHOLD, sustained },
  });
}
