/**
 * The detail behind the dashboard's cards — what opens in the right-hand panel.
 *
 *   autoDispatchReport()   the Automatic dispatch card, in full: the rules in force and why,
 *                          today's decisions and what they saved, what the fleet will look
 *                          like in the next quarter hour, the demand history says to expect,
 *                          and the AI's advisory drawn from all of that.
 *   unitDetail(ref)        one ambulance: vehicle, crew (demo roster), live telemetry, the
 *                          job it is on, and its day so far.
 *
 * Every number is a query against what happened. The two forward-looking figures are
 * labelled as what they are: the fleet outlook is each busy crew's elapsed stage against
 * the median length of that stage over recent jobs, and the demand figure is the
 * catchment's own history for this hour of the week.
 */

import { pool, one } from '../lib/db.js';
import { nowIso } from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { pocFleet, pocFleetSize } from '../config/poc.js';
import { profileFor } from '../data/reference/crews.js';
import * as fleet from '../repos/fleet.js';
import { describeRules } from './dispatchRules.js';
import { gstMidnightIso } from './eta.js';

const ACTIVE = ['offered', 'acknowledged', 'enroute', 'onscene', 'transporting', 'at_hospital', 'resolved_on_scene'];
const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The trial catchment, Silicon Oasis to Al Rashidiya (sim/roadSites.js), with a margin. */
const CATCHMENT = { west: 55.31, south: 25.09, east: 55.45, north: 25.25 };

// ── Automatic dispatch ───────────────────────────────────────────────────────

/**
 * Median minutes from the START of each stage to the crew clearing, over recent completed
 * jobs of the trial fleet. What the fleet outlook compares each busy crew against.
 */
async function stageToClear() {
  const { rows } = await pool.query(`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.cleared_at - a.enroute_at)) FILTER (WHERE a.enroute_at IS NOT NULL) AS enroute,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.cleared_at - a.onscene_at)) FILTER (WHERE a.onscene_at IS NOT NULL) AS onscene,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.cleared_at - a.transporting_at)) FILTER (WHERE a.transporting_at IS NOT NULL) AS transporting,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM a.cleared_at - a.at_hospital_at)) FILTER (WHERE a.at_hospital_at IS NOT NULL) AS at_hospital,
           COUNT(*)::int AS n
      FROM assignments a JOIN units u ON u.id = a.unit_id
     WHERE a.cleared_at IS NOT NULL AND a.offered_at >= now() - interval '3 days'
       AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))`, [pocFleet()]);
  const r = rows[0] ?? {};
  return {
    n: r.n ?? 0,
    offered: r.enroute != null ? Number(r.enroute) + 60 : null,
    acknowledged: r.enroute != null ? Number(r.enroute) + 40 : null,
    enroute: r.enroute != null ? Number(r.enroute) : null,
    onscene: r.onscene != null ? Number(r.onscene) : null,
    transporting: r.transporting != null ? Number(r.transporting) : null,
    at_hospital: r.at_hospital != null ? Number(r.at_hospital) : null,
    resolved_on_scene: 90,
  };
}

async function fleetOutlook() {
  const [{ rows }, medians] = await Promise.all([
    pool.query(`
      SELECT u.ref, u.callsign, u.kind, u.status, ST_X(u.current_geom) AS lng, ST_Y(u.current_geom) AS lat,
             a.state, i.ref AS incident_ref, i.priority,
             COALESCE(a.at_hospital_at, a.transporting_at, a.onscene_at, a.enroute_at, a.acknowledged_at, a.offered_at) AS stage_at
        FROM units u JOIN agencies ag ON ag.id = u.agency_id
        LEFT JOIN LATERAL (
          SELECT x.* FROM assignments x WHERE x.unit_id = u.id AND x.state = ANY($2) ORDER BY x.offered_at DESC LIMIT 1
        ) a ON TRUE
        LEFT JOIN incidents i ON i.id = a.incident_id
       WHERE ag.code = 'DCAS' AND u.archived_at IS NULL AND ($1::text[] IS NULL OR u.ref = ANY($1::text[]))
       ORDER BY u.callsign`, [pocFleet(), ACTIVE]),
    stageToClear(),
  ]);
  const now = Date.now();
  const units = rows.map((r) => {
    const free = r.status === 'available' || r.status === 'standby';
    const stageMed = r.state ? medians[r.state] ?? null : null;
    const elapsed = r.stage_at ? (now - new Date(r.stage_at).getTime()) / 1000 : 0;
    const freeInSec = free ? 0 : stageMed != null ? Math.max(60, Math.round(stageMed - elapsed)) : null;
    return {
      ref: r.ref, callsign: r.callsign, kind: r.kind, status: r.status, free,
      state: r.state, incidentRef: r.incident_ref, priority: r.priority,
      position: r.lng != null ? [r.lng, r.lat] : null, freeInSec,
    };
  });
  const within = (sec) => units.filter((u) => u.free || (u.freeInSec != null && u.freeInSec <= sec)).length;
  return {
    units,
    freeNow: units.filter((u) => u.free).length,
    freeIn10: within(600),
    freeIn20: within(1200),
    basis: medians.n >= 5
      ? `each busy crew's time in its current stage against the median of ${medians.n} jobs this fleet finished in the last 3 days`
      : 'too few finished jobs in the last 3 days to estimate — shown as unknown',
  };
}

