/**
 * /api/incidents/:ref/patients, /api/patients/:id/* — the clinical record.
 * docs/07 §3.4.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAnyCap } from '../lib/auth.js';
import { actorFrom } from '../services/actor.js';
import * as svc from '../services/patients.js';

const router = Router();
const CLINICAL = requireAnyCap('clinical.view');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

router.post('/incidents/:ref/patients', CLINICAL, wrap(async (req, res) => {
  const body = parse(z.object({
    seq: z.number().int().min(1).max(500).optional(),
    chiefComplaint: z.string().trim().max(200).optional(),
    ageBand: z.string().max(20).optional(),
    sex: z.string().max(10).optional(),
  }), req.body ?? {});
  res.status(201).json(await svc.create(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/patients/:id/identify', CLINICAL, wrap(async (req, res) => {
  const body = parse(z.object({ emiratesId: z.string() }), req.body);
  res.json(await svc.identify(req.params.id, body.emiratesId, actorFrom(req.user)));
}));

router.post('/patients/:id/vitals', CLINICAL, wrap(async (req, res) => {
  const body = parse(z.object({
    hr: z.number().min(0).max(300).nullable().optional(),
    spo2: z.number().min(0).max(100).nullable().optional(),
    bpSys: z.number().min(0).max(300).nullable().optional(),
    bpDia: z.number().min(0).max(200).nullable().optional(),
    respRate: z.number().min(0).max(100).nullable().optional(),
    tempC: z.number().min(20).max(45).nullable().optional(),
    etco2: z.number().min(0).max(150).nullable().optional(),
    rhythm: z.string().max(40).nullable().optional(),
  }), req.body ?? {});
  res.json(await svc.vitals(req.params.id, body, actorFrom(req.user)));
}));

router.post('/patients/:id/triage-tag', CLINICAL, wrap(async (req, res) => {
  const body = parse(z.object({ tag: z.string() }), req.body);
  res.json(await svc.triageTag(req.params.id, body.tag, actorFrom(req.user)));
}));

router.post('/patients/:id/prealert', CLINICAL, wrap(async (req, res) => {
  const body = parse(z.object({ hospitalRef: z.string().max(20) }), req.body);
  res.json(await svc.prealert(req.params.id, body.hospitalRef, actorFrom(req.user)));
}));

export default router;
