/**
 * Civil Defence feed — building-management status across a district (the DSO "BMS
 * city" overlay).
 *
 * MIGRATED from DSOMap.tsx (the BMS overlay effect) and _legacy/data/bmsBuildings.ts
 * `getBuildingColor`. What changed and why:
 *
 * - Each display mode's hard-coded RGBA thresholds became STATUS tones: an overloaded
 *   power plant and a critical alarm are both "act now", and they read the same way.
 * - The overlay no longer depends on detail geometry to be visible: every BMS building
 *   is a pickable marker. When detail building footprints ARE present, they are
 *   extruded in the tone of their nearest BMS building.
 * - Nearest-building matching is now capped at 200 m. The legacy matched every polygon
 *   in view to SOME building however far away, painting a status onto buildings no
 *   sensor reports on.
 * - A building with live fire alarms pulses.
 * - The DSO map special-cased BLD_001 (The NEST) to open its digital twin. The layer
 *   now emits a plain `bms-building` selection for every building; opening a twin
 *   is the page's decision (Phase 9, the Civil Defence feed).
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { t } from '../../../../lib/i18n';
import { defineLayer, type LayerContext, type LegendEntry } from '../../layerRegistry';
import { css, rgba, TONE_TOKEN, type Tone } from '../../tokens';
import { metres, type LngLat } from '../../geometry';
import { discMarker, memoOn, pulsePhase } from '../kit';
import { anchor, type DetailData } from '../detail';
import { BmsPopup } from '../../popups/AgencyPopups';

// ── Feed contract ────────────────────────────────────────────────────────────

export type BmsMode = 'status' | 'power' | 'hvac' | 'occupancy' | 'water';
export type BmsSystem = 'power' | 'hvac' | 'fire' | 'occupancy' | 'water';

export interface BmsBuilding {
  id: string;
  name: string;
  type: string;
  lng: number;
  lat: number;
  floors: number;
  heightM: number;
  status: 'normal' | 'warning' | 'critical';
  powerLoadPct: number;
  hvacEfficiencyPct: number;
  occupancyPct: number;
  occupancyCount: number;
  waterPressureBar: number;
  fireAlarms: number;
  alerts: Array<{ id: string; system: BmsSystem; severity: 'info' | 'warning' | 'critical'; message: string }>;
}

export interface BmsFeed {
  buildings: BmsBuilding[];
  mode: BmsMode;
}

// ── Encoding — thresholds from getBuildingColor, unchanged ───────────────────

export function bmsTone(b: BmsBuilding, mode: BmsMode): Tone {
  switch (mode) {
    case 'power':     return b.powerLoadPct > 90 ? 'danger' : b.powerLoadPct > 75 ? 'warning' : 'success';
    case 'hvac':      return b.hvacEfficiencyPct < 60 ? 'danger' : b.hvacEfficiencyPct < 75 ? 'warning' : 'success';
    case 'occupancy': return b.occupancyPct > 88 ? 'danger' : b.occupancyPct > 70 ? 'warning' : 'success';
    case 'water':
      return b.waterPressureBar === 0 || b.waterPressureBar < 2.6 ? 'danger' : b.waterPressureBar < 3.0 ? 'warning' : 'success';
    default:          return b.status === 'critical' ? 'danger' : b.status === 'warning' ? 'warning' : 'success';
  }
}

const LEGEND: Record<BmsMode, [string, string, string]> = {
  status:    ['map.bms.statusNormal', 'map.bms.statusWarning', 'map.bms.statusCritical'],
  power:     ['map.bms.powerNormal', 'map.bms.powerHigh', 'map.bms.powerOverload'],
  hvac:      ['map.bms.hvacGood', 'map.bms.hvacDegraded', 'map.bms.hvacPoor'],
  occupancy: ['map.bms.occupancyNormal', 'map.bms.occupancyBusy', 'map.bms.occupancyCrowded'],
  water:     ['map.bms.pressureNormal', 'map.bms.pressureLow', 'map.bms.pressureFailing'],
};

/** Match within this distance or not at all. */
const MATCH_RADIUS_M = 200;

const alarmed = memoOn((d: BmsFeed) => d.buildings.filter((b) => b.fireAlarms > 0));

// ── Descriptor ───────────────────────────────────────────────────────────────

