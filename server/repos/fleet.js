/**
 * Fleet reads and writes: units, assignments, and the hospital state dispatch needs.
 *
 * The active-assignment predicate below is written out verbatim, not interpolated from
 * a variable, wherever the asg_active_idx partial index should serve it — Postgres only
 * uses a partial index when the query's clause provably implies the index predicate.
 */

import { ACTIVE_SQL } from './incidents.js';
import { pocFleet } from '../config/poc.js';

const iso = (v) => (v ? new Date(v).toISOString() : null);

const UNIT_SELECT = `
  SELECT u.id, u.ref, u.callsign, u.kind, ag.code AS agency_code, s.ref AS home_station_ref,
         u.capabilities, u.crew_size, u.status, u.shift_start, u.shift_end,
         ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
         u.current_heading, u.current_speed, u.last_seen_at,
         ST_X(u.standby_geom) AS standby_lng, ST_Y(u.standby_geom) AS standby_lat, u.standby_reason,
         ca.ref AS asg_ref, ca.state AS asg_state, ci.ref AS incident_ref
    FROM units u
    JOIN agencies ag ON ag.id = u.agency_id
    LEFT JOIN stations s ON s.id = u.home_station_id
    LEFT JOIN LATERAL (
      SELECT x.ref, x.state, x.incident_id FROM assignments x
       WHERE x.unit_id = u.id
         AND x.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')
       ORDER BY x.offered_at DESC LIMIT 1
    ) ca ON TRUE
    LEFT JOIN incidents ci ON ci.id = ca.incident_id`;

export function shapeUnit(r) {
  return {
    ref: r.ref,
    callsign: r.callsign,
    kind: r.kind,
    agencyCode: r.agency_code,
    homeStationRef: r.home_station_ref,
    capabilities: r.capabilities ?? [],
    crewSize: r.crew_size,
    status: r.status,
    shiftStart: iso(r.shift_start),
    shiftEnd: iso(r.shift_end),
    lng: r.lng,
    lat: r.lat,
    heading: r.current_heading,
    speed: r.current_speed,
    lastSeenAt: iso(r.last_seen_at),
    standby: r.standby_lng != null ? { lng: r.standby_lng, lat: r.standby_lat, reason: r.standby_reason } : null,
    currentAssignmentRef: r.asg_ref ?? null,
    currentAssignmentState: r.asg_state ?? null,
    currentIncidentRef: r.incident_ref ?? null,
  };
}

export async function listUnits(db, { status, agency, kind, bbox } = {}) {
  const params = [];
  const where = ['u.archived_at IS NULL'];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  // The trial fleet, and only the trial fleet (config/poc.js). Every screen that draws a
  // unit reads this function, so scoping it here is what makes "eight ambulances" true
  // on the map, in the fleet counts and in the dispatch panel at the same time.
  const roster = pocFleet();
  if (roster) add('u.ref = ANY(?::text[])', roster);
  if (status?.length) add('u.status = ANY(?::unit_status[])', status);
  if (agency) add('ag.code = ?', agency);
  if (kind) add('u.kind = ?', kind);
  if (bbox) add('u.current_geom && ST_MakeEnvelope((?::float8[])[1], (?::float8[])[2], (?::float8[])[3], (?::float8[])[4], 4326)', bbox);
  const { rows } = await db.query(`${UNIT_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.ref`, params);
  return rows.map(shapeUnit);
}

export async function unitByRef(db, ref) {
  const { rows } = await db.query(`${UNIT_SELECT} WHERE u.ref = $1 AND u.archived_at IS NULL`, [ref]);
  return rows[0] ? shapeUnit(rows[0]) : null;
}

/** For the responder app: "my own unit", from the session's unit_id — no ref needed. */
export async function unitById(db, id) {
  const { rows } = await db.query(`${UNIT_SELECT} WHERE u.id = $1 AND u.archived_at IS NULL`, [id]);
  return rows[0] ? shapeUnit(rows[0]) : null;
}

/** The unit row, locked. The lock is what stops two dispatchers sending the same unit. */
export async function lockUnit(client, ref) {
  const { rows } = await client.query(
    `SELECT u.id, u.ref, u.callsign, u.kind, u.status, u.capabilities, u.shift_start,
            ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat, ag.code AS agency_code
       FROM units u JOIN agencies ag ON ag.id = u.agency_id
      WHERE u.ref = $1 AND u.archived_at IS NULL
      FOR UPDATE OF u`,
    [ref],
  );
  return rows[0] ?? null;
}

