/**
 * Reference data: zones, agencies, stations, hospitals, Makani, AEDs.
 * Read-mostly, cacheable, and the backbone of every map layer.
 */

import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../lib/db.js';
import { wrap, notFound, validation } from '../lib/errors.js';
import { jurisdiction } from '../config/jurisdiction.js';
import { CAMERAS } from '../data/reference/cameras.js';

const router = Router();

/** Short cache: reference data changes rarely, and the map asks for it on every load. */
const cache = (seconds) => (_req, res, next) => {
  res.set('Cache-Control', `private, max-age=${seconds}`);
  next();
};

// ── Zones ─────────────────────────────────────────────────────────────────────

router.get('/zones', cache(300), wrap(async (req, res) => {
  const q = z.object({
    level: z.enum(['emirate', 'sector', 'community', 'beat']).optional(),
    parent: z.string().optional(),
    geometry: z.enum(['full', 'centroid', 'none']).default('full'),
  }).safeParse(req.query);
  if (!q.success) throw validation(q.error.flatten().fieldErrors);
  const { level, parent, geometry } = q.data;

  const geomCol = geometry === 'full'
    ? 'ST_AsGeoJSON(z.geom)::json AS geometry'
    : geometry === 'centroid'
      ? 'ST_AsGeoJSON(z.centroid)::json AS geometry'
      : 'NULL AS geometry';

  const where = [];
  const params = [];
  if (level)  { params.push(level);  where.push(`z.level = $${params.length}`); }
  if (parent) { params.push(parent); where.push(`p.ref = $${params.length}`); }

  const rows = await many(
    `SELECT z.ref, z.name, z.name_ar, z.level, z.class,
            z.population, z.population_daytime, z.area_km2, z.highrise_ct,
            p.ref AS parent_ref, ${geomCol}
       FROM zones z LEFT JOIN zones p ON p.id = z.parent_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY z.level, z.ref`,
    params,
  );

  res.json({
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: {
        ref: r.ref, name: r.name, nameAr: r.name_ar, level: r.level, class: r.class,
        parentRef: r.parent_ref,
        population: r.population, populationDaytime: r.population_daytime,
        areaKm2: r.area_km2, highriseCount: r.highrise_ct,
      },
    })),
  });
}));

router.get('/zones/:ref', wrap(async (req, res) => {
  const row = await one(
    `SELECT z.ref, z.name, z.name_ar, z.level, z.class, z.population, z.population_daytime,
            z.area_km2, z.highrise_ct, p.ref AS parent_ref,
            ST_AsGeoJSON(z.geom)::json AS geometry,
            ST_AsGeoJSON(z.centroid)::json AS centroid
       FROM zones z LEFT JOIN zones p ON p.id = z.parent_id
      WHERE z.ref = $1`,
    [req.params.ref],
  );
  if (!row) throw notFound('Zone');
  const children = await many(
    `SELECT z.ref, z.name, z.level FROM zones z
      JOIN zones p ON p.id = z.parent_id WHERE p.ref = $1 ORDER BY z.ref`,
    [req.params.ref],
  );
  res.json({ ...row, children });
}));

// ── Agencies ──────────────────────────────────────────────────────────────────

router.get('/agencies', cache(600), wrap(async (_req, res) => {
  res.json(await many(
    `SELECT code, name, short_name, emergency_no, glyph, series_slot,
            is_responder, sla_ack_sec, sla_scene_sec
       FROM agencies ORDER BY series_slot`,
  ));
}));

// ── Stations ──────────────────────────────────────────────────────────────────

