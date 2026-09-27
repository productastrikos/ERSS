/**
 * /api/me — the citizen's own record. docs/07 §4.7.
 *
 * PDPL-sensitive: `users.medical_profile` is readable and writable only by its owner,
 * and every read is audited — a medical profile sent with an SOS is exactly the kind of
 * access a health authority asks to see logged.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation, forbidden } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { auditActor } from '../services/actor.js';
import * as fleet from '../repos/fleet.js';
import * as incidents from '../repos/incidents.js';
import { shapeAssignmentWithActions } from '../services/dispatch.js';
import * as unitsSvc from '../services/units.js';
import { actorFrom } from '../services/actor.js';

const router = Router();

/**
 * The responder app's own unit, with the current assignment and incident if any — no ref
 * needed. Reopening the app mid-job needs this: the incident context otherwise arrives
 * only on the `assignment:offer` socket push, which a reload has already missed.
 */
router.get('/me/unit', requireRole('responder'), wrap(async (req, res) => {
  if (!req.user.unit_id) throw forbidden('This account is not bound to a unit');
  const unit = await fleet.unitById(pool, req.user.unit_id);
  if (!unit) throw forbidden('Unit not found or archived');
  const asgRow = unit.currentAssignmentRef ? await fleet.assignmentByRef(pool, unit.currentAssignmentRef) : null;
  const incident = asgRow ? await incidents.incidentSummary(pool, asgRow.incident_ref ?? unit.currentIncidentRef) : null;
  res.json({ unit, assignment: asgRow ? shapeAssignmentWithActions(asgRow) : null, incident });
}));

/**
 * Shift start/end from the phone. Deliberately narrower than the console's
 * `/units/:ref/status` (operations.dispatch): a responder may only go available or off
 * duty — everything else (standby, out of service) is a console/dispatcher decision, and
 * assignment-driven statuses are never settable at all (services/units.js enforces this
 * regardless of who calls it).
 */
router.patch('/me/unit/status', requireRole('responder'), wrap(async (req, res) => {
  if (!req.user.unit_id) throw forbidden('This account is not bound to a unit');
  const r = z.object({ status: z.enum(['available', 'off_duty']) }).safeParse(req.body);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  const unit = await fleet.unitById(pool, req.user.unit_id);
  if (!unit) throw forbidden('Unit not found or archived');
  res.json(await unitsSvc.setStatus(unit.ref, { status: r.data.status }, actorFrom(req.user)));
}));

const PROFILE_SHAPE = z.object({
  bloodGroup: z.string().max(5).nullable().optional(),
  allergies: z.array(z.string().max(80)).max(20).optional(),
  conditions: z.array(z.string().max(80)).max(20).optional(),
  medications: z.array(z.string().max(80)).max(20).optional(),
  emergencyContact: z.object({ name: z.string().max(80), phone: z.string().max(30) }).nullable().optional(),
});

router.get('/me/medical-profile', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT medical_profile FROM users WHERE id = $1', [req.user.id]);
  await audit({ action: 'user.medical_profile.read', entity: 'user', entityId: req.user.ref, actor: auditActor({ id: req.user.id, ref: req.user.ref }) });
  res.json(rows[0]?.medical_profile ?? {});
}));

router.put('/me/medical-profile', requireAuth, wrap(async (req, res) => {
  const r = PROFILE_SHAPE.safeParse(req.body ?? {});
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  await pool.query('UPDATE users SET medical_profile = $2 WHERE id = $1', [req.user.id, JSON.stringify(r.data)]);
  await audit({ action: 'user.medical_profile.write', entity: 'user', entityId: req.user.ref, actor: auditActor({ id: req.user.id, ref: req.user.ref }) });
  res.json(r.data);
}));

export default router;
