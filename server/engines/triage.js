/**
 * triage — the auto-triage used when an incident is created without a priority.
 * docs/04 §3: "priority (or omit for auto-triage)".
 *
 * PURE and deliberately modest: the most likely priority for the incident kind from the
 * case mix, raised to P1 when the complaint names a life threat. It is a starting point a
 * call-taker confirms or overrides, never a clinical determinant — the product does not
 * pretend to be AMPDS.
 */

import { engineResult } from '../lib/result.js';

export const METHOD = 'rules-kind-mode-v1';

/** Phrases that mean "life-threatening" whatever the kind. */
const LIFE_THREAT = /not breathing|no pulse|unconscious|unresponsive|choking|severe bleeding|trapped|seizure|collapsed/i;

/**
 * @param {{ kind: string, chiefComplaint?: string|null }} p
 * @param {Array<{ kind: string, priorities: Record<string, number> }>} caseMix
 * @param {{ from: string, to: string }} window
 */
export function autoTriage({ kind, chiefComplaint }, caseMix, window) {
  const mix = caseMix.find((c) => c.kind === kind)?.priorities ?? { P1: 0.1, P2: 0.3, P3: 0.45, P4: 0.15 };
  const [modal, share] = Object.entries(mix).sort((a, b) => b[1] - a[1])[0];
  const threat = chiefComplaint ? LIFE_THREAT.exec(chiefComplaint) : null;
  const priority = threat ? 'P1' : modal;

  const factors = [{
    name: 'Incident kind', contribution: share, direction: 'up',
    detail: `${Math.round(share * 100)}% of ${kind.replace(/_/g, ' ')} calls are ${modal}`,
  }];
  if (threat) {
    factors.push({ name: 'Complaint', contribution: 1, direction: 'up', detail: `"${threat[0]}" indicates a life threat` });
  }

  return engineResult({
    value: { priority, code: `AUTO-${priority}` },
    unit: 'priority',
    // The share of this kind's calls at the chosen priority — what the case mix supports.
    // A complaint override has no measured basis, so it reports none.
    confidence: threat ? null : +share.toFixed(3),
    window,
    inputs: [{ source: 'case mix (proxy — docs/09 §2.4)', rows: caseMix.length }],
    factors,
    method: METHOD,
    caveats: ['Rules-based starting point for a call-taker to confirm; not a clinical determinant'],
  });
}
