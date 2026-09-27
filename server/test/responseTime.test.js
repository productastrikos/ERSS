/**
 * responseTime golden fixtures. docs/08 §2.1.
 *
 * No database: the engine is a pure function over rows shaped like
 * repos/analytics.js#stageRows would return them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decomposeStages, mannWhitneyU, STAGES } from '../engines/responseTime.js';
import { isInsufficient } from '../lib/result.js';

const WINDOW = { from: '2026-08-17T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' };

/** A row with all five stages plus a consistent responseSec. */
function row({ callHandling = 20, dispatch = 15, acknowledge = 20, turnout = 40, travel = 240 }) {
  return {
    callHandlingSec: callHandling, dispatchSec: dispatch, acknowledgeSec: acknowledge,
    turnoutSec: turnout, travelSec: travel,
    responseSec: callHandling + dispatch + acknowledge + turnout + travel,
  };
}

/** n rows spread evenly around a centre so p50/mean are hand-checkable. */
function spread(n, centre, step, overrides = {}) {
  return Array.from({ length: n }, (_, i) => row({ travel: centre + (i - (n - 1) / 2) * step, ...overrides }));
}

describe('responseTime — mannWhitneyU', () => {
  test('identical distributions are not significant', () => {
    const a = [10, 20, 30, 40, 50];
    const b = [10, 20, 30, 40, 50];
    const r = mannWhitneyU(a, b);
    assert.equal(r.z, 0);
    assert.equal(r.p, 1);
  });

  test('a clearly shifted distribution is significant', () => {
    const a = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
    const b = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const r = mannWhitneyU(a, b);
    assert.ok(r.p < 0.05, `expected p<0.05, got ${r.p}`);
    assert.ok(r.z > 0, 'a is stochastically larger than b');
  });

  test('empty groups return null rather than NaN', () => {
    assert.equal(mannWhitneyU([], [1, 2, 3]), null);
    assert.equal(mannWhitneyU([1, 2, 3], []), null);
  });
});

