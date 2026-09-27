/**
 * Operational alerts — what a DCAS duty officer must not miss, raised the moment it happens.
 *
 * Two entry points, one shape (the JBVNL advisory pattern, jbvnl_app_context.md §15.4):
 *   reactive — the in-process bus (lib/bus.js) announces a P1 call, a declined or timed-out
 *              offer, an arrival that breached its target, a re-dispatch that gave up;
 *   standing — a 5-second watch finds calls still waiting for an ambulance, a sector that
 *              has just lost its last available ambulance, an ED filling up with inbound.
 *
 * RESTRAINT IS THE FEATURE. An alert that interrupts is a debt against attention: only
 * deterioration raises (a sector that regains cover is silent), every alert has a
 * cooldown on its key, the first evaluation after start only records a baseline, and
 * `popup: false` alerts go to the bell and the feed without interrupting anyone.
 *
 * Every alert carries the action that resolves it — open the incident, dispatch the
 * recommended ambulance, relocate a unit into the gap — so reading and doing are one click.
 * Alerts live in memory: they are a live signal, not a record (the incident timeline and
 * the audit log are the record).
 */

import { randomUUID } from 'node:crypto';
import { pool } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/logger.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { pocFleet } from '../config/poc.js';
import * as fanout from '../realtime/fanout.js';
import * as incidents from '../repos/incidents.js';

const RECENT_MAX = 150;
const recent = [];
const lastRaised = new Map();
const acknowledged = new Set();

