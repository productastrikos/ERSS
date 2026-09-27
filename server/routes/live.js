/**
 * /api/sim, /api/live, /api/feed, /api/alerts — the live picture.
 *
 * The simulator's controls, where every ambulance on a job is going, the stream of what just
 * happened, the alerts, and the one-call dashboard summary.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation, notFound } from '../lib/errors.js';
import { requireAnyCap, requireCap } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { audit } from '../lib/audit.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { pocFleet } from '../config/poc.js';
import { actorFrom, auditActor } from '../services/actor.js';
import { kpisToday } from '../services/kpi.js';
import { gstMidnightIso } from '../services/eta.js';
import * as alerts from '../services/alerts.js';
import * as sim from '../sim/live.js';
import * as detection from '../engines/detection.js';
import { CAPABILITY_REQUIREMENTS } from '../data/reference/fleet.js';
import * as decisions from '../services/decisions.js';
import * as dispatchRules from '../services/dispatchRules.js';
import { autoDispatchReport, unitDetail } from '../services/liveDetail.js';

const router = Router();

const LIVE_VIEW = requireAnyCap('operations.view', 'executive.view', 'advisories.view');
const CONTROL = requireCap('scenario.control');

function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  return r.data;
}

const settingsBody = z.object({
  intensity: z.enum(Object.keys(sim.INTENSITY)).optional(),
  autoDispatch: z.boolean().optional(),
  pace: z.enum(['real', 'brisk']).optional(),
});

// ── Simulation ────────────────────────────────────────────────────────────────

router.get('/sim', LIVE_VIEW, (_req, res) => res.json(sim.publicState()));

router.post('/sim/start', CONTROL, wrap(async (req, res) => {
  const body = parse(settingsBody, req.body);
  const actor = actorFrom(req.user);
  const state = await sim.start(body, actor);
  await audit({ action: 'sim.start', entity: 'simulation', entityId: state.runRef, actor: auditActor(actor), payload: body });
  res.json(state);
}));

router.post('/sim/stop', CONTROL, wrap(async (req, res) => {
  const state = sim.stop();
  await audit({ action: 'sim.stop', entity: 'simulation', entityId: state.runRef, actor: auditActor(actorFrom(req.user)) });
  res.json(state);
}));

router.patch('/sim', CONTROL, wrap(async (req, res) => {
  res.json(sim.update(parse(settingsBody, req.body)));
}));

router.post('/sim/inject', CONTROL, wrap(async (req, res) => {
  const body = parse(z.object({
    kind: z.enum(Object.keys(CAPABILITY_REQUIREMENTS)).optional(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
    zoneRef: z.string().max(20).optional(),
  }), req.body);
  const out = await sim.inject(body);
  if (!out) throw notFound('A Makani entrance in that community');
  res.status(201).json(out);
}));

// ── Camera detections ────────────────────────────────────────────────────────
//
// Read-only. A detection is raised by engines/detection.js and streamed over the socket
// as it moves through its stages; these routes are the floor under that stream, for a
// console that has just loaded or just reconnected.

router.get('/detections', LIVE_VIEW, (_req, res) => res.json(detection.list()));

router.get('/detections/:id', LIVE_VIEW, (req, res) => {
  const d = detection.get(req.params.id);
  if (!d) throw notFound('Detection');
  res.json(d);
});

/** The detection behind an incident, if a camera raised it rather than a caller. */
router.get('/incidents/:ref/detection', LIVE_VIEW, (req, res) => {
  const d = detection.forIncident(req.params.ref);
  if (!d) throw notFound('Detection');
  res.json(d);
});

router.post('/sim/hold/:ref', requireCap('operations.dispatch'), wrap(async (req, res) => {
  res.json(sim.hold(req.params.ref));
}));

router.post('/sim/reset', CONTROL, wrap(async (req, res) => {
  const out = await sim.reset();
  await audit({ action: 'sim.reset', entity: 'simulation', actor: auditActor(actorFrom(req.user)), payload: { removed: out.removed } });
  res.json(out);
}));

// ── Live picture ──────────────────────────────────────────────────────────────

router.get('/live/assignments', LIVE_VIEW, wrap(async (_req, res) => {
  res.json(await sim.liveAssignments());
}));

/**
 * Everything the dashboard's header strip and side panels need, in one round trip.
 */
