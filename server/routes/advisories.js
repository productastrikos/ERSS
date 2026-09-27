/**
 * /api/advisories — the Pillar 5 action engine hub. docs/04, docs/08 §4.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAnyCap, requireCap } from '../lib/auth.js';
import { actorFrom } from '../services/actor.js';
import * as svc from '../services/advisories.js';

const router = Router();

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

const VIEW = requireAnyCap('advisories.view', 'executive.view');
const ACT = requireCap('advisories.act');

router.get('/advisories', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({
    severity: z.enum(['info', 'warning', 'alert', 'emergency']).optional(),
    state: z.enum(['open', 'acknowledged', 'closed', 'dismissed']).optional(),
    category: z.string().max(40).optional(),
    zone: z.string().max(20).optional(),
  }), req.query);
  res.json(await svc.list({ ...q, zoneRef: q.zone }));
}));

router.get('/advisories/:ref', VIEW, wrap(async (req, res) => {
  res.json(await svc.detail(req.params.ref));
}));

router.post('/advisories/:ref/analyse', VIEW, wrap(async (req, res) => {
  res.json(await svc.analyse(req.params.ref));
}));

router.post('/advisories/:ref/act', ACT, wrap(async (req, res) => {
  const body = parse(z.object({
    agencyCode: z.string().max(20).optional(),
    ownerRef: z.string().max(20).optional(),
    action: z.string().max(40).optional(),
    slaHours: z.number().positive().max(168).optional(),
  }), req.body ?? {});
  res.json(await svc.act(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/advisories/:ref/measure', ACT, wrap(async (req, res) => {
  const body = parse(z.object({ value: z.number() }), req.body);
  res.json(await svc.measure(req.params.ref, body.value, actorFrom(req.user)));
}));

router.post('/advisories/:ref/close', ACT, wrap(async (req, res) => {
  res.json(await svc.close(req.params.ref, actorFrom(req.user)));
}));

router.post('/advisories/:ref/dismiss', ACT, wrap(async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(1).max(300) }), req.body);
  res.json(await svc.dismiss(req.params.ref, body.reason, actorFrom(req.user)));
}));

router.post('/advisories/generate', ACT, wrap(async (req, res) => {
  res.json(await svc.generate());
}));

export default router;
