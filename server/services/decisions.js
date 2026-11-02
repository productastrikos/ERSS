/**
 * The AI's reasoning on one incident, as the room watches it happen.
 *
 * The whole claim of the trial is "the platform handles the emergency by itself", and a
 * claim like that is only believed if the reasoning is on the screen — which ambulances it
 * looked at, what it knew about each, why it sent the one it sent, and what happened next.
 * This service is that reasoning, written down. It invents nothing:
 *
 *   THINK     the moment a camera raises an incident, the dispatch engine is run for it,
 *             the three leading candidates' road routes are fetched, the (simulated)
 *             traffic on each is measured (sim/traffic.js), and — when the policy weighs
 *             traffic — the field is scored again with it. The result is kept here and
 *             pushed to every console (`decision:update`), so the map can draw the routes
 *             the AI is weighing while its countdown runs.
 *   COMMIT    sim/live.js commits with the traffic delays this measured, and the
 *             assignment keeps the ranked field forever (dispatch_rationale.alternatives).
 *   TRACE     `trace(ref)` turns the incident record into numbered, timestamped steps —
 *             detection, assessment, the scan, the routes, the scores, the choice, the
 *             notification, and every stage after — from the database rows, the stored
 *             rationale and this preview. It is rebuilt on every read, so it is exactly as
 *             true after a restart as before one.
 *
 * Every figure in a step is one the engine or the crew produced. Where the build models
 * something rather than measuring it (traffic), the step says so.
 */

import { pool, one } from '../lib/db.js';
import { nowIso } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { bus } from '../lib/bus.js';
import { notFound } from '../lib/errors.js';
import { emitTo, room } from '../realtime/index.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { pocFleet } from '../config/poc.js';
import { profileFor } from '../data/reference/crews.js';
import * as osrm from '../integrations/osrm.js';
import * as traffic from '../sim/traffic.js';
import * as drive from '../engines/drive.js';
import * as detection from '../engines/detection.js';
import * as dispatch from './dispatch.js';

/** incidentRef → preview. Bounded: the trial runs one story at a time. */
const previews = new Map();
const PREVIEW_MAX = 40;
/** How many of the field get road routes (with alternatives) and a drive-model check. */
const ROUTED = 4;
/** `${incidentRef}|${unitRef}` → the raw road chosen for that unit (coords, steps, speeds) —
 *  kept off the socket; the crew drives exactly this (sim/live.js). */
const chosenRoads = new Map();

/** Hooks the live simulation fills in, so this module never imports it (it imports us). */
const providers = {
  /** @type {(ref: string) => null | { dueAt: string, windowSec: number, held: boolean }} */
  pending: () => null,
  /** @type {(asgRef: string) => null | { remainingM: number, speedKmh: number, trafficAhead: object[] }} */
  live: () => null,
};
export function setProviders(p) { Object.assign(providers, p); }

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const min = (sec) => `${mmss(sec)} min`;
const km = (m) => `${(Math.max(0, m ?? 0) / 1000).toFixed(1)} km`;
const pct = (v) => `${Math.round(v * 100)}%`;
const clockGst = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' });
const secsBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));

function remember(p) {
  previews.delete(p.incidentRef);
  previews.set(p.incidentRef, p);
  while (previews.size > PREVIEW_MAX) previews.delete(previews.keys().next().value);
}

function publish(p) {
  emitTo(room.consoleFleet, 'decision:update', p);
}

export const previewFor = (ref) => previews.get(ref) ?? null;
/** The traffic delay per candidate the preview measured — handed to the commit. */
export const delaysFor = (ref) => {
  const p = previews.get(ref);
  return p && Object.keys(p.delays).length ? p.delays : null;
};
/** The drive-model time on the road chosen for each routed candidate — handed to the commit. */
export const routeTimesFor = (ref) => {
  const p = previews.get(ref);
  return p?.routeTimes && Object.keys(p.routeTimes).length ? p.routeTimes : null;
};
/** The exact road the AI chose for one unit on one incident: { coords, steps, speeds }. */
export const chosenRoad = (ref, unitRef) => chosenRoads.get(`${ref}|${unitRef}`) ?? null;

/**
 * The best road for one journey, and why — the main route and the router's alternatives,
 * each driven through the drive model (engines/drive.js) with the simulated traffic on it.
 * Null when routing does not answer at all.
 */
export async function bestRoad(from, to, { at = Date.now(), queues = null, mode = 'emergency' } = {}) {
  const q = queues ?? await traffic.activeQueues();
  let raw = await osrm.routeOptions(from, to).catch(() => null);
  if (!raw?.length) {
    const road = await osrm.route(from, to, { timeoutMs: osrm.BACKGROUND_TIMEOUT_MS, attempts: 2, background: true }).catch(() => null);
    if (!road?.coordinates?.length) return null;
    raw = [{ distanceM: Math.round(road.distanceM), durationSec: Math.round(road.durationSec), coords: road.coordinates, steps: [], speeds: [] }];
  }
  const analysed = raw.map((o) => {
    const a = drive.analyse(o, { mode });
    if (!a) return null;
    const jam = mode === 'emergency' ? traffic.analyseRoute(o.coords, { at, queues: q }) : { segments: [], congestedM: 0 };
    return { a: drive.withTraffic(a, jam.segments), jam, raw: o };
  }).filter(Boolean)
    .sort((x, y) => x.a.timeWithTrafficSec - y.a.timeWithTrafficSec);
  if (!analysed.length) return null;
  const [best, ...others] = analysed;
  return {
    best, others,
    why: others.length ? drive.whyRoute(best.a, others[0].a) : [],
  };
}

