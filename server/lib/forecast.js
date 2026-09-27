/**
 * Forecasting — the ONE predictor behind every trend line in the product.
 *
 * Client requirement: every visualisation carries a prediction. A prediction is only
 * worth showing if the screen can also say how it was made and how wrong it has been, so
 * every result here returns its method, its fitted parameters, a prediction interval, and
 * a walk-forward backtest (MAE / MAPE / interval coverage) measured on the same series it
 * is about to extrapolate. docs/00 D-09: a forecast is never presented as a measurement.
 *
 * Deliberately dependency-free and explainable:
 *   n < 3                      → flat mean ("too short to model")
 *   n < 2 seasons, or no season → Holt's linear trend, damped
 *   n >= 2 seasons             → Holt–Winters additive, damped trend
 *
 * Damping (phi < 1) matters: an undamped linear trend on 30 days of ambulance calls will
 * happily predict double the volume by next quarter, which is not a forecast, it is a
 * straight line with ambition.
 */

/** Standard-normal quantiles for the two intervals the UI offers. */
const Z80 = 1.2816;
const Z95 = 1.96;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * @param values  the observed series, oldest first. Nulls are carried forward.
 * @param opts.horizon  how many steps ahead
 * @param opts.season   season length in steps (7 daily, 12 monthly, 24 hourly, 0 = none)
 * @param opts.nonNegative  clamp predictions and interval floors at 0 (counts, seconds)
 * @param opts.integer  round to whole units (call counts)
 * @returns {{
 *   method: string, points: Array<{ h: number, predicted: number,
 *     lower80: number, upper80: number, lower95: number, upper95: number }>,
 *   sigma: number|null, mae: number|null, mape: number|null, coverage80Pct: number|null,
 *   alpha: number, beta: number, gamma: number, phi: number,
 *   season: number, n: number, trendPerStep: number|null, caveats: string[]
 * }}
 */
export function forecast(values, opts = {}) {
  const horizon = Math.max(0, Math.min(60, Math.round(opts.horizon ?? 6)));
  const nonNegative = opts.nonNegative !== false;
  const integer = opts.integer === true;
  const caveats = [];

  // Carry the last observation over gaps; a hole is missing measurement, not a zero.
  const series = [];
  let last = null;
  for (const v of values ?? []) {
    if (finite(v)) { last = v; series.push(v); } else if (last != null) { series.push(last); caveats.push('gap'); }
  }
  const n = series.length;
  const empty = {
    method: 'No history', points: [], sigma: null, mae: null, mape: null, coverage80Pct: null,
    alpha: 0, beta: 0, gamma: 0, phi: 0, season: 0, n, trendPerStep: null,
    caveats: ['Not enough history to forecast'],
  };
  if (n === 0 || horizon === 0) return { ...empty, method: n === 0 ? 'No history' : 'No horizon requested' };

  let season = Math.max(0, Math.round(opts.season ?? 0));
  if (season < 2 || n < season * 2) {
    if (season >= 2) caveats.push(`fewer than two full cycles of ${season} — seasonality not fitted`);
    season = 0;
  }

  if (n < 3) {
    const flat = mean(series);
    const sigma = n > 1 ? Math.sqrt(mean(series.map((v) => (v - flat) ** 2))) : Math.abs(flat) * 0.25;
    return {
      ...empty,
      method: `Flat mean of ${n} observation${n === 1 ? '' : 's'} — too short to fit a trend`,
      points: intervals(Array.from({ length: horizon }, () => flat), sigma, { nonNegative, integer }),
      sigma, season: 0, n, trendPerStep: 0,
      caveats: [...new Set([...caveats, 'Too few points for a trend or a season'])],
    };
  }

  // ── Fit: small deterministic grid search on one-step SSE ────────────────────
  const grid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8];
  const betaGrid = [0, 0.02, 0.05, 0.1, 0.2, 0.35];
  const gammaGrid = season ? [0.05, 0.15, 0.3, 0.5] : [0];
  const phiGrid = [0.85, 0.92, 0.98];

  let best = null;
  for (const alpha of grid) {
    for (const beta of betaGrid) {
      for (const gamma of gammaGrid) {
        for (const phi of phiGrid) {
          const fit = holtWinters(series, { alpha, beta, gamma, phi, season });
          if (!fit) continue;
          if (!best || fit.sse < best.sse) best = { ...fit, alpha, beta, gamma, phi };
        }
      }
    }
  }
  if (!best) return { ...empty, method: 'Fit failed' };

  // ── Residual scale from the one-step errors the fit actually made ──────────
  const errs = best.errors.filter(finite);
  const sigma = errs.length > 1 ? Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length) : Math.abs(mean(series)) * 0.2;

  const path = project(best, horizon, season);
  const points = intervals(path, sigma, { nonNegative, integer, damping: best.phi });

  // ── Held to account: walk-forward, refit-free backtest over the last third ─
  const back = backtest(series, { ...best, season }, sigma);

  const method = season
    ? `Holt–Winters additive, season ${season}, damped (alpha ${best.alpha}, beta ${best.beta}, gamma ${best.gamma}, phi ${best.phi})`
    : best.beta > 0
      ? `Holt linear trend, damped (alpha ${best.alpha}, beta ${best.beta}, phi ${best.phi})`
      : `Exponential smoothing, level only (alpha ${best.alpha})`;

  if (back.mape != null && back.mape > 35) caveats.push(`backtest error is high (MAPE ${back.mape.toFixed(0)}%) — treat the band, not the line`);
  if (n < 12) caveats.push(`only ${n} points of history`);

  return {
    method,
    points,
    sigma: round2(sigma),
    mae: back.mae,
    mape: back.mape,
    coverage80Pct: back.coverage80Pct,
    alpha: best.alpha, beta: best.beta, gamma: best.gamma, phi: best.phi,
    season, n,
    trendPerStep: round2(best.trend),
    caveats: [...new Set(caveats)],
  };
}

