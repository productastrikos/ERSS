/**
 * demand — spatiotemporal forecast. docs/08 §3.1.
 *
 * PURE. A seasonal Poisson rate model with multiplicative covariate adjustment, not the
 * Gaussian-mixture-plus-CNN the research proposes: it trains in under a second and every
 * term in it can be explained to a duty officer, which at this data volume matters more
 * than the marginal accuracy a heavier model would buy.
 *
 *   λ_base(z, how) = Σ w_k · n_k / Σ w_k,   w_k = 0.5^(age_weeks / 12)
 *   λ              = λ_base × Π adjustments
 *
 * repos/demand.js fetches the weekly counts and the fitted covariate ratios; this
 * computes. The ratios themselves (weather band, event scale, day type, trend) are
 * fitted upstream as a ratio of observed to expected over history — the same shape of
 * calibration engines/eta.js does — and arrive here already resolved to multipliers.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'seasonal-poisson-ewma-v1';
const HALF_LIFE_WEEKS = 12;
const MIN_WEEKS = 4;
const INTERVAL_P = 0.8;   // the doc's "Poisson 80% interval"

/**
 * λ_base — exponentially-weighted mean of historical counts for one zone × hour-of-week
 * bucket, 12-week half-life. `weeklyCounts` is one row per week observed:
 * [{ weeksAgo: 0, count: 4 }, { weeksAgo: 1, count: 2 }, ...].
 */
export function ewmaBaseRate(weeklyCounts, halfLifeWeeks = HALF_LIFE_WEEKS) {
  if (!weeklyCounts?.length) return null;
  let wSum = 0, wnSum = 0;
  for (const { weeksAgo, count } of weeklyCounts) {
    const w = 0.5 ** (weeksAgo / halfLifeWeeks);
    wSum += w;
    wnSum += w * count;
  }
  return wSum > 0 ? wnSum / wSum : null;
}

/** Poisson pmf/cdf by forward recurrence — stable at the small counts demand forecasting deals in. */
function poissonCdfTable(lambda, maxK) {
  const pmf = new Array(maxK + 1);
  pmf[0] = Math.exp(-lambda);
  for (let k = 1; k <= maxK; k++) pmf[k] = pmf[k - 1] * (lambda / k);
  const cdf = new Array(maxK + 1);
  let acc = 0;
  for (let k = 0; k <= maxK; k++) { acc += pmf[k]; cdf[k] = acc; }
  return cdf;
}

/** Smallest k with P(X ≤ k) ≥ p, for X ~ Poisson(λ). */
export function poissonQuantile(lambda, p) {
  if (!(lambda > 0)) return 0;
  const maxK = Math.max(20, Math.ceil(lambda + 10 * Math.sqrt(lambda) + 10));
  const cdf = poissonCdfTable(lambda, maxK);
  for (let k = 0; k <= maxK; k++) if (cdf[k] >= p) return k;
  return maxK;
}

/**
 * Forecast one zone × hour-of-week bucket.
 *
 * @param {object} p
 * @param {Array<{weeksAgo:number,count:number}>} p.weeklyCounts
 * @param {{weather?:number, event?:number, dayType?:number, trend?:number}} [p.covariates]
 *   each a multiplicative ratio of observed/expected; omitted or 1 = no adjustment
 * @param {{predicted:number,actual:number,lower:number,upper:number}[]} [p.trailingAccuracy]
 *   the last 30 days of this bucket's own forecasts, held to account (docs/08 §3.1)
 * @param {{from:string,to:string}} window
 */
