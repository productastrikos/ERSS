/**
 * Utility feed (DEWA) — the water network: pipelines, nodes, and a pipeline break.
 *
 * MIGRATED from DSOMap.tsx (the water pipeline effect). What changed and why:
 *
 * - Pipe class (main / distribution / service) is carried by line WIDTH; the blue /
 *   green / purple class hues are gone, so colour is free to mean status alone:
 *   burst or leak in danger, low pressure in warning, an isolating valve closed in
 *   strong warning, the backup route in success.
 * - Emoji node markers (💧 🏭 🚒 …) became lucide glyphs in discs, ringed by status.
 * - Burst blink, flow dashes and the spill pulse are declared animations on the shared
 *   clock rather than three competing requestAnimationFrame loops, and all three stop
 *   under prefers-reduced-motion.
 * - The inline-HTML node popups became a React popup.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import { defineLayer, type LayerContext } from '../../layerRegistry';
import { css, rgba, TONE_TOKEN, type Tone } from '../../tokens';
import type { GlyphName } from '../../icons/glyphs';
import { discMarker, memoOn, pulsePhase } from '../kit';
import { WaterPopup } from '../../popups/AgencyPopups';

type LngLat = [number, number];

// ── Feed contract ────────────────────────────────────────────────────────────

export type WaterNodeKind = 'source' | 'treatment' | 'storage' | 'pump' | 'tap' | 'hydrant' | 'drinking' | 'building';
export type PipeClass = 'main' | 'distribution' | 'service';
export type PipeStatus = 'normal' | 'low_pressure' | 'leak' | 'burst' | 'closed' | 'backup';

export interface WaterNode {
  id: string;
  kind: WaterNodeKind;
  name: string;
  lng: number;
  lat: number;
  status: 'active' | 'warning' | 'critical' | 'offline';
  pressurePsi?: number | null;
  flowLpm?: number | null;
  population?: number | null;
  capacityL?: number | null;
  /** Downstream of the current break. */
  affected?: boolean;
}

export interface WaterPipe {
  id: string;
  class: PipeClass;
  status: PipeStatus;
  path: LngLat[];
  pressurePsi?: number | null;
  flowLpm?: number | null;
}

export interface WaterBreak {
  id: string;
  pipeId: string;
  kind: 'leak' | 'burst' | 'low_pressure' | 'contamination';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  lng: number;
  lat: number;
  affectedUsers?: number | null;
  pressureDropPsi?: number | null;
}

export interface WaterFeed {
  nodes: WaterNode[];
  pipes: WaterPipe[];
  incident?: WaterBreak | null;
}

// ── Encoding ─────────────────────────────────────────────────────────────────

const NODE_GLYPH: Record<WaterNodeKind, GlyphName> = {
  source: 'waves', treatment: 'factory', storage: 'container', pump: 'gauge',
  tap: 'droplet', hydrant: 'fire-extinguisher', drinking: 'droplets', building: 'building',
};

export const nodeTone = (n: WaterNode): Tone =>
  (n.affected || n.status === 'critical' ? 'danger'
    : n.status === 'warning' ? 'warning'
      : n.status === 'offline' ? 'neutral' : 'info');

const PIPE_TOKEN: Record<PipeStatus, string> = {
  normal: '--app-info',
  low_pressure: '--app-warning',
  leak: '--app-danger-soft',
  burst: '--app-danger',
  closed: '--app-warning-strong',
  backup: '--app-success',
};

/** DSOMap's flow crawl: the dash offset slides a sixth of a unit per step. */
const flowDash = (step: number) => [step / 6, 4, 3];

const affectedNodes = memoOn((d: WaterFeed) => d.nodes.filter((n) => n.affected));

// ── Descriptor ───────────────────────────────────────────────────────────────

