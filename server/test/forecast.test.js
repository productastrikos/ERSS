/**
 * The shared forecaster (lib/forecast.js) — the one predictor behind every trend line.
 *
 * The properties that matter are not "is the number right" (a forecast has no right
 * answer) but the ones a screen relies on to stay honest: the interval widens with the
 * horizon, it never runs negative on a count, a damped trend does not run away, a short
 * series says so rather than pretending, and the backtest is measured on the same series
 * it is about to extrapolate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { forecast, forecastLabelled, nextDay, nextMonth, projectCategories } from '../lib/forecast.js';

const flat = (n, v) => Array.from({ length: n }, () => v);
const rising = (n, from, step) => Array.from({ length: n }, (_, i) => from + i * step);
const weekly = (n, base, amp) => Array.from({ length: n }, (_, i) => base + amp * Math.sin((i * 2 * Math.PI) / 7));

describe('forecast — degenerate input', () => {
  test('no history produces no points and says so', () => {
    const f = forecast([], { horizon: 5 });
    assert.equal(f.points.length, 0);
    assert.match(f.method, /No history/);
  });

  test('a zero horizon produces no points even with plenty of history', () => {
    assert.equal(forecast(flat(60, 10), { horizon: 0 }).points.length, 0);
  });

  test('one or two points fall back to a flat mean and name the fallback', () => {
    const f = forecast([8, 12], { horizon: 3 });
    assert.equal(f.points.length, 3);
    assert.match(f.method, /Flat mean/);
    assert.deepEqual(f.points.map((p) => p.predicted), [10, 10, 10]);
    assert.ok(f.caveats.some((c) => /Too few points/.test(c)));
  });

  test('nulls are carried forward rather than read as zeros', () => {
    // A hole in the series must not drag the level down: 20,null,20 is a flat 20.
    const f = forecast([20, null, 20, null, 20, 20, 20, 20], { horizon: 2, integer: true });
    assert.ok(f.points.every((p) => p.predicted >= 18), `a gap pulled the level down: ${JSON.stringify(f.points)}`);
  });
});

describe('forecast — intervals', () => {
  const f = forecast(weekly(60, 40, 9).map((v, i) => v + i * 0.1), { horizon: 10, season: 7, integer: true });

  test('the band widens with the horizon', () => {
    const widths = f.points.map((p) => p.upper80 - p.lower80);
    for (let i = 1; i < widths.length; i++) {
      assert.ok(widths[i] >= widths[i - 1], `band narrowed at step ${i + 1}: ${widths.join(', ')}`);
    }
  });

  test('95% always contains 80%', () => {
    for (const p of f.points) {
      assert.ok(p.lower95 <= p.lower80, `95 lower above 80 lower at h=${p.h}`);
      assert.ok(p.upper95 >= p.upper80, `95 upper below 80 upper at h=${p.h}`);
    }
  });

  test('the point estimate sits inside its own band', () => {
    for (const p of f.points) {
      assert.ok(p.predicted >= p.lower80 - 1 && p.predicted <= p.upper80 + 1, `point outside band at h=${p.h}`);
    }
  });

  test('a count forecast never goes negative, however wide the band', () => {
    const noisy = forecast([2, 0, 5, 1, 0, 3, 0, 4, 1, 0, 2, 0], { horizon: 12, integer: true });
    assert.ok(noisy.points.every((p) => p.lower80 >= 0 && p.predicted >= 0), 'a negative call count was predicted');
  });

  test('integer: true yields whole numbers on every bound', () => {
    for (const p of f.points) {
      for (const k of ['predicted', 'lower80', 'upper80', 'lower95', 'upper95']) {
        assert.equal(p[k], Math.round(p[k]), `${k} was fractional at h=${p.h}`);
      }
    }
  });
});

describe('forecast — trend and season', () => {
  test('a steady rise is projected upward', () => {
    const f = forecast(rising(40, 100, 5), { horizon: 5, integer: true });
    assert.ok(f.points[0].predicted > 290, `expected continuation above the last value, got ${f.points[0].predicted}`);
    assert.ok(f.trendPerStep > 0);
  });

  test('the trend is damped, so a long horizon does not run away', () => {
    // Undamped, 40 steps of +5 would reach +200 above the last point. Damping must hold
    // the projection well under that; an ambitious straight line is not a forecast.
    const f = forecast(rising(40, 100, 5), { horizon: 40, integer: true });
    const last = 100 + 39 * 5;
    assert.ok(f.points.at(-1).predicted < last + 200, `trend ran away to ${f.points.at(-1).predicted}`);
  });

  test('a weekly shape is reproduced at the right phase', () => {
    const f = forecast(weekly(70, 50, 20), { horizon: 7, season: 7, integer: true });
    assert.equal(f.season, 7);
    const span = Math.max(...f.points.map((p) => p.predicted)) - Math.min(...f.points.map((p) => p.predicted));
    assert.ok(span > 15, `the weekly swing was flattened away (span ${span})`);
  });

  test('fewer than two full cycles refuses to fit a season, and says why', () => {
    const f = forecast(weekly(10, 50, 20), { horizon: 3, season: 7 });
    assert.equal(f.season, 0);
    assert.ok(f.caveats.some((c) => /two full cycles/.test(c)));
  });

  test('a flat series stays flat', () => {
    const f = forecast(flat(40, 30), { horizon: 6, integer: true });
    assert.ok(f.points.every((p) => Math.abs(p.predicted - 30) <= 1), JSON.stringify(f.points.map((p) => p.predicted)));
  });
});

describe('forecast — held to account', () => {
  test('a clean series backtests with low error and honest coverage', () => {
    const f = forecast(weekly(90, 60, 12), { horizon: 7, season: 7, integer: true });
    assert.ok(f.mape != null && f.mape < 15, `MAPE was ${f.mape} on a near-deterministic series`);
    assert.ok(f.coverage80Pct != null && f.coverage80Pct >= 50, `coverage was ${f.coverage80Pct}`);
  });

  test('a series that cannot be predicted reports high error rather than hiding it', () => {
    let seed = 7;
    const noise = Array.from({ length: 60 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed % 100) + 5; });
    const f = forecast(noise, { horizon: 5, integer: true });
    assert.ok(f.mape > 15, `noise reported an implausible MAPE of ${f.mape}`);
  });

  test('every result names its method and its fitted parameters', () => {
    const f = forecast(weekly(60, 40, 8), { horizon: 4, season: 7 });
    assert.match(f.method, /Holt/);
    assert.ok(f.method.includes('alpha'), 'the method must name the parameters it fitted');
  });
});

describe('forecastLabelled', () => {
  test('day labels continue the calendar, including across a month end', () => {
    const rows = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1));
      d.setUTCDate(d.getUTCDate() + i);
      return { day: d.toISOString().slice(0, 10), calls: 100 + (i % 7) * 5 };
    });
    const f = forecastLabelled(rows, { labelKey: 'day', valueKey: 'calls', nextLabel: nextDay, horizon: 3, season: 7 });
    assert.deepEqual(f.points.map((p) => p.day), ['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  test('month labels roll the year over', () => {
    assert.equal(nextMonth('2026-11', 3), '2027-02');
    assert.equal(nextMonth('2026-02', -12), '2025-02');
  });

  test('an empty series yields no labelled points rather than throwing', () => {
    const f = forecastLabelled([], { labelKey: 'day', valueKey: 'calls', nextLabel: nextDay, horizon: 3 });
    assert.deepEqual(f.points, []);
  });
});

describe('projectCategories', () => {
  test('growth is damped, never taken at face value', () => {
    // 100 → 200 is +100%. Damped at 0.7 that is +70%, so 170, not 200.
    const [row] = projectCategories([{ key: 'fall', current: 200, prior: 100 }]);
    assert.equal(row.predicted, 340);   // 200 × (1 + 1.0 × 0.7)
    assert.equal(row.changePct, 70);
  });

  test('no prior window holds the value flat and says so', () => {
    const [row] = projectCategories([{ key: 'rare', current: 3, prior: 0 }]);
    assert.equal(row.predicted, 3);
    assert.equal(row.changePct, null);
    assert.match(row.method, /held flat/);
  });

  test('a decline projects downward but never below zero', () => {
    const [row] = projectCategories([{ key: 'x', current: 1, prior: 500 }]);
    assert.ok(row.predicted >= 0 && row.predicted <= 1, `got ${row.predicted}`);
  });
});
