/**
 * OSRM road routing — the integration seam. docs/00 D-05, O-6.
 *
 * Road distance and geometry for the eta engine. Three layers, fastest first:
 *
 *   1. memory   — the last few hundred lookups in this process
 *   2. database — route_cache, so a route fetched once survives a restart and a demo on a
 *                 hotel network replays what rehearsal fetched
 *   3. network  — OSRM_URL, with a hard timeout
 *
 * It NEVER throws. When OSRM is down or slow it returns null and the engine falls back
 * to a straight line with a widened interval, which it labels. Three failures in a row
 * open the circuit for twenty seconds, so a dead OSRM costs a few timeouts, not one per
 * dispatch. Background geometry (the road an ambulance drives) ignores the circuit: it is
 * off the dispatch path, and a public server's occasional slow answer must not put a
 * vehicle on a straight line. /health reports the counters and the last failure.
 *
 * `durationSec` here is OSRM's FREE-FLOW figure. It is reported for reference and is never
 * presented as an arrival time — engines/eta.js turns distance into a calibrated one.
 */

import { env } from '../config/env.js';
import { query } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/** The public server answers in under a second, but a cold TLS connection or a busy
 *  moment can take a few — 2.5 s was tripping on ordinary slowness. */
const TIMEOUT_MS = 4000;
/** Geometry for the map is fetched after the dispatch commits, so it can afford to wait. */
export const BACKGROUND_TIMEOUT_MS = 8000;
const CIRCUIT_OPEN_MS = 20_000;
/** Slow answers from a public server are not an outage; three in a row are treated as one. */
const FAILURES_TO_OPEN = 3;
/** Between attempts at the same route: a fresh connection, after a breath. */
const RETRY_PAUSE_MS = 700;
let consecutiveFailures = 0;
const MEMORY_MAX = 800;

