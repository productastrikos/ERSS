/**
 * Units — live fleet positions (docs/05 §7.5).
 *
 * Ambulance glyph in an --app-panel disc. The console is the ambulance service's, so the
 * ring's hue carries STATUS rather than agency: ready (success), heading to a patient
 * (accent, pulsing), on scene (danger), taking a patient to hospital (info), relocating
 * (dashed, muted). An ambulance on a job is drawn larger than one waiting at station, so
 * the eye goes to the ones that matter. A heading arrow orbits the disc whenever the unit
 * is moving. Positions glide between updates (deck.gl attribute transitions), and step
 * instead under prefers-reduced-motion. Status is never colour alone: the style, the size,
 * the pulse and the popup all say it too.
 */

import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Agency, Unit, UnitStatus } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { headingIcon } from '../icons/shapes';
import { rgba } from '../tokens';
import { discMarker, label, memoOn, pulsePhase } from './kit';
import { UnitPopup } from '../popups/OperationalPopups';

export interface UnitPoint extends Unit {
  lng: number;
  lat: number;
  seriesSlot: number;
  glyph: string;
  agencyName: string;
}

const MOVING: ReadonlySet<UnitStatus> = new Set(['relocating', 'responding', 'transporting']);
const PULSING: ReadonlySet<UnitStatus> = new Set(['assigned', 'responding']);
const RADIUS = 11;

/**
 * Join units to their agencies. Pages call this before feeding the layer, so the layer
 * never reaches into a store for agency colours.
 */
