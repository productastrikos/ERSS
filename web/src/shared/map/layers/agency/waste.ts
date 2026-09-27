/**
 * Municipality feed — IoT waste bins: fill level, overflow, sensor health.
 *
 * MIGRATED from DSOMap.tsx (the waste bin marker effect) and _legacy/data/wasteBins.ts
 * `fillColor` / `fillLabel`. What changed and why:
 *
 * - Four hand-picked hexes became status tones on the same thresholds. OVERFLOW and
 *   CRITICAL are both danger; overflow is told apart by a FILLED disc and a pulse
 *   rather than by a fifth, near-identical red.
 * - Emoji bin-type icons (🗑️ ♻️ 🌱) became lucide glyphs.
 * - The overflow bin is a property of the feed (`overflow`), not a prop threaded from a
 *   panel into the map.
 * - Why this matters to an ERSS: an overflowing bin at a crowd venue is an access and
 *   sanitation obstruction the incident commander should see (docs/00 D-06).
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import { defineLayer, type LayerContext } from '../../layerRegistry';
import { rgba, TONE_TOKEN, type Tone } from '../../tokens';
import type { GlyphName } from '../../icons/glyphs';
import { discMarker, label, memoOn, pulsePhase } from '../kit';
import { WastePopup } from '../../popups/AgencyPopups';

// ── Feed contract ────────────────────────────────────────────────────────────

export interface WasteBin {
  id: string;
  name: string;
  zone: string;
  lng: number;
  lat: number;
  fillPct: number;
  capacityL: number;
  batteryPct: number;
  lastCollectedAt: string | null;
  kind: 'general' | 'recycling' | 'organic';
  sensor: 'online' | 'offline';
}

export interface WasteFeed {
  bins: WasteBin[];
}

// ── Encoding — thresholds from fillColor / fillLabel, unchanged ──────────────

export type FillBand = 'overflow' | 'critical' | 'warning' | 'normal';

export const fillBand = (pct: number): FillBand =>
  (pct >= 90 ? 'overflow' : pct >= 75 ? 'critical' : pct >= 55 ? 'warning' : 'normal');

export function binTone(b: WasteBin): Tone {
  if (b.sensor === 'offline') return 'neutral';
  const band = fillBand(b.fillPct);
  return band === 'overflow' || band === 'critical' ? 'danger' : band === 'warning' ? 'warning' : 'success';
}

const KIND_GLYPH: Record<WasteBin['kind'], GlyphName> = { general: 'trash-2', recycling: 'recycle', organic: 'leaf' };

const overflowing = memoOn((d: WasteFeed) => d.bins.filter((b) => b.sensor === 'online' && fillBand(b.fillPct) === 'overflow'));

// ── Descriptor ───────────────────────────────────────────────────────────────

export const wasteLayer = defineLayer<WasteFeed>({
  id: 'waste',
  group: 'agency',
  label: 'map.layer.waste',
  order: 56,
  defaultVisible: false,
  source: { kind: 'feed' },
  simulated: true,
  animated: (d) => overflowing(d).length > 0,
  legend: [
    { label: 'map.waste.overflow', swatch: { kind: 'dot', token: TONE_TOKEN.danger } },
    { label: 'map.waste.critical', swatch: { kind: 'ring', token: TONE_TOKEN.danger } },
    { label: 'map.waste.warning', swatch: { kind: 'ring', token: TONE_TOKEN.warning } },
    { label: 'map.waste.normal', swatch: { kind: 'ring', token: TONE_TOKEN.success } },
  ],

  deck: (d, ctx) => {
    const overflow = new Set(overflowing(d).map((b) => b.id));
    return [
      ...overflowPulse(overflowing(d), ctx),
      ...discMarker({
        id: 'waste:bins',
        data: d.bins,
        ctx,
        position: (b) => [b.lng, b.lat],
        glyph: (b) => KIND_GLYPH[b.kind],
        ring: (b) => rgba(TONE_TOKEN[binTone(b)]),
        // Overflow fills the disc; everything else keeps the panel core.
        fill: (b) => (overflow.has(b.id) ? rgba(TONE_TOKEN.danger) : rgba('--app-panel')),
        glyphColor: (b) => (overflow.has(b.id) ? rgba('--app-on-color') : rgba(TONE_TOKEN[binTone(b)])),
        radius: 8,
        visible: ctx.zoom >= 14,
        triggers: [d.bins],
      }),
      label({
        id: 'waste:bins',
        data: d.bins,
        ctx,
        position: (b) => [b.lng, b.lat],
        text: (b) => (b.sensor === 'offline' ? '—' : `${Math.round(b.fillPct)}%`),
        offset: [0, 18],
        size: 9.5,
        bold: true,
        visible: ctx.zoom >= 15.5,
        triggers: [d.bins],
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const b = hit.object as WasteBin;
    return { layerId: 'waste', kind: 'waste-bin', id: b.id, lngLat: [b.lng, b.lat], data: b };
  },
  popup: WastePopup,
});

function overflowPulse(bins: WasteBin[], ctx: LayerContext) {
  if (!bins.length) return [];
  const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 1600);
  return [
    new ScatterplotLayer<WasteBin>({
      id: 'waste:overflow',
      data: bins,
      visible: ctx.zoom >= 14,
      radiusUnits: 'pixels',
      getPosition: (b) => [b.lng, b.lat],
      getRadius: 10,
      radiusScale: 1 + phase * 1.2,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: rgba(TONE_TOKEN.danger),
      opacity: ctx.reducedMotion ? 0.5 : 0.85 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
