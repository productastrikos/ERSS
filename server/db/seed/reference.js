/**
 * Seed the reference layer: agencies, zones, stations, hospitals, Makani points, AEDs,
 * traffic signals, fleet and users.
 *
 * Idempotent — every insert is ON CONFLICT DO UPDATE, so re-running refreshes rather
 * than duplicating.
 */

import { transaction, query } from '../../lib/db.js';
import { jurisdiction } from '../../config/jurisdiction.js';
import { hashPassword } from '../../lib/auth.js';
import { createRng } from './rng.js';
import {
  blobPolygon, multiPolygon, point, randomInCircle, makaniFor, offset, clampToBbox,
} from './geo.js';
import { SECTORS, COMMUNITIES, CORRIDORS } from '../../data/reference/communities.js';
import {
  HOSPITALS, AMBULANCE_ANCHORS, POLICE_STATIONS, SMART_POLICE_STATIONS,
  CIVIL_DEFENCE_STATIONS, COASTGUARD_STATIONS, AED_SITE_KINDS,
} from '../../data/reference/facilities.js';
import { DCAS_FLEET, PARTNER_FLEET, CALLSIGN } from '../../data/reference/fleet.js';

const BBOX = jurisdiction.bbox;

export async function seedReference({ rngSeed, log = console.log }) {
  const rng = createRng(`${rngSeed}:reference`);

  await seedAgencies(log);
  const zoneIds = await seedZones(rng, log);
  await seedStations(rng, zoneIds, log);
  await seedHospitals(zoneIds, log);
  const makaniCount = await seedMakani(rng, zoneIds, log);
  await seedAeds(rng, zoneIds, log);
  await seedTrafficSignals(rng, zoneIds, log);
  await seedFleet(rng, log);
  await seedFeeds(log);
  await seedUsers(log);

  return { zones: zoneIds.size, makani: makaniCount };
}

// ── Agencies ─────────────────────────────────────────────────────────────────

async function seedAgencies(log) {
  await transaction(async (c) => {
    for (const a of jurisdiction.agencies) {
      await c.query(
        `INSERT INTO agencies (code, name, short_name, emergency_no, glyph, series_slot,
                               is_responder, sla_ack_sec, sla_scene_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, short_name = EXCLUDED.short_name,
           emergency_no = EXCLUDED.emergency_no, glyph = EXCLUDED.glyph,
           series_slot = EXCLUDED.series_slot, is_responder = EXCLUDED.is_responder,
           sla_ack_sec = EXCLUDED.sla_ack_sec, sla_scene_sec = EXCLUDED.sla_scene_sec`,
        [a.code, a.name, a.short, a.emergencyNo, a.glyph, a.series,
         a.isResponder, a.slaAckSec, a.slaSceneSec],
      );
    }
  });
  log(`  agencies      ${jurisdiction.agencies.length}`);
}

// ── Zones ────────────────────────────────────────────────────────────────────

