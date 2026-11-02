/**
 * Road routing through OSRM (docs/00 D-05, O-6).
 *
 * Moved from DSOMap.tsx (`fetchRoadRoute`). The map never fetched routes itself in the
 * new architecture — a feed or page asks for a route and hands the geometry to the
 * routes layer — so this lives in lib/ beside the API client.
 *
 * It never throws: a failed or unconfigured OSRM falls back to a straight line, flagged
 * as such, so a flaky demo network degrades the drawing rather than breaking the screen.
 * Phase 5 moves ETA-grade routing server-side (engines/eta.js with caching).
 */

import { config } from './config';

export type LngLat = [number, number];

export interface RoadRoute {
  path: LngLat[];
  /** false when OSRM was unavailable and the path is a straight-line stand-in. */
  onRoad: boolean;
  distanceM: number | null;
  durationSec: number | null;
}

/** A public routing server is usually quick and occasionally slow or rate-limited: a
 *  slow answer gets a second and third chance before anything is drawn off the road. */
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_PAUSE_MS = [0, 1200, 2500];

async function attempt(url: string, signal?: AbortSignal): Promise<RoadRoute | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const body = await res.json() as {
      routes?: Array<{ geometry?: { coordinates?: LngLat[] }; distance?: number; duration?: number }>;
    };
    const route = body.routes?.[0];
    const path = route?.geometry?.coordinates ?? [];
    return path.length > 1
      ? { path, onRoad: true, distanceM: route?.distance ?? null, durationSec: route?.duration ?? null }
      : null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchRoadRoute(start: LngLat, end: LngLat, signal?: AbortSignal): Promise<RoadRoute> {
  if (config.osrmUrl) {
    const url = `${config.osrmUrl}/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}`
      + '?overview=full&geometries=geojson&steps=false';
    for (let i = 0; i < ATTEMPTS; i++) {
      if (RETRY_PAUSE_MS[i]) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS[i]));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const road = await attempt(url, signal);
        if (road) return road;
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
    console.warn('[routing] OSRM did not answer after', ATTEMPTS, 'attempts — drawing a straight line');
  }

  // Forty points, so anything animating along it still moves smoothly.
  const path: LngLat[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    path.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  return { path, onRoad: false, distanceM: null, durationSec: null };
}
