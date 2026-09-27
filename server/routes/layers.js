/**
 * Base map layers — the eight GeoJSON routes ported from the retired FastAPI service
 * (`_archive/dso_api/routes/*.py`). Response shapes are preserved EXACTLY so existing
 * map code keeps working through the migration.
 *
 * Two sources, chosen at boot:
 *
 *   1. **osm2pgsql tables** (`planet_osm_line`, `planet_osm_polygon`, `planet_osm_point`)
 *      if they exist in the database — the original DSO path, unchanged.
 *   2. **Pre-baked GeoJSON** in `server/data/geo/` otherwise.
 *
 * Decision D-05 is not to import OpenStreetMap: the basemap comes from CARTO vector
 * tiles and the operational data comes from our own tables. These routes exist for the
 * close-up scenes (DSO, Marina, Downtown) where real building and road geometry is
 * wanted, and the baked files cover exactly those.
 */

import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { many, one } from '../lib/db.js';
import { wrap, validation, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = Router();
const GEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'geo');

/** Default extent — Dubai Silicon Oasis, the original DSO envelope. */
const DEFAULT_BBOX = [55.355, 25.085, 55.415, 25.155];

/** Resolved once at first use: are the osm2pgsql tables present? */
let osmAvailable = null;
async function hasOsmTables() {
  if (osmAvailable !== null) return osmAvailable;
  try {
    const row = await one(`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('planet_osm_line','planet_osm_polygon','planet_osm_point')
    `);
    osmAvailable = (row?.n ?? 0) === 3;
  } catch {
    osmAvailable = false;
  }
  logger.info({ osmAvailable }, osmAvailable
    ? '[layers] osm2pgsql tables found — serving live geometry'
    : '[layers] no osm2pgsql tables — serving pre-baked GeoJSON from server/data/geo/');
  return osmAvailable;
}

const bboxSchema = z.object({
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional(),
});

function parseBbox(req) {
  const q = bboxSchema.safeParse(req.query);
  if (!q.success) throw validation({ bbox: ['expected minLng,minLat,maxLng,maxLat'] });
  if (!q.data.bbox) return DEFAULT_BBOX;
  const parts = q.data.bbox.split(',').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) throw validation({ bbox: ['all four values must be numbers'] });
  return parts;
}

/** Serve a pre-baked file, optionally clipped to a bbox in memory. */
async function serveBaked(name, bbox) {
  const path = join(GEO_DIR, `${name}.geojson`);
  if (!existsSync(path)) {
    // An empty FeatureCollection, not a 404: a missing optional detail layer should
    // leave the map usable rather than breaking it.
    logger.warn({ layer: name }, '[layers] baked file missing — returning empty collection');
    return { type: 'FeatureCollection', features: [], meta: { source: 'none', layer: name } };
  }
  const fc = JSON.parse(await readFile(path, 'utf8'));
  if (!bbox) return { ...fc, meta: { source: 'baked', layer: name } };

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const features = fc.features.filter((f) => {
    const c = firstCoord(f.geometry);
    return c && c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat;
  });
  return { type: 'FeatureCollection', features, meta: { source: 'baked', layer: name, clipped: true } };
}

function firstCoord(geom) {
  if (!geom) return null;
  let c = geom.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === 'number' ? c : null;
}

/** Build a FeatureCollection from rows with `geom` (GeoJSON string) + properties. */
function toFeatureCollection(rows, propKeys, meta = {}) {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => {
      const properties = {};
      for (const k of propKeys) properties[k] = r[k] ?? null;
      return { type: 'Feature', geometry: JSON.parse(r.geom), properties };
    }),
    meta: { source: 'postgis', ...meta },
  };
}

const ENVELOPE = 'way && ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,4326), 3857)';

// ── /roads ────────────────────────────────────────────────────────────────────

router.get('/roads', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('roads', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, highway, ref, surface, oneway,
            tags->'maxspeed' AS maxspeed, tags->'lanes' AS lanes, tags->'lit' AS lit,
            tags->'bridge'   AS bridge,   tags->'tunnel' AS tunnel
       FROM planet_osm_line
      WHERE highway IS NOT NULL AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows,
    ['osm_id', 'name', 'highway', 'ref', 'surface', 'oneway', 'maxspeed', 'lanes', 'lit', 'bridge', 'tunnel'],
    { layer: 'roads' }));
}));

// ── /buildings ────────────────────────────────────────────────────────────────

