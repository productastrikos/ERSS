/**
 * crowd — density and stampede-risk. docs/08 §3.9.
 *
 * PURE. Uses the published Fruin level-of-service bands rather than an invented scale,
 * because a defensible threshold matters more here than anywhere else in the platform —
 * this is the one advisory category with "emergency" severity.
 *
 * This raw pass implements density classification, choke-point detection and a
 * lead-time projection. The building-twin evacuation queueing model (docs/08 §3.9,
 * "Evacuation") is NOT implemented here — it needs the BMS floor-plate data Phase 9
 * wires in, and is named as out of scope rather than approximated.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'fruin-los-v1';

/** Fruin pedestrian level-of-service, persons per m². */
export const FRUIN_BANDS = [
  { band: 'A', max: 0.08, label: 'Free flow' },
  { band: 'B', max: 0.27, label: 'Unimpeded' },
  { band: 'C', max: 0.43, label: 'Impeded' },
  { band: 'D', max: 0.72, label: 'Constrained' },
  { band: 'E', max: 1.08, label: 'Congested' },
  { band: 'F', max: Infinity, label: 'Crush risk' },
];

export function classifyDensity(personsPerM2) {
  return FRUIN_BANDS.find((b) => personsPerM2 <= b.max) ?? FRUIN_BANDS.at(-1);
}

/** A choke point: inflow exceeds the edge's modelled walking capacity. */
export function chokePoint({ widthM, inflowPersonsPerSec }) {
  const capacity = widthM * 1.3; // persons/m/s, Fruin's flat-out figure
  return { capacityPersonsPerSec: +capacity.toFixed(2), exceeded: inflowPersonsPerSec > capacity, marginPct: +(100 * (inflowPersonsPerSec - capacity) / capacity).toFixed(1) };
}

/**
 * Time until LoS F is reached, by linear extrapolation of the current density trend.
 * Returns null (never a fabricated countdown) when density is falling or flat.
 */
export function stampedeLeadTimeMin(currentDensity, densityPerMinTrend) {
  if (!(densityPerMinTrend > 0)) return null;
  const losF = FRUIN_BANDS.find((b) => b.band === 'E').max; // the threshold INTO F
  if (currentDensity >= losF) return 0;
  return +((losF - currentDensity) / densityPerMinTrend).toFixed(1);
}

/**
 * @param {{ zoneId, zoneRef, areaM2, footfall, footfallTrendPerMin,
 *           edges?: Array<{ ref: string, widthM: number, inflowPersonsPerSec: number }> }} spec
 * @param {{from:string,to:string}} window
 */
export function assessCrowd(spec, window) {
  const { zoneId, zoneRef, areaM2, footfall, footfallTrendPerMin = 0, edges = [] } = spec ?? {};
  if (!areaM2 || footfall == null) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'agency_feeds:footfall', rows: footfall != null ? 1 : 0 }],
      minimum: 1, actual: 0,
    });
  }

  const density = footfall / areaM2;
  const densityTrend = footfallTrendPerMin / areaM2;
  const los = classifyDensity(density);
  const leadTimeMin = stampedeLeadTimeMin(density, densityTrend);
  const chokePoints = edges.map((e) => ({ ref: e.ref, ...chokePoint(e) }));
  const anyChoke = chokePoints.some((c) => c.exceeded);

  const emergency = los.band === 'F' || (leadTimeMin !== null && leadTimeMin <= 15);

  const caveats = ['evacuation clearance-time modelling over the building twin is out of scope for this pass'];
  if (leadTimeMin === null) caveats.push('density is not currently trending toward LoS F — no lead time to report');

  return engineResult({
    value: {
      zoneId, zoneRef, densityPersonsPerM2: +density.toFixed(3), los: los.band, losLabel: los.label,
      leadTimeMin, chokePoints, emergency,
    },
    unit: 'persons/m²',
    confidence: null,
    window,
    inputs: [{ source: 'agency_feeds:footfall', rows: 1 }],
    factors: [
      { name: 'Pedestrian density', contribution: density, direction: densityTrend >= 0 ? 'up' : 'down', detail: `${los.band} — ${los.label}` },
      ...(anyChoke ? [{ name: 'Choke point exceeding capacity', contribution: 1, direction: 'up', detail: chokePoints.filter((c) => c.exceeded).map((c) => c.ref).join(', ') }] : []),
    ],
    method: METHOD,
    caveats,
    meta: { emergency },
  });
}