export async function lockUnitById(client, id) {
  const { rows } = await client.query(
    `SELECT u.id, u.ref, u.status, u.standby_geom IS NOT NULL AS has_standby
       FROM units u WHERE u.id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

export async function activeAssignmentForUnit(db, unitId) {
  const { rows } = await db.query(
    `SELECT x.ref, i.ref AS incident_ref FROM assignments x JOIN incidents i ON i.id = x.incident_id
      WHERE x.unit_id = $1
        AND x.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')
      LIMIT 1`,
    [unitId],
  );
  return rows[0] ?? null;
}

/**
 * Set a unit's status, and optionally where it now is. A status report like "on scene"
 * IS a position report — the crew is at the entrance — so it moves the unit and counts
 * as a fix.
 */
export async function setUnitStatus(client, unitId, status, { at, lng, lat } = {}) {
  const params = [unitId, status];
  let geom = '';
  if (lng != null && lat != null) {
    params.push(lng, lat, at);
    geom = `, current_geom = ST_SetSRID(ST_MakePoint($3,$4),4326), last_seen_at = $5`;
  }
  const { rows } = await client.query(
    `UPDATE units SET status = $2${geom} WHERE id = $1
     RETURNING ref, status, ST_X(current_geom) AS lng, ST_Y(current_geom) AS lat, current_heading, current_speed`,
    params,
  );
  return rows[0];
}

/**
 * Units a recommendation scores. Two pools: the nearest QUALIFYING units (capability
 * and kind already filtered, so a list of ten BLS cars never crowds out the ALS that
 * should be sent), and the nearest units of any kind, so the dispatcher can see why the
 * closest one was not recommended.
 */
export async function dispatchCandidates(db, {
  lng, lat, agencyCodes, required, preferred, nonPrimaryKinds, excludeRefs = [], limit,
  coverageRadiusM, todayIso, hourOfWeek,
}) {
  // $8 is the trial roster (config/poc.js), or NULL for the full fleet. Dispatch is held
  // to the SAME eight ambulances the console draws: a recommendation the operator cannot
  // see on the map is not a recommendation, it is a surprise.
  const roster = pocFleet();
  const scoped = '($8::text[] IS NULL OR u.ref = ANY($8::text[]))';
  const scopedOther = '($8::text[] IS NULL OR o.ref = ANY($8::text[]))';

  const select = `
    SELECT u.id, u.ref, u.callsign, u.kind, ag.code AS agency_code, u.capabilities, u.status, u.shift_start,
           ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
           ST_Distance(u.current_geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS straight_m,
           (SELECT COUNT(*) FROM assignments j WHERE j.unit_id = u.id AND j.offered_at >= $5)::int AS jobs_today,
           (SELECT COUNT(*) FROM units o JOIN agencies oa ON oa.id = o.agency_id
             WHERE o.id <> u.id AND o.archived_at IS NULL AND o.status IN ('available','standby')
               AND oa.code = ANY($3) AND o.current_geom IS NOT NULL AND ${scopedOther}
               AND ST_DWithin(o.current_geom::geography, u.current_geom::geography, $6))::int AS others_nearby,
           COALESCE((
             SELECT h.mean_per_week / NULLIF((SELECT AVG(mean_per_week) FROM mv_zone_hour_of_week WHERE hour_of_week = $7), 0)
               FROM mv_zone_hour_of_week h
              WHERE h.hour_of_week = $7
                AND h.zone_id = (SELECT z.id FROM zones z WHERE z.level = 'community'
                                  ORDER BY z.centroid <-> u.current_geom LIMIT 1)
           ), 1) AS demand_index
      FROM units u JOIN agencies ag ON ag.id = u.agency_id
     WHERE u.archived_at IS NULL AND u.current_geom IS NOT NULL
       AND u.status IN ('available','standby')
       AND ag.code = ANY($3)
       AND ${scoped}
       AND NOT (u.ref = ANY($4))
       AND NOT EXISTS (SELECT 1 FROM assignments x WHERE x.unit_id = u.id
             AND x.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))`;

  const base = [lng, lat, agencyCodes, excludeRefs, todayIso, coverageRadiusM, hourOfWeek, roster];
  const [qualifying, nearest] = await Promise.all([
    db.query(
      `${select}
         AND u.capabilities @> $9::text[]
         AND (u.kind::text <> ALL($10::text[]) OR u.kind::text = ANY($11::text[]))
       ORDER BY u.current_geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326)
       LIMIT $12`,
      [...base, required, nonPrimaryKinds, preferred, limit],
    ),
    db.query(
      `${select}
       ORDER BY u.current_geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326)
       LIMIT 5`,
      base,
    ),
  ]);

  const seen = new Set();
  const out = [];
  for (const r of [...qualifying.rows, ...nearest.rows]) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push({
      id: r.id, ref: r.ref, callsign: r.callsign, kind: r.kind, agencyCode: r.agency_code,
      capabilities: r.capabilities, status: r.status, lng: r.lng, lat: r.lat, straightM: r.straight_m,
      jobsToday: r.jobs_today, othersNearby: r.others_nearby, zoneDemandIndex: Number(r.demand_index) || 1,
      shiftStart: iso(r.shift_start),
    });
  }
  return out;
}

// ── Assignments ─────────────────────────────────────────────────────────────

/**
 * ASG-YYMMDD-NNNN-n — the incident's reference with the offer number. The planned
 * ASG-NNNN-n repeats every day; this cannot.
 */
export async function nextAssignmentRef(client, incidentId, incidentRef) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM assignments WHERE incident_id = $1', [incidentId]);
  return `ASG-${incidentRef.slice(4)}-${rows[0].n + 1}`;
}

export async function insertAssignment(client, v) {
  const { rows } = await client.query(
    `INSERT INTO assignments
       (ref, incident_id, unit_id, state, is_primary, offered_at, hospital_id,
        route_proposed, route_proposed_sec, route_proposed_m,
        eta_predicted_at, eta_method, dispatch_rationale, run_id)
     VALUES ($1,$2,$3,'offered',$4,$5,NULL,
             CASE WHEN $6::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($6),4326) END,
             $7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [v.ref, v.incidentId, v.unitId, v.isPrimary, v.offeredAt,
     v.routeCoordinates && v.routeCoordinates.length > 1 ? JSON.stringify({ type: 'LineString', coordinates: v.routeCoordinates }) : null,
     v.routeSec, v.routeM, v.etaPredictedAt, v.etaMethod, v.rationale, v.runId ?? null],
  );
  return rows[0].id;
}

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.ref, a.incident_id, i.ref AS incident_ref, a.unit_id, u.ref AS unit_ref, u.callsign,
         u.kind AS unit_kind, ag.code AS agency_code, a.state, a.is_primary,
         a.offered_at, a.acknowledged_at, a.declined_at, a.decline_reason, a.enroute_at, a.onscene_at,
         a.at_patient_at, a.transporting_at, a.at_hospital_at, a.cleared_at,
         h.ref AS hospital_ref, h.name AS hospital_name, a.vrt_sec, a.vrt_breakdown,
         a.route_proposed_sec, a.route_proposed_m, a.route_taken_sec, a.route_taken_m,
         a.eta_predicted_at, a.eta_method, a.eta_error_sec, a.dispatch_rationale,
         CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS route_proposed,
         CASE WHEN a.route_taken IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_taken)::json END AS route_taken,
         ST_X(u.current_geom) AS unit_lng, ST_Y(u.current_geom) AS unit_lat
    FROM assignments a
    JOIN incidents i ON i.id = a.incident_id
    JOIN units u ON u.id = a.unit_id
    JOIN agencies ag ON ag.id = u.agency_id
    LEFT JOIN hospitals h ON h.id = a.hospital_id`;

export function shapeAssignment(r) {
  return {
    ref: r.ref,
    incidentRef: r.incident_ref,
    unitRef: r.unit_ref,
    callsign: r.callsign,
    unitKind: r.unit_kind,
    agencyCode: r.agency_code,
    state: r.state,
    isPrimary: r.is_primary,
    offeredAt: iso(r.offered_at),
    acknowledgedAt: iso(r.acknowledged_at),
    declinedAt: iso(r.declined_at),
    declineReason: r.decline_reason,
    enrouteAt: iso(r.enroute_at),
    onsceneAt: iso(r.onscene_at),
    atPatientAt: iso(r.at_patient_at),
    transportingAt: iso(r.transporting_at),
    atHospitalAt: iso(r.at_hospital_at),
    clearedAt: iso(r.cleared_at),
    hospitalRef: r.hospital_ref,
    hospitalName: r.hospital_name,
    vrtSec: r.vrt_sec,
    vrtBreakdown: r.vrt_breakdown,
    routeProposedSec: r.route_proposed_sec,
    routeProposedM: r.route_proposed_m,
    routeTakenSec: r.route_taken_sec,
    routeTakenM: r.route_taken_m,
    routeProposed: r.route_proposed?.coordinates ?? null,
    routeTaken: r.route_taken?.coordinates ?? null,
    etaPredictedAt: iso(r.eta_predicted_at),
    etaMethod: r.eta_method,
    etaErrorSec: r.eta_error_sec,
    dispatchRationale: r.dispatch_rationale,
    unitPosition: r.unit_lng != null ? { lng: r.unit_lng, lat: r.unit_lat } : null,
  };
}

export async function assignmentsForIncident(db, incidentId) {
  const { rows } = await db.query(`${ASSIGNMENT_SELECT} WHERE a.incident_id = $1 ORDER BY a.offered_at, a.ref`, [incidentId]);
  return rows;
}

export async function assignmentByRef(db, ref, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${ASSIGNMENT_SELECT} WHERE a.ref = $1 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [ref],
  );
  return rows[0] ?? null;
}

const ASSIGNMENT_WRITABLE = new Set([
  'state', 'is_primary', 'acknowledged_at', 'declined_at', 'decline_reason', 'enroute_at', 'onscene_at',
  'at_patient_at', 'transporting_at', 'at_hospital_at', 'cleared_at', 'hospital_id', 'vrt_sec',
  'vrt_breakdown', 'route_taken_sec', 'route_taken_m',
]);

export async function updateAssignment(client, id, patch) {
  const cols = Object.keys(patch).filter((k) => ASSIGNMENT_WRITABLE.has(k));
  if (!cols.length) return;
  await client.query(
    `UPDATE assignments SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [id, ...cols.map((k) => patch[k])],
  );
}

