/**
 * /api/insights — the analytical reads behind every chart in the console.
 *
 * Read-only and cheap enough to call from a dashboard: every one is an aggregate over
 * db/views.sql. Nothing here creates or changes state.
 *
 * EVERY route accepts the universal filter (lib/filters.js) on top of its own knobs, and
 * every route that returns a series also returns a forecast for it. That is the client's
 * standing requirement — one filter vocabulary, a prediction on every visualisation —
 * so a new endpoint added here is expected to do both.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation, notFound } from '../lib/errors.js';
import { requireAnyCap } from '../lib/auth.js';
import { parseFilters } from '../lib/filters.js';
import * as insights from '../services/insights.js';

const router = Router();

/** Anyone who can watch operations or read analytics can read these. */
const VIEW = requireAnyCap('operations.view', 'analytics.view', 'executive.view', 'collaborate.view', 'advisories.view');

function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

/** The universal filter, parsed off the same query string as the endpoint's own knobs. */
function filtersOf(req) {
  try {
    return parseFilters(req.query);
  } catch (e) {
    throw validation(e.fieldErrors ?? { filter: ['Invalid filter'] });
  }
}

const days = (def, max = 730) => z.coerce.number().int().min(1).max(max).default(def);
const ahead = (def, max = 60) => z.coerce.number().int().min(0).max(max).default(def);

// ── What the universal filter bar offers ─────────────────────────────────────

router.get('/insights/filter-options', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(365, 1095) }), req.query);
  res.set('Cache-Control', 'private, max-age=300');
  res.json(await insights.filterOptions(q));
}));

// ── The aggregates ───────────────────────────────────────────────────────────

router.get('/insights/almanac', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({
    weeks: z.coerce.number().int().min(1).max(104).default(12),
    ahead: ahead(1, 8),
  }), req.query);
  res.json(await insights.almanac({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/monthly', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({
    months: z.coerce.number().int().min(6).max(60).default(18),
    ahead: ahead(3, 12),
  }), req.query);
  res.json(await insights.monthly({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/daily', VIEW, wrap(async (req, res) => {
  // The client's window preset offers up to 730 days ("2y") on every Insights page alike
  // (lib/filters.ts WINDOW_PRESETS) — a lower cap here just for this endpoint meant
  // picking 2y anywhere that read from `daily` threw a 422 the operator never asked for.
  const q = parse(z.object({ days: days(30), ahead: ahead(7, 60) }), req.query);
  res.json(await insights.daily({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/call-types', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(90), limit: z.coerce.number().int().min(3).max(40).default(10) }), req.query);
  res.json(await insights.callTypes({ ...q, filters: filtersOf(req) }));
}));

/** The radial search (Concept Note §07): a circle anywhere, and everything inside it. */
router.get('/insights/radial', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({
    lng: z.coerce.number().min(-180).max(180),
    lat: z.coerce.number().min(-90).max(90),
    radius: z.coerce.number().min(100).max(10000).default(750),
    months: z.coerce.number().int().min(1).max(36).default(12),
    ahead: ahead(3, 12),
  }), req.query);
  res.json(await insights.radial({
    lng: q.lng, lat: q.lat, radiusM: q.radius, months: q.months, ahead: q.ahead, filters: filtersOf(req),
  }));
}));

/**
 * The demand surface: every call in the window binned to a fine grid, for the 3D
 * hexagons, the heatmap and the hour-of-day time-lapse on the radial-search screen.
 */
router.get('/insights/geo', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({
    months: z.coerce.number().int().min(1).max(36).default(12),
    cell: z.coerce.number().min(0.0005).max(0.01).default(0.001),
    hours: z.coerce.boolean().default(false),
  }), req.query);
  res.json(await insights.geo({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/compare', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(30) }), req.query);
  res.json(await insights.compare({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/call-centre', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(30), ahead: ahead(24, 48) }), req.query);
  res.json(await insights.callCentre({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/performance', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(30), ahead: ahead(7, 60) }), req.query);
  res.json(await insights.performance({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/eta-accuracy', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ days: days(90), ahead: ahead(7, 30) }), req.query);
  res.json(await insights.etaAccuracy({ ...q, filters: filtersOf(req) }));
}));

/**
 * The recorded corpus and how complete it is — what the models are trained and held to
 * account against. Read-only; the numbers are coverage, not a promise.
 */
router.get('/insights/playbook', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  res.json(await insights.playbook({ ...q, filters: filtersOf(req) }));
}));

// ── After-action replay ──────────────────────────────────────────────────────

router.get('/insights/replayable', VIEW, wrap(async (req, res) => {
  const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  res.json(await insights.replayable({ ...q, filters: filtersOf(req) }));
}));

router.get('/insights/replay/:ref', VIEW, wrap(async (req, res) => {
  const out = await insights.replay(req.params.ref);
  if (!out) throw notFound('Incident');
  res.json(out);
}));

export default router;