router.get('/stations', cache(300), wrap(async (req, res) => {
  const agency = req.query.agency;
  // dispatchable=true by default: Dubai's 33 Smart Police Stations are UNMANNED, and
  // a caller asking "where can I send a unit from" must not be handed a kiosk.
  const dispatchableOnly = req.query.dispatchable !== 'false';

  const where = ['TRUE'];
  const params = [];
  if (agency) { params.push(agency); where.push(`a.code = $${params.length}`); }
  if (dispatchableOnly) where.push('s.dispatchable');

  const rows = await many(
    `SELECT s.ref, s.name, s.kind, s.dispatchable, s.makani, s.bays,
            a.code AS agency_code, z.ref AS zone_ref,
            ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat
       FROM stations s
       JOIN agencies a ON a.id = s.agency_id
       LEFT JOIN zones z ON z.id = s.zone_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.code, s.ref`,
    params,
  );
  res.json(rows.map(shapePoint));
}));

// ── Hospitals ─────────────────────────────────────────────────────────────────

router.get('/hospitals', cache(60), wrap(async (req, res) => {
  const capability = req.query.capability;
  const params = [];
  let filter = '';
  if (capability) { params.push(capability); filter = `WHERE $${params.length} = ANY(h.capabilities)`; }

  const rows = await many(
    `SELECT h.ref, h.name, h.area, h.operator_class, h.makani,
            h.ed_beds, h.ed_occupied, h.on_diversion, h.capabilities,
            z.ref AS zone_ref, ST_X(h.geom) AS lng, ST_Y(h.geom) AS lat
       FROM hospitals h LEFT JOIN zones z ON z.id = h.zone_id
       ${filter}
      ORDER BY h.name`,
    params,
  );
  res.json(rows.map((r) => ({
    ...shapePoint(r),
    edBeds: r.ed_beds,
    edOccupied: r.ed_occupied,
    edLoadPct: r.ed_beds ? Math.round((r.ed_occupied / r.ed_beds) * 100) : null,
    onDiversion: r.on_diversion,
    operatorClass: r.operator_class,
  })));
}));

// ── Makani ────────────────────────────────────────────────────────────────────

router.get('/makani/:code', wrap(async (req, res) => {
  const code = String(req.params.code).replace(/\s/g, '');
  if (!/^\d{10}$/.test(code)) throw validation({ code: ['Makani must be exactly 10 digits'] });

  const row = await one(
    `SELECT m.makani, m.building_name, m.makani_address, m.entrance_no, m.entrance_count,
            m.entrance_role, m.floors, m.parcel_id, m.community_no,
            z.ref AS zone_ref, z.name AS zone_name,
            ST_X(m.geom) AS lng, ST_Y(m.geom) AS lat,
            ST_AsGeoJSON(m.building_geom)::json AS building
       FROM makani_points m LEFT JOIN zones z ON z.id = m.zone_id
      WHERE m.makani = $1`,
    [code],
  );
  if (!row) throw notFound('Makani point');

  // Sibling entrances. The real Makani index assigns a SEPARATE number to every
  // entrance, so a building is a one-to-many relationship — and "entrance 4 of 11" is
  // the whole point of the system for emergency response.
  const siblings = row.building_name
    ? await many(
        `SELECT makani, entrance_no, entrance_role, ST_X(geom) AS lng, ST_Y(geom) AS lat
           FROM makani_points WHERE building_name = $1 AND makani <> $2
          ORDER BY entrance_no`,
        [row.building_name, code],
      )
    : [];

  res.json({
    makani: row.makani,
    formatted: `${row.makani.slice(0, 5)} ${row.makani.slice(5)}`,
    buildingName: row.building_name,
    address: row.makani_address,
    entranceNo: row.entrance_no,
    entranceCount: row.entrance_count,
    entranceRole: row.entrance_role,
    floors: row.floors,
    parcelId: row.parcel_id,
    communityNo: row.community_no,
    zoneRef: row.zone_ref,
    zoneName: row.zone_name,
    lng: row.lng, lat: row.lat,
    buildingGeometry: row.building,
    otherEntrances: siblings,
    simulated: true,   // drives the "simulated source" chip — see docs/09 §1
  });
}));

