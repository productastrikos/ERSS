/**
 * responseTime — stage decomposition. docs/08 §2.1.
 *
 * PURE. Order statistics over rows shaped from v_incident_response; repos/analytics.js
 * fetches, this computes. No modelling — this is measurement.
 *
 * ── As built, and why it differs from the plan ──────────────────────────────────
 * The doc specifies "confidence = a function of n, via the width of the bootstrap CI on
 * the p50". A resampled bootstrap needs a seeded RNG threaded through what is otherwise a
 * pure, RNG-free function, for an estimate that a closed-form already gives: the interval
 * used here is the standard nonparametric CI for a sample quantile — a normal
 * approximation to the rank an order statistic falls at (Conover, *Practical
 * Nonparametric Statistics*, ch. 3) — which is deterministic and numerically close to a
 * bootstrap at these sample sizes. The method string says so.
 */

import { engineResult, insufficientData, confidenceFromInterval } from '../lib/result.js';

export const METHOD = 'stage-order-stats-v1';
export const MIN_N = 5;
const ALPHA = 0.05;
const Z_95 = 1.959964;

export const STAGES = ['callHandling', 'dispatch', 'acknowledge', 'turnout', 'travel'];
export const STAGE_FIELD = {
  callHandling: 'callHandlingSec', dispatch: 'dispatchSec', acknowledge: 'acknowledgeSec',
  turnout: 'turnoutSec', travel: 'travelSec',
};
export const STAGE_LABEL = {
  callHandling: 'Call handling', dispatch: 'Dispatch decision', acknowledge: 'Acknowledge',
  turnout: 'Turnout', travel: 'En-route travel',
};

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Nonparametric CI for a quantile — normal approximation to its rank (Conover ch. 3). */
function quantileCi(sorted, q, z = Z_95) {
  const n = sorted.length;
  if (n < 2) return null;
  const se = Math.sqrt(n * q * (1 - q));
  const loRank = Math.max(0, Math.floor(n * q - z * se));
  const hiRank = Math.min(n - 1, Math.ceil(n * q + z * se));
  return { lower: sorted[loRank], upper: sorted[hiRank] };
}

const clean = (values) => values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);

function stageStats(rawValues) {
  const v = clean(rawValues);
  const n = v.length;
  if (n === 0) return null;
  const p50 = quantile(v, 0.5), p90 = quantile(v, 0.9), p95 = quantile(v, 0.95);
  const mean = +(v.reduce((s, x) => s + x, 0) / n).toFixed(1);
  const ci = n >= MIN_N ? quantileCi(v, 0.5) : null;
  const confidence = ci ? confidenceFromInterval(p50, ci.lower, ci.upper) : null;
  return { n, p50: +p50.toFixed(1), p90: +p90.toFixed(1), p95: +p95.toFixed(1), mean, confidence, ci };
}

/** erf via Abramowitz–Stegun 7.1.26, accurate to 1.5e-7 — enough for a significance test. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

/**
 * Mann–Whitney U, two-sided normal approximation with tie correction.
 * Returns null when either group is empty.
 */
export function mannWhitneyU(a, b) {
  const n1 = a.length, n2 = b.length;
  if (n1 === 0 || n2 === 0) return null;
  const combined = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(combined.length);
  let tieTermSum = 0;
  for (let i = 0; i < combined.length;) {
    let j = i;
    while (j + 1 < combined.length && combined[j + 1].v === combined[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTermSum += t ** 3 - t;
    i = j + 1;
  }
  let r1 = 0;
  for (let k = 0; k < combined.length; k++) if (combined[k].g === 0) r1 += ranks[k];
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const N = n1 + n2;
  const meanU = (n1 * n2) / 2;
  const varTerm = (N + 1) - (N > 1 ? tieTermSum / (N * (N - 1)) : 0);
  const sigmaU = Math.sqrt((n1 * n2 / 12) * Math.max(varTerm, 0));
  const z = sigmaU > 0 ? (u1 - meanU) / sigmaU : 0;
  const p = sigmaU > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  return { z: +z.toFixed(3), p: +p.toFixed(4), u1 };
}

/**
 * Stage decomposition for a filtered population, with a biggest-contributor analysis
 * against a baseline population (typically: the same hour band, emirate-wide).
 *
 * @param {Array<object>} rows          filtered population, one row per incident, fields
 *                                       named by STAGE_FIELD plus `responseSec`
 * @param {Array<object>|null} baselineRows  the comparison population, same shape; pass
 *                                       null/[] to skip the biggest-contributor analysis
 * @param {{from:string,to:string}} window
 */
export function decomposeStages(rows, baselineRows, window) {
  if (!rows || rows.length < MIN_N) {
    return insufficientData({
      method: METHOD,
      window,
      inputs: [{ source: 'v_incident_response', rows: rows?.length ?? 0 }],
      minimum: MIN_N,
      actual: rows?.length ?? 0,
    });
  }

  const byStage = {};
  for (const stage of STAGES) {
    const s = stageStats(rows.map((r) => r[STAGE_FIELD[stage]]));
    if (s) byStage[stage] = s;
  }
  const presentStages = STAGES.filter((s) => byStage[s]);
  const decomposedTotal = presentStages.reduce((s, k) => s + byStage[k].p50, 0);
  const responseStats = stageStats(rows.map((r) => r.responseSec));

  const factors = presentStages.map((k) => ({
    name: STAGE_LABEL[k],
    contribution: decomposedTotal > 0 ? +(byStage[k].p50 / decomposedTotal).toFixed(3) : 0,
    direction: 'up',
    detail: `p50 ${byStage[k].p50}s · p90 ${byStage[k].p90}s · n=${byStage[k].n}`,
  }));

  let biggestContributors = [];
  if (baselineRows?.length) {
    biggestContributors = presentStages
      .map((k) => {
        const a = clean(rows.map((r) => r[STAGE_FIELD[k]]));
        const b = clean(baselineRows.map((r) => r[STAGE_FIELD[k]]));
        if (a.length < MIN_N || b.length < MIN_N) return null;
        const test = mannWhitneyU(a, b);
        if (!test || test.p >= ALPHA) return null;
        const baselineMedian = quantile(b, 0.5);
        const excessSec = +(byStage[k].p50 - baselineMedian).toFixed(1);
        return {
          stage: k, label: STAGE_LABEL[k], excessSec, baselineP50: +baselineMedian.toFixed(1),
          p: test.p, significant: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.excessSec) - Math.abs(a.excessSec));
  }

  const n = rows.length;
  const caveats = [];
  if (n < 30) caveats.push(`sample below 30 (n=${n}) — interval widened accordingly`);
  if (!baselineRows?.length) caveats.push('no baseline population supplied — biggest-contributor analysis skipped');

  return engineResult({
    value: {
      stages: byStage,
      response: responseStats,
      decomposedTotalP50: +decomposedTotal.toFixed(1),
      biggestContributors,
    },
    unit: 'seconds',
    confidence: responseStats?.confidence ?? null,
    window,
    inputs: [
      { source: 'v_incident_response', rows: n },
      ...(baselineRows?.length ? [{ source: 'v_incident_response(baseline)', rows: baselineRows.length }] : []),
    ],
    factors,
    method: METHOD,
    caveats,
    meta: { biggestContributorTest: 'mann-whitney-u', alpha: ALPHA },
  });
}
