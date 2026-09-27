/**
 * ranking golden fixtures. docs/08 §2.3, docs/06 §5.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rankZones, reBaselineZone, normaliseWeights, DEFAULT_WEIGHTS } from '../engines/ranking.js';

const WINDOW = { from: '2026-08-17T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' };

function zone(id, componentOverrides = {}, topOverrides = {}) {
  return {
    zoneId: id, zoneRef: id, zoneName: id, level: 'community', class: 'urban', sampleN: 100,
    components: {
      avgResponseSec: 400, withinTargetPct: 80, unitAvailabilityPct: 70,
      eventClosurePct: 90, avgAcknowledgeSec: 25, preemptEventRate: 0.5,
      ...componentOverrides,
    },
    ...topOverrides,
  };
}

describe('ranking — normaliseWeights', () => {
  test('normalises an arbitrary set to sum to 1', () => {
    const w = normaliseWeights({ avgResponseSec: 2, withinTargetPct: 2 });
    assert.ok(Math.abs(Object.values(w).reduce((s, v) => s + v, 0) - 1) < 1e-9);
    assert.equal(w.avgResponseSec, 0.5);
  });

  test('unknown keys are dropped', () => {
    const w = normaliseWeights({ avgResponseSec: 1, madeUpComponent: 99 });
    assert.equal(w.madeUpComponent, undefined);
  });

  test('an all-zero input falls back to the published defaults', () => {
    const w = normaliseWeights({ avgResponseSec: 0 });
    assert.deepEqual(w, DEFAULT_WEIGHTS);
  });
});

describe('ranking — rankZones', () => {
  test('the best zone on every component ranks first in its peer group', () => {
    const zones = [
      zone('best', { avgResponseSec: 200, withinTargetPct: 95, unitAvailabilityPct: 90, eventClosurePct: 98, avgAcknowledgeSec: 10, preemptEventRate: 0.9 }),
      zone('mid'),
      zone('worst', { avgResponseSec: 800, withinTargetPct: 40, unitAvailabilityPct: 30, eventClosurePct: 50, avgAcknowledgeSec: 60, preemptEventRate: 0.1 }),
    ];
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const byId = Object.fromEntries(r.value.zones.map((z) => [z.zoneId, z]));
    assert.equal(byId.best.rank, 1);
    assert.equal(byId.worst.rank, 3);
    assert.equal(byId.best.composite > byId.mid.composite, true);
    assert.equal(byId.mid.composite > byId.worst.composite, true);
  });

  test('lower-is-better components are direction-corrected: the FASTEST response wins, not the largest number', () => {
    const zones = [
      zone('fast', { avgResponseSec: 200 }),
      zone('slow', { avgResponseSec: 900 }),
    ];
    const r = rankZones(zones, { avgResponseSec: 1 }, WINDOW);
    const byId = Object.fromEntries(r.value.zones.map((z) => [z.zoneId, z]));
    assert.equal(byId.fast.rank, 1);
    assert.equal(byId.fast.composite, 100);
    assert.equal(byId.slow.composite, 0);
  });

  test('a zone below the sample floor is insufficient data, not ranked', () => {
    const zones = [zone('a'), zone('b'), zone('thin', { }), ];
    zones[2].sampleN = 5;
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const thin = r.value.zones.find((z) => z.zoneId === 'thin');
    assert.equal(thin.insufficientData, true);
    assert.equal(thin.rank, null);
    assert.ok(r.caveats.some((c) => c.includes('below the 30-incident sample floor')));
  });

  test('peer groups do not cross level or class — a desert zone is never ranked against an urban one', () => {
    const zones = [
      zone('urban-1', { avgResponseSec: 300 }),
      zone('urban-2', { avgResponseSec: 500 }),
      zone('desert-1', { avgResponseSec: 300 }, { class: 'desert' }),
    ];
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const desert = r.value.zones.find((z) => z.zoneId === 'desert-1');
    assert.equal(desert.rank, 1);
    assert.equal(desert.peerGroupSize, 1);
    // Singleton peer group: no differentiation possible, neutral score.
    assert.equal(desert.composite, 50);
  });

  test('a component every zone in the group ties on does not fabricate a winner', () => {
    const zones = [zone('a'), zone('b')];   // identical on every component
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const [a, b] = r.value.zones;
    assert.equal(a.composite, b.composite);
    assert.equal(a.composite, 50);
  });

  test('a zone missing a component is scored on the rest, not penalised to zero', () => {
    const zones = [
      zone('complete'),
      zone('missing', { preemptEventRate: null }),
    ];
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const missing = r.value.zones.find((z) => z.zoneId === 'missing');
    assert.deepEqual(missing.missingComponents, ['preemptEventRate']);
    // Identical on everything else, so still ties with 'complete' once renormalised.
    const complete = r.value.zones.find((z) => z.zoneId === 'complete');
    assert.equal(missing.composite, complete.composite);
  });

  test('rank delta reflects movement against the supplied previous rank', () => {
    const zones = [
      { ...zone('a'), prevRank: 3 },
      { ...zone('b', { avgResponseSec: 900 }), prevRank: 1 },
    ];
    const r = rankZones(zones, { avgResponseSec: 1 }, WINDOW);
    const a = r.value.zones.find((z) => z.zoneId === 'a');
    assert.equal(a.rank, 1);
    assert.equal(a.rankDelta, 2);   // moved from 3rd to 1st
  });

  test('envelope conformance', () => {
    const r = rankZones([zone('a'), zone('b')], DEFAULT_WEIGHTS, WINDOW);
    assert.equal(r.method, 'weighted-minmax-v1');
    assert.deepEqual(r.window, WINDOW);
    assert.ok(r.factors.length === Object.keys(DEFAULT_WEIGHTS).length);
  });

  test('determinism', () => {
    const zones = [zone('a', { avgResponseSec: 300 }), zone('b', { avgResponseSec: 500 }), zone('c', { avgResponseSec: 700 })];
    const r1 = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    const r2 = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    assert.deepEqual(r1.value, r2.value);
  });
});

describe('ranking — reBaselineZone', () => {
  test('adding availability improves the composite and reports the delta', () => {
    const zones = [
      zone('a', { unitAvailabilityPct: 50 }),
      zone('b', { unitAvailabilityPct: 90 }),
    ];
    const r = rankZones(zones, { unitAvailabilityPct: 1 }, WINDOW);
    const before = r.value.zones.find((z) => z.zoneId === 'a').composite;
    assert.equal(before, 0);   // worst in a two-zone range

    const rb = reBaselineZone(r, 'a', { unitAvailabilityPct: 90 });
    assert.equal(rb.before, 0);
    assert.equal(rb.after, 100);   // now ties the top of the ORIGINAL range
    assert.equal(rb.delta, 100);
  });

  test('an insufficient-data zone cannot be re-baselined', () => {
    const zones = [zone('a'), { ...zone('thin'), sampleN: 2 }];
    const r = rankZones(zones, DEFAULT_WEIGHTS, WINDOW);
    assert.equal(reBaselineZone(r, 'thin', { unitAvailabilityPct: 99 }), null);
  });
});
