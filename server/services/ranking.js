/**
 * The ranking service — league table, weights editor, re-baseline. docs/06 §5, docs/08 §2.3.
 */

import { pool, transaction } from '../lib/db.js';
import { zoneComponents, latestRunFor, insertRun, insertScores, prevRanksFor } from '../repos/ranking.js';
import { rankZones, reBaselineZone, DEFAULT_WEIGHTS } from '../engines/ranking.js';

/**
 * Compute (and persist) a rank run for a level and period. Every run is a stored,
 * versioned artefact — docs/08's "a rank can always be reproduced" requirement.
 */
export async function computeRanking({ level = 'community', from, to, weights = DEFAULT_WEIGHTS, actorId } = {}) {
  const [rawZones, prevRanks] = await Promise.all([
    zoneComponents(pool, { level, from, to }),
    prevRanksFor(pool, level, null),
  ]);
  const zones = rawZones.map((z) => ({ ...z, prevRank: prevRanks.get(z.zoneId) ?? null }));
  const result = rankZones(zones, weights, { from, to });

  const runId = await transaction(async (client) => {
    const id = await insertRun(client, { periodFrom: from, periodTo: to, level, weights: result.value.weights, createdBy: actorId ?? null });
    await insertScores(client, id, result.value.zones);
    return id;
  });

  return { ...result, runId, level };
}

export async function currentRanking({ level = 'community' } = {}) {
  const run = await latestRunFor(pool, level);
  if (!run) return null;
  return computeRanking({ level, from: run.period_from, to: run.period_to, weights: run.weights });
}

/** Re-baseline: what does a fleet change buy one zone, holding the peer range fixed. */
export async function reBaseline({ level = 'community', from, to, weights = DEFAULT_WEIGHTS, zoneId, overrides }) {
  const zones = await zoneComponents(pool, { level, from, to });
  const result = rankZones(zones, weights, { from, to });
  const rb = reBaselineZone(result, zoneId, overrides);
  if (!rb) throw Object.assign(new Error('zone not found or has insufficient data'), { status: 404 });
  return rb;
}
