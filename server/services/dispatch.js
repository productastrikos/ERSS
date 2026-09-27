/**
 * Dispatch — recommendation, the commit, every assignment transition, automatic
 * re-dispatch and the acknowledge-timeout sweep. docs/04 §3–4, docs/03 §3.2.
 *
 * The shape of every mutation here:
 *
 *   1. read and compute OUTSIDE the transaction — OSRM calls and engine runs must never
 *      hold a row lock
 *   2. transaction: lock, RE-VALIDATE against the locked rows, write
 *   3. after commit: audit, then fan-out
 *
 * Routes, the sweeper and (Phase 10) the scenario runner all call these functions, so a
 * dispatch from a script is the same dispatch as one from the console.
 */

import { pool, transaction } from '../lib/db.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { conflict, forbidden, notFound, validation, AppError } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { CAPABILITY_REQUIREMENTS } from '../data/reference/fleet.js';
import { poc } from '../config/poc.js';

import {
  ASSIGNMENT_ACTIONS, ACTIVE_ASSIGNMENT_STATES, DISPATCHABLE_UNIT_STATUSES, PRE_ARRIVAL_STATES,
  allowedActions, transitionError, deriveIncidentState, derivedIncidentStamps,
} from '../domain/lifecycle.js';
import { recommend, requirementFor } from '../engines/dispatch.js';
import { rankHospitals } from '../engines/hospital.js';
import { correlate } from '../engines/correlation.js';

import * as incidents from '../repos/incidents.js';
import * as fleet from '../repos/fleet.js';
import * as reference from '../repos/reference.js';
import * as eta from './eta.js';
import * as osrm from '../integrations/osrm.js';
import * as fanout from '../realtime/fanout.js';
import { SYSTEM, auditActor } from './actor.js';
import { scheduleKpiTick } from './kpi.js';
import { effectiveRules } from './dispatchRules.js';

const D = jurisdiction.dispatch;
const LEAD_AGENCY = 'DCAS';

