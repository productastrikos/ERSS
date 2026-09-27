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

export async function fetchRoadRoute(start: LngLat, end: LngLat, signal?: AbortSignal): Promise<RoadRoute> {
  if (config.osrmUrl) {
    try {
      const url = `${config.osrmUrl}/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}`
        + '?overview=full&geometries=geojson&steps=false';
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const body = await res.json() as {
        routes?: Array<{ geometry?: { coordinates?: LngLat[] }; distance?: number; duration?: number }>;
      };
      const route = body.routes?.[0];
      const path = route?.geometry?.coordinates ?? [];
      if (path.length > 1) {
        return { path, onRoad: true, distanceM: route?.distance ?? null, durationSec: route?.duration ?? null };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('[routing] OSRM unavailable, drawing a straight line:', err);
    }
  }

  // Forty points, so anything animating along it still moves smoothly.
  const path: LngLat[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    path.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  return { path, onRoad: false, distanceM: null, durationSec: null };
}
