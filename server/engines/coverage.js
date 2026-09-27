/**
 * coverage — fleet positioning. docs/08 §3.3.
 *
 * PURE. The plan specifies MEXCLP with a greedy-exchange relocation solve. This raw pass
 * implements the MEXCLP expected-coverage MATH in full (busy-probability-weighted,
 * multi-unit) but simplifies the search: rather than a 1-opt exchange over every
 * candidate site, it evaluates only the actually-idle units already at stations or on
 * standby, and reports the single relocation with the largest coverage gain. That is
 * "raw" by design — the objective is real, the solver is a greedy first pass, and the
 * gap this leaves against the full plan is named in the caveats rather than hidden.
 *
 * Coverage of a demand point: 1 − Π(1 − q)^x, x = units within target ETA, q = a unit's
 * busy probability. ETA between two points is estimated from straight-line distance and
 * an assumed road speed — the real eta.js/OSRM path is not re-run per candidate here,
 * which is exactly the kind of "too technical for this pass" tradeoff this build is
 * deliberately making.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'mexclp-greedy-v1';
const EARTH_M = 6_371_000;
const ROAD_SPEED_MPS = 11.1; // ≈ 40 km/h effective, arterial-mixed Dubai average

function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function etaSec(a, b) {
  return (haversineM(a, b) * 1.34) / ROAD_SPEED_MPS; // ×1.34 detour factor, same as eta.js's no-routing fallback
}

/**
 * @param {Array<{unitId,unitRef,lng,lat,busyProbability,relocatable}>} units
 * @param {Array<{zoneId,zoneRef,lng,lat,demandWeight}>} demandPoints
 * @param {number} targetSec
 * @param {{from:string,to:string}} window
 */
export function computeCoverage({ units, demandPoints, targetSec }, window) {
  if (!units?.length || !demandPoints?.length) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'units', rows: units?.length ?? 0 }, { source: 'demand_forecast', rows: demandPoints?.length ?? 0 }],
      minimum: 1, actual: 0,
    });
  }

  const expectedCoverage = (fleet) => {
    let covered = 0, totalDemand = 0;
    const perZone = [];
    for (const d of demandPoints) {
      const inRange = fleet.filter((u) => etaSec(u, d) <= targetSec);
      const uncovered = inRange.reduce((p, u) => p * (1 - (1 - u.busyProbability)), 1);
      const coverageFrac = 1 - uncovered;
      covered += d.demandWeight * coverageFrac;
      totalDemand += d.demandWeight;
      perZone.push({ zoneId: d.zoneId, zoneRef: d.zoneRef, coverageFrac: +coverageFrac.toFixed(3), unitsInRange: inRange.length });
    }
    return { pct: totalDemand > 0 ? (100 * covered) / totalDemand : 0, perZone };
  };

  const current = expectedCoverage(units);

  // Greedy: try relocating each relocatable, currently-idle unit to each gap zone's
  // centroid, keep the single move with the largest coverage gain.
  const gaps = [...current.perZone].sort((a, b) => a.coverageFrac - b.coverageFrac).slice(0, 5);
  let best = null;
  for (const u of units.filter((x) => x.relocatable)) {
    for (const gap of gaps) {
      const target = demandPoints.find((d) => d.zoneId === gap.zoneId);
      if (!target) continue;
      const moved = units.map((x) => (x.unitId === u.unitId ? { ...x, lng: target.lng, lat: target.lat } : x));
      const after = expectedCoverage(moved);
      const gain = after.pct - current.pct;
      const cost = etaSec(u, target) / 60;
      if (!best || gain - cost * 0.05 > best.gain - best.costMin * 0.05) {
        best = { unitRef: u.unitRef, toZoneRef: target.zoneRef, gain: +gain.toFixed(2), costMin: +cost.toFixed(1), resultingPct: +after.pct.toFixed(1) };
      }
    }
  }

  const optimalPct = best ? best.resultingPct : current.pct;
  const gapPp = +(optimalPct - current.pct).toFixed(1);

  return engineResult({
    value: {
      currentPct: +current.pct.toFixed(1), optimalPct: +optimalPct.toFixed(1), gapPp,
      perZone: current.perZone, recommendedMove: gapPp > 0.5 ? best : null,
    },
    unit: 'percent',
    confidence: null, // this is an optimisation objective, not a measurement — no confidence to report
    window,
    inputs: [{ source: 'units', rows: units.length }, { source: 'demand_forecast', rows: demandPoints.length }],
    factors: current.perZone
      .filter((z) => z.coverageFrac < 0.7)
      .map((z) => ({ name: z.zoneRef, contribution: 1 - z.coverageFrac, direction: 'down', detail: `${z.unitsInRange} unit(s) within target` })),
    method: METHOD,
    caveats: [
      'relocation search evaluates only currently idle/standby units against the five lowest-coverage zones, not a full 1-opt exchange',
      'ETA is a straight-line × 1.34 estimate, not a re-run of engines/eta.js per candidate',
    ],
    meta: { targetSec, roadSpeedMps: ROAD_SPEED_MPS },
  });
}