async function seedZones(rng, log) {
  const ids = new Map();

  await transaction(async (c) => {
    // Emirate — the union of every sector, approximated as a large blob.
    const emirateRing = blobPolygon(jurisdiction.centre, 34_000, rng, { points: 22, wobble: 0.34, aspect: 1.5 });
    const emirate = await upsertZone(c, {
      ref: 'Z-E1', name: jurisdiction.name, level: 'emirate', parentId: null, class: 'urban',
      pop: jurisdiction.population.resident, popDay: jurisdiction.population.daytime,
      areaKm2: 4114, highrise: 0, geom: multiPolygon(emirateRing),
    });
    ids.set('Z-E1', emirate);

    // Sectors — a blob around the mean of their communities.
    for (const s of SECTORS) {
      const members = COMMUNITIES.filter((cm) => cm.sector === s.ref);
      const centre = meanPoint(members);
      const spread = Math.max(2500, meanRadius(members) * 2.6);
      const ring = blobPolygon(centre, spread, rng, { points: 16, wobble: 0.3 });
      const pop = members.reduce((n, m) => n + m.pop, 0);
      const popDay = Math.round(members.reduce((n, m) => n + m.pop * m.dayMult, 0));
      const id = await upsertZone(c, {
        ref: s.ref, name: s.name, level: 'sector', parentId: emirate, class: s.class,
        pop, popDay, areaKm2: Math.round((Math.PI * spread * spread) / 1e6),
        highrise: members.reduce((n, m) => n + m.highrise, 0),
        geom: multiPolygon(ring),
      });
      ids.set(s.ref, id);
    }

    // Communities.
    for (const cm of COMMUNITIES) {
      const ring = blobPolygon({ lng: cm.lng, lat: cm.lat }, cm.radiusM, rng, { points: 14, wobble: 0.26 });
      const id = await upsertZone(c, {
        ref: cm.ref, name: cm.name, level: 'community', parentId: ids.get(cm.sector), class: cm.class,
        pop: cm.pop, popDay: Math.round(cm.pop * cm.dayMult),
        areaKm2: +((Math.PI * cm.radiusM * cm.radiusM) / 1e6).toFixed(3),
        highrise: cm.highrise, geom: multiPolygon(ring),
      });
      ids.set(cm.ref, id);

      // Beats — 3–8 per community, the last-mile drill-down level.
      const beatCount = Math.max(3, Math.min(8, Math.round(cm.pop / 12_000) + 2));
      for (let b = 1; b <= beatCount; b++) {
        const angle = (b / beatCount) * 360;
        const centre = offset({ lng: cm.lng, lat: cm.lat }, cm.radiusM * 0.55, angle);
        const beatRing = blobPolygon(centre, cm.radiusM / Math.sqrt(beatCount) * 0.95, rng,
          { points: 10, wobble: 0.22 });
        const ref = `${cm.ref}-B${String(b).padStart(2, '0')}`;
        const beatId = await upsertZone(c, {
          ref, name: `${cm.name} Beat ${b}`, level: 'beat', parentId: id, class: cm.class,
          pop: Math.round(cm.pop / beatCount), popDay: Math.round((cm.pop * cm.dayMult) / beatCount),
          areaKm2: +(((Math.PI * cm.radiusM * cm.radiusM) / beatCount) / 1e6).toFixed(3),
          highrise: Math.round(cm.highrise / beatCount), geom: multiPolygon(beatRing),
        });
        ids.set(ref, beatId);
      }
    }
  });

  const counts = await query(`SELECT level, COUNT(*)::int n FROM zones GROUP BY level ORDER BY 1`);
  log(`  zones         ${ids.size}  (${counts.rows.map((r) => `${r.level} ${r.n}`).join(', ')})`);
  return ids;
}

async function upsertZone(c, z) {
  const { rows } = await c.query(
    `INSERT INTO zones (ref, name, level, parent_id, class, population, population_daytime,
                        area_km2, highrise_ct, geom)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ST_Multi(ST_GeomFromGeoJSON($10)))
     ON CONFLICT (ref) DO UPDATE SET
       name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, class = EXCLUDED.class,
       population = EXCLUDED.population, population_daytime = EXCLUDED.population_daytime,
       area_km2 = EXCLUDED.area_km2, highrise_ct = EXCLUDED.highrise_ct, geom = EXCLUDED.geom
     RETURNING id`,
    [z.ref, z.name, z.level, z.parentId, z.class, z.pop, z.popDay, z.areaKm2, z.highrise, z.geom],
  );
  return rows[0].id;
}

// ── Stations ─────────────────────────────────────────────────────────────────

