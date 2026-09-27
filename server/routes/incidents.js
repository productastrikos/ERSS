/**
 * /api/incidents — docs/04 §3.
 *
 * Routes validate and authorise; services decide. RBAC is enforced here, zone scope in
 * the services and repositories — never in the client.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireCap, requireAnyCap } from '../lib/auth.js';
import { idempotent } from '../lib/idempotency.js';
import { nowMs } from '../lib/clock.js';
import { CAPABILITY_REQUIREMENTS } from '../data/reference/fleet.js';
import { AGENCY_CODES } from '../config/jurisdiction.js';
import { INCIDENT_SOURCES, INCIDENT_OUTCOMES, CALLER_ROLES } from '../domain/lifecycle.js';
import { actorFrom } from '../services/actor.js';
import * as svc from '../services/incidents.js';
import * as dispatch from '../services/dispatch.js';
import { gstMidnightIso } from '../services/eta.js';

const router = Router();

const KINDS = Object.keys(CAPABILITY_REQUIREMENTS);
const PRIORITY = z.enum(['P1', 'P2', 'P3', 'P4']);
const text = (max) => z.string().trim().max(max);

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

const csv = (inner) => z.string().optional().transform((s, ctx) => {
  if (!s) return undefined;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (!inner.safeParse(p).success) { ctx.addIssue({ code: 'custom', message: `"${p}" is not valid` }); return z.NEVER; }
  }
  return parts;
});

const VIEW = requireAnyCap('operations.view', 'collaborate.view');

// ── Read ──────────────────────────────────────────────────────────────────────

const listQuery = z.object({
  status: z.enum(['active', 'all']).default('active'),
  priority: csv(PRIORITY),
  kind: z.enum(KINDS).optional(),
  zone: z.string().max(20).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  bbox: z.string().optional().transform((s, ctx) => {
    if (!s) return undefined;
    const n = s.split(',').map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
      ctx.addIssue({ code: 'custom', message: 'bbox is minLng,minLat,maxLng,maxLat' });
      return z.NEVER;
    }
    return n;
  }),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(80).optional(),
});

router.get('/', VIEW, wrap(async (req, res) => {
  const q = parse(listQuery, req.query);
  // "All" without a window would page through two years of history; default to today.
  if (q.status === 'all' && !q.from) q.from = gstMidnightIso(nowMs());
  res.json(await svc.list({ ...q, priorities: q.priority, zoneRef: q.zone }, actorFrom(req.user)));
}));

router.get('/:ref', VIEW, wrap(async (req, res) => {
  res.json(await svc.detail(req.params.ref, actorFrom(req.user)));
}));

router.get('/:ref/recommendation', requireCap('operations.view'), wrap(async (req, res) => {
  const q = parse(z.object({ exclude: csv(z.string().max(20)) }), req.query);
  res.json(await dispatch.recommendation(req.params.ref, actorFrom(req.user), { excludeRefs: q.exclude ?? [] }));
}));

router.get('/:ref/correlation', VIEW, wrap(async (req, res) => {
  res.json(await dispatch.correlation(req.params.ref, actorFrom(req.user)));
}));

// ── Create and correct ────────────────────────────────────────────────────────

const createBody = z.object({
  kind: z.enum(KINDS),
  priority: PRIORITY.nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  makani: z.string().regex(/^\d{5}\s?\d{5}$/, 'Makani is ten digits').nullish(),
  floor: z.number().int().min(-6).max(200).nullish(),
  unitNo: text(40).nullish(),
  accessNote: text(300).nullish(),
  source: z.enum(INCIDENT_SOURCES),
  callerName: text(120).nullish(),
  callerPhone: text(40).nullish(),
  callerRole: z.enum(CALLER_ROLES).nullish(),
  chiefComplaint: text(200).nullish(),
  patientsCount: z.number().int().min(1).max(500).nullish(),
  triageCode: text(20).nullish(),
  acuity: z.number().int().min(1).max(5).nullish(),
}).refine((d) => d.makani || (d.lng != null && d.lat != null), {
  message: 'Give a Makani number or coordinates', path: ['location'],
});

/** Drop nulls so services see "not given" as undefined, one way. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

router.post('/', requireCap('incident.create'), idempotent, wrap(async (req, res) => {
  const body = compact(parse(createBody, req.body));
  res.status(201).json(await svc.create(body, actorFrom(req.user)));
}));

const updateBody = z.object({
  priority: PRIORITY.optional(),
  kind: z.enum(KINDS).optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  makani: z.string().regex(/^\d{5}\s?\d{5}$/).optional(),
  floor: z.number().int().min(-6).max(200).nullable().optional(),
  unitNo: text(40).nullable().optional(),
  accessNote: text(300).nullable().optional(),
  patientsCount: z.number().int().min(1).max(500).optional(),
  chiefComplaint: text(200).nullable().optional(),
}).refine((d) => (d.lng == null) === (d.lat == null), { message: 'lng and lat go together', path: ['location'] });

router.patch('/:ref', requireCap('operations.dispatch'), wrap(async (req, res) => {
  res.json(await svc.update(req.params.ref, parse(updateBody, req.body), actorFrom(req.user)));
}));

router.post('/:ref/triage', requireCap('operations.dispatch'), wrap(async (req, res) => {
  const body = parse(z.object({
    priority: PRIORITY.optional(), triageCode: text(20).optional(), acuity: z.number().int().min(1).max(5).optional(),
  }), req.body ?? {});
  res.json(await svc.triage(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/:ref/close', requireCap('incident.close'), wrap(async (req, res) => {
  const body = parse(z.object({ outcome: z.enum(INCIDENT_OUTCOMES) }), req.body);
  res.json(await svc.close(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/:ref/notes', requireCap('incident.note'), wrap(async (req, res) => {
  const body = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  res.status(201).json(await svc.addNote(req.params.ref, body, actorFrom(req.user)));
}));

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** Commit the dispatch. One call does the whole thing — docs/04 §3. */
router.post('/:ref/assignments', requireCap('operations.dispatch'), idempotent, wrap(async (req, res) => {
  const body = parse(z.object({
    unitRef: z.string().min(2).max(20),
    overrideReason: text(300).optional(),
  }), req.body);
  res.status(201).json(await dispatch.commitDispatch(req.params.ref, body, actorFrom(req.user)));
}));

// ── Multi-agency ──────────────────────────────────────────────────────────────

router.post('/:ref/notify', requireCap('operations.dispatch'), wrap(async (req, res) => {
  const body = parse(z.object({ agencies: z.array(z.enum(AGENCY_CODES)).min(1) }), req.body);
  res.json(await svc.notifyAgencies(req.params.ref, body, actorFrom(req.user)));
}));

router.post('/:ref/notifications/:agency/acknowledge', VIEW, wrap(async (req, res) => {
  const agency = parse(z.enum(AGENCY_CODES), req.params.agency);
  res.json(await svc.acknowledgeNotification(req.params.ref, agency, actorFrom(req.user)));
}));

export default router;
