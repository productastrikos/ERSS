/**
 * /api/sos — the citizen app's front door. docs/04, docs/07 §4.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { idempotent } from '../lib/idempotency.js';
import { actorFrom } from '../services/actor.js';
import * as svc from '../services/sos.js';
import { CAPABILITY_REQUIREMENTS } from '../data/reference/fleet.js';

const router = Router();
const KINDS = Object.keys(CAPABILITY_REQUIREMENTS);

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

const CREATE = requireCap('sos.create');

router.post('/sos', CREATE, idempotent, wrap(async (req, res) => {
  const body = parse(z.object({
    kind: z.enum(KINDS).optional(),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().positive().optional(),
    silent: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  }), req.body);
  res.status(201).json(await svc.create(body, actorFrom(req.user)));
}));

router.post('/sos/:ref/cancel', CREATE, wrap(async (req, res) => {
  res.json(await svc.cancel(req.params.ref, actorFrom(req.user)));
}));

router.get('/sos/:ref/status', CREATE, wrap(async (req, res) => {
  res.json(await svc.status(req.params.ref, actorFrom(req.user)));
}));

export default router;
