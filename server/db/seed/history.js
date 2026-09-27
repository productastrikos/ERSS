/**
 * 24 months of operational history.
 *
 * THE KEY DESIGN DECISION: this does not sample a response time from a distribution.
 * It simulates the actual dispatch — fleet state is carried forward through the
 * timeline, so a unit on a job is genuinely unavailable for the next one, and the seven
 * stage timestamps are internally consistent. The analytics then measure something
 * real, rather than reproducing the distribution they were handed.
 *
 * Calibration (docs/09 §2.2, from ambulance.gov.ae open data):
 *   2024 actual — 198,540 emergency calls, mean response 6.59 min
 *   Critical-call median ≈9.0 min (PAROS) — hence log-normal, not normal
 *   1.04–1.06 patient contacts per dispatch
 *   64% male patients
 */

import { pool, query, one, transaction } from '../../lib/db.js';
import { jurisdiction } from '../../config/jurisdiction.js';
import { createRng } from './rng.js';
import { haversineM, randomInCircle } from './geo.js';
import { COMMUNITIES } from '../../data/reference/communities.js';
import { CASE_MIX, CHIEF_COMPLAINTS, CAPABILITY_REQUIREMENTS } from '../../data/reference/fleet.js';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Diurnal shape — bimodal, peaks 08–10 and 17–21, trough 03–05. */
const DIURNAL = [
  0.42, 0.34, 0.29, 0.26, 0.28, 0.38, 0.62, 0.92,   // 00–07
  1.28, 1.34, 1.22, 1.14, 1.10, 1.08, 1.06, 1.12,   // 08–15
  1.24, 1.42, 1.48, 1.40, 1.30, 1.10, 0.84, 0.58,   // 16–23
];

/** Friday and Saturday are Dubai's weekend — a different shape, not a Western one. */
const WEEKDAY = [1.02, 1.06, 1.05, 1.04, 0.96, 0.88, 0.95];  // Sun..Sat

export async function seedHistory({ rngSeed, months, log }) {
  const rng = createRng(`${rngSeed}:history`);
  const reference = await loadHistoryReference();

  // Seeded history is regenerated wholesale. Clearing first keeps the seed idempotent
  // and stops a re-run from doubling the analytics.
  const existing = await one(`SELECT COUNT(*)::int n FROM incidents WHERE is_seed`);
  if (existing?.n > 0) {
    log(`  clearing      ${existing.n.toLocaleString('en-GB')} previously seeded incidents`);
    await query(`DELETE FROM telemetry t USING patients p, incidents i
                  WHERE t.patient_id = p.id AND p.incident_id = i.id AND i.is_seed`);
    await query(`DELETE FROM patients p USING incidents i WHERE p.incident_id = i.id AND i.is_seed`);
    await query(`DELETE FROM assignments a USING incidents i WHERE a.incident_id = i.id AND i.is_seed`);
    await query(`DELETE FROM incidents WHERE is_seed`);
  }

  const end = new Date(); end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - months * 30.44 * DAY_MS);
  const totalDays = (end - start) / DAY_MS;
  log(`  target        ${Math.round(PER_DAY * totalDays).toLocaleString('en-GB')} incidents over ${Math.round(totalDays)} days`);

  const out = generateHistory({
    ...reference, rng, start: start.getTime(), end: end.getTime(),
    refFor: (ts, seq) => `INC-${fmtDate(ts)}-${String(seq % 10000).padStart(4, '0')}`,
  });
  log(`  generated     ${out.incidents.length.toLocaleString('en-GB')} incidents in memory`);
  await bulkLoad({ ...out, log });
  return { incidents: out.incidents.length, assignments: out.assignments.length };
}

/**
 * Carry the seeded history forward to NOW, without touching what is already there.
 *
 * History ends when `npm run seed` last ran, so on every later day the "today" figures —
 * calls, median response, within-target — read zero until something happens live, and a
 * dashboard opens looking dead. This fills the gap with the same generator, the same
 * fleet-carried simulation and the same calibration, numbering each day's references on
 * from whatever that day already holds. Only incidents that have FINISHED by now are
 * written: anything still in progress belongs to the live picture, not to history.
 * Run at server start (index.js) and by `npm run seed:catchup`.
 */