/** A road chosen by `bestRoad`, as the preview and the AI log carry it. */
function roadView(road, { withOptionPaths = false } = {}) {
  const { best, others, why } = road;
  return {
    path: best.raw.coords,
    distanceM: best.a.totalM,
    driveSec: best.a.timeSec,
    timeSec: best.a.timeWithTrafficSec,
    delaySec: best.a.trafficDelaySec,
    congestedM: best.jam.congestedM ?? 0,
    traffic: (best.jam.segments ?? []).map((s) => ({ level: s.level, cause: s.cause, lengthM: s.lengthM, delaySec: s.delaySec, fromM: s.fromM, path: s.path })),
    stats: drive.summary(best.a),
    why,
    options: [best, ...others].map((x, i) => ({
      label: String.fromCharCode(65 + i),
      chosen: i === 0,
      osrmSec: x.raw.durationSec,
      ...drive.summary(x.a, { withPath: withOptionPaths }),
    })),
  };
}

/**
 * The whole decision as it stood — every ambulance weighed, every road compared, the
 * choice and the field it was chosen from — for the kept AI log (services/aiLog.js), so a
 * replay months later can show the alternatives, not only the winner.
 */
export function snapshot(ref) {
  const p = previews.get(ref);
  if (!p || p.stub || p.status === 'thinking') return null;
  return {
    status: p.status, startedAt: p.startedAt, readyAt: p.readyAt, thinkMs: p.thinkMs,
    requirement: p.requirement, confidence: p.confidence, chosen: p.chosen, firstChoice: p.firstChoice,
    baseline: p.baseline, nearest: p.nearest,
    policy: p.policy ? { mode: p.policy.mode, trafficApplied: p.policy.trafficApplied, weights: p.policy.rules?.weights ?? null, windowSec: p.policy.rules?.windowSec ?? null } : null,
    fleet: p.fleet.map((u) => ({ ref: u.ref, callsign: u.callsign, kind: u.kind, status: u.status, position: u.position, onIncident: u.onIncident })),
    excluded: p.excluded,
    candidates: p.candidates,
    legs: p.legs ?? {},
    notes: p.notes ?? [],
  };
}

/**
 * A road chosen after dispatch — the transport leg to hospital (sim/live.js) — written onto
 * the incident's story so the AI log explains that choice too.
 */
export function noteLeg(ref, leg, info) {
  let p = previews.get(ref);
  if (!p) {
    // The decision itself was made before a restart and is gone from memory; the leg is
    // still worth telling. A bare record holds it — every reader falls back to the stored
    // rationale for the rest.
    p = {
      stub: true, incidentRef: ref, status: 'ready', startedAt: null, readyAt: null, thinkMs: null,
      fleet: [], candidates: [], excluded: [], delays: {}, routeTimes: {}, requirement: null, policy: null,
      confidence: null, firstChoice: null, chosen: null, baseline: null, nearest: null, notes: [], legs: {}, error: null,
    };
    remember(p);
  }
  p.legs = { ...(p.legs ?? {}), [leg]: { ...info, at: info.at ?? nowIso() } };
  publish(p);
}

/** Something the automatic dispatcher decided NOT to do yet, and why (reserve, rule, no unit). */
export function note(ref, key, text, tone = 'warn') {
  const p = previews.get(ref);
  if (!p) return;
  const last = p.notes[p.notes.length - 1];
  if (last?.key === key) return;   // said once, not every retry
  p.notes.push({ key, text, tone, at: nowIso() });
  publish(p);
}

// ── The fleet as the AI saw it ───────────────────────────────────────────────

async function fleetSnapshot() {
  const { rows } = await pool.query(`
    SELECT u.ref, u.callsign, u.kind, u.status, ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
           (SELECT i.ref FROM assignments a JOIN incidents i ON i.id = a.incident_id
             WHERE a.unit_id = u.id AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')
             ORDER BY a.offered_at DESC LIMIT 1) AS on_incident
      FROM units u JOIN agencies ag ON ag.id = u.agency_id
     WHERE ag.code = 'DCAS' AND u.archived_at IS NULL
       AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))
     ORDER BY u.callsign`, [pocFleet()]);
  return rows.map((r) => ({
    ref: r.ref, callsign: r.callsign, kind: r.kind, status: r.status,
    position: r.lng != null ? [r.lng, r.lat] : null, onIncident: r.on_incident,
  }));
}

function nearestByDistance(recs) {
  return [...recs].filter((r) => r.straightM != null).sort((a, b) => a.straightM - b.straightM)[0] ?? null;
}

// ── THINK ────────────────────────────────────────────────────────────────────

/**
 * Run the engine for an incident, route its leading candidates and weigh their traffic.
 * Never throws: a failure is a preview with `status: 'failed'`, and dispatch carries on
 * without traffic.
 */