describe('responseTime — decomposeStages', () => {
  test('too few rows returns the insufficient-data sentinel', () => {
    const r = decomposeStages([row({}), row({})], null, WINDOW);
    assert.ok(isInsufficient(r));
    assert.equal(r.value, null);
    assert.equal(r.confidence, null);
  });

  test('stage p50s are exact on a hand-checkable fixture', () => {
    // 21 identical rows: every quantile is the same value, trivially checkable.
    const rows = Array.from({ length: 21 }, () => row({}));
    const r = decomposeStages(rows, null, WINDOW);
    assert.equal(r.value.stages.callHandling.p50, 20);
    assert.equal(r.value.stages.dispatch.p50, 15);
    assert.equal(r.value.stages.acknowledge.p50, 20);
    assert.equal(r.value.stages.turnout.p50, 40);
    assert.equal(r.value.stages.travel.p50, 240);
    assert.equal(r.value.response.p50, 20 + 15 + 20 + 40 + 240);
    assert.equal(r.value.stages.travel.n, 21);
  });

  test('contribution shares sum to 1 and travel dominates a travel-heavy population', () => {
    const rows = Array.from({ length: 30 }, () => row({}));
    const r = decomposeStages(rows, null, WINDOW);
    const total = r.factors.reduce((s, f) => s + f.contribution, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `contributions should sum to ~1, got ${total}`);
    const travelFactor = r.factors.find((f) => f.name === 'En-route travel');
    // 240 of a 335 s decomposed total ≈ 0.716 — the whole point of the contribution share.
    assert.ok(travelFactor.contribution > 0.7, `expected travel to dominate, got ${travelFactor.contribution}`);
  });

  test('factors are returned in stage order, not sorted by size', () => {
    const rows = Array.from({ length: 10 }, () => row({}));
    const r = decomposeStages(rows, null, WINDOW);
    assert.deepEqual(r.factors.map((f) => f.name), STAGES.map((s) => ({
      callHandling: 'Call handling', dispatch: 'Dispatch decision', acknowledge: 'Acknowledge',
      turnout: 'Turnout', travel: 'En-route travel',
    })[s]));
  });

  test('a stage that is genuinely slower than baseline is named as the biggest contributor', () => {
    const rows = spread(40, 400, 4);        // this zone: travel centred on 400 s
    const baseline = spread(200, 240, 1);   // emirate: travel centred on 240 s
    const r = decomposeStages(rows, baseline, WINDOW);
    assert.ok(r.value.biggestContributors.length > 0);
    const top = r.value.biggestContributors[0];
    assert.equal(top.stage, 'travel');
    assert.ok(top.excessSec > 100, `expected a large excess, got ${top.excessSec}`);
    assert.ok(top.p < 0.05);
  });

  test('a stage indistinguishable from baseline is not flagged', () => {
    const rows = spread(40, 240, 4);
    const baseline = spread(200, 240, 1);
    const r = decomposeStages(rows, baseline, WINDOW);
    assert.equal(r.value.biggestContributors.find((c) => c.stage === 'travel'), undefined);
  });

  test('ranking is by absolute seconds of excess, not ratio — the doc\'s own example', () => {
    // acknowledge: 4 s baseline -> 16 s filtered = 300% excess but only 12 s.
    // travel: 240 s baseline -> 276 s filtered = 15% excess but 36 s — the real problem.
    const rows = Array.from({ length: 40 }, () => row({ acknowledge: 16, travel: 276 }));
    const baseline = Array.from({ length: 200 }, () => row({ acknowledge: 4, travel: 240 }));
    const r = decomposeStages(rows, baseline, WINDOW);
    const [first] = r.value.biggestContributors;
    assert.equal(first.stage, 'travel', `expected travel to rank first by absolute seconds, got ${first?.stage}`);
  });

  test('no baseline supplied skips the comparison and says so', () => {
    const rows = Array.from({ length: 10 }, () => row({}));
    const r = decomposeStages(rows, [], WINDOW);
    assert.deepEqual(r.value.biggestContributors, []);
    assert.ok(r.caveats.some((c) => c.includes('no baseline population')));
  });

  test('a small sample is flagged and confidence is honestly modest', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ travel: 200 + i * 30 }));
    const r = decomposeStages(rows, null, WINDOW);
    assert.ok(r.caveats.some((c) => c.includes('sample below 30')));
    assert.ok(r.confidence < 0.9, `small, spread sample should not be highly confident: ${r.confidence}`);
  });

  test('a missing stage on every row is simply absent, not zero', () => {
    const rows = Array.from({ length: 10 }, () => ({ ...row({}), dispatchSec: null }));
    const r = decomposeStages(rows, null, WINDOW);
    assert.equal(r.value.stages.dispatch, undefined);
    assert.equal(r.factors.find((f) => f.name === 'Dispatch decision'), undefined);
  });

  test('determinism — same input twice gives identical numeric output', () => {
    const rows = spread(40, 400, 4);
    const baseline = spread(200, 240, 4);
    const a = decomposeStages(rows, baseline, WINDOW);
    const b = decomposeStages(rows, baseline, WINDOW);
    assert.deepEqual(a.value, b.value);
    assert.deepEqual(a.factors, b.factors);
    assert.equal(a.confidence, b.confidence);
  });

  test('envelope conformance', () => {
    const rows = Array.from({ length: 10 }, () => row({}));
    const r = decomposeStages(rows, null, WINDOW);
    assert.equal(r.method, 'stage-order-stats-v1');
    assert.deepEqual(r.window, WINDOW);
    assert.ok(Array.isArray(r.inputs) && r.inputs.length > 0);
    assert.ok(Array.isArray(r.factors) && r.factors.length > 0);
    assert.ok(typeof r.computedAt === 'string');
  });
});