export async function extendHistory({ rngSeed, log = () => {}, until = Date.now() }) {
  const last = await one(`SELECT max(reported_at) AS mx FROM incidents WHERE is_seed`);
  if (!last?.mx) return { incidents: 0, skipped: 'no seeded history to extend' };
  const startMs = Math.ceil(new Date(last.mx).getTime() / HOUR_MS) * HOUR_MS;
  if (until - startMs < HOUR_MS / 2) return { incidents: 0, skipped: 'history is current' };

  const reference = await loadHistoryReference();
  const rng = createRng(`${rngSeed}:catchup:${startMs}`);

  // Live references are numbered per GST calendar day (repos/incidents.js nextIncidentRef);
  // continue each day's sequence rather than colliding with it.
  const counters = new Map();
  for (let d = startMs; d <= until + DAY_MS; d += DAY_MS) {
    const prefix = `INC-${fmtDate(d + GST_OFFSET_MS)}-`;
    if (counters.has(prefix)) continue;
    const row = await one(
      `SELECT COALESCE(MAX(NULLIF(substring(ref FROM 12), '')::int), 0) AS n
         FROM incidents WHERE ref LIKE $1 AND substring(ref FROM 12) ~ '^[0-9]+$'`,
      [`${prefix}%`],
    );
    counters.set(prefix, row?.n ?? 0);
  }
  const refFor = (ts) => {
    const prefix = `INC-${fmtDate(ts + GST_OFFSET_MS)}-`;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}${String(n).padStart(4, '0')}`;
  };

  const out = generateHistory({ ...reference, rng, start: startMs, end: until, refFor, finishedBy: until });
  if (!out.incidents.length) return { incidents: 0, skipped: 'nothing finished in the gap' };
  await bulkLoad({ ...out, log });
  log(`  catch-up      ${out.incidents.length} incidents from ${new Date(startMs).toISOString()} to now`);
  return { incidents: out.incidents.length, from: new Date(startMs).toISOString() };
}

const GST_OFFSET_MS = 4 * HOUR_MS;

/** Target volume, extrapolated from the 2024 baseline of 198,540 with the observed growth rate. */
const PER_DAY = (198_540 * 1.09) / 365;

async function loadHistoryReference() {
  const [zones, units, hospitals, weather, makani] = await Promise.all([
    query(`SELECT z.id, z.ref, z.name, z.class, z.population, z.population_daytime,
                  z.highrise_ct, ST_X(z.centroid) lng, ST_Y(z.centroid) lat,
                  sqrt(z.area_km2) * 500 AS radius_m
             FROM zones z WHERE z.level = 'community'`).then((r) => r.rows),
    query(`SELECT u.id, u.ref, u.kind, u.capabilities, a.code agency,
                  ST_X(s.geom) lng, ST_Y(s.geom) lat
             FROM units u
             JOIN agencies a ON a.id = u.agency_id
             LEFT JOIN stations s ON s.id = u.home_station_id
            WHERE u.archived_at IS NULL AND a.code = 'DCAS'`).then((r) => r.rows),
    query(`SELECT id, ref, capabilities, ST_X(geom) lng, ST_Y(geom) lat FROM hospitals`).then((r) => r.rows),
    query(`SELECT ts, temp_c, condition, visibility_m FROM weather_hourly ORDER BY ts`).then((r) => r.rows),
    // An incident resolves to an EXISTING Makani entrance — it never mints a new code.
    // That is how the real system works: you look a location up, you do not invent one.
    query(`SELECT makani, zone_id, floors, entrance_count,
                  ST_X(geom) lng, ST_Y(geom) lat
             FROM makani_points WHERE zone_id IS NOT NULL`).then((r) => r.rows),
  ]);

  if (!zones.length || !units.length) {
    throw new Error('Reference data is missing — run `npm run seed:reference` first');
  }
  if (!makani.length) {
    throw new Error('No Makani points — run `npm run seed:reference` first');
  }

  // Index the entrance points by zone so an incident can be placed at a real address
  // in O(1) rather than a spatial lookup per row.
  const makaniByZone = new Map();
  for (const m of makani) {
    if (!makaniByZone.has(m.zone_id)) makaniByZone.set(m.zone_id, []);
    makaniByZone.get(m.zone_id).push(m);
  }
  // Towers only, for the vertical-access cases.
  const towersByZone = new Map();
  for (const [zid, list] of makaniByZone) {
    const towers = list.filter((m) => (m.floors ?? 0) >= 20);
    if (towers.length) towersByZone.set(zid, towers);
  }

  const weatherAt = new Map(weather.map((w) => [Math.floor(new Date(w.ts).getTime() / HOUR_MS), w]));
  const events = await query(
    `SELECT e.starts_at, e.ends_at, e.demand_multiplier, z.ref zone_ref
       FROM events_calendar e LEFT JOIN zones z ON z.id = e.zone_id`,
  ).then((r) => r.rows);

  return { zones, units, hospitals, weatherAt, events, makaniByZone, towersByZone };
}

/**
 * The simulation loop, over [start, end). `refFor(ts, seq)` names each incident;
 * `finishedBy`, when given, drops any incident that has not closed by that instant.
 */
function generateHistory({
  zones, units, hospitals, weatherAt, events, makaniByZone, towersByZone,
  rng, start, end, refFor, finishedBy = null,
}) {
  const perDay = PER_DAY;
  const zoneWeights = buildZoneWeights(zones);
  const fleet = units.map((u) => ({ ...u, freeAt: 0, jobs: 0 }));

  const incidents = [];
  const assignments = [];
  const patients = [];
  const notifications = [];
  const timeline = [];

  let seq = 0;
  let asgSeq = 0;

  // ── The simulation loop ────────────────────────────────────────────────────
  for (let t = start; t < end; t += HOUR_MS) {
    const d = new Date(t);
    const gstHour = (d.getUTCHours() + 4) % 24;
    const dow = d.getUTCDay();
    const w = weatherAt.get(Math.floor(t / HOUR_MS));

    let lambda = (perDay / 24) * DIURNAL[gstHour] * WEEKDAY[dow];

    // Weather covariates, each fitted as a ratio on the history it produces.
    if (w) {
      if (w.temp_c >= 44) lambda *= 1.26;
      else if (w.temp_c >= 40) lambda *= 1.12;
      if (w.condition === 'fog') lambda *= 1.34;
      if (w.condition === 'rain') lambda *= 1.18;
      if (w.condition === 'extreme_rain') lambda *= 2.9;
      if (w.condition === 'sandstorm') lambda *= 1.22;
    }

    const activeEvents = events.filter((e) =>
      t >= new Date(e.starts_at).getTime() && t < new Date(e.ends_at).getTime());
    for (const e of activeEvents) lambda *= 1 + (e.demand_multiplier - 1) * 0.18;

    const n = rng.poisson(lambda);

    for (let i = 0; i < n; i++) {
      const ts = t + rng.int(0, HOUR_MS - 1);
      if (finishedBy != null && ts > finishedBy) continue;
      seq++;

      const zone = pickZone(rng, zones, zoneWeights, gstHour);
      const kind = pickKind(rng, zone, w, gstHour);
      const priority = pickPriority(rng, kind);

      // Place the incident at a REAL Makani entrance in this zone. The floor then comes
      // from that building rather than being invented independently — so "floor 75"
      // only ever appears on a building that has 75 floors.
      const pool = makaniByZone.get(zone.id);
      const wantTower = zone.highrise_ct > 4 && rng.bool(Math.min(0.55, zone.highrise_ct / 140));
      const towers = towersByZone.get(zone.id);
      const address = wantTower && towers ? rng.pick(towers) : pool ? rng.pick(pool) : null;

      // The caller is rarely exactly on the entrance node; offset a little.
      const loc = address
        ? randomInCircle({ lng: address.lng, lat: address.lat }, 60, rng)
        : randomInCircle({ lng: zone.lng, lat: zone.lat }, zone.radius_m * 0.9, rng);

      const floor = address && (address.floors ?? 0) >= 4 && (wantTower || rng.bool(0.3))
        ? rng.int(2, address.floors)
        : null;

      const ref = refFor(ts, seq);

      // ── Stages ───────────────────────────────────────────────────────────
      // A cardiac arrest is not recognised at pick-up: the call-taker must establish
      // "unconscious, not breathing normally" before the ALS dispatch goes. That stage,
      // not only ALS scarcity, is why OHCA responses run slower than the fleet (docs/09 §2.3).
      const triageSec = Math.round(rng.logNormal(kind === 'cardiac_arrest' ? 100 : 40, 0.42));
      const dispatchSec = Math.round(rng.logNormal(30, 0.48));

      const req = CAPABILITY_REQUIREMENTS[kind] ?? CAPABILITY_REQUIREMENTS.medical_general;
      const chosen = chooseUnit(fleet, loc, ts, req, rng);

      if (!chosen) {
        // Genuinely no unit free. This happens, and the analytics must show it.
        if (finishedBy != null && ts + 3600_000 > finishedBy) continue;
        incidents.push(makeIncidentRow({
          ref, kind, priority, zone, loc, floor, ts, makani: address?.makani ?? null,
          triagedAt: ts + triageSec * 1000, dispatchedAt: null,
          onsceneAt: null, atPatientAt: null, closedAt: ts + 3600_000,
          outcome: 'cancelled_by_caller', state: 'closed', rng,
        }));
        continue;
      }

      // Crews at standby points are already in the vehicle, so turnout is short.
      const ackSec = Math.round(rng.logNormal(20, 0.55));
      const turnoutSec = Math.round(rng.logNormal(40, 0.46));
      const distanceM = haversineM(chosen, loc);
      const travelSec = travelTime(distanceM, gstHour, zone.class, w, rng);
      const vrt = floor ? verticalResponseTime(floor, zone, rng) : null;

      const dispatchedAt = ts + (triageSec + dispatchSec) * 1000;
      const ackAt = dispatchedAt + ackSec * 1000;
      const enrouteAt = ackAt + turnoutSec * 1000;
      const onsceneAt = enrouteAt + travelSec * 1000;
      const atPatientAt = onsceneAt + (vrt?.total ?? rng.int(20, 70)) * 1000;

      const onSceneCareSec = Math.round(rng.logNormal(
        kind === 'cardiac_arrest' ? 900 : priority === 'P1' ? 640 : 460, 0.42));
      const transports = rng.bool(transportProbability(kind, priority));
      const hospital = transports ? nearestCapable(hospitals, loc, kind, rng) : null;
      const transportSec = transports ? travelTime(haversineM(loc, hospital), gstHour, zone.class, w, rng) : 0;
      const handoverSec = transports ? Math.round(rng.logNormal(780, 0.5)) : 0;

      const transportingAt = transports ? atPatientAt + onSceneCareSec * 1000 : null;
      const atHospitalAt = transports ? transportingAt + transportSec * 1000 : null;
      const clearedAt = (atHospitalAt ?? (atPatientAt + onSceneCareSec * 1000)) + handoverSec * 1000;

      chosen.freeAt = clearedAt;
      chosen.jobs++;
      // Still in progress at the catch-up horizon: live picture, not history.
      if (finishedBy != null && clearedAt > finishedBy) continue;

      asgSeq++;
      const asgRef = `ASG-${String(seq % 10000).padStart(4, '0')}-1`;

      // 1.04–1.06 patient contacts per dispatch: 4–6% of dispatches are multi-casualty,
      // and most of those are two people — a driver and passenger, not a coach crash.
      const patientCount = rng.bool(0.045) ? (rng.bool(0.85) ? 2 : rng.int(3, 4)) : 1;

      incidents.push(makeIncidentRow({
        ref, kind, priority, zone, loc, floor, ts, makani: address?.makani ?? null,
        patientsCount: patientCount,
        triagedAt: ts + triageSec * 1000,
        dispatchedAt, onsceneAt, atPatientAt, closedAt: clearedAt,
        outcome: transports ? 'transported' : rng.bool(0.82) ? 'treated_released' : 'refused',
        state: 'closed', rng,
      }));

      assignments.push({
        ref: asgRef, incidentRef: ref, unitId: chosen.id,
        offeredAt: dispatchedAt, acknowledgedAt: ackAt, enrouteAt, onsceneAt, atPatientAt,
        transportingAt, atHospitalAt, clearedAt,
        hospitalId: hospital?.id ?? null,
        vrtSec: vrt?.total ?? null, vrtBreakdown: vrt?.parts ?? null,
        routeProposedSec: travelSec, routeProposedM: Math.round(distanceM * 1.34),
        routeTakenSec: travelSec + rng.int(-18, 42),
        routeTakenM: Math.round(distanceM * rng.float(1.30, 1.48)),
        etaPredictedAt: onsceneAt + Math.round(rng.normal(0, 46)) * 1000,
      });

      for (let p = 1; p <= patientCount; p++) {
        patients.push({
          incidentRef: ref, assignmentRef: asgRef, seq: p,
          ageBand: pickAgeBand(rng, kind),
          sex: rng.bool(jurisdiction.dispatch.malePatientShare) ? 'M' : 'F',
          complaint: rng.pick(CHIEF_COMPLAINTS[kind] ?? ['Unspecified']),
          destinationId: hospital?.id ?? null,
          outcome: transports ? 'transported' : 'treated_released',
        });
      }

      // Multi-agency: RTA and fire-related incidents pull other agencies in.
      if (kind === 'rta' || kind === 'fire_related' || priority === 'P1') {
        const agencies = kind === 'rta' ? ['POLICE', 'RTA']
          : kind === 'fire_related' ? ['CIVIL_DEFENCE', 'POLICE']
          : rng.bool(0.3) ? ['POLICE'] : [];
        for (const a of agencies) {
          notifications.push({
            incidentRef: ref, agency: a,
            notifiedAt: dispatchedAt + rng.int(1000, 26_000),
            acknowledgedAt: dispatchedAt + rng.int(20_000, 140_000),
            slaSec: 60,
          });
        }
      }

      timeline.push(
        { incidentRef: ref, ts, stage: 'reported', label: `Call received via ${sourceFor(rng, kind)}` },
        { incidentRef: ref, ts: dispatchedAt, stage: 'dispatched', label: `${chosen.ref} assigned` },
        { incidentRef: ref, ts: onsceneAt, stage: 'onscene', label: `${chosen.ref} on scene` },
      );
    }
  }

  return { incidents, assignments, patients, notifications, timeline };
}

// ── Selection ────────────────────────────────────────────────────────────────

function buildZoneWeights(zones) {
  return zones.map((z) => ({
    zone: z,
    night: z.population,
    day: z.population_daytime ?? z.population,
  }));
}

/**
 * Demand shifts with the 1.8M daily influx: toward commercial corridors 08:00–18:00,
 * back to residential high-rise clusters 19:00–06:00. A single static population figure
 * models that away entirely.
 */
function pickZone(rng, zones, weights, gstHour) {
  const daytime = gstHour >= 8 && gstHour < 18;
  return rng.weighted(weights, (w) => (daytime ? w.day : w.night)).zone;
}

function pickKind(rng, zone, weather, gstHour) {
  const candidates = CASE_MIX.map((c) => {
    let w = c.weight;
    if (c.zoneBias?.[zone.class]) w *= c.zoneBias[zone.class];
    if (c.summerOnly) {
      const hot = weather && weather.temp_c >= 38;
      w *= hot ? 2.6 : 0.25;
    }
    if (c.kind === 'heat_illness' && weather) {
      // MOHRE bans open-air work 12:30–15:00 in summer. Calls collapse in that window
      // and rebound immediately after — a visible, defensible signature.
      if (gstHour >= 12 && gstHour < 15) w *= 0.22;
      else if (gstHour >= 15 && gstHour < 18) w *= 1.9;
    }
    if (c.kind === 'rta' && weather) {
      if (weather.condition === 'fog') w *= 2.8;
      if (weather.condition === 'extreme_rain') w *= 3.4;
      if (gstHour >= 17 && gstHour <= 20) w *= 1.4;
    }
    if (c.kind === 'workplace_injury' && gstHour >= 20) w *= 0.3;
    return { ...c, weight: w };
  });
  return rng.weighted(candidates).kind;
}

function pickPriority(rng, kind) {
  const mix = CASE_MIX.find((c) => c.kind === kind)?.priorities
    ?? { P1: 0.1, P2: 0.3, P3: 0.45, P4: 0.15 };
  const r = rng.next();
  let acc = 0;
  for (const [p, share] of Object.entries(mix)) {
    acc += share;
    if (r <= acc) return p;
  }
  return 'P3';
}

/** The same hard-filter-then-score shape the live dispatch engine uses. */
function chooseUnit(fleet, loc, ts, req, rng) {
  const available = fleet.filter((u) =>
    u.freeAt <= ts && req.required.every((cap) => u.capabilities.includes(cap)));
  if (!available.length) return null;

  const preferred = req.preferred ?? [];
  const scored = available.map((u) => {
    const dist = haversineM(u, loc);
    const rank = preferred.indexOf(u.kind);
    const capabilityBonus = rank === -1 ? 3000 : rank * 450;
    // Crew fatigue: a unit late in a long run is damped, as in the live engine.
    const fatigue = Math.min(2500, u.jobs * 3);
    return { u, score: dist + capabilityBonus + fatigue + rng.float(0, 600) };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].u;
}

function nearestCapable(hospitals, loc, kind, rng) {
  const need = { stroke: 'stroke', cardiac: 'cath_lab', cardiac_arrest: 'cath_lab',
                 paediatric: 'paeds', obstetric: 'obstetric', fire_related: 'burns' }[kind];
  let pool = need ? hospitals.filter((h) => h.capabilities.includes(need)) : hospitals;
  if (!pool.length) pool = hospitals;
  const ranked = pool.map((h) => ({ h, d: haversineM(loc, h) })).sort((a, b) => a.d - b.d);
  // Not always the nearest — ED load and diversion move the choice in reality.
  return (rng.bool(0.78) ? ranked[0] : ranked[Math.min(ranked.length - 1, 1)]).h;
}

// ── Timing models ────────────────────────────────────────────────────────────

/** Congestion by hour and zone class, applied to a straight-line-plus-detour estimate. */
function travelTime(distanceM, gstHour, zoneClass, weather, rng) {
  const roadDistance = distanceM * 1.36;
  let speedKph = zoneClass === 'desert' ? 78
    : zoneClass === 'industrial' ? 46
    : zoneClass === 'suburban' ? 44
    : zoneClass === 'freezone' ? 50
    : 38;

  // Peak congestion. Sheikh Zayed Road at 18:00 is slow in the seed because it is slow —
  // but less so for a vehicle under blue lights, which traffic yields to and which can
  // use the hard shoulder, so the penalty is milder than for general traffic.
  if (gstHour >= 7 && gstHour <= 9) speedKph *= 0.84;
  else if (gstHour >= 17 && gstHour <= 20) speedKph *= 0.78;
  else if (gstHour >= 23 || gstHour <= 5) speedKph *= 1.28;

  if (weather?.condition === 'fog') speedKph *= 0.62;
  if (weather?.condition === 'rain') speedKph *= 0.78;
  if (weather?.condition === 'extreme_rain') speedKph *= 0.34;
  if (weather?.condition === 'sandstorm') speedKph *= 0.70;

  const base = (roadDistance / 1000) / speedKph * 3600;
  return Math.max(45, Math.round(rng.logNormal(base, 0.34)));
}

/**
 * Vertical Response Time — 4–8 minutes in Dubai's high-rise clusters, comparable to and
 * sometimes exceeding the drive. Reported as its own stage, never folded into travel:
 * conflating them is exactly how the last-hundred-metres problem stays invisible.
 */
function verticalResponseTime(floor, zone, rng) {
  const v = jurisdiction.vrt;
  const lobby = rng.int(v.lobbyAccessSec[0], v.lobbyAccessSec[1]);
  const security = zone.highrise_ct > 10
    ? rng.int(v.securityClearanceSec[0], v.securityClearanceSec[1])
    : rng.int(0, 40);
  const liftFailed = rng.bool(0.06);
  const liftWait = Math.round(
    rng.int(v.liftWaitSec[0], v.liftWaitSec[1]) * (liftFailed ? v.liftFailureMultiplier : 1));
  const ascent = Math.round(floor * v.ascentSecPerFloor * (liftFailed ? 3.2 : 1));
  const corridor = rng.int(v.corridorFindSec[0], v.corridorFindSec[1]);
  const total = lobby + security + liftWait + ascent + corridor;
  return { total, parts: { lobby, security, liftWait, ascent, corridor, liftFailed } };
}

function transportProbability(kind, priority) {
  // 169,556 emergency calls produced 96,463 transports in 2023 — roughly 57%.
  if (kind === 'non_emergency') return 0.96;
  if (kind === 'cardiac_arrest') return 0.62;
  if (priority === 'P1') return 0.78;
  if (priority === 'P2') return 0.63;
  if (priority === 'P3') return 0.48;
  return 0.30;
}

function pickAgeBand(rng, kind) {
  const bands = ['0-4', '5-14', '15-24', '25-34', '35-44', '45-54', '55-64', '65-74', '75-84', '85+'];
  if (kind === 'paediatric') return rng.pick(['0-4', '5-14']);
  if (kind === 'cardiac' || kind === 'cardiac_arrest' || kind === 'stroke') {
    return rng.pick(['45-54', '55-64', '65-74', '75-84', '85+']);
  }
  if (kind === 'workplace_injury') return rng.pick(['25-34', '35-44', '45-54']);
  if (kind === 'obstetric') return rng.pick(['15-24', '25-34', '35-44']);
  return rng.weighted(
    bands.map((b, i) => ({ b, w: [3, 4, 12, 20, 18, 14, 11, 8, 6, 4][i] })), (x) => x.w).b;
}

function sourceFor(rng, kind) {
  if (kind === 'cardiac_arrest' && rng.bool(0.12)) return 'AED activation';
  return rng.bool(0.86) ? '998' : rng.bool(0.6) ? '999 transfer' : 'App SOS';
}

function makeIncidentRow(o) {
  const complaint = rng0(o.rng, CHIEF_COMPLAINTS[o.kind] ?? ['Unspecified']);
  return {
    ref: o.ref, kind: o.kind, priority: o.priority,
    state: o.state, outcome: o.outcome,
    lng: o.loc.lng, lat: o.loc.lat,
    makani: o.makani ?? null,
    zoneId: o.zone.id, floor: o.floor,
    source: o.kind === 'cardiac_arrest' && o.rng.bool(0.1) ? 'aed_activation'
      : o.rng.bool(0.86) ? 'call_998' : o.rng.bool(0.5) ? 'call_999' : 'app_sos',
    complaint,
    patientsCount: o.patientsCount ?? 1,
    reportedAt: o.ts,
    triagedAt: o.triagedAt,
    dispatchedAt: o.dispatchedAt,
    onsceneAt: o.onsceneAt,
    atPatientAt: o.atPatientAt,
    closedAt: o.closedAt,
  };
}
const rng0 = (rng, arr) => arr[Math.floor(rng.next() * arr.length)];

// ── Bulk load ────────────────────────────────────────────────────────────────

/**
 * COPY FROM STDIN, indexes already in place from schema.sql. At ~420k incidents a
 * row-at-a-time insert would take the best part of an hour; this takes seconds. A seed
 * nobody re-runs rots.
 */
async function bulkLoad({ incidents, assignments, patients, notifications, timeline, log }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Incidents first — everything else references them by ref.
    await copyRows(client, 'incidents',
      ['ref', 'kind', 'priority', 'state', 'outcome', 'geom', 'makani', 'zone_id', 'floor',
       'source', 'chief_complaint', 'patients_count', 'reported_at', 'triaged_at',
       'dispatched_at', 'first_onscene_at', 'first_at_patient_at', 'closed_at', 'is_seed'],
      incidents.map((i) => [
        i.ref, i.kind, i.priority, i.state, i.outcome,
        `SRID=4326;POINT(${i.lng} ${i.lat})`, i.makani, i.zoneId, i.floor,
        i.source, i.complaint, i.patientsCount,
        iso(i.reportedAt), iso(i.triagedAt), iso(i.dispatchedAt),
        iso(i.onsceneAt), iso(i.atPatientAt), iso(i.closedAt), 't',
      ]));
    log(`  loaded        incidents`);

    // Assignments need incident ids; resolve by ref in one pass.
    await client.query(`CREATE TEMP TABLE _asg_stage (
      ref text, incident_ref text, unit_id uuid,
      offered_at timestamptz, acknowledged_at timestamptz, enroute_at timestamptz,
      onscene_at timestamptz, at_patient_at timestamptz, transporting_at timestamptz,
      at_hospital_at timestamptz, cleared_at timestamptz, hospital_id uuid,
      vrt_sec int, vrt_breakdown jsonb,
      route_proposed_sec int, route_proposed_m int, route_taken_sec int, route_taken_m int,
      eta_predicted_at timestamptz) ON COMMIT DROP`);

    await copyRows(client, '_asg_stage',
      ['ref', 'incident_ref', 'unit_id', 'offered_at', 'acknowledged_at', 'enroute_at',
       'onscene_at', 'at_patient_at', 'transporting_at', 'at_hospital_at', 'cleared_at',
       'hospital_id', 'vrt_sec', 'vrt_breakdown', 'route_proposed_sec', 'route_proposed_m',
       'route_taken_sec', 'route_taken_m', 'eta_predicted_at'],
      assignments.map((a) => [
        a.ref, a.incidentRef, a.unitId,
        iso(a.offeredAt), iso(a.acknowledgedAt), iso(a.enrouteAt), iso(a.onsceneAt),
        iso(a.atPatientAt), iso(a.transportingAt), iso(a.atHospitalAt), iso(a.clearedAt),
        a.hospitalId, a.vrtSec, a.vrtBreakdown ? JSON.stringify(a.vrtBreakdown) : null,
        a.routeProposedSec, a.routeProposedM, a.routeTakenSec, a.routeTakenM,
        iso(a.etaPredictedAt),
      ]));

    await client.query(
      `INSERT INTO assignments
         (ref, incident_id, unit_id, state, offered_at, acknowledged_at, enroute_at,
          onscene_at, at_patient_at, transporting_at, at_hospital_at, cleared_at,
          hospital_id, vrt_sec, vrt_breakdown, route_proposed_sec, route_proposed_m,
          route_taken_sec, route_taken_m, eta_predicted_at)
       SELECT s.ref || '-' || i.id::text, i.id, s.unit_id, 'cleared',
              s.offered_at, s.acknowledged_at, s.enroute_at, s.onscene_at, s.at_patient_at,
              s.transporting_at, s.at_hospital_at, s.cleared_at, s.hospital_id,
              s.vrt_sec, s.vrt_breakdown, s.route_proposed_sec, s.route_proposed_m,
              s.route_taken_sec, s.route_taken_m, s.eta_predicted_at
         FROM _asg_stage s JOIN incidents i ON i.ref = s.incident_ref
       ON CONFLICT (ref) DO NOTHING`);
    log(`  loaded        assignments`);

    // Patients.
    await client.query(`CREATE TEMP TABLE _pat_stage (
      incident_ref text, seq int, age_band text, sex text, complaint text,
      destination_id uuid, outcome text) ON COMMIT DROP`);
    await copyRows(client, '_pat_stage',
      ['incident_ref', 'seq', 'age_band', 'sex', 'complaint', 'destination_id', 'outcome'],
      patients.map((p) => [p.incidentRef, p.seq, p.ageBand, p.sex, p.complaint,
                           p.destinationId, p.outcome]));
    await client.query(
      `INSERT INTO patients (incident_id, seq, age_band, sex, chief_complaint, destination_id, outcome)
       SELECT i.id, s.seq, s.age_band, s.sex, s.complaint, s.destination_id, s.outcome
         FROM _pat_stage s JOIN incidents i ON i.ref = s.incident_ref`);
    log(`  loaded        patients`);

    // Agency notifications — the sub-minute multi-agency claim, measured.
    await client.query(`CREATE TEMP TABLE _not_stage (
      incident_ref text, agency text, notified_at timestamptz,
      acknowledged_at timestamptz, sla_sec int) ON COMMIT DROP`);
    await copyRows(client, '_not_stage',
      ['incident_ref', 'agency', 'notified_at', 'acknowledged_at', 'sla_sec'],
      notifications.map((n) => [n.incidentRef, n.agency, iso(n.notifiedAt),
                                iso(n.acknowledgedAt), n.slaSec]));
    await client.query(
      `INSERT INTO agency_notifications (incident_id, agency_id, notified_at, acknowledged_at, sla_sec)
       SELECT i.id, a.id, s.notified_at, s.acknowledged_at, s.sla_sec
         FROM _not_stage s
         JOIN incidents i ON i.ref = s.incident_ref
         JOIN agencies a ON a.code = s.agency::agency_code
       ON CONFLICT (incident_id, agency_id) DO NOTHING`);
    log(`  loaded        agency notifications`);

    // Timeline.
    await client.query(`CREATE TEMP TABLE _tl_stage (
      incident_ref text, ts timestamptz, stage text, label text) ON COMMIT DROP`);
    await copyRows(client, '_tl_stage', ['incident_ref', 'ts', 'stage', 'label'],
      timeline.map((e) => [e.incidentRef, iso(e.ts), e.stage, e.label]));
    await client.query(
      `INSERT INTO incident_timeline (incident_id, ts, stage, label, actor_kind)
       SELECT i.id, s.ts, s.stage, s.label, 'system'
         FROM _tl_stage s JOIN incidents i ON i.ref = s.incident_ref`);
    log(`  loaded        timeline`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await query('ANALYZE incidents'); await query('ANALYZE assignments');
  await query('ANALYZE patients');  await query('ANALYZE incident_timeline');
}

async function copyRows(client, table, columns, rows) {
  if (!rows.length) return;
  const stream = client.query(copyFrom(
    `COPY ${table} (${columns.join(',')}) FROM STDIN WITH (FORMAT text, NULL '\\N')`));
  const source = Readable.from(rows.map((r) => r.map(tsv).join('\t') + '\n'));
  await pipeline(source, stream);
}

function tsv(v) {
  if (v === null || v === undefined) return '\\N';
  return String(v)
    .replaceAll('\\', '\\\\').replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n').replaceAll('\r', '\\r');
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

function fmtDate(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
