/**
 * Transport feed (RTA) — signals, corridor congestion, the accident scene and its CCTV.
 *
 * MIGRATED from DSOMap.tsx (the traffic-signal/congestion effect and its load-time
 * sources). What changed and why:
 *
 * - Signal colour is the STATUS palette (--app-success / --app-warning / --app-danger)
 *   instead of hard-coded greens and reds; a faulted or offline signal goes faint.
 * - HTML markers rendered with react-icons became a deck.gl disc with a lit "lamp";
 *   the signal popup is React, with the live phase countdown driven by component state
 *   instead of getElementById writes into setHTML markup.
 * - The OSRM fetch, the /roads fetch from a hard-coded host, and road-name matching no
 *   longer run inside a render effect. The matching and snapping are moved verbatim as
 *   pure helpers below; routing moved to lib/routing.ts. A feed prepares the snapshot,
 *   the layer only draws it.
 * - Emergency vehicles are units on routes in ERSS, so they are drawn by the units and
 *   routes layers (held signals included), not by a traffic-specific marker.
 *
 * The data contract is the Transport feed snapshot; Phase 9 registers the feed.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { Feature, FeatureCollection, Geometry, LineString } from 'geojson';
import { defineLayer, type LayerContext } from '../../layerRegistry';
import { css, rgba, type Tone, TONE_TOKEN } from '../../tokens';
import { discMarker, label, pulsePhase } from '../kit';
import { TrafficPopup } from '../../popups/AgencyPopups';

type LngLat = [number, number];

// ── Feed contract ────────────────────────────────────────────────────────────

export type SignalPhase = 'RED' | 'YELLOW' | 'GREEN' | 'FLASHING';
export type CongestionLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SignalPoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  phase: SignalPhase;
  /** Seconds left in the current phase, as last reported. */
  phaseRemainingSec: number | null;
  greenSec: number;
  redSec: number;
  cycleSec: number;
  /** Vehicles per km on the approaches. */
  density: number;
  connectedRoads: number;
  status: 'ACTIVE' | 'FAULT' | 'OFFLINE';
  /** Held for an emergency vehicle by the pre-empt engine. */
  held?: boolean;
  cameraUrl?: string | null;
}

export interface CongestionSegment {
  id: string;
  name: string;
  path: LngLat[];
  level: CongestionLevel;
  avgSpeedKph?: number | null;
  vehicleCount?: number | null;
}

export interface TrafficAccident {
  id: string;
  name: string;
  lng: number;
  lat: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  cameraUrl?: string | null;
}

export interface TrafficFeed {
  signals: SignalPoint[];
  congestion: CongestionSegment[];
  /** Junction nodes detected from the road graph — context for the signals. */
  intersections?: LngLat[];
  accident?: TrafficAccident | null;
}

// ── Encoding ─────────────────────────────────────────────────────────────────

const PHASE_TONE: Record<SignalPhase, Tone> = { GREEN: 'success', YELLOW: 'warning', FLASHING: 'warning', RED: 'danger' };
const LEVEL_TONE: Record<CongestionLevel, Tone> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'warning', CRITICAL: 'danger' };

export const signalTone = (s: Pick<SignalPoint, 'phase' | 'status'>): Tone =>
  (s.status !== 'ACTIVE' ? 'neutral' : PHASE_TONE[s.phase]);

/** The CCTV clips shipped in web/public/media, assigned to signals by index. */
export const cctvClip = (index: number) => `/media/traffic_cctv_${(index % 13) + 1}.mp4`;
export const ACCIDENT_CCTV_CLIP = '/media/traffic_accident_cctv.mp4';

/** DSOMap's Google-Maps-style crawl: the gap slides forward half a unit every 80 ms. */
const DASH_SEQUENCE: number[][] = Array.from({ length: 8 }, (_, k) =>
  (k < 7 ? [k / 2, 4, 3 - k / 2] : [3.5, 3.5, 0.5]));

// ── Descriptor ───────────────────────────────────────────────────────────────

