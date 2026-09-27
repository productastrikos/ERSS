/**
 * equity — bias-aware dispatch check. docs/08 §3.7.
 *
 * PURE. A monitor, not an objective a dispatch algorithm silently optimises toward — a
 * fairness correction nobody can see is itself a governance problem, so this engine only
 * ever produces a visible, explained flag.
 *
 * Method, deliberately simple: fit a single straight line of p90 response time against
 * distance to the nearest station across all zones (least squares — geography really
 * does predict response time, and pretending otherwise would produce false flags on
 * every desert zone). A zone whose actual p90 sits far above what that line predicts,
 * AND above the emirate p90 by more than the threshold, is flagged as a PROCESS finding
 * ("dispatched worse than distance explains") rather than a geography finding.
 */

import { engineResult, insufficientData, confidenceFromSample } from '../lib/result.js';

export const METHOD = 'distance-controlled-p90-v1';
export const MIN_ZONES = 5;
export const MIN_SAMPLE_N = 30;
export const FLAG_THRESHOLD_PCT = 20;
export const FLAG_MIN_RESIDUAL_SEC = 60;

/** Ordinary least squares, y = a + b·x. */
function fitLine(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  const b = den === 0 ? 0 : num / den;
  const a = my - b * mx;
  return { a, b };
}

/**
 * @param {Array<{zoneId,zoneRef,zoneName,p90ResponseSec,sampleN,distanceToStationM}>} zones
 * @param {number} emirateP90Sec
 * @param {{from:string,to:string}} window
 */
export function assessEquity(zones, emirateP90Sec, window) {
  const usable = (zones ?? []).filter((z) => (z.sampleN ?? 0) >= MIN_SAMPLE_N && Number.isFinite(z.distanceToStationM));
  if (usable.length < MIN_ZONES || !Number.isFinite(emirateP90Sec)) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'v_zone_daily', rows: zones?.length ?? 0 }],
      minimum: MIN_ZONES, actual: usable.length,
    });
  }

  const { a, b } = fitLine(usable.map((z) => ({ x: z.distanceToStationM, y: z.p90ResponseSec })));

  const rows = usable.map((z) => {
    const expected = a + b * z.distanceToStationM;
    const residualSec = z.p90ResponseSec - expected;
    const excessOverEmiratePct = 100 * (z.p90ResponseSec - emirateP90Sec) / emirateP90Sec;
    // Flagged only when BOTH the zone is meaningfully worse than the emirate p90 AND
    // distance-to-station does not account for it — a far zone that is merely far is a
    // planning input, not a dispatch-process finding.
    const flagged = excessOverEmiratePct > FLAG_THRESHOLD_PCT && residualSec > FLAG_MIN_RESIDUAL_SEC;
    return {
      zoneId: z.zoneId, zoneRef: z.zoneRef, zoneName: z.zoneName,
      p90ResponseSec: z.p90ResponseSec, distanceToStationM: z.distanceToStationM,
      expectedP90Sec: +expected.toFixed(1), residualSec: +residualSec.toFixed(1),
      excessOverEmiratePct: +excessOverEmiratePct.toFixed(1),
      sampleN: z.sampleN, flagged,
      classification: !flagged ? 'within_expected' : residualSec > 60 ? 'process_flag' : 'geography_explained',
    };
  });

  const flaggedZones = rows.filter((r) => r.flagged);

  return engineResult({
    value: { zones: rows, fit: { intercept: +a.toFixed(1), slopePerMetre: +b.toFixed(4) }, emirateP90Sec },
    unit: 'seconds',
    confidence: confidenceFromSample(usable.length, 30),
    window,
    inputs: [{ source: 'v_zone_daily', rows: usable.length }],
    factors: [
      { name: 'Distance to nearest station', contribution: Math.abs(b) * 1000, direction: b > 0 ? 'up' : 'down', detail: `${(b * 1000).toFixed(1)} s per km, fitted across ${usable.length} zones` },
    ],
    method: METHOD,
    caveats: flaggedZones.length ? [] : ['no zone exceeds the emirate p90 by more than distance already explains'],
    meta: { minSampleN: MIN_SAMPLE_N, flagThresholdPct: FLAG_THRESHOLD_PCT, flaggedCount: flaggedZones.length },
  });
}