/**
 * The first position fix inside `radiusM` of the incident since the unit went en route —
 * what "on scene" is stamped from when the unit reported positions. Null when it did not.
 */
export async function firstFixNear(db, unitId, sinceIso, lng, lat, radiusM) {
  const { rows } = await db.query(
    `SELECT MIN(ts) AS ts FROM unit_positions
      WHERE unit_id = $1 AND ts >= $2
        AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5)`,
    [unitId, sinceIso, lng, lat, radiusM],
  );
  return rows[0]?.ts ? iso(rows[0].ts) : null;
}

/** The route actually driven, from the unit's reported positions. */
export async function storeRouteTaken(client, assignmentId, unitId, fromIso, toIso) {
  const { rows } = await client.query(
    `WITH track AS (
       SELECT ST_MakeLine(geom ORDER BY ts) AS line, COUNT(*) AS n
         FROM unit_positions WHERE unit_id = $2 AND ts >= $3 AND ts <= $4
     )
     UPDATE assignments a
        SET route_taken = CASE WHEN t.n >= 2 THEN t.line END,
            route_taken_m = CASE WHEN t.n >= 2 THEN ST_Length(t.line::geography)::int END
       FROM track t
      WHERE a.id = $1
      RETURNING t.n`,
    [assignmentId, unitId, fromIso, toIso],
  );
  return rows[0]?.n ?? 0;
}

