/**
 * The AI's decision, drawn while it is being made.
 *
 * Between a camera raising an incident and the job being sent, the AI weighs the nearest
 * free ambulances by their ROAD routes and the traffic on each (server/services/
 * decisions.js). This layer is that moment on the map, so the room watches the choice
 * rather than reading about it afterwards:
 *
 *   a scan ring      pulses out from the incident while the engine is thinking
 *   the candidates   each weighed ambulance is ringed and labelled with its rank and its
 *                    predicted arrival — "#2 Medic 16 · 3:40 min"
 *   their roads      the routes it compared, dashed and quiet; the chosen one solid amber,
 *                    the colour a road to a patient always has on this map
 *   their traffic    red where each of those roads is congested (simulated in this build)
 *
 * It exists only until the job is sent. After that the live-response layer draws the one
 * route that matters, and this clears — two routes to the same patient would be one too many.
 *
 * AI reasoning is drawn in the advisory hue (`--app-advisory`), the product's reserved
 * colour for "the machine's judgement", so a weighed route can never be mistaken for a road
 * a crew is actually driving.
 */

import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import type { TrafficStretch } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { rgba } from '../tokens';
import { fontStack, pulsePhase } from './kit';
import { FLAT, metresPerPixel } from './vehicle3d';

type LngLat = [number, number];

export interface DecisionCandidateMark {
  unitRef: string;
  callsign: string;
  rank: number;
  arrivalSec: number;
  trafficDelaySec: number;
  position: LngLat | null;
  path: LngLat[] | null;
  traffic: TrafficStretch[];
  chosen: boolean;
  /** This candidate is who the AI log's CURRENT step is talking about — "Checked all 8
   *  trial ambulances" lights up the whole field, "Chose Medic 22" lights up just the one.
   *  A visual echo of the log, not a new signal of its own. */
  highlighted?: boolean;
}

export interface DecisionOverlayData {
  incidentRef: string | null;
  incident: LngLat | null;
  status: 'thinking' | 'ready' | 'no_unit' | 'failed' | null;
  candidates: DecisionCandidateMark[];
}

export const EMPTY_DECISION: DecisionOverlayData = { incidentRef: null, incident: null, status: null, candidates: [] };

const DASHED = new PathStyleExtension({ dash: true });

const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const decisionLayer = defineLayer<DecisionOverlayData>({
  id: 'decision',
  group: 'operational',
  label: 'map.layer.decision',
  order: 97,
  defaultVisible: true,
  source: { kind: 'feed' },
  animated: (d) => d.status === 'thinking' || d.candidates.length > 0,
  legend: [
    { label: 'map.legend.decisionWeighed', key: 'weighed', swatch: { kind: 'dashed', token: '--app-advisory' } },
    { label: 'map.legend.decisionChosen', key: 'chosen', swatch: { kind: 'line', token: '--app-accent' } },
  ],

  deck: (data, ctx) => {
    if (!data.incident) return [];
    return [
      ...scan(data, ctx),
      ...roads(data, ctx),
      ...candidates(data, ctx),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const c = hit.object as DecisionCandidateMark | undefined;
    if (!c?.unitRef || !c.position) return null;
    return { layerId: 'decision', kind: 'unit', id: c.unitRef, lngLat: c.position, data: c };
  },
});

/** Rings pulsing out from the incident while the engine weighs the field. */
function scan(data: DecisionOverlayData, ctx: LayerContext): Layer[] {
  if (data.status !== 'thinking' && !data.candidates.length) return [];
  const mpp = metresPerPixel(ctx.zoom);
  const phases = ctx.reducedMotion ? [0.6] : [0, 0.5].map((o) => (pulsePhase(ctx, 1800) + o) % 1);
  const strong = data.status === 'thinking';
  return [
    new ScatterplotLayer<{ p: number }>({
      id: 'decision:scan',
      data: phases.map((p) => ({ p })),
      getPosition: () => data.incident as LngLat,
      getRadius: (d) => (20 + d.p * (strong ? 150 : 90)) * mpp,
      radiusUnits: 'meters',
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: strong ? 2 : 1.25,
      getLineColor: (d) => rgba('--app-advisory', (1 - d.p) * (strong ? 0.9 : 0.5)),
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getRadius: [ctx.time, ctx.zoom], getLineColor: [ctx.time, ctx.theme] },
    }),
  ];
}