async function seedStations(rng, zoneIds, log) {
  const rows = [];

  // DCAS: 133 points. Named anchors first, then distribute the rest by population.
  AMBULANCE_ANCHORS.forEach((a, i) => {
    rows.push({ ref: `STN-DCAS-${pad(i + 1)}`, name: a.name, agency: 'DCAS',
                kind: 'station', dispatchable: true, bays: a.bays, lng: a.lng, lat: a.lat });
  });

  const remaining = 133 - AMBULANCE_ANCHORS.length;
  const byPop = weightedCommunities(COMMUNITIES, remaining);
  byPop.forEach((cm, i) => {
    const p = randomInCircle({ lng: cm.lng, lat: cm.lat }, cm.radiusM * 0.7, rng);
    const n = AMBULANCE_ANCHORS.length + i + 1;
    rows.push({
      ref: `STN-DCAS-${pad(n)}`,
      name: `${cm.name} ${rng.bool(0.55) ? 'Standby Point' : 'Ambulance Point'} ${i + 1}`,
      agency: 'DCAS', kind: rng.bool(0.55) ? 'standby_point' : 'station',
      dispatchable: true, bays: rng.int(1, 3), lng: p.lng, lat: p.lat,
    });
  });

  POLICE_STATIONS.forEach((s, i) => rows.push({
    ref: `STN-POL-${pad(i + 1)}`, name: s.name, agency: 'POLICE',
    kind: 'station', dispatchable: true, bays: 4, lng: s.lng, lat: s.lat,
  }));

  // The 33 Smart Police Stations are UNMANNED. dispatchable=false is not cosmetic:
  // routing an incident to one yields no physical responder.
  SMART_POLICE_STATIONS.forEach((s, i) => rows.push({
    ref: `STN-SPS-${pad(i + 1)}`, name: s.name, agency: 'POLICE',
    kind: 'smart', dispatchable: false, bays: 0, lng: s.lng, lat: s.lat,
  }));

  CIVIL_DEFENCE_STATIONS.forEach((s, i) => rows.push({
    ref: `STN-CD-${pad(i + 1)}`, name: s.name, agency: 'CIVIL_DEFENCE',
    kind: s.floating ? 'floating' : 'station', dispatchable: true, bays: 4, lng: s.lng, lat: s.lat,
  }));

  COASTGUARD_STATIONS.forEach((s, i) => rows.push({
    ref: `STN-CG-${pad(i + 1)}`, name: s.name, agency: 'COASTGUARD',
    kind: 'station', dispatchable: true, bays: 2, lng: s.lng, lat: s.lat,
  }));

  await transaction(async (c) => {
    for (const s of rows) {
      await c.query(
        `INSERT INTO stations (ref, name, agency_id, zone_id, kind, dispatchable, makani, bays, geom)
         VALUES ($1,$2,(SELECT id FROM agencies WHERE code=$3),
                 (SELECT id FROM zones WHERE level='community'
                    AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($7,$8),4326)) LIMIT 1),
                 $4,$5,$6,$9, ST_SetSRID(ST_MakePoint($7,$8),4326))
         ON CONFLICT (ref) DO UPDATE SET
           name = EXCLUDED.name, kind = EXCLUDED.kind, dispatchable = EXCLUDED.dispatchable,
           bays = EXCLUDED.bays, geom = EXCLUDED.geom, zone_id = EXCLUDED.zone_id`,
        [s.ref, s.name, s.agency, s.kind, s.dispatchable, makaniFor(s.lng, s.lat),
         s.lng, s.lat, s.bays],
      );
    }
  });

  const undispatchable = rows.filter((r) => !r.dispatchable).length;
  log(`  stations      ${rows.length}  (${undispatchable} unmanned, excluded from dispatch)`);
}

// ── Hospitals ────────────────────────────────────────────────────────────────

