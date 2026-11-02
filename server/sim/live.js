/**
 * The live picture — the road, the cameras that watch it, and the trial's crews, running
 * through the REAL system.
 *
 * Three independent parts:
 *
 *   ROAD WATCH     the work arrives from CAMERAS, never from a phone. Collisions appear on
 *                  the carriageway (sim/roadSites.js) as a Poisson stream, each raised with
 *                  `source = 'sensor'` and stamped when the camera saw it. There is no 998
 *                  call stream in this build (config/poc.js): "the Operations Centre knows
 *                  before anyone phones it in" is the claim, and traffic arriving by phone
 *                  underneath it would quietly contradict it.
 *   AI DISPATCH    always on. Every incident goes to the engine's top recommendation after
 *                  a short window; the console shows the countdown, and a dispatcher can
 *                  still dispatch sooner, pick another unit, or hold. It cannot be switched
 *                  off — the trial is an automatic-dispatch trial.
 *   CREWS          (always on) — every ambulance on a job acknowledges, turns out, DRIVES
 *                  ITS OSRM ROAD ROUTE, arrives, reaches the patient, treats, transports to
 *                  the hospital engine's choice, hands over, clears and returns to station.
 *                  A unit whose responder is signed in on a phone is never driven: the
 *                  person holding the phone does that.
 *
 * It STARTS BY ITSELF when the server does. There is no simulation panel in this build, so
 * there is no button to press: the console opens on a service that is already running,
 * which is what a control room looks like.
 *
 * NOTHING HERE WRITES STATE DIRECTLY. Calls go through services/incidents.create, dispatch
 * through services/dispatch.commitDispatch, every crew step through dispatch.transition, and
 * movement through services/positions — the same code a dispatcher and a real phone use. The
 * console therefore cannot tell a simulated ambulance from a real one, which is the point:
 * the demonstration exercises the shipping system (jbvnl_app_context.md §13.3).
 *
 * Time is REAL. A response that takes six minutes takes six minutes, so every response-time
 * figure the simulation produces is a believable one. Only the parts nobody measures — time
 * at the patient's side, hospital hand-over — are shortened, so the fleet turns over within a
 * demonstration. Simulated incidents carry a run id and `POST /api/sim/reset` removes them.
 */

import { pool, query, one } from '../lib/db.js';
import { nowMs } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { bus } from '../lib/bus.js';
import { AppError } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { poc, pocFleet } from '../config/poc.js';
import { ROAD_SITES, ROAD_EVENTS, eventKind } from './roadSites.js';
import * as incidentsSvc from '../services/incidents.js';
import * as dispatch from '../services/dispatch.js';
import * as unitsSvc from '../services/units.js';
import * as osrm from '../integrations/osrm.js';
import { reportPosition, deviceDriveFor } from '../services/positions.js';
import { raise, setPendingCheck, kindLabel } from '../services/alerts.js';
import { unitDeviceOnline, mobileOnline } from '../realtime/index.js';
import * as fanout from '../realtime/fanout.js';
import { restoreRestingState } from '../db/seed/resting.js';
import * as detection from '../engines/detection.js';
import * as driveModel from '../engines/drive.js';
import * as crashScript from './scripts/SC-RW-01-crash.js';
import { DEMO_SCENARIOS, specFor as demoSpec } from './scripts/demoScenarios.js';
import { env } from '../config/env.js';
import * as traffic from './traffic.js';
import * as decisions from '../services/decisions.js';
import { effectiveRules, loadRules } from '../services/dispatchRules.js';
import { TRIAL_CREWS, shiftStartToday } from '../data/reference/crews.js';

// ── Settings and state ────────────────────────────────────────────────────────

/**
 * Road incidents detected per hour.
 *
 * Far below the emirate's 998 volume, and deliberately so: this is what EIGHT ambulances
 * (config/poc.js) watching one catchment can carry. A job — drive out, scene, transport,
 * hand-over, drive back — runs about forty minutes, so at `normal` (one collision every
 * twelve minutes) three or four of the eight are busy at any moment and an incident finds
 * every ambulance committed only a few times a day. At eight an hour it was one incident
 * in five: the screen spent the demo showing a queue, which is the opposite of the claim.
 */
export const INTENSITY = { quiet: 3, normal: 5, busy: 9, surge: 15 };

const settings = {
  running: false,
  intensity: 'normal',
  /** Not a setting in this build. The trial is automatic dispatch; see applySettings. */
  autoDispatch: true,
  /** 'real' drives at emergency road speed; 'brisk' halves the waits and speeds driving up. */
  pace: 'real',
  startedAt: null,
  startedBy: null,
};
const counters = { generated: 0, autoDispatched: 0 };

let runId = null;
let runRef = null;
/** unitId → crew */
const crews = new Map();
/** assignmentRef → unitId, for jobs a crew phone is driving (refreshed by syncCrews). */
const deviceJobs = new Map();
/** assignmentRef → the road to hospital for a phone-driven transport (null while fetching). */
const deviceHospitalRoutes = new Map();
/** incidentRef → { dueAt, priority, kind, zoneName } */
const pendingAuto = new Map();
const held = new Set();
/** hospitalId → beds the simulation has filled, released over time. */
const edBoost = new Map();

const AI_DISPATCH = Object.freeze({
  id: null, ref: 'AI-DISPATCH', name: 'AI dispatch', role: 'system', kind: 'system',
  agencyCode: 'DCAS', agencyId: null, unitId: null, zoneScope: [],
});
/**
 * Who creates the incident. Not a call-taker: nobody took this call, and the audit trail
 * has to say so. The same actor engines/detection.js uses, so an incident raised by the
 * flagship detection and one raised by routine road watch are attributed identically.
 */
const CAMERA_AI = Object.freeze({
  id: null, ref: 'CCTV-AI', name: 'Camera analytics', role: 'system', kind: 'system',
  agencyCode: 'DCAS', agencyId: null, unitId: null, zoneScope: [],
});
const crewActor = (c) => ({
  id: null, ref: c.unitRef, name: `${c.unitRef} crew`, role: 'responder', kind: 'unit',
  agencyCode: 'DCAS', agencyId: null, unitId: c.unitId, zoneScope: [],
});

const D = jurisdiction.dispatch;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const paceWait = () => (settings.pace === 'brisk' ? 0.5 : 1);
const paceSpeed = () => (settings.pace === 'brisk' ? 1.6 : 1);

/** Seconds a call spends with the call-taker before the AI commits a dispatch — the
 *  fallback only; the automatic-dispatch rules (services/dispatchRules.js) set the window. */
const CALL_HANDLING_SEC = { P1: 20, P2: 35, P3: 60, P4: 90 };


// ═══════════════════════════════════════════════════════════════════════════════
//  Public controls
// ═══════════════════════════════════════════════════════════════════════════════

