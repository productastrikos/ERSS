/**
 * The camera estate — every CCTV the detection engine watches, on the operations map.
 *
 * This is the layer that makes "the camera saw it first" a thing an operator can check
 * rather than a claim in a panel. Each camera is drawn where it is, looking the way it
 * looks: a disc for the mount and a translucent wedge for its field of view, so it is
 * obvious at a glance which cameras cover the junction a call just came from and which
 * way they are pointing.
 *
 * The mark is a WEDGE, not a disc, and that is the point. The cone already gives a camera
 * a silhouette nothing else on this map has; giving it a ringed disc as well put it into
 * the same visual class as the ambulances, the stations and the signals, and eighty marks
 * that differ only by a 9-pixel glyph is not something anyone can read at a glance. A
 * beacon sitting at the apex of its own cone says "the eye is here" and stops competing.
 *
 * Three states, and only three, because a video wall cannot carry more:
 *
 *   watching    the ordinary estate — quiet, low contrast, no pulse
 *   detecting   this camera is mid-detection — its wedge fills and its beacon pulses
 *   analytics   the camera runs incident analytics but is quiet — a faint accent beacon,
 *               so an operator can see which cameras COULD have raised something
 *
 * Indoor cameras are drawn at the building's footprint with their floor in the label.
 * A camera on floor 3 and a camera on the pavement outside are metres apart on a map and
 * completely different places to send a crew, so the floor is never dropped.
 */

import { IconLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Camera } from '../../../../lib/types';
import { defineLayer } from '../../layerRegistry';
import { rgba, TONE_TOKEN } from '../../tokens';
import type { LngLat } from '../../geometry';
import { label, pulsePhase } from '../kit';
import { beaconIcon } from '../../icons/shapes';
import { CameraPopup } from '../../popups/CameraPopup';

export interface CamerasFeed {
  cameras: Camera[];
  /** Cameras currently carrying a detection, by id. */
  detecting: string[];
}

const RAD = Math.PI / 180;

/** The wedge a camera sees: an arc of `fovDeg` centred on its bearing, `rangeM` deep. */
export function viewCone(c: Camera, steps = 14): LngLat[] {
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos(c.lat * RAD);
  const half = c.fovDeg / 2;
  const points: LngLat[] = [[c.lng, c.lat]];
  for (let i = 0; i <= steps; i++) {
    const deg = c.bearing - half + (c.fovDeg * i) / steps;
    const dx = Math.sin(deg * RAD) * c.rangeM;
    const dy = Math.cos(deg * RAD) * c.rangeM;
    points.push([c.lng + dx / mPerLng, c.lat + dy / mPerLat]);
  }
  points.push([c.lng, c.lat]);
  return points;
}

const raisesIncidents = (c: Camera) =>
  c.analytics.includes('incident_detection') || c.analytics.includes('person_down');

