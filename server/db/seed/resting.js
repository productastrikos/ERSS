/**
 * The resting state — what the Operations screen shows with no scenario running.
 * docs/06 §2.5, docs/00 D-08.
 *
 *   "units sit at stations and standby points, three or four incidents are in plausible
 *    mid-flight states, and the KPI strip shows the day's real figures to date."
 *
 * Restored by `npm run seed:resting`, by `npm run seed` and by `npm run seed:reset`, and
 * always RELATIVE TO NOW: an incident "en route for four minutes" is en route for four
 * minutes whenever the reset ran. Deterministic in everything but the clock, so a demo
 * rehearsed on Tuesday opens on the same picture on Wednesday.
 *
 * The incidents are built with the REAL engines — the unit is the dispatch engine's
 * choice, its rationale is the engine's rationale, the destination is the hospital
 * engine's — so the first click on a resting incident shows genuine reasoning. They are
 * tagged `is_resting` (never `is_seed`: no analytic view counts them as history), and the
 * console marks them as simulated.
 */

import { pool, transaction } from '../../lib/db.js';
import { nowMs } from '../../lib/clock.js';
import { createRng } from './rng.js';
import { inPocFleet, poc } from '../../config/poc.js';
import { offset } from './geo.js';
import * as incidents from '../../repos/incidents.js';
import * as fleet from '../../repos/fleet.js';
import * as eta from '../../services/eta.js';
import { recommendFor, correlationFor, hospitalRecommendation } from '../../services/dispatch.js';

const ACTOR = { kind: 'system', id: 'RESTING-STATE' };
const iso = (ms) => new Date(ms).toISOString();