// ── The recursion ─────────────────────────────────────────────────────────────

function holtWinters(y, { alpha, beta, gamma, phi, season }) {
  const n = y.length;
  let level;
  let trend;
  const s = new Array(season).fill(0);

  if (season) {
    const first = y.slice(0, season);
    const second = y.slice(season, season * 2);
    if (second.length < season) return null;
    level = mean(first);
    trend = (mean(second) - mean(first)) / season;
    for (let i = 0; i < season; i++) s[i] = y[i] - level;
  } else {
    level = y[0];
    trend = y[1] - y[0];
  }

  const start = season ? season : 2;
  let sse = 0;
  const errors = [];
  for (let t = start; t < n; t++) {
    const si = season ? s[t % season] : 0;
    const f = level + phi * trend + si;
    const e = y[t] - f;
    errors.push(e);
    sse += e * e;
    const prevLevel = level;
    if (season) {
      level = alpha * (y[t] - si) + (1 - alpha) * (prevLevel + phi * trend);
      trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
      s[t % season] = gamma * (y[t] - level) + (1 - gamma) * si;
    } else {
      level = alpha * y[t] + (1 - alpha) * (prevLevel + phi * trend);
      trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    }
  }
  return { sse, errors, level, trend, seasonal: s, lastIndex: n - 1 };
}

/** h steps ahead from a fitted state, with the damped-trend sum. */
function project(fit, horizon, season) {
  const out = [];
  for (let h = 1; h <= horizon; h++) {
    let damped = 0;
    for (let k = 1; k <= h; k++) damped += fit.phi ** k;
    const si = season ? fit.seasonal[(fit.lastIndex + h) % season] : 0;
    out.push(fit.level + damped * fit.trend + si);
  }
  return out;
}

/** Intervals widen with the square root of the horizon — the random-walk variance sum. */
function intervals(path, sigma, { nonNegative, integer, damping = 1 } = {}) {
  return path.map((v, idx) => {
    const h = idx + 1;
    // sum of squared cumulative damping factors, floored at h for the no-trend case
    let varMult = 0;
    for (let k = 0; k < h; k++) varMult += damping ** (2 * k);
    const sd = sigma * Math.sqrt(Math.max(h, varMult));
    const clamp = (x) => {
      const y = nonNegative ? Math.max(0, x) : x;
      return integer ? Math.round(y) : round2(y);
    };
    return {
      h,
      predicted: clamp(v),
      lower80: clamp(v - Z80 * sd),
      upper80: clamp(v + Z80 * sd),
      lower95: clamp(v - Z95 * sd),
      upper95: clamp(v + Z95 * sd),
    };
  });
}

