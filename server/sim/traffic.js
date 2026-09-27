/**
 * Traffic on a road route — SIMULATED, and labelled so wherever it is shown.
 *
 * There is no live traffic feed in this build: the public router (OSRM) knows the roads
 * and their free-flow speeds, not the queue at the lights. So congestion is modelled, and
 * modelled only where it matters — along the road an ambulance is actually driving. The
 * map draws the congested stretches of THAT road in red and nothing else; the city-wide
 * corridor picture it replaced answered a question nobody on a response asks.
 *
 * Two causes, both deterministic so every screen agrees and a replay reproduces them:
 *
 *   traffic     a smooth spatial field (value noise on a ~420 m grid) thresholded by the
 *               hour: Dubai's morning and evening peaks congest more of the network than
 *               the middle of the night. Keyed to a 30-minute slot, so it moves through
 *               the day without flickering during one response.
 *   collision   the queue behind a live road incident. A crew driving to a crash meets
 *               its tail in the last few hundred metres — which is exactly what the
 *               dispatcher should see coming.
 *
 * It is not decoration: the simulation DRIVES through it (sim/live.js slows the vehicle
 * inside a red stretch) and the dispatch engine can score candidates with it
 * (services/dispatchRules.js `avoidTraffic`). A real feed (TomTom, HERE, RTA) would
 * replace `fieldAt` and nothing else.
 */

import { pool } from '../lib/db.js';

/** Ambulance speed inside a congested stretch, as a share of its free-flow speed. Under
 *  lights and siren traffic parts, so the crew is slowed, not stopped. */
export const FACTOR = { moderate: 0.62, heavy: 0.4 };

/** Free-flow emergency driving speed used to turn a slowed stretch into seconds. */
const FREE_MPS = 15;

const CELL_DEG = 0.0038;
const SLOT_MS = 30 * 60_000;
const SAMPLE_M = 40;
/** Shorter than this is a set of lights, not a queue. */
const MIN_RUN_M = 180;
/** Two queues this close together are one queue. */
const MERGE_GAP_M = 70;

const R = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── The field ────────────────────────────────────────────────────────────────

