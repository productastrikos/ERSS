/**
 * The demand surface — where the calls come from, in three dimensions.
 *
 * The radial search answers "what happens inside this circle". This answers the question
 * that has to come first: WHERE SHOULD THE CIRCLE GO. Twelve thousand grid cells of history
 * are re-binned into hexagons in the browser (geo/hexbin.ts) and drawn three ways, because
 * the three answer different questions and an analyst switches between them constantly:
 *
 *   COLUMNS   a hexagon rises by HOW MANY CALLS come from it and is coloured by the
 *             measure — the form that shows a tower block generating three hundred calls
 *             standing over a quiet district, and says in colour whether those calls are
 *             being answered in time. Volume is always the height, because "how much is
 *             happening here" is the question every other measure is weighed against: a
 *             hexagon with the worst attainment in the emirate and four calls in it is a
 *             different fact from the same colour over four hundred.
 *   HEATMAP   the same data as a continuous surface. Better for the SHAPE of demand — the
 *             corridors and the edges — where discrete columns impose a grid on it.
 *   POINTS    the individual calls inside the circle, for when the question has narrowed
 *             to particular incidents rather than a pattern.
 *
 * The measure is a dial too: volume, the share that is urgent, the mean response time, the
 * share inside target. The last two are drawn from the SAME hexagons, so "the slowest
 * corner of the emirate" and "the busiest" can be compared without changing screens.
 */