/** Road collisions history puts in the catchment for this hour of the week. */
async function demandNextHour() {
  const r = await one(`
    SELECT COUNT(*)::float / 8 AS per_hour, COUNT(*)::int AS n
      FROM incidents
     WHERE is_seed AND kind = 'rta'
       AND reported_at >= now() - interval '56 days'
       AND EXTRACT(ISODOW FROM reported_at AT TIME ZONE 'Asia/Dubai') = EXTRACT(ISODOW FROM now() AT TIME ZONE 'Asia/Dubai')
       AND EXTRACT(HOUR FROM reported_at AT TIME ZONE 'Asia/Dubai') = EXTRACT(HOUR FROM (now() + interval '1 hour') AT TIME ZONE 'Asia/Dubai')
       AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)`,
  [CATCHMENT.west, CATCHMENT.south, CATCHMENT.east, CATCHMENT.north]).catch(() => null);
  if (!r) return null;
  return {
    perHour: Math.round(r.per_hour * 10) / 10,
    samples: r.n,
    basis: 'road collisions recorded in the trial catchment in the same hour, same weekday, over the last 8 weeks',
  };
}

/** Today's automatic decisions, newest first, with what each saved. */
async function decisionsToday() {
  const { rows } = await pool.query(`
    SELECT a.ref, a.offered_at, a.onscene_at, a.eta_predicted_at, a.eta_error_sec, a.dispatch_rationale AS r,
           u.callsign, u.ref AS unit_ref, i.ref AS incident_ref, i.priority, i.kind, i.reported_at, z.name AS zone_name,
           EXISTS (SELECT 1 FROM incident_timeline t WHERE t.incident_id = i.id AND t.actor_id = 'AI-DISPATCH'
                     AND t.detail->>'assignmentRef' = a.ref) AS by_ai
      FROM assignments a JOIN units u ON u.id = a.unit_id JOIN incidents i ON i.id = a.incident_id
      LEFT JOIN zones z ON z.id = i.zone_id
     WHERE a.offered_at >= $1 AND NOT i.is_seed
       AND ($2::text[] IS NULL OR u.ref = ANY($2::text[]))
     ORDER BY a.offered_at DESC LIMIT 60`, [gstMidnightIso(Date.now()), pocFleet()]);
  return rows.map((x) => ({
    assignmentRef: x.ref, incidentRef: x.incident_ref, priority: x.priority, kind: x.kind, zoneName: x.zone_name,
    unitRef: x.unit_ref, callsign: x.callsign, byAi: x.by_ai,
    rank: x.r?.selected?.rank ?? null, of: x.r?.selected?.of ?? null,
    decisionSec: Math.max(0, Math.round((new Date(x.offered_at) - new Date(x.reported_at)) / 1000)),
    responseSec: x.onscene_at ? Math.round((new Date(x.onscene_at) - new Date(x.reported_at)) / 1000) : null,
    savedSec: x.r?.baseline?.savedSec ?? 0,
    nearest: x.r?.baseline?.unitRef ?? null,
    etaErrorSec: x.eta_error_sec,
    trafficApplied: Boolean(x.r?.policy?.trafficApplied),
    override: x.r?.override ?? null,
    offeredAt: new Date(x.offered_at).toISOString(),
  }));
}

