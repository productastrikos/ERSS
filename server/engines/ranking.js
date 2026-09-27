/**
 * ranking — composite scoring. docs/08 §2.3, docs/06 §5.
 *
 * PURE. Weighted sum of min–max normalised components, direction-corrected, computed
 * within a peer group (same zone level, same class — a desert zone is never ranked
 * against Downtown). Deliberately simple: a ranking a district commander cannot
 * recompute by hand will not be trusted, and an untrusted ranking changes no behaviour.
 *
 *   component_norm = (value − min) / (max − min)        if higher_better
 *                    1 − (value − min) / (max − min)    if lower_better
 *   composite      = Σ weight_i × component_norm_i × 100
 */

import { engineResult, confidenceFromSample } from '../lib/result.js';

export const METHOD = 'weighted-minmax-v1';
export const MIN_SAMPLE_N = 30;

export const COMPONENT_DIRECTION = {
  avgResponseSec: 'lower_better',
  withinTargetPct: 'higher_better',
  unitAvailabilityPct: 'higher_better',
  eventClosurePct: 'higher_better',
  avgAcknowledgeSec: 'lower_better',
  preemptEventRate: 'higher_better',
};

export const COMPONENT_LABEL = {
  avgResponseSec: 'Average response time',
  withinTargetPct: 'Percentage within target',
  unitAvailabilityPct: 'Unit availability',
  eventClosurePct: 'Event closure rate',
  avgAcknowledgeSec: 'Acknowledge time',
  preemptEventRate: 'Pre-empt event rate',
};

// docs/06 §5 — the published defaults, the weights editor's starting sliders.
export const DEFAULT_WEIGHTS = {
  avgResponseSec: 0.30,
  withinTargetPct: 0.25,
  unitAvailabilityPct: 0.15,
  eventClosurePct: 0.12,
  avgAcknowledgeSec: 0.10,
  preemptEventRate: 0.08,
};

