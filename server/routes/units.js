/**
 * /api/units — docs/04 §4.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation, notFound } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { nowMs } from '../lib/clock.js';
import { actorFrom } from '../services/actor.js';
import * as units from '../services/units.js';
import * as fleet from '../repos/fleet.js';
import { shapeAssignmentWithActions } from '../services/dispatch.js';

const router = Router();

const STATUSES = ['off_duty', 'available', 'standby', 'relocating', 'assigned', 'responding', 'on_scene', 'transporting', 'at_hospital', 'out_of_service'];

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

router.get('/', requireCap('operations.view'), wrap(async (req, res) => {
  const q = parse(z.object({
    status: z.string().optional(),
    agency: z.string().max(20).optional(),
    kind: z.string().max(20).optional(),
    bbox: z.string().optional(),
  }), req.query);
  const status = q.status?.split(',').filter(Boolean);
  if (status?.some((s) => !STATUSES.includes(s))) throw validation({ status: [`One or more of: ${STATUSES.join(', ')}`] });
  const bbox = q.bbox ? q.bbox.split(',').map(Number) : undefined;
  if (bbox && (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v)))) throw validation({ bbox: ['minLng,minLat,maxLng,maxLat'] });
  res.json(await fleet.listUnits(pool, { status, agency: q.agency, kind: q.kind, bbox }));
}));

router.get('/:ref', requireCap('operations.view'), wrap(async (req, res) => {
  const unit = await fleet.unitByRef(pool, req.params.ref);
  if (!unit) throw notFound('Unit');
  const asg = unit.currentAssignmentRef ? await fleet.assignmentByRef(pool, unit.currentAssignmentRef) : null;
  res.json({ ...unit, assignment: asg ? shapeAssignmentWithActions(asg) : null });
}));

router.patch('/:ref/status', requireCap('operations.dispatch'), wrap(async (req, res) => {
  const body = parse(z.object({ status: z.enum(STATUSES), reason: z.string().trim().max(300).optional() }), req.body);
  res.json(await units.setStatus(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/:ref/standby', requireCap('operations.dispatch'), wrap(async (req, res) => {
  const body = parse(z.object({
    lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), reason: z.string().trim().min(1).max(300),
  }), req.body);
  res.json(await units.placeStandby(req.params.ref, body, actorFrom(req.user)));
}));

router.get('/:ref/track', requireCap('operations.view'), wrap(async (req, res) => {
  const q = parse(z.object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  }), req.query);
  const to = q.to ?? new Date(nowMs()).toISOString();
  const from = q.from ?? new Date(Date.parse(to) - 3_600_000).toISOString();
  res.json(await units.track(req.params.ref, { from, to }));
}));

export default router;
