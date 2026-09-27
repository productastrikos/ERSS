/**
 * Environment feed — air quality, wind, and pollution sources.
 *
 * MIGRATED from _legacy/utils/environmentLayers.ts (515 lines of deck.gl construction)
 * and DSOMap.tsx (the environment effect and its two hover tooltips). What changed:
 *
 * - ONE legacy layer with four sub-toggles became THREE descriptors (air quality, wind,
 *   pollution sources), so the layer control and legend generate them like any other.
 * - The AQI heat surface uses the sequential ramp, as every magnitude surface does
 *   (docs/05 §7.5), instead of the six-colour EPA rainbow. Sensors carry the AQI band as
 *   a STATUS tone, and the AQI number itself as a label — the value, not a colour, is
 *   what an officer reads.
 * - Emoji source icons became lucide glyphs; hex-to-RGB conversion is gone entirely.
 * - Hover-only tooltips became click popups: nothing on the video wall may depend on
 *   hover (docs/05 §7.4).
 * - The wind field feeds hazard-plume correlation (docs/14 §2.5), so it is data in the
 *   feed rather than a module-level array regenerated with Math.random on import.
 */

import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { defineLayer, type LayerContext } from '../../layerRegistry';
import { SEQUENTIAL, ramp, rgba, TONE_TOKEN, type Tone } from '../../tokens';
import type { GlyphName } from '../../icons/glyphs';
import { arrowIcon } from '../../icons/shapes';
import { discMarker, label, memoOn, pulsePhase } from '../kit';
import { EnvironmentPopup } from '../../popups/AgencyPopups';

// ── Feed contract ────────────────────────────────────────────────────────────

export interface AirSensor {
  id: string;
  name: string;
  zone: string;
  lng: number;
  lat: number;
  aqi: number;
  pm25: number;
  pm10: number;
  co2: number;
  no2: number;
  o3: number;
  temperatureC: number;
  humidityPct: number;
  windKph: number;
  windDirDeg: number;
  lastCalibration?: string | null;
}

export interface PollutionSource {
  id: string;
  name: string;
  kind: 'traffic' | 'industrial' | 'construction' | 'hvac' | 'other';
  lng: number;
  lat: number;
  emission: 'low' | 'medium' | 'high' | 'critical';
  contributionPct: number;
  affectedRadiusM: number;
  activeHours: string;
  mitigation: 'none' | 'monitoring' | 'active' | 'resolved';
  pollutants: { pm25: number; pm10: number; no2: number; co2: number; voc: number };
  trafficPerHour?: number | null;
  description?: string | null;
}

export interface WindVector {
  id: string;
  lng: number;
  lat: number;
  /** Compass bearing the wind blows TOWARDS, degrees clockwise from north. */
  towardsDeg: number;
  speedKph: number;
  altitudeM: number;
}

// ── Encoding ─────────────────────────────────────────────────────────────────

/** US EPA AQI bands, folded onto the status scale. */
export function aqiBand(aqi: number): { key: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'veryUnhealthy' | 'hazardous'; tone: Tone } {
  if (aqi <= 50) return { key: 'good', tone: 'success' };
  if (aqi <= 100) return { key: 'moderate', tone: 'warning' };
  if (aqi <= 150) return { key: 'sensitive', tone: 'warning' };
  if (aqi <= 200) return { key: 'unhealthy', tone: 'danger' };
  if (aqi <= 300) return { key: 'veryUnhealthy', tone: 'danger' };
  return { key: 'hazardous', tone: 'danger' };
}

export const emissionTone = (e: PollutionSource['emission']): Tone =>
  (e === 'critical' || e === 'high' ? 'danger' : e === 'medium' ? 'warning' : 'success');

const SOURCE_GLYPH: Record<PollutionSource['kind'], GlyphName> = {
  traffic: 'car', industrial: 'factory', construction: 'construction', hvac: 'wind', other: 'triangle-alert',
};

// ── Air quality ──────────────────────────────────────────────────────────────

export const airQualityLayer = defineLayer<AirSensor[]>({
  id: 'air-quality',
  group: 'agency',
  label: 'map.layer.airQuality',
  order: 58,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  legend: [
    { label: 'map.env.aqiSurface', swatch: { kind: 'ramp', tokens: SEQUENTIAL } },
    { label: 'map.env.aqiGood', swatch: { kind: 'ring', token: TONE_TOKEN.success } },
    { label: 'map.env.aqiModerate', swatch: { kind: 'ring', token: TONE_TOKEN.warning } },
    { label: 'map.env.aqiUnhealthy', swatch: { kind: 'ring', token: TONE_TOKEN.danger } },
  ],

  deck: (sensors, ctx) => [
    new HeatmapLayer<AirSensor>({
      id: 'air-quality:surface',
      data: sensors,
      getPosition: (s) => [s.lng, s.lat],
      // Weight on the same normalisation the legacy surface used (AQI / 300).
      getWeight: (s) => s.aqi / 300,
      radiusPixels: 80,
      intensity: 1.5,
      threshold: 0.05,
      colorRange: ramp(SEQUENTIAL.slice(1)),
      opacity: 0.6,
      updateTriggers: { getWeight: [sensors] },
    }),
    ...discMarker({
      id: 'air-quality:sensors',
      data: sensors,
      ctx,
      position: (s) => [s.lng, s.lat],
      glyph: () => 'gauge',
      ring: (s) => rgba(TONE_TOKEN[aqiBand(s.aqi).tone]),
      glyphColor: (s) => rgba(TONE_TOKEN[aqiBand(s.aqi).tone]),
      radius: 8,
      visible: ctx.zoom >= 13.5,
      triggers: [sensors],
    }),
    label({
      id: 'air-quality:sensors',
      data: sensors,
      ctx,
      position: (s) => [s.lng, s.lat],
      text: (s) => `AQI ${Math.round(s.aqi)}`,
      offset: [0, 18],
      size: 9.5,
      bold: true,
      visible: ctx.zoom >= 15,
      triggers: [sensors],
    }),
  ],

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const s = hit.object as AirSensor;
    return { layerId: 'air-quality', kind: 'air-sensor', id: s.id, lngLat: [s.lng, s.lat], data: s };
  },
  popup: EnvironmentPopup,
});