export async function autoDispatchReport() {
  const [rules, outlook, demand, decisions] = await Promise.all([describeRules(), fleetOutlook(), demandNextHour(), decisionsToday()]);
  const ai = decisions.filter((d) => d.byAi);
  const stats = {
    dispatches: ai.length,
    medianDecisionSec: median(ai.map((d) => d.decisionSec)),
    medianResponseSec: median(ai.map((d) => d.responseSec)),
    savedSec: ai.reduce((s, d) => s + (d.savedSec ?? 0), 0),
    fasterThanNearest: ai.filter((d) => d.savedSec > 0).length,
    medianAbsEtaErrorSec: median(ai.filter((d) => d.etaErrorSec != null).map((d) => Math.abs(d.etaErrorSec))),
    overrides: decisions.filter((d) => d.override).length,
    manual: decisions.filter((d) => !d.byAi).length,
  };

  // The advisory: what a duty officer should know about the automatic dispatcher right now.
  const findings = [];
  const total = outlook.units.length || pocFleetSize();
  if (outlook.freeNow <= 1) {
    findings.push({ severity: 'high', title: `${outlook.freeNow} of ${total} ambulances free`, detail: outlook.freeIn10 > outlook.freeNow
      ? `${outlook.freeIn10 - outlook.freeNow} more expected free within 10 min. A P1 now would wait for the nearest crew to clear.`
      : 'No crew is expected to clear in the next 10 minutes. Consider support from outside the trial fleet.' });
  } else if (outlook.freeNow <= 3) {
    findings.push({ severity: 'medium', title: `${outlook.freeNow} of ${total} ambulances free`, detail: `Coverage is thinning; the AI is weighting coverage higher so the last free crew in an area is kept for it.` });
  }
  const soonest = outlook.units.filter((u) => !u.free && u.freeInSec != null).sort((a, b) => a.freeInSec - b.freeInSec)[0];
  const STATE_WORD = { offered: 'being offered a job', acknowledged: 'turning out', enroute: 'driving to a patient', onscene: 'on scene', transporting: 'transporting a patient', at_hospital: 'handing over at hospital', resolved_on_scene: 'finishing on scene' };
  if (soonest) findings.push({ severity: 'info', title: `${soonest.callsign} expected free in ~${Math.max(1, Math.round(soonest.freeInSec / 60))} min`, detail: `Currently ${STATE_WORD[soonest.state] ?? String(soonest.state).replace(/_/g, ' ')} (${soonest.incidentRef}).` });
  // Expected demand is a prediction (shown under Predictions); it is advice only when it
  // is more than the free crews can take.
  if (demand && demand.perHour > Math.max(1, outlook.freeNow)) {
    findings.push({ severity: 'medium', title: `~${demand.perHour} road collisions expected next hour — more than the ${outlook.freeNow} free crews`, detail: `From ${demand.basis}. Expect queueing unless crews clear quickly.` });
  }
  if (stats.dispatches >= 3 && stats.savedSec > 0) {
    findings.push({ severity: 'good', title: `${mmss(stats.savedSec)} min saved today`, detail: `${stats.fasterThanNearest} of ${stats.dispatches} automatic dispatches sent a faster crew than the nearest one.` });
  }
  if (stats.medianAbsEtaErrorSec != null && stats.medianAbsEtaErrorSec > 60) {
    findings.push({ severity: 'medium', title: `Arrival predictions off by ${mmss(stats.medianAbsEtaErrorSec)} min (median)`, detail: 'Worth checking before trusting the countdowns on a long response.' });
  }
  if (rules.mode === 'custom') {
    findings.push({ severity: 'info', title: 'Custom rules in force', detail: `Set by ${rules.updatedBy ?? 'a duty officer'}. The AI's own adaptation (coverage weighting under pressure) is paused until the rules are handed back.` });
  }

  return { at: nowIso(), rules, outlook, demand, stats, decisions: decisions.slice(0, 12), findings };
}

// ── One ambulance ─────────────────────────────────────────────────────────────

