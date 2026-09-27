/**
 * Incidents — create, correct, triage, close, the notes workspace, and multi-agency
 * notification. docs/04 §3.
 *
 * Dispatch and assignment movement live in services/dispatch.js; this module calls into
 * it (recommendation on create, stand-down on close) and never the reverse.
 */

import { pool, transaction } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { CASE_MIX } from '../data/reference/fleet.js';
import { closeBlocker, INCIDENT_OUTCOMES } from '../domain/lifecycle.js';
import { autoTriage } from '../engines/triage.js';

import * as incidents from '../repos/incidents.js';
import * as fleet from '../repos/fleet.js';
import * as reference from '../repos/reference.js';
import * as fanout from '../realtime/fanout.js';
import * as dispatch from './dispatch.js';
import { calibration } from './eta.js';
import { auditActor } from './actor.js';
import { scheduleKpiTick } from './kpi.js';

const SOURCE_LABEL = {
  call_998: '998', call_999: '999 transfer', call_997: '997 transfer', call_996: '996 transfer',
  app_sos: 'app SOS', aed_activation: 'AED cabinet telemetry', cad_feed: 'CAD feed',
  sensor: 'sensor', field_unit: 'a field unit', transfer: 'inter-facility transfer',
};

function inJurisdiction(lng, lat) {
  const b = jurisdiction.bbox;
  return lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

/**
 * Where the incident is. A Makani code wins; otherwise the point, attached to the
 * nearest EXISTING entrance within 60 m. The zone is the community it falls in.
 */
async function resolveLocation({ lng, lat, makani }) {
  let entrance = null;
  if (makani) {
    entrance = await reference.makaniByCode(pool, makani.replace(/\s/g, ''));
    if (!entrance) throw validation({ makani: ['No Makani entrance with that number'] });
    lng = entrance.lng; lat = entrance.lat;
  } else {
    if (lng == null || lat == null) throw validation({ location: ['Give a Makani number or coordinates'] });
    entrance = await reference.nearestMakani(pool, lng, lat, 60);
  }
  if (!inJurisdiction(lng, lat)) throw validation({ location: ['That point is outside the Emirate of Dubai'] });
  const zone = await reference.communityAt(pool, lng, lat);
  return { lng, lat, entrance, zone };
}

// ═══════════════════════════════════════════════════════════════════════════════

export async function list(query, actor) {
  return incidents.listIncidents(pool, { ...query, scope: actor.zoneScope });
}

export async function detail(ref, actor) {
  const inc = await dispatch.loadIncident(ref, actor);
  const [summary, timeline, assignmentRows, notifications, notes, patients] = await Promise.all([
    incidents.incidentSummary(pool, ref),
    incidents.timeline(pool, inc.id),
    fleet.assignmentsForIncident(pool, inc.id),
    incidents.notifications(pool, inc.id, nowIso()),
    incidents.notes(pool, inc.id),
    pool.query(
      `SELECT id, seq, eid_last3, age_band, sex, chief_complaint, triage_tag, gcs, interventions, outcome
         FROM patients WHERE incident_id = $1 ORDER BY seq`, [inc.id],
    ).then((r) => r.rows),
  ]);
  return {
    incident: summary,
    timeline,
    assignments: assignmentRows.map(dispatch.shapeAssignmentWithActions),
    notifications,
    notes,
    patients: patients.map((p) => ({
      id: p.id, seq: p.seq, eidLast3: p.eid_last3, ageBand: p.age_band, sex: p.sex,
      chiefComplaint: p.chief_complaint, triageTag: p.triage_tag, gcs: p.gcs,
      interventions: p.interventions, outcome: p.outcome,
    })),
    acknowledgeTimeoutSec: jurisdiction.dispatch.acknowledgeTimeoutSec,
    serverTime: nowIso(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Create
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an incident and return it with its dispatch recommendation already attached.
 *
 * The console's create form IS the call-taker's triage, so the incident is created
 * triaged: call handling measures ≈ 0 s for a console-created call, which is the truth
 * about how it was created. A priority left blank is auto-triaged by rules and said so.
 */
export async function create(input, actor) {
  const { lng, lat, entrance, zone } = await resolveLocation(input);

  if (input.floor != null && entrance?.floors != null && input.floor > entrance.floors) {
    throw validation({ floor: [`${entrance.building_name ?? 'That building'} has ${entrance.floors} floors`] });
  }

  const cal = await calibration();
  const triage = input.priority ? null : autoTriage({ kind: input.kind, chiefComplaint: input.chiefComplaint }, CASE_MIX, cal.window);
  const priority = input.priority ?? triage.value.priority;
  const at = nowIso();

  const { ref, id, rows } = await transaction(async (c) => {
    const newRef = await incidents.nextIncidentRef(c, nowMs());
    const newId = await incidents.insertIncident(c, {
      ref: newRef,
      kind: input.kind,
      priority,
      state: 'triaged',
      lng, lat,
      makani: entrance?.makani ?? null,
      zoneId: zone?.id ?? null,
      floor: input.floor ?? null,
      unitNo: input.unitNo ?? null,
      accessNote: input.accessNote ?? null,
      source: input.source,
      callerName: input.callerName ?? null,
      callerPhone: input.callerPhone ?? null,
      callerRole: input.callerRole ?? null,
      reportedBy: actor.kind === 'citizen' ? actor.id : null,
      chiefComplaint: input.chiefComplaint ?? null,
      triageCode: input.triageCode ?? triage?.value.code ?? null,
      acuity: input.acuity ?? null,
      patientsCount: input.patientsCount ?? 1,
      reportedAt: at,
      triagedAt: at,
    });
    const place = entrance?.building_name
      ? `${entrance.building_name}, entrance ${entrance.entrance_no}`
      : zone?.name ?? 'location on the map';
    const timelineRows = [
      await incidents.insertTimeline(c, newId, {
        ts: at, stage: 'reported',
        // A sensor did not "receive a call". Saying so would bury the one fact that
        // matters about a camera-raised incident: nobody reported it.
        label: input.source === 'sensor'
          ? `Detected by ${input.detectedBy ?? 'camera analytics'} — ${place} · no call received`
          : `Call received via ${SOURCE_LABEL[input.source] ?? input.source} — ${place}`,
        actorKind: actor.kind, actorId: actor.ref, agencyCode: actor.agencyCode,
        detail: { source: input.source, detectedBy: input.detectedBy ?? null, makani: entrance?.makani ?? null, zoneRef: zone?.ref ?? null },
      }),
      await incidents.insertTimeline(c, newId, {
        ts: at, stage: 'triaged',
        label: triage
          ? `Auto-triaged ${priority} from ${triage.factors.map((f) => f.detail).join('; ')} — confirm`
          : `Triaged ${priority} · ${actor.ref}`,
        actorKind: triage ? 'system' : actor.kind, actorId: triage ? 'SYSTEM' : actor.ref,
        detail: triage ? { method: triage.method, confidence: triage.confidence } : { priority },
      }),
    ];
    return { ref: newRef, id: newId, rows: timelineRows };
  });

  await audit({
    action: 'incident.create', entity: 'incident', entityId: ref, actor: auditActor(actor),
    payload: { kind: input.kind, priority, autoTriaged: Boolean(triage), source: input.source, makani: entrance?.makani ?? null },
  });

  const summary = await incidents.incidentSummary(pool, ref);
  fanout.incidentNew(summary);
  fanout.incidentTimeline(ref, rows);
  scheduleKpiTick();

  // The recommendation is attached, not required: an incident that exists without one
  // is better than a call that failed to record because OSRM was slow.
  let recommendation = null;
  let recommendationError = null;
  try {
    recommendation = await dispatch.recommendFor(await incidents.incidentRow(pool, ref));
  } catch (err) {
    logger.error({ err, ref }, '[incidents] recommendation on create failed');
    recommendationError = err.message;
  }

  return { incident: summary, recommendation, recommendationError, triage, incidentId: id };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Correct, triage
// ═══════════════════════════════════════════════════════════════════════════════

const FIELD_LABEL = {
  priority: 'priority', kind: 'kind', floor: 'floor', unit_no: 'unit', access_note: 'access note',
  patients_count: 'patients', chief_complaint: 'complaint', location: 'location',
};

export async function update(ref, input, actor) {
  const inc0 = await dispatch.loadIncident(ref, actor);
  if (inc0.state === 'closed') throw conflict(`${ref} is closed`);

  let location = null;
  if (input.makani || input.lng != null) location = await resolveLocation(input);

  const at = nowIso();
  const out = await transaction(async (c) => {
    const inc = await incidents.incidentRow(c, ref, { forUpdate: true });
    const patch = {};
    const changes = [];
    const set = (col, value) => {
      if (value === undefined || value === inc[col]) return;
      patch[col] = value;
      changes.push({ field: col, from: inc[col], to: value });
    };
    set('priority', input.priority);
    set('kind', input.kind);
    set('floor', input.floor);
    set('unit_no', input.unitNo);
    set('access_note', input.accessNote);
    set('patients_count', input.patientsCount);
    set('chief_complaint', input.chiefComplaint);
    if (location) {
      patch.geom = { lng: location.lng, lat: location.lat };
      patch.makani = location.entrance?.makani ?? null;
      patch.zone_id = location.zone?.id ?? null;
      changes.push({ field: 'location', from: inc.makani?.trim() ?? `${inc.lng.toFixed(5)},${inc.lat.toFixed(5)}`, to: patch.makani ?? `${location.lng.toFixed(5)},${location.lat.toFixed(5)}` });
    }
    if (!changes.length) return null;

    await incidents.updateIncident(c, inc.id, patch);
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: 'updated',
      label: `${changes.map((ch) => `${FIELD_LABEL[ch.field] ?? ch.field} ${ch.from ?? '—'} → ${ch.to ?? '—'}`).join('; ')} · ${actor.ref}`,
      actorKind: actor.kind, actorId: actor.ref, detail: { changes },
    });
    return { changes, row };
  });
  if (!out) return incidents.incidentSummary(pool, ref);

  await audit({ action: 'incident.update', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { changes: out.changes } });
  const summary = await incidents.incidentSummary(pool, ref);
  fanout.incidentUpdate(summary);
  fanout.incidentTimeline(ref, out.row);
  return summary;
}

export async function triage(ref, input, actor) {
  const inc0 = await dispatch.loadIncident(ref, actor);
  if (inc0.state === 'closed') throw conflict(`${ref} is closed`);
  const at = nowIso();
  const out = await transaction(async (c) => {
    const inc = await incidents.incidentRow(c, ref, { forUpdate: true });
    const patch = {
      priority: input.priority ?? inc.priority,
      triage_code: input.triageCode ?? inc.triage_code,
      acuity: input.acuity ?? inc.acuity,
      triaged_at: inc.triaged_at ?? at,
    };
    if (inc.state === 'reported') patch.state = 'triaged';
    await incidents.updateIncident(c, inc.id, patch);
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: 'triaged',
      label: `Triage confirmed ${patch.priority}${patch.triage_code ? ` (${patch.triage_code})` : ''}${inc.priority !== patch.priority ? ` — was ${inc.priority}` : ''} · ${actor.ref}`,
      actorKind: actor.kind, actorId: actor.ref, detail: { from: inc.priority, ...patch },
    });
    return { row, from: inc.priority, to: patch.priority };
  });
  await audit({ action: 'incident.triage', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { from: out.from, to: out.to, triageCode: input.triageCode ?? null } });
  const summary = await incidents.incidentSummary(pool, ref);
  fanout.incidentUpdate(summary);
  fanout.incidentTimeline(ref, out.row);
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Close
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Close with an outcome. Units not yet on scene are stood down by the close; a crew
 * with the patient is not — closing over their heads would lose the clinical record of
 * the transport. Clear the unit first.
 */
export async function close(ref, { outcome }, actor) {
  if (!INCIDENT_OUTCOMES.includes(outcome)) throw validation({ outcome: [`One of: ${INCIDENT_OUTCOMES.join(', ')}`] });
  await dispatch.loadIncident(ref, actor);
  const at = nowIso();

  const out = await transaction(async (c) => {
    const inc = await incidents.incidentRow(c, ref, { forUpdate: true });
    if (inc.state === 'closed') throw conflict(`${ref} is already closed`);
    const assignmentRows = await fleet.assignmentsForIncident(c, inc.id);
    const blocked = closeBlocker(assignmentRows);
    if (blocked) throw conflict(blocked);

    const stoodDown = await dispatch.standDownPreArrival(c, inc, `incident closed (${outcome.replace(/_/g, ' ')})`, actor, at);
    await incidents.updateIncident(c, inc.id, { state: 'closed', outcome, closed_at: at });
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: 'closed', label: `Closed — ${outcome.replace(/_/g, ' ')} · ${actor.ref}`,
      actorKind: actor.kind, actorId: actor.ref, detail: { outcome, stoodDown: stoodDown.map((s) => s.a.unit_ref) },
    });
    return { stoodDown, row };
  });

  await audit({ action: 'incident.close', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { outcome, stoodDown: out.stoodDown.map((s) => s.a.ref) } });

  const summary = await incidents.incidentSummary(pool, ref);
  for (const s of out.stoodDown) {
    fanout.assignmentUpdate({ incidentRef: ref, unitRef: s.a.unit_ref, ref: s.a.ref, state: 'cancelled', at });
    fanout.incidentTimeline(ref, s.row);
    fanout.unitStatus(s.unitRow);
  }
  fanout.incidentTimeline(ref, out.row);
  fanout.incidentUpdate(summary);
  fanout.incidentClosed(summary);
  scheduleKpiTick();
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Notes and agency notification
// ═══════════════════════════════════════════════════════════════════════════════

export async function addNote(ref, { body }, actor) {
  const inc = await dispatch.loadIncident(ref, actor);
  const at = nowIso();
  const { noteId, row } = await transaction(async (c) => {
    const noteId = await incidents.insertNote(c, inc.id, { authorId: actor.id, agencyId: actor.agencyId, body: body.trim(), at });
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: 'note', label: `Note from ${actor.name} (${actor.agencyCode ?? actor.role})`,
      actorKind: actor.kind, actorId: actor.ref, agencyCode: actor.agencyCode, detail: { noteId },
    });
    return { noteId, row };
  });
  await audit({ action: 'incident.note', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { noteId } });
  fanout.incidentTimeline(ref, row);
  return { id: noteId, createdAt: at };
}

