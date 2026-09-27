/**
 * demand golden fixtures. docs/08 §3.1.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ewmaBaseRate, poissonQuantile, forecastDemand, forecastAccuracy } from '../engines/demand.js';
import { isInsufficient } from '../lib/result.js';

const WINDOW = { from: '2026-09-10T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' };
const flat = (n, count) => Array.from({ length: n }, (_, i) => ({ weeksAgo: i, count }));

describe('demand — ewmaBaseRate', () => {
  test('a flat history returns exactly that count', () => {
    assert.equal(ewmaBaseRate(flat(12, 4)), 4);
  });

  test('recent weeks are weighted more than old ones', () => {
    // Week 0 (this week) is high, older weeks are low — EWMA should sit closer to the recent value.
    const rows = [{ weeksAgo: 0, count: 10 }, { weeksAgo: 1, count: 10 }, { weeksAgo: 20, count: 0 }, { weeksAgo: 21, count: 0 }];
    const r = ewmaBaseRate(rows);
    assert.ok(r > 5, `expected the recent high weeks to dominate, got ${r}`);
  });

  test('empty history returns null, not zero', () => {
    assert.equal(ewmaBaseRate([]), null);
  });

  test('halving the half-life pulls the weight toward recency faster', () => {
    const rows = [{ weeksAgo: 0, count: 10 }, { weeksAgo: 12, count: 0 }];
    const slow = ewmaBaseRate(rows, 12);
    const fast = ewmaBaseRate(rows, 6);
    assert.ok(fast > slow, `a shorter half-life should weight week 0 more: fast=${fast} slow=${slow}`);
  });
});

describe('demand — poissonQuantile', () => {
  test('lambda=0 has zero at every quantile', () => {
    assert.equal(poissonQuantile(0, 0.5), 0);
    assert.equal(poissonQuantile(0, 0.9), 0);
  });

  test('quantiles are monotonic in p', () => {
    const lo = poissonQuantile(8, 0.1);
    const mid = poissonQuantile(8, 0.5);
    const hi = poissonQuantile(8, 0.9);
    assert.ok(lo <= mid && mid <= hi, `expected lo<=mid<=hi, got ${lo},${mid},${hi}`);
  });

  test('matches known Poisson(4) quantiles', () => {
    // P(X<=1)=0.0916, P(X<=2)=0.2381, P(X<=6)=0.8893, P(X<=7)=0.9489 for lambda=4.
    assert.equal(poissonQuantile(4, 0.1), 2);
    assert.equal(poissonQuantile(4, 0.9), 7);
  });

  test('a larger lambda widens the raw interval', () => {
    const narrow = poissonQuantile(2, 0.9) - poissonQuantile(2, 0.1);
    const wide = poissonQuantile(50, 0.9) - poissonQuantile(50, 0.1);
    assert.ok(wide > narrow);
  });
});

describe('demand — forecastDemand', () => {
  test('too little history returns the insufficient-data sentinel', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(2, 3) }, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('a flat, uncovaried history forecasts the flat rate with no adjustment factors', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 5) }, WINDOW);
    assert.equal(r.value.lambda, 5);
    assert.equal(r.factors.length, 1);
    assert.equal(r.factors[0].name, 'Historical base rate');
    assert.ok(r.value.lower80 <= 5 && 5 <= r.value.upper80);
  });

  test('a covariate multiplier scales lambda and is named as its own factor', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 10), covariates: { weather: 1.5 } }, WINDOW);
    assert.equal(r.value.lambda, 15);
    const weather = r.factors.find((f) => f.name === 'Weather');
    assert.ok(weather);
    assert.equal(weather.direction, 'up');
  });

  test('multiple covariates compound multiplicatively', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 10), covariates: { weather: 1.2, event: 1.5 } }, WINDOW);
    assert.equal(r.value.lambda, +(10 * 1.2 * 1.5).toFixed(2));
  });

  test('a downward covariate is directionally reported', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 3, weeklyCounts: flat(16, 10), covariates: { dayType: 0.7 } }, WINDOW);
    assert.equal(r.value.lambda, 7);
    const f = r.factors.find((x) => x.name === 'Day type');
    assert.equal(f.direction, 'down');
  });

  test('no trailing accuracy means confidence is null, not invented', () => {
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 5) }, WINDOW);
    assert.equal(r.confidence, null);
    assert.ok(r.caveats.some((c) => c.includes('confidence unavailable')));
  });

  test('sufficient trailing accuracy sets confidence from measured interval coverage', () => {
    const trailing = Array.from({ length: 30 }, (_, i) => ({ predicted: 5, actual: 5, lower: 2, upper: 8 }));
    const r = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 5), trailingAccuracy: trailing }, WINDOW);
    assert.equal(r.confidence, 1);
    assert.equal(r.value.accuracy.intervalCoveragePct, 100);
  });

  test('determinism', () => {
    const a = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 7), covariates: { weather: 1.3 } }, WINDOW);
    const b = forecastDemand({ zoneId: 'z1', hourOfWeek: 10, weeklyCounts: flat(16, 7), covariates: { weather: 1.3 } }, WINDOW);
    assert.deepEqual(a.value, b.value);
  });

  test('envelope conformance', () => {
    const r = forecastDemand({ zoneId: 'z1', zoneRef: 'Z-C0101', hourOfWeek: 10, weeklyCounts: flat(16, 5) }, WINDOW);
    assert.equal(r.method, 'seasonal-poisson-ewma-v1');
    assert.deepEqual(r.window, WINDOW);
    assert.ok(r.factors.length > 0);
    assert.ok(r.inputs.length > 0);
  });
});

describe('demand — forecastAccuracy', () => {
  test('perfect predictions give zero MAE, zero bias, full coverage', () => {
    const rows = [{ predicted: 5, actual: 5, lower: 2, upper: 8 }, { predicted: 3, actual: 3, lower: 1, upper: 6 }];
    const a = forecastAccuracy(rows);
    assert.equal(a.mae, 0);
    assert.equal(a.bias, 0);
    assert.equal(a.intervalCoveragePct, 100);
  });

  test('systematic over-prediction shows up as positive bias', () => {
    const rows = [{ predicted: 8, actual: 5, lower: 2, upper: 10 }, { predicted: 6, actual: 3, lower: 1, upper: 8 }];
    const a = forecastAccuracy(rows);
    assert.ok(a.bias > 0, `expected positive bias for over-prediction, got ${a.bias}`);
  });

  test('an actual outside the interval reduces coverage', () => {
    const rows = [{ predicted: 5, actual: 20, lower: 2, upper: 8 }, { predicted: 5, actual: 5, lower: 2, upper: 8 }];
    const a = forecastAccuracy(rows);
    assert.equal(a.intervalCoveragePct, 50);
  });

  test('no usable rows returns null rather than dividing by zero', () => {
    assert.equal(forecastAccuracy([]), null);
    assert.equal(forecastAccuracy([{ predicted: null, actual: 5 }]), null);
  });
});