export async function think(ref) {
  const started = Date.now();
  const prior = previews.get(ref);
  const p = {
    incidentRef: ref, status: 'thinking', startedAt: nowIso(), readyAt: null, thinkMs: null,
    fleet: [], candidates: [], excluded: [], delays: {}, routeTimes: {}, requirement: null, policy: null,
    confidence: null, firstChoice: null, chosen: null, baseline: null, nearest: null,
    notes: prior?.notes ?? [], legs: prior?.legs ?? {}, error: null,
  };
  remember(p);
  publish(p);
  try {
    const inc = await dispatch.loadIncident(ref, null);
    const [first, fleet, queues] = await Promise.all([dispatch.recommendFor(inc), fleetSnapshot(), traffic.activeQueues()]);
    p.fleet = fleet;
    const byRef = new Map(fleet.map((u) => [u.ref, u]));
    const recs = first.value?.recommendations ?? [];
    // Traffic is judged at the moment the camera saw the incident, so the drive the crew
    // makes (sim/live.js planRoute) meets the same queues the AI weighed.
    const at = Date.parse(inc.reported_at) || Date.now();

    // Every leading candidate's ROAD, not its straight line: the router's main route and
    // its alternatives, each driven through the drive model — cruise by road class, braking
    // for every turn, roundabout and U-turn — with the traffic on it. The best road per
    // ambulance is what the field is then ranked on.
    const roads = {};
    const routeOne = async (unitRef) => {
      if (roads[unitRef] !== undefined) return;
      roads[unitRef] = null;
      const from = byRef.get(unitRef)?.position;
      if (!from) return;
      const road = await bestRoad(from, [inc.lng, inc.lat], { at, queues });
      if (!road) return;
      roads[unitRef] = road;
      chosenRoads.set(`${ref}|${unitRef}`, road.best.raw);
      while (chosenRoads.size > 240) chosenRoads.delete(chosenRoads.keys().next().value);
      p.delays[unitRef] = road.best.a.trafficDelaySec;
      p.routeTimes[unitRef] = { sec: road.best.a.timeSec, m: road.best.a.totalM };
    };
    await Promise.all(recs.slice(0, ROUTED).map((r) => routeOne(r.unitRef)));

    let final = Object.keys(p.routeTimes).length
      ? await dispatch.recommendFor(inc, { trafficDelays: p.delays, routeTimes: p.routeTimes })
      : first;
    // Re-ranking on real roads can lift an ambulance that was not routed to the top: route
    // it too, and rank once more, so the choice is never made on a straight-line guess.
    const top = final.value?.recommendations?.[0];
    if (top && roads[top.unitRef] === undefined) {
      await routeOne(top.unitRef);
      final = await dispatch.recommendFor(inc, { trafficDelays: p.delays, routeTimes: p.routeTimes });
    }
    const ranked = final.value?.recommendations ?? [];
    const base = nearestByDistance(ranked);

    p.candidates = ranked.slice(0, 5).map((r, i) => ({
      unitRef: r.unitRef, callsign: r.callsign, kind: r.kind, rank: r.rank,
      score: r.rationale.score, arrivalSec: r.arrivalSec, travelSec: r.travelSec,
      distanceM: r.distanceM, straightM: r.straightM, trafficDelaySec: r.trafficDelaySec ?? 0,
      canTransport: r.canTransport, position: byRef.get(r.unitRef)?.position ?? null,
      route: roads[r.unitRef] ? roadView(roads[r.unitRef], { withOptionPaths: i === 0 }) : null,
      factors: r.rationale.factors.map((f) => ({ key: f.key, name: f.name, weight: f.weight, score: f.score, contribution: f.contribution, detail: f.detail })),
    }));
    p.excluded = final.value?.excluded ?? [];
    p.requirement = final.value?.requirement ?? null;
    p.policy = final.policy ?? null;
    p.confidence = final.confidence ?? null;
    p.firstChoice = recs[0]?.unitRef ?? null;
    p.chosen = ranked[0]?.unitRef ?? null;
    p.baseline = base ? { unitRef: base.unitRef, callsign: base.callsign, straightM: base.straightM, arrivalSec: base.arrivalSec } : null;
    // The nearest FREE ambulance as the crow flies, qualifying or not — "why not the one
    // that is closest?" is the first question anyone in the room asks.
    const near = fleet
      .filter((u) => (u.status === 'available' || u.status === 'standby') && u.position)
      .map((u) => ({ ...u, straightM: Math.round(traffic.haversine(u.position, [inc.lng, inc.lat])) }))
      .sort((a, b) => a.straightM - b.straightM)[0] ?? null;
    if (near) {
      if (roads[near.ref] === undefined) await routeOne(near.ref);
      const ex = p.excluded.find((e) => e.unitRef === near.ref);
      const nearRoad = roads[near.ref] ?? null;
      p.nearest = {
        unitRef: near.ref, callsign: near.callsign, kind: near.kind, straightM: near.straightM,
        excluded: ex?.reason ?? null,
        road: nearRoad ? drive.summary(nearRoad.best.a) : null,
      };
    }
    if (ranked[0]?.paired) {
      p.notes = [...p.notes.filter((n) => n.key !== 'paired'), { key: 'paired', tone: 'good', at: nowIso(), text: ranked[0].pairedWhy }];
    }
    p.status = ranked.length ? 'ready' : 'no_unit';
  } catch (err) {
    p.status = 'failed';
    p.error = err.message;
    logger.warn({ err: err.message, ref }, '[decisions] preview failed — dispatch continues without traffic');
  }
  p.readyAt = nowIso();
  p.thinkMs = Date.now() - started;
  publish(p);
  bus.publish('decision:ready', { incidentRef: ref, status: p.status });
  return p;
}

let wired = false;
/** Every new live incident is thought about the moment it exists. */
export function wireDecisions() {
  if (wired) return;
  wired = true;
  bus.on('incident:new', (s) => {
    if (s?.isResting || !s?.ref) return;
    void think(s.ref);
  });
  // The incidents these were about are gone after a PoC restart.
  bus.on('sim:reset', () => {
    previews.clear();
    chosenRoads.clear();
  });
}

// ── TRACE ────────────────────────────────────────────────────────────────────