async function seedHospitals(zoneIds, log) {
  await transaction(async (c) => {
    for (const h of HOSPITALS) {
      await c.query(
        `INSERT INTO hospitals (ref, name, area, operator_class, zone_id, makani,
                                ed_beds, ed_occupied, capabilities, nabidh_id, geom)
         VALUES ($1,$2,$3,$4,
                 (SELECT id FROM zones WHERE level='community'
                    AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($9,$10),4326)) LIMIT 1),
                 $5,$6,$7,$8,$11, ST_SetSRID(ST_MakePoint($9,$10),4326))
         ON CONFLICT (ref) DO UPDATE SET
           name = EXCLUDED.name, area = EXCLUDED.area, ed_beds = EXCLUDED.ed_beds,
           capabilities = EXCLUDED.capabilities, geom = EXCLUDED.geom,
           zone_id = EXCLUDED.zone_id`,
        [h.ref, h.name, h.area, h.operator, makaniFor(h.lng, h.lat), h.edBeds,
         Math.round(h.edBeds * 0.55), h.capabilities, h.lng, h.lat,
         `NABIDH-${h.ref}`],
      );
    }
  });
  const caps = new Set(HOSPITALS.flatMap((h) => h.capabilities));
  log(`  hospitals     ${HOSPITALS.length}  (capabilities: ${[...caps].join(', ')})`);
}

// ── Makani ───────────────────────────────────────────────────────────────────

async function seedMakani(rng, zoneIds, log) {
  const rows = [];

  for (const cm of COMMUNITIES) {
    // Density follows the built environment: tower clusters get far more entrances.
    const buildings = Math.round(20 + cm.pop / 900 + cm.highrise * 2.5);
    for (let b = 0; b < buildings; b++) {
      const p = randomInCircle({ lng: cm.lng, lat: cm.lat }, cm.radiusM * 0.85, rng);
      const isTower = b < cm.highrise;
      const floors = isTower ? rng.int(21, 80) : rng.int(1, 12);

      // A building with many entrances gets a SEPARATE Makani for each. That is the
      // whole point of the system for emergency response — "entrance 4 of 11" is a real
      // navigation problem, not a slogan.
      const entrances = isTower ? rng.int(2, 6) : rng.bool(0.25) ? 2 : 1;
      const name = isTower ? `${cm.name} Tower ${b + 1}` : null;

      for (let e = 1; e <= entrances; e++) {
        const ep = offset(p, rng.float(8, 45), rng.float(0, 360));
        const c2 = clampToBbox(ep, BBOX);
        rows.push({
          makani: makaniFor(c2.lng, c2.lat),
          buildingName: name,
          address: rng.bool(0.64) ? `${cm.name}, Dubai` : null,  // real fill rate ≈64%
          entranceNo: e,
          entranceCount: entrances,
          entranceRole: e === 1 ? 'main' : rng.pick(['service', 'parking', 'emergency', `lobby-${String.fromCharCode(96 + e)}`]),
          floors,
          parcelId: rng.bool(0.639) ? `${rng.int(100, 999)}-${rng.int(1000, 9999)}` : null,
          communityNo: Number(cm.ref.slice(-4)),
          lng: c2.lng, lat: c2.lat,
        });
      }
    }
  }

  // Deduplicate: the grid quantises to ~10 m so very close entrances can collide.
  const unique = new Map();
  for (const r of rows) if (!unique.has(r.makani)) unique.set(r.makani, r);
  const list = [...unique.values()];

  await transaction(async (c) => {
    const CHUNK = 500;
    for (let i = 0; i < list.length; i += CHUNK) {
      await insertMakaniChunk(c, list.slice(i, i + CHUNK));
    }
  });

  log(`  makani        ${list.length} entrance points`);
  return list.length;
}

/** Multi-row insert. Nine bound columns per row; lng/lat feed ST_MakePoint only. */
async function insertMakaniChunk(c, slice) {
  const COLS = 10;                       // 8 scalar + lng + lat
  const values = [];
  const params = [];

  slice.forEach((r, j) => {
    const o = j * COLS;
    values.push(
      `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},` +
      `ST_SetSRID(ST_MakePoint($${o + 9}::float8,$${o + 10}::float8),4326))`,
    );
    params.push(
      r.makani, r.buildingName, r.address, r.entranceNo, r.entranceCount,
      r.entranceRole, r.floors, r.parcelId, r.lng, r.lat,
    );
  });

  await c.query(
    `INSERT INTO makani_points
       (makani, building_name, makani_address, entrance_no, entrance_count,
        entrance_role, floors, parcel_id, geom)
     VALUES ${values.join(',')}
     ON CONFLICT (makani) DO NOTHING`,
    params,
  );

  // zone_id is resolved in one spatial pass afterwards rather than per row — a
  // point-in-polygon lookup inside a 4,000-row insert is the difference between a
  // seed that takes seconds and one that takes minutes.
  await c.query(
    `UPDATE makani_points m
        SET zone_id = z.id
       FROM zones z
      WHERE z.level = 'community'
        AND m.zone_id IS NULL
        AND ST_Contains(z.geom, m.geom)`,
  );
}