import { ColumnLayer, ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import type { Priority } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { ramp, rgba, type Rgba } from '../tokens';
import { bandOf, type GeoMeasure, type HexCell, type HexSurface } from '../geo/hexbin';
import { FLAT, metresPerPixel } from './vehicle3d';

type LngLat = [number, number];

/** The six ordered bands of the demand ramp (theme.css). */
export const GEO_RAMP = ['--geo-1', '--geo-2', '--geo-3', '--geo-4', '--geo-5', '--geo-6'] as const;

export type GeoMode = 'columns' | 'heatmap' | 'points';

export interface GeoPoint { ref: string; priority: Priority; lng: number; lat: number }

export interface GeoDensityData {
  surface: HexSurface | null;
  mode: GeoMode;
/**
   * Height of the tallest column in SCREEN PIXELS. 0 flattens the surface.
   *
   * Pixels, not metres: a fixed height in metres is a different picture at every zoom —
   * 4 km of column is a low ridge across the emirate and a wall of red across one
   * district. Deriving the metres from the zoom keeps the surface the same shape whether
   * you are reading the whole city or one junction, which is the only way the two views
   * are comparable.
   */
  elevation: number;
  /** Individual calls — drawn in `points` mode, and always inside the search circle. */
  points: GeoPoint[];
  /** Hour being shown by the time-lapse, for the label on a picked hexagon. */
  hour: number | null;
}

const PRIORITY_TOKEN: Record<Priority, string> = {
  P1: '--app-danger', P2: '--app-danger', P3: '--app-info', P4: '--app-text-faint',
};

/** A measure where LOW is bad reads the ramp the other way up. */
const colourOf = (cell: HexCell, surface: HexSurface, alpha: number): Rgba => {
  const band = bandOf(cell.value, surface.breaks);
  const i = surface.measure === 'target' ? GEO_RAMP.length - 1 - band : band;
  return rgba(GEO_RAMP[Math.min(GEO_RAMP.length - 1, Math.max(0, i))], alpha);
};

export const geoDensityLayer = defineLayer<GeoDensityData>({
  id: 'geo',
  group: 'analytical',
  label: 'map.layer.geo',
  order: 40,
  defaultVisible: true,
  source: { kind: 'feed' },
  legend: (data) => (data.surface && data.mode !== 'points'
    ? [{ label: 'map.legend.geoDensity', swatch: { kind: 'ramp', tokens: GEO_RAMP } }]
    : [{ label: 'map.legend.geoCalls', swatch: { kind: 'dot', token: '--app-danger' } }]),

  deck: (data, ctx) => {
    if (data.mode === 'points') return points(data, ctx);
    const s = data.surface;
    if (!s?.cells.length) return [];
    return data.mode === 'heatmap' ? heatmap(s, ctx) : columns(s, data, ctx);
  },

  pick: (hit, data) => {
    if (hit.source !== 'deck') return null;
    const o = hit.object as HexCell & GeoPoint;
    if ('ref' in o && o.ref) {
      return { layerId: 'geo', kind: 'incident', id: o.ref, lngLat: [o.lng, o.lat], data: o };
    }
    if (!('centre' in o) || !data.surface) return null;
    return {
      layerId: 'geo',
      kind: 'hex',
      id: o.id,
      lngLat: o.centre,
      data: { cell: o, surface: data.surface, hour: data.hour },
    };
  },
});

/**
 * Hexagon columns.
 *
 * Height is the measure scaled against the surface's own maximum, so the tallest column is
 * always the same height on screen whatever is being measured — a surface that rescales
 * itself is the only way "busy" and "slow" can be compared at a glance. Columns grow into
 * place when the measure changes rather than snapping, which makes the change legible as a
 * change rather than as a different picture.
 */
function columns(s: HexSurface, data: GeoDensityData, ctx: LayerContext): Layer[] {
  const max = s.maxCalls || 1;
  // The zoom is quantised to a quarter step by the map, so this changes in steps the
  // elevation transition then smooths out.
  const height = data.elevation * metresPerPixel(ctx.zoom);
  const drawn = s.cells.filter((c) => c.defined);

  return [
    new ColumnLayer<HexCell>({
      id: 'geo:hex',
      data: drawn,
      pickable: true,
      diskResolution: 6,
      // A hexagon, flat-topped on screen: ColumnLayer draws a regular polygon whose
      // circumradius is `radius`, and the grid in hexbin.ts is pointy-top, so the polygon
      // is turned 30° to match it.
      angle: 30,
      radius: s.radiusM * 0.94,
      extruded: height > 0,
      getPosition: (c) => c.centre,
      getElevation: (c) => (c.calls / max) * height,
      getFillColor: (c) => colourOf(c, s, height > 0 ? 0.9 : 0.62),
      stroked: false,
      // Pointing at a hexagon lifts it out of the surface — the cheapest possible
      // confirmation that the tooltip belongs to the cell under the cursor.
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
      material: height > 0 ? { ambient: 0.62, diffuse: 0.5, shininess: 20, specularColor: [40, 40, 40] } : false,
      transitions: ctx.reducedMotion ? {} : { getElevation: 450, getFillColor: 450 },
      parameters: height > 0 ? undefined : FLAT,
      updateTriggers: {
        getElevation: [height, s.maxCalls, data.hour, ctx.zoom],
        getFillColor: [ctx.theme, s.measure, s.breaks, height, data.hour],
      },
    }),
  ];
}

/** The same surface as a continuous field — the shape of demand rather than its cells. */
function heatmap(s: HexSurface, ctx: LayerContext): Layer[] {
  return [
    new HeatmapLayer<HexCell>({
      id: 'geo:heat',
      data: s.cells.filter((c) => c.defined),
      getPosition: (c) => c.centre,
      getWeight: (c) => c.value,
      // In metres, so the surface keeps its geographic meaning as the camera moves.
      radiusPixels: 46,
      intensity: 1.1,
      threshold: 0.04,
      colorRange: ramp(GEO_RAMP, 1).map((c) => [c[0], c[1], c[2]] as [number, number, number]),
      aggregation: 'SUM',
      updateTriggers: { getWeight: [s.measure], colorRange: [ctx.theme] },
    }),
  ];
}

/** Individual calls — what the hexagons are made of. */
function points(data: GeoDensityData, ctx: LayerContext): Layer[] {
  if (!data.points.length) return [];
  return [
    new ScatterplotLayer<GeoPoint>({
      id: 'geo:points',
      data: data.points,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (p) => [p.lng, p.lat],
      getRadius: (p) => (p.priority === 'P1' ? 5.5 : 4),
      getFillColor: (p) => rgba(PRIORITY_TOKEN[p.priority], 0.85),
      autoHighlight: true,
      highlightColor: [255, 255, 255, 120],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      getLineColor: rgba('--app-panel'),
      parameters: FLAT,
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ];
}

export type { GeoMeasure };
export type GeoHexSelection = { cell: HexCell; surface: HexSurface; hour: number | null };
export type { LngLat };