export const bmsLayer = defineLayer<BmsFeed>({
  id: 'bms',
  group: 'agency',
  label: 'map.layer.bms',
  order: 52,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  dependsOn: ['detail'],
  animated: (d) => d.buildings.some((b) => b.fireAlarms > 0),
  legend: (d): LegendEntry[] => {
    const [ok, warn, bad] = LEGEND[d.mode];
    return [
      { label: ok, swatch: { kind: 'ring', token: TONE_TOKEN.success } },
      { label: warn, swatch: { kind: 'ring', token: TONE_TOKEN.warning } },
      { label: bad, swatch: { kind: 'ring', token: TONE_TOKEN.danger } },
      { label: t('map.bms.fireAlarm'), raw: true, swatch: { kind: 'dot', token: TONE_TOKEN.danger } },
    ];
  },

  maplibre: {
    sources: (d, ctx) => ({ 'bms:footprints': { type: 'geojson', data: { type: 'FeatureCollection', features: footprints(d, ctx) } } }),
    layers: () => [{
      id: 'bms:footprints',
      type: 'fill-extrusion',
      source: 'bms:footprints',
      paint: {
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': 0,
        'fill-extrusion-color': ['match', ['get', 'tone'],
          'danger', css(TONE_TOKEN.danger), 'warning', css(TONE_TOKEN.warning), css(TONE_TOKEN.success)],
        'fill-extrusion-opacity': 0.8,
        'fill-extrusion-vertical-gradient': true,
      },
    }],
    interactive: ['bms:footprints'],
  },

  deck: (d, ctx) => [
    ...alarmPulse(alarmed(d), ctx),
    ...discMarker({
      id: 'bms:markers',
      data: d.buildings,
      ctx,
      position: (b) => [b.lng, b.lat],
      glyph: () => 'building-2',
      ring: (b) => rgba(TONE_TOKEN[bmsTone(b, d.mode)]),
      glyphColor: (b) => rgba(TONE_TOKEN[bmsTone(b, d.mode)]),
      radius: 9,
      visible: ctx.zoom >= 13.5,
      triggers: [d.mode, d.buildings],
    }),
  ],

  pick: (hit, d) => {
    const id = hit.source === 'maplibre'
      ? String(hit.feature.properties?.bmsId ?? '')
      : (hit.object as BmsBuilding).id;
    const b = d.buildings.find((x) => x.id === id);
    return b ? { layerId: 'bms', kind: 'bms-building', id: b.id, lngLat: [b.lng, b.lat], data: { building: b, mode: d.mode } } : null;
  },
  popup: BmsPopup,
});

/** Detail footprints near a BMS building, extruded in that building's tone. */
function footprints(d: BmsFeed, ctx: LayerContext): Array<Feature<Polygon | MultiPolygon>> {
  const detail = ctx.dataOf<DetailData>('detail');
  if (!detail?.buildings.features.length || !d.buildings.length) return [];

  const out: Array<Feature<Polygon | MultiPolygon>> = [];
  for (const f of detail.buildings.features) {
    const g = f.geometry;
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue;
    const c = anchor(f);
    if (!c) continue;

    let best: BmsBuilding | null = null;
    let bestD = MATCH_RADIUS_M;
    for (const b of d.buildings) {
      const dist = metres(c, [b.lng, b.lat] as LngLat);
      if (dist < bestD) { bestD = dist; best = b; }
    }
    if (!best) continue;

    const p = f.properties ?? {};
    const heightM = Number(p.height) > 0 ? Number(p.height) : Number(p.levels) > 0 ? Number(p.levels) * 3 : best.heightM;
    out.push({ type: 'Feature', geometry: g, properties: { bmsId: best.id, tone: bmsTone(best, d.mode), heightM } });
  }
  return out;
}

function alarmPulse(buildings: BmsBuilding[], ctx: LayerContext) {
  if (!buildings.length) return [];
  const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 1400);
  return [
    new ScatterplotLayer<BmsBuilding>({
      id: 'bms:fire-alarm',
      data: buildings,
      radiusUnits: 'pixels',
      getPosition: (b) => [b.lng, b.lat],
      getRadius: 11,
      radiusScale: 1 + phase * 1.6,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getLineColor: rgba(TONE_TOKEN.danger),
      opacity: ctx.reducedMotion ? 0.6 : 0.9 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
