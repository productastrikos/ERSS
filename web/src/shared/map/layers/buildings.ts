/**
 * Buildings, extruded — the city the ambulance is driving through.
 *
 * The basemap already ships building footprints with `render_height` and
 * `render_min_height` (CARTO's carto.streets v1, OpenMapTiles schema), so 3D costs one
 * `fill-extrusion` layer against a source that is already loaded. No extra tiles, no
 * extra request, no geometry of our own.
 *
 * Why it earns its place on an ambulance console rather than being decoration: Dubai's
 * response problem is vertical. A call on floor 60 of a tower is a different job from a
 * call on the pavement outside it, and the platform measures vertical access time
 * separately for exactly that reason (docs/03, `v_incident_response.vrt_sec`). A pitched
 * map with the towers standing up is the only view in which "the patient is up there"
 * is legible at all.
 *
 * It draws BENEATH every operational layer — the incidents, the ambulances and their
 * routes are the subject; this is the set they stand in. Height is real metres, so the
 * skyline is Dubai's, not a stylisation.
 */

import { defineLayer } from '../layerRegistry';
import { css } from '../tokens';

/** The basemap's own vector source, already in the style before any descriptor runs. */
const BASEMAP_SOURCE = 'carto';
const SOURCE_LAYER = 'building';

/** Below this the footprints are not in the tiles, and extruding nothing costs a layer. */
const MIN_ZOOM = 13.5;

export const buildingsLayer = defineLayer<true>({
  id: 'buildings',
  group: 'reference',
  label: 'map.layer.buildings',
  order: 5,
  defaultVisible: false,
  // Nothing to fetch: the data is the basemap's. A resolved load simply activates it.
  source: { kind: 'rest', load: async () => true as const },
  legend: [
    { label: 'map.legend.buildings', key: 'buildings', swatch: { kind: 'fill', token: '--app-surface-raised' } },
  ],

  maplibre: {
    // The source is the basemap's own; a descriptor adding one here would shadow it.
    sources: () => ({}),
    layers: () => [
      {
        id: 'buildings:extrusion',
        type: 'fill-extrusion',
        source: BASEMAP_SOURCE,
        'source-layer': SOURCE_LAYER,
        minzoom: MIN_ZOOM,
        // `hide_3d` marks footprints the basemap author knows are wrong to extrude
        // (courtyards, bridge decks). Respect it rather than producing spikes.
        filter: ['all',
          ['!=', ['get', 'hide_3d'], true],
          ['>', ['coalesce', ['get', 'render_height'], 0], 0],
        ],
        paint: {
          'fill-extrusion-color': css('--app-surface-raised'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          // Fades in across half a zoom level, so tilting into the city does not pop.
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, MIN_ZOOM + 1, 0.85],
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  },
});
