/**
 * Citizen SOS. docs/07 §4, docs/04.
 *
 * Deliberately thin: it reuses services/incidents.js for creation, triage, recommendation
 * and close — the citizen path is just a narrower door into the same incident machinery
 * the console uses, with an ownership check standing in for the console's zone scope.
 */

import { pool, one } from '../lib/db.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/logger.js';
import { forbidden, notFound } from '../lib/errors.js';
import { poc } from '../config/poc.js';
import * as incidentsSvc from './incidents.js';
import * as incidents from '../repos/incidents.js';
import * as fleet from '../repos/fleet.js';
import * as eta from './eta.js';
import { remainingPathFor, adoptIntoRun, demoPlaceNear, deviceHospitalRouteFor } from '../sim/live.js';
import { onlineCrewUnitRefs } from '../realtime/index.js';
import { linkSos, unlinkSosIncident, unlinkSosUnit, clearSosLinks, unitForSos } from '../realtime/sosLinks.js';
import * as vitals from './vitals.js';

// ── Live links: which ambulance is answering which SOS ────────────────────────
//
// realtime/sosLinks.js joins the position stream to the caller's room. Linked the moment a
// crew is offered the job, unlinked when it stands down or the incident closes, and cleared
// by a PoC restart; status() below re-links on every read, which heals a server restart.

const ENDED = new Set(['cancelled', 'declined', 'timed_out', 'cleared']);
bus.on('assignment:offer', ({ unitRef, incident }) => {
  if (incident?.source === 'app_sos') linkSos(unitRef, incident.ref);
});
bus.on('assignment:update', ({ unitRef, incidentRef, state }) => {
  if (ENDED.has(state)) unlinkSosUnit(unitRef, incidentRef);
});
bus.on('incident:closed', (s) => unlinkSosIncident(s?.ref));
bus.on('sim:reset', () => {
  clearSosLinks();
  demoPlaces.clear();
});

// ── The demonstration caller's place ──────────────────────────────────────────

/** unitRef → { at: [lng,lat] the crew was at, place, until } */
const demoPlaces = new Map();
const DEMO_PLACE_TTL_MS = 15 * 60_000;
/** A crew that has moved further than this from where the place was chosen gets a new one. */
const DEMO_PLACE_DRIFT_M = 2500;

/**
 * Where the citizen app puts its caller in the demonstration: on a real road a minute or two's
 * drive from the paired crew — the crew whose phone is signed in, else the trial's crew-demo
 * ambulance (config/poc.js crewDemoUnit). The two phones in the room are therefore always
 * near each other, and the response the room watches is a short one.
 *
 * Stable for a while, so the caller's pin does not jump between visits to the screen; a new
 * one is chosen when it expires, when the crew has moved well away, and after a restart.
 */
export async function demoPlace() {
  const online = [...onlineCrewUnitRefs()];
  const pocOnline = poc.enabled ? online.filter((r) => poc.fleet.includes(r)) : online;
  const wanted = [...pocOnline, ...online, poc.crewDemoUnit].filter(Boolean);
  const unit = await one(
    `SELECT u.ref, u.callsign, u.kind, u.status, ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat
       FROM units u
      WHERE u.ref = ANY($1::text[]) AND u.archived_at IS NULL AND u.current_geom IS NOT NULL
      ORDER BY array_position($1::text[], u.ref) LIMIT 1`,
    [wanted],
  );
  if (!unit) return null;
  const from = [Number(unit.lng), Number(unit.lat)];
  const cached = demoPlaces.get(unit.ref);
  let place = cached && cached.until > Date.now() && metres(cached.at, from) < DEMO_PLACE_DRIFT_M ? cached.place : null;
  if (!place) {
    // The rest of the free trial fleet, so the place can be one where this crew is nearest.
    const { rows: others } = await pool.query(
      `SELECT ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat FROM units u
        WHERE u.ref <> $1 AND u.archived_at IS NULL AND u.current_geom IS NOT NULL
          AND u.status IN ('available', 'standby') AND ($2::text[] IS NULL OR u.ref = ANY($2::text[]))`,
      [unit.ref, poc.enabled ? poc.fleet : null],
    );
    place = await demoPlaceNear(from, others.map((o) => [Number(o.lng), Number(o.lat)])).catch((err) => {
      logger.warn({ err: err.message }, '[sos] demo place failed');
      return null;
    });
    if (!place) return null;
    demoPlaces.set(unit.ref, { at: from, place, until: Date.now() + DEMO_PLACE_TTL_MS });
  }
  return {
    lng: place.lng,
    lat: place.lat,
    road: place.road,
    crew: {
      unitRef: unit.ref,
      callsign: unit.callsign,
      kind: unit.kind,
      status: unit.status,
      /** The crew app is signed in for this ambulance right now. */
      online: online.includes(unit.ref),
      straightM: Math.round(metres(from, [place.lng, place.lat])),
    },
  };
}

