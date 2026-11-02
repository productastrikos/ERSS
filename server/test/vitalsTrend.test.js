/**
 * Vitals trend — what the citizen's wearable readings tell a receiving hospital.
 *
 * No database. Built series with a known shape: if the engine reads the order or the depth
 * of a change wrongly, the pre-alert and the report say the wrong thing to a clinician.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyseVitals } from '../engines/vitalsTrend.js';
import { isInsufficient } from '../lib/result.js';

const T0 = Date.parse('2026-10-07T10:00:00Z');

/** A series every 2 s for `sec` seconds; hr(k) and spo2(k) take k = 0..1 through it. */
function series(sec, hr, spo2) {
  const out = [];
  for (let s = 0; s <= sec; s += 2) out.push({ ts: T0 + s * 1000, hr: hr(s / sec), spo2: spo2(s / sec) });
  return out;
}

describe('vitals trend', () => {
  test('oxygen falling before the heart rate rises reads as a respiratory pattern', () => {
    const r = analyseVitals(series(240,
      (k) => Math.round(76 + Math.max(0, k - 0.5) * 140),
      (k) => Math.round(97 - Math.max(0, k - 0.2) * 16)), { device: 'Demo sensor' });
    const v = r.value;
    assert.equal(v.sequence.first, 'spo2');
    assert.ok(v.sequence.leadSec > 30, `lead ${v.sequence.leadSec}`);
    assert.ok(v.spo2.min <= 85 && v.spo2.baseline >= 96);
    assert.ok(v.hr.max >= 140);
    assert.equal(v.severity, 'bad');
    assert.ok(v.prepare.includes('Supplemental oxygen and airway support'));
    assert.match(v.headline, /oxygen fell first/);
    assert.ok(r.caveats.some((c) => /not a diagnosis/.test(c)));
  });

  test('a heart rate that leads reads as a cardiac pattern', () => {
    const v = analyseVitals(series(240,
      (k) => Math.round(80 + Math.max(0, k - 0.2) * 110),
      (k) => Math.round(97 - Math.max(0, k - 0.6) * 25))).value;
    assert.equal(v.sequence.first, 'hr');
    assert.match(v.sequence.text, /primary cardiac/);
  });

  test('steady readings are said to be steady', () => {
    const v = analyseVitals(series(180, () => 74, () => 98)).value;
    assert.equal(v.severity, 'good');
    assert.equal(v.sequence.first, null);
    assert.ok(v.findings.every((f) => f.tone === 'good'));
    assert.equal(v.hr.above120Sec, 0);
    assert.equal(v.spo2.below90Sec, 0);
  });

  test('time out of range is integrated, and dropouts are not', () => {
    const pts = [
      ...series(60, () => 130, () => 88),
      // A 40-second dropout, then normal again.
      ...series(60, () => 80, () => 97).map((p) => ({ ...p, ts: p.ts + 100_000 })),
    ];
    const v = analyseVitals(pts).value;
    assert.ok(v.hr.above120Sec >= 58 && v.hr.above120Sec <= 62, `above120 ${v.hr.above120Sec}`);
    assert.ok(v.spo2.below90Sec >= 58 && v.spo2.below90Sec <= 62, `below90 ${v.spo2.below90Sec}`);
    assert.equal(v.gaps, 1);
  });

  test('too few readings is an honest "not enough data"', () => {
    const r = analyseVitals([{ ts: T0, hr: 80, spo2: 97 }]);
    assert.ok(isInsufficient(r));
  });
});
