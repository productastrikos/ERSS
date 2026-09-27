/**
 * advisory — the action-engine detectors. docs/08 §4.
 *
 * PURE. Each function here takes an already-computed engine result (anomaly, equity,
 * coverage, preempt) and decides whether it clears the bar for an advisory, returning a
 * plain candidate object shaped for `services/advisories.js` to upsert — never touching
 * the database itself.
 *
 * Only four of the fourteen detectors in the docs table are wired live in this pass
 * (anomaly, equity, coverage gap, pre-empt shortfall) — the rest (response breach, SLA
 * breach, hospital load, data quality, risk-terrain shift, crowd risk, vertical access,
 * weather covariate, multi-agency correlation) already exist as historical findings from
 * `npm run seed:derived`, which computes them the same way. Wiring the remaining
 * detectors live is additive, not structural — the shape is identical.
 */

export const DETECTORS = [
  { key: 'coverage-gap-v1', name: 'Coverage gap', severity: 'warning', routedTo: 'DCAS duty officer' },
  { key: 'demand-surge-v1', name: 'Demand surge', severity: 'alert', routedTo: 'DCAS duty officer' },
  { key: 'ewma-robust-z-v1', name: 'Anomaly', severity: 'alert', routedTo: 'Category owner' },
  { key: 'distance-controlled-p90-v1', name: 'Equity flag', severity: 'warning', routedTo: 'Service lead' },
  { key: 'measured-preempt-impact-v1', name: 'Pre-empt shortfall', severity: 'alert', routedTo: 'RTA' },
];

const dedupeKey = (detector, zoneRef) => `${detector}:${zoneRef ?? 'all'}`;

/** From engines/anomaly.js's result, when sustained. */
export function anomalyCandidate(result) {
  if (!result?.value || !result.value.sustained) return null;
  const { zoneRef, zoneId, seriesName, latestValue, latestZ, median: med } = result.value;
  return {
    severity: Math.abs(latestZ) > 5 ? 'alert' : 'warning',
    category: 'anomaly',
    detector: 'ewma-robust-z-v1',
    title: `${seriesName} in ${zoneRef ?? 'the emirate'} is ${latestZ > 0 ? 'above' : 'below'} its seasonal baseline`,
    body: `${seriesName} is now ${latestValue}, against a baseline median of ${med.toFixed?.(1) ?? med} — a sustained z-score of ${latestZ.toFixed(2)} over the last two buckets.`,
    evidence: result,
    zoneIds: zoneId ? [zoneId] : [],
    recommendedAction: 'Review staffing and standby positions in this zone for the current shift.',
    agencyCode: 'DCAS',
    baselineValue: med, targetValue: med,
    dedupeKey: dedupeKey('ewma-robust-z-v1', zoneRef),
  };
}

/** From engines/equity.js's result, one candidate per flagged zone. */
export function equityCandidates(result) {
  if (!result?.value?.zones) return [];
  return result.value.zones.filter((z) => z.flagged).map((z) => ({
    severity: 'warning',
    category: 'equity',
    detector: 'distance-controlled-p90-v1',
    title: `${z.zoneName} responds slower than distance to the nearest station explains`,
    body: `${z.zoneName}'s p90 response time is ${Math.round(z.p90ResponseSec)}s, ${z.excessOverEmiratePct.toFixed(0)}% above the emirate p90 — ${Math.round(z.residualSec)}s of that is not explained by its ${(z.distanceToStationM / 1000).toFixed(1)} km distance to the nearest station.`,
    evidence: { method: result.method, window: result.window, inputs: result.inputs, factors: result.factors, confidence: result.confidence, zone: z },
    zoneIds: [z.zoneId],
    recommendedAction: 'Review dispatch patterns and standby coverage for this zone specifically.',
    agencyCode: 'DCAS',
    baselineValue: result.value.emirateP90Sec, targetValue: z.expectedP90Sec,
    dedupeKey: dedupeKey('distance-controlled-p90-v1', z.zoneRef),
  }));
}

/** From engines/coverage.js's result. */
export function coverageGapCandidate(result) {
  if (!result?.value || result.value.gapPp <= 8) return null;
  const { currentPct, optimalPct, gapPp, recommendedMove } = result.value;
  return {
    severity: 'warning',
    category: 'coverage',
    detector: 'coverage-gap-v1',
    title: `Expected coverage is ${gapPp.toFixed(1)} points below what a single relocation would buy`,
    body: `Current expected coverage is ${currentPct.toFixed(1)}%, against ${optimalPct.toFixed(1)}% achievable.${recommendedMove ? ` Moving ${recommendedMove.unitRef} to ${recommendedMove.toZoneRef} (${recommendedMove.costMin.toFixed(1)} min) would recover ${recommendedMove.gain.toFixed(1)} points.` : ''}`,
    evidence: result,
    zoneIds: [],
    recommendedAction: recommendedMove ? `Relocate ${recommendedMove.unitRef} to ${recommendedMove.toZoneRef}.` : 'Review fleet distribution against forecast demand.',
    agencyCode: 'DCAS',
    baselineValue: currentPct, targetValue: optimalPct,
    dedupeKey: dedupeKey('coverage-gap-v1', null),
  };
}

/** From engines/preempt.js's result. */
export function preemptShortfallCandidate(result) {
  if (!result?.value || !result.value.shortfall) return null;
  const { requests, pctOfTotal, meanSavedSec, grantPct } = result.value;
  return {
    severity: 'alert',
    category: 'preempt',
    detector: 'measured-preempt-impact-v1',
    title: `Pre-empt events${pctOfTotal != null ? ` — ${pctOfTotal.toFixed(2)}% of assignments` : ''} are affecting average response time by ${meanSavedSec.toFixed(0)}s`,
    body: `${requests.toLocaleString()} pre-empt requests were logged with a ${grantPct.toFixed(0)}% grant rate and a mean measured saving of ${meanSavedSec.toFixed(0)}s per granted request. This reproduces the Concept Note's UP-112 worked example over Dubai's own data.`,
    evidence: result,
    zoneIds: [],
    recommendedAction: 'Issue a dispatch, acknowledge and en-route procedural advisory to close the gap.',
    agencyCode: 'RTA',
    baselineValue: meanSavedSec, targetValue: null,
    dedupeKey: dedupeKey('measured-preempt-impact-v1', null),
  };
}
