/**
 * preempt — green-wave impact reporting. docs/08 §3.6.
 *
 * PURE. The plan's live request/grant/conflict-resolution logic runs inside the dispatch
 * path against real signal hardware — there is no signal controller to talk to in this
 * PoC, and building a simulated one is exactly the kind of "too technical for this pass"
 * work this build is deliberately deferring. What this engine DOES do for real: the
 * measurement side. `preempt_events` already records every historical request and its
 * outcome (seeded, docs/09), and this reproduces the Concept Note's worked example —
 * a count, a percentage of total, and a measured seconds-saved figure — over whatever
 * rows exist, live.
 */

import { engineResult, insufficientData } from '../lib/result.js';

export const METHOD = 'measured-preempt-impact-v1';

/**
 * @param {Array<{signalRef,corridor,requests,granted,meanSavedSec,totalSavedSec}>} rows
 * @param {number} totalAssignments   denominator for "% of total" — the worked example's shape
 * @param {{from:string,to:string}} window
 */
export function summarisePreemptImpact(rows, totalAssignments, window) {
  if (!rows?.length) {
    return insufficientData({
      method: METHOD, window,
      inputs: [{ source: 'v_preempt_impact', rows: 0 }],
      minimum: 1, actual: 0,
    });
  }

  const requests = rows.reduce((s, r) => s + r.requests, 0);
  const granted = rows.reduce((s, r) => s + r.granted, 0);
  const totalSavedSec = rows.reduce((s, r) => s + (r.totalSavedSec ?? 0), 0);
  const grantPct = requests > 0 ? (100 * granted) / requests : 0;
  const meanSavedSec = granted > 0 ? totalSavedSec / granted : 0;
  const pctOfTotal = totalAssignments > 0 ? (100 * requests) / totalAssignments : null;

  const byCorridor = [...rows]
    .sort((a, b) => (b.totalSavedSec ?? 0) - (a.totalSavedSec ?? 0))
    .slice(0, 10)
    .map((r) => ({
      signalRef: r.signalRef, corridor: r.corridor, requests: r.requests, granted: r.granted,
      grantPct: r.requests > 0 ? +((100 * r.granted) / r.requests).toFixed(1) : 0,
      meanSavedSec: r.meanSavedSec ?? 0, totalSavedSec: r.totalSavedSec ?? 0,
    }));

  const shortfall = grantPct < 60 || meanSavedSec < 10;

  return engineResult({
    value: {
      requests, granted, grantPct: +grantPct.toFixed(1), meanSavedSec: +meanSavedSec.toFixed(1),
      totalSavedSec, pctOfTotal: pctOfTotal === null ? null : +pctOfTotal.toFixed(2),
      byCorridor, shortfall,
    },
    unit: 'seconds',
    confidence: null, // this is a direct measurement, not an estimate — confidence does not apply
    window,
    inputs: [{ source: 'v_preempt_impact', rows: rows.length }],
    factors: byCorridor.slice(0, 5).map((c) => ({ name: c.corridor ?? c.signalRef, contribution: c.totalSavedSec, direction: 'up', detail: `${c.granted}/${c.requests} granted, ${c.meanSavedSec.toFixed(0)}s mean saving` })),
    method: METHOD,
    caveats: ['EVP is not verified as deployed in Dubai — this measures what preemption WOULD recover over the seeded/simulated event log'],
    meta: { shortfall },
  });
}