export const trafficLayer = defineLayer<TrafficFeed>({
  id: 'traffic',
  group: 'agency',
  label: 'map.layer.traffic',
  order: 50,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  animated: (d) => d.congestion.length > 0 || !!d.accident || d.signals.some((s) => s.phase === 'FLASHING'),
  legend: [
    { label: 'map.legend.flowFree', swatch: { kind: 'line', token: TONE_TOKEN.success } },
    { label: 'map.legend.flowHeavy', swatch: { kind: 'line', token: TONE_TOKEN.warning } },
    { label: 'map.legend.flowBlocked', swatch: { kind: 'line', token: TONE_TOKEN.danger } },
    { label: 'map.legend.signalHeld', swatch: { kind: 'ring', token: '--app-accent' } },
  ],

  maplibre: {
    sources: (d) => ({
      'traffic:congestion': {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: d.congestion.filter((c) => c.path.length > 1).map((c): Feature<LineString> => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: c.path },
            properties: { id: c.id, name: c.name, level: c.level },
          })),
        },
      },
    }),
    layers: () => {
      const levelColour = (level: CongestionLevel) => css(TONE_TOKEN[LEVEL_TONE[level]]);
      return [
        {
          id: 'traffic:congestion-band',
          type: 'line',
          source: 'traffic:congestion',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'level'],
              'LOW', levelColour('LOW'), 'MEDIUM', levelColour('MEDIUM'),
              'HIGH', levelColour('HIGH'), levelColour('CRITICAL')],
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 10],
            'line-opacity': 0.55,
            'line-blur': 2,
          },
        },
        {
          id: 'traffic:congestion-flow',
          type: 'line',
          source: 'traffic:congestion',
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': css('--app-text', 0.55),
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 3.5],
            'line-dasharray': DASH_SEQUENCE[0],
          },
        },
      ];
    },
    animate: (ctx) => (ctx.reducedMotion ? [] : [{
      layer: 'traffic:congestion-flow',
      property: 'line-dasharray',
      value: DASH_SEQUENCE[Math.floor(ctx.time / 80) % DASH_SEQUENCE.length],
    }]),
  },

  deck: (d, ctx) => [
    new ScatterplotLayer<LngLat>({
      id: 'traffic:intersections',
      data: d.intersections ?? [],
      visible: ctx.zoom >= 14,
      radiusUnits: 'pixels',
      getPosition: (p) => p,
      getRadius: 3,
      getFillColor: rgba('--app-text-faint', 0.7),
      updateTriggers: { getFillColor: [ctx.theme] },
    }),
    ...signalMarkers(d.signals, ctx),
    ...accidentMarkers(d.accident ?? null, ctx),
  ],

  pick: (hit, d) => {
    if (hit.source !== 'deck') return null;
    if (hit.layerId.startsWith('traffic:signals')) {
      const s = hit.object as SignalPoint;
      const index = d.signals.findIndex((x) => x.id === s.id);
      return {
        layerId: 'traffic', kind: 'signal', id: s.id, lngLat: [s.lng, s.lat],
        data: { ...s, cameraUrl: s.cameraUrl ?? cctvClip(Math.max(0, index)) },
      };
    }
    if (hit.layerId.startsWith('traffic:camera') && d.accident) {
      const a = d.accident;
      return { layerId: 'traffic', kind: 'camera', id: a.id, lngLat: [a.lng, a.lat], data: { ...a, cameraUrl: a.cameraUrl ?? ACCIDENT_CCTV_CLIP } };
    }
    return null;
  },
  popup: TrafficPopup,
});

function signalMarkers(signals: SignalPoint[], ctx: LayerContext) {
  // FLASHING blinks at 1 Hz; under reduced motion it holds steady.
  const blinkOn = ctx.reducedMotion || Math.floor(ctx.time / 500) % 2 === 0;
  const lamp = (s: SignalPoint) => rgba(TONE_TOKEN[signalTone(s)], s.phase === 'FLASHING' && !blinkOn ? 0.25 : 1);
  const heldIds = new Set(signals.filter((s) => s.held).map((s) => s.id));

  return [
    new ScatterplotLayer<SignalPoint>({
      id: 'traffic:signals-disc',
      data: signals,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (s) => [s.lng, s.lat],
      getRadius: 9,
      getFillColor: rgba('--app-panel'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (s) => (heldIds.has(s.id) ? 3 : 2),
      getLineColor: (s) => (heldIds.has(s.id) ? rgba('--app-accent') : rgba(TONE_TOKEN[signalTone(s)])),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme, signals], getLineWidth: [signals] },
    }),
    new ScatterplotLayer<SignalPoint>({
      id: 'traffic:signals-lamp',
      data: signals,
      radiusUnits: 'pixels',
      getPosition: (s) => [s.lng, s.lat],
      getRadius: 4,
      getFillColor: lamp,
      updateTriggers: { getFillColor: [ctx.theme, signals, blinkOn] },
    }),
    label({
      id: 'traffic:signals',
      data: signals,
      ctx,
      position: (s) => [s.lng, s.lat],
      text: (s) => (s.status === 'ACTIVE' ? s.phase : s.status),
      offset: [0, 19],
      size: 9,
      bold: true,
      visible: ctx.zoom >= 15.5,
      triggers: [signals],
    }),
  ];
}

