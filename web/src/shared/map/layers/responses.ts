/**
 * Responses — the road still ahead of every ambulance on a job.
 *
 * One line per ambulance, from where it is now to where it is going: the patient (danger
 * for a P1, accent otherwise), the hospital (info), or back to station (faint, dashed). A
 * crawling dash runs along live legs toward the destination, so a still screenshot and a
 * moving map both say "on its way". The path shortens as the ambulance drives, because the
 * server sends only what remains.
 */

import type { Feature, LineString } from 'geojson';
import type { Priority } from '../../../lib/types';
import { defineLayer } from '../layerRegistry';
import { css } from '../tokens';

type Path = Array<[number, number]>;
export type ResponseLeg = 'scene' | 'hospital' | 'return' | 'relocate';

export interface ResponseRoute {
  /** Assignment ref, or unit ref for a return leg. */
  ref: string;
  leg: ResponseLeg;
  priority: Priority | null;
  path: Path;
}

export interface ResponsesData {
  routes: ResponseRoute[];
}

/** The crawl: the gap slides forward half a unit per step. */
const DASH_SEQUENCE: number[][] = Array.from({ length: 8 }, (_, k) =>
  (k < 7 ? [k / 2, 4, 3 - k / 2] : [3.5, 3.5, 0.5]));

export const responsesLayer = defineLayer<ResponsesData>({
  id: 'responses',
  group: 'operational',
  label: 'map.layer.responses',
  order: 72,
  defaultVisible: true,
  source: { kind: 'feed' },
  animated: (d) => d.routes.some((r) => r.leg === 'scene' || r.leg === 'hospital'),
  legend: [
    { label: 'map.legend.toPatientP1', key: 'p1', swatch: { kind: 'line', token: '--app-danger' } },
    { label: 'map.legend.toPatient', key: 'scene', swatch: { kind: 'line', token: '--app-accent' } },
    { label: 'map.legend.toHospital', key: 'hospital', swatch: { kind: 'line', token: '--app-info' } },
    { label: 'map.legend.toStation', key: 'return', swatch: { kind: 'dashed', token: '--app-text-faint' } },
  ],
  filterFor: (data, key) => ({
    routes: data.routes.filter((r) => (
      key === 'p1' ? r.leg === 'scene' && r.priority === 'P1'
        : key === 'scene' ? r.leg === 'scene' && r.priority !== 'P1'
          : key === 'return' ? r.leg === 'return' || r.leg === 'relocate'
            : r.leg === key
    )),
  }),

  maplibre: {
    sources: (data) => {
      const features: Array<Feature<LineString, { ref: string; leg: ResponseLeg; tone: string }>> = data.routes
        .filter((r) => r.path.length > 1)
        .map((r) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: r.path },
          properties: {
            ref: r.ref,
            leg: r.leg,
            tone: r.leg === 'hospital' ? 'hospital' : r.leg === 'scene' ? (r.priority === 'P1' ? 'p1' : 'scene') : 'return',
          },
        }));
      return { 'responses:lines': { type: 'geojson', data: { type: 'FeatureCollection', features } } };
    },
    layers: () => {
      const live: ['in', ['get', 'leg'], ['literal', string[]]] = ['in', ['get', 'leg'], ['literal', ['scene', 'hospital']]];
      return [
        {
          id: 'responses:casing',
          type: 'line',
          source: 'responses:lines',
          filter: live,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': css('--app-panel', 0.85), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 11] },
        },
        {
          id: 'responses:line',
          type: 'line',
          source: 'responses:lines',
          filter: live,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'tone'],
              'p1', css('--app-danger'),
              'hospital', css('--app-info'),
              css('--app-accent')],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
          },
        },
        {
          id: 'responses:flow',
          type: 'line',
          source: 'responses:lines',
          filter: live,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': css('--app-panel', 0.9),
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.5],
            'line-dasharray': DASH_SEQUENCE[0],
          },
        },
        {
          id: 'responses:return',
          type: 'line',
          source: 'responses:lines',
          filter: ['in', ['get', 'leg'], ['literal', ['return', 'relocate']]],
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: { 'line-color': css('--app-text-faint', 0.8), 'line-width': 2, 'line-dasharray': [2, 2] },
        },
      ];
    },
    animate: (ctx) => (ctx.reducedMotion ? [] : [{
      layer: 'responses:flow',
      property: 'line-dasharray',
      value: DASH_SEQUENCE[Math.floor(ctx.time / 90) % DASH_SEQUENCE.length],
    }]),
  },
});