// ── AEDs ─────────────────────────────────────────────────────────────────────

async function seedAeds(rng, zoneIds, log) {
  const rows = [];
  let n = 0;

  for (const cm of COMMUNITIES) {
    const sites = Math.max(1, Math.round(cm.pop / 18_000 + cm.dayMult));
    for (let s = 0; s < sites; s++) {
      const siteKind = rng.weighted(AED_SITE_KINDS);
      const p = randomInCircle({ lng: cm.lng, lat: cm.lat }, cm.radiusM * 0.8, rng);
      const units = rng.int(siteKind.perSite[0], siteKind.perSite[1]);
      for (let u = 0; u < units; u++) {
        n++;
        const up = offset(p, rng.float(5, 60), rng.float(0, 360));
        rows.push({
          ref: `AED-${pad(n, 4)}`,
          siteName: `${cm.name} ${titleCase(siteKind.kind)} ${s + 1}`,
          siteKind: siteKind.kind,
          // The real DCAS network is telemetry-enabled (Lifepak CR2): opening a cabinet
          // transmits to the control room and auto-generates a high-acuity incident.
          telemetry: rng.bool(0.82),
          available: rng.bool(0.97),
          lng: up.lng, lat: up.lat,
        });
      }
    }
  }

  await transaction(async (c) => {
    for (const a of rows) {
      await c.query(
        `INSERT INTO aeds (ref, site_name, site_kind, zone_id, makani, telemetry, available, geom)
         VALUES ($1,$2,$3,
                 (SELECT id FROM zones WHERE level='community'
                    AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($6,$7),4326)) LIMIT 1),
                 $4,$5,$8, ST_SetSRID(ST_MakePoint($6,$7),4326))
         ON CONFLICT (ref) DO UPDATE SET
           telemetry = EXCLUDED.telemetry, available = EXCLUDED.available, geom = EXCLUDED.geom`,
        [a.ref, a.siteName, a.siteKind, makaniFor(a.lng, a.lat), a.telemetry,
         a.lng, a.lat, a.available],
      );
    }
  });

  const tele = rows.filter((r) => r.telemetry).length;
  log(`  aeds          ${rows.length}  (${tele} telemetry-enabled — cabinet opening raises an incident)`);
}

// ── Traffic signals ──────────────────────────────────────────────────────────