export async function failedOffersFor(db, incidentId) {
  const { rows } = await db.query(
    `SELECT u.ref AS unit_ref, a.state FROM assignments a JOIN units u ON u.id = a.unit_id
      WHERE a.incident_id = $1`,
    [incidentId],
  );
  return rows;
}

/** Offers whose acknowledge window has passed. Not locked here: each timeout transition
 *  locks its own row and re-checks the state, so an acknowledgement that lands first wins. */
export async function expiredOffers(db, cutoffIso, limit = 20) {
  const { rows } = await db.query(
    `SELECT a.ref FROM assignments a
      WHERE a.state = 'offered' AND a.offered_at <= $1
      ORDER BY a.offered_at LIMIT $2`,
    [cutoffIso, limit],
  );
  return rows.map((r) => r.ref);
}

// ── Hospitals ───────────────────────────────────────────────────────────────

export async function hospitalsForRanking(db) {
  const { rows } = await db.query(
    `SELECT h.id, h.ref, h.name, h.capabilities, h.ed_beds, h.ed_occupied, h.on_diversion,
            ST_X(h.geom) AS lng, ST_Y(h.geom) AS lat,
            (SELECT COUNT(*) FROM assignments a
              WHERE a.hospital_id = h.id
                AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')
                AND a.state = 'transporting')::int AS inbound
       FROM hospitals h ORDER BY h.ref`,
  );
  return rows;
}

export async function hospitalByRef(db, ref) {
  const { rows } = await db.query(
    'SELECT id, ref, name, ST_X(geom) AS lng, ST_Y(geom) AS lat FROM hospitals WHERE ref = $1', [ref],
  );
  return rows[0] ?? null;
}

export { ACTIVE_SQL };
