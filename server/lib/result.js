/**
 * The EngineResult envelope.
 *
 * Every engine returns one of these. The advisory and analytics UI take this shape and
 * cannot render without `factors` and `window` — which is how the explainability
 * requirement (BoQ-5 T5, and the Concept Note's "explainable by construction") is made
 * STRUCTURAL rather than aspirational. An engine that returns a bare number cannot be
 * displayed.
 *
 * `confidence` is never invented. Each engine documents what its confidence is derived
 * from. An engine that cannot justify one returns null, and the UI shows "not enough
 * data" — which is more useful than a fabricated 0.7.
 */

import { nowIso } from './clock.js';

/**
 * @param {object} spec
 * @param {*}      spec.value
 * @param {string} [spec.unit]
 * @param {number|null} spec.confidence   0..1, or null when it cannot be justified
 * @param {{from: string, to: string}} spec.window
 * @param {Array<{source: string, rows: number, asOf?: string}>} spec.inputs
 * @param {Array<{name: string, contribution: number, direction?: 'up'|'down', detail?: string}>} [spec.factors]
 * @param {string} spec.method            versioned, e.g. 'poisson-rate-hourly-v1'
 * @param {string[]} [spec.caveats]
 * @param {object} [spec.meta]
 */
export function engineResult({
  value, unit, confidence, window, inputs, factors = [], method, caveats = [], meta = {},
}) {
  if (!method) throw new Error('engineResult: method is required (and must be versioned)');
  if (!window?.from || !window?.to) throw new Error(`engineResult(${method}): window {from,to} is required`);
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error(`engineResult(${method}): inputs must name at least one source`);
  }
  if (confidence !== null && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
    throw new Error(`engineResult(${method}): confidence must be 0..1 or null, got ${confidence}`);
  }

  return {
    value,
    unit: unit ?? null,
    confidence,
    window,
    inputs,
    factors,
    method,
    caveats,
    meta,
    computedAt: nowIso(),
  };
}

/**
 * The "not enough data" result. Honest, renderable, and distinguishable from a real
 * answer of zero — which matters, because "no incidents" and "no data" mean very
 * different things to a commander.
 */
export function insufficientData({ method, window, inputs = [], reason, minimum, actual }) {
  return {
    value: null,
    unit: null,
    confidence: null,
    window,
    inputs: inputs.length ? inputs : [{ source: 'n/a', rows: actual ?? 0 }],
    factors: [],
    method,
    caveats: [reason ?? `sample of ${actual} below the minimum of ${minimum}`],
    meta: { insufficient: true, minimum, actual },
    computedAt: nowIso(),
  };
}

/** True when a result is the insufficient-data sentinel. */
export const isInsufficient = (r) => r?.meta?.insufficient === true;

/**
 * Confidence from a bootstrap/interval width relative to the estimate.
 * Wide interval → low confidence. Clamped to [0.05, 0.98]: absolute certainty is not a
 * thing this system is entitled to claim.
 */
export function confidenceFromInterval(estimate, lower, upper) {
  if (!Number.isFinite(estimate) || estimate === 0) return null;
  const relWidth = Math.abs(upper - lower) / Math.abs(estimate);
  return Math.max(0.05, Math.min(0.98, 1 - relWidth / 2));
}

/**
 * Confidence from sample size against a reference n, on a saturating curve.
 * n=30 → ~0.55, n=100 → ~0.77, n=500 → ~0.94.
 */
export function confidenceFromSample(n, reference = 100) {
  if (!n || n <= 0) return null;
  return Math.max(0.05, Math.min(0.98, n / (n + reference * 0.3)));
}

/** Normalise factor contributions to sum to 1 so the UI bars are comparable. */
export function normaliseFactors(factors) {
  const total = factors.reduce((s, f) => s + Math.abs(f.contribution), 0);
  if (total === 0) return factors;
  return factors
    .map((f) => ({ ...f, contribution: f.contribution / total }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}
