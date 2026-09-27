/**
 * Engine golden fixtures — eta, dispatch, hospital, correlation, triage.
 *
 * No database: every engine is a pure function, and these fixtures are small enough to
 * check by hand. If one of these numbers moves, a dispatcher's screen moved with it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalibration, predictTravel, predictVrt, arrivalSec, hourBand, floorBand, DETOUR,
} from '../engines/eta.js';
import { recommend, requirementFor, exclusionReason, coverageCost, crewReadiness } from '../engines/dispatch.js';
import { rankHospitals, requirementFor as hospitalRequirement } from '../engines/hospital.js';
import { correlate } from '../engines/correlation.js';
import { autoTriage } from '../engines/triage.js';
import { isInsufficient } from '../lib/result.js';
import { CAPABILITY_REQUIREMENTS, CASE_MIX } from '../data/reference/fleet.js';
import { jurisdiction } from '../config/jurisdiction.js';

const WINDOW = { from: '2024-09-16T00:00:00.000Z', to: '2026-09-16T00:00:00.000Z' };

// A hand-checkable calibration: urban midday pace 0.1 s/m, quartiles ±20%.
const ROWS = [
  { kind: 'pace', key: 'midday|urban', n: 10_000, p10: 0.07, p25: 0.08, p50: 0.1, p75: 0.12, p90: 0.15 },
  { kind: 'pace', key: 'night|urban', n: 10_000, p10: 0.05, p25: 0.06, p50: 0.08, p75: 0.1, p90: 0.12 },
  { kind: 'pace', key: 'midday|desert', n: 20, p10: 0.02, p25: 0.03, p50: 0.04, p75: 0.05, p90: 0.06 },
  { kind: 'short', key: 'midday|urban', n: 5_000, p10: 45, p25: 45, p50: 60, p75: 85, p90: 110 },
  { kind: 'short', key: 'night|urban', n: 5_000, p10: 45, p25: 45, p50: 50, p75: 70, p90: 90 },
  { kind: 'vrt', key: 'f00-09', n: 1_000, p10: 240, p25: 270, p50: 316, p75: 370, p90: 430 },
  { kind: 'vrt', key: 'f40-59', n: 1_000, p10: 460, p25: 460, p50: 513, p75: 565, p90: 610 },
  { kind: 'stage', key: 'acknowledge', n: 1_000, p10: 10, p25: 14, p50: 20, p75: 29, p90: 40 },
  { kind: 'stage', key: 'turnout', n: 1_000, p10: 22, p25: 29, p50: 40, p75: 55, p90: 72 },
];
const CAL = buildCalibration(ROWS, WINDOW);

describe('eta', () => {
  test('hour bands match the calibration view', () => {
    assert.equal(hourBand(7), 'am_peak');
    assert.equal(hourBand(12), 'midday');
    assert.equal(hourBand(18), 'pm_peak');
    assert.equal(hourBand(22), 'evening');
    assert.equal(hourBand(3), 'night');
    assert.equal(hourBand(23), 'night');
    assert.equal(floorBand(9), 'f00-09');
    assert.equal(floorBand(75), 'f60+');
  });

  test('a well-populated cell predicts pace × road distance', () => {
    const r = predictTravel({ distanceM: 5000, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
    // Weight 10000/10200 on the cell; the pooled pace pulls it a hair.
    assert.ok(Math.abs(r.value.seconds - 500) <= 12, `expected ≈500 s, got ${r.value.seconds}`);
    assert.ok(r.value.p25 < r.value.seconds && r.value.seconds < r.value.p75);
    assert.equal(r.unit, 'seconds');
    assert.ok(r.method.endsWith('+osrm'));
    // Confidence = 1 − IQR / p50 ≈ 1 − 0.04/0.1 = 0.6
    assert.ok(Math.abs(r.confidence - 0.6) < 0.03, `confidence ${r.confidence}`);
    assert.equal(r.factors.length, 2);
  });

  test('night is faster than midday over the same distance', () => {
    const day = predictTravel({ distanceM: 5000, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
    const night = predictTravel({ distanceM: 5000, distanceSource: 'osrm', gstHour: 2, zoneClass: 'urban' }, CAL);
    assert.ok(night.value.seconds < day.value.seconds);
    assert.equal(night.factors[1].direction, 'down');
  });

  test('a short trip gets the measured floor, not distance × pace', () => {
    const r = predictTravel({ distanceM: 200, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
    assert.ok(r.value.seconds >= 55, `a 200 m call does not take ${r.value.seconds} s`);
  });

  test('a thin cell is shrunk toward the pooled pace', () => {
    const r = predictTravel({ distanceM: 10_000, distanceSource: 'osrm', gstHour: 12, zoneClass: 'desert' }, CAL);
    // Raw desert pace would give 400 s; with n=20 the pooled figure dominates.
    assert.ok(r.value.seconds > 700, `thin cell not shrunk: ${r.value.seconds}`);
    assert.ok(r.factors[1].detail.includes('thin cell'));
  });

  test('without road routing the interval widens instead of confidence being invented', () => {
    const road = predictTravel({ distanceM: 5000, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
    const line = predictTravel({ distanceM: 5000 / DETOUR.mid, distanceSource: 'straight_line', gstHour: 12, zoneClass: 'urban' }, CAL);
    assert.ok(Math.abs(line.value.seconds - road.value.seconds) <= 2);
    assert.ok(line.value.p75 - line.value.p25 > road.value.p75 - road.value.p25);
    assert.ok(line.confidence < road.confidence);
    assert.ok(line.caveats.some((c) => c.includes('straight line')));
  });

  test('no calibration returns the insufficient-data sentinel, not a guess', () => {
    const empty = buildCalibration([], WINDOW);
    const r = predictTravel({ distanceM: 5000, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, empty);
    assert.ok(isInsufficient(r));
    assert.equal(r.value, null);
    assert.equal(r.confidence, null);
  });

  test('VRT is the measured band median, and absent without a floor', () => {
    assert.equal(predictVrt({ floor: null, ascentSecPerFloor: 2.5 }, CAL), null);
    const low = predictVrt({ floor: 3, ascentSecPerFloor: 2.5 }, CAL);
    const high = predictVrt({ floor: 45, ascentSecPerFloor: 2.5 }, CAL);
    assert.equal(low.value.seconds, 316);
    // Not pulled toward low floors — height is what drives the number.
    assert.equal(high.value.seconds, 513);
    assert.deepEqual(high.caveats, []);
  });

  test('a band too thin to trust is extrapolated from the band below, and says so', () => {
    // No f60+ rows at all: floor 75 = f40-59 median + 25 floors × 2.5 s.
    const r = predictVrt({ floor: 75, ascentSecPerFloor: 2.5 }, CAL);
    assert.equal(r.value.seconds, 513 + 63);
    assert.match(r.caveats[0], /extrapolated from f40-59/);
    assert.equal(r.factors.length, 2);
  });

  test('arrival adds acknowledge and turnout only for a unit not yet moving', () => {
    assert.equal(arrivalSec({ travelSec: 300, stage: 'offer' }, CAL), 360);
    assert.equal(arrivalSec({ travelSec: 300, stage: 'acknowledged' }, CAL), 340);
    assert.equal(arrivalSec({ travelSec: 300, stage: 'moving' }, CAL), 300);
  });
});

// ── dispatch ────────────────────────────────────────────────────────────────

const RULES = { nonPrimaryKinds: jurisdiction.dispatch.nonPrimaryKinds, nonTransportKinds: jurisdiction.dispatch.nonTransportKinds };
const WEIGHTS = jurisdiction.dispatch.weights;

function unit(ref, kind, capabilities, travelSec, extra = {}) {
  const travel = predictTravel({ distanceM: travelSec * 10, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
  return {
    ref, callsign: ref, kind, agencyCode: 'DCAS', capabilities, status: 'available',
    straightM: travelSec * 7, travel, arrivalSec: arrivalSec({ travelSec: travel.value.seconds, stage: 'offer' }, CAL),
    jobsToday: 0, shiftHours: null, othersNearby: 3, zoneDemandIndex: 1, ...extra,
  };
}

describe('dispatch', () => {
  const cardiacArrest = { ref: 'INC-TEST-0001', kind: 'cardiac_arrest', priority: 'P1' };

  test('the capability requirement is a hard filter', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const bls = unit('AMB-01', 'BLS', ['bls', 'defib'], 200);
    const als = unit('AMB-02', 'ALS', ['als', 'bls', 'defib', 'vent'], 600);
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [bls, als], weights: WEIGHTS, rules: RULES, window: WINDOW });
    assert.deepEqual(r.value.recommendations.map((x) => x.unitRef), ['AMB-02']);
    assert.equal(r.value.excluded[0].unitRef, 'AMB-01');
    assert.match(r.value.excluded[0].reason, /lacks als/);
  });

  test('a supervisor car is not offered a call that does not name it', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    assert.match(exclusionReason({ kind: 'SUPERVISOR', capabilities: ['als', 'command', 'defib'], status: 'available' }, req, RULES), /not a primary/);
  });

  test('the faster qualifying unit ranks first when all else is equal', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const near = unit('AMB-10', 'ALS', ['als', 'defib'], 240);
    const far = unit('AMB-11', 'ALS', ['als', 'defib'], 720);
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [far, near], weights: WEIGHTS, rules: RULES, window: WINDOW });
    assert.deepEqual(r.value.recommendations.map((x) => x.unitRef), ['AMB-10', 'AMB-11']);
    assert.equal(r.value.recommendations[0].rank, 1);
    // Clearly separated arrivals → high confidence that #1 is really first.
    assert.ok(r.confidence > 0.9, `separation confidence ${r.confidence}`);
  });

  test('the engine declines the nearest unit when taking it strips the only cover from a busy area', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const lonely = unit('AMB-20', 'ALS', ['als', 'defib'], 300, { othersNearby: 0, zoneDemandIndex: 2 });
    const covered = unit('AMB-21', 'ALS', ['als', 'defib'], 340, { othersNearby: 4, zoneDemandIndex: 0.5 });
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [lonely, covered], weights: WEIGHTS, rules: RULES, window: WINDOW });
    assert.equal(r.value.recommendations[0].unitRef, 'AMB-21');
    assert.equal(r.value.recommendations[1].rationale.coverageCostPct, 100);
  });

  test('every recommendation carries its full rationale and the weights sum to 1', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [unit('AMB-30', 'ALS', ['als', 'defib'], 300)], weights: WEIGHTS, rules: RULES, window: WINDOW });
    const rat = r.value.recommendations[0].rationale;
    assert.deepEqual(rat.factors.map((f) => f.key), ['travel', 'capability', 'coverage', 'crew', 'equity']);
    const total = rat.factors.reduce((s, f) => s + f.contribution, 0);
    assert.ok(Math.abs(total - rat.score) < 0.002);
    assert.ok(Math.abs(Object.values(WEIGHTS).reduce((s, w) => s + w, 0) - 1) < 1e-9);
    assert.ok(r.caveats.some((c) => c.includes('proxy')));
  });

  test('a P1 of a kind that does not require ALS still prefers it', () => {
    const req = requirementFor({ kind: 'rta', priority: 'P1' }, CAPABILITY_REQUIREMENTS);
    assert.equal(req.preferred[0], 'ALS');
    assert.deepEqual(req.required, []);
  });

  test('a motorcycle first on scene is flagged as unable to transport, and the first ambulance named', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const mru = unit('MRU-01', 'MRU', ['als', 'defib'], 150);
    const als = unit('AMB-50', 'ALS', ['als', 'defib'], 400);
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [mru, als], weights: WEIGHTS, rules: RULES, window: WINDOW });
    assert.equal(r.value.recommendations[0].unitRef, 'MRU-01');
    assert.equal(r.value.recommendations[0].canTransport, false);
    assert.deepEqual(r.value.transport, { unitRef: 'AMB-50', rank: 2, arrivalSec: r.value.recommendations[1].arrivalSec });
    assert.match(r.caveats[0], /cannot transport — AMB-50 is the first transporting unit/);
  });

  test('no qualifying unit is reported honestly', () => {
    const req = requirementFor(cardiacArrest, CAPABILITY_REQUIREMENTS);
    const r = recommend({ incident: cardiacArrest, requirement: req, candidates: [unit('AMB-40', 'BLS', ['bls'], 100)], weights: WEIGHTS, rules: RULES, window: WINDOW });
    assert.ok(isInsufficient(r));
    assert.equal(r.value.recommendations.length, 0);
    assert.equal(r.value.excluded.length, 1);
  });

  test('coverage cost and crew readiness stay in range', () => {
    assert.equal(coverageCost({ othersNearby: 0, zoneDemandIndex: 5 }), 1);
    assert.equal(coverageCost({ othersNearby: 3, zoneDemandIndex: 0 }), 0);
    assert.equal(crewReadiness({ jobsToday: 0, shiftHours: null }), 1);
    assert.ok(crewReadiness({ jobsToday: 12, shiftHours: 13 }) === 0);
  });
});

// ── hospital ────────────────────────────────────────────────────────────────

function hospital(ref, capabilities, transportSec, extra = {}) {
  const transport = predictTravel({ distanceM: transportSec * 10, distanceSource: 'osrm', gstHour: 12, zoneClass: 'urban' }, CAL);
  return { ref, name: ref, capabilities, edBeds: 40, edOccupied: 20, onDiversion: false, inbound: 0, transport, ...extra };
}

describe('hospital', () => {
  test('a stroke goes to a stroke unit even when a nearer ED has none', () => {
    const r = rankHospitals({
      incident: { ref: 'X', kind: 'stroke', priority: 'P1' },
      hospitals: [hospital('HOS-01', ['general'], 300), hospital('HOS-02', ['stroke', 'general'], 900)],
      window: WINDOW,
    });
    assert.equal(r.value.hospitals[0].ref, 'HOS-02');
    assert.equal(r.value.hospitals.length, 1);
    assert.match(r.value.hospitals[0].reasoning, /stroke unit/);
    assert.equal(r.value.excluded[0].reason, 'no stroke');
  });

  test('major trauma requires a Level 1 centre only at P1/P2', () => {
    assert.equal(hospitalRequirement({ kind: 'rta', priority: 'P1' }).capability, 'trauma_l1');
    assert.equal(hospitalRequirement({ kind: 'rta', priority: 'P3' }), null);
  });

  test('a hospital on diversion is skipped while another can take the patient', () => {
    const r = rankHospitals({
      incident: { ref: 'X', kind: 'medical_general', priority: 'P3' },
      hospitals: [hospital('HOS-01', ['general'], 300, { onDiversion: true }), hospital('HOS-02', ['general'], 400)],
      window: WINDOW,
    });
    assert.deepEqual(r.value.hospitals.map((h) => h.ref), ['HOS-02']);
    assert.equal(r.value.excluded[0].reason, 'on diversion');
  });

  test('a full ED loses to a quieter one a little further away', () => {
    const r = rankHospitals({
      incident: { ref: 'X', kind: 'medical_general', priority: 'P3' },
      hospitals: [hospital('HOS-01', ['general'], 500, { edOccupied: 40, inbound: 3 }), hospital('HOS-02', ['general'], 560, { edOccupied: 10 })],
      window: WINDOW,
    });
    assert.equal(r.value.hospitals[0].ref, 'HOS-02');
  });
});

// ── correlation ─────────────────────────────────────────────────────────────

const CORR_RULES = { mciThreshold: 5, highRiseFloorThreshold: 20, emiratePatients: 10 };
const FEEDS = [
  { key: 'traffic', name: 'Traffic', agencyCode: 'RTA', isSimulated: true },
  { key: 'bms', name: 'BMS', agencyCode: 'CIVIL_DEFENCE', isSimulated: true },
  { key: 'environment', name: 'Env', agencyCode: 'MUNICIPALITY', isSimulated: true },
  { key: 'water', name: 'Water', agencyCode: 'DEWA', isSimulated: true },
];
const base = {
  zone: { class: 'urban', population: 50_000, populationDaytime: 100_000, areaKm2: 5, highriseCount: 10, name: 'Test' },
  weather: { ts: '2026-09-16T12:00:00.000Z', windDir: 300, windKph: 18, tempC: 41, condition: 'clear' },
  daytime: true, hospitals: [], sites: [], events: [], feeds: FEEDS, rules: CORR_RULES, window: WINDOW,
};

describe('correlation', () => {
  test('a collision notifies police and RTA and surfaces the traffic feed', () => {
    const r = correlate({ ...base, incident: { ref: 'X', kind: 'rta', priority: 'P2', floor: null, patientsCount: 2, chiefComplaint: null } });
    assert.deepEqual(r.value.recommendedAgencies.map((a) => a.code), ['POLICE', 'RTA']);
    assert.deepEqual(r.value.feeds.map((f) => f.key), ['traffic']);
    assert.equal(r.value.wind.plume, null);
    assert.equal(r.confidence, null);
    assert.equal(r.meta.rulesBased, true);
  });

  test('a fire gets a plume sector downwind of the wind direction', () => {
    const r = correlate({ ...base, incident: { ref: 'X', kind: 'fire_related', priority: 'P1', floor: null, patientsCount: 1, chiefComplaint: 'Smoke inhalation' } });
    // Wind FROM 300° blows TOWARD 120°; the sector is ±30°.
    assert.equal(r.value.wind.towardDeg, 120);
    assert.deepEqual(r.value.wind.plume, { fromDeg: 90, toDeg: 150 });
    assert.ok(r.value.recommendedAgencies.some((a) => a.code === 'CIVIL_DEFENCE'));
    assert.deepEqual(r.value.feeds.map((f) => f.key).sort(), ['bms', 'environment', 'traffic', 'water']);
  });

  test('a site with several defibrillators is listed once, at its nearest', () => {
    const r = correlate({
      ...base,
      sites: [
        { siteName: 'City Mall', siteKind: 'mall', distanceM: 420 },
        { siteName: 'City Mall', siteKind: 'mall', distanceM: 310 },
        { siteName: 'North School', siteKind: 'school', distanceM: 600 },
      ],
      incident: { ref: 'X', kind: 'medical_general', priority: 'P3', floor: null, patientsCount: 1, chiefComplaint: null },
    });
    assert.deepEqual(r.value.sensitiveSites.map((s) => [s.name, s.distanceM]), [['City Mall', 310], ['North School', 600]]);
  });

  test('population within radius uses daytime density by day', () => {
    const r = correlate({ ...base, incident: { ref: 'X', kind: 'medical_general', priority: 'P3', floor: null, patientsCount: 1, chiefComplaint: null } });
    // 100 000 / 5 km² × π × 0.25 km² ≈ 15 708
    assert.equal(r.value.populationWithin[0].estimate, 15_708);
  });

  test('a P1 on a high floor asks for vertical-access support, marked as modelled', () => {
    const r = correlate({ ...base, incident: { ref: 'X', kind: 'cardiac_arrest', priority: 'P1', floor: 41, patientsCount: 1, chiefComplaint: null } });
    const cd = r.value.recommendedAgencies.find((a) => a.code === 'CIVIL_DEFENCE');
    assert.ok(cd && cd.reasons[0].includes('modelled'));
  });
});

// ── triage ──────────────────────────────────────────────────────────────────

describe('triage', () => {
  test('takes the kind\'s modal priority and reports its share as confidence', () => {
    const r = autoTriage({ kind: 'medical_general', chiefComplaint: 'Fever' }, CASE_MIX, WINDOW);
    assert.equal(r.value.priority, 'P3');
    assert.equal(r.confidence, 0.52);
  });

  test('a life-threat phrase raises to P1 and claims no measured confidence', () => {
    const r = autoTriage({ kind: 'medical_general', chiefComplaint: 'Collapsed, unresponsive' }, CASE_MIX, WINDOW);
    assert.equal(r.value.priority, 'P1');
    assert.equal(r.confidence, null);
  });
});
