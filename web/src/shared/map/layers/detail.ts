/**
 * Detail geometry — roads, buildings, POIs, parks, water, railways and street
 * infrastructure for the close-up scenes (docs/00 D-05).
 *
 * MIGRATED from DSOMap.tsx (the "API layers" block). What changed and why:
 *
 * - Neon cyan extrusions and hard-coded greys became the --map-* tokens, kept
 *   low-contrast so operational data dominates (docs/05 §7.5).
 * - The inline-HTML road and POI popups became React popups on the token system.
 * - The Material-Design POI sprite (a second icon family, per-category hex backgrounds)
 *   became lucide glyphs in neutral discs: the category reads from the glyph's SHAPE,
 *   and colour stays reserved for status. The mechanism — category → generated icon —
 *   is kept, as docs/14 §2.3 asks.
 * - Road and building highlight are now driven by the view's selection, not imperative
 *   setFilter calls from click handlers.
 *
 * Served by /api/layers/all. With neither osm2pgsql tables nor baked GeoJSON present,
 * the collections are empty and the layer reports "nothing to show".
 */

import type { ExpressionSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';
import { TextLayer } from '@deck.gl/layers';
import { api } from '../../../lib/api';
import { defineLayer, type PickHit } from '../layerRegistry';
import { css, rgba } from '../tokens';
import type { GlyphName } from '../icons/glyphs';
import { discMarker, fontStack, memoOn } from './kit';
import { DetailPopup } from '../popups/DetailPopups';

type Props = Record<string, string | number | null>;
type FC = FeatureCollection<Geometry, Props>;

export interface DetailData {
  roads: FC;
  buildings: FC;
  pois: FC;
  parks: FC;
  water: FC;
  railways: FC;
  infrastructure: FC;
}

export interface DetailPoint {
  id: string;
  lng: number;
  lat: number;
  category: string;
  props: Props;
}

// ── Categories and glyphs ────────────────────────────────────────────────────

const POI_GLYPH: Record<string, GlyphName> = {
  restaurant: 'utensils', food_court: 'utensils', fast_food: 'utensils', canteen: 'utensils',
  bar: 'utensils', pub: 'utensils', nightclub: 'utensils',
  cafe: 'coffee', juice_bar: 'coffee',
  pharmacy: 'pill',
  hospital: 'stethoscope', clinic: 'stethoscope', doctors: 'stethoscope', dentist: 'stethoscope',
  veterinary: 'stethoscope', physiotherapist: 'stethoscope', optician: 'stethoscope',
  parking: 'square-parking', fuel: 'fuel', car_wash: 'car',
  bank: 'banknote', atm: 'banknote', bureau_de_change: 'banknote', money_transfer: 'banknote',
  supermarket: 'shopping-cart', convenience: 'shopping-cart',
  mall: 'shopping-bag', department_store: 'shopping-bag', marketplace: 'shopping-bag',
  school: 'graduation-cap', college: 'graduation-cap', university: 'graduation-cap',
  kindergarten: 'graduation-cap', language_school: 'graduation-cap',
  // A church glyph on a mosque would be wrong in Dubai; the generic landmark is not.
  mosque: 'landmark', place_of_worship: 'landmark', church: 'landmark',
  hotel: 'bed-double', hostel: 'bed-double', motel: 'bed-double', guest_house: 'bed-double',
  gym: 'dumbbell', sports_centre: 'dumbbell', fitness_centre: 'dumbbell', swimming_pool: 'dumbbell',
};

const INFRA_GLYPH: Record<string, GlyphName> = {
  traffic_signals: 'traffic-cone', bus_stop: 'bus', crossing: 'footprints', speed_camera: 'cctv',
  cctv: 'cctv', street_lamp: 'lamp', roundabout: 'circle-dot', road_sign: 'triangle-alert',
  mast: 'radio-tower', flagpole: 'flag', tower: 'radio-tower', water_tap: 'droplet',
  fire_hydrant: 'fire-extinguisher', power_substation: 'zap', ev_charging: 'ev-charger',
  recycling: 'recycle', waste_basket: 'trash-2', drinking_water: 'droplets', toilets: 'toilet',
  wastewater_plant: 'factory', pumping_station: 'gauge',
};

export const poiCategory = (p: Props) =>
  String(p.amenity ?? p.shop ?? p.tourism ?? p.leisure ?? p.office ?? p.type ?? 'poi');

/**
 * The infrastructure category. The DSO FastAPI derived it server-side; the Node port
 * does not send it yet, so derive the same mapping here when it is absent
 * (_archive/dso_api/routes/infrastructure.py `_derive_category`).
 */
export function infraCategory(p: Props): string {
  if (p.category) return String(p.category);
  const { highway, man_made: manMade, amenity, power, emergency } = p;
  if (highway === 'traffic_signals') return 'traffic_signals';
  if (highway === 'bus_stop') return 'bus_stop';
  if (highway === 'speed_camera') return 'speed_camera';
  if (highway === 'crossing') return 'crossing';
  if (highway === 'turning_circle' || highway === 'turning_loop') return 'roundabout';
  if (highway === 'stop' || highway === 'motorway_junction') return 'road_sign';
  if (manMade === 'surveillance' || manMade === 'camera') return 'cctv';
  if (typeof manMade === 'string' && manMade in INFRA_GLYPH) return manMade;
  if (amenity === 'charging_station') return 'ev_charging';
  if (typeof amenity === 'string' && amenity in INFRA_GLYPH) return amenity;
  if (emergency === 'fire_hydrant') return 'fire_hydrant';
  if (power === 'substation') return 'power_substation';
  return 'infrastructure';
}

function points(fc: FC, category: (p: Props) => string): DetailPoint[] {
  return fc.features.flatMap((f, i) => {
    const c = anchor(f);
    return c ? [{ id: String(f.properties?.osm_id ?? i), lng: c[0], lat: c[1], category: category(f.properties ?? {}), props: f.properties ?? {} }] : [];
  });
}

/** A representative coordinate: the point itself, or a polygon's vertex mean. */
export function anchor(f: Feature<Geometry, unknown>): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === 'Point') return (g as Point).coordinates as [number, number];
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null;
  if (!ring?.length) return null;
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

