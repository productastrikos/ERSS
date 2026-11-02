/**
 * Unit positions — ONE path for every moving ambulance, real or simulated.
 *
 * A responder's phone (socket `unit:position`) and a simulated crew driving its OSRM route
 * (sim/live.js) both land here: the same throttled persistence, the same `unit_positions`
 * breadcrumb the on-scene stamp is read from, the same batched fan-out to every console.
 * The demo therefore exercises the shipping plumbing, not a parallel fake of it — the
 * JBVNL rule (jbvnl_app_context.md §13.3).
 */

import { query } from '../lib/db.js';
import { nowIso } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { bus } from '../lib/bus.js';
import { emitTo, room } from '../realtime/index.js';
import { sosForUnit } from '../realtime/sosLinks.js';

/** The current row is cheap to move; the breadcrumb is what grows. */
const CURRENT_EVERY_MS = 2_000;
/**
 * Breadcrumbs: every 2 s for a crew ON A JOB, every 5 s otherwise.
 *
 * The breadcrumb track is what the after-action replay drives the ambulance along, and at
 * one fix per five seconds a crew at 90 km/h leaves a 125 m gap — enough to cut every
 * corner of the route it actually took. Two seconds is 50 m, which lands the vehicle on
 * the right side of a junction. Idle units keep the cheaper rate: nobody replays a parked
 * ambulance.
 */
const BREADCRUMB_ON_JOB_MS = 2_000;
const BREADCRUMB_IDLE_MS = 5_000;
const ON_JOB = new Set(['responding', 'transporting', 'onscene', 'at_hospital']);

const lastCurrent = new Map();
const lastBreadcrumb = new Map();

/** Frames collected for 1 s, then emitted as one message to every console. */
let frame = new Map();
let frameTimer = null;

function queueFrame(unitRef, pos) {
  frame.set(unitRef, pos);
  if (frameTimer) return;
  frameTimer = setTimeout(() => {
    const out = [...frame.entries()].map(([ref, p]) => ({ unitRef: ref, ...p }));
    frame = new Map();
    frameTimer = null;
    if (!out.length) return;
    emitTo(room.consoleFleet, 'unit:position', out);
    // The caller this ambulance is answering sees it move at the same rate the room does —
    // the citizen app's map is pushed, not polled.
    for (const p of out) {
      const sosRef = sosForUnit(p.unitRef);
      if (sosRef) emitTo(room.sos(sosRef), 'sos:position', { ref: sosRef, unitRef: p.unitRef, lng: p.lng, lat: p.lat, heading: p.heading, speed: p.speed });
    }
  }, 1000);
  frameTimer.unref?.();
}

/** What a crew phone last said about its drive — the console's "to go" and speed for a
 *  unit no simulated crew is driving. Stale after a few seconds of silence. */
const deviceDrive = new Map();
const DEVICE_FRESH_MS = 8_000;

// A PoC restart ends every drive: a phone's last "to go" must not outlive the job it was for.
bus.on('sim:reset', () => deviceDrive.clear());

export function deviceDriveFor(unitId) {
  const d = deviceDrive.get(unitId);
  return d && Date.now() - d.at < DEVICE_FRESH_MS ? { remainingM: d.remainingM, speedKmh: d.speedKmh } : null;
}

/**
 * @param {{ unitId: string, unitRef: string, lng: number, lat: number,
 *           speed?: number|null, heading?: number|null, status?: string|null, runId?: string|null,
 *           remainingM?: number|null }} p
 *   speed in km/h; runId tags a simulated crew's breadcrumbs so a simulation reset removes them;
 *   remainingM is the road still ahead, when the phone is driving a planned route
 */
export async function reportPosition({ unitId, unitRef, lng, lat, speed = null, heading = null, status = null, runId = null, remainingM = null }) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  if (Number.isFinite(remainingM)) {
    deviceDrive.set(unitId, { remainingM: Math.round(remainingM), speedKmh: Number.isFinite(speed) ? Math.round(speed) : null, at: Date.now() });
  } else {
    deviceDrive.delete(unitId);
  }
  queueFrame(unitRef, { lng, lat, speed, heading, status });

  const now = Date.now();
  try {
    if (now - (lastCurrent.get(unitId) ?? 0) >= CURRENT_EVERY_MS) {
      lastCurrent.set(unitId, now);
      await query(
        `UPDATE units SET current_geom = ST_SetSRID(ST_MakePoint($2,$3),4326),
                          current_speed = $4, current_heading = $5, last_seen_at = $6
          WHERE id = $1`,
        [unitId, lng, lat, speed, heading, nowIso()],
      );
    }
    const every = ON_JOB.has(status ?? '') ? BREADCRUMB_ON_JOB_MS : BREADCRUMB_IDLE_MS;
    if (now - (lastBreadcrumb.get(unitId) ?? 0) >= every) {
      lastBreadcrumb.set(unitId, now);
      await query(
        `INSERT INTO unit_positions (unit_id, ts, geom, speed, heading, status, run_id)
         VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,(SELECT status FROM units WHERE id = $1),$7)`,
        [unitId, nowIso(), lng, lat, speed, heading, runId],
      );
    }
  } catch (err) {
    logger.warn({ err: err.message, unitRef }, '[positions] persist failed');
  }
}
