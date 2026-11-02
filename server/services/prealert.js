/**
 * The hospital pre-alert — the receiving emergency department told what is coming, the moment
 * the crew leaves for it.
 *
 * Until this build nothing told the hospital: the "transporting" step recorded which hospital
 * and the ambulance simply arrived. A pre-alert is one of the few EMS interventions with a
 * published effect (door-to-needle cut by about nine minutes with EMS pre-notification —
 * config/jurisdiction.js), so it is sent automatically, every time, by the platform rather
 * than left to a crew with a patient to look after:
 *
 *   SENT          on `transporting` — who is coming (priority, complaint, patients), when
 *                 (an ETA from the unit's position by road), with what (the crew's
 *                 capability), the patient's own record where the platform has one (the
 *                 citizen's medical profile, the wearable trend that led up to the SOS) and
 *                 what to have ready (resus bay, cath lab, stroke team, trauma team…).
 *   ACKNOWLEDGED  the department confirms and names the bay. There is no live hospital
 *                 integration in the trial, so the acknowledgement is SIMULATED and every
 *                 record of it says so.
 *
 * Written where every screen already reads: the incident timeline (the live feed, the
 * console's AI log, the crew's job, the report), the patient record (`prealert_sent_at`,
 * `prealert_ack_at`), the kept AI log for replay, and pushed to `hospital:<ref>` for the
 * hospital screen the trial does not have yet.
 */

import { pool, one } from '../lib/db.js';
import { bus } from '../lib/bus.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/clock.js';
import * as incidents from '../repos/incidents.js';
import * as fanout from '../realtime/fanout.js';
import { emitTo, room } from '../realtime/index.js';
import { TRIAL_CREWS } from '../data/reference/crews.js';
import { kindLabel } from './alerts.js';
import * as eta from './eta.js';
import * as vitals from './vitals.js';

/** What the department should have ready, by what the crew is bringing in. */
const READY = {
  cardiac_arrest: ['Resuscitation bay', 'Post-arrest (ROSC) team', 'Airway and ventilator'],
  cardiac: ['12-lead ECG on arrival', 'Cath-lab alert if STEMI is confirmed', 'Cardiology on call'],
  stroke: ['Stroke team', 'CT scanner on arrival', 'Thrombolysis pathway'],
  respiratory: ['Resuscitation bay', 'Oxygen and airway support', 'Nebuliser / NIV'],
  rta: ['Trauma team', 'Resuscitation bay', 'CT / FAST scan'],
  trauma_fall: ['Trauma team', 'Spinal precautions', 'X-ray / CT'],
  workplace_injury: ['Trauma assessment', 'X-ray'],
  heat_illness: ['Active cooling', 'Electrolytes and IV fluids'],
  obstetric: ['Obstetric team', 'Labour ward notified', 'Neonatal team on standby'],
  paediatric: ['Paediatric emergency team', 'Paediatric resus trolley'],
  drowning: ['Resuscitation bay', 'Airway and ventilator'],
  burns: ['Burns dressing and fluids', 'Plastic surgery on call'],
  fire_related: ['Smoke-inhalation airway assessment', 'Burns dressing and fluids'],
  mass_casualty: ['Major incident plan', 'Trauma teams', 'Surge capacity'],
};
const BY_PRIORITY = { P1: ['Resuscitation bay'], P2: ['Majors cubicle'], P3: ['ED triage'], P4: ['ED triage'] };

const PREALERT = Object.freeze({ kind: 'system', ref: 'AI-PREALERT' });

/** Assignments already pre-alerted — one pre-alert per transport. */
const sent = new Set();
const ackTimers = new Set();

const mins = (sec) => Math.max(1, Math.round((sec ?? 0) / 60));
const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
const rand = (a, b) => a + Math.random() * (b - a);

export function wirePrealerts() {
  bus.on('assignment:update', (p) => {
    if (p.state === 'transporting') void send(p.ref).catch((err) => logger.warn({ err: err.message, asg: p.ref }, '[prealert] failed'));
  });
  bus.on('sim:reset', () => {
    for (const t of ackTimers) clearTimeout(t);
    ackTimers.clear();
    sent.clear();
  });
}