const poiPoints = memoOn((d: DetailData) => points(d.pois, poiCategory));
const infraPoints = memoOn((d: DetailData) => points(d.infrastructure, infraCategory));
const namedBuildings = memoOn((d: DetailData) =>
  points({ ...d.buildings, features: d.buildings.features.filter((f) => f.properties?.name) }, () => 'building'));

/** Building height in metres: explicit height, else levels × 3, else 15 (the DSO default). */
const HEIGHT: ExpressionSpecification = [
  'case',
  ['>', ['to-number', ['get', 'height'], 0], 0], ['to-number', ['get', 'height'], 0],
  ['>', ['to-number', ['get', 'levels'], 0], 0], ['*', ['to-number', ['get', 'levels'], 0], 3],
  15,
];

const MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link'];

// ── Descriptor ───────────────────────────────────────────────────────────────

export const detailLayer = defineLayer<DetailData>({
  id: 'detail',
  group: 'reference',
  label: 'map.layer.detail',
  order: 5,
  defaultVisible: false,
  source: {
    kind: 'rest',
    load: async () => {
      const { layers } = await api.layers.all();
      const empty = (): FC => ({ type: 'FeatureCollection', features: [] });
      const take = (k: keyof DetailData) => (layers[k] as unknown as FC | undefined) ?? empty();
      return {
        roads: take('roads'), buildings: take('buildings'), pois: take('pois'), parks: take('parks'),
        water: take('water'), railways: take('railways'), infrastructure: take('infrastructure'),
      };
    },
  },

  maplibre: {
    sources: (d) => ({
      'detail:parks': { type: 'geojson', data: d.parks },
      'detail:water': { type: 'geojson', data: d.water },
      'detail:railways': { type: 'geojson', data: d.railways },
      'detail:roads': { type: 'geojson', data: d.roads },
      'detail:buildings': { type: 'geojson', data: d.buildings },
    }),

    layers: (ctx) => {
      const sel = ctx.selection;
      const road = sel?.layerId === 'detail' && sel.kind === 'road' ? (sel.data as Props) : null;
      const building = sel?.layerId === 'detail' && sel.kind === 'building' ? sel.id : '__none__';
      const roadFilter: ExpressionSpecification = road?.name
        ? ['==', ['get', 'name'], String(road.name)]
        : ['==', ['to-string', ['get', 'osm_id']], road ? String(road.osm_id) : '__none__'];

      return [
        { id: 'detail:parks', type: 'fill', source: 'detail:parks', paint: { 'fill-color': css('--map-park'), 'fill-opacity': 0.9 } },
        { id: 'detail:water', type: 'fill', source: 'detail:water', paint: { 'fill-color': css('--map-water') } },
        {
          id: 'detail:railways', type: 'line', source: 'detail:railways',
          paint: { 'line-color': css('--map-rail'), 'line-width': 2, 'line-dasharray': [4, 3] },
        },
        {
          id: 'detail:roads-casing', type: 'line', source: 'detail:roads',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': css('--map-road-casing'),
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 20, 14],
          },
        },
        {
          id: 'detail:roads', type: 'line', source: 'detail:roads',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'highway'], MAJOR_ROADS, css('--map-road-major'), css('--map-road')],
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4.5, 20, 10],
          },
        },
        {
          id: 'detail:roads-selected', type: 'line', source: 'detail:roads', filter: roadFilter,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': css('--app-accent'),
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 20, 14],
            'line-opacity': 0.9,
          },
        },
        {
          id: 'detail:buildings', type: 'fill-extrusion', source: 'detail:buildings',
          paint: {
            'fill-extrusion-height': HEIGHT,
            'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
            'fill-extrusion-color': ['step', HEIGHT, css('--map-building'), 35, css('--map-building-high')],
            'fill-extrusion-opacity': 0.92,
            'fill-extrusion-vertical-gradient': true,
          },
        },
        {
          id: 'detail:buildings-selected', type: 'fill-extrusion', source: 'detail:buildings',
          filter: ['==', ['to-string', ['get', 'osm_id']], building],
          paint: {
            'fill-extrusion-height': HEIGHT,
            'fill-extrusion-base': ['to-number', ['get', 'min_height'], 0],
            'fill-extrusion-color': css('--app-accent'),
            'fill-extrusion-opacity': 0.95,
          },
        },
      ];
    },

    interactive: ['detail:roads', 'detail:buildings'],
  },

  // Points are context: neutral discs, glyph for the category, only once zoomed in.
  deck: (d, ctx) => {
    const ring = () => rgba('--app-border-strong');
    const glyphColour = () => rgba('--app-text-muted');
    return [
      ...discMarker({
        id: 'detail:pois',
        data: poiPoints(d),
        ctx,
        position: (p) => [p.lng, p.lat],
        glyph: (p) => POI_GLYPH[p.category] ?? 'map-pin',
        ring,
        glyphColor: glyphColour,
        radius: 8,
        visible: ctx.zoom >= 16,
      }),
      ...discMarker({
        id: 'detail:infra',
        data: infraPoints(d),
        ctx,
        position: (p) => [p.lng, p.lat],
        glyph: (p) => INFRA_GLYPH[p.category] ?? 'circle-dot',
        ring,
        glyphColor: glyphColour,
        radius: 7,
        // 700 crossings: only at street scale.
        visible: ctx.zoom >= 16,
      }),
      new TextLayer<DetailPoint>({
        id: 'detail:building-labels',
        data: namedBuildings(d),
        visible: ctx.zoom >= 16.5,
        getPosition: (p) => [p.lng, p.lat],
        getText: (p) => String(p.props.name),
        getSize: 11,
        getColor: rgba('--app-text-muted'),
        fontFamily: fontStack('--font-body'),
        characterSet: 'auto',
        outlineWidth: 2,
        outlineColor: rgba('--app-bg'),
        fontSettings: { sdf: true },
        updateTriggers: { getColor: [ctx.theme] },
      }),
    ];
  },

  pick: (hit: PickHit) => {
    if (hit.source === 'maplibre') {
      const p = (hit.feature.properties ?? {}) as Props;
      const id = String(p.osm_id ?? p.name ?? 'feature');
      if (hit.layerId === 'detail:roads') return { layerId: 'detail', kind: 'road', id, lngLat: hit.lngLat, data: p };
      if (hit.layerId === 'detail:buildings') return { layerId: 'detail', kind: 'building', id, lngLat: hit.lngLat, data: p };
      return null;
    }
    const point = hit.object as DetailPoint;
    const kind = hit.layerId.startsWith('detail:pois') ? 'poi' : 'infrastructure';
    return { layerId: 'detail', kind, id: point.id, lngLat: [point.lng, point.lat], data: point };
  },

  popup: DetailPopup,
});

