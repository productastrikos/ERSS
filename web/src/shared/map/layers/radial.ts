/**
 * Radial search — the circle and the calls inside it (Concept Note §07).
 *
 * A dedicated map layer, not part of the DCAS registry set: the Insights page mounts a
 * small standalone map with just this and a reference layer or two, rather than adding
 * "a circle" to every other screen's layer list.
 */

import { ArcLayer, IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Priority } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { glyphIcon } from '../icons/glyphs';
import { rgba } from '../tokens';
import { fontStack } from './kit';
import { FLAT } from './vehicle3d';

type LngLat = [number, number];

export interface RadialPoint { ref: string; priority: Priority; lng: number; lat: number }

export interface RadialStation {
  ref: string;
  name: string;
  distanceM: number;
  lng: number;
  lat: number;
}

export interface RadialData {
  centre: LngLat | null;
  radiusM: number;
  points: RadialPoint[];
  /** The DCAS stations that would answer a call inside the circle. */
  stations?: RadialStation[];
}

const PRIORITY_TOKEN: Record<Priority, string> = {
  P1: '--app-danger', P2: '--app-danger', P3: '--app-info', P4: '--app-text-faint',
};

/** A circle of `steps` points, radiusM around centre — good enough at city zoom; no
 *  geodesic library needed for a search radius measured in hundreds of metres. */
function circle(centre: LngLat, radiusM: number, steps = 64): LngLat[] {
  const [lng, lat] = centre;
  const latDeg = radiusM / 111_320;
  const lngDeg = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [lng + Math.cos(a) * lngDeg, lat + Math.sin(a) * latDeg] as LngLat;
  });
}

export const radialLayer = defineLayer<RadialData>({
  id: 'radial',
  group: 'operational',
  label: 'map.layer.radial',
  order: 60,
  defaultVisible: true,
  source: { kind: 'feed' },

  deck: (data, ctx) => {
    if (!data.centre) return [];
    const ring = circle(data.centre, data.radiusM);
    return [
      ...stationLinks(data, ctx),
      new PolygonLayer({
        id: 'radial:circle',
        data: [{ ring }],
        getPolygon: (d: { ring: LngLat[] }) => d.ring,
        filled: true,
        stroked: true,
        getFillColor: rgba('--app-accent-bg', 0.5),
        getLineColor: rgba('--app-accent'),
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        parameters: FLAT,
      }),
      // The circle's edge, drawn OVER everything: the search area has to stay findable
      // when the demand surface stands three hundred metres tall around it.
      new PathLayer<{ ring: LngLat[] }>({
        id: 'radial:ring',
        data: [{ ring }],
        getPath: (d) => d.ring,
        widthUnits: 'pixels',
        getWidth: 2,
        getColor: rgba('--app-accent'),
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
        updateTriggers: { getColor: [ctx.theme] },
      }),
      new ScatterplotLayer<LngLat>({
        id: 'radial:centre',
        data: [data.centre],
        radiusUnits: 'pixels',
        getPosition: (d) => d,
        getRadius: 6,
        getFillColor: rgba('--app-accent'),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        getLineColor: rgba('--app-panel'),
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
      }),
      new ScatterplotLayer<RadialPoint>({
        id: 'radial:points',
        parameters: FLAT,
        data: data.points,
        pickable: true,
        radiusUnits: 'pixels',
        getPosition: (p) => [p.lng, p.lat],
        getRadius: (p) => (p.priority === 'P1' ? 6 : 4.5),
        getFillColor: (p) => rgba(PRIORITY_TOKEN[p.priority], 0.85),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        getLineColor: rgba('--app-panel'),
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const o = hit.object as RadialPoint & RadialStation;
    if (o.name) return { layerId: 'radial', kind: 'station', id: o.ref, lngLat: [o.lng, o.lat], data: o };
    if (!o.priority) return null;
    return { layerId: 'radial', kind: 'incident', id: o.ref, lngLat: [o.lng, o.lat], data: o };
  },
});

/**
 * Who would come, and from how far.
 *
 * The nearest stations were a list of names and distances beside the map; as arcs onto the
 * circle they answer the question the list only implied — whether this address is covered
 * from one direction or three, and whether the cover is 800 m away or six kilometres. The
 * arc is drawn FROM the station TO the circle because that is the direction of travel.
 */
function stationLinks(data: RadialData, ctx: LayerContext): Layer[] {
  const stations = data.stations ?? [];
  if (!stations.length || !data.centre) return [];
  const centre = data.centre;
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

  return [
    new ArcLayer<RadialStation>({
      id: 'radial:station-arcs',
      data: stations,
      getSourcePosition: (s) => [s.lng, s.lat],
      getTargetPosition: () => centre,
      getSourceColor: rgba('--app-info', 0.85),
      getTargetColor: rgba('--app-accent', 0.75),
      widthUnits: 'pixels',
      // The nearest station is the one that matters; the rest are context.
      getWidth: (_s, { index }) => (index === 0 ? 3 : 1.5),
      getHeight: 0.28,
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getSourceColor: [ctx.theme], getTargetColor: [ctx.theme] },
    }),
    new ScatterplotLayer<RadialStation>({
      id: 'radial:station-disc',
      data: stations,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (s) => [s.lng, s.lat],
      getRadius: 10,
      getFillColor: rgba('--app-panel'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-info'),
      // Over the surface: a station hidden behind a column of demand is the one piece of
      // this picture that has to stay visible.
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
    new IconLayer<RadialStation>({
      id: 'radial:station-glyph',
      data: stations,
      sizeUnits: 'pixels',
      getPosition: (s) => [s.lng, s.lat],
      getIcon: () => glyphIcon('ambulance', 2.25),
      getSize: 12,
      getColor: rgba('--app-info'),
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getColor: [ctx.theme] },
    }),
    new TextLayer<RadialStation>({
      id: 'radial:station-label',
      // Only the nearest station is labelled. Five distances floating over the surface is
      // five things to read before the map says anything; the rest answer a click.
      data: stations.slice(0, 1),
      getPosition: (s) => [s.lng, s.lat],
      getText: (s) => km(s.distanceM),
      getSize: 10.5,
      sizeUnits: 'pixels',
      getPixelOffset: [0, 18],
      getColor: rgba('--app-text'),
      fontFamily: fontStack('--font-mono'),
      fontWeight: 700,
      characterSet: 'auto',
      background: true,
      getBackgroundColor: rgba('--app-panel', 0.92),
      backgroundBorderRadius: 4,
      backgroundPadding: [4, 2],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getColor: [ctx.theme], getBackgroundColor: [ctx.theme] },
    }),
  ];
}

