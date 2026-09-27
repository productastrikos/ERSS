/**
 * Citizen SOS. docs/07 §4, docs/04.
 *
 * Deliberately thin: it reuses services/incidents.js for creation, triage, recommendation
 * and close — the citizen path is just a narrower door into the same incident machinery
 * the console uses, with an ownership check standing in for the console's zone scope.
 */

import { pool } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import * as incidentsSvc from './incidents.js';
import * as incidents from '../repos/incidents.js';
import { remainingPathFor } from '../sim/live.js';

const SOS_KIND_DEFAULT = 'medical_general';

export async function create(input, actor) {
  const { incident, recommendation } = await incidentsSvc.create({
    kind: input.kind ?? SOS_KIND_DEFAULT,
    lng: input.lng,
    lat: input.lat,
    source: 'app_sos',
    callerRole: 'self',
    accessNote: input.note ?? (input.silent ? 'Silent SOS — caller may not be able to speak.' : undefined),
  }, actor);
  return { ref: incident.ref, state: incident.state, recommendation };
}

async function ownIncidentRow(ref, actor) {
  const row = await incidents.incidentRow(pool, ref);
  if (!row) throw notFound('SOS report');
  if (row.reported_by !== actor.id) throw forbidden('This SOS report belongs to another account');
  return row;
}

export async function cancel(ref, actor) {
  await ownIncidentRow(ref, actor);
  return incidentsSvc.close(ref, { outcome: 'cancelled_by_caller' }, actor);
}

/** A deliberately narrow projection: never the unit's position HISTORY, never another
 *  caller's incident — only what a citizen watching their own SOS needs to see: where
 *  they are, where the ambulance is now, and the road still between the two. */
export async function status(ref, actor) {
  const inc = await ownIncidentRow(ref, actor);
  const { rows } = await pool.query(
    `SELECT a.ref AS "assignmentRef", a.state, a.offered_at AS "assignedAt", a.eta_predicted_at AS "etaPredictedAt",
            a.onscene_at AS "onsceneAt",
            CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS "routeProposed",
            u.kind AS "unitKind", u.ref AS "unitRef", u.callsign AS "unitCallsign",
            ST_X(u.current_geom) AS "unitLng", ST_Y(u.current_geom) AS "unitLat", u.current_heading AS "unitHeading",
            u.current_speed AS "unitSpeed",
            ST_Distance(u.current_geom::geography, i.geom::geography) AS "distanceM",
            ST_X(i.geom) AS "incidentLng", ST_Y(i.geom) AS "incidentLat"
       FROM incidents i
       LEFT JOIN assignments a ON a.incident_id = i.id AND a.state NOT IN ('cancelled','declined','timed_out')
       LEFT JOIN units u ON u.id = a.unit_id
      WHERE i.id = $1
      ORDER BY a.offered_at DESC NULLS LAST LIMIT 1`,
    [inc.id],
  );
  const asg = rows[0] ?? null;
  const timeline = await incidents.timeline(pool, inc.id);

  const onTheWay = asg?.state && ['offered', 'acknowledged', 'enroute'].includes(asg.state);
  const unitAt = asg?.unitLng != null ? [asg.unitLng, asg.unitLat] : null;
  const route = onTheWay
    ? remainingPathFor(asg.assignmentRef) ?? trimToNearest(asg.routeProposed?.coordinates ?? null, unitAt)
    : null;

  // Before the ambulance moves, the dispatch engine's prediction is the best estimate. Once
  // it is driving, the road still ahead at the speed it is actually doing is better — the
  // caller watching the map should see the minutes count down with the ambulance.
  const roadM = route ? pathMetres(route) : null;
  const speedMps = Number(asg?.unitSpeed ?? 0) / 3.6;   // stored in km/h
  let etaSec = onTheWay && asg.etaPredictedAt ? Math.max(0, Math.round((Date.parse(asg.etaPredictedAt) - Date.now()) / 1000)) : null;
  if (asg?.state === 'enroute' && roadM != null && speedMps > 3) etaSec = Math.round(roadM / speedMps);

  return {
    ref,
    state: inc.state,
    assignmentState: asg?.state ?? null,
    unitKind: asg?.unitKind ?? null,
    unitCallsign: asg?.unitCallsign ?? null,
    unitRef: asg?.unitRef ?? null,
    etaSec,
    distanceM: onTheWay ? Math.round(roadM ?? asg?.distanceM ?? 0) || null : null,
    assignedAt: asg?.assignedAt ?? null,
    onsceneAt: asg?.onsceneAt ?? null,
    reportedAt: inc.reported_at,
    unitLng: asg?.unitLng ?? null,
    unitLat: asg?.unitLat ?? null,
    unitHeading: asg?.unitHeading ?? null,
    incidentLng: asg?.incidentLng ?? null,
    incidentLat: asg?.incidentLat ?? null,
    route,
    timeline: timeline.map((t) => ({ ts: t.ts, label: t.label })),
  };
}

function pathMetres(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    m += 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }
  return m;
}

/** The part of a planned route still ahead of a vehicle: from the vertex nearest to it. */
function trimToNearest(coords, at) {
  if (!coords || coords.length < 2) return null;
  if (!at) return coords;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = (coords[i][0] - at[0]) ** 2 + (coords[i][1] - at[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return [at, ...coords.slice(best + 1)];
}