/**
 * Walk-forward one-step accuracy over the final third of the series: fit on the head,
 * predict the next point, slide. This is the number the "held to account" tile shows.
 */
function backtest(y, fit, sigma) {
  const holdout = Math.min(Math.max(3, Math.round(y.length / 3)), Math.max(0, y.length - (fit.season ? fit.season * 2 + 1 : 3)));
  if (holdout < 2) return { mae: null, mape: null, coverage80Pct: null };
  const errs = [];
  const pcts = [];
  let covered = 0;
  for (let cut = y.length - holdout; cut < y.length; cut++) {
    const head = y.slice(0, cut);
    const f = holtWinters(head, fit);
    if (!f) continue;
    const step = project({ ...f, phi: fit.phi }, 1, fit.season)[0];
    const actual = y[cut];
    const e = actual - step;
    errs.push(Math.abs(e));
    if (actual !== 0) pcts.push(Math.abs(e / actual) * 100);
    if (Math.abs(e) <= Z80 * sigma) covered++;
  }
  if (!errs.length) return { mae: null, mape: null, coverage80Pct: null };
  return {
    mae: round2(mean(errs)),
    mape: pcts.length ? round2(mean(pcts)) : null,
    coverage80Pct: round2((covered / errs.length) * 100),
  };
}

const round2 = (v) => (finite(v) ? Math.round(v * 100) / 100 : null);

// ── Convenience wrappers the aggregates use ──────────────────────────────────

/**
 * Forecast a labelled series and hand back rows shaped like the actuals, so a chart can
 * concatenate them without special-casing.
 *
 * @param rows      [{ [labelKey]: 'YYYY-MM-DD', [valueKey]: 12 }, …] oldest first
 * @param nextLabel (previousLabel, stepsAhead) => string
 */
export function forecastLabelled(rows, { labelKey, valueKey, nextLabel, horizon, season, integer = true, nonNegative = true }) {
  const f = forecast(rows.map((r) => r[valueKey]), { horizon, season, integer, nonNegative });
  const lastLabel = rows.length ? rows[rows.length - 1][labelKey] : null;
  return {
    ...f,
    points: f.points.map((p) => ({
      ...p,
      [labelKey]: lastLabel != null ? nextLabel(lastLabel, p.h) : String(p.h),
    })),
  };
}

/** Next calendar day label, for daily series keyed 'YYYY-MM-DD'. */
export const nextDay = (label, h) => {
  const d = new Date(`${label}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + h);
  return d.toISOString().slice(0, 10);
};

/** Next month label, for monthly series keyed 'YYYY-MM'. */
export const nextMonth = (label, h) => {
  const d = new Date(`${label}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + h);
  return d.toISOString().slice(0, 7);
};

/**
 * A per-category projection for bar charts: each category's own recent trend, applied to
 * the next window of the same length. Cheap, stated plainly, and enough for the "what will
 * the call mix look like next month" question a bar chart is actually asked.
 *
 * @param rows [{ key, current, prior }] — same-length adjacent windows
 */
export function projectCategories(rows, { damping = 0.7 } = {}) {
  return rows.map((r) => {
    const cur = finite(r.current) ? r.current : 0;
    const prev = finite(r.prior) ? r.prior : null;
    if (prev == null || prev === 0) {
      return { key: r.key, predicted: Math.round(cur), changePct: null, method: 'held flat (no prior window)' };
    }
    const growth = cur / prev;
    const damped = 1 + (growth - 1) * damping;
    return {
      key: r.key,
      predicted: Math.max(0, Math.round(cur * damped)),
      changePct: round2((damped - 1) * 100),
      method: `window-over-window growth ${growth.toFixed(2)}, damped ${damping}`,
    };
  });
}