function accidentMarkers(accident: TrafficAccident | null, ctx: LayerContext) {
  if (!accident) return [];
  const data = [accident];
  const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 1600);
  // The camera sits just off the scene, where DSOMap put its CCTV marker.
  const camera = [{ ...accident, lng: accident.lng + 0.0006, lat: accident.lat + 0.0004 }];

  return [
    new ScatterplotLayer<TrafficAccident>({
      id: 'traffic:accident-pulse',
      data,
      radiusUnits: 'pixels',
      getPosition: (a) => [a.lng, a.lat],
      getRadius: 12,
      radiusScale: 1 + phase * 2,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-danger'),
      opacity: ctx.reducedMotion ? 0.5 : 0.9 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
    new ScatterplotLayer<TrafficAccident>({
      id: 'traffic:accident',
      data,
      radiusUnits: 'pixels',
      getPosition: (a) => [a.lng, a.lat],
      getRadius: 10,
      getFillColor: rgba('--app-danger'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-panel'),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
    label({
      id: 'traffic:accident',
      data,
      ctx,
      position: (a) => [a.lng, a.lat],
      text: (a) => a.name,
      offset: [0, -24],
      size: 11,
      bold: true,
    }),
    ...discMarker({
      id: 'traffic:camera',
      data: camera,
      ctx,
      position: (a) => [a.lng, a.lat],
      glyph: () => 'cctv',
      ring: () => rgba('--app-info'),
      glyphColor: () => rgba('--app-info'),
      radius: 9,
    }),
  ];
}

// ── Feed preparation — moved from DSOMap.tsx, logic unchanged ─────────────────

/**
 * Junctions in a road network: a node shared by three or more distinct ways.
 * (DSOMap `detectIntersections`.)
 */
export function detectIntersections(roads: FeatureCollection<Geometry, Record<string, unknown>>): LngLat[] {
  const owners = new Map<string, Set<unknown>>();
  const coords = new Map<string, LngLat>();
  roads.features.forEach((f, i) => {
    if (f.geometry?.type !== 'LineString') return;
    const way = f.properties?.osm_id ?? `way-${i}`;
    for (const c of f.geometry.coordinates) {
      const key = `${c[0].toFixed(4)}_${c[1].toFixed(4)}`;
      if (!owners.has(key)) { owners.set(key, new Set()); coords.set(key, [c[0], c[1]]); }
      owners.get(key)!.add(way);
    }
  });
  return [...owners].filter(([, set]) => set.size >= 3).map(([key]) => coords.get(key)!);
}

/** Snap a point to the nearest junction within ~300 m. (DSOMap `snapSignalToIntersection`.) */
export function snapToIntersection(point: LngLat, intersections: LngLat[], maxDeg = 0.003): LngLat {
  let best: LngLat | null = null;
  let bestD = Infinity;
  for (const x of intersections) {
    const d = Math.hypot(x[0] - point[0], x[1] - point[1]);
    if (d < maxDeg && d < bestD) { bestD = d; best = x; }
  }
  return best ?? point;
}

/**
 * Colour real road geometry by simulated congestion: an OSM road takes a segment's
 * level when their names share a run of at least six characters. Strict on purpose —
 * a short fragment would colour half the network. (DSOMap `enrichRoadsWithCongestion`.)
 */
export function matchCongestion(
  roads: FeatureCollection<Geometry, Record<string, unknown>>,
  segments: Array<Pick<CongestionSegment, 'name' | 'level'>>,
): CongestionSegment[] {
  const out: CongestionSegment[] = [];
  roads.features.forEach((f, i) => {
    if (f.geometry?.type !== 'LineString') return;
    const name = String(f.properties?.name ?? '');
    if (name.length < 5) return;
    const osm = name.toLowerCase().trim();
    const hit = segments.find((s) => longestCommonRun(s.name.toLowerCase().replace(/ \(.*\)/, '').trim(), osm) >= 6);
    if (hit) {
      out.push({ id: String(f.properties?.osm_id ?? `road-${i}`), name, path: f.geometry.coordinates as LngLat[], level: hit.level });
    }
  });
  return out;
}

function longestCommonRun(a: string, b: string): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let l = 0;
      while (i + l < a.length && j + l < b.length && a[i + l] === b[j + l]) l++;
      if (l > max) max = l;
    }
  }
  return max;
}