router.get('/live/summary', LIVE_VIEW, wrap(async (req, res) => {
  const midnight = gstMidnightIso(nowMs());
  const [kpi, fleet, active, ai, hospitals, trend] = await Promise.all([
    kpisToday(actorFrom(req.user)),
    // The trial fleet only (config/poc.js) — the same eight the map draws and dispatch
    // chooses from. A fleet tile counting ambulances the console never shows would be
    // the one number on this screen that nobody could check.
    pool.query(`
      SELECT u.status, COUNT(*)::int AS n
        FROM units u JOIN agencies a ON a.id = u.agency_id
       WHERE u.archived_at IS NULL AND a.code = 'DCAS'
         AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))
       GROUP BY u.status`, [pocFleet()]),
    pool.query(`
      SELECT i.priority, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE i.first_onscene_at IS NULL AND NOT EXISTS (
               SELECT 1 FROM assignments a WHERE a.incident_id = i.id
                  AND a.state IN ('offered','acknowledged','enroute','onscene','transporting','at_hospital','resolved_on_scene')))::int AS waiting
        FROM incidents i
       WHERE i.state <> 'closed' AND NOT i.is_seed AND NOT i.is_resting
       GROUP BY i.priority`),
    pool.query(`
      SELECT COUNT(*)::int AS dispatches,
             COALESCE(SUM((dispatch_rationale->'baseline'->>'savedSec')::numeric), 0)::int AS saved_sec,
             COUNT(*) FILTER (WHERE (dispatch_rationale->'baseline'->>'savedSec')::numeric > 0)::int AS faster
        FROM assignments
       WHERE offered_at >= $1 AND dispatch_rationale ? 'baseline'`, [midnight]),
    pool.query(`
      SELECT h.ref, h.name, h.ed_beds, h.ed_occupied, h.on_diversion,
             COUNT(a.id) FILTER (WHERE a.state = 'transporting')::int AS inbound
        FROM hospitals h LEFT JOIN assignments a ON a.hospital_id = h.id AND a.state = 'transporting'
       GROUP BY h.id
       ORDER BY h.ed_occupied::float / NULLIF(h.ed_beds, 0) DESC NULLS LAST`),
    pool.query(`
      SELECT EXTRACT(HOUR FROM r.reported_at AT TIME ZONE 'Asia/Dubai')::int AS hour,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY r.response_sec) AS p50,
             COUNT(*)::int AS n
        FROM v_incident_response r
       WHERE r.reported_at >= $1 AND r.response_sec IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM incidents x WHERE x.id = r.id AND x.is_resting)
       GROUP BY 1 ORDER BY 1`, [midnight]),
  ]);

  const status = Object.fromEntries(fleet.rows.map((r) => [r.status, r.n]));
  const byPriority = Object.fromEntries(active.rows.map((r) => [r.priority, r]));
  const a = ai.rows[0];

  res.json({
    at: nowIso(),
    kpi,
    targets: Object.fromEntries(jurisdiction.priorities.map((p) => [p.code, p.targetSec])),
    fleet: {
      available: status.available ?? 0,
      standby: status.standby ?? 0,
      relocating: status.relocating ?? 0,
      assigned: status.assigned ?? 0,
      responding: status.responding ?? 0,
      onScene: status.on_scene ?? 0,
      transporting: status.transporting ?? 0,
      atHospital: status.at_hospital ?? 0,
      offDuty: status.off_duty ?? 0,
      outOfService: status.out_of_service ?? 0,
      total: fleet.rows.reduce((s, r) => s + r.n, 0),
    },
    active: {
      total: active.rows.reduce((s, r) => s + r.n, 0),
      waiting: active.rows.reduce((s, r) => s + r.waiting, 0),
      P1: byPriority.P1?.n ?? 0, P2: byPriority.P2?.n ?? 0, P3: byPriority.P3?.n ?? 0, P4: byPriority.P4?.n ?? 0,
    },
    aiDispatch: {
      dispatches: a.dispatches,
      savedSec: a.saved_sec,
      faster: a.faster,
      avgSavedSec: a.dispatches ? Math.round(a.saved_sec / a.dispatches) : null,
      basis: 'Predicted arrival of the recommended ambulance versus the nearest ambulance by distance, at the moment of dispatch',
    },
    hospitals: hospitals.rows.map((h) => ({
      ref: h.ref, name: h.name, edBeds: h.ed_beds, edOccupied: h.ed_occupied, onDiversion: h.on_diversion,
      occupancyPct: h.ed_beds ? Math.round((100 * h.ed_occupied) / h.ed_beds) : null, inbound: h.inbound,
    })),
    trend: trend.rows.map((r) => ({ hour: r.hour, p50Sec: r.p50 == null ? null : Math.round(r.p50), n: r.n })),
    sim: sim.publicState(),
  });
}));

