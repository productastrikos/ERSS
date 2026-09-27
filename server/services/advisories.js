/**
 * The advisory workspace — list, drill-down, act, measure, close, dismiss, and the
 * live-detector generate pass. docs/08 §4.
 */

import { pool, transaction } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import * as repo from './../repos/advisories.js';
import { auditActor } from './actor.js';
import {
  anomalyReport, equityReport, coverageReport, preemptReport,
} from './intelligence.js';
import { anomalyCandidate, equityCandidates, coverageGapCandidate, preemptShortfallCandidate } from '../engines/advisory.js';

export async function list(query) {
  return repo.listAdvisories(pool, query);
}

export async function detail(ref) {
  const row = await repo.advisoryByRef(pool, ref);
  if (!row) throw notFound('Advisory');
  const actions = await repo.advisoryActions(pool, row.id);
  return { ...row, actions };
}

/** Re-runs the evidence for an already-open advisory — "Analyze" in the hub. */
export async function analyse(ref) {
  const row = await repo.advisoryByRef(pool, ref);
  if (!row) throw notFound('Advisory');
  if (row.state === 'open') {
    await repo.setAdvisoryState(pool, row.id, { state: 'analysing', action: 'analysed' }, null);
  }
  return detail(ref); // the evidence blob already carries the full engine result; nothing further to fetch in this pass
}

export async function act(ref, { agencyCode, ownerRef, action, slaHours }, actor) {
  const id = await repo.advisoryIdByRef(pool, ref);
  if (!id) throw notFound('Advisory');
  const at = nowIso();
  const slaDueAt = slaHours ? new Date(Date.now() + slaHours * 3_600_000).toISOString() : null;
  await repo.setAdvisoryState(pool, id, {
    state: 'acted', actedAt: at, slaDueAt, action: action || 'acted',
    payload: { agencyCode: agencyCode ?? null, ownerRef: ownerRef ?? null },
  }, actor.id);
  await audit({ action: 'advisory.act', entity: 'advisory', entityId: ref, actor: auditActor(actor), payload: { action, agencyCode, slaHours } });
  return detail(ref);
}

export async function measure(ref, value, actor) {
  const id = await repo.advisoryIdByRef(pool, ref);
  if (!id) throw notFound('Advisory');
  await repo.setAdvisoryState(pool, id, { state: 'verifying', measuredValue: value, action: 'measured', payload: { value } }, actor.id);
  await audit({ action: 'advisory.measure', entity: 'advisory', entityId: ref, actor: auditActor(actor), payload: { value } });
  return detail(ref);
}

export async function close(ref, actor) {
  const id = await repo.advisoryIdByRef(pool, ref);
  if (!id) throw notFound('Advisory');
  await repo.setAdvisoryState(pool, id, { state: 'closed', closedAt: nowIso(), action: 'closed' }, actor.id);
  await audit({ action: 'advisory.close', entity: 'advisory', entityId: ref, actor: auditActor(actor) });
  return detail(ref);
}

export async function dismiss(ref, reason, actor) {
  const id = await repo.advisoryIdByRef(pool, ref);
  if (!id) throw notFound('Advisory');
  const row = await repo.advisoryByRef(pool, ref);
  if (row.state === 'closed' || row.state === 'dismissed') throw conflict(`${ref} is already ${row.state}`);
  await repo.setAdvisoryState(pool, id, { state: 'dismissed', dismissReason: reason, action: 'dismissed', payload: { reason } }, actor.id);
  await audit({ action: 'advisory.dismiss', entity: 'advisory', entityId: ref, actor: auditActor(actor), payload: { reason } });
  return detail(ref);
}

/**
 * Run the live detectors and upsert whatever clears the bar. docs/08 §4.3 dedupes
 * against any already-OPEN advisory with the same detector+zone, so calling this
 * repeatedly (a poll, a button, a cron) never floods the hub.
 */
export async function generate() {
  const [anomaly, equity, coverage, preempt] = await Promise.all([
    anomalyReport({ hours: 168 }),
    equityReport(),
    coverageReport(),
    preemptReport(),
  ]);

  const candidates = [
    ...anomaly.zones.map((z) => anomalyCandidate(z.result)).filter(Boolean),
    ...equityCandidates(equity),
    coverageGapCandidate(coverage),
    preemptShortfallCandidate(preempt),
  ].filter(Boolean);

  let created = 0, updated = 0;
  await transaction(async (client) => {
    for (const c of candidates) {
      // A ref is only spent on a genuinely new finding — reserving one for a candidate
      // that turns out to just refresh an existing open advisory would burn numbers
      // for no reason.
      const open = await client.query(
        `SELECT id FROM advisories WHERE dedupe_key = $1 AND state NOT IN ('closed','dismissed')`,
        [c.dedupeKey],
      );
      const ref = open.rows[0] ? null : await repo.nextAdvisoryRef(client, nowMs());
      const { created: wasCreated } = await repo.upsertAdvisory(client, c, { ref });
      if (wasCreated) created++; else updated++;
    }
  });
  return { created, updated, evaluated: candidates.length };
}