async function send(asgRef) {
  if (sent.has(asgRef)) return;
  sent.add(asgRef);
  const r = await one(
    `SELECT a.ref AS asg_ref, a.unit_id, u.ref AS unit_ref, u.callsign, u.kind AS unit_kind,
            ST_X(u.current_geom) AS ulng, ST_Y(u.current_geom) AS ulat,
            i.id AS inc_id, i.ref AS inc_ref, i.kind, i.priority, i.chief_complaint, i.patients_count, i.source,
            i.reported_by, i.run_id,
            h.id AS h_id, h.ref AS h_ref, h.name AS h_name, ST_X(h.geom) AS hlng, ST_Y(h.geom) AS hlat,
            h.ed_beds, h.ed_occupied
       FROM assignments a
       JOIN units u ON u.id = a.unit_id
       JOIN incidents i ON i.id = a.incident_id
       JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.ref = $1`, [asgRef]);
  if (!r) return;
  // Already pre-alerted (a server restart forgot the in-memory guard).
  const dup = await one(`SELECT 1 FROM incident_timeline WHERE incident_id = $1 AND stage = 'prealert' AND detail->>'assignmentRef' = $2 LIMIT 1`, [r.inc_id, asgRef]);
  if (dup) return;

  // When: by road from where the ambulance is now.
  let etaSec = null;
  if (r.ulng != null) {
    const t = await eta.travelMany([[r.ulng, r.ulat]], [r.hlng, r.hlat], { zoneClass: 'urban' }).catch(() => null);
    etaSec = t?.[0]?.value?.seconds ?? null;
  }
  const etaAt = Date.now() + (etaSec ?? 600) * 1000;

  // Who: the patient record, the citizen's own profile, the wearable trend.
  const patientId = await vitals.ensurePatient(r.inc_id, { chiefComplaint: r.chief_complaint, runId: r.run_id });
  await pool.query('UPDATE patients SET destination_id = $2, prealert_sent_at = now() WHERE id = $1', [patientId, r.h_id]);
  const profile = r.source === 'app_sos' && r.reported_by
    ? (await one('SELECT medical_profile FROM users WHERE id = $1', [r.reported_by]))?.medical_profile ?? null
    : null;
  const v = await vitals.vitalsFor(r.inc_ref).catch(() => null);
  const trend = v?.analysis?.value ?? null;

  const ready = [...new Set([
    ...(READY[r.kind] ?? BY_PRIORITY[r.priority] ?? ['ED triage']),
    ...(trend?.prepare ?? []),
  ])].slice(0, 5);
  const lead = TRIAL_CREWS[r.unit_ref]?.crew?.find((c) => c.role === 'lead') ?? null;
  const occ = r.ed_beds ? Math.round((r.ed_occupied / r.ed_beds) * 100) : null;

  const patientLine = [
    r.patients_count > 1 ? `${r.patients_count} patients` : '1 patient',
    r.chief_complaint,
    profile?.bloodGroup ? `blood group ${profile.bloodGroup}` : null,
    profile?.allergies?.length ? `allergies: ${profile.allergies.join(', ')}` : null,
    profile?.conditions?.length ? `conditions: ${profile.conditions.join(', ')}` : null,
    profile?.medications?.length ? `medications: ${profile.medications.join(', ')}` : null,
  ].filter(Boolean).join(' · ');

  const message = {
    from: 'DCAS ERSS — automatic pre-alert',
    to: `${r.h_name} Emergency Department`,
    hospitalRef: r.h_ref,
    incidentRef: r.inc_ref,
    assignmentRef: asgRef,
    priority: r.priority,
    kind: kindLabel(r.kind),
    unit: `${r.callsign} (${r.unit_kind})`,
    etaSec,
    etaAt: new Date(etaAt).toISOString(),
    patient: patientLine,
    vitals: trend?.headline ?? null,
    vitalsFindings: (trend?.findings ?? []).filter((f) => f.tone !== 'good').map((f) => f.text),
    ready,
    crewLead: lead ? `${lead.name}, ${lead.title}` : null,
    edLoadPct: occ,
    channel: 'Simulated hospital link — no live ED integration in the trial',
  };

  const label = `Pre-alert sent to ${r.h_name} ED — ${r.priority} ${kindLabel(r.kind).toLowerCase()}, ETA ${mins(etaSec)} min (${clock(etaAt)}) · ${ready[0]}`;
  const row = await incidents.insertTimeline(pool, r.inc_id, {
    ts: nowIso(), stage: 'prealert', label, actorKind: 'system', actorId: PREALERT.ref, agencyCode: 'DCAS',
    detail: { ...message, summary: [patientLine, message.vitals ? `Wearable: ${message.vitals}` : null].filter(Boolean).join(' · ') },
  });
  fanout.incidentTimeline(r.inc_ref, row);
  await keep(r.inc_id, `prealert:${asgRef}`, {
    title: `Hospital pre-alert sent · ${r.h_name}`,
    detail: `${message.to} told what is coming, ${mins(etaSec)} min before the ambulance arrives.`,
    tone: 'ai',
    items: [
      { label: 'ETA', value: `${mins(etaSec)} min · ${clock(etaAt)} GST` },
      { label: 'Patient', value: patientLine || '—' },
      ...(message.vitals ? [{ label: 'Wearable trend', value: message.vitals }] : []),
      { label: 'Have ready', value: ready.join(' · ') },
      ...(message.crewLead ? [{ label: 'Crew lead', value: message.crewLead }] : []),
      { label: 'Channel', value: message.channel },
    ],
    meta: message,
  });

  emitTo(room.hospital(r.h_ref), 'hospital:prealert', message);
  fanout.notify([room.consoleFleet, room.unit(r.unit_ref)], {
    level: 'info',
    title: `Pre-alert sent · ${r.h_name} ED`,
    body: `${r.priority} ${kindLabel(r.kind).toLowerCase()} · ETA ${mins(etaSec)} min · ${ready[0]}`,
  });
  logger.info({ incident: r.inc_ref, hospital: r.h_ref, etaSec }, '[prealert] sent');

  // The department's answer — SIMULATED: there is no hospital system on the other end.
  const bay = ready[0].toLowerCase().includes('resus') ? `Resus bay ${Math.ceil(rand(0, 4))}` : `${ready[0]} — cubicle ${Math.ceil(rand(0, 12))}`;
  const timer = setTimeout(() => {
    ackTimers.delete(timer);
    void acknowledge(r, asgRef, patientId, bay).catch((err) => logger.warn({ err: err.message }, '[prealert] ack failed'));
  }, rand(6, 11) * 1000);
  timer.unref?.();
  ackTimers.add(timer);
}

