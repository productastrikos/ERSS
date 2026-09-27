/**
 * Intelligence-engine reads. docs/08. One route per engine as it lands; each returns the
 * engine's EngineResult envelope verbatim.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAnyCap } from '../lib/auth.js';
import { parseFilters } from '../lib/filters.js';
import { actorFrom } from '../services/actor.js';
import { responseTimeReport, foldLegacyKeys } from '../services/analytics.js';
import { computeRanking, reBaseline } from '../services/ranking.js';
import { DEFAULT_WEIGHTS, COMPONENT_DIRECTION } from '../engines/ranking.js';
import {
  anomalyReport, equityReport, coverageReport, crowdReport, preemptReport, riskReport, demandReport,
  kpiLibrary, dataQualityReport,
} from '../services/intelligence.js';

const router = Router();
const ANALYTICS_VIEW = requireAnyCap('analytics.view', 'executive.view');
const INTEL_VIEW = requireAnyCap('intelligence.view', 'executive.view');

/** The universal filter (lib/filters.js), parsed off the same query string as each
 *  engine's own knobs. An engine honours the slice it can and names the rest in
 *  `filters.ignored` — see services/intelligence.js. */
function filtersOf(req) {
  try {
    return parseFilters(req.query);
  } catch (e) {
    throw validation(e.fieldErrors ?? { filter: ['Invalid filter'] });
  }
}

function knobs(shape, req) {
  const r = z.object(shape).safeParse(req.query ?? {});
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

/**
 * The one-at-a-time keys the console sent before the universal filter existed. Folded into
 * it rather than removed, so an old deep link still resolves.
 *
 * Deliberately covers ONLY the names the universal filter does not already own. `priority`
 * and `unitKind` are universal-filter names now and arrive as comma-separated lists, so
 * re-validating them here as single enums would reject `priority=P1,P2` outright.
 */
const legacyResponseTimeQuery = z.object({
  zoneRef: z.string().max(40).optional(),
  sectorRef: z.string().max(40).optional(),
  incidentKind: z.string().max(60).optional(),
  agencyCode: z.string().max(30).optional(),
  hourBand: z.enum(['am_peak', 'midday', 'pm_peak', 'evening', 'night']).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  ahead: z.coerce.number().int().min(0).max(60).default(7),
});

router.get('/analytics/response-time', requireAnyCap('operations.view', 'collaborate.view', 'executive.view'), wrap(async (req, res) => {
  const legacy = legacyResponseTimeQuery.safeParse(req.query);
  if (!legacy.success) throw validation(legacy.error.flatten().fieldErrors);
  const filters = foldLegacyKeys(filtersOf(req), legacy.data);
  res.json(await responseTimeReport({ filters, defaultDays: legacy.data.days, ahead: legacy.data.ahead }));
}));

const weightsShape = Object.fromEntries(Object.keys(COMPONENT_DIRECTION).map((k) => [k, z.number().min(0).optional()]));

const rankingQuery = z.object({
  level: z.enum(['emirate', 'sector', 'community', 'beat']).default('community'),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  weights: z.string().optional(),   // JSON-encoded partial weight override
});

router.get('/ranking', requireAnyCap('ranking.view'), wrap(async (req, res) => {
  const q = rankingQuery.safeParse(req.query);
  if (!q.success) throw validation(q.error.flatten().fieldErrors);
  let weights = DEFAULT_WEIGHTS;
  if (q.data.weights) {
    const parsed = z.object(weightsShape).safeParse(JSON.parse(q.data.weights));
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    weights = parsed.data;
  }
  const actor = actorFrom(req.user);
  res.json(await computeRanking({ level: q.data.level, from: q.data.from, to: q.data.to, weights, actorId: actor?.id }));
}));

const rebaselineBody = z.object({
  level: z.enum(['emirate', 'sector', 'community', 'beat']).default('community'),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  zoneId: z.string().uuid(),
  overrides: z.object(weightsShape),
  weights: z.object(weightsShape).optional(),
});

router.post('/ranking/rebaseline', requireAnyCap('ranking.weights'), wrap(async (req, res) => {
  const b = rebaselineBody.safeParse(req.body);
  if (!b.success) throw validation(b.error.flatten().fieldErrors);
  res.json(await reBaseline({ ...b.data, weights: b.data.weights ?? DEFAULT_WEIGHTS }));
}));

// ── Phase 6 raw engines ────────────────────────────────────────────────────────

router.get('/analytics/demand', ANALYTICS_VIEW, wrap(async (req, res) => {
  const q = knobs({
    hours: z.coerce.number().int().min(1).max(336).default(24),
    days: z.coerce.number().int().min(7).max(365).default(30),
  }, req);
  res.json(await demandReport({ ...q, filters: filtersOf(req) }));
}));

router.get('/analytics/risk', ANALYTICS_VIEW, wrap(async (req, res) => {
  const q = knobs({
    limit: z.coerce.number().int().min(5).max(200).default(25),
    hourBand: z.coerce.number().int().min(0).max(5).optional(),
  }, req);
  res.json(await riskReport({ ...q, hourBand: q.hourBand ?? null, filters: filtersOf(req) }));
}));

router.get('/analytics/anomaly', ANALYTICS_VIEW, wrap(async (req, res) => {
  const q = knobs({
    hours: z.coerce.number().int().min(24).max(2160).default(168),
    ahead: z.coerce.number().int().min(0).max(72).default(12),
  }, req);
  res.json(await anomalyReport({ ...q, filters: filtersOf(req) }));
}));

router.get('/analytics/equity', ANALYTICS_VIEW, wrap(async (req, res) => {
  res.json(await equityReport({ filters: filtersOf(req) }));
}));

router.get('/analytics/coverage', ANALYTICS_VIEW, wrap(async (req, res) => {
  res.json(await coverageReport({ filters: filtersOf(req) }));
}));

router.get('/analytics/crowd', ANALYTICS_VIEW, wrap(async (req, res) => {
  res.json(await crowdReport({ filters: filtersOf(req) }));
}));

router.get('/analytics/preempt', ANALYTICS_VIEW, wrap(async (req, res) => {
  res.json(await preemptReport({ filters: filtersOf(req) }));
}));

// ── Intelligence pillar — KPI library and data quality ───────────────────────

router.get('/kpi/library', INTEL_VIEW, wrap(async (req, res) => {
  res.json(await kpiLibrary());
}));

router.get('/data-quality', INTEL_VIEW, wrap(async (req, res) => {
  res.json(await dataQualityReport());
}));

export default router;
