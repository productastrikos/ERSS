/**
 * /api/bootstrap — everything a surface needs on load, in ONE round trip.
 *
 * A cold load is one request, not eleven. This matters more than it sounds: the
 * console opens on a video wall and the mobile app opens on a hotel network.
 */

import { Router } from 'express';
import { many, one } from '../lib/db.js';
import { wrap } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { env } from '../config/env.js';
import { poc } from '../config/poc.js';
import { ROLES, capabilitiesFor } from '../lib/auth.js';
import { clock } from '../lib/clock.js';
import { auditHead } from '../lib/audit.js';

const router = Router();

router.get('/bootstrap', wrap(async (req, res) => {
  const [agencies, feeds, activeRun, scenarios, head] = await Promise.all([
    many(`SELECT code, name, short_name, emergency_no, glyph, series_slot,
                 is_responder, sla_ack_sec, sla_scene_sec
            FROM agencies ORDER BY series_slot`),
    many(`SELECT f.key, f.name, f.kind, f.classification, f.is_simulated, f.last_update,
                 a.code AS agency_code
            FROM agency_feeds f JOIN agencies a ON a.id = f.agency_id
           ORDER BY f.key`),
    one(`SELECT r.ref, r.state, r.speed, r.cursor_sec, s.ref AS scenario_ref, s.name
           FROM scenario_runs r JOIN scenarios s ON s.id = r.scenario_id
          WHERE r.state IN ('running','paused') ORDER BY r.started_at DESC LIMIT 1`),
    many(`SELECT ref, name, summary, tier, duration_sec, grounding
            FROM scenarios WHERE enabled ORDER BY tier, ref`),
    auditHead().catch(() => null),
  ]);

  res.json({
    // Who is asking. null when signed out — the login screen needs the rest of this
    // payload too (branding, jurisdiction), so bootstrap is deliberately unauthenticated.
    user: req.user ? {
      id: req.user.id,
      ref: req.user.ref,
      name: req.user.name,
      role: req.user.role,
      roleLabel: ROLES[req.user.role]?.label ?? req.user.role,
      surface: ROLES[req.user.role]?.surface ?? 'console',
      agencyCode: req.user.agency_code ?? null,
      zoneScope: req.user.zone_scope ?? [],
      unitId: req.user.unit_id ?? null,
      locale: req.user.locale ?? 'en',
      capabilities: capabilitiesFor(req.user.role),
    } : null,

    // The jurisdiction pack. One place the client learns what 998 means, what a
    // "sector" is called, and what counts as on-target.
    jurisdiction: {
      code: jurisdiction.code,
      name: jurisdiction.name,
      country: jurisdiction.country,
      timezone: jurisdiction.timezone,
      locale: jurisdiction.locale,
      bbox: jurisdiction.bbox,
      centre: jurisdiction.centre,
      hierarchy: jurisdiction.hierarchy,
      priorities: jurisdiction.priorities,
      targets: jurisdiction.targets,
      population: {
        resident: jurisdiction.population.resident,
        daytime: jurisdiction.population.daytime,
        daytimeWindow: jurisdiction.population.daytimeWindow,
      },
      escalationLevels: jurisdiction.escalation.levels,
      dataClassification: jurisdiction.dataClassification,
    },

    // The trial's scope (config/poc.js). Sent rather than hard-coded in the client, so
    // the console and the server can never disagree about what this build is for.
    poc: {
      enabled: poc.enabled,
      fleetSize: poc.fleet.length,
      camerasPerUnit: poc.camerasPerUnit,
      roadOnly: poc.roadOnly,
      calls: poc.calls,
    },

    agencies,
    feeds,
    scenarios,
    activeRun: activeRun ?? null,
    clock: clock.snapshot(),

    // Which integrations are LIVE and which are mocked. The UI turns this into the
    // permanent "simulated source" chips — being visibly honest about this is worth
    // more in a tender demo than appearing to have every integration.
    integrations: {
      makani: { live: Boolean(env.integrations.makani.apiKey), label: 'Makani' },
      nabidh: { live: Boolean(env.integrations.nabidh.baseUrl), label: 'NABIDH' },
      cad:    { live: false, label: 'CAD feed' },
      rta:    { live: false, label: 'RTA signals' },
      push:   { live: Boolean(env.integrations.fcmKey), label: 'Push' },
      llm:    { live: env.llm.enabled, label: 'Assistant' },
    },

    audit: head ? { seq: head.seq, ts: head.ts } : null,
    serverTime: clock.iso(),
  });
}));

export default router;