router.get('/makani/reverse/search', wrap(async (req, res) => {
  const q = z.object({
    lng: z.coerce.number().min(-180).max(180),
    lat: z.coerce.number().min(-90).max(90),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  }).safeParse(req.query);
  if (!q.success) throw validation(q.error.flatten().fieldErrors);
  const { lng, lat, limit } = q.data;

  const rows = await many(
    `SELECT makani, building_name, entrance_no, entrance_count, entrance_role, floors,
            ST_X(geom) AS lng, ST_Y(geom) AS lat,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist_m
       FROM makani_points
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326)
      LIMIT $3`,
    [lng, lat, limit],
  );
  res.json(rows.map((r) => ({
    makani: r.makani,
    formatted: `${r.makani.slice(0, 5)} ${r.makani.slice(5)}`,
    buildingName: r.building_name,
    entranceNo: r.entrance_no,
    entranceCount: r.entrance_count,
    entranceRole: r.entrance_role,
    floors: r.floors,
    lng: r.lng, lat: r.lat,
    distanceM: Math.round(r.dist_m),
  })));
}));

// ── AEDs ──────────────────────────────────────────────────────────────────────

router.get('/aeds', cache(120), wrap(async (req, res) => {
  const q = z.object({
    lng: z.coerce.number().optional(),
    lat: z.coerce.number().optional(),
    radius: z.coerce.number().int().min(50).max(5000).default(500),
  }).safeParse(req.query);
  if (!q.success) throw validation(q.error.flatten().fieldErrors);
  const { lng, lat, radius } = q.data;

  if (lng !== undefined && lat !== undefined) {
    const rows = await many(
      `SELECT ref, site_name, site_kind, makani, telemetry, available,
              ST_X(geom) AS lng, ST_Y(geom) AS lat,
              ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist_m
         FROM aeds
        WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
        ORDER BY dist_m LIMIT 25`,
      [lng, lat, radius],
    );
    return res.json(rows.map((r) => ({ ...shapeAed(r), distanceM: Math.round(r.dist_m) })));
  }

  const rows = await many(
    `SELECT ref, site_name, site_kind, makani, telemetry, available,
            ST_X(geom) AS lng, ST_Y(geom) AS lat
       FROM aeds ORDER BY ref`,
  );
  res.json(rows.map(shapeAed));
}));

// ── Jurisdiction constants (for anything the client computes locally) ─────────

router.get('/jurisdiction', cache(3600), wrap(async (_req, res) => {
  res.json(jurisdiction);
}));

// ── Cameras ───────────────────────────────────────────────────────────────────

/**
 * The camera estate the detection engine watches. Reference data: the map draws it
 * whether or not anything is happening, and a detection cites cameras from it by id.
 */
router.get('/cameras', cache(300), wrap(async (_req, res) => {
  res.json(CAMERAS.map((c) => ({
    id: c.id, name: c.name, kind: c.kind, agencyCode: c.agencyCode,
    lng: c.lng, lat: c.lat, bearing: c.bearing, fovDeg: c.fovDeg, rangeM: c.rangeM,
    signalId: c.signalId, buildingId: c.buildingId, floor: c.floor, roomId: c.roomId,
    analytics: c.analytics,
    clipUrl: c.clipUrl, idleClipUrl: c.idleClipUrl,
  })));
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function shapePoint(r) {
  return {
    ref: r.ref, name: r.name, kind: r.kind ?? null,
    dispatchable: r.dispatchable ?? true,
    agencyCode: r.agency_code ?? null,
    zoneRef: r.zone_ref ?? null,
    makani: r.makani ?? null,
    bays: r.bays ?? null,
    capabilities: r.capabilities ?? undefined,
    lng: r.lng, lat: r.lat,
  };
}

function shapeAed(r) {
  return {
    ref: r.ref, siteName: r.site_name, siteKind: r.site_kind, makani: r.makani,
    // DCAS runs a telemetry-enabled PAD network: opening a cabinet transmits to the
    // control room and auto-generates a high-acuity incident.
    telemetry: r.telemetry, available: r.available,
    lng: r.lng, lat: r.lat,
  };
}

export default router;
