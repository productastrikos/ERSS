/**
 * Units — duty-state changes from the console, standby placement, and position history.
 * Assignment-driven statuses (assigned, responding, on scene …) are never set here; they
 * follow the assignment lifecycle in services/dispatch.js.
 */

import { pool, transaction } from '../lib/db.js';
import { nowIso } from '../lib/clock.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound, validation } from '../lib/errors.js';
import { MANUAL_UNIT_STATUSES } from '../domain/lifecycle.js';
import * as fleet from '../repos/fleet.js';
import * as fanout from '../realtime/fanout.js';
import { auditActor } from './actor.js';
import { scheduleKpiTick } from './kpi.js';

export async function setStatus(ref, { status, reason }, actor) {
  if (!MANUAL_UNIT_STATUSES.has(status)) {
    throw validation({ status: [`Set from the console: ${[...MANUAL_UNIT_STATUSES].join(', ')}. The rest follow the assignment.`] });
  }
  const at = nowIso();
  const out = await transaction(async (c) => {
    const unit = await fleet.lockUnit(c, ref);
    if (!unit) throw notFound('Unit');
    const busy = await fleet.activeAssignmentForUnit(c, unit.id);
    if (busy) throw conflict(`${ref} is on ${busy.incident_ref} — clear or stand it down first`);
    let geom = {};
    if (status === 'standby') {
      const { rows } = await c.query('SELECT ST_X(standby_geom) AS lng, ST_Y(standby_geom) AS lat FROM units WHERE id = $1', [unit.id]);
      if (rows[0]?.lng == null) throw conflict(`${ref} has no standby point — place it with /standby first`);
      geom = { lng: rows[0].lng, lat: rows[0].lat, at };   // arrived at the standby point
    }
    const row = await fleet.setUnitStatus(c, unit.id, status, geom);
    return { from: unit.status, row };
  });
  await audit({ action: 'unit.status', entity: 'unit', entityId: ref, actor: auditActor(actor), payload: { from: out.from, to: status, reason: reason ?? null } });
  fanout.unitStatus(out.row);
  scheduleKpiTick();
  return fleet.unitByRef(pool, ref);
}

/** Send a unit to a staging point (from a coverage advisory, Phase 6/7). It relocates
 *  until marked `standby` on arrival. */
export async function placeStandby(ref, { lng, lat, reason }, actor) {
  const out = await transaction(async (c) => {
    const unit = await fleet.lockUnit(c, ref);
    if (!unit) throw notFound('Unit');
    const busy = await fleet.activeAssignmentForUnit(c, unit.id);
    if (busy) throw conflict(`${ref} is on ${busy.incident_ref}`);
    await c.query(
      `UPDATE units SET standby_geom = ST_SetSRID(ST_MakePoint($2,$3),4326), standby_reason = $4 WHERE id = $1`,
      [unit.id, lng, lat, reason],
    );
    return fleet.setUnitStatus(c, unit.id, 'relocating');
  });
  await audit({ action: 'unit.standby', entity: 'unit', entityId: ref, actor: auditActor(actor), payload: { lng, lat, reason } });
  fanout.unitStatus(out);
  return fleet.unitByRef(pool, ref);
}

/** Position history as a LineString — route replay. */
export async function track(ref, { from, to }) {
  const { rows } = await pool.query(
    `SELECT COUNT(p.*)::int AS n, MIN(p.ts) AS first_ts, MAX(p.ts) AS last_ts,
            CASE WHEN COUNT(p.*) >= 2 THEN ST_AsGeoJSON(ST_MakeLine(p.geom ORDER BY p.ts))::json END AS geometry,
            COALESCE(json_agg(extract(epoch FROM p.ts) ORDER BY p.ts) FILTER (WHERE p.ts IS NOT NULL), '[]') AS timestamps
       FROM units u LEFT JOIN unit_positions p ON p.unit_id = u.id AND p.ts >= $2 AND p.ts <= $3
      WHERE u.ref = $1
      GROUP BY u.id`,
    [ref, from, to],
  );
  if (!rows[0]) throw notFound('Unit');
  const r = rows[0];
  return {
    type: 'Feature',
    geometry: r.geometry,
    properties: {
      unitRef: ref, points: r.n,
      from: r.first_ts ? new Date(r.first_ts).toISOString() : null,
      to: r.last_ts ? new Date(r.last_ts).toISOString() : null,
      timestamps: r.timestamps,
    },
  };
}
