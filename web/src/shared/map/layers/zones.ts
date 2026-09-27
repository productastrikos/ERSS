/**
 * Zones — sector and community boundaries, optionally a choropleth by metric.
 *
 * Replaces the DSO district boundary: DSO is now one community among fifty-one in the
 * seeded hierarchy (docs/14 §2.3). Styling per docs/05 §7.5 — boundaries in
 * --app-border-strong at 1px, the selected zone in --app-accent at 2px.
 */

import { GeoJsonLayer } from '@deck.gl/layers';
import type { Feature, Geometry } from 'geojson';
import { api } from '../../../lib/api';
import type { GeoJSONFeatureCollection, ZoneClass, ZoneLevel } from '../../../lib/types';
import { defineLayer } from '../layerRegistry';
import { SEQUENTIAL, rampAt, rgba } from '../tokens';
import { ZonePopup } from '../popups/ReferencePopups';

export interface ZoneProps {
  ref: string;
  name: string;
  level: ZoneLevel;
  class: ZoneClass;
  parentRef: string | null;
  population: number | null;
  populationDaytime: number | null;
  areaKm2: number | null;
  highriseCount: number | null;
}

export interface ZonesData {
  zones: GeoJSONFeatureCollection;
  /** A value per zone ref, drawn on the sequential ramp. Set by Analytics and Ranking. */
  metric?: { label: string; unit?: string; values: Record<string, number> } | null;
}

export interface ZoneSelection extends ZoneProps {
  metricLabel?: string;
  metricValue?: number | null;
  metricUnit?: string;
}

type ZoneFeature = Feature<Geometry, ZoneProps>;

export const zonesLayer = defineLayer<ZonesData>({
  id: 'zones',
  group: 'reference',
  label: 'map.layer.zones',
  order: 10,
  defaultVisible: true,
  source: {
    kind: 'rest',
    load: async () => {
      const [sectors, communities] = await Promise.all([
        api.zones({ level: 'sector', geometry: 'full' }),
        api.zones({ level: 'community', geometry: 'full' }),
      ]);
      return { zones: { type: 'FeatureCollection', features: [...sectors.features, ...communities.features] } };
    },
  },
  legend: [
    { label: 'map.legend.zoneBoundary', swatch: { kind: 'line', token: '--app-border-strong' } },
    { label: 'map.legend.zoneSelected', swatch: { kind: 'line', token: '--app-accent' } },
  ],

  deck: (data, ctx) => {
    const values = data.metric?.values;
    const range = values ? extent(Object.values(values)) : null;
    const selected = ctx.selection?.kind === 'zone' ? ctx.selection.id : null;

    const border = rgba('--app-border-strong');
    const sectorBorder = rgba('--app-text-faint', 0.7);
    const accent = rgba('--app-accent');
    const clear = rgba('--app-accent', 0);

    return [
      new GeoJsonLayer({
        id: 'zones:boundaries',
        data: data.zones as unknown as GeoJSON.FeatureCollection,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (f) => {
          const p = (f as ZoneFeature).properties;
          return p.ref === selected ? 2 : p.level === 'sector' ? 1.5 : 1;
        },
        getLineColor: (f) => {
          const p = (f as ZoneFeature).properties;
          return p.ref === selected ? accent : p.level === 'sector' ? sectorBorder : border;
        },
        getFillColor: (f) => {
          const p = (f as ZoneFeature).properties;
          const v = values?.[p.ref];
          if (p.level !== 'community' || v === undefined || !range) return clear;
          const t = range[1] > range[0] ? (v - range[0]) / (range[1] - range[0]) : 0.5;
          // Opacity follows the value too, so the ramp's pale low end recedes on dark ground.
          return rampAt(SEQUENTIAL, t, 0.2 + t * 0.55);
        },
        updateTriggers: {
          getLineColor: [ctx.theme, selected],
          getLineWidth: [selected],
          getFillColor: [ctx.theme, data.metric],
        },
      }),
    ];
  },

  pick: (hit, data) => {
    if (hit.source !== 'deck') return null;
    const p = (hit.object as ZoneFeature).properties;
    return {
      layerId: 'zones',
      kind: 'zone',
      id: p.ref,
      lngLat: hit.lngLat,
      data: {
        ...p,
        metricLabel: data.metric?.label,
        metricUnit: data.metric?.unit,
        metricValue: data.metric?.values[p.ref] ?? null,
      } satisfies ZoneSelection,
    };
  },
  popup: ZonePopup,
});

function extent(xs: number[]): [number, number] | null {
  const finite = xs.filter(Number.isFinite);
  return finite.length ? [Math.min(...finite), Math.max(...finite)] : null;
}