export async function restoreRestingState({ rngSeed, log = console.log }) {
  const t0 = Date.now();
  const removed = await removeResting();
  const fleetCounts = await restFleet(rngSeed);
  const made = [];
  // The trial build tells one incident's story at a time (sim/live.js, pacedGenerate), and
  // the dashboard follows each one by itself. Resting incidents were scenery for the
  // emirate-wide Operations board; here they only took three of the eight ambulances out
  // of the picture before the first real alert. The fleet starts at rest instead.
  for (const spec of poc.enabled ? [] : SCRIPT) {
    try {
      made.push(await build(spec));
    } catch (err) {
      // One resting incident failing to build must not leave the screen empty.
      log(`  resting       ✗ ${spec.key}: ${err.message}`);
    }
  }
  log(`  resting       removed ${removed}, fleet ${Object.entries(fleetCounts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  for (const m of made) log(`  resting       ${m.ref}  ${m.summary}`);
  log(`  resting       restored in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  return { removed, incidents: made.length, fleet: fleetCounts };
}

// ── 1 · Clear the previous resting state ────────────────────────────────────

async function removeResting() {
  return transaction(async (c) => {
    await c.query(`UPDATE advisories SET incident_id = NULL WHERE incident_id IN (SELECT id FROM incidents WHERE is_resting)`);
    const { rowCount } = await c.query('DELETE FROM incidents WHERE is_resting');
    return rowCount;
  });
}

// ── 2 · The fleet at rest ───────────────────────────────────────────────────

/**
 * Every unit back at its home station or standby point, on a deterministic per-unit roll
 * — the same proportions the reference seed uses. Three exceptions: a unit still working
 * a live, non-resting incident is left alone; a unit bound to a demo responder account is
 * always on duty, so the phone demo has a unit to drive; and units the resting incidents
 * need are taken from the pool afterwards, by the dispatch engine.
 */
async function restFleet(rngSeed) {
  const { rows } = await pool.query(`
    SELECT u.id, u.ref, ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat,
           EXISTS (SELECT 1 FROM users b WHERE b.unit_id = u.id AND b.archived_at IS NULL) AS bound,
           EXISTS (SELECT 1 FROM assignments x WHERE x.unit_id = u.id
                     AND x.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')) AS busy
      FROM units u LEFT JOIN stations s ON s.id = u.home_station_id
     WHERE u.archived_at IS NULL`);

  const updates = { id: [], status: [], lng: [], lat: [], sbLng: [], sbLat: [], heading: [] };
  const counts = {};
  for (const u of rows) {
    if (u.busy || u.lng == null) continue;
    const rng = createRng(`${rngSeed}:resting:${u.ref}`);
    const roll = rng.next();
    let status = roll < 0.62 ? 'available' : roll < 0.74 ? 'standby' : roll < 0.80 ? 'out_of_service' : 'off_duty';
    if (u.bound) status = 'available';
    // A trial ambulance is never rolled off the road. Out of ninety-five units, three
    // sitting off duty is realistic; out of eight it is nearly half the fleet gone, and
    // the client agreed five to ten ambulances RUNNING, not on a shift rota.
    if (inPocFleet(u.ref)) status = roll < 0.80 ? 'available' : 'standby';

    const home = { lng: u.lng, lat: u.lat };
    const at = status === 'standby'
      ? offset(home, rng.float(900, 1800), rng.float(0, 360))
      : offset(home, rng.float(0, 90), rng.float(0, 360));

    updates.id.push(u.id);
    updates.status.push(status);
    updates.lng.push(at.lng);
    updates.lat.push(at.lat);
    updates.sbLng.push(status === 'standby' ? at.lng : null);
    updates.sbLat.push(status === 'standby' ? at.lat : null);
    updates.heading.push(rng.int(0, 359));
    counts[status] = (counts[status] ?? 0) + 1;
  }

  await pool.query(
    `UPDATE units u SET
        status = v.status::unit_status,
        current_geom = ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
        current_heading = v.heading, current_speed = 0,
        standby_geom = CASE WHEN v.sb_lng IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(v.sb_lng, v.sb_lat), 4326) END,
        standby_reason = CASE WHEN v.sb_lng IS NULL THEN NULL ELSE 'Standby point' END,
        standby_advisory_id = NULL,
        last_seen_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::int[])
            AS v(id, status, lng, lat, sb_lng, sb_lat, heading)
      WHERE u.id = v.id`,
    [updates.id, updates.status, updates.lng, updates.lat, updates.sbLng, updates.sbLat, updates.heading],
  );
  return counts;
}

// ── 3 · The mid-flight incidents ────────────────────────────────────────────

/**
 * Four incidents, each showing the screen something different:
 *   awaiting   — detected, not dispatched: the dispatcher's first click
 *   onscene    — a rider down, crew working at the roadside: the arrival that stopped the clock
 *   enroute    — a collision with Police acknowledged and RTA not: a breached SLA on screen
 *   transport  — a patient on the way to the engine's choice of hospital
 *
 * ALL FOUR ARE ON THE CARRIAGEWAY. The trial watches the road (config/poc.js), so no
 * resting incident is inside a building, on a floor or behind a lobby — an access chain
 * the cameras cannot see is not what this build is demonstrating, and a P1 on floor 60
 * would put the one response nobody in this trial can explain on the opening screen.
 *
 * They also sit inside the trial catchment — Silicon Oasis out to Mirdif — because the
 * trial fleet does. A resting incident across the emirate from all eight ambulances
 * would open the console on a twenty-minute response and call it normal.
 *
 * Offsets are seconds before now. Stage lengths not given come from the calibration
 * medians and the eta engine, so the story is consistent with the analytics.
 */
const SCRIPT = [
  {
    key: 'awaiting', kind: 'rta', priority: 'P2', source: 'sensor',
    place: { zone: 'Dubai Silicon Oasis', floors: [0, 3] },
    complaint: 'Two vehicles, front-end impact, both drivers out', patients: 2,
    accessNote: 'Nearside lane blocked — approach from the northbound carriageway',
    stage: 'triaged', reportedAgo: 95, triageSec: 45,
  },
  {
    key: 'onscene', kind: 'rta', priority: 'P1', source: 'sensor',
    place: { zone: 'Academic City', floors: [0, 3] },
    complaint: 'Motorcycle rider down, not moving, helmet on',
    accessNote: 'Rider in the central reservation — crew approaching against traffic',
    stage: 'onscene', onsceneAgo: 130, triageSec: 100, dispatchSec: 30, lateBy: 1.08,
  },
  {
    // Camera-raised like the rest (config/poc.js: no calls). Police are still notified
    // and acknowledge — that is the partner-agency SLA on screen, not how it was reported.
    key: 'enroute', kind: 'rta', priority: 'P2', source: 'sensor',
    place: { zone: 'International City', floors: [0, 3] },
    complaint: 'Vehicle collision, two cars, both drivers out', patients: 2,
    stage: 'enroute', enrouteAgo: 230, triageSec: 40, dispatchSec: 30,
    acknowledge: { POLICE: 40 },   // RTA never acknowledges: its SLA is breached on screen
  },
  {
    key: 'transport', kind: 'rta', priority: 'P3', source: 'sensor',
    place: { zone: 'Al Warqa', floors: [0, 3] },
    complaint: 'Pedestrian struck at low speed, walking but shaken',
    stage: 'transporting', transportingAgo: 360, onSceneCareSec: 780, triageSec: 50, dispatchSec: 35, lateBy: 0.95,
  },
];

async function pickEntrance({ zone, floors }) {
  const { rows } = await pool.query(
    `SELECT m.makani, m.floors, m.building_name, m.entrance_no, ST_X(m.geom) AS lng, ST_Y(m.geom) AS lat,
            z.id AS zone_id
       FROM makani_points m JOIN zones z ON z.id = m.zone_id
      WHERE z.name = $1 AND COALESCE(m.floors, 0) BETWEEN $2 AND $3
      ORDER BY m.entrance_no, m.makani LIMIT 1`,
    [zone, floors[0], floors[1]],
  );
  if (!rows[0]) throw new Error(`no Makani entrance in ${zone} with ${floors[0]}–${floors[1]} floors`);
  return rows[0];
}

/** A point `fraction` of the way along a path, with the bearing of travel there. */
function alongPath(coords, fraction) {
  if (!coords || coords.length < 2) return null;
  const seg = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = eta.haversineM(coords[i - 1], coords[i]);
    seg.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, target / seg[i]) : 0;
      const [a, b] = [coords[i], coords[i + 1]];
      const bearing = (Math.atan2(
        (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1],
      ) * 180) / Math.PI;
      return { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, heading: (bearing + 360) % 360 };
    }
    target -= seg[i];
  }
  return null;
}