/** Notify further agencies by hand — correlation already notified its set on dispatch. */
export async function notifyAgencies(ref, { agencies }, actor) {
  const inc = await dispatch.loadIncident(ref, actor);
  if (inc.state === 'closed') throw conflict(`${ref} is closed`);
  const at = nowIso();
  const out = await transaction(async (c) => {
    const notified = await incidents.insertNotifications(c, inc.id, agencies, at);
    if (notified.length) await incidents.updateIncident(c, inc.id, { addAgencies: notified.map((n) => n.code) });
    const rows = [];
    for (const n of notified) {
      rows.push(await incidents.insertTimeline(c, inc.id, {
        ts: at, stage: 'agency_notified', label: `${n.code.replace('_', ' ')} notified — acknowledge within ${n.slaSec} s · ${actor.ref}`,
        actorKind: actor.kind, actorId: actor.ref, agencyCode: n.code, detail: { slaSec: n.slaSec, manual: true },
      }));
    }
    return { notified, rows };
  });
  await audit({ action: 'incident.notify', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { agencies: out.notified.map((n) => n.code) } });
  fanout.incidentTimeline(ref, out.rows);
  for (const n of out.notified) fanout.agencyNotified(n.code, { incidentRef: ref, agency: n.code, at, slaSec: n.slaSec });
  if (out.notified.length) fanout.incidentUpdate(await incidents.incidentSummary(pool, ref));
  return incidents.notifications(pool, inc.id, nowIso());
}