export function forecastDemand({ zoneId, zoneRef, hourOfWeek, weeklyCounts, covariates = {}, trailingAccuracy = [] }, window) {
  if (!weeklyCounts || weeklyCounts.length < MIN_WEEKS) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'mv_zone_hour_of_week', rows: weeklyCounts?.length ?? 0 }],
      minimum: MIN_WEEKS, actual: weeklyCounts?.length ?? 0,
    });
  }

  const base = ewmaBaseRate(weeklyCounts);
  const adj = {
    weather: covariates.weather ?? 1,
    event: covariates.event ?? 1,
    dayType: covariates.dayType ?? 1,
    trend: covariates.trend ?? 1,
  };
  const multiplier = adj.weather * adj.event * adj.dayType * adj.trend;
  const lambda = Math.max(0, base * multiplier);

  let lower = poissonQuantile(lambda, (1 - INTERVAL_P) / 2);
  let upper = poissonQuantile(lambda, 1 - (1 - INTERVAL_P) / 2);
  // Widen for covariate uncertainty: the further the combined adjustment sits from 1,
  // the less the base rate alone explains, and the interval says so rather than
  // reporting the same width whether or not the forecast leans on a fitted covariate.
  const covariateSpread = Math.abs(multiplier - 1);
  if (covariateSpread > 0.2) {
    const widen = Math.ceil(lambda * covariateSpread * 0.5);
    lower = Math.max(0, lower - widen);
    upper = upper + widen;
  }

  const accuracy = trailingAccuracy.length >= 10 ? forecastAccuracy(trailingAccuracy) : null;
  const confidence = accuracy ? accuracy.intervalCoveragePct / 100 : null;

  const factors = [
    { name: 'Historical base rate', contribution: +base.toFixed(2), direction: 'up', detail: `12-week EWMA over ${weeklyCounts.length} weeks of this hour-of-week bucket` },
    ...(adj.weather !== 1 ? [{ name: 'Weather', contribution: +(base * (adj.weather - 1)).toFixed(2), direction: adj.weather > 1 ? 'up' : 'down', detail: `×${adj.weather.toFixed(2)}` }] : []),
    ...(adj.event !== 1 ? [{ name: 'Scheduled event', contribution: +(base * (adj.event - 1)).toFixed(2), direction: adj.event > 1 ? 'up' : 'down', detail: `×${adj.event.toFixed(2)}` }] : []),
    ...(adj.dayType !== 1 ? [{ name: 'Day type', contribution: +(base * (adj.dayType - 1)).toFixed(2), direction: adj.dayType > 1 ? 'up' : 'down', detail: `×${adj.dayType.toFixed(2)}` }] : []),
    ...(adj.trend !== 1 ? [{ name: 'Recent trend', contribution: +(base * (adj.trend - 1)).toFixed(2), direction: adj.trend > 1 ? 'up' : 'down', detail: `×${adj.trend.toFixed(2)}` }] : []),
  ];

  const caveats = [];
  if (!accuracy) caveats.push('no trailing 30-day accuracy on this bucket yet — confidence unavailable, not invented');
  if (weeklyCounts.length < 12) caveats.push(`only ${weeklyCounts.length} weeks of history — the 12-week half-life has not fully engaged`);

  return engineResult({
    value: {
      lambda: +lambda.toFixed(2), lower80: lower, upper80: upper,
      zoneId, zoneRef, hourOfWeek, accuracy,
    },
    unit: 'calls/hour',
    confidence,
    window,
    inputs: [{ source: 'mv_zone_hour_of_week', rows: weeklyCounts.length }],
    factors,
    method: METHOD,
    caveats,
    meta: { intervalP: INTERVAL_P, multiplier: +multiplier.toFixed(3) },
  });
}

/**
 * Held to account (docs/08 §3.1): MAE, bias and 80% interval coverage against backfilled
 * actuals. Used both as the confidence input above and as the Analytics → Forecast panel.
 *
 * @param {{predicted:number, actual:number, lower:number, upper:number}[]} rows
 */
export function forecastAccuracy(rows) {
  const usable = rows.filter((r) => Number.isFinite(r.predicted) && Number.isFinite(r.actual));
  if (usable.length === 0) return null;
  const n = usable.length;
  const mae = usable.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / n;
  const bias = usable.reduce((s, r) => s + (r.predicted - r.actual), 0) / n;
  const covered = usable.filter((r) => r.actual >= (r.lower ?? -Infinity) && r.actual <= (r.upper ?? Infinity)).length;
  return {
    n,
    mae: +mae.toFixed(2),
    bias: +bias.toFixed(2),
    intervalCoveragePct: +((100 * covered) / n).toFixed(1),
  };
}