export const waterLayer = defineLayer<WaterFeed>({
  id: 'water',
  group: 'agency',
  label: 'map.layer.water',
  order: 54,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  animated: (d) => d.pipes.length > 0,
  legend: [
    { label: 'map.water.pipeNormal', swatch: { kind: 'line', token: PIPE_TOKEN.normal } },
    { label: 'map.water.pipeLowPressure', swatch: { kind: 'line', token: PIPE_TOKEN.low_pressure } },
    { label: 'map.water.pipeBreak', swatch: { kind: 'line', token: PIPE_TOKEN.burst } },
    { label: 'map.water.pipeClosed', swatch: { kind: 'dashed', token: PIPE_TOKEN.closed } },
    { label: 'map.water.pipeBackup', swatch: { kind: 'line', token: PIPE_TOKEN.backup } },
  ],

  maplibre: {
    sources: (d) => ({
      'water:pipes': {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: d.pipes.filter((p) => p.path.length > 1).map((p): Feature<LineString> => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: p.path },
            properties: { id: p.id, class: p.class, status: p.status },
          })),
        },
      },
    }),

    layers: () => {
      const colour: ExpressionSpecification = ['match', ['get', 'status'],
        'low_pressure', css(PIPE_TOKEN.low_pressure), 'leak', css(PIPE_TOKEN.leak), 'burst', css(PIPE_TOKEN.burst),
        'closed', css(PIPE_TOKEN.closed), 'backup', css(PIPE_TOKEN.backup), css(PIPE_TOKEN.normal)];
      const width: ExpressionSpecification = ['match', ['get', 'class'], 'main', 3.5, 'distribution', 2.2, 1.4];
      const faded: ExpressionSpecification = ['match', ['get', 'class'], 'main', 0.9, 'distribution', 0.75, 0.55];

      return [
        // The isolating valve's reach and the backup route glow, so the response plan
        // reads at a glance.
        {
          id: 'water:glow', type: 'line', source: 'water:pipes',
          filter: ['in', ['get', 'status'], ['literal', ['closed', 'backup']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colour, 'line-width': 10, 'line-opacity': 0.2, 'line-blur': 5 },
        },
        {
          id: 'water:pipes', type: 'line', source: 'water:pipes',
          filter: ['!', ['in', ['get', 'status'], ['literal', ['burst', 'closed']]]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': colour,
            'line-width': ['case', ['==', ['get', 'status'], 'backup'], ['+', width, 0.8], width],
            'line-opacity': ['case', ['==', ['get', 'status'], 'normal'], faded, 0.95],
          },
        },
        // Isolated pipe: DASHED, because the flow is interrupted — and because its
        // hue sits too close to low pressure to carry the difference alone.
        {
          id: 'water:closed', type: 'line', source: 'water:pipes',
          filter: ['==', ['get', 'status'], 'closed'],
          paint: { 'line-color': colour, 'line-width': ['+', width, 0.8], 'line-dasharray': [2, 1.2] },
        },
        {
          id: 'water:flow', type: 'line', source: 'water:pipes',
          filter: ['in', ['get', 'status'], ['literal', ['normal', 'backup', 'low_pressure']]],
          paint: {
            'line-color': css('--app-info-soft', 0.7),
            'line-width': ['match', ['get', 'class'], 'main', 1.6, 'distribution', 1.2, 0.9],
            'line-dasharray': flowDash(0),
          },
        },
        {
          id: 'water:burst', type: 'line', source: 'water:pipes',
          filter: ['==', ['get', 'status'], 'burst'],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': colour, 'line-width': 5, 'line-opacity': 0.85 },
        },
      ];
    },

    animate: (ctx) => {
      if (ctx.reducedMotion) return [];
      const step = Math.floor(ctx.time / 50) % 24;
      return [
        { layer: 'water:flow', property: 'line-dasharray', value: flowDash(step) },
        { layer: 'water:burst', property: 'line-opacity', value: 0.4 + Math.abs(Math.sin(ctx.time / 330)) * 0.55 },
      ];
    },
  },

  deck: (d, ctx) => [
    ...spill(d.incident ?? null, ctx),
    ...affectedPulse(affectedNodes(d), ctx),
    ...discMarker({
      id: 'water:nodes',
      data: d.nodes,
      ctx,
      position: (n) => [n.lng, n.lat],
      glyph: (n) => NODE_GLYPH[n.kind],
      ring: (n) => rgba(TONE_TOKEN[nodeTone(n)]),
      glyphColor: (n) => rgba(TONE_TOKEN[nodeTone(n)]),
      radius: (n) => (n.kind === 'building' || n.kind === 'tap' ? 7 : 9),
      visible: ctx.zoom >= 13.5,
      triggers: [d.nodes],
    }),
  ],

  pick: (hit, d) => {
    if (hit.source !== 'deck') return null;
    if (hit.layerId.startsWith('water:break') && d.incident) {
      const b = d.incident;
      return { layerId: 'water', kind: 'water-break', id: b.id, lngLat: [b.lng, b.lat], data: b };
    }
    const n = hit.object as WaterNode;
    return { layerId: 'water', kind: 'water-node', id: n.id, lngLat: [n.lng, n.lat], data: n };
  },
  popup: WaterPopup,
});

function spill(b: WaterBreak | null, ctx: LayerContext) {
  if (!b) return [];
  const data = [b];
  // DSOMap breathed the alert radius between 40 and 70 px; the same range here.
  const breathe = ctx.reducedMotion ? 0.5 : (Math.sin(ctx.time / 700) + 1) / 2;
  return [
    new ScatterplotLayer<WaterBreak>({
      id: 'water:break-alert',
      data,
      radiusUnits: 'pixels',
      getPosition: (x) => [x.lng, x.lat],
      getRadius: 40,
      radiusScale: 1 + breathe * 0.75,
      getFillColor: rgba('--app-danger', 0.08),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getLineColor: rgba('--app-danger', 0.4),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
    new ScatterplotLayer<WaterBreak>({
      id: 'water:break',
      data,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (x) => [x.lng, x.lat],
      getRadius: 16,
      getFillColor: rgba('--app-info', 0.3),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getLineColor: rgba('--app-danger'),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ];
}

function affectedPulse(nodes: WaterNode[], ctx: LayerContext) {
  if (!nodes.length) return [];
  const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 1000);
  return [
    new ScatterplotLayer<WaterNode>({
      id: 'water:affected',
      data: nodes,
      visible: ctx.zoom >= 13.5,
      radiusUnits: 'pixels',
      getPosition: (n) => [n.lng, n.lat],
      getRadius: 10,
      radiusScale: 1 + phase,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-danger'),
      opacity: ctx.reducedMotion ? 0.5 : 0.8 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
