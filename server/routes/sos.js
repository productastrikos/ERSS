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

/** Wearable readings: epoch ms, heart rate (bpm), SpO₂ (%). Up to fifteen minutes' worth. */
const VITALS = z.array(z.object({
  ts: z.number().int().positive(),
  bpm: z.number().min(0).max(300).nullable().optional(),
  spo2: z.number().min(0).max(100).nullable().optional(),
})).max(900);

router.post('/sos', CREATE, idempotent, wrap(async (req, res) => {
  const body = parse(z.object({
    kind: z.enum(KINDS).optional(),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracy: z.number().positive().optional(),
    silent: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
    vitals: VITALS.optional(),
    vitalsDevice: z.string().trim().max(60).optional(),
  }), req.body);
  res.status(201).json(await svc.create(body, actorFrom(req.user)));
}));

/** `?points=lng,lat|lng,lat` — the nearest free ambulance to each, for a place picker. */
router.get('/sos/nearest', CREATE, wrap(async (req, res) => {
  const points = String(req.query.points ?? '').split('|').slice(0, 10)
    .map((s) => s.split(',').map(Number))
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90);
  if (!points.length) throw validation({ points: ['Give one or more lng,lat pairs separated by |'] });
  res.json(await svc.nearest(points));
}));

/**
 * The demonstration caller's place: a road point a short drive from the paired crew (the
 * crew phone signed in, else the trial's crew-demo ambulance), and who that crew is.
 */
router.get('/sos/demo-place', CREATE, wrap(async (_req, res) => {
  res.json(await svc.demoPlace());
}));

/** More readings while help is on the way — streamed to the crew answering the call. */
router.post('/sos/:ref/vitals', CREATE, wrap(async (req, res) => {
  const body = parse(z.object({ readings: VITALS, device: z.string().trim().max(60).optional() }), req.body);
  res.json(await svc.addVitals(req.params.ref, body.readings, body.device ?? null, actorFrom(req.user)));
}));

router.post('/sos/:ref/cancel', CREATE, wrap(async (req, res) => {
  res.json(await svc.cancel(req.params.ref, actorFrom(req.user)));
}));

router.get('/sos/:ref/status', CREATE, wrap(async (req, res) => {
  res.json(await svc.status(req.params.ref, actorFrom(req.user)));
}));

export default router;
