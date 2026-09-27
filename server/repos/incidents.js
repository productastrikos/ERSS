/**
 * Incident reads and writes. SQL lives here; rules live in domain/ and services/.
 *
 * Shapes on the way out are camelCase and match web/src/lib/types.ts. Timestamps leave as
 * ISO strings with offset; durations as integer seconds (docs/04 §1).
 */

import { ACTIVE_ASSIGNMENT_STATES } from '../domain/lifecycle.js';

export const ACTIVE_SQL = `('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')`;
// Kept honest against the domain module — the SQL list and the Set must agree.
if ([...ACTIVE_ASSIGNMENT_STATES].sort().join() !== ACTIVE_SQL.replace(/[()' ]/g, '').split(',').sort().join()) {
  throw new Error('repos/incidents ACTIVE_SQL has drifted from domain/lifecycle ACTIVE_ASSIGNMENT_STATES');
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

const SUMMARY_SELECT = `
  SELECT i.id, i.ref, i.kind, i.subkind, i.priority, i.state, i.outcome,
         ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat, i.makani, i.floor, i.unit_no, i.access_note,
         i.source, i.caller_name, i.caller_phone, i.caller_role, i.chief_complaint, i.triage_code,
         i.acuity, i.patients_count, i.reported_at, i.triaged_at, i.dispatched_at,
         -- ::text[] — pg has no parser for an array of a custom enum and would hand back
         -- the literal string '{DCAS,POLICE}'.
         i.first_onscene_at, i.first_at_patient_at, i.closed_at, i.agencies_involved::text[] AS agencies_involved,
         i.escalation_level, i.is_seed, i.is_resting, i.zone_id,
         z.ref AS zone_ref, z.name AS zone_name, z.class AS zone_class, z.highrise_ct,
         sz.ref AS sector_ref, la.code AS lead_agency_code, r.ref AS run_ref,
         m.building_name, m.entrance_no, m.entrance_count, m.entrance_role, m.floors AS building_floors,
         p.asg_ref, p.unit_ref, p.callsign, p.unit_kind, p.asg_state, p.eta_predicted_at, p.eta_method,
         p.offered_at AS asg_offered_at,
         COALESCE(c.active_units, 0) AS active_units
    FROM incidents i
    LEFT JOIN zones z ON z.id = i.zone_id
    LEFT JOIN zones sz ON sz.id = z.parent_id
    LEFT JOIN agencies la ON la.id = i.lead_agency_id
    LEFT JOIN scenario_runs r ON r.id = i.run_id
    LEFT JOIN makani_points m ON m.makani = i.makani
    LEFT JOIN LATERAL (
      SELECT a.ref AS asg_ref, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind, a.state AS asg_state,
             a.eta_predicted_at, a.eta_method, a.offered_at
        FROM assignments a JOIN units u ON u.id = a.unit_id
       WHERE a.incident_id = i.id AND a.state IN ${ACTIVE_SQL}
       ORDER BY a.is_primary DESC, a.offered_at
       LIMIT 1
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS active_units FROM assignments a
       WHERE a.incident_id = i.id AND a.state IN ${ACTIVE_SQL}
    ) c ON TRUE`;

export function shapeIncident(r) {
  return {
    ref: r.ref,
    kind: r.kind,
    subkind: r.subkind,
    priority: r.priority,
    state: r.state,
    outcome: r.outcome,
    lng: r.lng,
    lat: r.lat,
    makani: r.makani ? r.makani.trim() : null,
    zoneRef: r.zone_ref,
    zoneName: r.zone_name,
    sectorRef: r.sector_ref,
    floor: r.floor,
    unitNo: r.unit_no,
    accessNote: r.access_note,
    building: r.makani ? {
      name: r.building_name,
      entranceNo: r.entrance_no,
      entranceCount: r.entrance_count,
      entranceRole: r.entrance_role,
      floors: r.building_floors,
    } : null,
    source: r.source,
    callerName: r.caller_name,
    callerPhone: r.caller_phone,
    callerRole: r.caller_role,
    chiefComplaint: r.chief_complaint,
    triageCode: r.triage_code,
    acuity: r.acuity,
    patientsCount: r.patients_count,
    reportedAt: iso(r.reported_at),
    triagedAt: iso(r.triaged_at),
    dispatchedAt: iso(r.dispatched_at),
    firstOnsceneAt: iso(r.first_onscene_at),
    firstAtPatientAt: iso(r.first_at_patient_at),
    closedAt: iso(r.closed_at),
    leadAgencyCode: r.lead_agency_code,
    agenciesInvolved: r.agencies_involved ?? [],
    escalationLevel: r.escalation_level,
    responseSec: r.first_onscene_at ? Math.round((new Date(r.first_onscene_at) - new Date(r.reported_at)) / 1000) : null,
    primary: r.asg_ref ? {
      assignmentRef: r.asg_ref,
      unitRef: r.unit_ref,
      callsign: r.callsign,
      unitKind: r.unit_kind,
      state: r.asg_state,
      offeredAt: iso(r.asg_offered_at),
      etaPredictedAt: iso(r.eta_predicted_at),
      etaMethod: r.eta_method,
    } : null,
    activeUnits: r.active_units,
    isSeed: r.is_seed,
    isResting: r.is_resting,
    runRef: r.run_ref,
  };
}

/** Zone scope: a user scoped to a sector sees its communities too. Empty = unscoped. */
function scopeClause(scope, params) {
  if (!scope?.length) return '';
  params.push(scope);
  return ` AND (i.zone_id = ANY($${params.length}::uuid[]) OR z.parent_id = ANY($${params.length}::uuid[]))`;
}

const PRIORITY_RANK = `CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END`;

/**
 * The queue and the map both read this.
 *
 *   status 'active' — everything not closed, priority then longest waiting. Small by
 *                     nature; no paging.
 *   status 'all'    — newest first within [from, to], keyset-paged on (reported_at, ref).
 *                     Never offset paging on incidents (docs/04 §1).
 */
export async function listIncidents(db, {
  status = 'active', priorities, kind, zoneRef, from, to, bbox, limit = 100, cursor, scope,
}) {
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };

  if (status === 'active') where.push(`i.state <> 'closed'`);
  if (priorities?.length) add('i.priority = ANY(?::incident_prio[])', priorities);
  if (kind) add('i.kind = ?', kind);
  if (zoneRef) add('(z.ref = ? OR sz.ref = ?)', zoneRef);
  if (from) add('i.reported_at >= ?', from);
  if (to) add('i.reported_at <= ?', to);
  if (bbox) add('i.geom && ST_MakeEnvelope((?::float8[])[1], (?::float8[])[2], (?::float8[])[3], (?::float8[])[4], 4326)', bbox);
  if (cursor && status !== 'active') {
    const [ts, ref] = cursor.split('|');
    params.push(ts, ref);
    where.push(`(i.reported_at, i.ref) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }

  const scopeSql = scopeClause(scope, params);
  const order = status === 'active'
    ? `ORDER BY ${PRIORITY_RANK}, i.reported_at, i.ref`
    : 'ORDER BY i.reported_at DESC, i.ref DESC';
  params.push(Math.min(limit, 500));

  const { rows } = await db.query(
    `${SUMMARY_SELECT}
      WHERE ${where.length ? where.join(' AND ') : 'TRUE'}${scopeSql}
      ${order}
      LIMIT $${params.length}`,
    params,
  );
  const items = rows.map(shapeIncident);
  const last = rows.at(-1);
  return {
    items,
    nextCursor: status !== 'active' && rows.length === Math.min(limit, 500) && last
      ? `${iso(last.reported_at)}|${last.ref}` : null,
  };
}

/** One summary — what `incident:new` and every mutation response carries. */
export async function incidentSummary(db, ref) {
  const { rows } = await db.query(`${SUMMARY_SELECT} WHERE i.ref = $1`, [ref]);
  return rows[0] ? shapeIncident(rows[0]) : null;
}

/** The raw row, optionally locked for the rest of the transaction. */
export async function incidentRow(db, ref, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT i.*, ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat, z.ref AS zone_ref, z.class AS zone_class,
            z.highrise_ct, sz.ref AS sector_ref
       FROM incidents i
       LEFT JOIN zones z ON z.id = i.zone_id
       LEFT JOIN zones sz ON sz.id = z.parent_id
      WHERE i.ref = $1
      ${forUpdate ? 'FOR UPDATE OF i' : ''}`,
    [ref],
  );
  return rows[0] ?? null;
}

/**
 * The next human-readable reference for the GST calendar day: INC-YYMMDD-NNNN.
 * An advisory lock per day serialises concurrent creates, so two dispatchers creating
 * incidents in the same second cannot mint the same ref.
 */
export async function nextIncidentRef(client, nowMs) {
  const gst = new Date(nowMs + 4 * 3600_000);   // Dubai observes no DST
  const day = `${String(gst.getUTCFullYear()).slice(2)}${String(gst.getUTCMonth() + 1).padStart(2, '0')}${String(gst.getUTCDate()).padStart(2, '0')}`;
  const prefix = `INC-${day}-`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefix]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(substring(ref FROM 12), '')::int), 0) AS n
       FROM incidents WHERE ref LIKE $1 AND substring(ref FROM 12) ~ '^[0-9]+$'`,
    [`${prefix}%`],
  );
  return `${prefix}${String(rows[0].n + 1).padStart(4, '0')}`;
}

export async function insertIncident(client, v) {
  const { rows } = await client.query(
    `INSERT INTO incidents
       (ref, kind, subkind, priority, state, geom, makani, zone_id, floor, unit_no, access_note,
        source, caller_name, caller_phone, caller_role, reported_by, chief_complaint, triage_code,
        acuity, patients_count, reported_at, triaged_at, lead_agency_id, agencies_involved,
        run_id, is_seed, is_resting, created_at)
     VALUES ($1,$2,$3,$4,$5, ST_SetSRID(ST_MakePoint($6,$7),4326), $8,$9,$10,$11,$12,
             $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
             (SELECT id FROM agencies WHERE code = $24), $25::agency_code[], $26, false, $27, $22)
     RETURNING id`,
    [v.ref, v.kind, v.subkind ?? null, v.priority, v.state, v.lng, v.lat, v.makani ?? null, v.zoneId,
     v.floor ?? null, v.unitNo ?? null, v.accessNote ?? null, v.source, v.callerName ?? null,
     v.callerPhone ?? null, v.callerRole ?? null, v.reportedBy ?? null, v.chiefComplaint ?? null,
     v.triageCode ?? null, v.acuity ?? null, v.patientsCount ?? 1, v.reportedAt, v.triagedAt ?? null,
     v.leadAgency ?? 'DCAS', v.agenciesInvolved ?? ['DCAS'], v.runId ?? null, v.isResting ?? false],
  );
  return rows[0].id;
}

/** Update named columns. Only whitelisted columns are writable from a service. */
const WRITABLE = new Set([
  'kind', 'priority', 'state', 'outcome', 'makani', 'zone_id', 'floor', 'unit_no', 'access_note',
  'triage_code', 'acuity', 'patients_count', 'triaged_at', 'dispatched_at', 'first_onscene_at',
  'first_at_patient_at', 'closed_at', 'chief_complaint', 'escalation_level',
]);

export async function updateIncident(client, id, patch) {
  const cols = Object.keys(patch).filter((k) => WRITABLE.has(k));
  const sets = cols.map((k, i) => `${k} = $${i + 2}`);
  const params = [id, ...cols.map((k) => patch[k])];
  if (patch.geom) {
    params.push(patch.geom.lng, patch.geom.lat);
    sets.push(`geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`);
  }
  if (patch.addAgencies?.length) {
    params.push(patch.addAgencies);
    sets.push(`agencies_involved = ARRAY(SELECT DISTINCT unnest(agencies_involved || $${params.length}::agency_code[]))`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE incidents SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function insertTimeline(client, incidentId, e) {
  const { rows } = await client.query(
    `INSERT INTO incident_timeline (incident_id, ts, stage, label, actor_kind, actor_id, agency_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT id FROM agencies WHERE code = $7),$8)
     RETURNING id, ts, stage, label, actor_kind, actor_id, detail`,
    [incidentId, e.ts, e.stage, e.label, e.actorKind ?? 'system', e.actorId ?? null, e.agencyCode ?? null, e.detail ?? {}],
  );
  const r = rows[0];
  return { id: r.id, ts: iso(r.ts), stage: r.stage, label: r.label, actorKind: r.actor_kind, actorId: r.actor_id, agencyCode: e.agencyCode ?? null, detail: r.detail };
}

export async function timeline(db, incidentId) {
  const { rows } = await db.query(
    `SELECT t.id, t.ts, t.stage, t.label, t.actor_kind, t.actor_id, a.code AS agency_code, t.detail
       FROM incident_timeline t LEFT JOIN agencies a ON a.id = t.agency_id
      WHERE t.incident_id = $1 ORDER BY t.ts, t.id`,
    [incidentId],
  );
  return rows.map((r) => ({
    id: r.id, ts: iso(r.ts), stage: r.stage, label: r.label, actorKind: r.actor_kind,
    actorId: r.actor_id, agencyCode: r.agency_code, detail: r.detail,
  }));
}

// ── Agency notifications — the sub-minute multi-agency claim, measured ───────

export async function notifications(db, incidentId, nowIso) {
  const { rows } = await db.query(
    `SELECT a.code, a.short_name, n.notified_at, n.acknowledged_at, n.sla_sec, n.channel,
            u.ref AS acknowledged_by_ref
       FROM agency_notifications n
       JOIN agencies a ON a.id = n.agency_id
       LEFT JOIN users u ON u.id = n.acknowledged_by
      WHERE n.incident_id = $1
      ORDER BY n.notified_at`,
    [incidentId],
  );
  const now = new Date(nowIso).getTime();
  return rows.map((r) => {
    const notified = new Date(r.notified_at).getTime();
    const acked = r.acknowledged_at ? new Date(r.acknowledged_at).getTime() : null;
    const elapsedSec = Math.round(((acked ?? now) - notified) / 1000);
    return {
      agencyCode: r.code,
      agencyName: r.short_name,
      notifiedAt: iso(r.notified_at),
      acknowledgedAt: iso(r.acknowledged_at),
      acknowledgedBy: r.acknowledged_by_ref,
      slaSec: r.sla_sec,
      channel: r.channel,
      elapsedSec,
      // Unacknowledged and still inside the SLA is not a breach yet — it is pending.
      met: acked !== null ? elapsedSec <= r.sla_sec : elapsedSec > r.sla_sec ? false : null,
    };
  });
}

/** Insert notifications for agencies not already notified. Returns the codes inserted. */
export async function insertNotifications(client, incidentId, agencyCodes, notifiedAt, channel = 'in_app') {
  if (!agencyCodes.length) return [];
  const { rows } = await client.query(
    `INSERT INTO agency_notifications (incident_id, agency_id, notified_at, sla_sec, channel)
     SELECT $1, a.id, $3, a.sla_ack_sec, $4 FROM agencies a WHERE a.code = ANY($2::agency_code[])
     ON CONFLICT (incident_id, agency_id) DO NOTHING
     RETURNING (SELECT code FROM agencies WHERE id = agency_id) AS code, sla_sec`,
    [incidentId, agencyCodes, notifiedAt, channel],
  );
  return rows.map((r) => ({ code: r.code, slaSec: r.sla_sec }));
}

export async function acknowledgeNotification(client, incidentId, agencyCode, userId, at) {
  const { rows } = await client.query(
    `UPDATE agency_notifications n SET acknowledged_at = $4, acknowledged_by = $3
       FROM agencies a
      WHERE n.agency_id = a.id AND n.incident_id = $1 AND a.code = $2 AND n.acknowledged_at IS NULL
      RETURNING n.notified_at, n.sla_sec`,
    [incidentId, agencyCode, userId, at],
  );
  return rows[0] ?? null;
}

// ── Notes — the shared workspace (BoQ-1 F6) ─────────────────────────────────

export async function notes(db, incidentId) {
  const { rows } = await db.query(
    `SELECT n.id, n.body, n.pinned, n.created_at, u.name AS author_name, u.ref AS author_ref, a.code AS agency_code
       FROM incident_notes n
       JOIN users u ON u.id = n.author_id
       LEFT JOIN agencies a ON a.id = n.agency_id
      WHERE n.incident_id = $1 AND n.archived_at IS NULL
      ORDER BY n.created_at`,
    [incidentId],
  );
  return rows.map((r) => ({
    id: r.id, body: r.body, pinned: r.pinned, createdAt: iso(r.created_at),
    authorName: r.author_name, authorRef: r.author_ref, agencyCode: r.agency_code,
  }));
}

export async function insertNote(client, incidentId, { authorId, agencyId, body, at }) {
  const { rows } = await client.query(
    `INSERT INTO incident_notes (incident_id, author_id, agency_id, body, created_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [incidentId, authorId, agencyId ?? null, body, at],
  );
  return rows[0].id;
}

