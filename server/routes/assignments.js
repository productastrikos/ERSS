/**
 * /api/assignments — the assignment lifecycle. docs/04 §4.
 *
 * A crew moves its own assignment from the phone; a dispatcher can log the same step
 * from a radio call, and the timeline says which it was. Who may do what is decided in
 * services/dispatch.js against domain/lifecycle.js — the route only maps the URL.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation, notFound, forbidden } from '../lib/errors.js';
import { requireAuth, can } from '../lib/auth.js';
import { idempotent } from '../lib/idempotency.js';
import { pool } from '../lib/db.js';
import { actorFrom } from '../services/actor.js';
import * as dispatch from '../services/dispatch.js';
import * as fleet from '../repos/fleet.js';

const router = Router();

/** URL segment → lifecycle action. */
const ACTIONS = {
  acknowledge: 'acknowledge', decline: 'decline', enroute: 'enroute', onscene: 'onscene',
  'at-patient': 'at_patient', transporting: 'transporting', resolve: 'resolve',
  'at-hospital': 'at_hospital', clear: 'clear', cancel: 'cancel',
};

const bodySchema = z.object({
  reason: z.string().trim().max(300).optional(),
  hospitalRef: z.string().max(20).optional(),
  floor: z.number().int().min(-6).max(200).optional(),
  liftUsed: z.boolean().optional(),
});

async function readable(req, ref) {
  const row = await fleet.assignmentByRef(pool, ref);
  if (!row) throw notFound('Assignment');
  const actor = actorFrom(req.user);
  if (actor.kind === 'unit') {
    if (row.unit_id !== actor.unitId) throw forbidden('This assignment belongs to another unit');
  } else if (can(req.user.role, 'operations.view') || can(req.user.role, 'collaborate.view')) {
    await dispatch.loadIncident(row.incident_ref, actor);   // zone scope
  } else {
    throw forbidden();
  }
  return row;
}

router.get('/:ref', requireAuth, wrap(async (req, res) => {
  res.json(dispatch.shapeAssignmentWithActions(await readable(req, req.params.ref)));
}));

/** Proposed vs taken, with the difference in metres and seconds. */
router.get('/:ref/route', requireAuth, wrap(async (req, res) => {
  const a = fleet.shapeAssignment(await readable(req, req.params.ref));
  res.json({
    assignmentRef: a.ref,
    proposed: a.routeProposed,
    taken: a.routeTaken,
    proposedSec: a.routeProposedSec,
    takenSec: a.routeTakenSec,
    deltaSec: a.routeTakenSec != null && a.routeProposedSec != null ? a.routeTakenSec - a.routeProposedSec : null,
    proposedM: a.routeProposedM,
    takenM: a.routeTakenM,
    deltaM: a.routeTakenM != null && a.routeProposedM != null ? a.routeTakenM - a.routeProposedM : null,
  });
}));

router.post('/:ref/:action', requireAuth, idempotent, wrap(async (req, res) => {
  const action = ACTIONS[req.params.action];
  if (!action) throw notFound('Assignment action');
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
  res.json(await dispatch.transition(req.params.ref, action, parsed.data, actorFrom(req.user)));
}));

export default router;