/**
 * An agency acknowledges its notification — stops its SLA clock. A user may acknowledge
 * for their own agency; a duty officer or admin may record it for any, e.g. on a phone
 * call from an agency with no console.
 */
export async function acknowledgeNotification(ref, agencyCode, actor) {
  const onBehalf = actor.agencyCode !== agencyCode;
  if (onBehalf && !can(actor.role, 'operations.dispatch')) throw forbidden(`Only ${agencyCode} or a dispatcher can acknowledge this`);
  const inc = await dispatch.loadIncident(ref, actor);
  const at = nowIso();
  const out = await transaction(async (c) => {
    const n = await incidents.acknowledgeNotification(c, inc.id, agencyCode, actor.id, at);
    if (!n) throw conflict(`${agencyCode} has no open notification on ${ref}`);
    const elapsed = Math.round((Date.parse(at) - new Date(n.notified_at).getTime()) / 1000);
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: 'agency_acknowledged',
      label: `${agencyCode.replace('_', ' ')} acknowledged in ${elapsed} s — SLA ${elapsed <= n.sla_sec ? 'met' : 'breached'}${onBehalf ? ` · logged by ${actor.ref}` : ''}`,
      actorKind: onBehalf ? actor.kind : 'agency', actorId: actor.ref, agencyCode, detail: { elapsedSec: elapsed, slaSec: n.sla_sec },
    });
    return { row, elapsed, met: elapsed <= n.sla_sec };
  });
  await audit({ action: 'incident.agency_ack', entity: 'incident', entityId: ref, actor: auditActor(actor), payload: { agency: agencyCode, elapsedSec: out.elapsed, met: out.met } });
  fanout.incidentTimeline(ref, out.row);
  return incidents.notifications(pool, inc.id, nowIso());
}