async function seedTrafficSignals(rng, zoneIds, log) {
  // RTA operates ~620 signalised intersections on UTC-UX Fusion.
  const rows = [];
  let n = 0;

  for (const corridor of CORRIDORS) {
    for (let i = 0; i < corridor.signals; i++) {
      n++;
      const cm = rng.pick(COMMUNITIES.filter((c) => c.class !== 'desert'));
      const p = randomInCircle({ lng: cm.lng, lat: cm.lat }, cm.radiusM, rng);
      rows.push({
        ref: `SIG-${pad(n, 4)}`,
        name: `${corridor.name} / ${cm.name} ${i + 1}`,
        corridor: corridor.ref,
        // ⚠ EVP is NOT verified as deployed in Dubai. Modelled as a capability a subset
        // of intersections *could* support, so the scenario can measure what it would
        // recover. See docs/10 SC-05.
        evpCapable: rng.bool(0.42),
        lng: p.lng, lat: p.lat,
      });
    }
  }

  // Remainder to reach ~620, spread across communities.
  while (rows.length < jurisdiction.traffic.signalisedIntersections) {
    n++;
    const cm = rng.weighted(COMMUNITIES.filter((c) => c.class !== 'desert'), (c) => c.pop);
    const p = randomInCircle({ lng: cm.lng, lat: cm.lat }, cm.radiusM, rng);
    rows.push({
      ref: `SIG-${pad(n, 4)}`, name: `${cm.name} Junction ${n}`, corridor: null,
      evpCapable: rng.bool(0.30), lng: p.lng, lat: p.lat,
    });
  }

  await transaction(async (c) => {
    for (const s of rows) {
      await c.query(
        `INSERT INTO traffic_signals (ref, name, zone_id, corridor, evp_capable, geom)
         VALUES ($1,$2,
                 (SELECT id FROM zones WHERE level='community'
                    AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($5,$6),4326)) LIMIT 1),
                 $3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326))
         ON CONFLICT (ref) DO UPDATE SET evp_capable = EXCLUDED.evp_capable, geom = EXCLUDED.geom`,
        [s.ref, s.name, s.corridor, s.evpCapable, s.lng, s.lat],
      );
    }
  });

  log(`  signals       ${rows.length}  (${rows.filter((r) => r.evpCapable).length} modelled EVP-capable)`);
}

// ── Fleet ────────────────────────────────────────────────────────────────────

async function seedFleet(rng, log) {
  const { rows: stations } = await query(
    `SELECT s.id, s.ref, a.code AS agency, ST_X(s.geom) lng, ST_Y(s.geom) lat
       FROM stations s JOIN agencies a ON a.id = s.agency_id
      WHERE s.dispatchable AND s.kind IN ('station','floating')`,
  );

  const units = [];
  let seq = 0;

  const place = (agency) => {
    const pool = stations.filter((s) => s.agency === agency);
    return pool.length ? rng.pick(pool) : stations[0];
  };

  for (const spec of DCAS_FLEET) {
    for (let i = 0; i < spec.count; i++) {
      seq++;
      const home = place('DCAS');
      units.push({
        ref: `${spec.kind === 'BLS' || spec.kind === 'ALS' ? 'AMB' : spec.kind}-${pad(i + 1)}`,
        callsign: `${CALLSIGN[spec.kind] ?? spec.kind} ${i + 1}`,
        kind: spec.kind, agency: 'DCAS', homeId: home.id,
        capabilities: spec.capabilities, crew: spec.crew,
        lng: home.lng, lat: home.lat,
      });
    }
  }

  for (const spec of PARTNER_FLEET) {
    for (let i = 0; i < spec.count; i++) {
      const home = place(spec.agency);
      units.push({
        ref: `${spec.kind}-${pad(i + 1)}`,
        callsign: `${CALLSIGN[spec.kind] ?? spec.kind} ${i + 1}`,
        kind: spec.kind, agency: spec.agency, homeId: home.id,
        capabilities: spec.capabilities, crew: spec.crew,
        lng: home.lng, lat: home.lat,
      });
    }
  }

  // Deduplicate refs across BLS/ALS sharing the AMB prefix.
  const seen = new Set();
  for (const u of units) {
    let ref = u.ref, k = 1;
    while (seen.has(ref)) { ref = `${u.ref.split('-')[0]}-${pad(Number(u.ref.split('-')[1]) + 100 * k)}`; k++; }
    u.ref = ref;
    seen.add(ref);
  }

  await transaction(async (c) => {
    for (const u of units) {
      // Resting state: most on duty and available at their home station, a realistic
      // minority off duty or out of service. An empty map is a weak first impression.
      const roll = rng.next();
      const status = roll < 0.62 ? 'available'
        : roll < 0.74 ? 'standby'
        : roll < 0.80 ? 'out_of_service'
        : 'off_duty';
      const p = randomInCircle({ lng: u.lng, lat: u.lat }, status === 'standby' ? 1800 : 120, rng);

      await c.query(
        `INSERT INTO units (ref, callsign, kind, agency_id, home_station_id, capabilities,
                            crew_size, status, current_geom, current_heading, last_seen_at)
         VALUES ($1,$2,$3,(SELECT id FROM agencies WHERE code=$4),$5,$6,$7,$8,
                 ST_SetSRID(ST_MakePoint($9,$10),4326), $11, now())
         ON CONFLICT (ref) DO UPDATE SET
           callsign = EXCLUDED.callsign, kind = EXCLUDED.kind,
           home_station_id = EXCLUDED.home_station_id, capabilities = EXCLUDED.capabilities,
           status = EXCLUDED.status, current_geom = EXCLUDED.current_geom`,
        [u.ref, u.callsign, u.kind, u.agency, u.homeId, u.capabilities, u.crew, status,
         p.lng, p.lat, rng.int(0, 359)],
      );
    }
  });

  const dcas = units.filter((u) => u.agency === 'DCAS').length;
  log(`  units         ${units.length}  (${dcas} DCAS, ${units.length - dcas} partner agencies)`);
}