async function acknowledge(r, asgRef, patientId, bay) {
  const still = await one(`SELECT state FROM incidents WHERE id = $1`, [r.inc_id]);
  if (!still) return;
  await pool.query('UPDATE patients SET prealert_ack_at = now() WHERE id = $1', [patientId]);
  const label = `${r.h_name} ED acknowledged the pre-alert — ${bay} ready (simulated hospital response)`;
  const row = await incidents.insertTimeline(pool, r.inc_id, {
    ts: nowIso(), stage: 'prealert_ack', label, actorKind: 'system', actorId: `${r.h_ref}-ED`, agencyCode: 'DCAS',
    detail: { hospitalRef: r.h_ref, assignmentRef: asgRef, bay, simulated: true },
  });
  fanout.incidentTimeline(r.inc_ref, row);
  await keep(r.inc_id, `prealert-ack:${asgRef}`, {
    title: `${r.h_name} ED acknowledged · ${bay}`, detail: 'Simulated hospital response — the trial has no live ED link.', tone: 'good', items: [], meta: { bay, simulated: true },
  });
  fanout.notify([room.consoleFleet, room.unit(r.unit_ref)], { level: 'success', title: `${r.h_name} ED is ready`, body: `${bay} — pre-alert acknowledged (simulated)` });
}

/** Into the kept AI log, beside the dispatch reasoning (services/aiLog.js reads it back). */
async function keep(incidentId, key, { title, detail, tone, items, meta }) {
  await pool.query(
    `INSERT INTO incident_ai_log (incident_id, source, key, ts, title, detail, tone, items, meta)
     VALUES ($1, 'console', $2, now(), $3, $4, $5, $6, $7)
     ON CONFLICT (incident_id, source, key) DO UPDATE SET title = EXCLUDED.title, detail = EXCLUDED.detail,
       tone = EXCLUDED.tone, items = EXCLUDED.items, meta = EXCLUDED.meta, recorded_at = now()`,
    [incidentId, key, title, detail, tone, JSON.stringify(items ?? []), meta ? JSON.stringify(meta) : null],
  ).catch((err) => logger.debug({ err: err.message }, '[prealert] ai log write skipped'));
}
