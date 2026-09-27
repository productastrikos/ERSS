/**
 * Advisory storage. docs/03 §3.3, docs/08 §4.
 */

const LIST_SELECT = `
  SELECT a.id, a.ref, a.severity, a.category, a.title, a.body, a.state, a.evidence,
         COALESCE((SELECT array_agg(z.ref) FROM zones z WHERE z.id = ANY(a.zone_ids)), '{}') AS "zoneRefs",
         i.ref AS "incidentRef",
         a.recommended_action AS "recommendedAction",
         ag.code AS "assignedAgencyCode", u.ref AS "ownerRef", a.acted_at AS "actedAt",
         a.sla_due_at AS "slaDueAt", a.baseline_value AS "baselineValue",
         a.target_value AS "targetValue", a.measured_value AS "measuredValue",
         a.closed_at AS "closedAt", a.dismiss_reason AS "dismissReason",
         a.detector, a.created_at AS "createdAt"
    FROM advisories a
    LEFT JOIN agencies ag ON ag.id = a.assigned_agency_id
    LEFT JOIN users u     ON u.id = a.owner_user_id
    LEFT JOIN incidents i ON i.id = a.incident_id`;

export async function listAdvisories(db, { severity, state, category, zoneRef } = {}) {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (severity) add('a.severity = ?', severity);
  if (state) add('a.state = ?', state);
  else where.push(`a.state NOT IN ('closed','dismissed')`);
  if (category) add('a.category = ?', category);
  if (zoneRef) add('? = ANY(SELECT ref FROM zones WHERE id = ANY(a.zone_ids))', zoneRef);
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.severity = 'emergency' DESC, a.severity = 'alert' DESC, a.created_at DESC LIMIT 200`;
  const { rows } = await db.query(sql, params);
  return rows;
}

export async function advisoryByRef(db, ref) {
  const { rows } = await db.query(`${LIST_SELECT} WHERE a.ref = $1`, [ref]);
  return rows[0] ?? null;
}

export async function advisoryIdByRef(db, ref) {
  const { rows } = await db.query('SELECT id FROM advisories WHERE ref = $1', [ref]);
  return rows[0]?.id ?? null;
}

export async function advisoryActions(db, advisoryId) {
  const { rows } = await db.query(
    `SELECT aa.ts, aa.action, aa.note, u.name AS "actorName"
       FROM advisory_actions aa LEFT JOIN users u ON u.id = aa.actor_id
      WHERE aa.advisory_id = $1 ORDER BY aa.ts`,
    [advisoryId],
  );
  return rows;
}

export async function nextAdvisoryRef(client, nowMs) {
  const gst = new Date(nowMs + 4 * 3600_000);
  const day = `${String(gst.getUTCFullYear()).slice(2)}${String(gst.getUTCMonth() + 1).padStart(2, '0')}${String(gst.getUTCDate()).padStart(2, '0')}`;
  const prefix = `ADV-${day}-`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefix]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(substring(ref FROM 12), '')::int), 0) AS n
       FROM advisories WHERE ref LIKE $1 AND substring(ref FROM 12) ~ '^[0-9]+$'`,
    [`${prefix}%`],
  );
  return `${prefix}${String(rows[0].n + 1).padStart(3, '0')}`;
}

/**
 * Upsert a live-detector candidate: an OPEN advisory with the same dedupe key is
 * refreshed in place (docs/08 §4.3 "deduplication") rather than duplicated; a closed
 * or dismissed one does not block a fresh finding.
 */
export async function upsertAdvisory(client, candidate, { ref, engineVersion = '1.0.0' }) {
  const existing = await client.query(
    `SELECT id, ref FROM advisories WHERE dedupe_key = $1 AND state NOT IN ('closed','dismissed')`,
    [candidate.dedupeKey],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE advisories SET title = $2, body = $3, evidence = $4, measured_value = $5
         WHERE id = $1`,
      [existing.rows[0].id, candidate.title, candidate.body, JSON.stringify(candidate.evidence), candidate.baselineValue ?? null],
    );
    return { ref: existing.rows[0].ref, created: false };
  }
  await client.query(
    `INSERT INTO advisories
       (ref, severity, category, title, body, state, evidence, zone_ids,
        recommended_action, assigned_agency_id, baseline_value, target_value,
        detector, engine, engine_version, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,
             (SELECT id FROM agencies WHERE code = $9), $10, $11, $12, 'advisory', $13, $14)`,
    [ref, candidate.severity, candidate.category, candidate.title, candidate.body,
     JSON.stringify(candidate.evidence), candidate.zoneIds ?? [], candidate.recommendedAction ?? null,
     candidate.agencyCode ?? null, candidate.baselineValue ?? null, candidate.targetValue ?? null,
     candidate.detector, engineVersion, candidate.dedupeKey],
  );
  return { ref, created: true };
}

export async function setAdvisoryState(db, id, patch, actorId) {
  const cols = [];
  const params = [id];
  const set = (col, value) => { params.push(value); cols.push(`${col} = $${params.length}`); };
  if (patch.state) set('state', patch.state);
  if (patch.ownerUserId !== undefined) set('owner_user_id', patch.ownerUserId);
  if (patch.agencyId !== undefined) set('assigned_agency_id', patch.agencyId);
  if (patch.slaDueAt !== undefined) set('sla_due_at', patch.slaDueAt);
  if (patch.actedAt !== undefined) set('acted_at', patch.actedAt);
  if (patch.measuredValue !== undefined) set('measured_value', patch.measuredValue);
  if (patch.closedAt !== undefined) set('closed_at', patch.closedAt);
  if (patch.dismissReason !== undefined) set('dismiss_reason', patch.dismissReason);
  if (!cols.length) return;
  await db.query(`UPDATE advisories SET ${cols.join(', ')} WHERE id = $1`, params);
  await db.query(
    `INSERT INTO advisory_actions (advisory_id, actor_id, action, note, payload) VALUES ($1,$2,$3,$4,$5)`,
    [id, actorId ?? null, patch.action ?? patch.state ?? 'update', patch.note ?? null, JSON.stringify(patch.payload ?? {})],
  );
}
