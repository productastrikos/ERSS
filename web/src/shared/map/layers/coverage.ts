/**
 * Coverage rings — the reach of each positioned unit or site, from engines/coverage
 * (docs/08 §3.3).
 *
 * Per docs/05 §7.5: --app-success-border at the target response time, and
 * --app-warning-border at target + 2 min. Isochrone polygons when the engine has them;
 * a radius fallback otherwise, drawn as a true circle on the ground.
 */

import { PolygonLayer } from '@deck.gl/layers';
import { t } from '../../../lib/i18n';
import { defineLayer } from '../layerRegistry';
import { rgba } from '../tokens';
import { memoOn } from './kit';
import { circle } from '../geometry';

type Ring = Array<[number, number]>;

export interface CoverageArea {
  id: string;
  label?: string | null;
  /** Isochrone at the target time, or… */
  target?: Ring | null;
  late?: Ring | null;
  /** …a centre and radii to approximate it. */
  center?: [number, number] | null;
  targetRadiusM?: number | null;
  lateRadiusM?: number | null;
}

export interface CoverageData {
  areas: CoverageArea[];
  /** The response-time target the inner ring represents, minutes. */
  targetMin: number;
}

interface RingFeature { id: string; band: 'target' | 'late'; polygon: Ring }

const rings = memoOn((data: CoverageData): RingFeature[] => data.areas.flatMap((a) => {
  const out: RingFeature[] = [];
  const late = a.late ?? (a.center && a.lateRadiusM ? circle(a.center, a.lateRadiusM) : null);
  const target = a.target ?? (a.center && a.targetRadiusM ? circle(a.center, a.targetRadiusM) : null);
  if (late) out.push({ id: a.id, band: 'late', polygon: late });
  if (target) out.push({ id: a.id, band: 'target', polygon: target });
  return out;
}));

export const coverageLayer = defineLayer<CoverageData>({
  id: 'coverage',
  group: 'operational',
  label: 'map.layer.coverage',
  order: 30,
  defaultVisible: false,
  source: { kind: 'feed' },
  legend: (data) => [
    { label: t('map.legend.coverageTarget', { min: data.targetMin }), raw: true, swatch: { kind: 'ring', token: '--app-success' } },
    { label: t('map.legend.coverageTarget', { min: data.targetMin + 2 }), raw: true, swatch: { kind: 'ring', token: '--app-warning' } },
  ],

  deck: (data, ctx) => [
    new PolygonLayer<RingFeature>({
      id: 'coverage:rings',
      data: rings(data),
      getPolygon: (r) => r.polygon,
      filled: true,
      getFillColor: (r) => rgba(r.band === 'target' ? '--app-success-bg' : '--app-warning-bg', 0.5),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (r) => (r.band === 'target' ? 2 : 1.5),
      getLineColor: (r) => rgba(r.band === 'target' ? '--app-success-border' : '--app-warning-border', 2.4),
      updateTriggers: { getFillColor: [ctx.theme], getLineColor: [ctx.theme] },
    }),
  ],
});