export const camerasLayer = defineLayer<CamerasFeed>({
  id: 'cameras',
  group: 'agency',
  label: 'map.layer.cameras',
  order: 55,
  defaultVisible: true,
  source: { kind: 'feed' },
  simulated: true,
  animated: (d) => d.detecting.length > 0,
  legend: [
    { label: 'map.legend.cameraDetecting', key: 'detecting', swatch: { kind: 'chevron', token: TONE_TOKEN.danger } },
    { label: 'map.legend.cameraAnalytics', key: 'analytics', swatch: { kind: 'chevron', token: '--app-accent' } },
    { label: 'map.legend.cameraWatching', key: 'watching', swatch: { kind: 'chevron', token: '--app-text-faint' } },
  ],
  filterFor: (d, key) => ({
    ...d,
    cameras: d.cameras.filter((c) => (
      key === 'detecting' ? d.detecting.includes(c.id)
        : key === 'analytics' ? raisesIncidents(c) && !d.detecting.includes(c.id)
          : !raisesIncidents(c)
    )),
  }),

  deck: (data, ctx) => {
    const live = new Set(data.detecting);
    const phase = pulsePhase(ctx, 1600);
    // The cones are context at emirate scale and would tile the whole map; they only
    // earn their pixels once the operator is close enough to read a junction.
    const showCones = ctx.zoom >= 13;

    const ringOf = (c: Camera) => (
      live.has(c.id) ? rgba(TONE_TOKEN.danger)
        : raisesIncidents(c) ? rgba('--app-accent', 0.75)
          : rgba('--app-border-strong')
    );

    return [
      new PolygonLayer<Camera>({
        id: 'cameras:cone',
        data: data.cameras,
        visible: showCones,
        pickable: false,
        getPolygon: (c) => viewCone(c),
        stroked: true,
        filled: true,
        getFillColor: (c) => (live.has(c.id)
          ? rgba(TONE_TOKEN.danger, 0.10 + 0.14 * Math.sin(phase * Math.PI * 2) ** 2)
          : rgba('--app-text-faint', 0.06)),
        getLineColor: (c) => (live.has(c.id) ? rgba(TONE_TOKEN.danger, 0.5) : rgba('--app-text-faint', 0.16)),
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        updateTriggers: {
          getFillColor: [ctx.theme, data.detecting.join(), phase],
          getLineColor: [ctx.theme, data.detecting.join()],
        },
      }),

      // The alarm halo, only while something is actually being detected.
      new ScatterplotLayer<Camera>({
        id: 'cameras:alarm',
        data: data.cameras.filter((c) => live.has(c.id)),
        pickable: false,
        radiusUnits: 'pixels',
        getPosition: (c) => [c.lng, c.lat],
        getRadius: 14 + phase * 16,
        getFillColor: rgba(TONE_TOKEN.danger, 0.32 * (1 - phase)),
        stroked: false,
        updateTriggers: { getRadius: [phase], getFillColor: [ctx.theme, phase] },
      }),

      // The mark: a wedge at the apex of the cone, turned to face the way the camera
      // looks, so the mark and its field of view are one object rather than two.
      new IconLayer<Camera>({
        id: 'cameras:beacon',
        data: data.cameras,
        pickable: true,
        sizeUnits: 'pixels',
        getPosition: (c) => [c.lng, c.lat],
        getIcon: () => beaconIcon(),
        getSize: (c) => (live.has(c.id) ? 26 : 18),
        // deck.gl angles run counter-clockwise; a compass bearing runs clockwise. The
        // beacon's own tip points down at the anchor, so it needs a half turn as well.
        getAngle: (c) => 180 - c.bearing,
        getColor: ringOf,
        updateTriggers: {
          getColor: [ctx.theme, data.detecting.join()],
          getSize: [data.detecting.join()],
        },
      }),

      // An indoor camera's floor is part of its identity, not a detail in a popup.
      label<Camera>({
        id: 'cameras:floor',
        data: data.cameras.filter((c) => c.floor != null),
        ctx,
        position: (c) => [c.lng, c.lat],
        text: (c) => `F${c.floor}`,
        size: 10,
        offset: [0, -16],
        color: rgba('--app-text-muted'),
        visible: ctx.zoom >= 14,
        mono: true,
      }),
    ];
  },

  pick: (hit, data) => {
    if (hit.source !== 'deck' || !hit.layerId.startsWith('cameras:')) return null;
    const c = hit.object as Camera | undefined;
    if (!c?.id) return null;
    return { layerId: 'cameras', kind: 'camera', id: c.id, lngLat: [c.lng, c.lat], data: { camera: c, detecting: data.detecting.includes(c.id) } };
  },
  popup: CameraPopup,
  locate: (data, id) => {
    const c = data.cameras.find((x) => x.id === id);
    return c ? [c.lng, c.lat] : null;
  },
});

/** Convenience for pages: the estate plus whichever cameras are mid-detection. */
export function camerasFeed(cameras: Camera[], detectingIds: string[]): CamerasFeed {
  return { cameras, detecting: detectingIds };
}

export type { Camera };