// ── Today's KPIs — from v_incident_response, the ONE definition ──────────────

/**
 * Resting-state incidents are excluded: their stage timings are scripted for the demo
 * picture, and a KPI computed from them would present a prop as a measurement.
 */
export async function kpisBetween(db, fromIso, toIso, scope) {
  const params = [fromIso, toIso];
  let scopeSql = '';
  if (scope?.length) {
    params.push(scope);
    scopeSql = ` AND (r.zone_id = ANY($3::uuid[]) OR r.sector_id = ANY($3::uuid[]))`;
  }
  const { rows } = await db.query(
    `SELECT COUNT(*)::int                                                   AS calls,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec)     AS response_p50,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY r.response_sec)     AS response_p90,
            COUNT(r.response_sec)::int                                      AS responded,
            100.0 * COUNT(*) FILTER (WHERE r.within_target)
                  / NULLIF(COUNT(*) FILTER (WHERE r.within_target IS NOT NULL), 0) AS within_target_pct,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.acknowledge_sec)  AS ack_p50,
            AVG(r.turnout_sec)                                              AS turnout_mean,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.vrt_sec)          AS vrt_p50,
            COUNT(r.vrt_sec)::int                                           AS vrt_n
       FROM v_incident_response r
      WHERE r.reported_at >= $1 AND r.reported_at <= $2${scopeSql}
        AND NOT EXISTS (SELECT 1 FROM incidents x WHERE x.id = r.id AND x.is_resting)`,
    params,
  );
  return rows[0];
}
