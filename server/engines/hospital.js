/**
 * hospital — destination selection. docs/08 §3.5.
 *
 * PURE. Filter by the capability the presentation requires, then score on predicted
 * transport time, ED occupancy, current inbound and diversion. Every destination carries
 * its reasoning and the clinical justification for the requirement — "a suspected STEMI
 * needs a cath lab; Rashid is the nearest with one and is not on diversion" rather than a
 * bare list.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'capability-filter-weighted-v1';

export const WEIGHTS = { transport: 0.6, load: 0.3, inbound: 0.1 };

/** Presentation → the capability it needs, and why. Kinds not listed need no specialist
 *  capability and go to the nearest suitable ED. */
export const CLINICAL_REQUIREMENTS = {
  cardiac_arrest: { capability: 'cath_lab', why: 'Post-resuscitation care and primary PCI need a cath lab' },
  cardiac:        { capability: 'cath_lab', why: 'A suspected STEMI needs primary PCI capability' },
  stroke:         { capability: 'stroke', why: 'Thrombolysis within 4.5 h, or thrombectomy, needs a stroke unit' },
  paediatric:     { capability: 'paeds', why: 'A child is best received by a paediatric emergency department' },
  obstetric:      { capability: 'obstetric', why: 'Labour and antepartum bleeding need obstetric cover' },
  fire_related:   { capability: 'burns', why: 'Burns and smoke inhalation need a burns unit' },
};

/** Major trauma — the trauma requirement depends on priority, not only kind. */
const TRAUMA_KINDS = new Set(['rta', 'trauma_fall', 'workplace_injury']);

export function requirementFor({ kind, priority }) {
  if (TRAUMA_KINDS.has(kind) && (priority === 'P1' || priority === 'P2')) {
    return { capability: 'trauma_l1', why: 'Major trauma is taken to a Level 1 trauma centre' };
  }
  return CLINICAL_REQUIREMENTS[kind] ?? null;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const mins = (s) => `${Math.round(s / 60)} min`;

/**
 * @param {object} p
 * @param {{ ref: string, kind: string, priority: string }} p.incident
 * @param {Array<{ ref: string, name: string, capabilities: string[], edBeds: number, edOccupied: number,
 *                 onDiversion: boolean, inbound: number, transport: object }>} p.hospitals
 * @param {{ from: string, to: string }} p.window
 */
export function rankHospitals({ incident, hospitals, window }) {
  const req = requirementFor(incident);
  const inputs = [
    { source: 'hospitals', rows: hospitals.length },
    { source: 'v_hospital_load', rows: hospitals.length },
    { source: 'mv_eta_calibration', rows: hospitals[0]?.transport?.inputs?.[0]?.rows ?? 0 },
  ];

  const withTime = hospitals.filter((h) => h.transport?.value?.seconds != null);
  if (!withTime.length) {
    return insufficientData({ method: METHOD, window, inputs, reason: 'No transport time could be predicted to any hospital' });
  }

  const capable = req ? withTime.filter((h) => h.capabilities.includes(req.capability)) : withTime;
  const caveats = [];
  let pool = capable;
  if (req && !capable.length) {
    pool = withTime;
    caveats.push(`No hospital with ${req.capability} — ranking every ED instead`);
  }
  const open = pool.filter((h) => !h.onDiversion);
  if (!open.length) caveats.push('Every suitable hospital is on diversion — ranking them anyway');
  const ranked = open.length ? open : pool;

  const fastest = Math.min(...ranked.map((h) => h.transport.value.seconds));

  const items = ranked.map((h) => {
    const occupancy = h.edBeds ? h.edOccupied / h.edBeds : 1;
    const components = {
      transport: Math.min(1, fastest / Math.max(1, h.transport.value.seconds)),
      load: Math.max(0, 1 - occupancy),
      inbound: 1 / (1 + h.inbound),
    };
    const score = r3(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * components[k], 0));
    const reasoning = [
      req && h.capabilities.includes(req.capability) ? `${req.why}; ${h.name} has ${req.capability.replace('_', ' ')}` : null,
      h.transport.value.seconds === fastest ? `the quickest of those at ${mins(h.transport.value.seconds)}` : `${mins(h.transport.value.seconds)} away`,
      `ED ${Math.round(occupancy * 100)}% occupied`,
      h.inbound ? `${h.inbound} already inbound` : 'nothing else inbound',
      h.onDiversion ? 'ON DIVERSION' : null,
    ].filter(Boolean).join('; ');
    return {
      ref: h.ref,
      name: h.name,
      capabilities: h.capabilities,
      etaSec: h.transport.value.seconds,
      etaConfidence: h.transport.confidence,
      distanceM: h.transport.value.distanceM,
      edLoadPct: Math.round(occupancy * 100),
      inbound: h.inbound,
      onDiversion: h.onDiversion,
      meetsRequirement: req ? h.capabilities.includes(req.capability) : true,
      score,
      components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, r3(v)])),
      reasoning: reasoning.charAt(0).toUpperCase() + reasoning.slice(1),
    };
  }).sort((a, b) => b.score - a.score || a.etaSec - b.etaSec);

  const excluded = [
    ...(req ? withTime.filter((h) => !h.capabilities.includes(req.capability) && capable.length)
      .map((h) => ({ ref: h.ref, name: h.name, reason: `no ${req.capability.replace('_', ' ')}` })) : []),
    ...(open.length ? pool.filter((h) => h.onDiversion).map((h) => ({ ref: h.ref, name: h.name, reason: 'on diversion' })) : []),
  ];

  return engineResult({
    value: { hospitals: items, excluded, requirement: req },
    unit: 'score',
    // The transport-time confidence of the recommended destination — the score's weights
    // are policy, not uncertainty.
    confidence: items[0]?.etaConfidence ?? null,
    window,
    inputs,
    factors: Object.entries(WEIGHTS).map(([name, w]) => ({ name, contribution: w, direction: 'up', detail: 'published weight' })),
    method: METHOD,
    caveats,
  });
}