// ── Feed ──────────────────────────────────────────────────────────────────────

router.get('/feed', LIVE_VIEW, wrap(async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }), req.query);
  const { rows } = await pool.query(`
    SELECT t.id, t.ts, t.stage, t.label, t.detail->>'unitRef' AS unit_ref,
           i.ref, i.priority, i.kind, z.name AS zone_name
      FROM incident_timeline t
      JOIN incidents i ON i.id = t.incident_id
      LEFT JOIN zones z ON z.id = i.zone_id
     WHERE t.ts > now() - interval '12 hours' AND t.ts <= now()
       AND t.stage NOT IN ('agency_notified', 'agency_acknowledged', 'note', 'updated')
     ORDER BY t.ts DESC, t.id DESC
     LIMIT $1`, [limit]);
  res.json(rows.map((r) => ({
    id: r.id, ts: new Date(r.ts).toISOString(), stage: r.stage, label: r.label,
    incidentRef: r.ref, priority: r.priority, kind: r.kind, zoneName: r.zone_name, unitRef: r.unit_ref,
  })));
}));

// ── Alerts ────────────────────────────────────────────────────────────────────

router.get('/alerts', requireAnyCap('operations.view', 'advisories.view', 'executive.view', 'assignment.act'), (req, res) => {
  res.json(alerts.list(Number(req.query.limit) || 60));
});

router.post('/alerts/:id/ack', requireAnyCap('operations.view', 'advisories.view', 'executive.view', 'assignment.act'), (req, res) => {
  if (!alerts.acknowledge(req.params.id)) throw notFound('Alert');
  res.json({ ok: true });
});

// ── The detail behind the dashboard's cards ────────────────────────────────────

/** The AI's reasoning on one incident, step by step (services/decisions.js). */
router.get('/live/decisions/:ref', LIVE_VIEW, wrap(async (req, res) => {
  res.json(await decisions.trace(req.params.ref, actorFrom(req.user)));
}));

/** The Automatic dispatch card, in full: rules, today's decisions, outlook, advisory. */
router.get('/live/autodispatch', LIVE_VIEW, wrap(async (_req, res) => {
  res.json(await autoDispatchReport());
}));

/** One trial ambulance: vehicle, crew, telemetry, current job, its day. */
router.get('/live/units/:ref', LIVE_VIEW, wrap(async (req, res) => {
  res.json(await unitDetail(req.params.ref, sim.liveFor));
}));

/** Send the AI's choice now, instead of at the end of its window — or release a hold. */
router.post('/live/dispatch-now/:ref', requireCap('operations.dispatch'), wrap(async (req, res) => {
  const state = await sim.dispatchNow(req.params.ref);
  await audit({ action: 'dispatch.now', entity: 'incident', entityId: req.params.ref, actor: auditActor(actorFrom(req.user)), payload: {} });
  res.json(state);
}));

// ── Automatic dispatch rules ─────────────────────────────────────────────────

const byPriority = (schema) => z.object({ P1: schema, P2: schema, P3: schema, P4: schema }).partial();
const rulesBody = z.object({
  autoDispatch: byPriority(z.boolean()).optional(),
  windowSec: byPriority(z.number().int().min(0).max(180)).optional(),
  weights: z.object({
    travel: z.number().min(0).max(1), capability: z.number().min(0).max(1),
    coverage: z.number().min(0).max(1), crew: z.number().min(0).max(1),
  }).partial().optional(),
  requireAlsForP1: z.boolean().optional(),
  reserveMin: z.number().int().min(0).max(4).optional(),
  escalateArrivalSec: z.number().int().min(240).max(1800).optional(),
  avoidTraffic: z.boolean().optional(),
});
const RULES_EDIT = requireCap('dispatch.rules');

router.get('/dispatch/rules', LIVE_VIEW, wrap(async (_req, res) => {
  res.json(await dispatchRules.describeRules());
}));

router.put('/dispatch/rules', RULES_EDIT, wrap(async (req, res) => {
  res.json(await dispatchRules.setCustomRules(parse(rulesBody, req.body), auditActor(actorFrom(req.user))));
}));

router.post('/dispatch/rules/reset', RULES_EDIT, wrap(async (req, res) => {
  res.json(await dispatchRules.resetToAi(auditActor(actorFrom(req.user))));
}));

export default router;
