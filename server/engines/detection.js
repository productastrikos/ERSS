/**
 * Camera detection — the engine that raises an incident before anybody dials 998.
 *
 * This is the one claim the product makes that a dispatcher cannot make for themselves,
 * so it is built to be inspectable rather than asserted. A detection runs five stages,
 * each with a real delay and each announced over the socket as it happens:
 *
 *   1 sensor     the raw analytics frame, as the camera reported it
 *   2 validate   the other sources that corroborate it, each with its own result
 *   3 confirm    the verdict, its confidence, and the alternatives that were ruled out
 *   4 alert      services/alerts.raise — the thing that interrupts the room
 *   5 incident   services/incidents.create with `source: 'sensor'`
 *
 * Stage 5 is the point. The incident it creates goes through the ORDINARY path — the same
 * create, the same auto-triage, the same dispatch engine, the same queue — so nothing
 * downstream knows or cares that a camera raised it rather than a caller. What is
 * different is `reported_at`: it is stamped when the camera saw it, not when somebody
 * picked up a phone, and the incident carries `source = 'sensor'` so the gap is
 * measurable afterwards instead of being a slide.
 *
 * The engine holds NO scenario knowledge. What a detection is made of arrives as data
 * from server/sim/scripts/*, the cameras come from data/reference/cameras.js, and what to
 * do about it comes from data/reference/sop.js.
 */

import { randomUUID } from 'node:crypto';
import { nowIso } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { bus } from '../lib/bus.js';
import * as fanout from '../realtime/fanout.js';
import { raise } from '../services/alerts.js';
import * as incidentsSvc from '../services/incidents.js';
import { camerasFor } from '../data/reference/cameras.js';
import { sopFor } from '../data/reference/sop.js';

/** The actor every detection acts as. Not a dispatcher: nobody took this call. */
const CAMERA_AI = Object.freeze({
  id: null, ref: 'CCTV-AI', name: 'Camera analytics', role: 'system', kind: 'system',
  agencyCode: 'DCAS', agencyId: null, unitId: null, zoneScope: [],
});

export const STAGES = ['sensor', 'validate', 'confirm', 'alert', 'incident'];

/** How long each stage is held before the next. Real seconds — the whole point is that
 *  the sequence is fast, and a sequence that claims to be fast must be watchable. */
const STAGE_MS = { sensor: 2200, validate: 2600, confirm: 2400, alert: 1600, incident: 0 };

/** Live detections, newest first. A detection is a live signal like an alert, not a record
 *  — the incident it creates is the record. */
const recent = [];
const RECENT_MAX = 40;
const timers = new Map();

export const list = () => recent.slice(0, RECENT_MAX);
export const get = (id) => recent.find((d) => d.id === id) ?? null;
/** The detection that raised an incident, if one did — the console links them both ways. */
export const forIncident = (ref) => recent.find((d) => d.incidentRef === ref) ?? null;

function publish(detection) {
  fanout.detection(detection);
  bus.publish('detection:stage', detection);
}

/**
 * Run one detection to completion.
 *
 * @param {object} spec
 * @param {string} spec.type            an SOP key — rta_junction (data/reference/sop.js)
 * @param {string[]} spec.cameraIds     the cameras that saw it; the first is the primary
 * @param {object} spec.place           { name, lng, lat, floor, roomName, buildingName }
 * @param {Array}  spec.evidence        stage 1 rows: { label, value, anomalous }
 * @param {Array}  spec.corroboration   stage 2 rows: { source, result }
 * @param {object} spec.verdict         stage 3: { label, severity, confidence, ruledOut: [{ label, answer }] }
 * @param {object} spec.incident        what to create at stage 5 (incidents.create input)
 * @param {string} [spec.runId]         the simulation run, so reset removes it
 */
export async function run(spec) {
  const sop = sopFor(spec.type);
  const detection = {
    id: `DET-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: spec.type,
    sop: sop ? { key: sop.key, title: sop.title, leadAgency: sop.leadAgency, supportingAgencies: sop.supportingAgencies, advisory: sop.advisory, steps: sop.steps } : null,
    stage: null,
    stageIndex: -1,
    stageCount: STAGES.length,
    detectedAt: nowIso(),
    cameras: camerasFor(spec.cameraIds).map((c) => ({
      id: c.id, name: c.name, kind: c.kind, lng: c.lng, lat: c.lat,
      bearing: c.bearing, floor: c.floor, roomId: c.roomId,
      clipUrl: c.clipUrl, primary: c.id === spec.cameraIds[0],
    })),
    place: spec.place,
    evidence: spec.evidence ?? [],
    corroboration: spec.corroboration ?? [],
    verdict: spec.verdict ?? null,
    /** Calls received about this, at the moment the camera raised it. The number the
     *  whole feature exists to make visible. */
    callsReceived: 0,
    incidentRef: null,
    alertId: null,
    error: null,
  };

  recent.unshift(detection);
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;

  await advance(detection, 0, spec);
  return detection;
}

async function advance(detection, index, spec) {
  if (index >= STAGES.length) return;
  const stage = STAGES[index];
  detection.stage = stage;
  detection.stageIndex = index;

  try {
    if (stage === 'alert') detection.alertId = raiseAlert(detection)?.id ?? null;
    if (stage === 'incident') await createIncident(detection, spec);
  } catch (err) {
    detection.error = err.message;
    logger.warn({ err: err.message, detection: detection.id, stage }, '[detection] stage failed');
  }

  publish(detection);

  if (index + 1 >= STAGES.length) return;
  const wait = STAGE_MS[stage] ?? 2000;
  const timer = setTimeout(() => {
    timers.delete(detection.id);
    void advance(detection, index + 1, spec);
  }, wait);
  timer.unref?.();
  timers.set(detection.id, timer);
}

function raiseAlert(d) {
  const cam = d.cameras.find((c) => c.primary) ?? d.cameras[0];
  const severity = d.verdict?.severity ?? 'HIGH';
  return raise({
    key: `detection:${d.id}`,
    level: severity === 'HIGH' ? 'critical' : 'warning',
    category: 'detection',
    title: `${d.verdict?.label ?? 'Incident'} detected — ${d.place?.name ?? 'unknown location'}`,
    body: `${cam?.name ?? 'Camera'} · confidence ${Math.round((d.verdict?.confidence ?? 0) * 100)}% · no call received`,
    speech: `${d.verdict?.label ?? 'Incident'} detected by camera at ${d.place?.name ?? 'an unknown location'}. No call has been received.`,
    popup: true,
    actions: [{ kind: 'openDetection', label: 'Open detection', payload: { detectionId: d.id } }],
  });
}

async function createIncident(d, spec) {
  if (!spec.incident) return;
  const { incident } = await incidentsSvc.create({
    ...spec.incident,
    source: 'sensor',
    callerName: null,
    callerPhone: null,
    callerRole: null,
    detectedBy: d.cameras.find((c) => c.primary)?.id ?? null,
  }, CAMERA_AI);
  d.incidentRef = incident.ref;
  bus.publish('detection:incident', { detectionId: d.id, incidentRef: incident.ref, runId: spec.runId ?? null });
}

/** Stop everything in flight — the simulation stopping must not leave a stage ticking. */
export function clear() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

export function reset() {
  clear();
  recent.length = 0;
}