/** The roads the AI compared, and the traffic on each. */
function roads(data: DecisionOverlayData, ctx: LayerContext): Layer[] {
  const routed = data.candidates.filter((c) => c.path && c.path.length > 1);
  if (!routed.length) return [];
  const others = routed.filter((c) => !c.chosen);
  const chosen = routed.filter((c) => c.chosen);
  const jams = routed.flatMap((c) => c.traffic.map((t, i) => ({ ...t, id: `${c.unitRef}:${i}`, chosen: c.chosen })));

  return [
    new PathLayer<DecisionCandidateMark>({
      id: 'decision:weighed',
      data: others,
      widthUnits: 'pixels',
      getPath: (c) => c.path as LngLat[],
      getWidth: 3,
      getColor: rgba('--app-advisory', 0.85),
      // PathStyleExtension's props are not in PathLayer's own type; spread them untyped.
      ...({ getDashArray: [2.2, 1.6], dashJustified: true } as object),
      extensions: [DASHED],
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
    new PathLayer<DecisionCandidateMark>({
      id: 'decision:chosen-casing',
      data: chosen,
      widthUnits: 'pixels',
      getPath: (c) => c.path as LngLat[],
      getWidth: 9,
      getColor: rgba('--app-panel', 0.9),
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
    new PathLayer<DecisionCandidateMark>({
      id: 'decision:chosen',
      data: chosen,
      widthUnits: 'pixels',
      getPath: (c) => c.path as LngLat[],
      getWidth: 5,
      getColor: rgba('--app-accent', 0.95),
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
    new PathLayer<(typeof jams)[number]>({
      id: 'decision:traffic',
      data: jams,
      widthUnits: 'pixels',
      getPath: (t) => t.path,
      getWidth: (t) => (t.chosen ? (t.level === 'heavy' ? 6 : 4.5) : 3.5),
      getColor: (t) => rgba('--app-danger', t.chosen ? (t.level === 'heavy' ? 1 : 0.75) : 0.6),
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}

/** Each weighed ambulance: a ring, and its rank and predicted arrival. */
function candidates(data: DecisionOverlayData, ctx: LayerContext): Layer[] {
  const placed = data.candidates.filter((c): c is DecisionCandidateMark & { position: LngLat } => !!c.position);
  if (!placed.length) return [];
  // Ambulances parked at the same station would print their chips on one spot and hide
  // the better-ranked one. Each chip climbs one row per higher-ranked candidate beside it.
  const near = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 0.0004 && Math.abs(a[1] - b[1]) < 0.0004;
  const stack = new Map(placed.map((c) => [c.unitRef,
    placed.filter((o) => o.rank < c.rank && near(o.position, c.position)).length]));
  const over = { depthCompare: 'always' as const, depthWriteEnabled: false };
  const pulse = ctx.reducedMotion ? 0.5 : pulsePhase(ctx, 1400);
  return [
    new ScatterplotLayer<(typeof placed)[number]>({
      id: 'decision:ring',
      data: placed,
      pickable: true,
      getPosition: (c) => c.position,
      radiusUnits: 'pixels',
      getRadius: (c) => (c.chosen ? 22 + pulse * 6 : c.highlighted ? 21 + pulse * 5 : 19),
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: (c) => (c.chosen ? 3 : c.highlighted ? 2.6 : 2),
      getLineColor: (c) => (c.chosen
        ? rgba('--app-accent', 1 - pulse * 0.5)
        : c.highlighted ? rgba('--app-advisory', 0.9 - pulse * 0.35) : rgba('--app-advisory', 0.9)),
      parameters: over,
      updateTriggers: { getRadius: [ctx.time], getLineColor: [ctx.time, ctx.theme] },
    }),
    new TextLayer<(typeof placed)[number]>({
      id: 'decision:chip',
      data: placed,
      pickable: true,
      getPosition: (c) => c.position,
      getText: (c) => `#${c.rank} ${c.callsign} · ${mmss(c.arrivalSec)} min${c.trafficDelaySec >= 20 ? ` (+${mmss(c.trafficDelaySec)} traffic)` : ''}`,
      getSize: 11,
      sizeUnits: 'pixels',
      getPixelOffset: (c) => [0, -34 - (stack.get(c.unitRef) ?? 0) * 22],
      getColor: (c) => (c.chosen ? rgba('--app-on-accent') : rgba('--app-text')),
      fontFamily: fontStack('--font-mono'),
      fontWeight: 700,
      characterSet: 'auto',
      background: true,
      getBackgroundColor: (c) => (c.chosen ? rgba('--app-accent', 0.96) : rgba('--app-panel', 0.94)),
      getBorderColor: (c) => (c.chosen ? rgba('--app-accent') : rgba('--app-advisory', 0.9)),
      getBorderWidth: 1,
      backgroundBorderRadius: 4,
      backgroundPadding: [6, 3],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      parameters: over,
      updateTriggers: { getColor: [ctx.theme], getBackgroundColor: [ctx.theme], getBorderColor: [ctx.theme], getPixelOffset: [data] },
    }),
  ];
}
