/**
 * dispatch — unit recommendation. docs/08 §3.4.
 *
 * PURE. Multi-criteria scoring with an explicit, PUBLISHED weight vector (the jurisdiction
 * pack's dispatch.weights). Not a black box: a dispatcher who cannot see why a unit was
 * recommended will override it, and a recommendation that is always overridden is worse
 * than none.
 *
 *   score(u) = w_travel · travel(u) + w_capability · capability(u)
 *            + w_coverage · (1 − coverageCost(u)) + w_crew · crew(u) + w_equity · equity(u)
 *
 * each component on 0..1, higher is better. The rationale records every component, its
 * weight and what it is made of, and is stored on the assignment FOREVER — six months
 * later "why was that unit sent" has an answer.
 *
 * Capability is a HARD filter first (a BLS unit is never offered a cardiac arrest that
 * needs ALS), then a graded preference among the qualifying set.
 *
 * ── Honest gaps, stated in every result ─────────────────────────────────────────
 * Coverage cost is a PROXY until engines/coverage.js (MEXCLP, Phase 6.4) exists: the
 * demand of the unit's current zone for this hour of week, divided by how many other
 * available units could still cover it. Equity is a visible zero until engines/equity.js
 * (Phase 6.6) computes the adjustment. Neither is hidden.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'weighted-multicriteria-v1';

/** Preference rank → capability component. The unit kinds a call wants, in order. */
const PREFERENCE_SCORE = [1, 0.85, 0.7, 0.55];
const UNLISTED_SCORE = 0.4;

/**
 * The requirement for an incident: required capabilities (hard) and preferred unit
 * kinds (graded). A P1 of a kind that does not demand ALS still PREFERS it.
 *
 * @param {{ kind: string, priority: string }} incident
 * @param {Record<string, { required: string[], preferred: string[] }>} table  CAPABILITY_REQUIREMENTS
 */
export function requirementFor(incident, table) {
  const base = table[incident.kind] ?? table.medical_general ?? { required: [], preferred: [] };
  const preferred = [...base.preferred];
  const notes = [];
  if (incident.priority === 'P1' && !base.required.includes('als') && incident.kind !== 'non_emergency') {
    const i = preferred.indexOf('ALS');
    if (i !== 0) {
      if (i > 0) preferred.splice(i, 1);
      preferred.unshift('ALS');
      notes.push('P1 — advanced life support preferred');
    }
  }
  return { kind: incident.kind, required: [...base.required], preferred, notes };
}

/**
 * Hard filter. Returns null when the unit qualifies, else the reason it does not.
 * @param {{ kind: string, capabilities: string[], status: string }} unit
 * @param {ReturnType<typeof requirementFor>} req
 * @param {{ nonPrimaryKinds: string[] }} rules
 */
