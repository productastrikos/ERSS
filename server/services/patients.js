/**
 * Clinical record — patient creation, identification, vitals, triage tag, pre-alert.
 * docs/07 §3.4, docs/03 §7.
 *
 * The raw Emirates ID is never stored (PDPL). This is a salted HMAC keyed on the
 * session secret, not a lookup index — its only purpose is "this is the same person
 * across two touches of this incident" without persisting the number itself.
 */

import { createHmac } from 'node:crypto';
import { pool } from '../lib/db.js';
import { env } from '../config/env.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound, validation } from '../lib/errors.js';
import { auditActor } from './actor.js';
import * as repo from '../repos/patients.js';
import { loadIncident } from './dispatch.js';

const TRIAGE_TAGS = ['red', 'yellow', 'green', 'black'];

async function assertClinicalAccess(incidentRow, actor) {
  if (actor.kind === 'unit') {
    const { rows } = await pool.query(
      `SELECT 1 FROM assignments WHERE incident_id = $1 AND unit_id = $2 LIMIT 1`,
      [incidentRow.id, actor.unitId],
    );
    if (!rows.length) throw forbidden('This unit is not assigned to that incident');
  }
  // Console clinical roles are scoped by loadIncident's zone check, already applied by the caller.
}

export async function create(incidentRef, input, actor) {
  const inc = await loadIncident(incidentRef, actor);
  await assertClinicalAccess(inc, actor);
  const id = await repo.createPatient(pool, {
    incidentId: inc.id, seq: input.seq ?? 1, chiefComplaint: input.chiefComplaint, ageBand: input.ageBand, sex: input.sex,
  });
  await audit({ action: 'patient.create', entity: 'patient', entityId: id, actor: auditActor(actor), payload: { incidentRef } });
  return repo.patientRow(pool, id);
}

async function loadForWrite(patientId, actor) {
  const p = await repo.patientRow(pool, patientId);
  if (!p) throw notFound('Patient');
  const inc = await loadIncident(p.incident_ref, actor);
  await assertClinicalAccess(inc, actor);
  return p;
}

/** The Emirates ID is hashed here and NEVER reaches the repository or the log. */
export async function identify(patientId, emiratesId, actor) {
  await loadForWrite(patientId, actor);
  if (!/^\d{15}$/.test(emiratesId)) throw validation({ emiratesId: ['15 digits'] });
  const hash = createHmac('sha256', env.auth.sessionSecret).update(emiratesId).digest('hex');
  await repo.identifyPatient(pool, patientId, { hash, last3: emiratesId.slice(-3) });
  await audit({ action: 'patient.identify', entity: 'patient', entityId: patientId, actor: auditActor(actor) });
  return repo.patientRow(pool, patientId);
}

export async function vitals(patientId, sample, actor) {
  await loadForWrite(patientId, actor);
  await repo.insertVitals(pool, patientId, sample);
  return { ok: true };
}

export async function triageTag(patientId, tag, actor) {
  if (!TRIAGE_TAGS.includes(tag)) throw validation({ tag: [`One of: ${TRIAGE_TAGS.join(', ')}`] });
  await loadForWrite(patientId, actor);
  await repo.setTriageTag(pool, patientId, tag);
  await audit({ action: 'patient.triage_tag', entity: 'patient', entityId: patientId, actor: auditActor(actor), payload: { tag } });
  return repo.patientRow(pool, patientId);
}

export async function prealert(patientId, hospitalRef, actor) {
  await loadForWrite(patientId, actor);
  const { rows } = await pool.query('SELECT id FROM hospitals WHERE ref = $1', [hospitalRef]);
  if (!rows[0]) throw notFound('Hospital');
  await repo.setPrealert(pool, patientId, rows[0].id);
  await audit({ action: 'patient.prealert', entity: 'patient', entityId: patientId, actor: auditActor(actor), payload: { hospitalRef } });
  return repo.patientRow(pool, patientId);
}
