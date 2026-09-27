/**
 * Hotspots — kernel density surface plus statistically significant clusters, from
 * engines/hotspot (docs/04 §6, docs/08 §2.2).
 *
 * The surface shows where incidents concentrate; the rings show where that
 * concentration is SIGNIFICANT (Getis–Ord Gi*). Hot clusters take the danger hue, cold
 * spots the info hue — significance is a status, so it is colour with meaning. Cluster
 * radius is in metres, so a ring means the same ground at every zoom.
 */

import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import { defineLayer } from '../layerRegistry';
import { SEQUENTIAL, ramp, rgba } from '../tokens';
import { HotspotPopup } from '../popups/AnalyticalPopups';

export interface KdePoint {
  lng: number;
  lat: number;
  weight: number;
}

export interface HotspotCluster {
  id: string;
  lng: number;
  lat: number;
  radiusM: number;
  /** Gi* z-score: positive is a hot spot, negative a cold spot. */
  z: number;
  p: number;
  count: number;
}

export interface HotspotData {
  kde: KdePoint[];
  clusters: HotspotCluster[];
  from?: string;
  to?: string;
  kind?: string | null;
}

const tone = (c: HotspotCluster) => (c.z >= 0 ? '--app-danger' : '--app-info');

export const hotspotLayer = defineLayer<HotspotData>({
  id: 'hotspot',
  group: 'analytical',
  label: 'map.layer.hotspot',
  order: 26,
  defaultVisible: false,
  source: { kind: 'feed' },
  legend: [
    { label: 'map.legend.kde', swatch: { kind: 'ramp', tokens: SEQUENTIAL } },
    { label: 'map.legend.hotSpot', swatch: { kind: 'ring', token: '--app-danger' } },
    { label: 'map.legend.coldSpot', swatch: { kind: 'ring', token: '--app-info' } },
  ],

  deck: (data, ctx) => [
    new HeatmapLayer<KdePoint>({
      id: 'hotspot:kde',
      data: data.kde,
      getPosition: (p) => [p.lng, p.lat],
      getWeight: (p) => p.weight,
      radiusPixels: 55,
      threshold: 0.05,
      colorRange: ramp(SEQUENTIAL.slice(1)),
      opacity: 0.72,
      updateTriggers: { getWeight: [data.kde] },
    }),
    new ScatterplotLayer<HotspotCluster>({
      id: 'hotspot:clusters',
      data: data.clusters,
      pickable: true,
      radiusUnits: 'meters',
      radiusMinPixels: 8,
      getPosition: (c) => [c.lng, c.lat],
      getRadius: (c) => c.radiusM,
      filled: true,
      getFillColor: (c) => rgba(tone(c), 0.08),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: (c) => rgba(tone(c), 0.9),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ],

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const c = hit.object as HotspotCluster;
    return { layerId: 'hotspot', kind: 'hotspot', id: c.id, lngLat: [c.lng, c.lat], data: c };
  },
  popup: HotspotPopup,
});
