/**
 * /api/reports — incident reports for every audience (services/reports.js), and the patient's
 * vitals for an incident. Read-only except for the draft edits a person keeps.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { actorFrom } from '../services/actor.js';
import * as svc from '../services/reports.js';

const router = Router();

function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

/** Every incident this person may report on — scoped by role in the service. */
router.get('/reports/incidents', requireAuth, wrap(async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(1).max(400).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
  res.json(await svc.register(req.user, actorFrom(req.user), q));
}));

router.get('/reports/incidents/:ref', requireAuth, wrap(async (req, res) => {
  res.json(await svc.incidentReport(req.params.ref, req.user, actorFrom(req.user)));
}));

const text = (max) => z.string().max(max).optional();
router.put('/reports/incidents/:ref/draft', requireAuth, wrap(async (req, res) => {
  const edits = parse(z.object({
    title: text(160), summary: text(4000), clinicalNotes: text(4000), recommendations: text(4000), notes: text(4000),
    hidden: z.array(z.string().max(40)).max(30).optional(),
  }), req.body);
  res.json(await svc.saveDraft(req.params.ref, edits, req.user, actorFrom(req.user)));
}));

router.get('/incidents-vitals/:ref', requireAuth, wrap(async (req, res) => {
  res.json(await svc.incidentVitals(req.params.ref, req.user, actorFrom(req.user)));
}));

export default router;