// ── Agency feeds ─────────────────────────────────────────────────────────────

async function seedFeeds(log) {
  const feeds = [
    { key: 'traffic',     agency: 'RTA',          name: 'Traffic signals & CCTV',   kind: 'signals',   cls: 'shared_confidential' },
    { key: 'bms',         agency: 'CIVIL_DEFENCE', name: 'Building management',      kind: 'buildings', cls: 'shared_sensitive' },
    { key: 'water',       agency: 'DEWA',         name: 'Water network',            kind: 'network',   cls: 'shared_confidential' },
    { key: 'waste',       agency: 'MUNICIPALITY', name: 'Waste & obstruction',      kind: 'bins',      cls: 'open' },
    { key: 'environment', agency: 'MUNICIPALITY', name: 'Air quality & wind',       kind: 'sensors',   cls: 'open' },
  ];
  await transaction(async (c) => {
    for (const f of feeds) {
      await c.query(
        `INSERT INTO agency_feeds (key, agency_id, name, kind, classification, is_simulated, last_update)
         VALUES ($1,(SELECT id FROM agencies WHERE code=$2),$3,$4,$5,true, now())
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, classification = EXCLUDED.classification,
           last_update = now()`,
        [f.key, f.agency, f.name, f.kind, f.cls],
      );
    }
  });
  log(`  feeds         ${feeds.length}  (all simulated — the UI shows a chip on each)`);
}

// ── Users ────────────────────────────────────────────────────────────────────

/** Every demo account signs in with this, except where a person below overrides it. */
const DEMO_PASSWORD = 'erss2026';
/** The account the room is shown the system with: `admin` / this, every capability. */
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Astrikos2026';