export function unitPoints(units: Unit[], agencies: Agency[]): UnitPoint[] {
  const byCode = new Map(agencies.map((a) => [a.code, a]));
  return units
    .filter((u): u is Unit & { lng: number; lat: number } =>
      u.lng != null && u.lat != null && u.status !== 'off_duty')
    .map((u) => {
      const a = byCode.get(u.agencyCode);
      return { ...u, seriesSlot: a?.series_slot ?? 1, glyph: a?.glyph ?? 'siren', agencyName: a?.short_name ?? u.agencyCode };
    })
    // A stable order: position transitions interpolate by index.
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

const moving = memoOn((units: UnitPoint[]) => units.filter((u) => MOVING.has(u.status) && u.heading != null));
const pulsing = memoOn((units: UnitPoint[]) => units.filter((u) => PULSING.has(u.status)));
/** Waiting units first, so an ambulance on a job always draws on top. */
const byActivity = memoOn((units: UnitPoint[]) => [...units].sort((a, b) => Number(ON_JOB.has(a.status)) - Number(ON_JOB.has(b.status))));
const position = (u: UnitPoint): [number, number] => [u.lng, u.lat];

const ON_JOB: ReadonlySet<UnitStatus> = new Set(['assigned', 'responding', 'on_scene', 'transporting', 'at_hospital']);
/** The legend's five rows, in the units they actually cover — narrower than the full
 *  status enum, matching what the ring colour and legend label say. */
const LEGEND_STATUS: Record<string, ReadonlySet<UnitStatus>> = {
  available: new Set(['available', 'standby']),
  responding: new Set(['assigned', 'responding']),
  on_scene: new Set(['on_scene']),
  to_hospital: new Set(['transporting', 'at_hospital']),
  relocating: new Set(['relocating']),
};
const STATUS_TOKEN: Partial<Record<UnitStatus, string>> = {
  available: '--app-success', standby: '--app-success',
  assigned: '--app-accent', responding: '--app-accent',
  on_scene: '--app-danger',
  transporting: '--app-info', at_hospital: '--app-info',
  relocating: '--app-text-muted',
};
const statusColour = (u: UnitPoint, alpha = 1) => rgba(STATUS_TOKEN[u.status] ?? '--app-text-faint', alpha);
const radiusOf = (u: UnitPoint) => (ON_JOB.has(u.status) ? RADIUS + 2 : RADIUS - 2);

export const unitsLayer = defineLayer<UnitPoint[]>({
  id: 'units',
  group: 'operational',
  label: 'map.layer.units',
  order: 80,
  defaultVisible: true,
  source: { kind: 'feed' },
  animated: (data) => data.some((u) => PULSING.has(u.status)),
  legend: [
    { label: 'map.legend.unitAvailable', key: 'available', swatch: { kind: 'disc-glyph', token: '--app-success' } },
    { label: 'map.legend.unitResponding', key: 'responding', swatch: { kind: 'disc-glyph', token: '--app-accent' } },
    { label: 'map.legend.unitOnScene', key: 'on_scene', swatch: { kind: 'disc-glyph', token: '--app-danger' } },
    { label: 'map.legend.unitToHospital', key: 'to_hospital', swatch: { kind: 'disc-glyph', token: '--app-info' } },
    { label: 'map.legend.unitRelocating', key: 'relocating', swatch: { kind: 'dashed', token: '--app-text-muted' } },
  ],
  filterFor: (data, key) => data.filter((u) => LEGEND_STATUS[key]?.has(u.status) ?? false),

  deck: (data, ctx) => {
    const transition = ctx.reducedMotion ? 0 : 900;
    const selected = ctx.selection?.kind === 'unit' ? ctx.selection.id : null;
    const ordered = byActivity(data);
    /**
     * Every ambulance is always an ambulance.
     *
     * This layer used to shrink an idle unit to a 3.5-pixel dot below zoom 12.5, because
     * eighty ringed discs at station read as a field of identical markers. With the trial
     * fleet at eight (config/poc.js) that problem is gone, and the cure had become the
     * disease: a green dot for a parked ambulance sat beside a red dot for a P1 and a blue
     * dot for a P3, and nobody could say which of the three was a vehicle. So the full
     * marker — the ambulance glyph in a status-ringed disc — is drawn at every zoom, and
     * the round disc is reserved for ambulances alone.
     */

    return [
      ...responding(pulsing(data), ctx),

      new IconLayer<UnitPoint>({
        id: 'units:heading',
        data: moving(data),
        sizeUnits: 'pixels',
        getPosition: position,
        getIcon: () => headingIcon(),
        getSize: RADIUS * 2 + 22,
        // deck.gl angles run counter-clockwise; a compass heading runs clockwise.
        getAngle: (u) => -(u.heading ?? 0),
        getColor: (u) => statusColour(u),
        transitions: { getPosition: transition, getAngle: transition },
        updateTriggers: { getColor: [ctx.theme] },
      }),

      ...discMarker({
        id: 'units:markers',
        data: ordered,
        ctx,
        position,
        glyph: (u) => u.glyph,
        ring: (u) => (u.ref === selected ? rgba('--app-text') : statusColour(u)),
        ringStyle: (u) => (u.status === 'relocating' ? 'dashed' : 'solid'),
        // The glyph wears the status too, so a ready ambulance reads green at a glance
        // rather than grey — "ready" is the thing a duty officer is scanning for.
        glyphColor: (u) => statusColour(u),
        radius: radiusOf,
        triggers: [selected],
      }).map((layer) => layer.clone({ transitions: { getPosition: transition } })),

      label({
        id: 'units',
        // Eight ambulances can all be named without colliding, and the callsign is how
        // the room talks about them: "Medic 7 is free" only helps if Medic 7 is findable.
        data: ordered,
        ctx,
        position,
        text: (u) => u.callsign,
        offset: [0, RADIUS + 13],
        size: 10,
        visible: ctx.zoom >= 11,
        triggers: [ctx.zoom],
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const u = hit.object as UnitPoint;
    return { layerId: 'units', kind: 'unit', id: u.ref, lngLat: position(u), data: u };
  },
  locate: (data, id) => {
    const u = data.find((x) => x.ref === id);
    return u ? position(u) : null;
  },
  popup: UnitPopup,
});

/** An expanding ring in the agency colour while a unit is committed to a call. */
function responding(units: UnitPoint[], ctx: LayerContext) {
  if (!units.length) return [];
  const phase = ctx.reducedMotion ? 0.35 : pulsePhase(ctx, 1600);
  return [
    new ScatterplotLayer<UnitPoint>({
      id: 'units:pulse',
      data: units,
      radiusUnits: 'pixels',
      getPosition: position,
      getRadius: RADIUS + 4,
      radiusScale: 1 + phase * 1.1,
      filled: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: (u) => statusColour(u),
      opacity: ctx.reducedMotion ? 0.5 : 0.8 * (1 - phase),
      updateTriggers: { getLineColor: [ctx.theme] },
    }),
  ];
}
