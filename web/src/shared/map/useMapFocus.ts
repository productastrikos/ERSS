/**
 * Camera moves, in one place: fly to a point, fit a set of points, follow a unit.
 *
 * Every move honours prefers-reduced-motion by jumping instead of flying — the same
 * rule the rest of the motion system follows (docs/05 §8). Following is view state
 * (MapViewState.follow), so a unit popup and a page button toggle the same thing;
 * MapCanvas does the tracking.
 */

import { useCallback, type RefObject } from 'react';
import { LngLatBounds } from 'maplibre-gl';
import type { MapCanvasHandle } from './MapCanvas';
import { setFollow } from './layerRegistry';

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MapFocus {
  flyTo: (lngLat: [number, number], zoom?: number) => void;
  fitTo: (points: Array<[number, number]>, opts?: { padding?: number; maxZoom?: number }) => void;
  /** Track a moving object drawn by `layerId`; `null` stops. */
  follow: (layerId: string | null, id?: string) => void;
  /** Track it AND ride with it: tilt in behind and turn with its heading. */
  chase: (layerId: string | null, id?: string) => void;
}

export function useMapFocus(handle: RefObject<MapCanvasHandle | null>): MapFocus {
  const flyTo = useCallback((lngLat: [number, number], zoom?: number) => {
    const map = handle.current?.map();
    if (!map) return;
    const opts = { center: lngLat, zoom: zoom ?? Math.max(map.getZoom(), 14) };
    if (prefersReducedMotion()) map.jumpTo(opts);
    else map.flyTo({ ...opts, duration: 900, essential: true });
  }, [handle]);

  const fitTo = useCallback((points: Array<[number, number]>, opts: { padding?: number; maxZoom?: number } = {}) => {
    const map = handle.current?.map();
    if (!map || !points.length) return;
    if (points.length === 1) {
      flyTo(points[0], opts.maxZoom ?? 15);
      return;
    }
    const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
    map.fitBounds(bounds, {
      padding: opts.padding ?? 64,
      maxZoom: opts.maxZoom ?? 16,
      duration: prefersReducedMotion() ? 0 : 700,
    });
  }, [handle, flyTo]);

  const follow = useCallback((layerId: string | null, id?: string) => {
    const view = handle.current?.view;
    if (!view) return;
    setFollow(view, layerId && id ? { layerId, id } : null);
  }, [handle]);

  const chase = useCallback((layerId: string | null, id?: string) => {
    const view = handle.current?.view;
    if (!view) return;
    setFollow(view, layerId && id ? { layerId, id, chase: true } : null);
  }, [handle]);

  return { flyTo, fitTo, follow, chase };
}
