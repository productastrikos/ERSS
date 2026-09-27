/**
 * After-action replay — the job as it happened, on the clock it happened on.
 *
 * Three roads are drawn and never confused with each other: the route the dispatch engine
 * PROPOSED (dashed), the road the crew actually DROVE to the patient, and the road they
 * drove on to hospital. The ambulance — the same 3D vehicle the live map uses, so the
 * replay looks like the screen it is replaying — travels along them at the speed the crew
 * travelled, and the part of the road already covered is lit behind it.
 *
 * The playback clock is read inside the animation frame (`clock.at(ctx.now)`), which is
 * what lets the camera ride with the vehicle: a chase samples the same instant the layer
 * drew, so it can never lag a frame behind.
 */

import { ColumnLayer, IconLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { css, rgba } from '../tokens';
import { glyphIcon } from '../icons/glyphs';
import { tripAt, type PlaybackClock, type Trip } from '../replay/trip';
import { FLAT, metresPerPixel, vehicleLayers } from './vehicle3d';

type LngLat = [number, number];

export interface ReplayData {
  trip: Trip | null;
  /** Mutable, read per frame — see replay/trip.ts. */
  clock: PlaybackClock;
}

/** The vehicle id a camera follows; a replay only ever has one. */
export const REPLAY_VEHICLE = 'vehicle';

const lineFeature = (coords: LngLat[] | null | undefined, kind: string) => (coords && coords.length > 1
  ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: { kind } }]
  : []);

export const replayLayer = defineLayer<ReplayData>({
  id: 'replay',
  group: 'operational',
  label: 'map.layer.replay',
  order: 60,
  defaultVisible: true,
  source: { kind: 'feed' },
  // The clock advances of its own accord; the map has to redraw to show it.
  animated: (d) => !!d.trip && d.clock.playing,
  legend: [
    { label: 'map.legend.routeProposed', key: 'proposed', swatch: { kind: 'dashed', token: '--app-accent' } },
    { label: 'map.legend.routeTaken', key: 'taken', swatch: { kind: 'line', token: '--app-text' } },
    { label: 'map.legend.routeHospital', key: 'hospital', swatch: { kind: 'line', token: '--app-info' } },
  ],

  maplibre: {
    sources: (data) => ({
      'replay:lines': {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            ...lineFeature(data.trip?.driven, 'taken'),
            ...lineFeature(data.trip?.transport, 'hospital'),
            ...lineFeature(data.trip?.proposed, 'proposed'),
          ],
        },
      },
    }),
    layers: () => [
      {
        id: 'replay:taken',
        type: 'line',
        source: 'replay:lines',
        filter: ['==', ['get', 'kind'], 'taken'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': css('--app-text'), 'line-width': 4, 'line-opacity': 0.55 },
      },
      {
        id: 'replay:hospital-leg',
        type: 'line',
        source: 'replay:lines',
        filter: ['==', ['get', 'kind'], 'hospital'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': css('--app-info'), 'line-width': 4, 'line-opacity': 0.55 },
      },
      {
        id: 'replay:proposed',
        type: 'line',
        source: 'replay:lines',
        filter: ['==', ['get', 'kind'], 'proposed'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': css('--app-accent', 0.85), 'line-width': 3, 'line-dasharray': [2, 1.5] },
      },
    ],
  },

  deck: (data, ctx) => {
    const { trip } = data;
    if (!trip) return [];
    const t = data.clock.at(ctx.now);
    const here = tripAt(trip, t);
    const toHospital = !!trip.hospital && trip.stages.some((s) => s.key === 'transporting' && s.at <= t);
    const tone = toHospital ? rgba('--app-info') : rgba('--app-danger');

    return [
      ...place(trip, ctx),
      // Where the ambulance has been so far: the record playing back under it.
      new PathLayer<{ path: LngLat[] }>({
        id: 'replay:travelled',
        data: [{ path: trip.points.slice(0, here.index + 1) }],
        visible: here.index > 1,
        widthUnits: 'pixels',
        getPath: (d) => d.path,
        getWidth: 5,
        // The road already covered, in the leg's own tone — the same colour the live map
        // paints a crew's trail. The dashed accent line stays "the route proposed", so the
        // two are never read as the same thing.
        getColor: toHospital ? rgba('--app-info', 0.95) : rgba('--app-danger', 0.9),
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        updateTriggers: { getPath: [here.index], getColor: [ctx.theme, toHospital] },
      }),
      ...vehicleLayers<{ at: LngLat; heading: number | null }>({
        id: 'replay:vehicle',
        data: [{ at: here.at, heading: here.heading }],
        ctx,
        position: (d) => d.at,
        heading: (d) => d.heading,
        tone: () => tone,
        focus: () => true,
        lights: () => true,
        pickable: false,
        triggers: [toHospital],
        // A replay is framed to show the whole route (fitBounds, often well below the
        // zoom the live map needs before it hands a vehicle the 3D model over the flat
        // top-down symbol) — but it is always exactly one ambulance on an empty stage, so
        // there is no reason to make the room wait for a tight "ride" zoom to see it.
        minModelPx: 34,
      }),
    ];
  },

  /** A replay has one vehicle; the camera can ride with it exactly as it rides live. */
  locateNow: (data, _id, now) => {
    if (!data.trip) return null;
    const here = tripAt(data.trip, data.clock.at(now));
    return { at: here.at, heading: here.heading };
  },
  locate: (data) => (data.trip ? tripAt(data.trip, data.clock.at(performance.now())).at : null),
});

/** The two fixed places the job ran between: the call, and the hospital it ended at. */
function place(trip: Trip, ctx: LayerContext): Layer[] {
  const mpp = metresPerPixel(ctx.zoom);
  const layers: Layer[] = [
    new ColumnLayer<{ position: LngLat }>({
      id: 'replay:incident',
      data: [{ position: trip.incident }],
      diskResolution: 12,
      radius: 4 * mpp,
      extruded: true,
      getPosition: (d) => d.position,
      getElevation: 34 * mpp,
      getFillColor: rgba('--app-danger', 0.45),
      material: false,
      updateTriggers: { getFillColor: [ctx.theme], getElevation: [ctx.zoom] },
    }),
  ];
  if (!trip.hospital) return layers;
  return [
    ...layers,
    new ScatterplotLayer<{ position: LngLat }>({
      id: 'replay:hospital-disc',
      data: [{ position: trip.hospital }],
      radiusUnits: 'pixels',
      getPosition: (d) => d.position,
      getRadius: 11,
      getFillColor: rgba('--app-panel'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba('--app-info'),
      parameters: FLAT,
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
    new IconLayer<{ position: LngLat }>({
      id: 'replay:hospital-glyph',
      data: [{ position: trip.hospital }],
      sizeUnits: 'pixels',
      getPosition: (d) => d.position,
      getIcon: () => glyphIcon('hospital'),
      getSize: 13,
      getColor: rgba('--app-info'),
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}
