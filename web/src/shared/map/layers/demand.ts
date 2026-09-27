/**
 * Demand forecast — the heat surface from engines/demand (docs/08 §3.1).
 *
 * A heat surface for the shape, and a pickable point per zone for the NUMBER, because a
 * surface alone cannot carry an interval. Every value on this layer is a prediction and
 * is presented as one: the popup shows the 80% interval and marks the figure predicted.
 */

import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { defineLayer } from '../layerRegistry';
import { SEQUENTIAL, ramp, rgba } from '../tokens';
import { DemandPopup } from '../popups/AnalyticalPopups';

export interface DemandPoint {
  zoneRef: string;
  zoneName?: string | null;
  lng: number;
  lat: number;
  /** Expected incidents in the bucket. */
  predicted: number;
  lower80: number | null;
  upper80: number | null;
}

export interface DemandData {
  points: DemandPoint[];
  /** The bucket the forecast describes, ISO. */
  from: string;
  to: string;
  method?: string;
  /** Trailing 30-day interval coverage — an empirical number (docs/08 §3.1). */
  confidence?: number | null;
}

export interface DemandSelection extends DemandPoint {
  from: string;
  to: string;
  method?: string;
  confidence?: number | null;
}

export const demandLayer = defineLayer<DemandData>({
  id: 'demand',
  group: 'analytical',
  label: 'map.layer.demand',
  order: 22,
  defaultVisible: false,
  source: { kind: 'feed' },
  legend: [{ label: 'map.legend.demandPredicted', swatch: { kind: 'ramp', tokens: SEQUENTIAL } }],

  deck: (data, ctx) => [
    new HeatmapLayer<DemandPoint>({
      id: 'demand:surface',
      data: data.points,
      getPosition: (p) => [p.lng, p.lat],
      getWeight: (p) => p.predicted,
      radiusPixels: 70,
      intensity: 1,
      threshold: 0.04,
      colorRange: ramp(SEQUENTIAL.slice(1)),
      opacity: 0.7,
      updateTriggers: { getWeight: [data.points] },
    }),
    new ScatterplotLayer<DemandPoint>({
      id: 'demand:zones',
      data: data.points,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (p) => [p.lng, p.lat],
      getRadius: 5,
      getFillColor: rgba('--app-panel', 0.9),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getLineColor: rgba('--seq-300'),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ],

  pick: (hit, data) => {
    if (hit.source !== 'deck') return null;
    const p = hit.object as DemandPoint;
    const sel: DemandSelection = { ...p, from: data.from, to: data.to, method: data.method, confidence: data.confidence };
    return { layerId: 'demand', kind: 'demand-zone', id: p.zoneRef, lngLat: [p.lng, p.lat], data: sel };
  },
  popup: DemandPopup,
});