const TARGET = Object.fromEntries(jurisdiction.priorities.map((p) => [p.code, p.targetSec]));
const LABEL = {
  cardiac_arrest: 'Cardiac arrest', cardiac: 'Cardiac', stroke: 'Stroke', respiratory: 'Breathing difficulty',
  rta: 'Road traffic collision', trauma_fall: 'Fall', medical_general: 'Medical', heat_illness: 'Heat illness',
  obstetric: 'Maternity', paediatric: 'Child emergency', overdose_poisoning: 'Poisoning', burns: 'Burns',
  psychiatric: 'Mental health', workplace_injury: 'Workplace injury', drowning: 'Drowning', assault: 'Assault',
};
export const kindLabel = (k) => LABEL[k] ?? String(k ?? '').replace(/_/g, ' ');
const mmss = (sec) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.round(Math.max(0, sec)) % 60).padStart(2, '0')}`;

/**
 * @param {object} a
 * @param {string} a.key                  dedupe key — one alert per key per cooldown
 * @param {'critical'|'warning'|'info'} a.level
 * @param {string} a.category             p1 | waiting | offer | breach | coverage | hospital | redispatch | arrival
 * @param {string} a.title                one sentence, readable on a video wall
 * @param {string} [a.body]
 * @param {Array<{kind:string,label:string,payload?:object}>} [a.actions]
 * @param {number} [a.cooldownMs]
 * @param {boolean} [a.popup]             interrupt, or bell + feed only
 */
export function raise({ key, cooldownMs = 10 * 60_000, level, category, title, body = null,
  incidentRef = null, unitRef = null, zoneRef = null, priority = null, actions = [], popup = level !== 'info', speech = null }) {
  const now = Date.now();
  if (key && now - (lastRaised.get(key) ?? 0) < cooldownMs) return null;
  if (key) lastRaised.set(key, now);

  const alert = {
    id: randomUUID(), at: nowIso(), level, category, title, body,
    incidentRef, unitRef, zoneRef, priority, actions, popup, speech: speech ?? title,
  };
  recent.unshift(alert);
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
  fanout.alert(alert);
  return alert;
}

export function list(limit = 60) {
  return recent.slice(0, limit).map((a) => ({ ...a, acknowledged: acknowledged.has(a.id) }));
}

export function acknowledge(id) {
  if (!recent.some((a) => a.id === id)) return false;
  acknowledged.add(id);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Reactive — from the bus
// ═══════════════════════════════════════════════════════════════════════════════

const openAction = (ref) => ({ kind: 'open_incident', label: 'Open incident', payload: { incidentRef: ref } });
const placeOf = (s) => [s.building?.name, s.zoneName].filter(Boolean).join(', ') || 'location on the map';

function wireReactive() {
  bus.on('incident:new', (s) => {
    if (s.isResting) return;
    if (s.priority === 'P1') {
      raise({
        key: `p1:${s.ref}`, level: 'critical', category: 'p1', priority: 'P1',
        title: `P1 ${kindLabel(s.kind)} — ${placeOf(s)}${s.floor != null ? `, floor ${s.floor}` : ''}`,
        body: s.chiefComplaint ? `${s.chiefComplaint}. Target: first ambulance on scene within ${mmss(TARGET.P1)}.` : null,
        incidentRef: s.ref, zoneRef: s.zoneRef, actions: [openAction(s.ref)],
        speech: `Priority one. ${kindLabel(s.kind)} in ${s.zoneName ?? 'Dubai'}.`,
      });
    }
  });

  bus.on('assignment:update', async (p) => {
    if (p.state === 'declined' || p.state === 'timed_out') {
      raise({
        key: `offer:${p.ref}`, level: 'warning', category: 'offer', incidentRef: p.incidentRef, unitRef: p.unitRef,
        title: p.state === 'declined'
          ? `${p.unitRef} declined ${p.incidentRef} — offering the next ambulance`
          : `${p.unitRef} did not acknowledge ${p.incidentRef} in ${jurisdiction.dispatch.acknowledgeTimeoutSec} s — offering the next ambulance`,
        actions: [openAction(p.incidentRef)],
      });
      return;
    }
    if (p.state !== 'onscene') return;
    const inc = await incidents.incidentRow(pool, p.incidentRef);
    if (!inc || inc.is_resting || !inc.first_onscene_at) return;
    const responseSec = Math.round((new Date(inc.first_onscene_at) - new Date(inc.reported_at)) / 1000);
    const target = TARGET[inc.priority];
    // Only the FIRST arrival is the response; a second unit arriving is not news.
    if (Math.abs(new Date(inc.first_onscene_at) - new Date(p.at)) > 2000) return;
    const breached = target && responseSec > target;
    raise({
      key: `arrival:${p.incidentRef}`, level: breached ? 'warning' : 'info', category: breached ? 'breach' : 'arrival',
      priority: inc.priority, incidentRef: p.incidentRef, unitRef: p.unitRef,
      title: breached
        ? `${p.unitRef} reached ${p.incidentRef} in ${mmss(responseSec)} — ${mmss(responseSec - target)} over the ${inc.priority} target`
        : `${p.unitRef} on scene at ${p.incidentRef} in ${mmss(responseSec)} — within the ${inc.priority} target`,
      actions: [openAction(p.incidentRef)],
      popup: Boolean(breached && (inc.priority === 'P1' || inc.priority === 'P2')),
    });
  });

  bus.on('assignment:offer', ({ assignment, incident }) => {
    if (!incident || incident.isResting || !assignment?.etaPredictedAt) return;
    const target = TARGET[incident.priority];
    if (!target || !['P1', 'P2'].includes(incident.priority)) return;
    const predicted = Math.round((Date.parse(assignment.etaPredictedAt) - Date.parse(incident.reportedAt)) / 1000);
    if (predicted <= target) return;
    raise({
      key: `predicted:${incident.ref}`, level: 'warning', category: 'breach', priority: incident.priority,
      incidentRef: incident.ref, unitRef: assignment.unitRef,
      title: `Predicted response ${mmss(predicted)} for ${incident.ref} breaches the ${mmss(target)} ${incident.priority} target`,
      body: `${assignment.unitRef} is the best available ambulance, and it is still ${mmss(predicted - target)} too far. Consider adding the nearest rapid-response unit.`,
      actions: [openAction(incident.ref)],
    });
  });

  bus.on('incident:timeline', ({ ref, row, summary }) => {
    if (row.stage !== 'redispatch_exhausted' && row.stage !== 'redispatch_failed') return;
    raise({
      key: `redispatch:${ref}`, level: 'critical', category: 'redispatch', incidentRef: ref,
      priority: summary?.priority ?? null,
      title: `${ref} needs a dispatcher — ${row.label}`,
      actions: [openAction(ref)],
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Standing — the 5-second watch
// ═══════════════════════════════════════════════════════════════════════════════

/** Supplied by sim/live.js: incidents the AI will dispatch on its own shortly. */
let isPendingAutoDispatch = () => false;
export function setPendingCheck(fn) { isPendingAutoDispatch = fn; }

const WAIT_THRESHOLD = { P1: 45, P2: 75, P3: 150, P4: 300 };
let sectorBaseline = null;

async function waitingForDispatch() {
  const { rows } = await pool.query(`
    SELECT i.ref, i.priority, i.kind, i.reported_at, z.name AS zone_name, z.ref AS zone_ref
      FROM incidents i LEFT JOIN zones z ON z.id = i.zone_id
     WHERE i.state IN ('reported','triaged') AND NOT i.is_resting AND NOT i.is_seed
       AND i.reported_at > now() - interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.incident_id = i.id
                        AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))`);
  const now = nowMs();
  for (const r of rows) {
    const waited = Math.round((now - new Date(r.reported_at).getTime()) / 1000);
    if (waited < (WAIT_THRESHOLD[r.priority] ?? 120) || isPendingAutoDispatch(r.ref)) continue;
    raise({
      key: `waiting:${r.ref}`, cooldownMs: 4 * 60_000, level: r.priority === 'P1' ? 'critical' : 'warning',
      category: 'waiting', priority: r.priority, incidentRef: r.ref, zoneRef: r.zone_ref,
      title: `${r.priority} ${kindLabel(r.kind)} in ${r.zone_name ?? 'Dubai'} has waited ${mmss(waited)} with no ambulance`,
      body: 'Every second before dispatch is a second of response time. Dispatch the recommended ambulance now.',
      actions: [
        { kind: 'dispatch_recommended', label: 'Dispatch recommended', payload: { incidentRef: r.ref } },
        openAction(r.ref),
      ],
    });
  }
}

async function sectorCoverage() {
  const { rows } = await pool.query(`
    SELECT s.ref, s.name, ST_X(s.centroid) AS lng, ST_Y(s.centroid) AS lat,
           COUNT(u.id) FILTER (WHERE u.status IN ('available','standby'))::int AS available
      FROM zones s
      LEFT JOIN units u ON ST_Contains(s.geom, u.current_geom) AND u.archived_at IS NULL
                       AND u.kind IN ('ALS','BLS','MICU')
                       AND u.agency_id = (SELECT id FROM agencies WHERE code = 'DCAS')
     WHERE s.level = 'sector'
     GROUP BY s.ref, s.name, s.centroid`);
  const previous = sectorBaseline;
  sectorBaseline = new Map(rows.map((r) => [r.ref, r.available]));
  if (!previous) return;   // the first look is a baseline, never news

  for (const r of rows) {
    const before = previous.get(r.ref) ?? 0;
    if (!(before > 0 && r.available === 0)) continue;
    const donor = await donorUnit(r, sectorBaseline);
    raise({
      key: `coverage:${r.ref}`, cooldownMs: 12 * 60_000, level: 'warning', category: 'coverage', zoneRef: r.ref,
      title: `${r.name} has no available ambulance — the next call there waits for a unit from outside`,
      body: donor
        ? `Relocating ${donor.ref} from ${donor.sectorName} (${(donor.distanceM / 1000).toFixed(1)} km away, which keeps ${donor.left} available there) restores cover.`
        : 'No neighbouring sector can spare a unit right now.',
      actions: donor ? [{
        kind: 'relocate', label: `Relocate ${donor.ref}`,
        payload: { unitRef: donor.ref, lng: r.lng, lat: r.lat, reason: `Coverage gap in ${r.name}` },
      }] : [],
    });
  }
}

/** The nearest available ambulance in a sector that can spare one (≥ 2 available). */
async function donorUnit(target, availability) {
  const { rows } = await pool.query(`
    SELECT u.ref, s.ref AS sector_ref, s.name AS sector_name,
           ST_Distance(u.current_geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS distance_m
      FROM units u
      JOIN zones s ON s.level = 'sector' AND ST_Contains(s.geom, u.current_geom)
     WHERE u.status = 'available' AND u.archived_at IS NULL AND u.kind IN ('ALS','BLS')
       AND u.agency_id = (SELECT id FROM agencies WHERE code = 'DCAS')
       AND ($3::text[] IS NULL OR u.ref = ANY($3::text[]))
     ORDER BY distance_m LIMIT 12`, [target.lng, target.lat, pocFleet()]);
  const pick = rows.find((u) => (availability.get(u.sector_ref) ?? 0) >= 2);
  return pick ? { ref: pick.ref, sectorName: pick.sector_name, distanceM: pick.distance_m, left: availability.get(pick.sector_ref) - 1 } : null;
}

async function hospitalLoad() {
  const { rows } = await pool.query(`
    SELECT h.ref, h.name, h.ed_beds, h.ed_occupied,
           COUNT(a.id) FILTER (WHERE a.state = 'transporting')::int AS inbound
      FROM hospitals h LEFT JOIN assignments a ON a.hospital_id = h.id AND a.state = 'transporting'
     GROUP BY h.id`);
  for (const h of rows) {
    const pct = h.ed_beds ? (100 * h.ed_occupied) / h.ed_beds : 0;
    if (pct < 85 || h.inbound === 0) continue;
    raise({
      key: `hospital:${h.ref}`, cooldownMs: 20 * 60_000, level: 'warning', category: 'hospital',
      title: `${h.name} emergency department at ${Math.round(pct)}% with ${h.inbound} ambulance${h.inbound === 1 ? '' : 's'} inbound`,
      body: 'Hand-over delays keep ambulances off the road. The hospital engine will steer new transports elsewhere where the case allows.',
      actions: [],
    });
  }
}

let started = false;
export function startAlertWatch() {
  if (started) return;
  started = true;
  wireReactive();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await waitingForDispatch();
      await sectorCoverage();
      await hospitalLoad();
    } catch (err) {
      logger.warn({ err: err.message }, '[alerts] watch pass failed');
    } finally {
      running = false;
    }
  }, 5000);
  timer.unref();
}
