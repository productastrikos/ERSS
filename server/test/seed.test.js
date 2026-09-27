/**
 * Seed logic tests. No database required — these exercise the pure functions the
 * generated history depends on.
 *
 * Determinism is the one that matters most: without it a demo rehearsed on Tuesday
 * shows different numbers on Wednesday, seed:verify cannot assert anything, and no bug
 * in the generator is ever reproducible.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../db/seed/rng.js';
import { haversineM, offset, makaniFor, formatMakani, blobPolygon, randomInCircle } from '../db/seed/geo.js';
import { jurisdiction, agency } from '../config/jurisdiction.js';
import { engineResult, insufficientData, isInsufficient, confidenceFromSample, normaliseFactors } from '../lib/result.js';

describe('rng — determinism', () => {
  test('the same seed produces the same stream', () => {
    const a = createRng('erss-test');
    const b = createRng('erss-test');
    for (let i = 0; i < 200; i++) assert.equal(a.next(), b.next());
  });

  test('different seeds diverge', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-b');
    const sameCount = Array.from({ length: 100 }, () => a.next() === b.next()).filter(Boolean).length;
    assert.equal(sameCount, 0);
  });

  test('fork produces an independent but deterministic stream', () => {
    const parent1 = createRng('root');
    const parent2 = createRng('root');
    assert.equal(parent1.fork('x').next(), parent2.fork('x').next());
    assert.notEqual(parent1.fork('x').next(), parent1.fork('y').next());
  });

  test('int is inclusive at both ends', () => {
    const rng = createRng('ints');
    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(rng.int(1, 5));
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
  });

  test('weighted respects the weights', () => {
    const rng = createRng('weights');
    const items = [{ k: 'a', weight: 90 }, { k: 'b', weight: 10 }];
    let a = 0;
    for (let i = 0; i < 5000; i++) if (rng.weighted(items).k === 'a') a++;
    assert.ok(a / 5000 > 0.85 && a / 5000 < 0.95, `expected ~0.90, got ${a / 5000}`);
  });

  test('poisson mean converges on lambda', () => {
    const rng = createRng('poisson');
    for (const lambda of [0.5, 3, 12, 45]) {
      const n = 6000;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += rng.poisson(lambda);
      const mean = sum / n;
      assert.ok(Math.abs(mean - lambda) < lambda * 0.12 + 0.15,
        `lambda=${lambda} produced mean ${mean.toFixed(2)}`);
    }
  });

  test('logNormal is right-skewed: mean exceeds median', () => {
    // This is the whole reason response times use it. Dubai publishes a 6.59 min mean
    // against a ~9.0 min critical-call median — a shape a normal distribution cannot
    // produce.
    const rng = createRng('lognormal');
    const median = 300;
    const samples = Array.from({ length: 20000 }, () => rng.logNormal(median, 0.55));
    samples.sort((a, b) => a - b);
    const observedMedian = samples[Math.floor(samples.length / 2)];
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;

    assert.ok(Math.abs(observedMedian - median) < median * 0.05,
      `median drifted to ${observedMedian.toFixed(0)}`);
    assert.ok(mean > observedMedian, 'log-normal mean must exceed its median');
    assert.ok(samples.every((v) => v > 0), 'no negative durations');
  });
});

describe('geo', () => {
  test('haversine matches a known Dubai distance', () => {
    // Burj Khalifa → Dubai Marina, ~20 km.
    const d = haversineM({ lng: 55.2744, lat: 25.1972 }, { lng: 55.1390, lat: 25.0800 });
    assert.ok(d > 18_000 && d < 22_000, `got ${Math.round(d)} m`);
  });

  test('offset moves the requested distance', () => {
    const origin = { lng: 55.2708, lat: 25.2048 };
    for (const bearing of [0, 90, 180, 270]) {
      const moved = offset(origin, 1000, bearing);
      const back = haversineM(origin, moved);
      assert.ok(Math.abs(back - 1000) < 15, `bearing ${bearing} gave ${Math.round(back)} m`);
    }
  });

  test('makani is 10 digits and spatially stable', () => {
    const code = makaniFor(55.2744, 25.1972);
    assert.match(code, /^\d{10}$/);
    assert.equal(makaniFor(55.2744, 25.1972), code, 'same point, same code');
    assert.equal(formatMakani(code).length, 11, 'displayed as two groups of five');
  });

  test('nearby points get nearby makani codes', () => {
    // The real code projects the DLTM grid, so proximity is preserved. Ours reproduces
    // that structural property.
    const a = makaniFor(55.2744, 25.1972);
    const b = makaniFor(55.2745, 25.1973);
    const far = makaniFor(55.4000, 25.3000);
    const diffNear = Math.abs(Number(a.slice(0, 5)) - Number(b.slice(0, 5)));
    const diffFar = Math.abs(Number(a.slice(0, 5)) - Number(far.slice(0, 5)));
    assert.ok(diffNear < diffFar, 'adjacent points must be closer in code space');
  });

  test('blobPolygon is closed and roughly the requested size', () => {
    const rng = createRng('blob');
    const centre = { lng: 55.2708, lat: 25.2048 };
    const ring = blobPolygon(centre, 1000, rng, { points: 14 });

    assert.deepEqual(ring[0], ring.at(-1), 'ring must close');
    assert.equal(ring.length, 15);

    const radii = ring.slice(0, -1).map(([lng, lat]) => haversineM(centre, { lng, lat }));
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    assert.ok(mean > 850 && mean < 1200, `mean radius ${Math.round(mean)} m`);
  });

  test('randomInCircle stays inside the circle', () => {
    const rng = createRng('circle');
    const centre = { lng: 55.2708, lat: 25.2048 };
    for (let i = 0; i < 500; i++) {
      const p = randomInCircle(centre, 2000, rng);
      assert.ok(haversineM(centre, p) <= 2050);
    }
  });
});

describe('jurisdiction pack', () => {
  test('the nine sectors and four emergency numbers are present', () => {
    assert.equal(jurisdiction.hierarchy.sectorCount, 9);
    const numbers = jurisdiction.agencies.map((a) => a.emergencyNo).filter(Boolean).sort();
    assert.deepEqual(numbers, ['996', '997', '998', '999']);
  });

  test('the published history series ends at the 2024 actual', () => {
    // The figures misread as 2024–2026 projections are in fact 2017, 2018 and 2020.
    const last = jurisdiction.history.at(-1);
    assert.equal(last.year, 2024);
    assert.equal(last.calls, 198_540);
    assert.equal(last.meanResponseMin, 6.59);

    const covid = jurisdiction.history.find((h) => h.year === 2020);
    assert.equal(covid.meanResponseMin, 10.28, 'the 10.28 figure belongs to 2020');
    assert.equal(covid.note, 'COVID-19');
  });

  test('VRT is modelled in minutes, not seconds', () => {
    // The first draft of the plan modelled 45 s + 8 s/floor — an order of magnitude too
    // small against the researched 4–8 minute penalty.
    const v = jurisdiction.vrt;
    const floor75 = v.lobbyAccessSec[0] + v.securityClearanceSec[0] + v.liftWaitSec[0]
      + 75 * v.ascentSecPerFloor + v.corridorFindSec[0];
    assert.ok(floor75 >= 240, `floor 75 minimum VRT was ${floor75}s — expected ≥ 240s`);
  });

  test('EVP is not claimed as deployed', () => {
    assert.equal(jurisdiction.traffic.evpDeployed, false,
      'no public evidence exists that Dubai has emergency vehicle preemption');
    assert.equal(jurisdiction.traffic.signalisedIntersections, 620);
  });

  test('agency() throws on an unknown code rather than returning undefined', () => {
    assert.equal(agency('DCAS').emergencyNo, '998');
    assert.throws(() => agency('NOPE'), /Unknown agency/);
  });
});

describe('engine result envelope', () => {
  test('a valid result round-trips', () => {
    const r = engineResult({
      value: 395, unit: 'seconds', confidence: 0.82,
      window: { from: '2026-01-01T00:00:00Z', to: '2026-09-16T00:00:00Z' },
      inputs: [{ source: 'v_incident_response', rows: 1200 }],
      factors: [{ name: 'travel', contribution: 0.6, direction: 'up' }],
      method: 'response-p50-v1',
    });
    assert.equal(r.value, 395);
    assert.equal(r.method, 'response-p50-v1');
    assert.ok(r.computedAt);
  });

  test('an unversioned method is rejected', () => {
    assert.throws(() => engineResult({
      value: 1, confidence: 0.5, window: { from: 'a', to: 'b' },
      inputs: [{ source: 's', rows: 1 }],
    }), /method is required/);
  });

  test('a result with no named input is rejected', () => {
    // An engine that cannot say where its number came from cannot be displayed.
    assert.throws(() => engineResult({
      value: 1, confidence: 0.5, window: { from: 'a', to: 'b' },
      inputs: [], method: 'x-v1',
    }), /inputs must name at least one source/);
  });

  test('confidence outside 0..1 is rejected, but null is allowed', () => {
    const base = {
      value: 1, window: { from: 'a', to: 'b' },
      inputs: [{ source: 's', rows: 1 }], method: 'x-v1',
    };
    assert.throws(() => engineResult({ ...base, confidence: 1.4 }), /confidence must be/);
    assert.doesNotThrow(() => engineResult({ ...base, confidence: null }));
  });

  test('insufficientData is distinguishable from a real zero', () => {
    const r = insufficientData({ method: 'x-v1', window: { from: 'a', to: 'b' }, minimum: 30, actual: 4 });
    assert.equal(r.value, null);
    assert.equal(r.confidence, null);
    assert.ok(isInsufficient(r));
    assert.ok(!isInsufficient(engineResult({
      value: 0, confidence: 0.9, window: { from: 'a', to: 'b' },
      inputs: [{ source: 's', rows: 100 }], method: 'x-v1',
    })), '"no incidents" and "no data" must not be the same thing');
  });

  test('confidenceFromSample saturates and never exceeds 1', () => {
    assert.equal(confidenceFromSample(0), null);
    const c30 = confidenceFromSample(30);
    const c500 = confidenceFromSample(500);
    assert.ok(c30 < c500 && c500 < 0.99);
  });

  test('normaliseFactors sums to 1 and sorts by magnitude', () => {
    const f = normaliseFactors([
      { name: 'small', contribution: 1 },
      { name: 'large', contribution: 8 },
      { name: 'mid', contribution: 3 },
    ]);
    assert.equal(f[0].name, 'large');
    const total = f.reduce((s, x) => s + Math.abs(x.contribution), 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });
});
