/**
 * Facilities — stations, hospitals and public-access defibrillators.
 *
 * Three descriptors, because they are toggled independently in the layer control and
 * load from three endpoints. Stations wear their agency's series colour and glyph
 * (agencies.series_slot, agencies.glyph), so a police post never reads as an
 * ambulance station.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import { api } from '../../../lib/api';
import type { Aed, Agency, Hospital, Station } from '../../../lib/types';
import { defineLayer } from '../layerRegistry';
import { rgba, seriesToken } from '../tokens';
import { discMarker, memoOn } from './kit';
import { AedPopup, HospitalPopup, StationPopup } from '../popups/ReferencePopups';

export interface StationPoint extends Station {
  seriesSlot: number;
  glyph: string;
  agencyName: string;
}

// ── Stations ─────────────────────────────────────────────────────────────────

export const stationsLayer = defineLayer<StationPoint[]>({
  id: 'stations',
  group: 'reference',
  label: 'map.layer.stations',
  order: 40,
  defaultVisible: true,
  source: {
    kind: 'rest',
    load: async () => {
      // DCAS ambulance stations only: this deployment is the ambulance service's console.
      const [stations, agencies] = await Promise.all([api.stations({ agency: 'DCAS' }), api.agencies()]);
      const byCode = new Map<string, Agency>(agencies.map((a) => [a.code, a]));
      return stations.map((s) => {
        const agency = s.agencyCode ? byCode.get(s.agencyCode) : undefined;
        return {
          ...s,
          seriesSlot: agency?.series_slot ?? 1,
          glyph: agency?.glyph ?? 'building-2',
          agencyName: agency?.short_name ?? s.agencyCode ?? '—',
        };
      });
    },
  },
  // One entry per agency actually on the map, in that agency's own series colour.
  legend: (data) => [...new Map(data.map((s) => [s.agencyCode, s])).values()]
    .sort((a, b) => a.seriesSlot - b.seriesSlot)
    .map((s) => ({ label: s.agencyName, key: s.agencyCode ?? s.agencyName, raw: true, swatch: { kind: 'dot', token: seriesToken(s.seriesSlot) } })),
  filterFor: (data, key) => data.filter((s) => s.agencyCode === key),

  // Stations are context, not events. A neutral plate keeps 169 of them from out-shouting
  // a live incident; the agency reads from the glyph's shape and colour. Hidden at
  // emirate scale, where they would only be clutter.
  //
  // SQUARE, not round: a station is a building that does not move, and the map's rule is
  // that the silhouette says which kind of thing this is before any glyph is legible.
  // An ambulance sitting on its station forecourt and the station itself were previously
  // two discs with an ambulance glyph in each.
  deck: (data, ctx) => discMarker({
    id: 'stations:markers',
    data,
    ctx,
    shape: 'plate',
    position: (s) => [s.lng, s.lat],
    glyph: (s) => s.glyph,
    ring: () => rgba('--app-border-strong'),
    glyphColor: (s) => rgba(seriesToken(s.seriesSlot), 0.9),
    fill: rgba('--app-panel'),
    radius: 8,
    visible: ctx.zoom >= 11.5,
  }),

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const s = hit.object as StationPoint;
    return { layerId: 'stations', kind: 'station', id: s.ref, lngLat: [s.lng, s.lat], data: s };
  },
  popup: StationPopup,
});

// ── Hospitals ────────────────────────────────────────────────────────────────

export const hospitalsLayer = defineLayer<Hospital[]>({
  id: 'hospitals',
  group: 'reference',
  label: 'map.layer.hospitals',
  order: 42,
  defaultVisible: true,
  source: { kind: 'rest', load: () => api.hospitals() },
  legend: [
    { label: 'map.legend.hospitalOpen', key: 'open', swatch: { kind: 'ring', token: '--app-info' } },
    { label: 'map.legend.hospitalDiversion', key: 'diversion', swatch: { kind: 'ring', token: '--app-danger' } },
  ],
  filterFor: (data, key) => data.filter((h) => h.onDiversion === (key === 'diversion')),

  // Also a plate — a hospital is the other fixed building on this map, and the pair have
  // to read as the same KIND of thing at a glance, told apart by glyph and hue.
  deck: (data, ctx) => discMarker({
    id: 'hospitals:markers',
    data,
    ctx,
    shape: 'plate',
    position: (h) => [h.lng, h.lat],
    glyph: () => 'hospital',
    // Diversion is a STATUS, so it takes the status hue; an open ED stays calm.
    ring: (h) => rgba(h.onDiversion ? '--app-danger' : '--app-info'),
    glyphColor: (h) => rgba(h.onDiversion ? '--app-danger' : '--app-info'),
    radius: 11,
  }),

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const h = hit.object as Hospital;
    return { layerId: 'hospitals', kind: 'hospital', id: h.ref, lngLat: [h.lng, h.lat], data: h };
  },
  popup: HospitalPopup,
});

// ── AEDs ─────────────────────────────────────────────────────────────────────

const availableFirst = memoOn((aeds: Aed[]) => [...aeds].sort((a, b) => Number(a.available) - Number(b.available)));

export const aedsLayer = defineLayer<Aed[]>({
  id: 'aeds',
  group: 'reference',
  label: 'map.layer.aeds',
  order: 44,
  defaultVisible: false,
  source: { kind: 'rest', load: () => api.aeds() },
  legend: [
    { label: 'map.legend.aedAvailable', key: 'available', swatch: { kind: 'dot', token: '--app-success' } },
    { label: 'map.legend.aedUnavailable', key: 'unavailable', swatch: { kind: 'dot', token: '--app-text-faint' } },
  ],
  filterFor: (data, key) => data.filter((a) => a.available === (key === 'available')),

  // Nine hundred cabinets: a dot, not a disc marker, and only once zoomed in far enough
  // for them to separate.
  deck: (data, ctx) => [
    new ScatterplotLayer<Aed>({
      id: 'aeds:dots',
      data: availableFirst(data),
      visible: ctx.zoom >= 12,
      pickable: true,
      radiusUnits: 'pixels',
      getRadius: ctx.zoom >= 15 ? 5 : 3.5,
      getPosition: (a) => [a.lng, a.lat],
      getFillColor: (a) => rgba(a.available ? '--app-success' : '--app-text-faint'),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      getLineColor: rgba('--app-panel'),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ],

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const a = hit.object as Aed;
    return { layerId: 'aeds', kind: 'aed', id: a.ref, lngLat: [a.lng, a.lat], data: a };
  },
  popup: AedPopup,
});