async function seedUsers(log) {
  const people = [
    // The demo administrator. `username` is what a visitor types — a ref is
    // `<rolecode>-<4 hex>` (docs/03 §1) and nobody remembers one of those at a
    // demonstration. The role is `admin`, which holds every capability in
    // lib/auth.js PERMISSIONS, so this one account reaches every console page.
    { ref: 'ADM-0001', name: 'Platform Administrator', role: 'admin',          agency: 'DCAS',
      username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    { ref: 'DSP-4A1C', name: 'Aisha Khalil',           role: 'dispatcher',     agency: 'DCAS' },
    { ref: 'DSP-7B2E', name: 'Omar Al Blooshi',        role: 'dispatcher',     agency: 'DCAS' },
    { ref: 'DUT-1F09', name: 'Mariam Al Suwaidi',      role: 'duty_officer',   agency: 'DCAS' },
    { ref: 'LED-2C55', name: 'Dr Khalid Al Marri',     role: 'service_lead',   agency: 'DCAS' },
    { ref: 'CRS-88A1', name: 'NCEMA Duty Officer',     role: 'crisis_centre',  agency: 'NCEMA' },
    { ref: 'POL-5D31', name: 'Maj. Saeed Al Nuaimi',   role: 'police_command', agency: 'POLICE' },
    { ref: 'HSP-9E42', name: 'Rashid Hospital Coordinator', role: 'hospital_coord', agency: 'DHA' },
    { ref: 'INF-3A77', name: 'RTA Control Room',       role: 'infra_operator', agency: 'RTA' },
    { ref: 'ANA-6B18', name: 'Fatima Hassan',          role: 'analyst',        agency: 'DCAS' },
    // Mobile: responder accounts are bound to a unit.
    { ref: 'RSP-AMB14', name: 'Paramedic Ali Saeed',   role: 'responder', agency: 'DCAS', unit: 'AMB-14' },
    { ref: 'RSP-PRV21', name: 'Cpl. Nasser Al Rashid', role: 'responder', agency: 'POLICE', unit: 'PRV-21' },
    { ref: 'RSP-FIR07', name: 'Capt. Saif Al Mazrouei', role: 'responder', agency: 'CIVIL_DEFENCE', unit: 'FIRE-07' },
    // Citizens.
    { ref: 'CIT-71BE', name: 'Layla Ahmed', role: 'citizen', agency: null, medical: {
      bloodGroup: 'O+', allergies: ['Penicillin'], conditions: ['Asthma'],
      medications: ['Salbutamol inhaler'], emergencyContact: { name: 'Yousef Ahmed', phone: '+971-50-000-0001' },
      language: 'en',
    } },
    { ref: 'CIT-33D9', name: 'Rahul Menon', role: 'citizen', agency: null, medical: null },
  ];

  // Hashed once per DISTINCT password rather than once per person — bcrypt at cost 12 is
  // deliberately slow, and fifteen accounts share two passwords between them.
  const hashes = new Map();
  for (const pw of new Set(people.map((p) => p.password ?? DEMO_PASSWORD))) {
    hashes.set(pw, await hashPassword(pw));
  }

  await transaction(async (c) => {
    for (const p of people) {
      await c.query(
        `INSERT INTO users (ref, name, username, role, agency_id, unit_id, password_hash, medical_profile)
         VALUES ($1,$2,$3,$4,
                 (SELECT id FROM agencies WHERE code=$5),
                 (SELECT id FROM units WHERE ref=$6),
                 $7,$8)
         ON CONFLICT (ref) DO UPDATE SET
           name = EXCLUDED.name, username = EXCLUDED.username, role = EXCLUDED.role,
           agency_id = EXCLUDED.agency_id, unit_id = EXCLUDED.unit_id,
           medical_profile = EXCLUDED.medical_profile,
           -- The seed is the source of truth for the demo accounts' passwords: re-running
           -- it must restore the documented credentials, not leave whatever an earlier
           -- seed set. There are no real people in this table.
           password_hash = EXCLUDED.password_hash`,
        [p.ref, p.name, p.username ?? null, p.role, p.agency, p.unit ?? null,
         hashes.get(p.password ?? DEMO_PASSWORD), p.medical ?? null],
      );
    }
  });

  log(`  users         ${people.length}  (${ADMIN_USERNAME} / ${ADMIN_PASSWORD} for full access; everyone else: ${DEMO_PASSWORD})`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');
const titleCase = (s) => s[0].toUpperCase() + s.slice(1);

function meanPoint(list) {
  return {
    lng: list.reduce((s, c) => s + c.lng, 0) / list.length,
    lat: list.reduce((s, c) => s + c.lat, 0) / list.length,
  };
}
const meanRadius = (list) => list.reduce((s, c) => s + c.radiusM, 0) / list.length;

/** Distribute `n` items across communities in proportion to population. */
function weightedCommunities(communities, n) {
  const total = communities.reduce((s, c) => s + c.pop, 0);
  const out = [];
  for (const cm of communities) {
    const share = Math.round((cm.pop / total) * n);
    for (let i = 0; i < share; i++) out.push(cm);
  }
  while (out.length < n) out.push(communities[out.length % communities.length]);
  return out.slice(0, n);
}
