/**
 * Per-zone component reads for engines/ranking.js. docs/08 §2.3.
 */

/**
 * One row per zone at `level`, with the six ranking components. `preemptEventRate` is
 * always null for now — preempt_events has no rows until engines/preempt.js (Phase 6.7)
 * exists to generate them; the ranking engine already scores a zone on what it knows and
 * names the gap, the same way dispatch.js names its equity term as a visible zero.
 */
export async function zoneComponents(db, { level, from, to, includeResting = false }) {
  const { rows } = await db.query(
    `WITH agg AS (
       SELECT r.zone_id,
              COUNT(*)::int                                                          AS n,
              AVG(r.response_sec)                                                    AS avg_response_sec,
              100.0 * COUNT(*) FILTER (WHERE r.within_target)
                    / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0)  AS within_target_pct,
              100.0 * COUNT(*) FILTER (WHERE r.state = 'closed') / NULLIF(COUNT(*), 0) AS closure_pct,
              AVG(r.acknowledge_sec)                                                 AS avg_ack_sec
         FROM v_incident_response r
        WHERE r.reported_at >= $1 AND r.reported_at <= $2 AND r.zone_id IS NOT NULL
          ${includeResting ? '' : 'AND NOT EXISTS (SELECT 1 FROM incidents x WHERE x.id = r.id AND x.is_resting)'}
        GROUP BY r.zone_id
     ),
     avail AS (
       SELECT s.zone_id,
              100.0 * COUNT(*) FILTER (WHERE u.status IN ('available', 'standby')) / NULLIF(COUNT(*), 0) AS availability_pct
         FROM units u JOIN stations s ON s.id = u.home_station_id
        WHERE u.archived_at IS NULL
        GROUP BY s.zone_id
     )
     SELECT z.id, z.ref, z.name, z.level, z.class,
            COALESCE(agg.n, 0)          AS n,
            agg.avg_response_sec, agg.within_target_pct, agg.closure_pct, agg.avg_ack_sec,
            avail.availability_pct
       FROM zones z
       LEFT JOIN agg   ON agg.zone_id = z.id
       LEFT JOIN avail ON avail.zone_id = z.id
      WHERE z.level = $3
      ORDER BY z.ref`,
    [from, to, level],
  );

  return rows.map((r) => ({
    zoneId: r.id, zoneRef: r.ref, zoneName: r.name, level: r.level, class: r.class,
    sampleN: r.n,
    components: {
      avgResponseSec: r.avg_response_sec === null ? null : +r.avg_response_sec,
      withinTargetPct: r.within_target_pct === null ? null : +r.within_target_pct,
      unitAvailabilityPct: r.availability_pct === null ? null : +r.availability_pct,
      eventClosurePct: r.closure_pct === null ? null : +r.closure_pct,
      avgAcknowledgeSec: r.avg_ack_sec === null ? null : +r.avg_ack_sec,
      preemptEventRate: null,
    },
  }));
}

export async function latestRunFor(db, level) {
  const { rows } = await db.query(
    `SELECT id, period_from, period_to, level, weights, created_at
       FROM rank_runs WHERE level = $1 ORDER BY created_at DESC LIMIT 1`,
    [level],
  );
  return rows[0] ?? null;
}

export async function insertRun(client, { periodFrom, periodTo, level, weights, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO rank_runs (period_from, period_to, level, weights, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [periodFrom, periodTo, level, JSON.stringify(weights), createdBy ?? null],
  );
  return rows[0].id;
}

export async function insertScores(client, runId, zones) {
  for (const z of zones) {
    await client.query(
      `INSERT INTO rank_scores (run_id, zone_id, composite, components, rank, prev_rank, sample_n)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (run_id, zone_id) DO NOTHING`,
      [runId, z.zoneId, z.composite ?? 0, JSON.stringify(z.components ?? {}), z.rank ?? 0, z.prevRank ?? null, z.sampleN ?? 0],
    );
  }
}

/** The prior run's rank per zone, for rank-delta arrows. */
export async function prevRanksFor(db, level, beforeRunId) {
  const { rows } = await db.query(
    `SELECT rs.zone_id, rs.rank
       FROM rank_scores rs
       JOIN rank_runs rr ON rr.id = rs.run_id
      WHERE rr.level = $1 AND rr.id <> $2
      ORDER BY rr.created_at DESC
      LIMIT 500`,
    [level, beforeRunId ?? '00000000-0000-0000-0000-000000000000'],
  );
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.zone_id)) seen.set(r.zone_id, r.rank);
  return seen;
}