export function exclusionReason(unit, req, rules) {
  if (unit.status !== 'available' && unit.status !== 'standby') return `${unit.status.replace(/_/g, ' ')}`;
  const missing = req.required.filter((c) => !unit.capabilities.includes(c));
  if (missing.length) return `lacks ${missing.join(', ')}`;
  if (rules.nonPrimaryKinds.includes(unit.kind) && !req.preferred.includes(unit.kind)) {
    return `${unit.kind} is not a primary response asset for ${req.kind.replace(/_/g, ' ')}`;
  }
  return null;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Score and rank.
 *
 * @param {object} p
 * @param {{ ref: string, kind: string, priority: string }} p.incident
 * @param {ReturnType<typeof requirementFor>} p.requirement
 * @param {Array<{
 *   ref: string, callsign: string, kind: string, agencyCode: string, capabilities: string[],
 *   status: string, straightM: number,
 *   travel: object,          // an eta EngineResult (value.seconds, confidence, method…)
 *   arrivalSec: number,      // now → at the entrance, including acknowledge + turnout
 *   jobsToday: number, shiftHours: number|null,
 *   othersNearby: number,    // other available units within the coverage radius
 *   zoneDemandIndex: number, // demand of the unit's zone this hour vs the emirate, 0..2
 * }>} p.candidates
 * @param {Record<string, number>} p.weights
 * @param {{ nonPrimaryKinds: string[] }} p.rules
 * @param {{ from: string, to: string }} p.window
 * @param {string} [p.calibrationAsOf]
 */
export function recommend({ incident, requirement, candidates, weights, rules, window }) {
  const qualifying = [];
  const excluded = [];
  for (const c of candidates) {
    const reason = exclusionReason(c, requirement, rules);
    if (reason) excluded.push({ unitRef: c.ref, callsign: c.callsign, kind: c.kind, straightM: Math.round(c.straightM), reason });
    else if (c.travel?.value?.seconds == null) excluded.push({ unitRef: c.ref, callsign: c.callsign, kind: c.kind, straightM: Math.round(c.straightM), reason: 'no travel prediction' });
    else qualifying.push(c);
  }

  const inputs = [
    { source: 'units', rows: candidates.length },
    { source: 'mv_eta_calibration', rows: candidates[0]?.travel?.inputs?.[0]?.rows ?? 0 },
    { source: 'mv_zone_hour_of_week', rows: candidates.length },
    { source: 'assignments (today)', rows: candidates.reduce((s, c) => s + (c.jobsToday ?? 0), 0) },
  ];

  if (!qualifying.length) {
    return {
      ...insufficientData({
        method: METHOD, window, inputs,
        reason: candidates.length
          ? `None of the ${candidates.length} nearest units meets the requirement (${requirement.required.join(', ') || 'none'})`
          : 'No available unit within reach',
      }),
      value: { recommendations: [], excluded, requirement, weights },
    };
  }

  const fastest = Math.min(...qualifying.map((c) => c.arrivalSec));

  const recommendations = qualifying.map((c) => {
    const rank = requirement.preferred.indexOf(c.kind);
    const components = {
      travel: clamp01(fastest / Math.max(1, c.arrivalSec)),
      capability: rank === -1 ? UNLISTED_SCORE : (PREFERENCE_SCORE[rank] ?? PREFERENCE_SCORE.at(-1)),
      coverage: 1 - coverageCost(c),
      crew: crewReadiness(c),
      equity: 0,
    };
    const factors = [
      {
        key: 'travel', name: 'Predicted arrival', weight: weights.travel, score: r3(components.travel),
        contribution: r3(weights.travel * components.travel),
        detail: `${fmtSec(c.arrivalSec)} to the entrance (${fmtSec(c.travel.value.seconds)} driving, ${(c.travel.value.distanceM / 1000).toFixed(1)} km`
          + `${c.trafficDelaySec > 0 ? `, +${fmtSec(c.trafficDelaySec)} traffic on its route` : ''})`
          + (c.arrivalSec === fastest ? ' — fastest qualifying' : ` — ${fmtSec(c.arrivalSec - fastest)} slower than the fastest`),
      },
      {
        key: 'capability', name: 'Capability match', weight: weights.capability, score: r3(components.capability),
        contribution: r3(weights.capability * components.capability),
        detail: (rank === -1
          ? `${c.kind} qualifies but is not a preferred kind (${requirement.preferred.join(' › ')})`
          : `${c.kind} is preference ${rank + 1} of ${requirement.preferred.length} (${requirement.preferred.join(' › ')})`)
          + (transports(c, rules) ? '' : ' — reaches the patient, cannot transport'),
      },
      {
        key: 'coverage', name: 'Coverage cost', weight: weights.coverage, score: r3(components.coverage),
        contribution: r3(weights.coverage * components.coverage),
        detail: `${c.othersNearby} other available unit${c.othersNearby === 1 ? '' : 's'} within cover of its current area; `
          + `area demand ${c.zoneDemandIndex.toFixed(2)}× the emirate this hour (proxy — MEXCLP lands in Phase 6.4)`,
      },
      {
        key: 'crew', name: 'Crew readiness', weight: weights.crew, score: r3(components.crew),
        contribution: r3(weights.crew * components.crew),
        detail: `${c.jobsToday} job${c.jobsToday === 1 ? '' : 's'} today`
          + (c.shiftHours === null ? '; shift start not recorded' : `; ${c.shiftHours.toFixed(1)} h on shift`),
      },
      {
        key: 'equity', name: 'Equity adjustment', weight: weights.equity, score: 0, contribution: 0,
        detail: 'Not applied — the equity monitor (Phase 6.6) has not computed an adjustment',
      },
    ];
    const score = r3(factors.reduce((s, f) => s + f.contribution, 0));

    return {
      unitRef: c.ref,
      callsign: c.callsign,
      kind: c.kind,
      agencyCode: c.agencyCode,
      status: c.status,
      distanceM: c.travel.value.distanceM,
      straightM: Math.round(c.straightM),
      travelSec: c.travel.value.seconds,
      arrivalSec: c.arrivalSec,
      trafficDelaySec: c.trafficDelaySec ?? 0,
      etaSec: c.arrivalSec,
      etaInterval: { p25: c.travel.value.p25, p75: c.travel.value.p75 },
      etaConfidence: c.travel.confidence,
      etaMethod: c.travel.method,
      canTransport: transports(c, rules),
      rationale: {
        score,
        factors,
        capabilityMatch: requirement.required.length ? requirement.required : ['no hard requirement'],
        coverageCostPct: Math.round(coverageCost(c) * 100),
        crewHoursOnShift: c.shiftHours,
        equityAdjustment: 0,
        travel: { method: c.travel.method, confidence: c.travel.confidence, factors: c.travel.factors, caveats: c.travel.caveats },
      },
    };
  })
    // Score, then arrival as the tie-break: two equal scores send the nearer unit.
    .sort((a, b) => b.rationale.score - a.rationale.score || a.arrivalSec - b.arrivalSec)
    .map((rec, i) => ({ ...rec, rank: i + 1 }));

  // Confidence that #1 really is better than #2 on arrival — the ETA intervals, not
  // the score, because the score's weights are a policy and not an uncertainty.
  const confidence = recommendations.length > 1
    ? separation(recommendations[0], recommendations[1])
    : recommendations[0].etaConfidence;

  const caveats = [
    'Coverage cost is a neighbour-count proxy until the MEXCLP coverage engine (Phase 6.4)',
    'Equity adjustment is not yet computed (Phase 6.6) and contributes zero',
  ];
  if (recommendations.some((r) => r.etaMethod.includes('straight-line'))) {
    caveats.unshift('Road routing unavailable for some units — straight-line distances used');
  }
  if (requirement.notes.length) caveats.push(...requirement.notes);

  // The fastest responder is not always a transport. Say so, and name the first that is.
  let transport = null;
  if (!recommendations[0].canTransport) {
    const first = recommendations.find((r) => r.canTransport);
    transport = first ? { unitRef: first.unitRef, rank: first.rank, arrivalSec: first.arrivalSec } : null;
    caveats.unshift(first
      ? `${recommendations[0].unitRef} (${recommendations[0].kind}) reaches the patient first but cannot transport — ${first.unitRef} is the first transporting unit`
      : `${recommendations[0].unitRef} (${recommendations[0].kind}) cannot transport, and no transporting unit qualified`);
  }

  return engineResult({
    value: { recommendations, excluded, requirement, weights, transport },
    unit: 'score',
    confidence: confidence === null ? null : r3(confidence),
    window,
    inputs,
    factors: Object.entries(weights).map(([name, w]) => ({ name, contribution: w, direction: 'up', detail: 'published weight' })),
    method: METHOD,
    caveats,
    meta: { incidentRef: incident.ref },
  });
}

const transports = (unit, rules) => !(rules.nonTransportKinds ?? []).includes(unit.kind);

/**
 * Proxy coverage cost, 0..1: taking a unit out of a busy area nobody else covers is
 * expensive; taking it out of a quiet area with three neighbours is nearly free.
 */
export function coverageCost({ othersNearby, zoneDemandIndex }) {
  return clamp01((Math.min(2, Math.max(0, zoneDemandIndex)) / 2) / (1 + Math.max(0, othersNearby)));
}

/** 1 for a fresh crew; damped by jobs run today and, when recorded, hours on shift. */
export function crewReadiness({ jobsToday, shiftHours }) {
  const jobs = Math.min(1, (jobsToday ?? 0) / 10) * 0.6;
  const hours = shiftHours === null || shiftHours === undefined ? 0 : Math.min(1, Math.max(0, shiftHours - 8) / 4) * 0.4;
  return clamp01(1 - jobs - hours);
}

/**
 * P(arrival₁ < arrival₂), treating each prediction as normal with σ from its IQR
 * (IQR ≈ 1.349σ). Derived from the calibration spread, not asserted.
 */
function separation(a, b) {
  const sd = (r) => Math.max(1, (r.etaInterval.p75 - r.etaInterval.p25) / 1.349);
  const z = (b.arrivalSec - a.arrivalSec) / Math.sqrt(sd(a) ** 2 + sd(b) ** 2);
  return clamp01(normalCdf(z));
}

function normalCdf(z) {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function fmtSec(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