async function build(spec) {
  const now = nowMs();
  const cal = await eta.calibration();
  const ackMed = Math.round(cal.stage.get('acknowledge')?.p50 ?? 20);
  const turnoutMed = Math.round(cal.stage.get('turnout')?.p50 ?? 40);

  const entrance = await pickEntrance(spec.place);
  // Road-only (config/poc.js): the Makani entrance is the addressable point the crew is
  // sent to, and the incident is at street level beside it. Never a floor.
  const floor = null;

  // ── Work back from now to when the call came in ────────────────────────────
  // Incidents with a unit need the unit's travel time first, so pick the unit now.
  const provisionalRow = { kind: spec.kind, priority: spec.priority, lng: entrance.lng, lat: entrance.lat, floor, zone_class: null, ref: `resting:${spec.key}` };
  const zc = await pool.query('SELECT class FROM zones WHERE id = $1', [entrance.zone_id]);
  provisionalRow.zone_class = zc.rows[0]?.class ?? 'urban';

  let unit = null;
  let rec = null;
  let travel = null;
  let route = null;
  const t = {};

  if (spec.stage === 'triaged') {
    t.reported = now - spec.reportedAgo * 1000;
    t.triaged = t.reported + spec.triageSec * 1000;
  } else {
    rec = await recommendFor(provisionalRow);
    const recs = rec.value?.recommendations ?? [];
    unit = recs.find((r) => r.canTransport) ?? recs[0];
    if (!unit) throw new Error('the dispatch engine found no unit');
    const unitNow = await fleet.unitByRef(pool, unit.unitRef);
    ({ travel, route } = await eta.travel([unitNow.lng, unitNow.lat], [entrance.lng, entrance.lat], { zoneClass: provisionalRow.zone_class, at: now }));
    unit.origin = { lng: unitNow.lng, lat: unitNow.lat };
    const travelSec = Math.round(travel.value.seconds * (spec.lateBy ?? 1));

    if (spec.stage === 'onscene') {
      t.onscene = now - spec.onsceneAgo * 1000;
      t.enroute = t.onscene - travelSec * 1000;
    } else if (spec.stage === 'enroute') {
      // Still driving: never further along than 80% of the predicted trip.
      t.enroute = now - Math.min(spec.enrouteAgo, Math.round(travelSec * 0.8)) * 1000;
    } else if (spec.stage === 'transporting') {
      t.transporting = now - spec.transportingAgo * 1000;
      t.atPatient = t.transporting - spec.onSceneCareSec * 1000;
      t.onscene = t.atPatient - 55 * 1000;
      t.enroute = t.onscene - travelSec * 1000;
    }
    t.acknowledged = t.enroute - turnoutMed * 1000;
    t.dispatched = t.acknowledged - ackMed * 1000;
    t.triaged = t.dispatched - spec.dispatchSec * 1000;
    t.reported = t.triaged - spec.triageSec * 1000;
    t.travelSec = travelSec;
  }

  // ── Write it ──────────────────────────────────────────────────────────────
  const ref = await transaction(async (c) => {
    const newRef = await incidents.nextIncidentRef(c, t.reported);
    const id = await incidents.insertIncident(c, {
      ref: newRef, kind: spec.kind, priority: spec.priority, state: 'triaged',
      lng: entrance.lng, lat: entrance.lat, makani: entrance.makani, zoneId: entrance.zone_id,
      floor, accessNote: spec.accessNote ?? null, source: spec.source,
      // A camera-raised incident has no caller. Leaving the field empty is the point:
      // it is the evidence that nobody rang, which is the claim the trial is making.
      callerName: spec.caller?.name ?? null, callerRole: spec.caller?.role ?? null, chiefComplaint: spec.complaint,
      patientsCount: spec.patients ?? 1, reportedAt: iso(t.reported), triagedAt: iso(t.triaged),
      isResting: true,
    });
    const tl = (ts, stage, label, detail = {}, agencyCode = null) =>
      incidents.insertTimeline(c, id, { ts: iso(ts), stage, label, actorKind: ACTOR.kind, actorId: ACTOR.id, agencyCode, detail });

    const where = `${spec.place.zone} — ${entrance.building_name ? `near ${entrance.building_name}` : `Makani ${entrance.makani.trim()}`}`;
    await tl(t.reported, 'reported', spec.source === 'sensor'
      ? `Detected by road camera analytics — ${where} · no call received`
      : `Call received via ${spec.source === 'call_999' ? '999 transfer' : '998'} — ${where}`);
    await tl(t.triaged, 'triaged', `Triaged ${spec.priority}`);
    return { id, ref: newRef, tl };
  }).then(async ({ id, ref: newRef }) => {
    if (!unit) return newRef;
    await dispatchResting({ id, ref: newRef, spec, entrance, unit, rec, travel, route, t, now });
    return newRef;
  });

  const summary = await incidents.incidentSummary(pool, ref);
  return {
    ref,
    summary: `${spec.priority} ${spec.kind.replace(/_/g, ' ')} · ${summary.zoneName} · ${summary.state}${summary.primary ? ` · ${summary.primary.unitRef}` : ''}`,
  };
}