function metres(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The nearest free ambulance to each candidate place, with its road distance and arrival
 * time — from the same ETA engine dispatch uses, so what a caller is told when choosing a
 * place is what dispatch would then do. Null for a place no free ambulance can reach.
 */
export async function nearest(points) {
  const free = (await fleet.listUnits(pool, { status: ['available', 'standby'] }))
    .filter((u) => u.lng != null && !u.currentAssignmentRef && u.agencyCode === 'DCAS');
  if (!free.length) return points.map(() => null);
  const origins = free.map((u) => [u.lng, u.lat]);
  // In the demonstration an SOS from the app goes to the crew whose phone is signed in, when
  // it is free (services/dispatch.js pairWithCrewPhone) — so that is the ambulance a caller
  // is told about, not a nearer one that would not be sent.
  const online = poc.enabled ? onlineCrewUnitRefs() : new Set();
  const pairedIdx = free.findIndex((u) => online.has(u.ref) && poc.fleet.includes(u.ref));
  return Promise.all(points.map(async (p) => {
    const results = await eta.travelMany(origins, p, { zoneClass: 'urban' });
    let best = null;
    results.forEach((r, i) => {
      const sec = r.value?.seconds;
      if (sec != null && (!best || sec < best.travelSec)) best = { i, travelSec: sec, distanceM: r.value.distanceM };
    });
    const paired = pairedIdx >= 0 && results[pairedIdx]?.value?.seconds != null
      ? { i: pairedIdx, travelSec: results[pairedIdx].value.seconds, distanceM: results[pairedIdx].value.distanceM }
      : null;
    const pick = paired ?? best;
    if (!pick) return null;
    return {
      callsign: free[pick.i].callsign,
      distanceM: pick.distanceM,
      etaSec: await eta.arrival(pick.travelSec, 'offer'),
      paired: Boolean(paired),
    };
  }));
}

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
  // Part of the live run, so "Restart PoC" clears it like every other demonstration incident.
  await adoptIntoRun(incident.ref).catch((err) => logger.warn({ err: err.message, ref: incident.ref }, '[sos] could not tag the run'));
  // The wearable readings that led up to the SOS travel with it: the crew, the hospital
  // pre-alert and the report all read them (services/vitals.js).
  if (input.vitals?.length) {
    await vitals.appendWearable(incident.ref, input.vitals, { device: input.vitalsDevice ?? null })
      .catch((err) => logger.warn({ err: err.message, ref: incident.ref }, '[sos] could not store the vitals'));
  }
  return { ref: incident.ref, state: incident.state, recommendation };
}

