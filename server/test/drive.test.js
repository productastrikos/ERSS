/**
 * engines/drive.js — the ambulance's speed profile over a road.
 *
 * No database, no router: hand-built polylines a kilometre or two long, so every property
 * the AI's route explanations rest on can be checked directly — a turn costs time, a
 * U-turn costs more, traffic slows the vehicle only where it is, and the drive loop's
 * clock agrees with the profile's.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyse, withTraffic, speedAt, distanceAt, remainingSec, upcoming, whyRoute, best, CRUISE_KMH,
} from '../engines/drive.js';

// ~111 m per 0.001° of latitude; longitude scaled near Dubai's latitude.
const LAT0 = 25.15;
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const north = (m, x = 0) => [55.4 + x * M_LNG, LAT0 + m * M_LAT];
const straight = (m) => Array.from({ length: Math.ceil(m / 50) + 1 }, (_, i) => north(Math.min(m, i * 50)));
/** Up 600 m, a right-angle turn east, 600 m along. */
const rightAngle = () => [...straight(600), ...Array.from({ length: 12 }, (_, i) => north(600, (i + 1) * 50))];
/** Up 600 m, a U-turn (offset 15 m), and back down 600 m. */
const uTurn = () => [...straight(600), north(600, 15), ...Array.from({ length: 12 }, (_, i) => north(600 - (i + 1) * 50, 15))];
const arterial = (n) => Array(n).fill(55 / 3.6);   // free-flow 55 km/h → arterial

describe('drive: the speed profile', () => {
  test('starts from rest, never exceeds the class ceiling, and pulls up at the end', () => {
    const coords = straight(1500);
    const a = analyse({ coords, speeds: arterial(coords.length - 1) });
    assert.equal(a.profile[0], 0);
    assert.ok(Math.max(...a.profile) * 3.6 <= CRUISE_KMH.arterial + 0.01);
    assert.ok(a.profile[a.profile.length - 1] <= 3.01);
    assert.ok(Math.abs(a.totalM - 1500) < 5);
  });

  test('a right-angle turn costs time, and the vehicle slows to corner speed at it', () => {
    const plain = analyse({ coords: straight(1200), speeds: arterial(24) });
    const turned = analyse({ coords: rightAngle(), speeds: arterial(rightAngle().length - 1) });
    assert.ok(Math.abs(plain.totalM - turned.totalM) < 5);
    assert.ok(turned.timeSec > plain.timeSec + 3, `turn ${turned.timeSec}s vs straight ${plain.timeSec}s`);
    assert.ok(speedAt(turned, 600) * 3.6 <= 25, 'through the corner at turn speed');
    assert.ok(turned.counts.manoeuvres >= 1);
  });

  test('a U-turn costs more than a right-angle turn', () => {
    const turn = analyse({ coords: rightAngle(), speeds: arterial(rightAngle().length - 1) });
    const back = analyse({ coords: uTurn(), speeds: arterial(uTurn().length - 1) });
    assert.ok(back.counts.uturns >= 1);
    assert.ok(back.cornerLossSec > turn.cornerLossSec);
  });

  test('a drive back to station is slower than one under lights', () => {
    const coords = straight(1500);
    const lights = analyse({ coords, speeds: arterial(coords.length - 1) });
    const home = analyse({ coords, speeds: arterial(coords.length - 1) }, { mode: 'return' });
    assert.ok(home.timeSec > lights.timeSec);
  });
});

describe('drive: traffic and the clock', () => {
  test('a congested stretch slows the vehicle inside it and nowhere else', () => {
    const coords = straight(2000);
    const a = analyse({ coords, speeds: arterial(coords.length - 1) });
    const jam = withTraffic(a, [{ fromM: 800, toM: 1200, factor: 0.4 }]);
    assert.ok(jam.trafficDelaySec > 0);
    assert.ok(speedAt(jam, 1000) < speedAt(a, 1000));
    assert.equal(speedAt(jam, 300), speedAt(a, 300));
  });

  test('following the profile in time covers the whole road exactly when it says', () => {
    const coords = rightAngle();
    const a = analyse({ coords, speeds: arterial(coords.length - 1) });
    assert.equal(distanceAt(a, 0), 0);
    assert.ok(Math.abs(distanceAt(a, a.tcum[a.tcum.length - 1]) - a.totalM) < 0.5);
    const halfway = distanceAt(a, a.timeSec / 2);
    assert.ok(halfway > 0 && halfway < a.totalM);
    assert.ok(Math.abs(remainingSec(a, halfway) - a.timeSec / 2) <= 1);
  });

  test('at the end of the clock the vehicle is at the EXACT end of the road, not a rounded metre short', () => {
    // Regression: the profile's total was rounded, so a crew stopped 0.4 m short of a
    // 2512.4 m road and never arrived on scene.
    const coords = [...straight(1200), north(1200.4)];
    const a = analyse({ coords, speeds: arterial(coords.length - 1) });
    assert.equal(distanceAt(a, a.tcum[a.tcum.length - 1] + 1), a.exactM);
    assert.ok(a.exactM !== a.totalM, 'fixture has a fractional length');
  });

  test('the next manoeuvre is named with its distance and corner speed', () => {
    const coords = rightAngle();
    const a = analyse({ coords, steps: [{ type: 'turn', modifier: 'right', name: 'Test St', location: north(600) }], speeds: arterial(coords.length - 1) });
    const next = upcoming(a, 300);
    assert.ok(next);
    assert.match(next.label, /right turn onto Test St/);
    assert.ok(Math.abs(next.inM - 300) <= 15);
    assert.equal(next.kmh, 24);
  });
});

describe('drive: choosing and explaining a road', () => {
  test('the quicker road wins even when it is longer, and the reason says so', () => {
    const direct = withTraffic(analyse({ coords: uTurn(), speeds: arterial(uTurn().length - 1) }), []);
    const longer = withTraffic(analyse({ coords: straight(1300), speeds: arterial(26) }), []);
    const chosen = best([direct, longer]);
    assert.equal(chosen, longer);
    const why = whyRoute(longer, direct).join(' ');
    assert.match(why, /U-turn/);
  });
});