/** Integer hash → [0, 1). Stable across runs and machines. */
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(lng, lat, slot) {
  const gx = lng / CELL_DEG;
  const gy = lat / CELL_DEG;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const v00 = hash3(x0, y0, slot);
  const v10 = hash3(x0 + 1, y0, slot);
  const v01 = hash3(x0, y0 + 1, slot);
  const v11 = hash3(x0 + 1, y0 + 1, slot);
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/** Gulf Standard Time hour, 0..23, whatever zone the server runs in. */
const gstHour = (ms) => new Date(ms + 4 * 3600_000).getUTCHours();

/** How much of the network the hour congests: 1 at the peaks, near 0 at night. */
function peakness(hour) {
  if (hour >= 7 && hour < 9) return 1;
  if (hour >= 17 && hour < 20) return 1;
  if (hour >= 13 && hour < 15) return 0.6;
  if (hour >= 9 && hour < 17) return 0.45;
  if (hour >= 20 && hour < 23) return 0.4;
  return 0.12;
}

/** Congestion 0..1 at a point, this slot. Two octaves, so queues have a shape. */
function fieldAt(lng, lat, slot) {
  return 0.7 * valueNoise(lng, lat, slot) + 0.3 * valueNoise(lng * 2.3 + 7.1, lat * 2.3 - 3.7, slot + 11);
}

// ── Live incidents: the queues behind them ───────────────────────────────────

let queueCache = { at: 0, items: [] };

/**
 * Every live road incident, as a queue: a radius of heavy traffic around it. Cached for
 * five seconds — the map polls every three and the simulation plans a route per leg.
 */
export async function activeQueues() {
  if (Date.now() - queueCache.at < 5000) return queueCache.items;
  try {
    const { rows } = await pool.query(`
      SELECT i.ref, i.priority, ST_X(i.geom) AS lng, ST_Y(i.geom) AS lat
        FROM incidents i
       WHERE i.state NOT IN ('closed', 'cancelled') AND NOT i.is_seed AND NOT i.is_resting
         AND i.floor IS NULL AND i.source = 'sensor'`);
    queueCache = {
      at: Date.now(),
      items: rows.map((r) => ({ ref: r.ref, lng: r.lng, lat: r.lat, radiusM: r.priority === 'P1' || r.priority === 'P2' ? 380 : 220 })),
    };
  } catch {
    queueCache = { at: Date.now(), items: queueCache.items };
  }
  return queueCache.items;
}

// ── A route, analysed ────────────────────────────────────────────────────────

function cumulative(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return cum;
}

function pointAt(coords, cum, d) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The part of a polyline between two distances along it, endpoints interpolated. */
export function slice(coords, cum, fromM, toM) {
  const out = [pointAt(coords, cum, fromM)];
  for (let i = 1; i < coords.length - 1; i++) if (cum[i] > fromM && cum[i] < toM) out.push(coords[i]);
  out.push(pointAt(coords, cum, toM));
  return out;
}

/**
 * The congested stretches of one route.
 *
 * @param {Array<[number, number]>} coords
 * @param {{ at?: number, queues?: Array<{ ref: string, lng: number, lat: number, radiusM: number }> }} [opts]
 * @returns {{ totalM: number, congestedM: number, delaySec: number, simulated: true,
 *   segments: Array<{ fromM: number, toM: number, lengthM: number, level: 'moderate'|'heavy',
 *   factor: number, cause: 'traffic'|'collision', incidentRef: string|null, delaySec: number,
 *   path: Array<[number, number]> }> }}
 */
export function analyseRoute(coords, { at = Date.now(), queues = [] } = {}) {
  if (!coords || coords.length < 2) return { totalM: 0, congestedM: 0, delaySec: 0, segments: [], simulated: true };
  const cum = cumulative(coords);
  const totalM = cum[cum.length - 1];
  const slot = Math.floor(at / SLOT_MS);
  const p = peakness(gstHour(at));
  // The share of the field that counts as congested grows with the hour's peakness.
  const moderateAt = 0.77 - 0.12 * p;
  const heavyAt = moderateAt + 0.1;

  // Classify every sample along the road.
  const samples = [];
  for (let d = 0; d <= totalM; d += SAMPLE_M) {
    const pt = pointAt(coords, cum, d);
    const q = queues.find((x) => haversine(pt, [x.lng, x.lat]) <= x.radiusM);
    if (q) { samples.push({ d, level: 'heavy', cause: 'collision', incidentRef: q.ref }); continue; }
    const v = fieldAt(pt[0], pt[1], slot);
    samples.push({ d, level: v >= heavyAt ? 'heavy' : v >= moderateAt ? 'moderate' : null, cause: 'traffic', incidentRef: null });
  }

  // Runs of congested samples → segments; tiny runs dropped, near neighbours merged.
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (!s.level) continue;
    if (last && s.d - last.toM <= SAMPLE_M + MERGE_GAP_M && last.cause === s.cause) {
      last.toM = Math.min(totalM, s.d + SAMPLE_M / 2);
      if (s.level === 'heavy') last.heavyM += SAMPLE_M;
      continue;
    }
    runs.push({
      fromM: Math.max(0, s.d - SAMPLE_M / 2), toM: Math.min(totalM, s.d + SAMPLE_M / 2),
      heavyM: s.level === 'heavy' ? SAMPLE_M : 0, cause: s.cause, incidentRef: s.incidentRef,
    });
  }

  const segments = runs
    .filter((r) => r.toM - r.fromM >= (r.cause === 'collision' ? SAMPLE_M : MIN_RUN_M))
    .map((r) => {
      const lengthM = r.toM - r.fromM;
      const level = r.cause === 'collision' || r.heavyM >= lengthM * 0.5 ? 'heavy' : 'moderate';
      const factor = FACTOR[level];
      return {
        fromM: Math.round(r.fromM), toM: Math.round(r.toM), lengthM: Math.round(lengthM), level, factor,
        cause: r.cause, incidentRef: r.incidentRef,
        delaySec: Math.round((lengthM / FREE_MPS) * (1 / factor - 1)),
        path: slice(coords, cum, r.fromM, r.toM),
      };
    });

  return {
    totalM: Math.round(totalM),
    congestedM: segments.reduce((s, x) => s + x.lengthM, 0),
    delaySec: segments.reduce((s, x) => s + x.delaySec, 0),
    segments,
    simulated: true,
  };
}

/** The speed factor at a distance along the route (1 outside every congested stretch). */
export function factorAt(segments, distM) {
  for (const s of segments ?? []) if (distM >= s.fromM && distM < s.toM) return s.factor;
  return 1;
}

/**
 * The stretches still AHEAD of a vehicle that has travelled `travelledM`, their paths cut
 * to start under it, with the delay each still costs.
 */
export function ahead(segments, travelledM, coords, cum) {
  const out = [];
  for (const s of segments ?? []) {
    if (s.toM <= travelledM) continue;
    const fromM = Math.max(s.fromM, travelledM);
    const share = (s.toM - fromM) / Math.max(1, s.toM - s.fromM);
    out.push({
      ...s,
      fromM: Math.round(fromM),
      inM: Math.round(Math.max(0, s.fromM - travelledM)),
      lengthM: Math.round(s.toM - fromM),
      delaySec: Math.round(s.delaySec * share),
      path: fromM > s.fromM && coords && cum ? slice(coords, cum, fromM, s.toM) : s.path,
    });
  }
  return out;
}

export { cumulative };