router.get('/buildings', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('buildings', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, building, amenity, shop, tourism,
            tags->'height'           AS height,
            tags->'building:levels'  AS levels,
            tags->'building:use'     AS building_use,
            tags->'addr:street'      AS street,
            tags->'addr:housenumber' AS housenumber,
            tags->'operator'         AS operator,
            tags->'website'          AS website
       FROM planet_osm_polygon
      WHERE building IS NOT NULL AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows,
    ['osm_id', 'name', 'building', 'amenity', 'shop', 'tourism', 'height', 'levels',
     'building_use', 'street', 'housenumber', 'operator', 'website'],
    { layer: 'buildings' }));
}));

// ── /pois ─────────────────────────────────────────────────────────────────────

router.get('/pois', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('pois', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, amenity, shop, tourism, leisure, office,
            tags->'cuisine' AS cuisine, tags->'phone' AS phone, tags->'website' AS website
       FROM planet_osm_point
      WHERE (amenity IS NOT NULL OR shop IS NOT NULL OR tourism IS NOT NULL
             OR leisure IS NOT NULL OR office IS NOT NULL)
        AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows,
    ['osm_id', 'name', 'amenity', 'shop', 'tourism', 'leisure', 'office', 'cuisine', 'phone', 'website'],
    { layer: 'pois' }));
}));

// ── /parks ────────────────────────────────────────────────────────────────────

router.get('/parks', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('parks', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, leisure, landuse, "natural"
       FROM planet_osm_polygon
      WHERE (leisure IN ('park','garden','pitch','playground','sports_centre')
             OR landuse IN ('grass','recreation_ground','forest','village_green')
             OR "natural" IN ('wood','scrub','grassland'))
        AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows, ['osm_id', 'name', 'leisure', 'landuse', 'natural'], { layer: 'parks' }));
}));

// ── /water ────────────────────────────────────────────────────────────────────

router.get('/water', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('water', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, "natural", waterway, landuse
       FROM planet_osm_polygon
      WHERE ("natural" = 'water' OR waterway IS NOT NULL OR landuse = 'reservoir')
        AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows, ['osm_id', 'name', 'natural', 'waterway', 'landuse'], { layer: 'water' }));
}));

// ── /railways ─────────────────────────────────────────────────────────────────

router.get('/railways', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('railways', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, railway, tags->'network' AS network, tags->'operator' AS operator
       FROM planet_osm_line
      WHERE railway IS NOT NULL AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows, ['osm_id', 'name', 'railway', 'network', 'operator'], { layer: 'railways' }));
}));

// ── /infrastructure ───────────────────────────────────────────────────────────

router.get('/infrastructure', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  if (!(await hasOsmTables())) return res.json(await serveBaked('infrastructure', bbox));

  const rows = await many(
    `SELECT ST_AsGeoJSON(ST_Transform(way, 4326)) AS geom,
            osm_id, name, power, man_made, amenity,
            tags->'operator' AS operator, tags->'voltage' AS voltage
       FROM planet_osm_point
      WHERE (power IS NOT NULL OR man_made IS NOT NULL
             OR amenity IN ('fire_station','police','hospital','fuel','charging_station'))
        AND ${ENVELOPE}
      ORDER BY osm_id`,
    bbox,
  );
  res.json(toFeatureCollection(rows,
    ['osm_id', 'name', 'power', 'man_made', 'amenity', 'operator', 'voltage'], { layer: 'infrastructure' }));
}));

// ── /all — everything for a bbox in one call ──────────────────────────────────

router.get('/all', wrap(async (req, res) => {
  const bbox = parseBbox(req);
  const names = ['roads', 'buildings', 'pois', 'parks', 'water', 'railways', 'infrastructure'];

  if (!(await hasOsmTables())) {
    const entries = await Promise.all(names.map(async (n) => [n, await serveBaked(n, bbox)]));
    return res.json({ bbox, source: 'baked', layers: Object.fromEntries(entries) });
  }

  // Re-dispatch through this router so there is exactly one query per layer, defined once.
  const layers = {};
  for (const n of names) {
    const sub = { query: { bbox: bbox.join(',') } };
    // eslint-disable-next-line no-await-in-loop
    layers[n] = await new Promise((resolve, reject) => {
      const fakeRes = { json: resolve };
      const handler = router.stack.find((l) => l.route?.path === `/${n}`)?.route?.stack[0]?.handle;
      if (!handler) return reject(notFound(`Layer ${n}`));
      handler(sub, fakeRes, reject);
    });
  }
  res.json({ bbox, source: 'postgis', layers });
}));

export default router;