const KIND_LABEL = {
  rta: 'Road traffic collision', cardiac_arrest: 'Cardiac arrest', trauma: 'Trauma', medical_general: 'Medical emergency',
};
const kindLabel = (k) => KIND_LABEL[k] ?? String(k ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const STATUS_WORD = {
  available: 'free', standby: 'free at a standby point', assigned: 'just assigned', responding: 'on a job',
  on_scene: 'on scene', transporting: 'transporting a patient', at_hospital: 'at hospital', off_duty: 'off duty',
  relocating: 'relocating', out_of_service: 'out of service',
};

function requirementText(req) {
  if (!req) return null;
  const need = req.required?.length ? req.required.map((c) => c.toUpperCase()).join(', ') : 'any ambulance';
  const pref = req.preferred?.length ? req.preferred.join(' › ') : null;
  return pref ? `Needs ${need} · prefers ${pref}` : `Needs ${need}`;
}

/**
 * Every step of the incident so far, oldest first, plus what the screen needs beside the
 * log: the candidates (for the map), the chosen crew, the live drive and the countdown.
 */
export async function trace(ref, actor) {
  await dispatch.loadIncident(ref, actor);   // scope check — throws not-found outside it
  const inc = await one(`
    SELECT i.id, i.ref, i.kind, i.priority, i.state, i.outcome, i.source, i.chief_complaint, i.access_note,
           i.patients_count, i.reported_at, i.triaged_at, i.dispatched_at, i.first_onscene_at, i.closed_at,
           i.is_resting, ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat, z.name AS zone_name
      FROM incidents i LEFT JOIN zones z ON z.id = i.zone_id WHERE i.ref = $1`, [ref]);
  if (!inc) throw notFound('Incident');

  const [{ rows: asgs }, { rows: tl }] = await Promise.all([
    pool.query(`
      SELECT a.ref, a.state, a.is_primary, a.offered_at, a.acknowledged_at, a.declined_at, a.decline_reason,
             a.enroute_at, a.onscene_at, a.at_patient_at, a.transporting_at, a.at_hospital_at, a.cleared_at,
             a.eta_predicted_at, a.route_proposed_sec, a.route_proposed_m, a.dispatch_rationale AS rationale,
             u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
             h.ref AS hospital_ref, h.name AS hospital_name, h.ed_beds, h.ed_occupied, h.on_diversion
        FROM assignments a JOIN units u ON u.id = a.unit_id LEFT JOIN hospitals h ON h.id = a.hospital_id
       WHERE a.incident_id = $1 ORDER BY a.offered_at`, [inc.id]),
    pool.query(`SELECT ts, stage, label, actor_id, detail FROM incident_timeline WHERE incident_id = $1 ORDER BY ts, id`, [inc.id]),
  ]);

  const target = jurisdiction.priorities.find((p) => p.code === inc.priority)?.targetSec ?? 480;
  const preview = previews.get(ref) ?? null;
  const det = detection.forIncident(ref);
  const reported = new Date(inc.reported_at).toISOString();
  const primary = asgs.find((a) => a.is_primary && !['declined', 'cancelled'].includes(a.state)) ?? asgs[asgs.length - 1] ?? null;
  const rat = primary?.rationale ?? null;
  const steps = [];
  const add = (s) => steps.push({ state: 'done', tone: 'info', items: [], ...s });

  // 1 · Detected
  const reportedRow = tl.find((r) => r.stage === 'reported');
  const detectedBy = reportedRow?.detail?.detectedBy ?? null;
  // A routine road incident's access note is "<what> — <road>"; the headline detection
  // carries its own place and verdict, which say it better.
  const place = det?.place?.name ?? (inc.access_note?.split(' — ').slice(1).join(' — ') || inc.zone_name || 'the carriageway');
  const what = det?.verdict?.label ?? inc.access_note?.split(' — ')[0] ?? kindLabel(inc.kind);
  if (inc.source === 'sensor') {
    add({
      key: 'detected', at: reported, tone: 'bad',
      title: `Camera detected: ${what}`,
      detail: `${detectedBy ?? 'Road camera analytics'} · ${place} · no 998 call received`,
      items: det ? [
        ...det.corroboration.slice(0, 3).map((c) => ({ label: c.source, value: c.result })),
        ...(det.verdict ? [{ label: 'AI verdict', value: `${det.verdict.label} · ${det.verdict.severity} · ${pct(det.verdict.confidence)} confidence`, tone: 'ai' }] : []),
      ] : [],
    });
  } else {
    add({ key: 'detected', at: reported, title: 'Call received', detail: reportedRow?.label ?? place });
  }

  // 2 · Assessed
  const req = preview?.requirement ?? rat?.requirement ?? null;
  add({
    key: 'assessed', at: new Date(inc.triaged_at ?? inc.reported_at).toISOString(), tone: inc.priority === 'P1' ? 'bad' : 'info',
    title: `Assessed ${inc.priority} · ${kindLabel(inc.kind)}`,
    detail: inc.chief_complaint ?? null,
    items: [
      { label: 'Target', value: `first ambulance on scene within ${min(target)}` },
      { label: 'Patients', value: `${inc.patients_count} ${inc.patients_count === 1 ? 'patient' : 'patients'}` },
      ...(requirementText(req) ? [{ label: 'Crew', value: requirementText(req) }] : []),
    ],
  });

  // 3 · Scanned
  const alts = preview?.candidates?.length ? preview.candidates : (rat?.alternatives ?? []);
  if (preview?.fleet?.length) {
    const free = preview.fleet.filter((u) => u.status === 'available' || u.status === 'standby');
    const busy = preview.fleet.length - free.length;
    const byUnit = new Map(alts.map((c) => [c.unitRef, c]));
    add({
      key: 'scanned', at: preview.startedAt, tone: 'ai',
      title: `Checked all ${preview.fleet.length} trial ambulances`,
      detail: `${free.length} free · ${busy} busy on other jobs`,
      unitRefs: preview.fleet.map((u) => u.ref),
      items: preview.fleet.map((u) => {
        const c = byUnit.get(u.ref);
        const free1 = u.status === 'available' || u.status === 'standby';
        const ex = preview.excluded.find((e) => e.unitRef === u.ref);
        const away = u.position ? traffic.haversine(u.position, [inc.lng, inc.lat]) : null;
        return {
          label: `${u.callsign} · ${u.kind}`,
          value: free1
            ? (ex ? `free — ruled out: ${ex.reason}` : `free · ${km(c?.straightM ?? away)} away${c || preview.status === 'thinking' ? '' : ' — not among the closest'}`)
            : `${STATUS_WORD[u.status] ?? u.status}${u.onIncident && u.onIncident !== ref ? ` (${u.onIncident})` : ''}`,
          tone: free1 && !ex ? 'good' : 'muted',
        };
      }),
    });
  } else if (alts.length) {
    add({ key: 'scanned', at: rat?.computedAt ?? primary?.offered_at ?? reported, tone: 'ai',
      title: `Scored ${alts.length} free ${alts.length === 1 ? 'ambulance' : 'ambulances'}`,
      detail: rat?.excluded?.length ? `${rat.excluded.length} ruled out: ${rat.excluded.map((e) => `${e.callsign ?? e.unitRef} (${e.reason})`).join(', ')}` : null,
      unitRefs: alts.map((c) => c.unitRef) });
  }

  // 4 · Routed — every leading candidate's real road, driven through the drive model
  const routed = alts.filter((c) => c.route);
  if (routed.length) {
    add({
      key: 'routed', at: preview.readyAt ?? preview.startedAt, tone: 'ai',
      title: `Drove the roads for the ${routed.length} closest — ${routed.reduce((s, c) => s + (c.route.options?.length ?? 1), 0)} routes compared`,
      detail: 'Each road timed with the ambulance braking for every turn, roundabout and U-turn, cruising by road class, and the traffic on it'
        + `${preview.policy?.trafficApplied ? '' : ' (traffic shown, not weighed)'} · traffic is simulated in this build`,
      unitRefs: routed.map((c) => c.unitRef),
      items: routed.map((c) => {
        const r = c.route;
        const s = r.stats;
        const slow = r.traffic.length;
        return {
          label: c.callsign,
          value: s
            ? `${km(s.distanceM)} · ${drive.manoeuvreText(s.counts)} · ${pct(s.majorShare)} main roads · ${min(r.timeSec)}${slow ? ` incl. +${mmss(r.delaySec)} traffic` : ''}`
            : `${km(r.distanceM)} by road${slow ? ` · +${mmss(r.delaySec)} traffic` : ''}`,
          tone: r.delaySec >= 45 ? 'warn' : 'info',
        };
      }),
    });
  }

  // 4b · The road for the ambulance it is about to send — which way, and why that way
  const chosenAlt = alts.find((c) => c.unitRef === (primary?.unit_ref ?? preview?.chosen));
  const road = chosenAlt?.route;
  if (road?.stats) {
    const others = (road.options ?? []).filter((o) => !o.chosen);
    add({
      key: 'route', at: preview.readyAt ?? preview.startedAt, tone: 'ai',
      title: `Best road for ${chosenAlt.callsign}${road.stats.via ? `: ${road.stats.via}` : ''}`,
      detail: others.length && road.why?.length
        ? `Over the alternative via ${others[0].via ?? 'other streets'}: ${road.why.join('; ')}.`
        : `${road.stats.text}. ${others.length ? 'Alternatives were slower.' : 'The router found no reasonable alternative.'}`,
      unitRefs: [chosenAlt.unitRef],
      items: (road.options ?? []).map((o) => ({
        label: `${o.chosen ? '✓ ' : ''}Road ${o.label}${o.via ? ` · ${o.via}` : ''}`,
        value: `${km(o.distanceM)} · ${drive.manoeuvreText(o.counts)} · avg ${o.avgKmh} km/h · ${min(o.timeSec)}`,
        tone: o.chosen ? 'ai' : 'muted',
      })),
    });
  }

  // 5 · Scored
  const weights = preview?.policy?.rules?.weights ?? rat?.weights ?? null;
  if (alts.length && weights) {
    add({
      key: 'scored', at: preview?.readyAt ?? rat?.computedAt ?? reported, tone: 'ai',
      title: `Scored on arrival ${pct(weights.travel)} · capability ${pct(weights.capability)} · coverage ${pct(weights.coverage)} · crew ${pct(weights.crew)}`,
      detail: (preview?.policy ?? rat?.policy)?.mode === 'custom'
        ? 'Weights fixed by a duty officer (custom rules)'
        : ((preview?.policy ?? rat?.policy)?.notes?.[0] ?? 'Weights set by the AI'),
      unitRefs: alts.slice(0, 4).map((c) => c.unitRef),
      items: alts.slice(0, 4).map((c) => ({
        label: `#${c.rank} ${c.callsign} · ${c.kind}`,
        value: `score ${c.score.toFixed(3)} · arrives in ${min(c.arrivalSec)}${c.trafficDelaySec ? ` (incl. +${mmss(c.trafficDelaySec)} traffic)` : ''}`,
        tone: c.rank === 1 ? 'ai' : 'muted',
      })),
    });
  }

  // 6 · Decided
  const chosenRef = primary?.unit_ref ?? preview?.chosen ?? null;
  const chosen = alts.find((c) => c.unitRef === chosenRef) ?? null;
  if (chosen) {
    const base = preview?.baseline ?? (rat?.baseline ? { ...rat.baseline, callsign: alts.find((c) => c.unitRef === rat.baseline.unitRef)?.callsign } : null);
    const baseCall = base?.callsign ?? base?.unitRef;
    const saved = base && base.unitRef !== chosen.unitRef ? Math.max(0, Math.round((base.arrivalSec ?? 0) - chosen.arrivalSec)) : 0;
    const why = [];
    const next = alts.find((c) => c.rank === (chosen.rank ?? 1) + 1) ?? null;
    const tie = next && Math.abs(next.arrivalSec - chosen.arrivalSec) <= 5;
    const capOf = (c) => c?.factors?.find((f) => f.key === 'capability')?.score ?? null;
    const near = preview?.nearest ?? null;
    const isNearest = (!near || near.unitRef === chosen.unitRef) && (!base || base.unitRef === chosen.unitRef);

    if (isNearest) why.push(`${chosen.callsign} is the nearest free ambulance and also the fastest by road`);
    else if (near && near.unitRef !== chosen.unitRef && near.excluded) {
      // The closest one could not take it — say so first, in the room's terms.
      why.push(`${near.callsign} is closest (${km(near.straightM)} as the crow flies) but was ruled out — ${near.excluded}${inc.kind === 'cardiac_arrest' ? '; a collapsed patient needs an advanced-life-support crew (defibrillation, airway, drugs)' : ''}`);
      if (near.road) why.push(`its road is ${km(near.road.distanceM)} with ${drive.manoeuvreText(near.road.counts)} anyway`);
    } else if (near && near.unitRef !== chosen.unitRef && near.road && chosen.route?.stats) {
      why.push(`${near.callsign} is closer as the crow flies (${km(near.straightM)}) but its road is ${km(near.road.distanceM)} with ${drive.manoeuvreText(near.road.counts)} — ${chosen.callsign} arrives ${min(Math.max(0, near.road.timeSec - chosen.route.timeSec))} sooner`);
    } else if (saved > 0) why.push(`${chosen.callsign} arrives ${min(saved)} sooner than sending the nearest one (${baseCall})`);
    else why.push(`${chosen.callsign} scores highest overall`);

    // Speed against capability, stated when it was the trade-off actually made.
    const prefs = (preview?.requirement ?? rat?.requirement)?.preferred ?? [];
    const better = alts.find((c) => c.rank > chosen.rank && prefs.indexOf(c.kind) !== -1 && (prefs.indexOf(chosen.kind) === -1 || prefs.indexOf(c.kind) < prefs.indexOf(chosen.kind)));
    const tradeOff = better && better.arrivalSec - chosen.arrivalSec >= 30 ? better : null;
    const roadOf = (c) => (c.route?.stats ? ` (${km(c.route.stats.distanceM)}, ${drive.manoeuvreText(c.route.stats.counts)})` : '');
    if (next && !tie && next !== tradeOff && next.arrivalSec - chosen.arrivalSec >= 20) {
      why.push(`next best ${next.callsign} (${next.kind}) is ${min(next.arrivalSec - chosen.arrivalSec)} behind${roadOf(next)}`);
    }
    if (tradeOff) {
      why.push(`the nearest ${tradeOff.kind} crew, ${tradeOff.callsign}, is ${min(tradeOff.arrivalSec - chosen.arrivalSec)} further away${roadOf(tradeOff)} — on a ${inc.priority} the first crew on scene matters most; the ${chosen.kind} crew starts care and can call ${tradeOff.kind} support`);
    }
    if (tie && capOf(chosen) != null && capOf(chosen) > (capOf(next) ?? 0)) {
      why.push(`it is level with ${next.callsign} on arrival, and its ${chosen.kind} crew is the better match for ${inc.priority === 'P1' ? 'a P1' : 'this call'}`);
    }
    const firstCall = alts.find((c) => c.unitRef === preview?.firstChoice)?.callsign;
    if (preview?.firstChoice && preview.firstChoice !== chosen.unitRef) {
      why.push(`${firstCall ?? preview.firstChoice} looked best on distance alone; driving the real roads${preview.policy?.trafficApplied ? ' and their traffic' : ''} changed the choice`);
    }
    const conf = preview?.confidence ?? rat?.confidence ?? null;
    add({
      key: 'decided', at: preview?.readyAt ?? rat?.computedAt ?? primary?.offered_at ?? reported, tone: 'ai',
      title: `Chose ${chosen.callsign} · arrives in ${min(chosen.arrivalSec)}`,
      detail: `${why.join('; ')}.`,
      unitRefs: [chosen.unitRef],
      items: [
        ...(conf != null ? [{
          label: 'Confidence',
          value: tie ? `arrival is a near-tie with ${next.callsign} — crew type decided it` : `${pct(conf)} that it arrives before ${next?.callsign ?? 'the next best'}`,
          tone: 'ai',
        }] : []),
        ...(primary && primary.unit_ref !== preview?.chosen && preview?.chosen
          ? [{ label: 'Re-checked at dispatch', value: `fleet had moved on — sent ${primary.callsign} instead`, tone: 'warn' }] : []),
      ],
    });
  } else if (preview?.status === 'thinking') {
    add({ key: 'thinking', at: preview.startedAt, tone: 'ai', state: 'active', title: 'Weighing ambulances, routes and traffic…',
      unitRefs: (preview.candidates ?? []).slice(0, 3).map((c) => c.unitRef) });
  }

  // Held / waiting notes from the automatic dispatcher (reserve rule, manual priority, no unit).
  for (const n of preview?.notes ?? []) {
    if (primary && Date.parse(n.at) > Date.parse(primary.offered_at)) continue;
    // A hold is a consequence of the choice, so it reads after it even when the rule was
    // applied while the routes were still being fetched.
    const at = preview?.readyAt && Date.parse(preview.readyAt) > Date.parse(n.at) ? preview.readyAt : n.at;
    add({ key: `note:${n.key}`, at, tone: n.tone, title: n.text, state: primary ? 'done' : 'active' });
  }

  // 7 · Countdown, or the dispatch itself
  const pending = providers.pending(ref);
  if (!primary && pending) {
    const left = Math.max(0, Math.ceil((Date.parse(pending.dueAt) - Date.now()) / 1000));
    add({
      key: 'countdown', at: nowIso(), tone: 'ai', state: 'active',
      title: `Dispatching automatically in ${left} s`,
      detail: `Rule: ${inc.priority} is sent after a ${pending.windowSec} s window, so the room can see the choice and step in`,
    });
  }

  for (const a of asgs) {
    const profile = profileFor(a.unit_ref, a.unit_kind);
    const offeredRow = tl.find((r) => (r.stage === 'dispatched' || r.stage === 'redispatched') && r.detail?.assignmentRef === a.ref);
    const byAi = !offeredRow || /AI auto-dispatch|automatic re-dispatch/.test(offeredRow.label);
    add({
      key: `dispatched:${a.ref}`, at: new Date(a.offered_at).toISOString(), tone: 'ai',
      title: `Job sent to ${a.callsign}${offeredRow?.stage === 'redispatched' ? ' (re-dispatch)' : ''}`,
      detail: profile
        ? `Crew tablet notified — ${profile.driver?.name} (driver) and ${profile.lead?.name} (${profile.lead?.title.toLowerCase()})`
        : 'Crew tablet notified',
      unitRefs: [a.unit_ref],
      items: [
        { label: 'Dispatched by', value: byAi ? 'AI · automatic' : offeredRow?.actor_id ?? 'dispatcher', tone: byAi ? 'ai' : 'info' },
        ...(a.rationale?.override ? [{ label: 'Override', value: a.rationale.override.reason, tone: 'warn' }] : []),
        ...(a.eta_predicted_at ? [{ label: 'Predicted arrival', value: `${clockGst(a.eta_predicted_at)} · ${min(secsBetween(reported, a.eta_predicted_at))} after the alert` }] : []),
      ],
    });
    if (a.acknowledged_at) {
      add({ key: `ack:${a.ref}`, at: new Date(a.acknowledged_at).toISOString(), tone: 'good',
        title: `${a.callsign} acknowledged in ${secsBetween(a.offered_at, a.acknowledged_at)} s`, unitRefs: [a.unit_ref] });
    }
    if (a.declined_at) {
      add({ key: `declined:${a.ref}`, at: new Date(a.declined_at).toISOString(), tone: 'warn',
        title: `${a.callsign} could not take it`, detail: a.decline_reason ?? 'The AI offers the next best ambulance', unitRefs: [a.unit_ref] });
    }
    if (a.enroute_at) {
      const theRoad = a.unit_ref === chosenAlt?.unitRef ? road?.stats : null;
      add({ key: `enroute:${a.ref}`, at: new Date(a.enroute_at).toISOString(), tone: 'info',
        title: `${a.callsign} rolling — lights and siren`,
        detail: theRoad
          ? `${km(theRoad.distanceM)} to the scene${theRoad.via ? ` via ${theRoad.via}` : ''} · ${drive.manoeuvreText(theRoad.counts)} · top ${theRoad.topKmh} km/h on the straights`
          : a.route_proposed_m ? `${km(a.route_proposed_m)} by road to the scene` : null,
        items: a.acknowledged_at ? [{ label: 'Turnout', value: `${secsBetween(a.acknowledged_at, a.enroute_at)} s from acknowledging to wheels rolling` }] : [],
        unitRefs: [a.unit_ref] });
    }
    // Live: the drive in progress
    if (a.enroute_at && !a.onscene_at && ['enroute', 'acknowledged'].includes(a.state)) {
      const live = providers.live(a.ref);
      const etaLeft = a.eta_predicted_at ? Math.round((Date.parse(a.eta_predicted_at) - Date.now()) / 1000) : null;
      const nextJam = live?.trafficAhead?.[0] ?? null;
      const turn = live?.next ?? null;
      add({
        key: `driving:${a.ref}`, at: nowIso(), tone: etaLeft != null && etaLeft < 0 ? 'bad' : 'info', state: 'active',
        title: live ? `Driving · ${km(live.remainingM)} to go${etaLeft != null ? ` · ETA ${etaLeft >= 0 ? min(etaLeft) : `${min(-etaLeft)} late`}` : ''}` : 'Driving to the scene',
        detail: nextJam
          ? `${nextJam.level === 'heavy' ? 'Heavy' : 'Slow'} traffic ${nextJam.inM > 30 ? `in ${Math.round(nextJam.inM)} m` : 'now'} for ${Math.round(nextJam.lengthM)} m${nextJam.cause === 'collision' ? ' — the queue behind the collision' : ''} · +${mmss(nextJam.delaySec)} min (simulated)`
          : live ? 'Clear road ahead (simulated traffic)' : null,
        items: [
          ...(live?.speedKmh != null ? [{ label: 'Speed', value: `${Math.round(live.speedKmh)} km/h` }] : []),
          ...(turn ? [{ label: 'Next', value: `${turn.label} in ${Math.round(turn.inM)} m — slowing to ${turn.kmh} km/h` }] : []),
        ],
        unitRefs: [a.unit_ref],
      });
    }
    if (a.onscene_at) {
      const resp = secsBetween(reported, a.onscene_at);
      const inside = target - resp;
      const err = a.eta_predicted_at ? Math.round((Date.parse(a.onscene_at) - Date.parse(a.eta_predicted_at)) / 1000) : null;
      add({
        key: `onscene:${a.ref}`, at: new Date(a.onscene_at).toISOString(), tone: inside >= 0 ? 'good' : 'bad',
        title: `${a.callsign} on scene in ${min(resp)}`,
        detail: inside >= 0 ? `${min(inside)} inside the ${min(target)} target` : `${min(-inside)} over the ${min(target)} target`,
        items: err != null ? [{ label: 'Prediction', value: `arrival predicted ${err === 0 ? 'exactly' : `${mmss(Math.abs(err))} min ${err > 0 ? 'early' : 'late'} — actual was ${err > 0 ? 'later' : 'sooner'}`}` }] : [],
        unitRefs: [a.unit_ref],
      });
    }
    if (a.at_patient_at) {
      add({ key: `patient:${a.ref}`, at: new Date(a.at_patient_at).toISOString(), tone: 'good', title: 'Crew with the patient', unitRefs: [a.unit_ref] });
    }
    if (a.transporting_at) {
      const occ = a.ed_beds ? Math.round((a.ed_occupied / a.ed_beds) * 100) : null;
      const leg = preview?.legs?.hospital?.asgRef === a.ref ? preview.legs.hospital : null;
      add({ key: `transport:${a.ref}`, at: new Date(a.transporting_at).toISOString(), tone: 'info',
        title: `Transporting to ${a.hospital_name ?? 'hospital'}`,
        detail: `Chosen by the hospital engine${occ != null ? ` · emergency department ${occ}% full` : ''}${a.on_diversion ? ' · on diversion' : ''}`
          + (leg?.hospitalWhy ? ` · ${leg.hospitalWhy}` : ''),
        items: leg?.stats ? [
          { label: 'Road', value: `${km(leg.stats.distanceM)}${leg.stats.via ? ` via ${leg.stats.via}` : ''} · ${drive.manoeuvreText(leg.stats.counts)} · ${min(leg.stats.timeSec)}`, tone: 'ai' },
          ...(leg.why?.length ? [{ label: 'Why this road', value: leg.why.join('; '), tone: 'ai' }] : []),
          { label: 'Driving', value: 'smoother on the way in — patient aboard, braking eased for every manoeuvre' },
        ] : [],
        unitRefs: [a.unit_ref] });
    }
    // Live: the transport in progress
    if (a.transporting_at && !a.at_hospital_at && a.state === 'transporting') {
      const live = providers.live(a.ref);
      if (live?.leg === 'hospital') {
        add({
          key: `transportdrive:${a.ref}`, at: nowIso(), tone: 'info', state: 'active',
          title: `To ${a.hospital_name ?? 'hospital'} · ${km(live.remainingM)} to go${live.etaSec != null ? ` · about ${min(live.etaSec)}` : ''}`,
          detail: live.next ? `Next: ${live.next.label} in ${Math.round(live.next.inM)} m — easing to ${live.next.kmh} km/h` : 'Straight run in to the ambulance bay',
          items: live.speedKmh != null ? [{ label: 'Speed', value: `${Math.round(live.speedKmh)} km/h` }] : [],
          unitRefs: [a.unit_ref],
        });
      }
    }
    if (a.at_hospital_at) {
      add({ key: `hospital:${a.ref}`, at: new Date(a.at_hospital_at).toISOString(), tone: 'good', title: `Handed over at ${a.hospital_name ?? 'hospital'}`, unitRefs: [a.unit_ref] });
    }
    if (a.cleared_at) {
      add({ key: `cleared:${a.ref}`, at: new Date(a.cleared_at).toISOString(), tone: 'good', title: `${a.callsign} clear · back in service`, unitRefs: [a.unit_ref] });
    }
  }
  for (const r of tl.filter((x) => x.stage === 'offer_timed_out')) {
    add({ key: `timeout:${r.ts}`, at: new Date(r.ts).toISOString(), tone: 'warn', title: r.label });
  }
  // The receiving hospital, told what is coming (services/prealert.js) — and its answer.
  for (const r of tl.filter((x) => x.stage === 'prealert' || x.stage === 'prealert_ack')) {
    const d = r.detail ?? {};
    add({
      key: `${r.stage}:${d.assignmentRef ?? r.ts}`, at: new Date(r.ts).toISOString(),
      tone: r.stage === 'prealert_ack' ? 'good' : 'info',
      title: r.stage === 'prealert' ? `Hospital pre-alert sent · ${d.to ?? 'emergency department'}` : r.label,
      detail: r.stage === 'prealert' ? r.label : null,
      items: r.stage === 'prealert' ? [
        ...(d.patient ? [{ label: 'Patient', value: d.patient }] : []),
        ...(d.vitals ? [{ label: 'Wearable trend', value: d.vitals, tone: 'ai' }] : []),
        ...(d.ready?.length ? [{ label: 'Have ready', value: d.ready.join(' · ') }] : []),
        { label: 'Channel', value: d.channel ?? 'Simulated hospital link' },
      ] : [],
    });
  }
  if (inc.closed_at) {
    add({ key: 'closed', at: new Date(inc.closed_at).toISOString(), tone: 'good',
      title: `Closed · ${String(inc.outcome ?? 'complete').replace(/_/g, ' ')}` });
  }

  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.state === 'active' ? 1 : 0) - (b.state === 'active' ? 1 : 0));

  const phase = inc.closed_at ? 'closed'
    : primary?.transporting_at && !primary.at_hospital_at ? 'transport'
      : primary?.onscene_at ? 'onscene'
        : primary?.enroute_at ? 'enroute'
          : primary ? 'dispatched'
            : preview?.status === 'thinking' ? 'thinking'
              : preview?.chosen ? 'decided' : 'detected';

  return {
    at: nowIso(),
    incident: {
      ref: inc.ref, kind: inc.kind, kindLabel: kindLabel(inc.kind), priority: inc.priority, state: inc.state,
      place, zoneName: inc.zone_name, position: [inc.lng, inc.lat], reportedAt: reported, targetSec: target,
      source: inc.source, detectedBy, patients: inc.patients_count, complaint: inc.chief_complaint,
      firstOnsceneAt: inc.first_onscene_at ? new Date(inc.first_onscene_at).toISOString() : null,
      closedAt: inc.closed_at ? new Date(inc.closed_at).toISOString() : null,
      detectionId: det?.id ?? null,
    },
    phase,
    steps,
    candidates: alts,
    chosenRef,
    preview: preview ? { status: preview.status, startedAt: preview.startedAt, readyAt: preview.readyAt, thinkMs: preview.thinkMs, trafficApplied: preview.policy?.trafficApplied ?? false, mode: preview.policy?.mode ?? null } : null,
    pending: pending && !primary ? pending : null,
    assignment: primary ? {
      ref: primary.ref, state: primary.state, unitRef: primary.unit_ref, callsign: primary.callsign, unitKind: primary.unit_kind,
      etaPredictedAt: primary.eta_predicted_at ? new Date(primary.eta_predicted_at).toISOString() : null,
      hospital: primary.hospital_ref ? { ref: primary.hospital_ref, name: primary.hospital_name } : null,
      profile: profileFor(primary.unit_ref, primary.unit_kind),
      live: providers.live(primary.ref),
    } : null,
  };
}