async function dispatchResting({ id, ref, spec, entrance, unit, rec, travel, route, t, now }) {
  const incRow = await incidents.incidentRow(pool, ref);
  const [corr, hospitals] = await Promise.all([
    correlationFor(incRow),
    spec.stage === 'transporting' ? hospitalRecommendation(ref, null) : null,
  ]);
  const hospital = hospitals?.value?.hospitals?.[0] ?? null;
  const hospitalRow = hospital ? await fleet.hospitalByRef(pool, hospital.ref) : null;

  const rationale = {
    engine: rec.method, computedAt: rec.computedAt, window: rec.window, resting: true,
    selected: { rank: unit.rank, of: rec.value.recommendations.length, ...unit.rationale },
    recommendedTop: { unitRef: rec.value.recommendations[0].unitRef, score: rec.value.recommendations[0].rationale.score, arrivalSec: rec.value.recommendations[0].arrivalSec },
    override: null, redispatch: null, excluded: rec.value.excluded.slice(0, 6), caveats: rec.caveats,
  };

  const etaPredicted = t.dispatched + (unit.arrivalSec ?? (t.travelSec + 60)) * 1000;
  const vrtSec = t.atPatient && t.onscene ? Math.round((t.atPatient - t.onscene) / 1000) : null;

  await transaction(async (c) => {
    const u = await fleet.lockUnit(c, unit.unitRef);
    const asgRef = await fleet.nextAssignmentRef(c, id, ref);
    const asgId = await fleet.insertAssignment(c, {
      ref: asgRef, incidentId: id, unitId: u.id, isPrimary: true, offeredAt: iso(t.dispatched),
      routeCoordinates: route?.coordinates ?? null, routeSec: travel.value.seconds, routeM: travel.value.distanceM,
      etaPredictedAt: iso(etaPredicted), etaMethod: travel.method, rationale,
    });
    const state = spec.stage === 'enroute' ? 'enroute' : spec.stage === 'onscene' ? 'onscene' : 'transporting';
    await fleet.updateAssignment(c, asgId, {
      state,
      acknowledged_at: iso(t.acknowledged),
      enroute_at: iso(t.enroute),
      onscene_at: t.onscene ? iso(t.onscene) : null,
      at_patient_at: t.atPatient ? iso(t.atPatient) : null,
      transporting_at: t.transporting ? iso(t.transporting) : null,
      hospital_id: hospitalRow?.id ?? null,
      vrt_sec: vrtSec,
      route_taken_sec: t.onscene ? Math.round((t.onscene - t.enroute) / 1000) : null,
    });

    // Where the unit is now.
    let pos = { lng: entrance.lng, lat: entrance.lat, heading: null };
    let unitStatus = 'on_scene';
    if (spec.stage === 'enroute') {
      unitStatus = 'responding';
      const fraction = (now - t.enroute) / 1000 / Math.max(1, t.travelSec);
      pos = alongPath(route?.coordinates ?? [[unit.origin.lng, unit.origin.lat], [entrance.lng, entrance.lat]], fraction) ?? pos;
    } else if (spec.stage === 'transporting' && hospitalRow) {
      unitStatus = 'transporting';
      const transportSec = hospital.etaSec ?? 900;
      const fraction = (now - t.transporting) / 1000 / Math.max(1, transportSec);
      pos = alongPath([[entrance.lng, entrance.lat], [hospitalRow.lng, hospitalRow.lat]], Math.min(0.85, fraction)) ?? pos;
    }
    await c.query(
      `UPDATE units SET status = $2, current_geom = ST_SetSRID(ST_MakePoint($3,$4),4326), current_heading = $5,
              current_speed = $6, last_seen_at = $7, standby_geom = NULL, standby_reason = NULL
        WHERE id = $1`,
      [u.id, unitStatus, pos.lng, pos.lat, pos.heading, unitStatus === 'on_scene' ? 0 : 62, iso(now)],
    );

    // Correlated agencies, with measured acknowledgements where the script has them.
    const codes = (corr.value?.recommendedAgencies ?? []).map((a) => a.code).filter((code) => code !== 'DCAS');
    const notifiedAt = t.dispatched + 4000;
    const notified = await incidents.insertNotifications(c, id, codes, iso(notifiedAt));
    for (const n of notified) {
      const ackSec = spec.acknowledge?.[n.code] ?? (spec.acknowledge ? null : 26);
      if (ackSec != null) {
        await c.query(
          `UPDATE agency_notifications n SET acknowledged_at = $3 FROM agencies a
            WHERE n.agency_id = a.id AND n.incident_id = $1 AND a.code = $2`,
          [id, n.code, iso(notifiedAt + ackSec * 1000)],
        );
      }
    }

    await incidents.updateIncident(c, id, {
      state: spec.stage === 'enroute' ? 'responding' : spec.stage === 'onscene' ? 'on_scene' : 'transporting',
      dispatched_at: iso(t.dispatched),
      first_onscene_at: t.onscene ? iso(t.onscene) : null,
      first_at_patient_at: t.atPatient ? iso(t.atPatient) : null,
      addAgencies: notified.map((n) => n.code),
    });

    const tl = (ts, stage, label, detail = {}, agencyCode = 'DCAS') =>
      incidents.insertTimeline(c, id, { ts: iso(ts), stage, label, actorKind: ACTOR.kind, actorId: ACTOR.id, agencyCode, detail });
    await tl(t.dispatched, 'dispatched', `${unit.unitRef} offered — recommendation ${unit.rank} of ${rec.value.recommendations.length}`, { assignmentRef: asgRef, unitRef: unit.unitRef, rank: unit.rank });
    for (const n of notified) {
      await tl(notifiedAt, 'agency_notified', `${n.code.replace('_', ' ')} notified — acknowledge within ${n.slaSec} s`, { slaSec: n.slaSec }, n.code);
      const ackSec = spec.acknowledge?.[n.code] ?? (spec.acknowledge ? null : 26);
      if (ackSec != null) {
        await tl(notifiedAt + ackSec * 1000, 'agency_acknowledged', `${n.code.replace('_', ' ')} acknowledged in ${ackSec} s — SLA ${ackSec <= n.slaSec ? 'met' : 'breached'}`, { elapsedSec: ackSec }, n.code);
      }
    }
    await tl(t.acknowledged, 'unit_acknowledged', `${unit.unitRef} acknowledged`);
    await tl(t.enroute, 'unit_enroute', `${unit.unitRef} en route`);
    if (t.onscene) await tl(t.onscene, 'unit_onscene', `${unit.unitRef} on scene at the roadside`);
    // "Vertical access" is the lift-and-stairs time of a tower call. On a carriageway the
    // same gap is the walk from where the ambulance could stop to where the patient is,
    // so it is named for what it measures rather than for the tower it came from.
    if (t.atPatient) await tl(t.atPatient, 'crew_at_patient', `${unit.unitRef} crew with the patient — ${Math.floor(vrtSec / 60)}:${String(vrtSec % 60).padStart(2, '0')} from vehicle to patient`, { vrtSec });
    if (t.transporting && hospitalRow) await tl(t.transporting, 'transporting', `${unit.unitRef} transporting to ${hospitalRow.name}`, { hospitalRef: hospitalRow.ref });
  });
}