/** ~1 m precision. Keys are direction-sensitive: one-way streets make A→B ≠ B→A. */
const coord = ([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
const keyFor = (from, to) => `osrm:driving:${coord(from)};${coord(to)}`;

const memory = new Map();
let circuitOpenUntil = 0;
/** The last failure, reported by /health so a degraded seam explains itself. */
let lastError = null;
const counters = { network: 0, cache: 0, failed: 0 };

function remember(key, value) {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

export const isConfigured = () => Boolean(env.osrmUrl);
export const circuitOpen = () => Date.now() < circuitOpenUntil;

async function fetchJson(path, timeoutMs = TIMEOUT_MS, { ignoreCircuit = false } = {}) {
  if (!env.osrmUrl || (!ignoreCircuit && circuitOpen())) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  counters.network++;
  try {
    const res = await fetch(`${env.osrmUrl}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    // A 4xx with an OSRM code is a problem with THIS request (a point it cannot snap),
    // not an outage: fall back for this call, keep the circuit closed.
    if (res.status >= 400 && res.status < 500 && res.status !== 429 && body?.code) {
      counters.failed++;
      lastError = { at: new Date().toISOString(), message: `${res.status} ${body.code}: ${body.message ?? ''}`.trim(), circuit: false };
      logger.warn({ status: res.status, code: body.code, path: path.slice(0, 80) }, '[osrm] request rejected — straight-line fallback for this call');
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (body?.code !== 'Ok') throw new Error(body?.code ?? 'unreadable response');
    consecutiveFailures = 0;
    return body;
  } catch (err) {
    // Unreachable, slow, rate-limited (429) or erroring. This call falls back; a second
    // failure in a row stops asking for a minute.
    counters.failed++;
    consecutiveFailures++;
    const open = consecutiveFailures >= FAILURES_TO_OPEN;
    if (open) circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    const message = err.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`;
    lastError = { at: new Date().toISOString(), message, afterMs: Date.now() - started, circuit: open };
    logger.warn({ err: message, path: path.slice(0, 80) },
      open ? '[osrm] unavailable — straight-line fallback for 60 s' : '[osrm] slow or failed — straight-line fallback for this call');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromDb(keys, needGeometry) {
  if (!keys.length) return new Map();
  const { rows } = await query(
    `UPDATE route_cache SET hits = hits + 1
      WHERE key = ANY($1) ${needGeometry ? 'AND geom IS NOT NULL' : ''}
      RETURNING key, distance_m, duration_sec,
                CASE WHEN geom IS NULL THEN NULL ELSE ST_AsGeoJSON(geom)::json END AS geometry`,
    [keys],
  ).catch((err) => {
    logger.warn({ err: err.message }, '[osrm] route_cache read failed');
    return { rows: [] };
  });
  return new Map(rows.map((r) => [r.key, {
    distanceM: r.distance_m, durationSec: r.duration_sec,
    coordinates: r.geometry?.coordinates ?? null, provider: 'osrm', cached: true,
  }]));
}

async function toDb(key, v) {
  await query(
    `INSERT INTO route_cache (key, provider, distance_m, duration_sec, geom)
     VALUES ($1, 'osrm', $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) END)
     ON CONFLICT (key) DO UPDATE SET
       distance_m = EXCLUDED.distance_m, duration_sec = EXCLUDED.duration_sec,
       geom = COALESCE(EXCLUDED.geom, route_cache.geom), fetched_at = now()`,
    [key, Math.round(v.distanceM), Math.round(v.durationSec),
     v.coordinates ? JSON.stringify({ type: 'LineString', coordinates: v.coordinates }) : null],
  ).catch((err) => logger.warn({ err: err.message }, '[osrm] route_cache write failed'));
}

/**
 * One route, with geometry.
 * @param {[number, number]} from  [lng, lat]
 * @param {[number, number]} to    [lng, lat]
 * @param {{ timeoutMs?: number, attempts?: number, background?: boolean }} [opts]
 *   background: off the dispatch path — asks even while the circuit is open
 * @returns {Promise<{ distanceM: number, durationSec: number, coordinates: Array<[number, number]>, provider: 'osrm', cached: boolean } | null>}
 */
export async function route(from, to, { timeoutMs = TIMEOUT_MS, attempts = 1, background = false } = {}) {
  const key = keyFor(from, to);
  const hit = memory.get(key);
  if (hit?.coordinates) return hit;

  const db = (await fromDb([key], true)).get(key);
  if (db) { remember(key, db); return db; }

  // A retry after a timeout goes out on a fresh connection: the aborted request took its
  // socket with it, which clears the observed failure mode — a pooled keep-alive
  // connection silently dropped by the network after a quiet spell.
  let body = null;
  for (let attempt = 0; attempt < attempts && !body; attempt++) {
    if (attempt > 0) {
      if (circuitOpen() && !background) break;
      await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    }
    body = await fetchJson(
      `/route/v1/driving/${coord(from)};${coord(to)}?overview=full&geometries=geojson&steps=false`,
      timeoutMs,
      { ignoreCircuit: background },
    );
  }
  const r = body?.routes?.[0];
  if (!r || !r.geometry?.coordinates?.length) return null;
  const value = {
    distanceM: r.distance, durationSec: r.duration, coordinates: r.geometry.coordinates,
    provider: 'osrm', cached: false,
  };
  remember(key, value);
  await toDb(key, value);
  return value;
}

/**
 * OpenStreetMap names many of the catchment's roads in Arabic only. The console and the
 * crew's co-pilot speak English, so the roads the trial actually uses are given their
 * signed English names, and the numbered streets ("شارع 37", "26b شارع") read as a driver
 * says them ("Street 37"). Anything unknown is passed through untouched.
 */
const ROAD_EN = {
  'شارع الروية': 'Al Ruwayyah St',
  'شارع المدينة العالمية 1': 'International City St 1',
  'شارع المنامة': 'Manama St',
  'طريق المنامة': 'Manama Rd',
  'شارع الجزائر': 'Algeria St',
  'شارع الشيخ محمد بن زايد': 'Sheikh Mohammed Bin Zayed Rd (E311)',
  'طريق الخوانيج': 'Al Khawaneej Rd',
  'شارع طرابلس': 'Tripoli St',
  'شارع العوير': 'Al Awir Rd',
  'طريق دبي - العين': 'Dubai–Al Ain Rd (E66)',
  'شارع الشيخ زايد بن حمدان آل نهيان': 'Sheikh Zayed bin Hamdan Al Nahyan St',
  'شارع ورسان 1': 'Warsan St 1',
  'شارع نواكشوط': 'Nouakchott St',
  'شارع الورقاء 1': 'Al Warqa St 1',
  'شارع الإمارات': 'Emirates Rd (E611)',
  'شارع الباز 2': 'Al Baz St 2',
};
export function englishRoad(name) {
  if (!name) return name ?? null;
  const n = name.trim();
  if (ROAD_EN[n]) return ROAD_EN[n];
  let m = /^شارع\s+([\w\d]+)$/u.exec(n) ?? /^([\w\d]+)\s+شارع$/u.exec(n);
  if (m) return `Street ${m[1]}`;
  m = /^طريق\s+(.+)$/u.exec(n);
  if (m && /^[\x20-\x7E]+$/.test(m[1])) return `${m[1]} Rd`;
  return n;
}

/**
 * Every reasonable road for one journey — the main route and up to two alternatives —
 * each with its manoeuvres and the free-flow speed of every segment. This is what lets the
 * AI choose a ROUTE the way a driver would (engines/drive.js): fewer turns, fewer
 * roundabouts, more of the distance on main roads, not just the shortest line on the map.
 *
 * Cached like `route`: memory, then `route_options_cache`, then the network.
 *
 * @returns {Promise<Array<{ distanceM: number, durationSec: number, coords: Array<[number, number]>,
 *   steps: Array<{ type: string, modifier: string|null, name: string|null, location: [number, number], distance: number }>,
 *   speeds: number[] }> | null>}
 */
export async function routeOptions(from, to, { timeoutMs = BACKGROUND_TIMEOUT_MS, attempts = 2, background = true } = {}) {
  const key = `osrm:options:${coord(from)};${coord(to)}`;
  const hit = memory.get(key);
  if (hit) return hit;

  if (optionsTable !== false) {
    const row = await query('SELECT body FROM route_options_cache WHERE key = $1', [key])
      .then((r) => r.rows[0] ?? null)
      .catch((err) => {
        if (optionsTable === null) logger.warn({ err: err.message }, '[osrm] route_options_cache unavailable — run `npm run db:schema`; options kept in memory only');
        optionsTable = false;
        return null;
      });
    if (row?.body?.length) { optionsTable = true; remember(key, row.body); return row.body; }
  }

  let body = null;
  for (let attempt = 0; attempt < attempts && !body; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    body = await fetchJson(
      `/route/v1/driving/${coord(from)};${coord(to)}?overview=full&geometries=geojson&steps=true&alternatives=2&annotations=speed`,
      timeoutMs,
      { ignoreCircuit: background },
    );
  }
  if (!body?.routes?.length) return null;
  const options = body.routes
    .filter((r) => r.geometry?.coordinates?.length > 1)
    .map((r) => ({
      distanceM: Math.round(r.distance),
      durationSec: Math.round(r.duration),
      coords: r.geometry.coordinates,
      steps: (r.legs?.[0]?.steps ?? []).map((s) => ({
        type: s.maneuver?.type ?? null,
        modifier: s.maneuver?.modifier ?? null,
        name: englishRoad(s.name || s.ref || null),
        location: s.maneuver?.location ?? null,
        distance: Math.round(s.distance ?? 0),
      })),
      speeds: r.legs?.[0]?.annotation?.speed ?? [],
    }));
  if (!options.length) return null;
  remember(key, options);
  if (optionsTable !== false) {
    await query(
      `INSERT INTO route_options_cache (key, body) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, fetched_at = now()`,
      [key, JSON.stringify(options)],
    ).catch(() => { optionsTable = false; });
  }
  return options;
}
/** null = not yet known, true = present, false = missing (memory only until a restart). */
let optionsTable = null;

/**
 * Many origins to ONE destination, distances and free-flow durations only — what a
 * dispatch recommendation needs for its candidate pool, in one request.
 *
 * @param {Array<[number, number]>} origins
 * @param {[number, number]} destination
 * @returns {Promise<Array<{ distanceM: number, durationSec: number, provider: 'osrm', cached: boolean } | null>>}
 */
export async function toOne(origins, destination) {
  const keys = origins.map((o) => keyFor(o, destination));
  const out = keys.map((k) => memory.get(k) ?? null);

  const missing = keys.filter((k, i) => !out[i]);
  if (missing.length) {
    const db = await fromDb(missing, false);
    keys.forEach((k, i) => {
      if (!out[i] && db.has(k)) { out[i] = db.get(k); remember(k, out[i]); }
    });
  }

  const todo = origins.map((o, i) => (out[i] ? null : i)).filter((i) => i !== null);
  if (todo.length) {
    const coords = [...todo.map((i) => coord(origins[i])), coord(destination)].join(';');
    const sources = todo.map((_, j) => j).join(';');
    const body = await fetchJson(
      `/table/v1/driving/${coords}?sources=${sources}&destinations=${todo.length}&annotations=duration,distance`,
    );
    if (body) {
      for (let j = 0; j < todo.length; j++) {
        const distanceM = body.distances?.[j]?.[0];
        const durationSec = body.durations?.[j]?.[0];
        if (distanceM == null || durationSec == null) continue;   // unroutable (e.g. a marine unit)
        const i = todo[j];
        const value = { distanceM, durationSec, coordinates: null, provider: 'osrm', cached: false };
        out[i] = value;
        remember(keys[i], value);
        await toDb(keys[i], value);
      }
    }
  }
  return out;
}

/**
 * ONE origin to many destinations — an incident to every hospital, in one request.
 * @param {[number, number]} origin
 * @param {Array<[number, number]>} destinations
 */
export async function fromOne(origin, destinations) {
  const keys = destinations.map((d) => keyFor(origin, d));
  const out = keys.map((k) => memory.get(k) ?? null);

  const missing = keys.filter((k, i) => !out[i]);
  if (missing.length) {
    const db = await fromDb(missing, false);
    keys.forEach((k, i) => {
      if (!out[i] && db.has(k)) { out[i] = db.get(k); remember(k, out[i]); }
    });
  }

  const todo = destinations.map((d, i) => (out[i] ? null : i)).filter((i) => i !== null);
  if (todo.length) {
    const coords = [coord(origin), ...todo.map((i) => coord(destinations[i]))].join(';');
    const dests = todo.map((_, j) => j + 1).join(';');
    const body = await fetchJson(
      `/table/v1/driving/${coords}?sources=0&destinations=${dests}&annotations=duration,distance`,
    );
    if (body) {
      for (let j = 0; j < todo.length; j++) {
        const distanceM = body.distances?.[0]?.[j];
        const durationSec = body.durations?.[0]?.[j];
        if (distanceM == null || durationSec == null) continue;
        const i = todo[j];
        const value = { distanceM, durationSec, coordinates: null, provider: 'osrm', cached: false };
        out[i] = value;
        remember(keys[i], value);
        await toDb(keys[i], value);
      }
    }
  }
  return out;
}

/**
 * Candidate points snapped onto the road network, with the road distance from one origin
 * to each — ONE table request, which answers both. For placing an incident on a real road
 * a short drive away. Null when routing does not answer.
 *
 * @param {[number, number]} origin
 * @param {Array<[number, number]>} points
 * @returns {Promise<Array<{ location: [number, number], name: string|null, distanceM: number, snapM: number } | null> | null>}
 */
export async function snapAndMeasure(origin, points) {
  const coords = [coord(origin), ...points.map(coord)].join(';');
  const body = await fetchJson(`/table/v1/driving/${coords}?sources=0&annotations=distance`, BACKGROUND_TIMEOUT_MS, { ignoreCircuit: true });
  if (!body?.destinations) return null;
  return points.map((_, j) => {
    const w = body.destinations[j + 1];
    const d = body.distances?.[0]?.[j + 1];
    return w?.location && d != null ? { location: w.location, name: englishRoad(w.name || null), distanceM: d, snapM: w.distance ?? 0 } : null;
  });
}

/** For /health-style reporting and the seam-status panel. */
export function status() {
  return {
    configured: isConfigured(),
    circuitOpen: circuitOpen(),
    memoryEntries: memory.size,
    requests: counters.network,
    failures: counters.failed,
    lastError,
  };
}
