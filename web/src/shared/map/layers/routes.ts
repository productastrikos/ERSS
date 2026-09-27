/**
 * Routes — proposed versus taken, the pre-empt corridor, and trips playback.
 *
 * Per docs/05 §7.5: proposed in --app-accent 3px at 60% dashed; taken in --app-text 3px
 * solid; the corridor as an --app-accent-bg band; signals held for the unit as amber
 * diamonds. Lines are MapLibre-native because MapLibre dashes natively and deck.gl
 * would need an extension package for it.
 */

import { IconLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Feature, LineString } from 'geojson';
import { defineLayer } from '../layerRegistry';
import { diamondIcon } from '../icons/shapes';
import { css, rgba } from '../tokens';
import { memoOn } from './kit';

type Path = Array<[number, number]>;

export interface RouteOverlay {
  /** Assignment ref. */
  ref: string;
  proposed?: Path | null;
  taken?: Path | null;
  corridor?: Path | null;
  heldSignals?: Array<{ id: string; lng: number; lat: number }>;
  /** Unit movement for playback: one timestamp per vertex, in the cursor's unit. */
  trail?: { path: Path; timestamps: number[] } | null;
}

export interface RoutesData {
  routes: RouteOverlay[];
  /** Playback cursor for trails — scenario seconds in replay. Omit to hide trails. */
  cursor?: number | null;
}

type Kind = 'proposed' | 'taken' | 'corridor';

const heldSignals = memoOn((d: RoutesData) =>
  d.routes.flatMap((r) => (r.heldSignals ?? []).map((s) => ({ ...s, route: r.ref }))));
const trails = memoOn((d: RoutesData) =>
  d.routes.filter((r) => r.trail && r.trail.path.length > 1).map((r) => ({ ref: r.ref, ...r.trail! })));

export const routesLayer = defineLayer<RoutesData>({
  id: 'routes',
  group: 'operational',
  label: 'map.layer.routes',
  order: 70,
  defaultVisible: true,
  source: { kind: 'feed' },
  legend: [
    { label: 'map.legend.routeProposed', swatch: { kind: 'dashed', token: '--app-accent' } },
    { label: 'map.legend.routeTaken', swatch: { kind: 'line', token: '--app-text' } },
    { label: 'map.legend.routeCorridor', swatch: { kind: 'fill', token: '--app-accent-border' } },
    { label: 'map.legend.signalHeld', swatch: { kind: 'diamond', token: '--app-accent' } },
  ],

  maplibre: {
    sources: (data) => {
      const features: Array<Feature<LineString, { ref: string; kind: Kind }>> = [];
      for (const r of data.routes) {
        for (const kind of ['corridor', 'taken', 'proposed'] as const) {
          const path = r[kind];
          if (path && path.length > 1) {
            features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: { ref: r.ref, kind } });
          }
        }
      }
      return { 'routes:lines': { type: 'geojson', data: { type: 'FeatureCollection', features } } };
    },
    layers: () => [
      {
        id: 'routes:corridor',
        type: 'line',
        source: 'routes:lines',
        filter: ['==', ['get', 'kind'], 'corridor'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': css('--app-accent-bg'), 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 28] },
      },
      {
        id: 'routes:taken',
        type: 'line',
        source: 'routes:lines',
        filter: ['==', ['get', 'kind'], 'taken'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': css('--app-text'), 'line-width': 3 },
      },
      {
        id: 'routes:proposed',
        type: 'line',
        source: 'routes:lines',
        filter: ['==', ['get', 'kind'], 'proposed'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': css('--app-accent', 0.6), 'line-width': 3, 'line-dasharray': [2, 1.5] },
      },
    ],
  },

  deck: (data, ctx) => {
    const layers = [];
    const held = heldSignals(data);
    if (held.length) {
      layers.push(new IconLayer({
        id: 'routes:held-signals',
        data: held,
        sizeUnits: 'pixels',
        getPosition: (s) => [s.lng, s.lat],
        getIcon: () => diamondIcon(),
        getSize: 13,
        getColor: rgba('--app-accent'),
        updateTriggers: { getColor: [ctx.theme] },
      }));
    }
    const playback = trails(data);
    if (playback.length && data.cursor != null) {
      layers.push(new TripsLayer({
        id: 'routes:trails',
        data: playback,
        getPath: (d) => d.path,
        getTimestamps: (d) => d.timestamps,
        getColor: rgba('--app-accent'),
        widthUnits: 'pixels',
        getWidth: 4,
        capRounded: true,
        jointRounded: true,
        fadeTrail: true,
        trailLength: 120,
        currentTime: data.cursor,
        updateTriggers: { getColor: [ctx.theme] },
      }));
    }
    return layers;
  },
});