/** Sliders normalised to 100%, as the weights editor requires live. Unknown keys are dropped. */
export function normaliseWeights(weights) {
  const entries = Object.entries(weights).filter(([k, v]) => k in COMPONENT_DIRECTION && Number.isFinite(v) && v >= 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

const peerKey = (level, cls) => `${level}|${cls}`;

/** Min/max per component, over ranked (sample-sufficient) zones in the group only —
 *  so one zone too thin to trust does not distort everyone else's range. */
function peerRanges(rankableZones) {
  const ranges = {};
  for (const z of rankableZones) {
    const key = peerKey(z.level, z.class);
    ranges[key] ??= {};
    for (const [comp, val] of Object.entries(z.components)) {
      if (val === null || val === undefined) continue;
      const r = (ranges[key][comp] ??= { min: val, max: val });
      if (val < r.min) r.min = val;
      if (val > r.max) r.max = val;
    }
  }
  return ranges;
}

function normalise(value, direction, range) {
  if (value === null || value === undefined || !range) return null;
  if (range.max === range.min) return 0.5;   // no differentiation possible — neutral, not a fabricated edge
  const frac = (value - range.min) / (range.max - range.min);
  return direction === 'lower_better' ? 1 - frac : frac;
}

function composite(zone, weights, ranges) {
  const key = peerKey(zone.level, zone.class);
  const range = ranges[key] ?? {};
  const parts = [];
  let weightPresent = 0;
  for (const [comp, weight] of Object.entries(weights)) {
    const norm = normalise(zone.components[comp], COMPONENT_DIRECTION[comp], range[comp]);
    if (norm === null) continue;
    parts.push({ comp, weight, norm });
    weightPresent += weight;
  }
  // Re-normalise over the components this zone actually has data for, so a zone missing
  // one component (e.g. pre-empt rate, not yet measured in its area) is not penalised to
  // zero on it — it is scored on what is known, and the gap is named in the caveats.
  const score = weightPresent > 0
    ? parts.reduce((s, p) => s + (p.weight / weightPresent) * p.norm, 0) * 100
    : null;
  return { score: score === null ? null : +score.toFixed(1), parts, missingComponents: Object.keys(weights).filter((c) => !parts.some((p) => p.comp === c)) };
}

/**
 * Rank every zone within its peer group (level × class).
 *
 * @param {Array<{zoneId,zoneRef,zoneName,level,class,sampleN,components:object,prevRank?:number}>} zones
 * @param {object} weights   need not be normalised — normaliseWeights is applied here
 * @param {{from:string,to:string}} window
 * @param {number} [minSampleN]
 */
export function rankZones(zones, weights, window, minSampleN = MIN_SAMPLE_N) {
  const w = normaliseWeights(weights);
  const rankable = zones.filter((z) => (z.sampleN ?? 0) >= minSampleN);
  const insufficient = zones.filter((z) => (z.sampleN ?? 0) < minSampleN);
  const ranges = peerRanges(rankable);

  const scored = rankable.map((z) => {
    const { score, parts, missingComponents } = composite(z, w, ranges);
    return {
      zoneId: z.zoneId, zoneRef: z.zoneRef, zoneName: z.zoneName, level: z.level, class: z.class,
      sampleN: z.sampleN, composite: score,
      components: Object.fromEntries(parts.map((p) => [p.comp, { value: z.components[p.comp], norm: +p.norm.toFixed(3), weight: +p.weight.toFixed(3) }])),
      missingComponents,
      prevRank: z.prevRank ?? null,
      confidence: confidenceFromSample(z.sampleN, 100),
      insufficientData: false,
    };
  });

  // Rank within each peer group, highest composite first.
  const byGroup = new Map();
  for (const z of scored) {
    const key = peerKey(z.level, z.class);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(z);
  }
  for (const group of byGroup.values()) {
    group.sort((a, b) => (b.composite ?? -Infinity) - (a.composite ?? -Infinity));
    group.forEach((z, i) => {
      z.rank = i + 1;
      z.peerGroupSize = group.length;
      z.rankDelta = z.prevRank !== null ? z.prevRank - z.rank : null;
    });
  }

  const unranked = insufficient.map((z) => ({
    zoneId: z.zoneId, zoneRef: z.zoneRef, zoneName: z.zoneName, level: z.level, class: z.class,
    sampleN: z.sampleN ?? 0, composite: null, rank: null, components: {}, insufficientData: true,
  }));

  const results = [...scored, ...unranked];
  const factors = Object.entries(w).map(([comp, weight]) => ({
    name: COMPONENT_LABEL[comp], contribution: +weight.toFixed(3),
    direction: COMPONENT_DIRECTION[comp] === 'higher_better' ? 'up' : 'down',
    detail: `${(weight * 100).toFixed(0)}% weight, ${COMPONENT_DIRECTION[comp].replace('_', ' ')}`,
  }));

  const caveats = [];
  if (unranked.length) caveats.push(`${unranked.length} zone(s) below the ${minSampleN}-incident sample floor — shown as insufficient data, not ranked`);
  if (scored.some((z) => z.missingComponents.length)) caveats.push('some zones are missing one or more components — their composite is renormalised over what is known');

  return engineResult({
    value: { zones: results, weights: w, peerRanges: ranges },
    unit: 'score',
    confidence: null,   // deliberately simple: per-zone confidence lives on each row, not summarised into one fabricated figure
    window,
    inputs: [{ source: 'v_zone_daily', rows: zones.length }],
    factors,
    method: METHOD,
    caveats,
    meta: { minSampleN, peerGroups: [...byGroup.keys()] },
  });
}

/**
 * Re-baseline (BoQ-2 F8): recompute one zone's composite with an overridden component
 * value (e.g. unit availability after adding two ambulances), holding the peer group's
 * min/max range from the original run constant — the question being answered is "what
 * does this change buy THIS zone", not "how does the whole league table reshuffle".
 *
 * @param {ReturnType<typeof rankZones>} rankResult
 * @param {string} zoneId
 * @param {object} overrides   e.g. { unitAvailabilityPct: 0.82 }
 */
export function reBaselineZone(rankResult, zoneId, overrides) {
  const zone = rankResult.value.zones.find((z) => z.zoneId === zoneId);
  if (!zone || zone.insufficientData) return null;

  const range = rankResult.value.peerRanges[peerKey(zone.level, zone.class)] ?? {};
  const weights = rankResult.value.weights;
  const parts = [];
  let weightPresent = 0;
  for (const [comp, weight] of Object.entries(weights)) {
    const raw = comp in overrides ? overrides[comp] : zone.components[comp]?.value;
    const norm = normalise(raw, COMPONENT_DIRECTION[comp], range[comp]);
    if (norm === null) continue;
    parts.push({ comp, weight, norm, value: raw });
    weightPresent += weight;
  }
  const after = weightPresent > 0
    ? +(parts.reduce((s, p) => s + (p.weight / weightPresent) * p.norm, 0) * 100).toFixed(1)
    : null;

  return {
    zoneId, zoneRef: zone.zoneRef, before: zone.composite, after,
    delta: after === null || zone.composite === null ? null : +(after - zone.composite).toFixed(1),
    overrides,
    components: Object.fromEntries(parts.map((p) => [p.comp, { value: p.value, norm: +p.norm.toFixed(3) }])),
  };
}
