/**
 * Incidents — a road-warning triangle, with priority encoded as a STATUS scale, not four
 * hues (docs/05 §5.4).
 *
 * The triangle is the point. Incidents used to be plain priority-coloured dots, and so
 * were the ambulances waiting at station when zoomed out — a green dot, a blue dot and a
 * red dot on the same screen, one of them a vehicle and two of them emergencies. The
 * incident now owns a silhouette nothing else on the map has (layers/kit.ts hazardMarker),
 * with the kind of incident as its glyph, so WHAT it is reads before what colour it is.
 *
 *   P1  --app-danger solid · larger · one slow pulse ring (static double ring under
 *       prefers-reduced-motion) · label
 *   P2  --app-danger ring on an --app-panel body · label
 *   P3  --app-info solid · label
 *   P4  --app-text-faint solid · small · label
 *
 * Every marker carries its label, so priority never depends on colour alone. Selection
 * wears the accent. There is no popup: selecting an incident opens the page's detail
 * panel (docs/06 §2.2).
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { Incident, Priority } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { rgba, type Rgba } from '../tokens';
import { hazardMarker, incidentGlyph, label, memoOn, pulsePhase } from './kit';

/** Triangle height in pixels. */
const SIZE: Record<Priority, number> = { P1: 26, P2: 23, P3: 21, P4: 17 };
/** The P1 pulse ring's resting radius — about the triangle's circumradius. */
const RADIUS: Record<Priority, number> = { P1: 13, P2: 12, P3: 11, P4: 9 };
const RANK: Record<Priority, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };

/** Lower priorities first, so a P1 always draws on top of whatever it overlaps. */
const byPriority = memoOn((incidents: Incident[]) =>
  [...incidents].sort((a, b) => RANK[a.priority] - RANK[b.priority]));
const p1Only = memoOn((incidents: Incident[]) => incidents.filter((i) => i.priority === 'P1'));

const position = (i: Incident): [number, number] => [i.lng, i.lat];

function fill(i: Incident): Rgba {
  switch (i.priority) {
    case 'P1': return rgba('--app-danger');
    case 'P2': return rgba('--app-panel');
    case 'P3': return rgba('--app-info');
    default:   return rgba('--app-text-faint');
  }
}

/** The glyph must read on its own body: light on a filled triangle, the ring's red on P2's
 *  panel-coloured one. */
function glyphTone(i: Incident): Rgba {
  return i.priority === 'P2' ? rgba('--app-danger') : rgba('--app-on-color');
}

export const incidentsLayer = defineLayer<Incident[]>({
  id: 'incidents',
  group: 'operational',
  label: 'map.layer.incidents',
  order: 90,
  defaultVisible: true,
  source: { kind: 'feed' },
  animated: (data) => data.some((i) => i.priority === 'P1'),
  legend: [
    { label: 'priority.P1', key: 'P1', swatch: { kind: 'hazard', token: '--app-danger' } },
    { label: 'priority.P2', key: 'P2', swatch: { kind: 'hazard-ring', token: '--app-danger' } },
    { label: 'priority.P3', key: 'P3', swatch: { kind: 'hazard', token: '--app-info' } },
    { label: 'priority.P4', key: 'P4', swatch: { kind: 'hazard', token: '--app-text-faint' } },
  ],
  filterFor: (data, key) => data.filter((i) => i.priority === key),

  deck: (data, ctx) => {
    const sorted = byPriority(data);
    const selected = ctx.selection?.kind === 'incident' ? ctx.selection.id : null;
    const danger = rgba('--app-danger');
    const accent = rgba('--app-accent');

    return [
      ...pulse(p1Only(data), ctx),

      ...hazardMarker({
        id: 'incidents:markers',
        data: sorted,
        ctx,
        position,
        glyph: (i) => incidentGlyph(i.kind),
        fill,
        glyphColor: glyphTone,
        // P2's ring is its encoding; selection puts the accent ring on any priority.
        ring: (i) => (i.ref === selected ? accent : i.priority === 'P2' ? danger : null),
        size: (i) => SIZE[i.priority],
        triggers: [selected],
      }),

      label({
        id: 'incidents',
        data: sorted,
        ctx,
        position,
        text: (i) => i.priority,
        offset: [0, 21],
        size: 10,
        bold: true,
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const i = hit.object as Incident;
    return { layerId: 'incidents', kind: 'incident', id: i.ref, lngLat: position(i), data: i };
  },
  locate: (data, id) => {
    const i = data.find((x) => x.ref === id);
    return i ? position(i) : null;
  },
});

/** The P1 ring. One slow expanding pulse, or a static double ring when motion is reduced. */
function pulse(p1: Incident[], ctx: LayerContext) {
  if (!p1.length) return [];

  if (ctx.reducedMotion) {
    return [
      new ScatterplotLayer<Incident>({
        id: 'incidents:pulse-static',
        data: p1,
        radiusUnits: 'pixels',
        getPosition: position,
        getRadius: RADIUS.P1 + 7,
        filled: false,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        getLineColor: rgba('--app-danger', 0.55),
        updateTriggers: { getLineColor: [ctx.theme] },
      }),
    ];
  }

  const phase = pulsePhase(ctx);
  return [
    new ScatterplotLayer<Incident>({
      id: 'incidents:pulse',
      data: p1,
      radiusUnits: 'pixels',
      getPosition: position,
      // Animate through props, not accessors, so a frame is a uniform update and not
      // an attribute rebuild.
      radiusScale: 1 + phase * 2.2,
      getRadius: RADIUS.P1,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-danger'),
      opacity: 0.85 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
