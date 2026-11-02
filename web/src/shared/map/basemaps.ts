/**
 * Basemaps — what a map is drawn ON. Every option is a MapLibre style plus, for
 * satellite, a transform applied when that style arrives.
 *
 *   standard    the theme's own style (dark or light) — the default
 *   streets     a full-colour street map, the same in both themes
 *   satellite   aerial imagery under the theme style's place and road names
 *
 * Satellite keeps the theme style's vector SOURCE and drops only its painted layers, so
 * the 3D buildings (layers/buildings.ts reads that source) still stand up over the
 * photo, and the labels come from the same tiles every other basemap uses.
 *
 * An option whose configuration is missing is not offered (config.ts: no fallback host).
 */

import type { LayerSpecification, StyleSpecification, TransformStyleFunction } from 'maplibre-gl';
import { config } from '../../lib/config';
import type { Basemap } from '../../lib/stores/basemap';
import type { Theme } from '../../lib/stores/theme';
import { css } from './tokens';

export interface BasemapStyle {
  /** Identity for "is this already on the map" — a theme switch on satellite is a no-op. */
  key: string;
  url: string;
  transform?: TransformStyleFunction;
}

const SATELLITE_SOURCE = 'basemap-satellite';

/** The options this deployment can actually draw, in display order. */
export function availableBasemaps(): Basemap[] {
  return [
    'standard',
    ...(config.map.styleStreets ? ['streets' as const] : []),
    ...(config.map.satelliteTiles && config.map.styleDark ? ['satellite' as const] : []),
  ];
}

export function basemapStyle(basemap: Basemap, theme: Theme): BasemapStyle | null {
  const standard = theme === 'light' ? config.map.styleLight : config.map.styleDark;
  if (basemap === 'streets' && config.map.styleStreets) {
    return { key: `streets|${config.map.styleStreets}`, url: config.map.styleStreets };
  }
  if (basemap === 'satellite' && config.map.satelliteTiles && config.map.styleDark) {
    // Built on the DARK style in both themes: its labels are the light-on-dark set, and
    // they are recoloured for the photo anyway. One key for both themes, so switching
    // theme on satellite does not reload the imagery.
    return { key: `satellite|${config.map.satelliteTiles}`, url: config.map.styleDark, transform: overImagery };
  }
  return standard ? { key: standard, url: standard } : null;
}

/** The incoming style's labels, over imagery, with its sources kept for the buildings. */
const overImagery: TransformStyleFunction = (_previous, next): StyleSpecification => {
  const label = css('--map-sat-label');
  const halo = css('--map-sat-halo');
  const labels = next.layers
    .filter((l): l is Extract<LayerSpecification, { type: 'symbol' }> => l.type === 'symbol')
    .map((l) => ({
      ...l,
      paint: { ...l.paint, 'text-color': label, 'text-halo-color': halo, 'text-halo-width': 1.4 },
    }));

  return {
    ...next,
    sources: {
      ...next.sources,
      [SATELLITE_SOURCE]: {
        type: 'raster',
        tiles: [config.map.satelliteTiles!],
        tileSize: 256,
        // Past this the imagery runs out in places; MapLibre overzooms the last level.
        maxzoom: 19,
        attribution: config.map.satelliteAttribution,
      },
    },
    layers: [{ id: SATELLITE_SOURCE, type: 'raster', source: SATELLITE_SOURCE }, ...labels],
  };
};