export function publicState() {
  const moving = [...crews.values()].filter((c) => c.path && !c.arrived).length;
  return {
    running: settings.running,
    intensity: settings.intensity,
    callsPerHour: INTENSITY[settings.intensity],
    autoDispatch: settings.autoDispatch,
    pace: settings.pace,
    startedAt: settings.startedAt,
    startedBy: settings.startedBy,
    /** The flagship detection's progress, if it has fired. */
    opening: { ...opening },
    runRef,
    generated: counters.generated,
    autoDispatched: counters.autoDispatched,
    crews: { active: crews.size, moving },
    pending: [...pendingAuto.entries()]
      .map(([incidentRef, p]) => ({ incidentRef, dueAt: new Date(p.dueAt).toISOString(), windowSec: p.windowSec ?? null, priority: p.priority, kind: p.kind, zoneName: p.zoneName }))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    intensities: Object.entries(INTENSITY).map(([key, perHour]) => ({ key, perHour })),
    scenario: demoState(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  THE DEMONSTRATION — three incidents, each end to end, one at a time
// ═══════════════════════════════════════════════════════════════════════════════
//
// In the trial build the road is not a random stream any more. A room watching two or three
// incidents at once lost all of them: the camera rode with one crew while the next alert
// landed, the panel switched stories, and nobody saw a single response finish. So the
// trial runs the curated scenarios in sim/scripts/demoScenarios.js, in order, and the next
// one is not raised until the last one is CLOSED — the crew has handed over at hospital and
// cleared — and the fleet is back on its stations. A person can start the next one early
// (`POST /api/sim/next`) once the current one is finished; never while it is running.

/** Between one incident closing and the next being raised: the room reads the ending. */
const DEMO_GAP_MS = 45_000;
/** How much longer the next one waits for crews still driving back to station. */
const DEMO_RETURN_GRACE_MS = 90_000;

const demo = {
  index: -1,
  /** idle → detecting → running → finished → detecting … */
  phase: 'idle',
  incidentRef: null,
  detectionId: null,
  startedAt: null,
  finishedAt: null,
  nextAt: null,
  /** A person asked for the next one now. */
  skip: false,
  /** Live incidents the next scenario is waiting on (one story at a time). */
  blockedBy: 0,
  /** A phone (citizen or crew app) is connected: the phones drive the demonstration. */
  heldForPhones: false,
};

/** Phones connected, and whether the scripted scenarios are standing back for them. */
function phoneHold() {
  const phones = mobileOnline();
  return { phones, held: phones.citizens + phones.responders > 0 };
}
let adopted = false;

/** Live incidents that would make a second story — stuck ones (nobody on them, older than
 *  twenty minutes) excepted, so one stuck record can never stall the demonstration. */
async function liveStories() {
  const row = await one(`SELECT COUNT(*)::int AS n FROM incidents i
     WHERE i.state NOT IN ('closed','cancelled') AND NOT i.is_seed AND NOT i.is_resting
       AND (i.reported_at > now() - interval '20 minutes'
            OR EXISTS (SELECT 1 FROM assignments a WHERE a.incident_id = i.id
                         AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')))`);
  return row?.n ?? 0;
}

/**
 * After a server restart the demonstration's place in the sequence is gone, but its
 * incident may still be on the road. Pick it back up — the same scenario, still running —
 * rather than starting the sequence again beside it.
 */
async function adoptInFlight() {
  adopted = true;
  if (demo.phase !== 'idle') return;
  for (let i = 0; i < DEMO_SCENARIOS.length; i++) {
    const { place } = DEMO_SCENARIOS[i];
    const row = await one(
      `SELECT ref FROM incidents
        WHERE state NOT IN ('closed','cancelled') AND NOT is_seed AND NOT is_resting AND source = 'sensor'
          AND reported_at > now() - interval '45 minutes'
          AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 150)
        ORDER BY reported_at DESC LIMIT 1`, [place.lng, place.lat]).catch(() => null);
    if (!row) continue;
    Object.assign(demo, { index: i, phase: 'running', incidentRef: row.ref, startedAt: Date.now(), finishedAt: null, nextAt: null, skip: false });
    demoIncidents.add(row.ref);
    logger.info({ scenario: DEMO_SCENARIOS[i].id, incident: row.ref }, '[demo] picked up the scenario in flight after a restart');
    broadcast(true);
    return;
  }
}
/** Incidents the demonstration raised — crews on these never decline or go silent. */
const demoIncidents = new Set();

function demoState() {
  if (!poc.enabled) return null;
  const sc = DEMO_SCENARIOS[demo.index] ?? null;
  const upNext = DEMO_SCENARIOS[(demo.index + 1) % DEMO_SCENARIOS.length];
  return {
    index: demo.index, total: DEMO_SCENARIOS.length,
    id: sc?.id ?? null, title: sc?.title ?? null, short: sc?.short ?? null, place: sc?.place.name ?? null,
    phase: demo.phase, incidentRef: demo.incidentRef, blockedBy: demo.blockedBy,
    // While a phone is connected the next camera scenario waits for it: the citizen app
    // raises the incident and the crew app answers it. "Start now" still runs one.
    phones: phoneHold().phones, heldForPhones: demo.heldForPhones,
    startedAt: demo.startedAt ? new Date(demo.startedAt).toISOString() : null,
    finishedAt: demo.finishedAt ? new Date(demo.finishedAt).toISOString() : null,
    nextAt: demo.nextAt && (demo.phase === 'idle' || demo.phase === 'finished') ? new Date(demo.nextAt).toISOString() : null,
    next: { index: (demo.index + 1) % DEMO_SCENARIOS.length, title: upNext.title, short: upNext.short },
    scenarios: DEMO_SCENARIOS.map((s) => ({ id: s.id, title: s.title, short: s.short })),
  };
}

/** Start the next scenario now — only once the current one, and anything else live, has finished. */
export async function nextScenario() {
  if (!poc.enabled) throw new AppError('conflict', 409, 'The demonstration runs only in the trial build');
  if (demo.phase === 'detecting' || demo.phase === 'running') {
    throw new AppError('conflict', 409, 'One incident at a time — the current one is still being handled');
  }
  if (await liveStories() > 0) {
    throw new AppError('conflict', 409, 'One incident at a time — wait for the live incident to close');
  }
  demo.skip = true;
  broadcast(true);
  return publicState();
}

/**
 * Idle trial ambulances back on their own stations before a scenario is raised. The
 * scenarios were chosen with the fleet at home; an ambulance left on a standby point or
 * still rolling back from the last job would change which crew is nearest and make the
 * story the room sees depend on where the previous one happened to end.
 */
async function homeFleet() {
  const { rows } = await pool.query(
    `UPDATE units u SET current_geom = s.geom, status = 'available', current_speed = 0,
            standby_geom = NULL, standby_reason = NULL, standby_advisory_id = NULL, last_seen_at = now()
       FROM stations s
      WHERE s.id = u.home_station_id AND u.ref = ANY($1::text[])
        AND (ST_Distance(u.current_geom::geography, s.geom::geography) > 40 OR u.status NOT IN ('available'))
        AND u.status NOT IN ('off_duty', 'out_of_service')
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.unit_id = u.id
              AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))
      RETURNING u.id, u.ref, ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat`,
    [poc.fleet],
  );
  for (const u of rows) {
    crews.delete(u.id);
    await reportPosition({ unitId: u.id, unitRef: u.ref, lng: u.lng, lat: u.lat, speed: 0, heading: null, status: 'available', runId });
  }
  if (rows.length) logger.info({ units: rows.map((u) => u.ref) }, '[demo] idle ambulances back on station');
}

async function startScenario(index) {
  const sc = DEMO_SCENARIOS[index];
  demo.index = index;
  demo.phase = 'detecting';
  demo.incidentRef = null;
  demo.startedAt = Date.now();
  demo.finishedAt = null;
  demo.nextAt = null;
  demo.skip = false;
  demo.blockedBy = 0;
  lastHeadlineAt = Date.now();
  broadcast(true);
  try {
    await ensureRun(null);
    await homeFleet();
    opening.crash = 'running';
    const d = await detection.run(demoSpec(sc, { runId }));
    demo.detectionId = d.id;
    logger.info({ scenario: sc.id, detection: d.id }, `[demo] ${sc.title}`);
  } catch (err) {
    logger.warn({ err: err.message, scenario: sc.id }, '[demo] scenario failed to start — trying again shortly');
    demo.phase = 'finished';
    demo.finishedAt = Date.now();
    demo.nextAt = Date.now() + 15_000;
    opening.crash = 'failed';
  }
  broadcast(true);
}

bus.on('detection:incident', ({ detectionId, incidentRef }) => {
  if (!incidentRef || detectionId !== demo.detectionId) return;
  demo.incidentRef = incidentRef;
  demo.phase = 'running';
  demoIncidents.add(incidentRef);
  opening.crash = 'done';
  broadcast(true);
});

async function scenarioTick() {
  const now = Date.now();
  if (!adopted && demo.phase === 'idle') await adoptInFlight();
  if (demo.phase === 'detecting') {
    // A detection that never produced its incident (a stage failed) must not stall the demo.
    if (demo.startedAt && now - demo.startedAt > 60_000) {
      demo.phase = 'finished';
      demo.finishedAt = now;
      demo.nextAt = now + 15_000;
      broadcast(true);
    }
    return;
  }
  if (demo.phase === 'running') {
    const row = demo.incidentRef ? await one('SELECT state FROM incidents WHERE ref = $1', [demo.incidentRef]) : null;
    if (!row || row.state === 'closed' || row.state === 'cancelled') {
      demo.phase = 'finished';
      demo.finishedAt = now;
      demo.nextAt = now + DEMO_GAP_MS;
      logger.info({ incident: demo.incidentRef }, '[demo] incident closed — next one after the gap');
      broadcast(true);
    }
    return;
  }
  if (demo.nextAt == null) demo.nextAt = now + OPENING_QUIET_MS;
  if (!demo.skip) {
    // THE PHONES DRIVE IT. With the citizen or crew app connected, the scripted camera
    // scenarios stand back: the citizen's SOS is the incident, the crew phone answers it,
    // and a camera collision raised beside it would be a second story competing for the
    // same ambulances. When the last phone goes, the sequence resumes after a clean beat.
    const { held } = phoneHold();
    if (held !== demo.heldForPhones) {
      demo.heldForPhones = held;
      if (!held) demo.nextAt = Math.max(demo.nextAt, now + OPENING_QUIET_MS);
      broadcast(true);
    }
    if (held) return;
    if (now < demo.nextAt) return;
    const returning = [...crews.values()].some((c) => c.phase === 'return' && c.path && !c.arrived);
    if (returning && now < demo.nextAt + DEMO_RETURN_GRACE_MS) return;
    // ONE AT A TIME, strictly: anything else still live (a crew-app demo job, a response
    // that was in flight when the server restarted) finishes first. Only an incident that
    // is genuinely stuck — nobody on it and older than twenty minutes — is not waited for.
    const blocking = await liveStories();
    if (blocking !== demo.blockedBy) { demo.blockedBy = blocking; broadcast(true); }
    if (blocking > 0) return;
  }
  await startScenario((demo.index + 1) % DEMO_SCENARIOS.length);
}

let lastBroadcast = '';
function broadcast(force = false) {
  const s = publicState();
  const sig = JSON.stringify({ ...s, crews: null });
  if (!force && sig === lastBroadcast) return;
  lastBroadcast = sig;
  fanout.simState(s);
}

export async function start({ intensity, autoDispatch, pace } = {}, actor) {
  applySettings({ intensity, autoDispatch, pace });
  if (!settings.running) {
    settings.running = true;
    settings.startedAt = new Date().toISOString();
    settings.startedBy = actor?.ref ?? null;
    await ensureRun(actor);
    await alignTrialFleet();
    await ensureShifts();
    nextCallAt = Date.now() + OPENING_QUIET_MS;
    lastGeneratedAt = Date.now();
    // ONE button. The two camera detections are part of starting the simulation, not a
    // second control beside it — see runOpeningSequence.
    startOpeningSequence();
  }
  broadcast(true);
  return publicState();
}

export function stop() {
  settings.running = false;
  clearOpeningSequence();
  broadcast(true);
  return publicState();
}

export function update(patch) {
  applySettings(patch);
  broadcast(true);
  return publicState();
}

function applySettings({ intensity, autoDispatch, pace } = {}) {
  if (intensity && INTENSITY[intensity]) settings.intensity = intensity;
  // Automatic dispatch is the trial (config/poc.js), not an option within it. The request
  // is still accepted rather than rejected — a caller asking to turn it off gets the state
  // back saying it is on, which is honest — but it is never applied while the PoC scope is
  // in force. Turning `poc.enabled` off restores the switch.
  if (typeof autoDispatch === 'boolean' && !poc.enabled) {
    settings.autoDispatch = autoDispatch;
    if (!autoDispatch) pendingAuto.clear();
  }
  if (poc.enabled) settings.autoDispatch = true;
  if (pace === 'real' || pace === 'brisk') settings.pace = pace;
}

/** A dispatcher takes a call back from the AI. */
export function hold(incidentRef) {
  held.add(incidentRef);
  pendingAuto.delete(incidentRef);
  decisions.note(incidentRef, 'held', 'Held by a dispatcher — the AI will not send an ambulance until it is released');
  broadcast(true);
  return publicState();
}

/**
 * Skip the rest of the window: the AI commits its choice on the next tick. Also how a held
 * incident, or one on a priority switched to manual, is handed back — the dispatcher is
 * accepting the AI's recommendation, and the audit trail says the AI made it.
 */
export async function dispatchNow(incidentRef) {
  held.delete(incidentRef);
  const p = pendingAuto.get(incidentRef);
  if (p) {
    pendingAuto.set(incidentRef, { ...p, dueAt: Date.now(), forced: true });
  } else {
    const inc = await dispatch.loadIncident(incidentRef, AI_DISPATCH);
    if (inc.state === 'closed') throw new AppError('conflict', 409, `${incidentRef} is closed`);
    pendingAuto.set(incidentRef, { dueAt: Date.now(), windowSec: 0, priority: inc.priority, kind: inc.kind, zoneName: null, forced: true });
  }
  broadcast(true);
  return publicState();
}

/**
 * The headline detection — the five-stage camera sequence, at the junction the cameras
 * actually look at.
 *
 * Everything in this build arrives from a camera, but only this one is WATCHED arriving.
 * The five stages of engines/detection.js — frame, corroborate, verdict, alert, incident —
 * take the whole screen while they run, which is right for the sequence the client came to
 * see and wrong for the eleventh collision of the afternoon. So the flagship runs through
 * the detection engine with its panel, and the rest of the road (generateRoadIncident
 * below) arrives the same way underneath it, `source = 'sensor'` and all, without
 * interrupting anybody.
 *
 * The indoor sequence that used to follow it is gone. The trial watches the road
 * (config/poc.js): a collapse on floor three of a building is a different product, and
 * demonstrating it here would answer a question nobody asked.
 *
 * It repeats. A console left running through a morning of meetings must still be able to
 * show the sequence on demand, and there is no button in this build to ask for it.
 */

/** Quiet at the start: the first road incident is held back so the flagship detection is
 *  not competing with routine traffic for the operator's eye. */
const OPENING_QUIET_MS = 30_000;

/** Seconds after start before the flagship detection fires — a clean, empty map for a
 *  full cold-open beat (matches OPENING_QUIET_MS) before anything happens, so a restart
 *  or a first sign-in reads as "watch this" rather than catching a scene already moving. */
const OPENING_AT = { crash: 30 };

/** And again, this often. Long enough that it is an event rather than a metronome. */
const HEADLINE_REPEAT_MS = 11 * 60_000;

const opening = { crash: 'idle' };
let openingTimers = [];
let headlineRepeat = null;
/** A headline is scheduled and has not fired yet — a second one must not be stacked on it. */
let headlineArmed = false;

export function clearOpeningSequence() {
  for (const t of openingTimers) clearTimeout(t);
  openingTimers = [];
  if (headlineRepeat) clearInterval(headlineRepeat);
  headlineRepeat = null;
  headlineArmed = false;
  detection.clear();
  opening.crash = 'idle';
}

function at(seconds, fn) {
  const timer = setTimeout(() => {
    if (!settings.running) return;   // stopped since: the sequence stops with the run
    void fn();
  }, seconds * 1000 * paceWait());
  timer.unref?.();
  openingTimers.push(timer);
}

/**
 * Is the last flagship collision still being handled?
 *
 * The flagship fires at start and then on a cycle — and the server starts it by itself,
 * so every restart is a start. Without this, a morning of restarts during rehearsal
 * stacked six identical P1 collisions on one roundabout, each taking an ambulance from a
 * fleet of eight. One crash at a junction is an incident; the same crash again while the
 * first is still open is a duplicate, and the camera would not raise it.
 */
async function headlineStillOpen() {
  const { lng, lat } = crashScript.PLACE;
  const open = await one(
    `SELECT 1 FROM incidents
      WHERE source = 'sensor' AND state <> 'closed' AND NOT is_seed AND NOT is_resting
        AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 60)
      LIMIT 1`,
    [lng, lat],
  );
  return Boolean(open);
}

let lastHeadlineAt = 0;

async function runHeadlineDetection() {
  if (opening.crash === 'running') return;   // one at a time, whoever asked for it
  lastHeadlineAt = Date.now();
  try {
    if (await headlineStillOpen()) {
      logger.info('[sim] road-watch detection skipped — the last collision at the junction is still open');
      return;
    }
    opening.crash = 'running';
    broadcast(true);
    const d = await detection.run(crashScript.spec({ runId }));
    opening.crash = 'done';
    logger.info({ detection: d.id }, '[sim] road-watch detection — collision');
  } catch (err) {
    opening.crash = 'failed';
    logger.warn({ err: err.message }, '[sim] collision detection failed');
  }
  broadcast(true);
}

function armHeadline(seconds) {
  headlineArmed = true;
  at(seconds, async () => {
    headlineArmed = false;
    await runHeadlineDetection();
  });
}

/**
 * Someone has just signed in to the console. The simulation starts with the server, so on a
 * server that has been up all morning the next demonstration incident could be minutes off
 * — and the demonstration starts at sign-in, not at server start. So the next scenario is
 * brought forward to 30 seconds from now, if one is not already running.
 *
 * Never more than that: in the trial build the demonstration is the ONLY thing that raises
 * incidents, so a sign-in never puts a second story beside one in progress (the legacy
 * junction headline used to fire here, and after a server restart its "ran recently" guard
 * was forgotten — three people signing in during a scenario raised a second collision).
 */
function onConsoleSignIn() {
  if (!poc.enabled || !settings.running) return;
  if (demo.phase !== 'idle' && demo.phase !== 'finished') return;
  if (demo.nextAt == null || demo.nextAt - Date.now() > OPENING_QUIET_MS) {
    demo.nextAt = Date.now() + OPENING_QUIET_MS;
    broadcast(true);
    logger.info('[demo] console sign-in — next scenario in 30 s');
  }
}
bus.on('console:signin', onConsoleSignIn);

function startOpeningSequence() {
  clearOpeningSequence();
  // The trial build opens with the first demonstration scenario after a clean 30 s beat
  // (scenarioTick), not with the junction headline — every scenario is its own camera
  // detection, five stages and all.
  if (poc.enabled) {
    if (demo.phase !== 'running' && demo.phase !== 'detecting') {
      demo.phase = demo.index < 0 ? 'idle' : 'finished';
      demo.nextAt = Date.now() + OPENING_QUIET_MS;
    }
    return;
  }
  armHeadline(OPENING_AT.crash);
  headlineRepeat = setInterval(() => {
    if (!settings.running) return;
    void runHeadlineDetection();
  }, HEADLINE_REPEAT_MS);
  headlineRepeat.unref?.();
}

/** Tag whatever the detections created with this run, so reset removes them like any
 *  other simulated incident. */
bus.on('detection:incident', ({ incidentRef }) => {
  if (!runId || !incidentRef) return;
  void query('UPDATE incidents SET run_id = $2 WHERE ref = $1', [incidentRef, runId])
    .catch(() => {});
});

/** Put one road incident on the map now — optionally a chosen kind, priority or site.
 *  Kept for rehearsal and the flow test; there is no button for it in this build. */
export async function inject({ kind, priority, siteId } = {}) {
  await ensureRun(null);
  const out = await generateRoadIncident({ kind, priority, siteId });
  broadcast(true);
  return out;
}

/**
 * Make an incident part of the live run, so a PoC restart removes it with everything else
 * the demonstration produced. The citizen app's SOS arrives through the ordinary incident
 * service, which knows nothing of runs; without this it would survive every restart.
 */
export async function adoptIntoRun(ref) {
  if (!poc.enabled || !ref) return;
  await ensureRun(null);
  await query('UPDATE incidents SET run_id = $2 WHERE ref = $1 AND run_id IS NULL', [ref, runId]);
}

/** A caller's place for the demonstration: on a real road, a short drive from `from`. */
const DEMO_CALLER_ROAD_M = { min: 450, max: 1300 };

/**
 * Where the citizen app puts a demonstration caller — on a named road a minute or two's
 * drive from the paired crew (services/sos.js demoPlace), so the response the room watches is
 * a short one. Where it can, a place where that crew is ALSO the nearest free ambulance
 * (`others` are the rest of the free fleet): then "nearest ambulance" on the caller's screen,
 * the AI's choice and the paired crew are one and the same, and nobody in the room has to ask
 * why it was not the closer one. Falls back to the nearest road-watch site, then to a point
 * 700 m away.
 */
export async function demoPlaceNear(from, others = []) {
  const nearestIsUs = (pt) => others.every((o) => haversine(o, pt) > haversine(from, pt) + 200);
  for (let attempt = 0; attempt < 3 && others.length; attempt++) {
    const p = await roadPointNear(from, DEMO_CALLER_ROAD_M, nearestIsUs).catch(() => null);
    if (p) return { lng: p.lng, lat: p.lat, road: p.road };
  }
  const onRoad = await roadPointNear(from, DEMO_CALLER_ROAD_M).catch(() => null);
  if (onRoad) return { lng: onRoad.lng, lat: onRoad.lat, road: onRoad.road };
  const byRoad = await sitesByRoad(from, DEMO_CALLER_ROAD_M).catch(() => null);
  const site = byRoad?.[0]?.s
    ?? ROAD_SITES.map((x) => ({ x, m: haversine(from, [x.lng, x.lat]) })).sort((a, b) => a.m - b.m)[0]?.x;
  if (site && haversine(from, [site.lng, site.lat]) < 4000) return { lng: site.lng, lat: site.lat, road: site.road };
  const cosLat = Math.cos((from[1] * Math.PI) / 180);
  return { lng: from[0] + 500 / (111_320 * cosLat), lat: from[1] + 500 / 111_320, road: null };
}

const CREW_DEMO = Object.freeze({
  id: null, ref: 'CREW-DEMO', name: 'Crew app demonstration', role: 'system', kind: 'system',
  agencyCode: 'DCAS', agencyId: null, unitId: null, zoneScope: [],
});

/** A demonstration call sits a short drive away: far enough to show the drive, near
 *  enough that the whole job fits in a demo. */
const DEMO_JOB_M = { min: 800, max: 3000 };
/** By road: a drive of a minute or two at road speed, which a demonstration can watch. */
const DEMO_ROAD_M = { min: 600, max: 2000 };

/**
 * A job for one ambulance, on demand — the crew app's "Simulate a call". The collision is
 * raised by a camera like every other in the trial, so the console sees it arrive; it is
 * then offered straight to this ambulance rather than waiting out the AI's countdown,
 * because what is being shown is this crew's phone receiving it.
 */
export async function demoJobFor(unitRef) {
  const unit = await one(
    `SELECT u.status, ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
            EXISTS (SELECT 1 FROM assignments a WHERE a.unit_id = u.id
                      AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')) AS busy
       FROM units u WHERE u.ref = $1 AND u.archived_at IS NULL`,
    [unitRef],
  );
  if (!unit || unit.lng == null) throw new AppError('conflict', 409, 'This ambulance has no known position');
  if (unit.busy) throw new AppError('conflict', 409, 'Finish the current job first');
  if (unit.status !== 'available' && unit.status !== 'standby') throw new AppError('conflict', 409, 'Go on duty first');

  const from = [unit.lng, unit.lat];
  let site = await roadPointNear(from, DEMO_ROAD_M);
  if (!site) {
    const byRoad = await sitesByRoad(from, DEMO_ROAD_M);
    const byDistance = ROAD_SITES
      .map((s) => ({ s, m: haversine(from, [s.lng, s.lat]) }))
      .sort((a, b) => a.m - b.m);
    const inBand = byDistance.filter((x) => x.m >= DEMO_JOB_M.min && x.m <= DEMO_JOB_M.max);
    site = byRoad?.length ? pick(byRoad.slice(0, 2)).s
      : (inBand.length ? pick(inBand.slice(0, 3)) : byDistance.find((x) => x.m >= 500) ?? byDistance[0]).s;
  }

  await ensureRun(null);
  const created = await generateRoadIncident({ site, kind: 'rta' });
  broadcast(true);
  const { assignment } = await dispatch.commitDispatch(created.ref, { unitRef }, CREW_DEMO);
  return { incidentRef: created.ref, assignmentRef: assignment?.ref ?? null, road: site.road };
}

/**
 * Remove everything the simulation created and put the fleet back at rest. Seeded history
 * and anything a person created outside a simulation run are untouched.
 */
export async function reset() {
  settings.running = false;
  clearOpeningSequence();
  detection.reset();
  pendingAuto.clear();
  held.clear();
  crews.clear();
  // Jobs a crew phone was driving: the phone is told to drop them (fanout.simReset below).
  deviceJobs.clear();
  deviceHospitalRoutes.clear();
  counters.generated = 0;
  counters.autoDispatched = 0;
  // The demonstration starts again from the first scenario.
  Object.assign(demo, { index: -1, phase: 'idle', incidentRef: null, detectionId: null, startedAt: null, finishedAt: null, nextAt: null, skip: false, heldForPhones: false });
  demoIncidents.clear();
  for (const [hospitalId, beds] of edBoost) {
    await query('UPDATE hospitals SET ed_occupied = GREATEST(0, ed_occupied - $2) WHERE id = $1', [hospitalId, beds]);
  }
  edBoost.clear();

  // An incident left OUTSIDE any run would survive every restart and sit beside the next
  // story: a camera collision raised while no run existed, a citizen's SOS from the app, a
  // crew phone's demo call from an earlier build. A restart is a FRESH START for every
  // screen — console, crew phone and citizen phone — so anything still live that is not
  // history (`is_seed`) or scenery (`is_resting`) is folded into the run here, whatever its
  // source, and the clean-up below removes it with the rest.
  if (poc.enabled) await ensureRun(null).catch(() => null);
  if (runId) {
    await query(`
      WITH orphan AS (
        SELECT id FROM incidents
         WHERE run_id IS NULL AND NOT is_seed AND NOT is_resting
           AND state NOT IN ('closed', 'cancelled')
      ),
      a AS (UPDATE assignments SET run_id = $1 WHERE incident_id IN (SELECT id FROM orphan) AND run_id IS NULL),
      p AS (UPDATE patients SET run_id = $1 WHERE incident_id IN (SELECT id FROM orphan) AND run_id IS NULL),
      adv AS (UPDATE advisories SET incident_id = NULL WHERE incident_id IN (SELECT id FROM orphan) AND run_id IS NULL)
      UPDATE incidents SET run_id = $1 WHERE id IN (SELECT id FROM orphan)`, [runId]).catch((err) =>
      logger.warn({ err: err.message }, '[sim] folding orphaned incidents into the run failed'));
  }

  const before = await one(`SELECT COUNT(*)::int n FROM incidents WHERE run_id IS NOT NULL`);

  // Archive every COMPLETED response before clearing the run.
  //
  // A reset exists to clear the demo's live picture, not to erase the record of what
  // happened — and the whole point of recording routes, breadcrumbs and timelines is to
  // accumulate a corpus the forecasters can be trained and held to account against
  // (docs/00 D-11). Deleting `unit_positions` and `assignments` on every reset meant the
  // corpus never grew past one demo run. Closed incidents are lifted out of the run
  // first: they keep their rows, lose their `run_id`, and survive.
  const kept = await query(`
    WITH done AS (
      SELECT id FROM incidents
       WHERE run_id IS NOT NULL AND state = 'closed' AND first_onscene_at IS NOT NULL
    ),
    freed_units AS (
      UPDATE unit_positions p SET run_id = NULL
        FROM assignments a
       WHERE a.incident_id IN (SELECT id FROM done)
         AND p.unit_id = a.unit_id
         AND p.ts BETWEEN a.offered_at AND COALESCE(a.cleared_at, now())
    ),
    freed_asg AS (
      UPDATE assignments SET run_id = NULL WHERE incident_id IN (SELECT id FROM done)
    ),
    freed_pat AS (
      UPDATE patients SET run_id = NULL WHERE incident_id IN (SELECT id FROM done)
    )
    UPDATE incidents SET run_id = NULL WHERE id IN (SELECT id FROM done)
    RETURNING 1`).then((r) => r.rowCount ?? 0).catch((err) => {
    logger.warn({ err: err.message }, '[sim] archiving completed responses failed — resetting anyway');
    return 0;
  });

  await query(`DELETE FROM telemetry      WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM patients       WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM preempt_events WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM unit_positions WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM assignments    WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM advisories     WHERE run_id IS NOT NULL`);
  await query(`DELETE FROM incidents      WHERE run_id IS NOT NULL`);
  await query(`UPDATE scenario_runs SET state = 'ended', ended_at = now() WHERE state IN ('running','paused')`);
  runId = null;
  runRef = null;

  const resting = await restoreRestingState({ rngSeed: env.seed.rng, log: () => {} });
  const units = await pool.query('SELECT id FROM units');
  for (const u of units.rows) crews.delete(u.id);

  // In the trial build there is no start button (config/poc.js), so a reset that left the
  // live picture stopped would leave it stopped for good. It restarts on a clean slate.
  if (poc.enabled) await start({}, { ref: 'SYSTEM' });

  broadcast(true);
  const removed = before?.n ?? 0;
  // Every screen — the consoles, the crew phone, the citizen phone — drops what it was holding
  // and reloads from the clean state, and the in-memory alerts, AI previews and SOS links go
  // with it (each module listens for this on the bus).
  fanout.simReset({ at: new Date().toISOString(), removed });
  return { removed, archived: kept, resting, state: publicState() };
}

/** True while the AI is counting down to dispatch this incident itself. */
export const isPendingAuto = (ref) => pendingAuto.has(ref);

// ═══════════════════════════════════════════════════════════════════════════════
//  The run record — so a reset can find everything the simulation made
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Today's shift start for each trial crew (data/reference/crews.js — demo roster). The
 * dispatch engine's crew-readiness factor reads it; with no shift recorded it scored every
 * crew as fresh, whatever time of day it was.
 */
async function ensureShifts() {
  for (const ref of Object.keys(TRIAL_CREWS)) {
    const start = shiftStartToday(ref);
    if (!start) continue;
    const end = new Date(Date.parse(start) + 12 * 3600_000).toISOString();
    await query('UPDATE units SET shift_start = $2, shift_end = $3 WHERE ref = $1', [ref, start, end]).catch(() => {});
  }
}

/** An idle trial ambulance further than this from its station is not on a standby point
 *  (restFleet puts those within 1.8 km) — it is somewhere the seed left it. */
const STRAY_M = 2500;

/**
 * The trial fleet where config/poc.js says it lives: home station, crew size from the
 * roster, and — for an idle ambulance left elsewhere — back at the station, available.
 * A unit on a job is not touched; it drives home when it clears.
 */
async function alignTrialFleet() {
  if (!poc.enabled) return;
  for (const [ref, stationRef] of Object.entries(poc.homes)) {
    await query(
      `UPDATE units SET home_station_id = s.id, crew_size = COALESCE($3, crew_size)
         FROM stations s WHERE units.ref = $1 AND s.ref = $2`,
      [ref, stationRef, TRIAL_CREWS[ref]?.crew.length ?? null],
    );
  }
  const { rowCount } = await query(
    `UPDATE units u SET current_geom = s.geom, status = 'available', current_speed = 0,
            standby_geom = NULL, standby_reason = NULL, standby_advisory_id = NULL, last_seen_at = now()
       FROM stations s
      WHERE s.id = u.home_station_id AND u.ref = ANY($1::text[])
        AND ST_Distance(u.current_geom::geography, s.geom::geography) > $2
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.unit_id = u.id
              AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))`,
    [poc.fleet, STRAY_M],
  );
  if (rowCount) logger.info({ moved: rowCount }, '[sim] trial ambulances returned to their stations');
}

async function ensureRun(actor) {
  if (runId) return runId;
  await query(
    `INSERT INTO scenarios (ref, name, summary, tier, duration_sec, script_file, enabled)
     VALUES ('LIVE-SIM', 'Live simulation', 'Continuous 998 call generation with AI dispatch and simulated crews', 0, 0, 'sim/live.js', false)
     ON CONFLICT (ref) DO NOTHING`,
  );
  const stamp = new Date(Date.now() + 4 * 3600_000).toISOString().replace(/[-:T]/g, '').slice(2, 14);
  runRef = `LIVE-${stamp}`;
  const row = await one(
    `INSERT INTO scenario_runs (ref, scenario_id, epoch_ms, started_by)
     VALUES ($1, (SELECT id FROM scenarios WHERE ref = 'LIVE-SIM'), $2, $3)
     ON CONFLICT (ref) DO UPDATE SET state = 'running' RETURNING id`,
    [runRef, Date.now(), actor?.id ?? null],
  );
  runId = row.id;
  return runId;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROAD WATCH — the work arrives from cameras, never from a phone
// ═══════════════════════════════════════════════════════════════════════════════

let nextCallAt = 0;

function exponentialGapMs() {
  const perHour = INTENSITY[settings.intensity] ?? 5;
  return -Math.log(1 - Math.random()) * (3600_000 / perHour);
}

/**
 * Which camera saw it.
 *
 * Two kinds, because the trial has two kinds. A junction mast is fixed infrastructure and
 * names itself; an ambulance's forward camera is the thing being trialled — eight vehicles
 * with two cameras each, one on the road ahead and one on the cab — and it is named for
 * the crew whose windscreen it is looking through. Neither is a phone call, which is the
 * only property the rest of the system cares about.
 */
const JUNCTION_CAMERAS = { 'RS-02': 'RTA-CAM-101A', 'RS-03': 'RTA-CAM-102', 'RS-05': 'RTA-CAM-103' };

async function cameraFor(site) {
  const fixed = JUNCTION_CAMERAS[site.id];
  if (fixed) return fixed;
  // The nearest trial ambulance's forward camera. Its crew was passing; that is the whole
  // proposition — the fleet is the sensor network.
  const near = await one(
    `SELECT u.callsign FROM units u JOIN agencies a ON a.id = u.agency_id
      WHERE a.code = 'DCAS' AND u.archived_at IS NULL AND u.current_geom IS NOT NULL
        AND ($3::text[] IS NULL OR u.ref = ANY($3::text[]))
      ORDER BY u.current_geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326) LIMIT 1`,
    [site.lng, site.lat, pocFleet()],
  );
  return near ? `${near.callsign} forward camera` : 'road camera analytics';
}

function weighted(items, weightOf) {
  const total = items.reduce((s, i) => s + weightOf(i), 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= weightOf(i);
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}

/**
 * One road incident, seen by a camera.
 *
 * On the CARRIAGEWAY (sim/roadSites.js), never at an address and never on a floor — the
 * trial watches the road, and a camera cannot see inside a building. Raised as
 * `source: 'sensor'` with no caller at all, because there was none: the empty caller field
 * on the incident record is the evidence for the claim the whole build is making.
 *
 * It does NOT run the five-stage detection panel. That is reserved for the flagship
 * sequence (runHeadlineDetection above); routine traffic arriving through it would mean an
 * operator dismissing a full-screen dialog every seven minutes.
 */
/** How far from a free trial ambulance routine road watch places a collision: near
 *  enough that the response is a short drive, far enough that the drive is seen. */
const NEAR_FREE_M = { min: 700, max: 3000 };
/** The same, measured by ROAD — the distance the crew will actually drive. */
const NEAR_ROAD_M = { min: 700, max: 2500 };

/**
 * Road sites within a short DRIVE of a point, nearest first — or null when routing does
 * not answer. Straight-line distance misleads beside a motorway: a site 1.5 km away can
 * be a 3 km drive round an interchange.
 */
async function sitesByRoad(from, band) {
  const roads = await osrm.fromOne(from, ROAD_SITES.map((s) => [s.lng, s.lat])).catch(() => null);
  if (!roads || roads.every((r) => !r)) return null;
  const measured = ROAD_SITES.map((s, i) => ({ s, m: roads[i]?.distanceM ?? null }))
    .filter((x) => x.m != null && x.m >= Math.min(band.min, 300))
    .sort((a, b) => a.m - b.m);
  const inBand = measured.filter((x) => x.m >= band.min && x.m <= band.max);
  // Nothing in the band: the shortest drive there is, never a long one found by accident.
  return inBand.length ? inBand : measured.slice(0, 1);
}

/**
 * A collision point on a real road a short DRIVE from `from`: points scattered around it,
 * snapped onto the road network, kept when the drive falls in the band. Named roads are
 * preferred, so the alert can say where. Null when routing does not answer, and the fixed
 * road-watch sites stand in.
 */
async function roadPointNear(from, band, accept = null) {
  const cosLat = Math.cos((from[1] * Math.PI) / 180);
  const points = Array.from({ length: 10 }, () => {
    const b = Math.random() * 2 * Math.PI;
    const r = rand(band.min * 0.5, band.max * 0.65);
    return [from[0] + (r * Math.sin(b)) / (111_320 * cosLat), from[1] + (r * Math.cos(b)) / 111_320];
  });
  const snapped = await osrm.snapAndMeasure(from, points).catch(() => null);
  if (!snapped) return null;
  const inBand = snapped.filter((p) => p && p.snapM < 150 && p.distanceM >= band.min && p.distanceM <= band.max);
  const ok = accept ? inBand.filter((p) => accept(p.location)) : inBand;
  if (!ok.length) return null;
  const readable = (n) => n && /^[\x20-\x7E]+$/.test(n) && !/access|petrol|parking|service|slip/i.test(n);
  const named = ok.filter((p) => readable(p.name));
  const p = pick(named.length ? named : ok);
  return { id: null, road: readable(p.name) ? p.name : 'a local road', zone: null, lng: p.location[0], lat: p.location[1], kind: 'arterial' };
}

/** A road site a short drive from a free trial ambulance; any site if none is free. */
async function nearbySite() {
  const { rows } = await pool.query(
    `SELECT ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat
       FROM units u
      WHERE u.archived_at IS NULL AND u.current_geom IS NOT NULL AND u.status IN ('available','standby')
        AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.unit_id = u.id
              AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))`,
    [pocFleet()],
  );
  if (!rows.length) return pick(ROAD_SITES);
  const unit = pick(rows);
  const onRoad = await roadPointNear([unit.lng, unit.lat], NEAR_ROAD_M);
  if (onRoad) return onRoad;
  const byRoad = await sitesByRoad([unit.lng, unit.lat], NEAR_ROAD_M);
  if (byRoad?.length) return pick(byRoad.slice(0, 4)).s;
  const scored = ROAD_SITES.map((s) => ({
    s, m: Math.min(...rows.map((u) => haversine([u.lng, u.lat], [s.lng, s.lat]))),
  }));
  const near = scored.filter((x) => x.m >= NEAR_FREE_M.min && x.m <= NEAR_FREE_M.max);
  return near.length ? pick(near).s : scored.sort((a, b) => a.m - b.m)[0].s;
}

async function generateRoadIncident({ kind: wantKind, priority: wantPriority, siteId, site: given, patients } = {}) {
  const site = given ?? (siteId ? ROAD_SITES.find((r) => r.id === siteId) ?? await nearbySite() : await nearbySite());
  const event = wantKind
    ? ROAD_EVENTS.find((e) => eventKind(e) === wantKind) ?? weighted(ROAD_EVENTS, (e) => e.weight)
    : weighted(ROAD_EVENTS, (e) => e.weight);
  const kind = wantKind ?? eventKind(event);
  const priority = wantPriority ?? weighted(Object.entries(event.priorities), ([, p]) => p)[0];
  const detectedBy = await cameraFor(site);

  // A few metres of scatter at a fixed site, so twenty collisions over an afternoon are not
  // twenty marks stacked on one pixel. A point already snapped onto a road stays on it.
  const jitter = () => (site.id ? (Math.random() - 0.5) * 0.0016 : 0);

  const { incident } = await incidentsSvc.create({
    kind,
    priority,
    lng: site.lng + jitter(),
    lat: site.lat + jitter(),
    floor: null,
    source: 'sensor',
    detectedBy,
    chiefComplaint: event.complaint,
    accessNote: `${event.label} — ${site.road}`,
    patientsCount: patients ?? Math.round(rand(event.patients[0], event.patients[1])),
  }, CAMERA_AI);

  await query('UPDATE incidents SET run_id = $2 WHERE ref = $1', [incident.ref, runId]);
  counters.generated++;
  return { ref: incident.ref, kind, priority, zone: site.zone, road: site.road, detectedBy };
}

let lastGeneratedAt = 0;

async function maybeGenerate() {
  if (!settings.running) return;
  try {
    // ONE STORY AT A TIME (trial build): the curated scenarios, each finished before the
    // next is raised — see the demonstration section above.
    if (poc.enabled) {
      await scenarioTick();
      return;
    }
    if (Date.now() < nextCallAt) return;
    lastGeneratedAt = Date.now();
    nextCallAt = Date.now() + exponentialGapMs();
    await generateRoadIncident();
  } catch (err) {
    logger.warn({ err: err.message }, '[sim] road incident generation failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AI DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

function wireAutoDispatch() {
  bus.on('incident:new', async (s) => {
    if (!settings.autoDispatch || s.isResting || held.has(s.ref)) return;
    const { rules } = await effectiveRules();
    // A priority the duty officer has taken off automatic dispatch waits for a person.
    // Said once, on the incident's own log, so nobody wonders why the countdown never came.
    if (!rules.autoDispatch[s.priority]) {
      decisions.note(s.ref, 'manual', `Automatic dispatch is off for ${s.priority} — waiting for a dispatcher to send an ambulance`);
      broadcast(true);
      return;
    }
    const windowSec = rules.windowSec[s.priority] ?? CALL_HANDLING_SEC[s.priority] ?? 60;
    pendingAuto.set(s.ref, { dueAt: Date.now() + windowSec * paceWait() * 1000, windowSec, priority: s.priority, kind: s.kind, zoneName: s.zoneName });
    broadcast(true);
  });
  // Anyone dispatching the call — a person or the AI — ends the countdown.
  bus.on('assignment:offer', ({ incident }) => {
    if (incident && pendingAuto.delete(incident.ref)) broadcast(true);
  });
  bus.on('incident:closed', (s) => {
    if (pendingAuto.delete(s.ref)) broadcast(true);
  });
  setPendingCheck(isPendingAuto);
}

const AUTO_CLOSE = Object.freeze({
  id: null, ref: 'AUTO-CLOSE', name: 'Automatic close', role: 'system', kind: 'system',
  agencyCode: 'DCAS', agencyId: null, unitId: null, zoneScope: [],
});

/**
 * When the last crew on an incident clears, the incident is finished: close it with the
 * outcome the crews' own actions recorded (a patient taken to hospital is `transported`,
 * otherwise `treated_released`). Without this, a finished call would sit on every screen
 * as a live emergency with no ambulance — the one thing a duty officer must never ignore.
 */
function wireAutoClose() {
  bus.on('assignment:update', (p) => {
    if (p.state !== 'cleared') return;
    setTimeout(() => void autoClose(p.incidentRef), 3000);
  });
}

async function autoClose(ref) {
  try {
    const row = await one(
      `SELECT i.state, i.is_resting,
              COUNT(a.id) FILTER (WHERE a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))::int AS active,
              COUNT(a.id) FILTER (WHERE a.transporting_at IS NOT NULL)::int AS transported
         FROM incidents i LEFT JOIN assignments a ON a.incident_id = i.id
        WHERE i.ref = $1 GROUP BY i.id`,
      [ref],
    );
    // A resting incident is left open as scenery — except in the trial build, where its
    // crew now actually works it (syncCrews) and it closes like any other job.
    if (!row || row.state === 'closed' || (row.is_resting && !poc.enabled) || row.active > 0) return;
    await incidentsSvc.close(ref, { outcome: row.transported > 0 ? 'transported' : 'treated_released' }, AUTO_CLOSE);
  } catch (err) {
    if (!(err instanceof AppError && err.status === 409)) logger.warn({ err: err.message, ref }, '[sim] auto-close failed');
  }
}

/**
 * How long to wait before asking again when every qualifying ambulance is committed.
 *
 * With eight ambulances (config/poc.js) "all eight are busy" is an ordinary afternoon,
 * not an edge case. The incident stays in the queue and is offered to the first crew that
 * clears; the room is told once (the alert's own cooldown), not every fifteen seconds.
 */
const NO_UNIT_RETRY_MS = 15_000;

/** P3 and P4 may be held to keep this many ambulances free; P1 and P2 never are. */
const RESERVABLE = new Set(['P3', 'P4']);

async function runAutoDispatch() {
  const now = Date.now();
  const due = [...pendingAuto].filter(([, p]) => now >= p.dueAt);
  if (!due.length) return broadcast();
  const policy = await effectiveRules();
  for (const [ref, p] of due) {
    pendingAuto.delete(ref);
    try {
      // Switched to manual while its countdown ran: hand it back to a person.
      if (!p.forced && !policy.rules.autoDispatch[p.priority]) {
        decisions.note(ref, 'manual', `Automatic dispatch is off for ${p.priority} — waiting for a dispatcher to send an ambulance`);
        continue;
      }
      const inc = await dispatch.loadIncident(ref, AI_DISPATCH);
      if (inc.state === 'closed') continue;
      const active = await one(
        `SELECT 1 FROM assignments WHERE incident_id = $1
            AND state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene') LIMIT 1`,
        [inc.id],
      );
      if (active) continue;

      // The reserve: a low-priority call does not take the fleet below the floor.
      if (!p.forced && RESERVABLE.has(inc.priority) && policy.fleet.free != null && policy.fleet.free <= policy.rules.reserveMin) {
        decisions.note(ref, 'reserve', `Holding: sending an ambulance now would leave fewer than ${policy.rules.reserveMin} free for a life-threatening call — dispatching as soon as a crew clears`);
        pendingAuto.set(ref, { ...p, dueAt: now + NO_UNIT_RETRY_MS });
        continue;
      }

      // The preview is the AI's reasoning the room has been watching; re-think only when
      // it is missing, failed, or old enough that the fleet has moved on since.
      const pv = decisions.previewFor(ref);
      const age = pv?.readyAt ? now - Date.parse(pv.readyAt) : Infinity;
      if (!pv || pv.status === 'failed' || pv.status === 'no_unit' || age > 60_000) await decisions.think(ref);
      const trafficDelays = decisions.delaysFor(ref);
      // The road each leading crew would actually drive, timed by the drive model — the
      // same figures the room watched the AI weigh.
      const routeTimes = decisions.routeTimesFor(ref);

      const rec = await dispatch.recommendFor(inc, { trafficDelays, routeTimes });
      const top = rec.value?.recommendations?.[0];
      if (!top) {
        decisions.note(ref, 'nounit', 'Every suitable trial ambulance is committed — it goes to the first crew that clears', 'bad');
        raise({
          key: `noambulance:${ref}`, level: 'critical', category: 'waiting', priority: inc.priority, incidentRef: ref,
          title: `No ambulance available for ${inc.priority} ${kindLabel(inc.kind)} ${ref}`,
          body: 'Every trial ambulance is committed. It will be dispatched to the first crew that clears.',
          actions: [{ kind: 'open_incident', label: 'Open incident', payload: { incidentRef: ref } }],
        });
        // Back in the queue, not out of it. Automatic dispatch is the only dispatch in this
        // build, so an incident dropped here would wait for ever.
        pendingAuto.set(ref, { ...p, dueAt: now + NO_UNIT_RETRY_MS });
        continue;
      }
      if (top.arrivalSec > policy.rules.escalateArrivalSec) {
        raise({
          key: `slowbest:${ref}`, level: 'warning', category: 'waiting', priority: inc.priority, incidentRef: ref,
          title: `Best ambulance for ${inc.priority} ${ref} is ${Math.round(top.arrivalSec / 60)} min away`,
          body: `${top.callsign} is the fastest suitable crew, over the ${Math.round(policy.rules.escalateArrivalSec / 60)} min escalation rule. It has been sent; consider support from outside the trial fleet.`,
          actions: [{ kind: 'open_incident', label: 'Open incident', payload: { incidentRef: ref } }],
        });
      }
      if (top.paired) decisions.note(ref, 'paired', top.pairedWhy, 'good');
      await dispatch.commitDispatch(ref, {
        unitRef: top.unitRef, trafficDelays, routeTimes,
        routePath: decisions.chosenRoad(ref, top.unitRef)?.coords ?? null,
      }, AI_DISPATCH);
      counters.autoDispatched++;
    } catch (err) {
      if (!(err instanceof AppError && err.status === 409)) logger.warn({ err: err.message, ref }, '[sim] auto-dispatch failed');
    }
  }
  broadcast();
}

/**
 * Anything live with nobody on it, that the queue has lost track of.
 *
 * The countdown queue is in memory, filled by `incident:new`. Two things empty it without
 * dispatching: a server restart (the incident is in the database, the countdown is gone),
 * and an offer that timed out past the re-dispatch limit. Either way the incident is on
 * the board with no ambulance and no countdown — and in an automatic-dispatch trial there
 * is nobody whose job it is to notice. This sweep is that somebody: it finds every such
 * incident and puts it back in the queue, due now.
 */
async function sweepUndispatched() {
  if (!settings.autoDispatch) return;
  const { rules } = await effectiveRules();
  // Resting incidents included: the "awaiting" one exists to show the first dispatch, and
  // in an automatic-dispatch trial the first dispatch is the AI's — left waiting, it would
  // sit on the board for ever beside five free ambulances.
  const { rows } = await pool.query(`
    SELECT i.ref, i.priority, i.kind, z.name AS zone_name, i.reported_at
      FROM incidents i LEFT JOIN zones z ON z.id = i.zone_id
     WHERE i.state NOT IN ('closed', 'cancelled', 'resolved_on_scene', 'non_emergency')
       AND NOT i.is_seed
       AND i.first_onscene_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.incident_id = i.id
             AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene'))
     ORDER BY i.reported_at
     LIMIT 20`);
  let queued = 0;
  for (const r of rows) {
    if (pendingAuto.has(r.ref) || held.has(r.ref) || !rules.autoDispatch[r.priority]) continue;
    // The ordinary window still applies to an incident younger than it, so the console
    // shows the same countdown it would have shown had the queue never lost it.
    const windowSec = rules.windowSec[r.priority] ?? CALL_HANDLING_SEC[r.priority] ?? 60;
    const dueAt = Math.max(Date.now(), new Date(r.reported_at).getTime() + windowSec * 1000 * paceWait());
    pendingAuto.set(r.ref, { dueAt, windowSec, priority: r.priority, kind: r.kind, zoneName: r.zone_name });
    queued++;
  }
  if (queued) {
    logger.info({ queued }, '[sim] re-queued undispatched incidents for automatic dispatch');
    broadcast(true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CREWS
// ═══════════════════════════════════════════════════════════════════════════════

const ACTIVE = ['offered', 'acknowledged', 'enroute', 'onscene', 'transporting', 'at_hospital', 'resolved_on_scene'];

async function syncCrews() {
  const { rows } = await pool.query(`
    SELECT a.ref, a.state, a.offered_at, a.acknowledged_at, a.onscene_at, a.at_patient_at, a.at_hospital_at,
           a.route_proposed_sec,
           CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS route_proposed,
           u.id AS unit_id, u.ref AS unit_ref, u.kind AS unit_kind, u.status AS unit_status,
           ST_X(u.current_geom) AS ulng, ST_Y(u.current_geom) AS ulat,
           i.ref AS inc_ref, i.priority, i.kind, i.floor, i.run_id, i.reported_at, ST_X(i.geom) AS ilng, ST_Y(i.geom) AS ilat,
           h.id AS hospital_id, ST_X(h.geom) AS hlng, ST_Y(h.geom) AS hlat
      FROM assignments a
      JOIN units u ON u.id = a.unit_id
      JOIN incidents i ON i.id = a.incident_id
      LEFT JOIN hospitals h ON h.id = a.hospital_id
     WHERE a.state = ANY($1) AND (NOT i.is_resting OR $2)`,
    // The resting incidents are scenery in the emirate-wide build: frozen mid-flight, so
    // the Operations board always has something to show. In the trial build they would
    // freeze three of the eight ambulances for good, and an offer on the "awaiting" one
    // would time out for ever. So here they play out like any other job — the crews
    // finish them, and the ambulances come back into service.
    [ACTIVE, poc.enabled]);

  const onJob = new Set();
  deviceJobs.clear();
  const active = new Set(rows.map((r) => r.ref));
  for (const ref of deviceHospitalRoutes.keys()) if (!active.has(ref)) deviceHospitalRoutes.delete(ref);
  for (const r of rows) {
    onJob.add(r.unit_id);
    if (unitDeviceOnline(r.unit_id)) {
      crews.delete(r.unit_id);
      deviceJobs.set(r.ref, r.unit_id);
      if (r.state === 'transporting' && r.hlng != null && r.ulng != null && !deviceHospitalRoutes.has(r.ref)) {
        planDeviceHospitalRoute(r.ref, [r.ulng, r.ulat], [r.hlng, r.hlat]);
      }
      continue;
    }
    let crew = crews.get(r.unit_id);
    if (!crew || crew.asgRef !== r.ref) {
      // A demonstration crew always takes the job: a scripted story that sometimes
      // re-dispatches for no visible reason is a confusing story, not a realistic one.
      const scripted = demoIncidents.has(r.inc_ref);
      crew = {
        unitId: r.unit_id, unitRef: r.unit_ref, asgRef: r.ref, busy: false, scripted,
        decline: !scripted && Math.random() < 0.03, silent: !scripted && Math.random() < 0.02,
      };
      crews.set(r.unit_id, crew);
    }
    crew.row = r;
    if (crew.state !== r.state || (r.state === 'onscene' && crew.atPatient !== Boolean(r.at_patient_at))) {
      enterState(crew, r);
    }
  }

  // Off a job: drive home, or to a standby point a dispatcher (or an alert) chose.
  const { rows: idle } = await pool.query(`
    SELECT u.id, u.ref, u.status, ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
           ST_X(u.standby_geom) AS sblng, ST_Y(u.standby_geom) AS sblat,
           ST_X(s.geom) AS hlng, ST_Y(s.geom) AS hlat,
           ST_Distance(u.current_geom::geography, s.geom::geography) AS from_home_m
      FROM units u LEFT JOIN stations s ON s.id = u.home_station_id
     WHERE u.archived_at IS NULL AND u.current_geom IS NOT NULL
       AND (u.id = ANY($1) OR u.status = 'relocating')`, [[...crews.keys()]]);
  for (const u of idle) {
    if (onJob.has(u.id) || unitDeviceOnline(u.id)) continue;
    const crew = crews.get(u.id) ?? { unitId: u.id, unitRef: u.ref, busy: false };
    crews.set(u.id, crew);
    if (u.status === 'relocating' && u.sblng != null) {
      if (crew.phase !== 'relocate') {
        Object.assign(crew, { asgRef: null, state: null, phase: 'relocate', path: null, arrived: false });
        planRoute(crew, [u.lng, u.lat], [u.sblng, u.sblat], 'relocate');
      }
    } else if (u.status === 'available' && u.hlng != null && u.from_home_m > 60) {
      if (crew.phase !== 'return') {
        Object.assign(crew, { asgRef: null, state: null, phase: 'return', path: null, arrived: false });
        planRoute(crew, [u.lng, u.lat], [u.hlng, u.hlat], 'return');
      }
    } else {
      crews.delete(u.id);
    }
  }
}

function enterState(crew, r) {
  crew.state = r.state;
  crew.atPatient = Boolean(r.at_patient_at);
  crew.path = null;
  crew.arrived = false;
  const at = (v) => (v ? new Date(v).getTime() : Date.now());
  const w = paceWait();
  // A demonstration job keeps every interval a crew actually controls REAL (acknowledging
  // on the tablet, getting belted in and rolling, walking to the patient) and shortens
  // only time at the patient's side and the hospital hand-over, so a whole job — detection
  // to hand-over — fits in a demonstration without any drive or turnout being faked.
  const s = crew.scripted;
  switch (r.state) {
    case 'offered':
      crew.phase = 'ack';
      crew.dueAt = at(r.offered_at) + (s ? rand(8, 13) : rand(2, 5)) * 1000 * w;
      break;
    case 'acknowledged':
      crew.phase = 'turnout';
      crew.dueAt = at(r.acknowledged_at) + (s
        ? (r.priority === 'P1' ? rand(24, 32) : rand(30, 40))
        : (r.unit_status === 'standby' ? rand(3, 5) : rand(4, 8))) * 1000 * w;
      break;
    case 'enroute':
      crew.phase = 'drive_scene';
      // Traffic judged at the moment of the alert — the same instant the AI weighed it at
      // (services/decisions.js), so the red stretches it saw are the ones this crew meets.
      planRoute(crew, [r.ulng, r.ulat], [r.ilng, r.ilat], 'scene', {
        chosen: decisions.chosenRoad(r.inc_ref, r.unit_ref),
        proposed: r.route_proposed?.coordinates,
        trafficAt: r.reported_at ? new Date(r.reported_at).getTime() : Date.now(),
      });
      break;
    case 'onscene':
      if (!r.at_patient_at) {
        crew.phase = 'vrt';
        crew.dueAt = at(r.onscene_at) + (r.floor != null ? Math.min(420, 60 + r.floor * 5) : s ? rand(20, 30) : rand(25, 50)) * 1000 * w;
      } else {
        crew.phase = 'treat';
        crew.dueAt = at(r.at_patient_at) + (s ? rand(100, 140)
          : r.priority === 'P1' ? rand(300, 460) : r.priority === 'P2' ? rand(220, 340) : rand(160, 260)) * 1000 * w;
      }
      break;
    case 'transporting':
      crew.phase = 'drive_hospital';
      if (r.hlng != null) planRoute(crew, [r.ulng, r.ulat], [r.hlng, r.hlat], 'hospital', { incidentRef: r.inc_ref });
      break;
    case 'at_hospital':
      crew.phase = 'handover';
      crew.dueAt = at(r.at_hospital_at) + (s ? rand(55, 75) : rand(140, 230)) * 1000 * w;
      break;
    case 'resolved_on_scene':
      crew.phase = 'resolve';
      crew.dueAt = Date.now() + rand(50, 100) * 1000 * w;
      break;
    default:
      crew.phase = null;
  }
}

/**
 * The road for a leg, and how this crew will drive it.
 *
 * To the scene, the crew drives the road the AI chose for it (services/decisions.js
 * `chosenRoad`) — the one the room watched it pick — or, failing that, the proposed route
 * stored at dispatch. Every other leg (to hospital, back to station, to a standby point)
 * is chosen here the same way: the router's main route and its alternatives, each driven
 * through the drive model (engines/drive.js), and the quickest taken. A straight line
 * stands in — honestly, and only until the road answers — when routing is unavailable.
 *
 * The result is a SPEED PROFILE, not a speed: the vehicle accelerates away from rest,
 * cruises by road class, brakes for every turn, roundabout and U-turn, crawls through a
 * congested stretch, and pulls up at the end. The drive loop follows it in time, so the
 * arrival the profile predicts is the arrival that happens.
 */
function planRoute(crew, from, to, leg, { chosen = null, proposed = null, trafficAt = Date.now(), incidentRef = null } = {}) {
  if (from[0] == null || to[0] == null) return;
  crew.leg = leg;
  crew.routing = true;
  const token = Symbol('route');
  crew.routeToken = token;
  const mode = leg === 'return' || leg === 'relocate' ? 'return' : 'emergency';
  (async () => {
    let raw = null;
    let road = null;
    if (chosen?.coords?.length > 1 && haversine(chosen.coords[0], from) < 200) raw = chosen;
    else if (proposed?.length > 1 && haversine(proposed[0], from) < 200) raw = { coords: proposed, steps: [], speeds: [] };
    if (!raw) {
      road = await decisions.bestRoad(from, to, { at: trafficAt, mode }).catch(() => null);
      raw = road?.best.raw ?? null;
      if (raw && leg === 'scene' && crew.asgRef) storeProposedRoute(crew, raw.coords);
    }
    if (crew.routeToken !== token) return;   // superseded while routing
    const onRoad = Boolean(raw);
    const path = await buildPath(raw ?? { coords: straightLine(from, to), steps: [], speeds: [] }, from, to, leg, trafficAt, mode);
    if (crew.routeToken !== token) return;
    // Each crew drives a touch differently — the same road, ±3 % on the clock.
    crew.pace = rand(0.97, 1.03);
    crew.elapsed = 0;
    crew.path = { ...path, onRoad, startedAt: Date.now() };
    crew.routing = false;

    // The transport leg is a decision too — which road to the hospital, and why — and the
    // incident's AI log says so (services/decisions.js noteLeg).
    if (leg === 'hospital' && incidentRef && path.drive) {
      decisions.noteLeg(incidentRef, 'hospital', {
        asgRef: crew.asgRef, unitRef: crew.unitRef,
        stats: driveModel.summary(path.drive),
        why: road?.why ?? [],
        options: road ? [road.best, ...road.others].map((x, i) => ({ label: String.fromCharCode(65 + i), chosen: i === 0, ...driveModel.summary(x.a) })) : [],
        hospitalWhy: crew.hospitalWhy ?? null,
      });
    }
    if (!onRoad) scheduleReroute(crew, token, to, leg);
  })().catch((err) => {
    crew.routing = false;
    logger.warn({ err: err.message, unit: crew.unitRef }, '[sim] route planning failed');
  });
}

/** A path the crew can drive: anchored at where it is and where it is going, with the
 *  (simulated) traffic on it — once per leg (sim/traffic.js) — and the speed profile the
 *  drive model builds over it, congested stretches included. */
async function buildPath(raw, from, to, leg, trafficAt, mode = 'emergency') {
  let c = raw.coords;
  let speeds = raw.speeds ?? [];
  if (haversine(c[0], from) > 25) { c = [from, ...c]; speeds = speeds.length ? [speeds[0], ...speeds] : speeds; }
  if (haversine(c[c.length - 1], to) > 25) { c = [...c, to]; speeds = speeds.length ? [...speeds, speeds[speeds.length - 1]] : speeds; }
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine(c[i - 1], c[i]));
  const total = cum[cum.length - 1];
  const jam = leg === 'scene' || leg === 'hospital'
    ? traffic.analyseRoute(c, { at: trafficAt, queues: await traffic.activeQueues() })
    : { segments: [], delaySec: 0 };
  const analysed = driveModel.withTraffic(driveModel.analyse({ coords: c, steps: raw.steps ?? [], speeds }, { mode }), jam.segments);
  return { coords: c, cum, total, travelled: 0, traffic: jam.segments, trafficDelaySec: analysed?.trafficDelaySec ?? jam.delaySec, drive: analysed };
}

/** The console draws the road ahead of every ambulance; a phone-driven one has no
 *  simulated crew to plan its hospital leg, so the road is fetched once here. A failed
 *  fetch is forgotten, so the next sync asks again. */
function planDeviceHospitalRoute(asgRef, from, to) {
  deviceHospitalRoutes.set(asgRef, null);
  decisions.bestRoad(from, to)
    .then((road) => {
      if (!deviceHospitalRoutes.has(asgRef)) return;
      if (road?.best.raw.coords?.length > 1) deviceHospitalRoutes.set(asgRef, road.best.raw.coords);
      else deviceHospitalRoutes.delete(asgRef);
    })
    .catch(() => deviceHospitalRoutes.delete(asgRef));
}

const REROUTE_EVERY_MS = 4000;
const REROUTE_TRIES = 15;

/**
 * A crew put on a straight line because routing did not answer keeps asking for the
 * road, and joins it from wherever it has got to — no ambulance drives a whole leg
 * across the desert because one request was slow.
 */
function scheduleReroute(crew, token, to, leg, tries = 0) {
  if (tries >= REROUTE_TRIES) return;
  const timer = setTimeout(async () => {
    if (crew.routeToken !== token || !crew.path || crew.arrived || crew.path.onRoad) return;
    const { at } = pointAlong(crew.path, crew.path.travelled);
    const road = await decisions.bestRoad(at, to, { mode: leg === 'return' || leg === 'relocate' ? 'return' : 'emergency' }).catch(() => null);
    if (crew.routeToken !== token || !crew.path || crew.arrived) return;
    if (!road) {
      scheduleReroute(crew, token, to, leg, tries + 1);
      return;
    }
    const path = await buildPath(road.best.raw, at, to, leg, Date.now(), leg === 'return' || leg === 'relocate' ? 'return' : 'emergency');
    if (crew.routeToken !== token || !crew.path || crew.arrived) return;
    // Joining the road on the move: the profile's standing start does not apply.
    crew.elapsed = Math.min(path.drive?.tcum?.[3] ?? 0, 6);
    crew.path = { ...path, onRoad: true, startedAt: Date.now() };
    if (leg === 'scene' && crew.asgRef) storeProposedRoute(crew, road.best.raw.coords);
    logger.info({ unit: crew.unitRef, leg }, '[sim] back on the road route');
  }, REROUTE_EVERY_MS);
  timer.unref?.();
}

/**
 * The road actually driven, written when the ambulance arrives.
 *
 * `route_proposed` was already stored at dispatch; nothing wrote `route_taken`, so of
 * 409k assignments only the 21 that came from the seed had one. That is the difference
 * between "we keep the routes" and "we keep the route we intended to take" — and the
 * proposed-vs-taken delta is exactly the signal the ETA model and the pre-empt case are
 * built on (docs/08 §2.1, the Concept Note's §07 route/SLA panel).
 *
 * Stored with the seconds and metres it actually took, so an after-action read needs no
 * geometry maths to answer "was the route we proposed the route that happened".
 */
async function storeDrivenRoute(crew, leg = 'scene') {
  const p = crew.path;
  if (!crew.asgRef || !p?.coords?.length || !p.startedAt) return;
  // The transport leg is recorded in its own columns, so a replay can drive the WHOLE job
  // — to the patient and on to hospital — along roads rather than between breadcrumbs.
  const col = leg === 'hospital'
    ? { geom: 'route_hospital', sec: 'route_hospital_sec', m: 'route_hospital_m' }
    : { geom: 'route_taken', sec: 'route_taken_sec', m: 'route_taken_m' };
  try {
    await pool.query(
      `UPDATE assignments
          SET ${col.geom} = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
              ${col.sec}  = $3,
              ${col.m}    = $4
        WHERE ref = $1 AND ${col.geom} IS NULL`,
      [
        crew.asgRef,
        JSON.stringify({ type: 'LineString', coordinates: p.coords }),
        Math.max(1, Math.round((Date.now() - p.startedAt) / 1000)),
        Math.round(p.total),
      ],
    );
  } catch (err) {
    logger.debug({ err: err.message, unit: crew.unitRef }, '[sim] storing driven route failed');
  }
}

async function storeProposedRoute(crew, coords) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE assignments SET route_proposed = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)
        WHERE ref = $1 AND route_proposed IS NULL`,
      [crew.asgRef, JSON.stringify({ type: 'LineString', coordinates: coords })],
    );
    if (rowCount && crew.row) {
      fanout.assignmentUpdate({ incidentRef: crew.row.inc_ref, unitRef: crew.unitRef, ref: crew.asgRef, state: crew.row.state, at: new Date().toISOString() });
    }
  } catch (err) {
    logger.debug({ err: err.message }, '[sim] storing proposed route failed');
  }
}

async function act(crew, action, body = {}) {
  crew.busy = true;
  try {
    await dispatch.transition(crew.asgRef, action, body, crewActor(crew));
  } catch (err) {
    if (!(err instanceof AppError && (err.status === 409 || err.status === 404))) {
      logger.warn({ err: err.message, unit: crew.unitRef, action }, '[sim] crew step failed');
    }
  } finally {
    // Wait for the next sync to read back the state the step produced, rather than
    // repeating the step against a state that has already moved on.
    crew.state = null;
    crew.phase = null;
    crew.busy = false;
  }
}

async function stepCrew(crew, dtSec) {
  if (crew.busy) return;
  const now = Date.now();
  const r = crew.row;

  switch (crew.phase) {
    case 'ack':
      if (now < crew.dueAt || crew.silent) return;   // a silent crew lets the acknowledge timeout fire
      if (crew.decline) return act(crew, 'decline', { reason: 'Crew committed to a patient hand-over — request next unit' });
      return act(crew, 'acknowledge');
    case 'turnout':
      if (now >= crew.dueAt) return act(crew, 'enroute');
      return;
    case 'vrt':
      if (now >= crew.dueAt) return act(crew, 'at_patient', r?.floor != null ? { floor: r.floor } : {});
      return;
    case 'treat': {
      if (now < crew.dueAt) return;
      // A demonstration job always goes on to hospital: the transport leg is half the story.
      if (!dispatch.canTransport(r.unit_kind) || (!crew.scripted && Math.random() > transportProbability(r.kind, r.priority))) return act(crew, 'resolve');
      crew.busy = true;
      try {
        const ranking = await dispatch.hospitalRecommendation(r.inc_ref, AI_DISPATCH);
        const best = ranking.value?.hospitals?.find((h) => !h.onDiversion) ?? ranking.value?.hospitals?.[0];
        crew.busy = false;
        if (!best) return act(crew, 'resolve');
        crew.hospitalWhy = best.reasoning ?? null;
        return act(crew, 'transporting', { hospitalRef: best.ref });
      } catch (err) {
        crew.busy = false;
        logger.warn({ err: err.message, unit: crew.unitRef }, '[sim] hospital choice failed — resolving on scene');
        return act(crew, 'resolve');
      }
    }
    case 'handover':
      if (now >= crew.dueAt) return act(crew, 'clear');
      return;
    case 'resolve':
      if (now >= crew.dueAt) return act(crew, 'clear');
      return;
    case 'drive_scene':
    case 'drive_hospital':
    case 'return':
    case 'relocate':
      return drive(crew, dtSec);
    default:
  }
}

async function drive(crew, dtSec) {
  const p = crew.path;
  if (!p || crew.arrived) return;
  let mps;
  if (p.drive) {
    // Follow the speed profile IN TIME (engines/drive.js): away from rest, up to the road's
    // cruise, down for each turn and roundabout, slow through a queue, pull up at the end.
    // Time-based, so the arrival the profile predicted is the arrival that happens.
    crew.elapsed = (crew.elapsed ?? 0) + dtSec * paceSpeed() / (crew.pace ?? 1);
    const before = p.travelled;
    // The profile's clock has run out: the vehicle is there, whatever a rounding error in
    // the last metre says (a crew stuck 0.4 m short of the scene never arrives).
    const done = crew.elapsed >= p.drive.tcum[p.drive.tcum.length - 1];
    p.travelled = done ? p.total : Math.min(p.total, driveModel.distanceAt(p.drive, crew.elapsed));
    mps = Math.max(0, (p.travelled - before) / Math.max(0.2, dtSec));
    // The speed shown is the speed at this point of the road, not the tick's average.
    const here = driveModel.speedAt(p.drive, p.travelled) / (crew.pace ?? 1);
    crew.nowMps = p.travelled >= p.total ? 0 : Math.max(0, (here + mps) / 2);
  } else {
    // No profile (should not happen): an even 12 m/s, slowed in a congested stretch.
    mps = 12 * paceSpeed() * traffic.factorAt(p.traffic, p.travelled);
    p.travelled = Math.min(p.total, p.travelled + mps * dtSec);
    crew.nowMps = mps;
  }
  mps = crew.nowMps;
  const { at, heading } = pointAlong(p, p.travelled);
  const status = crew.phase === 'drive_scene' ? 'responding'
    : crew.phase === 'drive_hospital' ? 'transporting'
      : crew.phase === 'relocate' ? 'relocating' : 'available';
  await reportPosition({
    unitId: crew.unitId, unitRef: crew.unitRef, lng: at[0], lat: at[1],
    speed: Math.round(mps * 3.6), heading, status,
    runId: crew.row?.run_id ?? runId,
  });
  if (p.travelled < p.total) return;

  crew.arrived = true;
  switch (crew.phase) {
    case 'drive_scene':
      // Record the trace BEFORE the transition, so the after-action read of a closed
      // incident always has it — the assignment row is what outlives the simulation.
      await storeDrivenRoute(crew);
      return act(crew, 'onscene');
    case 'drive_hospital': {
      await storeDrivenRoute(crew, 'hospital');
      if (crew.row?.hospital_id) await fillBed(crew.row.hospital_id);
      return act(crew, 'at_hospital');
    }
    case 'relocate':
      crew.busy = true;
      try {
        await unitsSvc.setStatus(crew.unitRef, { status: 'standby', reason: 'Arrived at standby point' }, AI_DISPATCH);
      } catch (err) {
        logger.debug({ err: err.message }, '[sim] standby on arrival failed');
      }
      crew.busy = false;
      crews.delete(crew.unitId);
      return;
    case 'return':
      crews.delete(crew.unitId);
      return;
    default:
  }
}

function transportProbability(kind, priority) {
  if (['cardiac_arrest', 'stroke', 'cardiac', 'obstetric'].includes(kind)) return 0.92;
  if (priority === 'P1') return 0.9;
  if (priority === 'P2') return 0.78;
  if (priority === 'P3') return 0.5;
  return 0.25;
}

// ── Emergency department load — ambulances fill beds, time frees them ──────────

async function fillBed(hospitalId) {
  edBoost.set(hospitalId, (edBoost.get(hospitalId) ?? 0) + 1);
  await query('UPDATE hospitals SET ed_occupied = LEAST(ed_beds, ed_occupied + 1) WHERE id = $1', [hospitalId]).catch(() => {});
}

async function releaseBeds() {
  for (const [hospitalId, beds] of edBoost) {
    if (beds <= 0) { edBoost.delete(hospitalId); continue; }
    edBoost.set(hospitalId, beds - 1);
    await query('UPDATE hospitals SET ed_occupied = GREATEST(0, ed_occupied - 1) WHERE id = $1', [hospitalId]).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Geometry
// ═══════════════════════════════════════════════════════════════════════════════

function haversine(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

function straightLine(from, to) {
  const out = [];
  for (let i = 0; i <= 40; i++) out.push([from[0] + (to[0] - from[0]) * (i / 40), from[1] + (to[1] - from[1]) * (i / 40)]);
  return out;
}

function pointAlong(path, distance) {
  const { coords, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < distance) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (distance - cum[i - 1]) / segLen));
  const a = coords[i - 1];
  const b = coords[i];
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Live read for the dashboard map — where every ambulance on a job is going
// ═══════════════════════════════════════════════════════════════════════════════

export async function liveAssignments() {
  const { rows } = await pool.query(`
    SELECT a.ref, a.state, a.offered_at, a.enroute_at, a.onscene_at, a.eta_predicted_at,
           CASE WHEN a.route_proposed IS NULL THEN NULL ELSE ST_AsGeoJSON(a.route_proposed)::json END AS route_proposed,
           u.id AS unit_id, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
           ST_X(u.current_geom) AS ulng, ST_Y(u.current_geom) AS ulat,
           i.ref AS inc_ref, i.priority, i.kind, i.reported_at, i.first_onscene_at,
           ST_X(i.geom) AS ilng, ST_Y(i.geom) AS ilat, z.name AS zone_name,
           h.ref AS hospital_ref, h.name AS hospital_name, ST_X(h.geom) AS hlng, ST_Y(h.geom) AS hlat
      FROM assignments a
      JOIN units u ON u.id = a.unit_id
      JOIN incidents i ON i.id = a.incident_id
      LEFT JOIN zones z ON z.id = i.zone_id
      LEFT JOIN hospitals h ON h.id = a.hospital_id
     WHERE a.state = ANY($1) AND NOT i.is_resting
     ORDER BY i.priority, a.offered_at`, [ACTIVE]);

  const legs = [];
  for (const [unitId, c] of crews) {
    if (!c.path || c.arrived || (c.phase !== 'return' && c.phase !== 'relocate')) continue;
    legs.push({ unitId, unitRef: c.unitRef, leg: c.phase, path: remaining(c.path) });
  }

  return {
    at: new Date().toISOString(),
    assignments: rows.map((r) => {
      const crew = crews.get(r.unit_id);
      const driving = crew?.asgRef === r.ref && crew.path && !crew.arrived;
      const simPath = driving ? remaining(crew.path) : null;
      const leg = r.state === 'transporting' ? 'hospital' : ['offered', 'acknowledged', 'enroute'].includes(r.state) ? 'scene' : null;
      const jam = driving ? trafficAhead(crew.path) : [];
      return {
        ref: r.ref, state: r.state, leg,
        unitRef: r.unit_ref, callsign: r.callsign, unitKind: r.unit_kind,
        unitPosition: r.ulng != null ? [r.ulng, r.ulat] : null,
        incidentRef: r.inc_ref, priority: r.priority, kind: r.kind, zoneName: r.zone_name,
        incidentPosition: [r.ilng, r.ilat],
        hospital: r.hospital_ref ? { ref: r.hospital_ref, name: r.hospital_name, position: [r.hlng, r.hlat] } : null,
        reportedAt: r.reported_at, onsceneAt: r.onscene_at, etaPredictedAt: r.eta_predicted_at,
        // A unit the simulation is not driving (a crew phone) gets the planned road from
        // where it actually is — the map reads a path's first point as the vehicle.
        path: simPath ?? aheadOf(
          leg === 'scene' ? r.route_proposed?.coordinates ?? null : leg === 'hospital' ? deviceHospitalRoutes.get(r.ref) ?? null : null,
          r.ulng != null ? [r.ulng, r.ulat] : null,
        ),
        simulated: Boolean(crew),
        // The congested stretches of the road still ahead — the only traffic the live map
        // draws (sim/traffic.js; simulated in this build and labelled so on screen).
        traffic: jam.map((j) => ({ level: j.level, cause: j.cause, inM: j.inM, lengthM: j.lengthM, delaySec: j.delaySec, path: j.path })),
        trafficDelaySec: jam.reduce((s, j) => s + j.delaySec, 0),
        remainingM: driving ? Math.round(crew.path.total - crew.path.travelled) : deviceLive(r.ref)?.remainingM ?? null,
        speedKmh: driving && crew.nowMps != null ? Math.round(crew.nowMps * 3.6) : deviceLive(r.ref)?.speedKmh ?? null,
      };
    }),
    legs,
  };
}

/** The part of a planned road still ahead of a vehicle: from the vertex nearest to it. */
function aheadOf(coords, at) {
  if (!coords || coords.length < 2) return null;
  if (!at) return coords;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(coords[i], at);
    if (d < bestD) { bestD = d; best = i; }
  }
  const rest = coords.slice(best + 1);
  return rest.length ? [at, ...rest] : null;
}

function trafficAhead(path) {
  return traffic.ahead(path.traffic, path.travelled, path.coords, path.cum);
}

/** What the decision log needs about a drive in progress (services/decisions.js). A unit
 *  a crew phone is driving has no simulated crew; its own reports stand in. */
export function liveFor(asgRef) {
  for (const c of crews.values()) {
    if (c.asgRef !== asgRef || !c.path || c.arrived) continue;
    const ahead = trafficAhead(c.path).map(({ level, cause, inM, lengthM, delaySec }) => ({ level, cause, inM, lengthM, delaySec }));
    const remainingM = Math.round(c.path.total - c.path.travelled);
    return {
      remainingM,
      speedKmh: c.nowMps != null ? Math.round(c.nowMps * 3.6) : null,
      trafficAhead: ahead,
      // Which drive this is, and when it ends at the pace it is being driven plus the
      // queues still ahead — the scene ETA comes from the dispatch model, but the leg to
      // hospital has no other estimate, and "On scene" was all a transporting crew showed.
      leg: c.leg ?? null,
      // The profile's own clock for the rest of the road — braking, cruising and queues
      // already in it — at this crew's pace.
      etaSec: c.path.drive ? Math.round(driveModel.remainingSec(c.path.drive, c.path.travelled) * (c.pace ?? 1)) : null,
      next: c.path.drive ? driveModel.upcoming(c.path.drive, c.path.travelled) : null,
    };
  }
  const device = deviceLive(asgRef);
  return device ? { ...device, trafficAhead: [] } : null;
}

function deviceLive(asgRef) {
  const unitId = deviceJobs.get(asgRef);
  return unitId ? deviceDriveFor(unitId) : null;
}

function pendingFor(ref) {
  const p = pendingAuto.get(ref);
  if (!p) return null;
  return { dueAt: new Date(p.dueAt).toISOString(), windowSec: p.windowSec ?? null, held: held.has(ref) };
}

/** The road to hospital planned for a phone-driven transport (null until it is known). */
export const deviceHospitalRouteFor = (asgRef) => deviceHospitalRoutes.get(asgRef) ?? null;

/** The road still ahead of a simulated ambulance on this assignment, or null when no
 *  simulated crew is driving it (a real phone, or not moving). */
export function remainingPathFor(asgRef) {
  for (const c of crews.values()) {
    if (c.asgRef === asgRef && c.path && !c.arrived) return remaining(c.path);
  }
  return null;
}

function remaining(path) {
  const { at } = pointAlong(path, path.travelled);
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < path.travelled) i++;
  return [at, ...path.coords.slice(i)];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  The loop
// ═══════════════════════════════════════════════════════════════════════════════

let started = false;
export function startLiveSimulation() {
  if (started) return;
  started = true;
  void loadRules();
  // The AI's reasoning is written down from the moment an incident exists, and reads the
  // countdown and the drive from here (services/decisions.js). Wired BEFORE the dispatcher
  // so an incident's preview exists by the time its countdown is set.
  decisions.wireDecisions();
  decisions.setProviders({ pending: pendingFor, live: liveFor });
  wireAutoDispatch();
  wireAutoClose();

  let tick = 0;
  let last = Date.now();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    const now = Date.now();
    const dt = Math.min(5, (now - last) / 1000);
    last = now;
    tick++;
    try {
      // After a restart, pick the demonstration back up BEFORE the crews are rebuilt, so the
      // crew on a scenario incident keeps the scenario's timings (and always transports).
      if (poc.enabled && !adopted) await adoptInFlight();
      if (tick % 3 === 1) await syncCrews();
      await Promise.all([...crews.values()].map((c) => stepCrew(c, dt).catch((err) =>
        logger.warn({ err: err.message, unit: c.unitRef }, '[sim] crew tick failed'))));
      // Every ten seconds, and on the first tick after a restart.
      if (tick % 10 === 1) await sweepUndispatched();
      await runAutoDispatch();
      await maybeGenerate();
      if (tick % 240 === 0) await releaseBeds();
      if (tick % 2 === 0) broadcast();
    } catch (err) {
      logger.warn({ err: err.message }, '[sim] tick failed');
    } finally {
      running = false;
    }
  }, 1000);
  timer.unref();

  // It starts itself.
  //
  // This build has no simulation panel (config/poc.js) — the client asked for it gone —
  // so there is no button to press, and a console that opened on a stopped service would
  // show an empty emirate and no way to fill it. A control room is running when you walk
  // into it. Failing to start is logged and never fatal: the API, the history and every
  // analytical screen work without it.
  if (poc.enabled) {
    void start({}, { ref: 'SYSTEM' }).then(
      () => logger.info({ perHour: INTENSITY[settings.intensity] }, '[sim] road watch running from boot'),
      (err) => logger.warn({ err: err.message }, '[sim] road watch could not start — screens still render from the database'),
    );
  } else {
    logger.info('[sim] live simulation ready — crews automated; generation starts from the dashboard');
  }
}

/** Used by nowMs-free helpers elsewhere; exported for tests. */
export const _internal = { pointAlong, haversine, bearing, straightLine, nowMs };
