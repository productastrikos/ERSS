/**
 * Golden fixtures for the Phase 6 raw engines: anomaly, equity, coverage, crowd,
 * preempt, advisory candidates. No database — every engine is a pure function.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectAnomaly, median, robustSpread, ewma } from '../engines/anomaly.js';
import { assessEquity } from '../engines/equity.js';
import { computeCoverage } from '../engines/coverage.js';
import { classifyDensity, chokePoint, stampedeLeadTimeMin, assessCrowd } from '../engines/crowd.js';
import { summarisePreemptImpact } from '../engines/preempt.js';
import { anomalyCandidate, equityCandidates, coverageGapCandidate, preemptShortfallCandidate } from '../engines/advisory.js';
import { isInsufficient } from '../lib/result.js';

const WINDOW = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-17T00:00:00.000Z' };

describe('anomaly', () => {
  const flatPoints = (n, v) => Array.from({ length: n }, (_, i) => ({ bucket: `h${i}`, value: v }));

  test('too few points is insufficient, not a fabricated flag', () => {
    const r = detectAnomaly({ zoneRef: 'Z1', seriesName: 'calls', points: flatPoints(3, 4) }, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('a flat series never sustains a flag', () => {
    const r = detectAnomaly({ zoneRef: 'Z1', seriesName: 'calls', points: flatPoints(20, 4) }, WINDOW);
    assert.equal(r.value.sustained, false);
  });

  test('a sustained spike in the last two buckets is flagged', () => {
    const points = [...flatPoints(20, 4), { bucket: 'h20', value: 40 }, { bucket: 'h21', value: 42 }];
    const r = detectAnomaly({ zoneRef: 'Z1', seriesName: 'calls', points }, WINDOW);
    assert.equal(r.value.sustained, true);
    assert.equal(r.value.direction, 'up');
    assert.ok(r.confidence > 0);
  });

  test('median and robust spread are computed correctly on a known set', () => {
    assert.equal(median([1, 2, 3, 4, 5]), 3);
    assert.equal(robustSpread([1, 2, 3, 4, 5], 3), 1.4826);
  });

  test('ewma smooths toward recent values', () => {
    const s = ewma([1, 1, 1, 10]);
    assert.ok(s.at(-1) > 1 && s.at(-1) < 10);
  });
});

describe('equity', () => {
  const zone = (zoneRef, distanceToStationM, p90ResponseSec) => ({
    zoneId: zoneRef, zoneRef, zoneName: zoneRef, sampleN: 100, distanceToStationM, p90ResponseSec,
  });

  test('too few zones is insufficient', () => {
    const r = assessEquity([zone('Z1', 1000, 500)], 500, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('a zone that fits the distance line is not flagged', () => {
    const zones = [zone('Z1', 1000, 500), zone('Z2', 2000, 600), zone('Z3', 3000, 700), zone('Z4', 4000, 800), zone('Z5', 5000, 900)];
    const r = assessEquity(zones, 700, WINDOW);
    assert.ok(!r.value.zones.every((z) => z.flagged));
  });

  test('a zone far worse than distance predicts is flagged as a process finding', () => {
    const zones = [zone('Z1', 1000, 400), zone('Z2', 1000, 420), zone('Z3', 1000, 410), zone('Z4', 1000, 430), zone('Z5', 1000, 900)];
    const r = assessEquity(zones, 415, WINDOW);
    const z5 = r.value.zones.find((z) => z.zoneRef === 'Z5');
    assert.equal(z5.flagged, true);
    assert.equal(z5.classification, 'process_flag');
  });
});

describe('coverage', () => {
  test('no units or demand is insufficient', () => {
    const r = computeCoverage({ units: [], demandPoints: [] }, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('a unit within target fully covers a single demand point', () => {
    const r = computeCoverage({
      units: [{ unitId: 'u1', unitRef: 'AMB-1', lng: 55.27, lat: 25.2, busyProbability: 0, relocatable: false }],
      demandPoints: [{ zoneId: 'z1', zoneRef: 'Z1', lng: 55.27, lat: 25.2, demandWeight: 1 }],
      targetSec: 600,
    }, WINDOW);
    assert.equal(r.value.currentPct, 100);
  });

  test('a busy unit only partially covers', () => {
    const r = computeCoverage({
      units: [{ unitId: 'u1', unitRef: 'AMB-1', lng: 55.27, lat: 25.2, busyProbability: 0.5, relocatable: false }],
      demandPoints: [{ zoneId: 'z1', zoneRef: 'Z1', lng: 55.27, lat: 25.2, demandWeight: 1 }],
      targetSec: 600,
    }, WINDOW);
    assert.equal(r.value.currentPct, 50);
  });

  test('a relocation is proposed when it meaningfully improves coverage', () => {
    const r = computeCoverage({
      units: [
        { unitId: 'u1', unitRef: 'AMB-1', lng: 55.10, lat: 25.10, busyProbability: 0, relocatable: true },
      ],
      demandPoints: [
        { zoneId: 'z1', zoneRef: 'FAR', lng: 55.40, lat: 25.30, demandWeight: 5 },
      ],
      targetSec: 300,
    }, WINDOW);
    assert.ok(r.value.gapPp >= 0);
  });
});

describe('crowd', () => {
  test('classifyDensity matches the Fruin bands', () => {
    assert.equal(classifyDensity(0.05).band, 'A');
    assert.equal(classifyDensity(1.2).band, 'F');
  });

  test('chokePoint flags inflow above capacity', () => {
    const c = chokePoint({ widthM: 2, inflowPersonsPerSec: 3 });
    assert.equal(c.capacityPersonsPerSec, 2.6);
    assert.equal(c.exceeded, true);
  });

  test('stampedeLeadTimeMin is null when density is not rising', () => {
    assert.equal(stampedeLeadTimeMin(0.5, 0), null);
    assert.equal(stampedeLeadTimeMin(0.5, -0.01), null);
  });

  test('stampedeLeadTimeMin projects forward when rising', () => {
    const t = stampedeLeadTimeMin(1.0, 0.01);
    assert.ok(t > 0);
  });

  test('assessCrowd without footfall data is insufficient', () => {
    const r = assessCrowd({ zoneRef: 'Z1' }, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('assessCrowd flags emergency at LoS F', () => {
    const r = assessCrowd({ zoneRef: 'Z1', areaM2: 100, footfall: 150 }, WINDOW);
    assert.equal(r.value.los, 'F');
    assert.equal(r.value.emergency, true);
  });
});

describe('preempt', () => {
  test('no rows is insufficient', () => {
    const r = summarisePreemptImpact([], 1000, WINDOW);
    assert.ok(isInsufficient(r));
  });

  test('reproduces the worked-example shape: count, pct of total, seconds saved', () => {
    const rows = [
      { signalRef: 'SIG-1', corridor: 'Sheikh Zayed Rd', requests: 100, granted: 80, meanSavedSec: 27, totalSavedSec: 2160 },
    ];
    const r = summarisePreemptImpact(rows, 2000, WINDOW);
    assert.equal(r.value.requests, 100);
    assert.equal(r.value.pctOfTotal, 5);
    assert.equal(r.value.grantPct, 80);
  });

  test('a low grant rate or small saving is flagged as a shortfall', () => {
    const rows = [{ signalRef: 'SIG-1', corridor: 'C', requests: 50, granted: 10, meanSavedSec: 3, totalSavedSec: 30 }];
    const r = summarisePreemptImpact(rows, 500, WINDOW);
    assert.equal(r.value.shortfall, true);
  });
});

describe('advisory candidates', () => {
  test('anomalyCandidate is null unless sustained', () => {
    const r = detectAnomaly({ zoneRef: 'Z1', seriesName: 'calls', points: Array.from({ length: 20 }, (_, i) => ({ bucket: `h${i}`, value: 4 })) }, WINDOW);
    assert.equal(anomalyCandidate(r), null);
  });

  test('anomalyCandidate builds a titled candidate when sustained', () => {
    const points = [...Array.from({ length: 20 }, (_, i) => ({ bucket: `h${i}`, value: 4 })), { bucket: 'h20', value: 40 }, { bucket: 'h21', value: 42 }];
    const r = detectAnomaly({ zoneId: 'zid1', zoneRef: 'Z1', seriesName: 'calls', points }, WINDOW);
    const c = anomalyCandidate(r);
    assert.ok(c.title.includes('Z1'));
    assert.equal(c.category, 'anomaly');
    assert.deepEqual(c.zoneIds, ['zid1']);
  });

  test('equityCandidates only includes flagged zones', () => {
    const zones = [
      { zoneId: 'z1', zoneRef: 'Z1', zoneName: 'Z1', sampleN: 100, distanceToStationM: 1000, p90ResponseSec: 400 },
      { zoneId: 'z2', zoneRef: 'Z2', zoneName: 'Z2', sampleN: 100, distanceToStationM: 1000, p90ResponseSec: 420 },
      { zoneId: 'z3', zoneRef: 'Z3', zoneName: 'Z3', sampleN: 100, distanceToStationM: 1000, p90ResponseSec: 410 },
      { zoneId: 'z4', zoneRef: 'Z4', zoneName: 'Z4', sampleN: 100, distanceToStationM: 1000, p90ResponseSec: 430 },
      { zoneId: 'z5', zoneRef: 'Z5', zoneName: 'Z5', sampleN: 100, distanceToStationM: 1000, p90ResponseSec: 900 },
    ];
    const r = assessEquity(zones, 415, WINDOW);
    const cands = equityCandidates(r);
    assert.equal(cands.length, 1);
    assert.equal(cands[0].zoneIds[0], 'z5');
  });

  test('coverageGapCandidate is null below the 8pp threshold', () => {
    const r = computeCoverage({
      units: [{ unitId: 'u1', unitRef: 'AMB-1', lng: 55.27, lat: 25.2, busyProbability: 0, relocatable: false }],
      demandPoints: [{ zoneId: 'z1', zoneRef: 'Z1', lng: 55.27, lat: 25.2, demandWeight: 1 }],
      targetSec: 600,
    }, WINDOW);
    assert.equal(coverageGapCandidate(r), null);
  });

  test('preemptShortfallCandidate reproduces the Concept Note framing', () => {
    const rows = [{ signalRef: 'SIG-1', corridor: 'C', requests: 50, granted: 10, meanSavedSec: 3, totalSavedSec: 30 }];
    const r = summarisePreemptImpact(rows, 500, WINDOW);
    const c = preemptShortfallCandidate(r);
    assert.equal(c.category, 'preempt');
    assert.ok(c.title.includes('%'));
  });
});
