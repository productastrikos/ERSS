/**
 * Crowd — density surface and choke points from engines/crowd (docs/08 §3.9).
 *
 * Density on the sequential ramp. Choke points are classed by Fruin level of service,
 * the published bands rather than an invented scale: LoS E is a warning, LoS F is where
 * crush risk begins. The label states the LEAD TIME — "LoS F in 14 min" — because an
 * alert without one does not satisfy BoQ-3 F12.
 */

import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { defineLayer } from '../layerRegistry';
import { SEQUENTIAL, ramp, rgba } from '../tokens';
import { label } from './kit';
import { ChokePointPopup } from '../popups/AnalyticalPopups';

export type FruinLoS = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface CrowdDensityPoint {
  lng: number;
  lat: number;
  personsPerM2: number;
}

export interface ChokePoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  los: FruinLoS;
  /** Minutes until LoS F is reached on the current trajectory; null when not forecast. */
  leadTimeMin: number | null;
  inflowPerMin?: number | null;
  capacityPerMin?: number | null;
}

export interface CrowdData {
  density: CrowdDensityPoint[];
  chokePoints: ChokePoint[];
  event?: string | null;
}

const token = (c: ChokePoint) => (c.los === 'F' ? '--app-danger' : c.los === 'E' ? '--app-warning' : '--app-info');

export const crowdLayer = defineLayer<CrowdData>({
  id: 'crowd',
  group: 'analytical',
  label: 'map.layer.crowd',
  order: 24,
  defaultVisible: false,
  source: { kind: 'feed' },
  legend: [
    { label: 'map.legend.crowdDensity', swatch: { kind: 'ramp', tokens: SEQUENTIAL } },
    { label: 'map.legend.chokeWarning', swatch: { kind: 'ring', token: '--app-warning' } },
    { label: 'map.legend.chokeCritical', swatch: { kind: 'ring', token: '--app-danger' } },
  ],

  deck: (data, ctx) => [
    new HeatmapLayer<CrowdDensityPoint>({
      id: 'crowd:density',
      data: data.density,
      getPosition: (p) => [p.lng, p.lat],
      getWeight: (p) => p.personsPerM2,
      radiusPixels: 45,
      threshold: 0.05,
      colorRange: ramp(SEQUENTIAL.slice(1)),
      opacity: 0.75,
      updateTriggers: { getWeight: [data.density] },
    }),
    new ScatterplotLayer<ChokePoint>({
      id: 'crowd:choke',
      data: data.chokePoints,
      pickable: true,
      radiusUnits: 'pixels',
      getPosition: (c) => [c.lng, c.lat],
      getRadius: (c) => (c.los === 'F' ? 11 : 9),
      getFillColor: rgba('--app-panel'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getLineColor: (c) => rgba(token(c)),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
    label({
      id: 'crowd',
      data: data.chokePoints,
      ctx,
      position: (c) => [c.lng, c.lat],
      text: (c) => (c.leadTimeMin != null && c.los !== 'F'
        ? `${c.name} · LoS F in ${Math.round(c.leadTimeMin)} min`
        : `${c.name} · LoS ${c.los}`),
      offset: [0, 22],
      size: 10.5,
      bold: true,
    }),
  ],

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const c = hit.object as ChokePoint;
    return { layerId: 'crowd', kind: 'choke-point', id: c.id, lngLat: [c.lng, c.lat], data: c };
  },
  popup: ChokePointPopup,
});