const mmss = (sec) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.round(Math.max(0, sec)) % 60).padStart(2, '0')}`;

// ═══════════════════════════════════════════════════════════════════════════════
//  Access
// ═══════════════════════════════════════════════════════════════════════════════

/** A zone-scoped user cannot see, let alone act on, an incident outside their scope —
 *  and is told "not found", not "forbidden", so the scope does not leak what exists. */
export function assertInScope(actor, incRow) {
  if (!actor.zoneScope?.length) return;
  const zones = new Set(actor.zoneScope);
  if (!zones.has(incRow.zone_id) && !zones.has(incRow.parent_zone_id)) throw notFound('Incident');
}

export async function loadIncident(ref, actor, db = pool) {
  const row = await incidents.incidentRow(db, ref);
  if (!row) throw notFound('Incident');
  if (actor) assertInScope(actor, { ...row, parent_zone_id: await parentZone(db, row.zone_id) });
  return row;
}

async function parentZone(db, zoneId) {
  if (!zoneId) return null;
  const { rows } = await db.query('SELECT parent_id FROM zones WHERE id = $1', [zoneId]);
  return rows[0]?.parent_id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Incident state sync — the incident follows its assignments
// ═══════════════════════════════════════════════════════════════════════════════

export async function syncIncident(client, incRow, extra = {}) {
  const assignments = await fleet.assignmentsForIncident(client, incRow.id);
  const state = deriveIncidentState(incRow, assignments);
  const stamps = derivedIncidentStamps(assignments);
  await incidents.updateIncident(client, incRow.id, {
    state,
    first_onscene_at: stamps.first_onscene_at,
    first_at_patient_at: stamps.first_at_patient_at,
    ...extra,
  });
  return { state, assignments };
}

export const canTransport = (unitKind) => !D.nonTransportKinds.includes(unitKind);

export function shapeAssignmentWithActions(row) {
  const transport = canTransport(row.unit_kind);
  return { ...fleet.shapeAssignment(row), canTransport: transport, allowedActions: allowedActions(row, { canTransport: transport }) };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Recommendation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the dispatch engine for an incident without committing anything.
 * @param {object} inc  an incidents.incidentRow
 * @param {{ excludeRefs?: string[] }} [opts]
 */
export async function recommendFor(inc, { excludeRefs = [], trafficDelays = null } = {}) {
  const now = nowMs();
  // The automatic-dispatch policy in force this moment (services/dispatchRules.js): its
  // weight vector, and whether a P1 must go to an advanced-life-support crew.
  const policy = await effectiveRules();
  const requirement = requirementFor({ kind: inc.kind, priority: inc.priority }, CAPABILITY_REQUIREMENTS);
  if (policy.rules.requireAlsForP1 && inc.priority === 'P1' && !requirement.required.includes('als')) {
    requirement.required.push('als');
    requirement.notes.push('Rule: every P1 goes to an advanced-life-support crew');
  }
  const candidates = await fleet.dispatchCandidates(pool, {
    lng: inc.lng, lat: inc.lat,
    agencyCodes: [LEAD_AGENCY],
    required: requirement.required,
    preferred: requirement.preferred,
    nonPrimaryKinds: D.nonPrimaryKinds,
    excludeRefs,
    limit: D.candidatePool,
    coverageRadiusM: D.coverageRadiusM,
    todayIso: eta.gstMidnightIso(now),
    hourOfWeek: eta.gstHourOfWeek(now),
  });

  const travels = await eta.travelMany(
    candidates.map((c) => [c.lng, c.lat]), [inc.lng, inc.lat], { zoneClass: inc.zone_class ?? 'urban', at: now },
  );
  // Traffic on each candidate's road route (sim/traffic.js), measured by the decision
  // preview before this runs — never fetched here, because road geometry must stay off
  // the commit path. Added to the arrival only when the policy says to weigh it.
  const useTraffic = policy.rules.avoidTraffic && trafficDelays;
  const scored = await Promise.all(candidates.map(async (c, i) => {
    const base = travels[i].value ? await eta.arrival(travels[i].value.seconds, 'offer') : null;
    const trafficDelaySec = useTraffic ? Math.max(0, Math.round(trafficDelays[c.ref] ?? 0)) : 0;
    return {
      ...c,
      travel: travels[i],
      arrivalSec: base == null ? null : base + trafficDelaySec,
      trafficDelaySec,
      shiftHours: c.shiftStart ? (now - Date.parse(c.shiftStart)) / 3_600_000 : null,
    };
  }));

  const cal = await eta.calibration();
  const result = recommend({
    incident: { ref: inc.ref, kind: inc.kind, priority: inc.priority },
    requirement,
    candidates: scored,
    weights: { ...policy.rules.weights, equity: D.weights.equity ?? 0 },
    rules: { nonPrimaryKinds: D.nonPrimaryKinds, nonTransportKinds: D.nonTransportKinds },
    window: cal.window,
  });

  // The vertical stage, predicted separately and never folded into travel.
  const vrt = await eta.vrtFor(inc.floor);
  return {
    ...result,
    value: { ...result.value, vrt },
    policy: { mode: policy.mode, rules: policy.rules, notes: policy.notes, trafficApplied: Boolean(useTraffic) },
  };
}

export async function recommendation(ref, actor, opts) {
  const inc = await loadIncident(ref, actor);
  return recommendFor(inc, opts);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Correlation (5.9) — also decides who is notified on dispatch
// ═══════════════════════════════════════════════════════════════════════════════

export async function correlationFor(inc) {
  const at = nowIso();
  const ms = nowMs();
  const [zoneRes, weather, hospitals, sites, events, feeds] = await Promise.all([
    inc.zone_id
      ? pool.query('SELECT name, class, population, population_daytime, area_km2, highrise_ct FROM zones WHERE id = $1', [inc.zone_id])
      : { rows: [] },
    reference.weatherAt(pool, at),
    reference.hospitalsNear(pool, inc.lng, inc.lat, 3000),
    reference.sitesNear(pool, inc.lng, inc.lat, 1000),
    reference.eventsNear(pool, inc.lng, inc.lat, 2000, at),
    reference.feeds(pool),
  ]);
  const z = zoneRes.rows[0];
  const hour = eta.gstHour(ms);
  const win = jurisdiction.population.daytimeWindow;

  return correlate({
    incident: {
      ref: inc.ref, kind: inc.kind, priority: inc.priority, floor: inc.floor,
      patientsCount: inc.patients_count, chiefComplaint: inc.chief_complaint,
    },
    zone: z ? {
      name: z.name, class: z.class, population: z.population, populationDaytime: z.population_daytime,
      areaKm2: z.area_km2 ? Number(z.area_km2) : null, highriseCount: z.highrise_ct,
    } : null,
    weather,
    daytime: hour >= win.fromHour && hour < win.toHour,
    hospitals, sites, events, feeds,
    rules: {
      mciThreshold: D.mciThreshold,
      highRiseFloorThreshold: jurisdiction.vrt.highRiseFloorThreshold,
      emiratePatients: jurisdiction.escalation.triggers.emirate.patients,
    },
    window: { from: weather?.ts ?? at, to: at },
  });
}

export async function correlation(ref, actor) {
  return correlationFor(await loadIncident(ref, actor));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  The commit — one call does the whole dispatch
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Offer an incident to a unit. Creates the assignment with its stored rationale, pushes
 * the offer to the unit, notifies the agencies correlation selects and starts their SLA
 * clocks.
 *
 * The rationale is RECOMPUTED here, not taken from the client: what is kept forever is
 * what the server decided, at the moment it was decided.
 *
 * ⚠ The pre-empt corridor is not opened: engines/preempt.js is Phase 6.7.
 *
 * @param {string} ref
 * @param {{ unitRef: string, overrideReason?: string, excludeRefs?: string[], redispatch?: object }} body
 * @param {object} actor
 */
export async function commitDispatch(ref, { unitRef, overrideReason, excludeRefs = [], redispatch = null, trafficDelays = null }, actor) {
  const inc0 = await loadIncident(ref, actor);
  if (inc0.state === 'closed') throw conflict(`${ref} is closed`);

  const unit0 = await fleet.unitByRef(pool, unitRef);
  if (!unit0) throw notFound('Unit');
  if (unit0.lng == null) throw conflict(`${unitRef} has no known position`);

  const rec = await recommendFor(inc0, { excludeRefs, trafficDelays });
  const recs = rec.value?.recommendations ?? [];
  const chosen = recs.find((r) => r.unitRef === unitRef) ?? null;
  const override = !chosen || chosen.rank !== 1;
  if (override && actor.kind !== 'system' && !overrideReason?.trim()) {
    throw validation({ overrideReason: [chosen
      ? `${unitRef} is recommendation ${chosen.rank} — a reason is required to send it over ${recs[0].unitRef}`
      : `${unitRef} is not among the recommended units — a reason is required`] });
  }

  const at = nowIso();
  const now = nowMs();
  // The prediction is the one the recommendation just made. Only a unit the engine did not
  // rank needs its own — no road-geometry call sits on the commit path: a slow routing
  // server must never hold up DISPATCH. The drawn route is attached after commit.
  const [manual, corr] = await Promise.all([
    chosen ? null : eta.travelMany([[unit0.lng, unit0.lat]], [inc0.lng, inc0.lat], { zoneClass: inc0.zone_class ?? 'urban', at: now }).then((r) => r[0]),
    correlationFor(inc0).catch((err) => {
      logger.warn({ err, ref }, '[dispatch] correlation failed — dispatching without agency notification');
      return null;
    }),
  ]);
  if (!chosen && manual?.value?.seconds == null) throw new AppError('engine_failed', 500, 'No travel prediction could be made');
  const travelSec = chosen ? chosen.travelSec : manual.value.seconds;
  const travelM = chosen ? chosen.distanceM : manual.value.distanceM;
  const travelMethod = chosen ? chosen.etaMethod : manual.method;
  const arrival = chosen ? chosen.arrivalSec : await eta.arrival(travelSec, 'offer');

  const rationale = {
    engine: rec.method,
    computedAt: rec.computedAt,
    window: rec.window,
    weights: rec.value?.weights ?? D.weights,
    // The policy the choice was made under, and the ranked field it was made from — so the
    // AI log of a closed incident can show every ambulance the engine weighed, not only the
    // one it sent.
    policy: rec.policy ? { mode: rec.policy.mode, trafficApplied: rec.policy.trafficApplied, notes: rec.policy.notes } : null,
    alternatives: recs.slice(0, 5).map((r) => ({
      unitRef: r.unitRef, callsign: r.callsign, kind: r.kind, rank: r.rank, score: r.rationale.score,
      arrivalSec: r.arrivalSec, travelSec: r.travelSec, distanceM: r.distanceM, straightM: r.straightM,
      trafficDelaySec: r.trafficDelaySec ?? 0, canTransport: r.canTransport,
      factors: r.rationale.factors.map((f) => ({ key: f.key, weight: f.weight, score: f.score, contribution: f.contribution })),
    })),
    confidence: rec.confidence ?? null,
    requirement: rec.value?.requirement ?? null,
    selected: chosen
      ? { rank: chosen.rank, of: recs.length, ...chosen.rationale }
      : { rank: null, of: recs.length, note: 'Not among the recommended units', travel: { method: manual.method, confidence: manual.confidence, factors: manual.factors } },
    recommendedTop: recs[0] ? { unitRef: recs[0].unitRef, score: recs[0].rationale.score, arrivalSec: recs[0].arrivalSec } : null,
    // What "send the nearest one" would have done: the qualifying unit closest as the crow
    // flies. The dashboard's "seconds saved by AI dispatch" is measured against this, so the
    // claim is checkable — and it is zero whenever the nearest unit was also the fastest.
    baseline: withSaving(nearestByDistance(recs), arrival),
    override: override && actor.kind !== 'system' ? { reason: overrideReason.trim(), by: actor.ref } : null,
    redispatch,
    excluded: (rec.value?.excluded ?? []).slice(0, 6),
    caveats: rec.caveats,
  };

  const notifyCodes = (corr?.value?.recommendedAgencies ?? [])
    .map((a) => a.code)
    .filter((c) => c !== LEAD_AGENCY && c !== unit0.agencyCode);

  const out = await transaction(async (c) => {
    const inc = await incidents.incidentRow(c, ref, { forUpdate: true });
    if (inc.state === 'closed') throw conflict(`${ref} was closed a moment ago`);
    const unit = await fleet.lockUnit(c, unitRef);
    if (!DISPATCHABLE_UNIT_STATUSES.has(unit.status)) {
      throw conflict(`${unit.ref} is ${unit.status.replace(/_/g, ' ')} — it cannot be offered a job`);
    }
    const busy = await fleet.activeAssignmentForUnit(c, unit.id);
    if (busy) throw conflict(`${unit.ref} is already assigned to ${busy.incident_ref}`);

    const existing = await fleet.assignmentsForIncident(c, inc.id);
    const hasPrimary = existing.some((a) => a.is_primary && ACTIVE_ASSIGNMENT_STATES.has(a.state));
    const asgRef = await fleet.nextAssignmentRef(c, inc.id, inc.ref);

    await fleet.insertAssignment(c, {
      ref: asgRef, incidentId: inc.id, unitId: unit.id, isPrimary: !hasPrimary, offeredAt: at,
      routeCoordinates: null,     // attached after commit — attachRouteGeometry()
      routeSec: travelSec, routeM: travelM,
      etaPredictedAt: new Date(now + arrival * 1000).toISOString(),
      etaMethod: travelMethod,
      rationale,
      runId: inc.run_id,
    });
    const unitRow = await fleet.setUnitStatus(c, unit.id, 'assigned');

    const notified = await incidents.insertNotifications(c, inc.id, notifyCodes, at);
    const { state } = await syncIncident(c, inc, {
      dispatched_at: inc.dispatched_at ?? at,
      addAgencies: [unit.agency_code, ...notified.map((n) => n.code)],
    });

    const who = actor.kind !== 'system' ? actor.ref
      : redispatch ? 'automatic re-dispatch'
        : actor.ref === 'AI-DISPATCH' ? 'AI auto-dispatch' : 'system';
    const timeline = [await incidents.insertTimeline(c, inc.id, {
      ts: at, stage: redispatch ? 'redispatched' : 'dispatched',
      label: `${unit.ref} offered${chosen ? ` — recommendation ${chosen.rank} of ${recs.length}` : ' — manual choice'}`
        + `${rationale.override ? ` (override: ${rationale.override.reason})` : ''} · ${who}`,
      actorKind: actor.kind, actorId: actor.ref, agencyCode: unit.agency_code,
      detail: { assignmentRef: asgRef, unitRef: unit.ref, rank: chosen?.rank ?? null, arrivalSec: arrival, override: rationale.override, redispatch },
    })];
    for (const n of notified) {
      const reasons = corr.value.recommendedAgencies.find((a) => a.code === n.code)?.reasons ?? [];
      timeline.push(await incidents.insertTimeline(c, inc.id, {
        ts: at, stage: 'agency_notified', label: `${n.code.replace('_', ' ')} notified — acknowledge within ${n.slaSec} s`,
        actorKind: 'system', actorId: 'SYSTEM', agencyCode: n.code, detail: { reasons, slaSec: n.slaSec },
      }));
    }

    return { asgRef, unitRow, state, timeline, notified, incidentId: inc.id };
  });

  await audit({
    action: redispatch ? 'incident.redispatch' : 'incident.dispatch', entity: 'incident', entityId: ref,
    actor: auditActor(actor),
    payload: { assignment: out.asgRef, unit: unitRef, rank: chosen?.rank ?? null, override: rationale.override, notified: out.notified.map((n) => n.code) },
  });

  const [asgRow, summary] = await Promise.all([
    fleet.assignmentByRef(pool, out.asgRef),
    incidents.incidentSummary(pool, ref),
  ]);
  const assignment = shapeAssignmentWithActions(asgRow);

  fanout.assignmentOffer(unitRef, {
    assignment,
    incident: summary,
    route: null,      // follows as assignment:update once the geometry arrives
    entrance: summary.building ? { makani: summary.makani, ...summary.building, lng: summary.lng, lat: summary.lat } : null,
    acknowledgeBy: new Date(now + D.acknowledgeTimeoutSec * 1000).toISOString(),
  });
  fanout.assignmentUpdate({ incidentRef: ref, unitRef, ref: out.asgRef, state: 'offered', at });
  fanout.incidentUpdate(summary);
  fanout.incidentTimeline(ref, out.timeline);
  fanout.unitStatus(out.unitRow);
  for (const n of out.notified) {
    fanout.agencyNotified(n.code, { incidentRef: ref, agency: n.code, at, slaSec: n.slaSec });
  }
  scheduleKpiTick();

  attachRouteGeometry(out.asgRef, [unit0.lng, unit0.lat], [inc0.lng, inc0.lat])
    .catch((err) => logger.warn({ err: err.message, assignment: out.asgRef }, '[dispatch] route geometry not attached'));

  return { assignment, incident: summary };
}

function withSaving(baseline, chosenArrivalSec) {
  if (!baseline || chosenArrivalSec == null) return baseline;
  return { ...baseline, chosenArrivalSec, savedSec: Math.max(0, Math.round(baseline.arrivalSec - chosenArrivalSec)) };
}

function nearestByDistance(recs) {
  const nearest = [...recs].filter((r) => r.straightM != null && r.arrivalSec != null)
    .sort((a, b) => a.straightM - b.straightM)[0];
  return nearest ? { unitRef: nearest.unitRef, straightM: nearest.straightM, arrivalSec: nearest.arrivalSec } : null;
}

/**
 * The proposed route's geometry, fetched after the dispatch has committed with a patient
 * timeout. The map draws it when it arrives; if routing is down it is simply absent — a
 * straight line is never stored as if it were the road route.
 */
export async function attachRouteGeometry(asgRef, from, to) {
  const road = await osrm.route(from, to, { timeoutMs: osrm.BACKGROUND_TIMEOUT_MS, attempts: 3 });
  if (!road?.coordinates || road.coordinates.length < 2) return false;
  const { rowCount } = await pool.query(
    `UPDATE assignments SET route_proposed = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)
      WHERE ref = $1 AND route_proposed IS NULL`,
    [asgRef, JSON.stringify({ type: 'LineString', coordinates: road.coordinates })],
  );
  if (!rowCount) return false;
  const row = await fleet.assignmentByRef(pool, asgRef);
  fanout.assignmentUpdate({ incidentRef: row.incident_ref, unitRef: row.unit_ref, ref: asgRef, state: row.state, at: nowIso() });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Transitions
// ═══════════════════════════════════════════════════════════════════════════════

function authorise(action, asg, actor) {
  const def = ASSIGNMENT_ACTIONS[action];
  if (!def) throw validation({ action: [`Unknown action "${action}"`] });
  if (def.who === 'system') {
    if (actor.kind !== 'system') throw forbidden('Only the system times an offer out');
    return;
  }
  if (actor.kind === 'system') return;
  if (actor.kind === 'unit') {
    if (def.who !== 'unit') throw forbidden('A crew cannot stand itself down — ask the dispatcher');
    if (asg.unit_id !== actor.unitId) throw forbidden('This assignment belongs to another unit');
    return;
  }
  if (actor.kind === 'dispatcher' && can(actor.role, 'operations.dispatch')) return;
  throw forbidden(`Role "${actor.role}" cannot act on assignments`);
}

function transitionLabel(action, a, { body, hospital, stampedFrom, vrtSec, timeoutSec }) {
  const u = a.unit_ref;
  switch (action) {
    case 'acknowledge':  return `${u} acknowledged`;
    case 'decline':      return `${u} declined — ${body.reason}`;
    case 'timeout':      return `${u} did not acknowledge within ${timeoutSec} s`;
    case 'enroute':      return `${u} en route`;
    case 'onscene':      return `${u} on scene at the entrance${stampedFrom === 'position' ? ' (stamped from its position fix)' : ''}`;
    case 'at_patient':   return `${u} crew with the patient — vertical access ${mmss(vrtSec)}`;
    case 'transporting': return `${u} transporting to ${hospital.name}`;
    case 'resolve':      return `${u} treated on scene — no transport`;
    case 'at_hospital':  return `${u} arrived at ${a.hospital_name ?? 'hospital'}`;
    case 'clear':        return `${u} cleared`;
    case 'cancel':       return `${u} stood down — ${body.reason}`;
    default:             return `${u} ${action}`;
  }
}

/**
 * Move an assignment through its lifecycle.
 *
 * Server-stamped, always. "On scene" in particular is stamped from the unit's first
 * position fix inside the arrival radius when it reported one — the crew says "I have
 * arrived"; the server decides when that was (docs/04 §4).
 *
 * @param {string} asgRef
 * @param {keyof typeof ASSIGNMENT_ACTIONS} action
 * @param {object} body
 * @param {object} actor
 */
export async function transition(asgRef, action, body, actor) {
  const pre = await fleet.assignmentByRef(pool, asgRef);
  if (!pre) throw notFound('Assignment');
  authorise(action, pre, actor);
  if (actor.kind === 'dispatcher') await loadIncident(pre.incident_ref, actor);   // scope

  let hospital = null;
  if (action === 'transporting') {
    hospital = await fleet.hospitalByRef(pool, body.hospitalRef);
    if (!hospital) throw validation({ hospitalRef: ['No such hospital'] });
  }
  const incPre = await incidents.incidentRow(pool, pre.incident_ref);
  const vrtPrediction = action === 'at_patient' ? await eta.vrtFor(body.floor ?? incPre.floor) : null;

  const def = ASSIGNMENT_ACTIONS[action];
  const at = nowIso();

  const out = await transaction(async (c) => {
    const a = await fleet.assignmentByRef(c, asgRef, { forUpdate: true });
    const err = transitionError(action, a, body, { canTransport: canTransport(a.unit_kind), unitKind: a.unit_kind });
    if (err) throw conflict(err);
    const inc = await incidents.incidentRow(c, a.incident_ref, { forUpdate: true });
    if (inc.state === 'closed' && action !== 'clear') throw conflict(`${inc.ref} is closed`);

    const patch = { state: def.to };
    if (def.stamp) patch[def.stamp] = at;
    let stampedFrom = 'server_clock';
    let vrtSec = null;
    let geom = {};

    switch (action) {
      case 'decline':
        patch.decline_reason = body.reason.trim();
        patch.is_primary = false;
        break;
      case 'timeout':
      case 'cancel':
        patch.is_primary = false;
        break;
      case 'onscene': {
        const fix = await fleet.firstFixNear(c, a.unit_id, new Date(a.enroute_at).toISOString(), inc.lng, inc.lat, D.onsceneProximityM);
        if (fix && fix < at) { patch.onscene_at = fix; stampedFrom = 'position'; }
        patch.route_taken_sec = Math.round((Date.parse(patch.onscene_at) - new Date(a.enroute_at).getTime()) / 1000);
        geom = { lng: inc.lng, lat: inc.lat };
        break;
      }
      case 'at_patient':
        vrtSec = Math.round((Date.parse(at) - new Date(a.onscene_at).getTime()) / 1000);
        patch.vrt_sec = vrtSec;
        patch.vrt_breakdown = {
          floor: body.floor ?? inc.floor ?? null,
          liftUsed: body.liftUsed ?? null,
          predictedSec: vrtPrediction?.value?.seconds ?? null,
          predictionMethod: vrtPrediction?.method ?? null,
        };
        break;
      case 'transporting':
        patch.hospital_id = hospital.id;
        break;
      case 'at_hospital': {
        const h = a.hospital_ref ? await fleet.hospitalByRef(c, a.hospital_ref) : null;
        if (h) geom = { lng: h.lng, lat: h.lat };
        break;
      }
      default:
        break;
    }

    await fleet.updateAssignment(c, a.id, patch);
    if (action === 'onscene') await fleet.storeRouteTaken(c, a.id, a.unit_id, new Date(a.enroute_at).toISOString(), patch.onscene_at);

    const unitRow = await fleet.setUnitStatus(c, a.unit_id, def.unitStatus, { at, ...geom });
    const { state } = inc.state === 'closed' ? { state: 'closed' } : await syncIncident(c, inc);

    const logged = actor.kind === 'dispatcher' && def.who === 'unit' ? ` · logged by ${actor.ref}` : '';
    const row = await incidents.insertTimeline(c, inc.id, {
      ts: patch[def.stamp] ?? at,
      stage: def.stage,
      label: transitionLabel(action, a, { body, hospital, stampedFrom, vrtSec, timeoutSec: D.acknowledgeTimeoutSec }) + logged,
      actorKind: actor.kind, actorId: actor.ref, agencyCode: a.agency_code,
      detail: {
        assignmentRef: a.ref, unitRef: a.unit_ref, stampedFrom,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(hospital ? { hospitalRef: hospital.ref } : {}),
        ...(vrtSec !== null ? { vrtSec, predictedSec: patch.vrt_breakdown.predictedSec } : {}),
      },
    });

    return { a, unitRow, state, row, stampedAt: patch[def.stamp] ?? at };
  });

  await audit({
    action: `assignment.${action}`, entity: 'assignment', entityId: asgRef, actor: auditActor(actor),
    payload: { incident: out.a.incident_ref, unit: out.a.unit_ref, at: out.stampedAt, ...(body.reason ? { reason: body.reason } : {}) },
  });

  const [asgRow, summary] = await Promise.all([
    fleet.assignmentByRef(pool, asgRef),
    incidents.incidentSummary(pool, out.a.incident_ref),
  ]);
  const assignment = shapeAssignmentWithActions(asgRow);

  fanout.assignmentUpdate({ incidentRef: summary.ref, unitRef: out.a.unit_ref, ref: asgRef, state: asgRow.state, at: out.stampedAt });
  fanout.incidentUpdate(summary);
  fanout.incidentTimeline(summary.ref, out.row);
  fanout.unitStatus(out.unitRow);
  scheduleKpiTick();

  if (action === 'decline' || action === 'timeout') {
    // Not awaited by the caller's response: the crew's decline is recorded whether or not
    // a replacement is found, and the replacement announces itself over the socket.
    redispatchAfterFailure(summary.ref, asgRef, action).catch((err) =>
      logger.error({ err, incident: summary.ref }, '[dispatch] automatic re-dispatch failed'));
  }

  return { assignment, incident: summary };
}

/**
 * After a decline or a timeout: offer the next unit automatically, excluding every unit
 * already tried — up to `maxAutoRedispatch` times. Then stop, and tell a person.
 */
export async function redispatchAfterFailure(incRef, failedAsgRef, reason) {
  const inc = await incidents.incidentRow(pool, incRef);
  if (!inc || inc.state === 'closed') return null;

  const history = await fleet.failedOffersFor(pool, inc.id);
  if (history.some((h) => ACTIVE_ASSIGNMENT_STATES.has(h.state))) return null;   // someone is still on it
  const failed = history.filter((h) => h.state === 'declined' || h.state === 'timed_out');

  const escalate = async (stage, label) => {
    const at = nowIso();
    const row = await transaction((c) => incidents.insertTimeline(c, inc.id, {
      ts: at, stage, label, actorKind: 'system', actorId: 'SYSTEM', detail: { failedOffers: failed.length },
    }));
    const summary = await incidents.incidentSummary(pool, incRef);
    fanout.incidentTimeline(incRef, row);
    fanout.incidentUpdate(summary);
    fanout.notify([`console:all`, summary.zoneRef && `zone:${summary.zoneRef}`], {
      level: 'danger', title: `${incRef} needs a dispatcher`, body: label, link: incRef,
    });
    return null;
  };

  if (failed.length > D.maxAutoRedispatch) {
    return escalate('redispatch_exhausted',
      `No acknowledgement after ${failed.length} offers — automatic re-dispatch stopped; dispatcher action required`);
  }

  const exclude = [...new Set(history.map((h) => h.unit_ref))];
  const rec = await recommendFor(inc, { excludeRefs: exclude });
  const top = rec.value?.recommendations?.[0];
  if (!top) return escalate('redispatch_failed', 'Automatic re-dispatch found no qualifying unit');

  try {
    return await commitDispatch(incRef, {
      unitRef: top.unitRef, excludeRefs: exclude,
      redispatch: { after: failedAsgRef, reason, attempt: failed.length },
    }, SYSTEM);
  } catch (err) {
    if (err instanceof AppError && err.status === 409) {
      return escalate('redispatch_failed', `Automatic re-dispatch to ${top.unitRef} failed: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Stand down every pre-arrival assignment on an incident, inside the caller's
 * transaction. Used by close. Returns what to announce after commit.
 */