// ── Wind ─────────────────────────────────────────────────────────────────────

export const windLayer = defineLayer<WindVector[]>({
  id: 'wind',
  group: 'agency',
  label: 'map.layer.wind',
  order: 59,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  legend: [
    { label: 'map.env.windSurface', swatch: { kind: 'line', token: '--app-text-muted' } },
    { label: 'map.env.windAloft', swatch: { kind: 'line', token: '--app-info-soft' } },
  ],

  deck: (vectors, ctx) => [
    new IconLayer<WindVector>({
      id: 'wind:arrows',
      data: vectors,
      visible: ctx.zoom >= 13,
      sizeUnits: 'pixels',
      getPosition: (v) => [v.lng, v.lat],
      getIcon: () => arrowIcon(),
      // Length follows speed: 15 km/h draws at 22 px.
      getSize: (v) => Math.max(12, Math.min(40, (v.speedKph / 15) * 22)),
      getAngle: (v) => -v.towardsDeg,
      getColor: (v) => (v.altitudeM > 30 ? rgba('--app-info-soft', 0.75) : rgba('--app-text-muted', 0.7)),
      updateTriggers: { getColor: [ctx.theme, vectors], getSize: [vectors], getAngle: [vectors] },
    }),
  ],
});

// ── Pollution sources ────────────────────────────────────────────────────────

const critical = memoOn((sources: PollutionSource[]) => sources.filter((s) => s.emission === 'critical'));
const plumes = memoOn((sources: PollutionSource[]) => sources.filter((s) => s.emission === 'critical' || s.emission === 'high'));

export const pollutionLayer = defineLayer<PollutionSource[]>({
  id: 'pollution',
  group: 'agency',
  label: 'map.layer.pollution',
  order: 57,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  animated: (sources) => critical(sources).length > 0,
  legend: [
    { label: 'map.env.emissionHigh', swatch: { kind: 'ring', token: TONE_TOKEN.danger } },
    { label: 'map.env.emissionMedium', swatch: { kind: 'ring', token: TONE_TOKEN.warning } },
    { label: 'map.env.emissionLow', swatch: { kind: 'ring', token: TONE_TOKEN.success } },
    { label: 'map.env.plume', swatch: { kind: 'fill', token: '--app-danger-bg' } },
  ],

  deck: (sources, ctx) => [
    new ScatterplotLayer<PollutionSource>({
      id: 'pollution:plumes',
      data: plumes(sources),
      radiusUnits: 'meters',
      getPosition: (s) => [s.lng, s.lat],
      getRadius: (s) => s.affectedRadiusM,
      getFillColor: (s) => rgba(TONE_TOKEN[emissionTone(s.emission)], 0.1),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      getLineColor: (s) => rgba(TONE_TOKEN[emissionTone(s.emission)], 0.35),
      updateTriggers: { getFillColor: [ctx.theme, sources], getLineColor: [ctx.theme, sources] },
    }),
    ...criticalPulse(critical(sources), ctx),
    ...discMarker({
      id: 'pollution:sources',
      data: sources,
      ctx,
      position: (s) => [s.lng, s.lat],
      glyph: (s) => SOURCE_GLYPH[s.kind],
      ring: (s) => rgba(TONE_TOKEN[emissionTone(s.emission)]),
      glyphColor: (s) => rgba(TONE_TOKEN[emissionTone(s.emission)]),
      radius: 9,
      visible: ctx.zoom >= 13,
      triggers: [sources],
    }),
    label({
      id: 'pollution:sources',
      data: sources,
      ctx,
      position: (s) => [s.lng, s.lat],
      text: (s) => s.name.split(' ').slice(0, 2).join(' '),
      offset: [0, 20],
      size: 10,
      visible: ctx.zoom >= 15.5,
      triggers: [sources],
    }),
  ],

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const s = hit.object as PollutionSource;
    return { layerId: 'pollution', kind: 'pollution-source', id: s.id, lngLat: [s.lng, s.lat], data: s };
  },
  popup: EnvironmentPopup,
});

function criticalPulse(sources: PollutionSource[], ctx: LayerContext) {
  if (!sources.length) return [];
  const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 2400);
  return [
    new ScatterplotLayer<PollutionSource>({
      id: 'pollution:critical',
      data: sources,
      visible: ctx.zoom >= 13,
      radiusUnits: 'pixels',
      getPosition: (s) => [s.lng, s.lat],
      getRadius: 11,
      radiusScale: 1 + phase * 1.4,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba(TONE_TOKEN.danger),
      opacity: ctx.reducedMotion ? 0.5 : 0.8 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