export async function unitDetail(ref, liveFor) {
  const roster = pocFleet();
  if (roster && !roster.includes(ref)) throw notFound('Unit');
  const unit = await fleet.unitByRef(pool, ref);
  if (!unit) throw notFound('Unit');

  const [station, job, today] = await Promise.all([
    one(`SELECT s.name, s.ref FROM stations s JOIN units u ON u.home_station_id = s.id WHERE u.ref = $1`, [ref]),
    unit.currentAssignmentRef ? one(`
      SELECT a.ref, a.state, a.offered_at, a.enroute_at, a.onscene_at, a.eta_predicted_at, a.route_proposed_m,
             i.ref AS incident_ref, i.kind, i.priority, i.reported_at, z.name AS zone_name, h.name AS hospital_name
        FROM assignments a JOIN incidents i ON i.id = a.incident_id LEFT JOIN zones z ON z.id = i.zone_id
        LEFT JOIN hospitals h ON h.id = a.hospital_id WHERE a.ref = $1`, [unit.currentAssignmentRef]) : null,
    pool.query(`
      SELECT a.ref, a.state, a.offered_at, a.onscene_at, a.cleared_at, a.route_taken_m, a.route_hospital_m,
             i.ref AS incident_ref, i.kind, i.priority, i.reported_at, z.name AS zone_name
        FROM assignments a JOIN units u ON u.id = a.unit_id JOIN incidents i ON i.id = a.incident_id
        LEFT JOIN zones z ON z.id = i.zone_id
       WHERE u.ref = $1 AND a.offered_at >= $2 AND NOT i.is_seed
       ORDER BY a.offered_at DESC LIMIT 20`, [ref, gstMidnightIso(Date.now())]),
  ]);

  const jobs = today.rows;
  const responses = jobs.filter((j) => j.onscene_at).map((j) => (new Date(j.onscene_at) - new Date(j.reported_at)) / 1000);
  const busySec = jobs.reduce((s, j) => s + ((j.cleared_at ? new Date(j.cleared_at) : new Date()) - new Date(j.offered_at)) / 1000, 0);
  const shiftSec = unit.shiftStart ? Math.max(1, (Date.now() - Date.parse(unit.shiftStart)) / 1000) : null;
  const live = job ? liveFor?.(job.ref) ?? null : null;
  const lights = ['assigned', 'responding', 'transporting'].includes(unit.status);

  return {
    at: nowIso(),
    unit: { ...unit, stationName: station?.name ?? null },
    profile: profileFor(ref, unit.kind),
    telemetry: {
      speedKmh: live?.speedKmh ?? (unit.speed != null ? Math.round(Number(unit.speed)) : 0),
      heading: unit.heading != null ? Math.round(Number(unit.heading)) : null,
      lightsAndSiren: lights,
      lastFixSecAgo: unit.lastSeenAt ? Math.max(0, Math.round((Date.now() - Date.parse(unit.lastSeenAt)) / 1000)) : null,
      position: unit.lng != null ? [unit.lng, unit.lat] : null,
    },
    job: job ? {
      assignmentRef: job.ref, state: job.state, incidentRef: job.incident_ref, kind: job.kind, priority: job.priority,
      zoneName: job.zone_name, hospitalName: job.hospital_name,
      reportedAt: new Date(job.reported_at).toISOString(),
      etaPredictedAt: job.eta_predicted_at ? new Date(job.eta_predicted_at).toISOString() : null,
      remainingM: live?.remainingM ?? null,
      trafficAhead: live?.trafficAhead ?? [],
    } : null,
    today: {
      jobs: jobs.length,
      completed: jobs.filter((j) => j.cleared_at).length,
      medianResponseSec: median(responses),
      distanceKm: Math.round(jobs.reduce((s, j) => s + (j.route_taken_m ?? 0) + (j.route_hospital_m ?? 0), 0) / 100) / 10,
      busyPct: shiftSec ? Math.min(100, Math.round((busySec / shiftSec) * 100)) : null,
      onShiftSec: shiftSec ? Math.round(shiftSec) : null,
      recent: jobs.slice(0, 5).map((j) => ({
        assignmentRef: j.ref, incidentRef: j.incident_ref, kind: j.kind, priority: j.priority, zoneName: j.zone_name,
        state: j.state, offeredAt: new Date(j.offered_at).toISOString(),
        responseSec: j.onscene_at ? Math.round((new Date(j.onscene_at) - new Date(j.reported_at)) / 1000) : null,
      })),
    },
  };
}