export async function standDownPreArrival(client, incRow, reason, actor, at) {
  const rows = await fleet.assignmentsForIncident(client, incRow.id);
  const announced = [];
  for (const a of rows.filter((x) => PRE_ARRIVAL_STATES.has(x.state))) {
    await fleet.updateAssignment(client, a.id, { state: 'cancelled', is_primary: false });
    const unitRow = await fleet.setUnitStatus(client, a.unit_id, 'available');
    const row = await incidents.insertTimeline(client, incRow.id, {
      ts: at, stage: 'unit_stood_down', label: `${a.unit_ref} stood down — ${reason}`,
      actorKind: actor.kind, actorId: actor.ref, agencyCode: a.agency_code, detail: { assignmentRef: a.ref, reason },
    });
    announced.push({ a, unitRow, row });
  }
  return announced;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  The acknowledge-timeout sweep
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Every two seconds, time out offers older than the acknowledge window. The cutoff is
 * the DOMAIN clock, so a paused scenario pauses its timeouts and a 4× scenario times out
 * four times as fast. Polling the database rather than holding timers means a server
 * restart (node --watch restarts on every edit) loses nothing.
 */
export function startAckTimeoutSweep() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const cutoff = new Date(nowMs() - D.acknowledgeTimeoutSec * 1000).toISOString();
      for (const ref of await fleet.expiredOffers(pool, cutoff)) {
        try {
          await transition(ref, 'timeout', {}, SYSTEM);
        } catch (err) {
          // Acknowledged in the same instant: the crew won the race, which is correct.
          if (!(err instanceof AppError && err.status === 409)) logger.error({ err, ref }, '[dispatch] timeout failed');
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[dispatch] timeout sweep skipped');
    } finally {
      running = false;
    }
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Hospital recommendation (5.6)
// ═══════════════════════════════════════════════════════════════════════════════

export async function hospitalRecommendation(ref, actor) {
  const inc = await loadIncident(ref, actor);
  const hospitals = await fleet.hospitalsForRanking(pool);
  const transports = await eta.travelFromOne(
    [inc.lng, inc.lat], hospitals.map((h) => [h.lng, h.lat]), { zoneClass: inc.zone_class ?? 'urban' },
  );
  const cal = await eta.calibration();
  return rankHospitals({
    // The PoC's fleet and incidents are all inside one small catchment (config/poc.js) —
    // a clinical-capability requirement (trauma_l1 for a P1/P2 RTA, which is every
    // incident this trial raises) can route clear across Dubai to the one hospital with
    // that capability. That reads as "taking the patient too far" in a trial the client
    // agreed would stay local; the full product still applies the real requirement.
    incident: { ref: inc.ref, kind: poc.enabled ? null : inc.kind, priority: inc.priority },
    hospitals: hospitals.map((h, i) => ({
      ref: h.ref, name: h.name, capabilities: h.capabilities, edBeds: h.ed_beds, edOccupied: h.ed_occupied,
      onDiversion: h.on_diversion, inbound: h.inbound, transport: transports[i],
    })),
    window: cal.window,
  });
}