/** More wearable readings while help is on the way — pushed live to the crew on the job. */
export async function addVitals(ref, readings, device, actor) {
  const row = await ownIncidentRow(ref, actor);
  if (row.state === 'closed') return { added: 0 };
  const out = await vitals.appendWearable(ref, readings, { device, unitRef: unitForSos(ref) });
  return { added: out.added };
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
            a.onscene_at AS "onsceneAt", a.transporting_at AS "transportingAt", a.at_hospital_at AS "atHospitalAt",
            h.ref AS "hospitalRef", h.name AS "hospitalName", ST_X(h.geom) AS "hospitalLng", ST_Y(h.geom) AS "hospitalLat",
            CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS "routeProposed",
            u.kind AS "unitKind", u.ref AS "unitRef", u.callsign AS "unitCallsign",
            ST_X(u.current_geom) AS "unitLng", ST_Y(u.current_geom) AS "unitLat", u.current_heading AS "unitHeading",
            u.current_speed AS "unitSpeed",
            ST_Distance(u.current_geom::geography, i.geom::geography) AS "distanceM",
            ST_X(i.geom) AS "incidentLng", ST_Y(i.geom) AS "incidentLat"
       FROM incidents i
       LEFT JOIN assignments a ON a.incident_id = i.id AND a.state NOT IN ('cancelled','declined','timed_out')
       LEFT JOIN units u ON u.id = a.unit_id
       LEFT JOIN hospitals h ON h.id = a.hospital_id
      WHERE i.id = $1
      ORDER BY a.offered_at DESC NULLS LAST LIMIT 1`,
    [inc.id],
  );
  const asg = rows[0] ?? null;
  const timeline = await incidents.timeline(pool, inc.id);

  // Keep the live link right (a restart forgets it): the ambulance on this job pushes its
  // position to this caller's room until the job ends.
  const answering = asg?.unitRef && ['offered', 'acknowledged', 'enroute', 'onscene', 'transporting', 'at_hospital', 'resolved_on_scene'].includes(asg.state);
  if (answering && inc.state !== 'closed') linkSos(asg.unitRef, ref);
  else unlinkSosIncident(ref);

  const onTheWay = asg?.state && ['offered', 'acknowledged', 'enroute'].includes(asg.state);
  // The patient aboard, on the way in: the caller (or whoever holds their phone) sees the
  // road to the hospital the same way they saw the road to them.
  const toHospital = asg?.state === 'transporting';
  const unitAt = asg?.unitLng != null ? [asg.unitLng, asg.unitLat] : null;
  const route = onTheWay
    ? remainingPathFor(asg.assignmentRef) ?? trimToNearest(asg.routeProposed?.coordinates ?? null, unitAt)
    : toHospital
      ? remainingPathFor(asg.assignmentRef) ?? trimToNearest(deviceHospitalRouteFor(asg.assignmentRef), unitAt)
        ?? (unitAt && asg.hospitalLng != null ? [unitAt, [asg.hospitalLng, asg.hospitalLat]] : null)
      : null;

  // Before the ambulance moves, the dispatch engine's prediction is the best estimate. Once
  // it is driving, the road still ahead at the speed it is actually doing is better — the
  // caller watching the map should see the minutes count down with the ambulance.
  const roadM = route ? pathMetres(route) : null;
  const speedMps = Number(asg?.unitSpeed ?? 0) / 3.6;   // stored in km/h
  let etaSec = onTheWay && asg.etaPredictedAt ? Math.max(0, Math.round((Date.parse(asg.etaPredictedAt) - Date.now()) / 1000)) : null;
  if ((asg?.state === 'enroute' || toHospital) && roadM != null && speedMps > 3) etaSec = Math.round(roadM / speedMps);
  // Not moving yet on the way in (loading, pulling out): a city-driving estimate.
  if (toHospital && etaSec == null && roadM != null) etaSec = Math.round(roadM / 11);

  return {
    ref,
    state: inc.state,
    assignmentState: asg?.state ?? null,
    unitKind: asg?.unitKind ?? null,
    unitCallsign: asg?.unitCallsign ?? null,
    unitRef: asg?.unitRef ?? null,
    etaSec,
    distanceM: onTheWay || toHospital ? Math.round(roadM ?? asg?.distanceM ?? 0) || null : null,
    assignedAt: asg?.assignedAt ?? null,
    onsceneAt: asg?.onsceneAt ?? null,
    reportedAt: inc.reported_at,
    unitLng: asg?.unitLng ?? null,
    unitLat: asg?.unitLat ?? null,
    unitHeading: asg?.unitHeading ?? null,
    incidentLng: asg?.incidentLng ?? null,
    incidentLat: asg?.incidentLat ?? null,
    transportingAt: asg?.transportingAt ?? null,
    atHospitalAt: asg?.atHospitalAt ?? null,
    hospital: asg?.hospitalRef ? { ref: asg.hospitalRef, name: asg.hospitalName, lng: asg.hospitalLng, lat: asg.hospitalLat } : null,
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
