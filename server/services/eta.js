/**
 * ETA service — wires OSRM (integrations/osrm.js) and the calibration table
 * (mv_eta_calibration) into the pure eta engine.
 *
 * The calibration is loaded once and kept for ten minutes: it changes only when the seed
 * or (later) the nightly recalibration rebuilds the view.
 */

import { pool } from '../lib/db.js';
import { nowMs } from '../lib/clock.js';
import { jurisdiction } from '../config/jurisdiction.js';
import * as osrm from '../integrations/osrm.js';
import { etaCalibration } from '../repos/reference.js';
import { buildCalibration, predictTravel, predictVrt, arrivalSec } from '../engines/eta.js';

const TTL_MS = 10 * 60_000;
let cache = null;
let loadedAt = 0;
let loading = null;

export async function calibration() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  if (!loading) {
    loading = etaCalibration(pool)
      .then(({ rows, window }) => {
        cache = buildCalibration(rows, window);
        loadedAt = Date.now();
        return cache;
      })
      .finally(() => { loading = null; });
  }
  return loading;
}

/** GST hour of a domain instant. Dubai observes no DST. */
export const gstHour = (ms = nowMs()) => (new Date(ms).getUTCHours() + 4) % 24;

/** GST hour-of-week, 0..167, Sunday 00:00 = 0 — the key mv_zone_hour_of_week uses. */
export function gstHourOfWeek(ms = nowMs()) {
  const d = new Date(ms + 4 * 3600_000);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

/** Midnight GST today, as an ISO instant. */
export function gstMidnightIso(ms = nowMs()) {
  const d = new Date(ms + 4 * 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 4 * 3600_000).toISOString();
}

export function haversineM([lng1, lat1], [lng2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/**
 * Travel from one point to another, with the road geometry when routing is up.
 * @returns {Promise<{ travel: object, route: { coordinates: Array<[number,number]>, distanceM: number, durationSec: number, cached: boolean } | null }>}
 */
export async function travel(from, to, { zoneClass, at = nowMs() }) {
  const cal = await calibration();
  const road = await osrm.route(from, to);
  const result = predictTravel(road
    ? { distanceM: road.distanceM, distanceSource: 'osrm', freeFlowSec: road.durationSec, gstHour: gstHour(at), zoneClass }
    : { distanceM: haversineM(from, to), distanceSource: 'straight_line', gstHour: gstHour(at), zoneClass }, cal);
  return { travel: result, route: road };
}

/**
 * Many origins to one destination — one OSRM table request for a whole candidate pool.
 * @returns {Promise<object[]>} one eta EngineResult per origin
 */
export async function travelMany(origins, destination, { zoneClass, at = nowMs() }) {
  const cal = await calibration();
  const roads = origins.length ? await osrm.toOne(origins, destination) : [];
  return origins.map((o, i) => predictTravel(roads[i]
    ? { distanceM: roads[i].distanceM, distanceSource: 'osrm', freeFlowSec: roads[i].durationSec, gstHour: gstHour(at), zoneClass }
    : { distanceM: haversineM(o, destination), distanceSource: 'straight_line', gstHour: gstHour(at), zoneClass }, cal));
}

/** One origin to many destinations (an incident to every hospital). */
export async function travelFromOne(origin, destinations, { zoneClass, at = nowMs() }) {
  const cal = await calibration();
  const roads = destinations.length ? await osrm.fromOne(origin, destinations) : [];
  return destinations.map((d, i) => predictTravel(roads[i]
    ? { distanceM: roads[i].distanceM, distanceSource: 'osrm', freeFlowSec: roads[i].durationSec, gstHour: gstHour(at), zoneClass }
    : { distanceM: haversineM(origin, d), distanceSource: 'straight_line', gstHour: gstHour(at), zoneClass }, cal));
}

export async function vrtFor(floor) {
  return predictVrt({ floor, ascentSecPerFloor: jurisdiction.vrt.ascentSecPerFloor }, await calibration());
}

export async function arrival(travelSec, stage) {
  return arrivalSec({ travelSec, stage }, await calibration());
}
