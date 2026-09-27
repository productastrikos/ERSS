/**
 * Risk terrain — the RTM grid from engines/risk (docs/08 §2.2).
 *
 * 500 m cells on the sequential ramp with an --app-chart-grid graticule (docs/05 §7.5).
 * Cells are classed by RANK, not raw score, so the ramp stays readable whatever the
 * score's scale. Cells the Getis–Ord Gi* test marks as significant hot spots carry a
 * danger outline — a cluster is reported as significant, not merely dark. Clicking a
 * cell shows WHY it is high risk: its factor contributions.
 */

import { PolygonLayer } from '@deck.gl/layers';
import { defineLayer } from '../layerRegistry';
import { SEQUENTIAL, rampAt, rgba } from '../tokens';
import { memoOn } from './kit';
import { RiskCellPopup } from '../popups/AnalyticalPopups';

export interface RiskCell {
  cellRef: string;
  /** Outer ring, [lng, lat]. */
  polygon: Array<[number, number]>;
  /** Relative risk from the fitted model. Only its order matters to the map. */
  score: number;
  factors: Array<{ name: string; contribution: number }>;
  /** Getis–Ord Gi* — present when the engine ran the significance test. */
  gi?: { z: number; p: number } | null;
}

export interface RiskData {
  cells: RiskCell[];
  /** Hour-of-week band the surface describes (0–5); risk is not static. */
  band?: number | null;
  method?: string;
  confidence?: number | null;
}

export interface RankedRiskCell extends RiskCell {
  /** Percentile rank in [0, 1]. */
  rank: number;
  method?: string;
  confidence?: number | null;
}

const SIGNIFICANCE = 0.05;

const ranked = memoOn((data: RiskData): RankedRiskCell[] => {
  const order = [...data.cells].sort((a, b) => a.score - b.score);
  const n = Math.max(1, order.length - 1);
  return order.map((c, i) => ({ ...c, rank: i / n, method: data.method, confidence: data.confidence }));
});

const isHotSpot = (c: RiskCell) => !!c.gi && c.gi.z > 0 && c.gi.p < SIGNIFICANCE;

export const riskLayer = defineLayer<RiskData>({
  id: 'risk',
  group: 'analytical',
  label: 'map.layer.risk',
  order: 20,
  defaultVisible: false,
  source: { kind: 'feed' },
  legend: [
    { label: 'map.legend.riskRamp', swatch: { kind: 'ramp', tokens: SEQUENTIAL } },
    { label: 'map.legend.riskSignificant', swatch: { kind: 'ring', token: '--app-danger' } },
  ],

  deck: (data, ctx) => {
    const cells = ranked(data);
    const selected = ctx.selection?.kind === 'risk-cell' ? ctx.selection.id : null;
    return [
      new PolygonLayer<RankedRiskCell>({
        id: 'risk:cells',
        data: cells,
        pickable: true,
        getPolygon: (c) => c.polygon,
        filled: true,
        // Opacity rises with rank as well as the hue step: the ramp's LOW end is its
        // lightest, and on the dark ground a pale low-risk cell would otherwise be the
        // brightest thing on the map.
        getFillColor: (c) => rampAt(SEQUENTIAL, c.rank, 0.18 + c.rank * 0.62),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (c) => (c.cellRef === selected ? 2.5 : isHotSpot(c) ? 1.5 : 1),
        getLineColor: (c) => (c.cellRef === selected
          ? rgba('--app-accent')
          : isHotSpot(c) ? rgba('--app-danger', 0.85) : rgba('--app-chart-grid')),
        updateTriggers: {
          getFillColor: [ctx.theme],
          getLineColor: [ctx.theme, selected],
          getLineWidth: [selected],
        },
      }),
    ];
  },

  pick: (hit) => {
    if (hit.source !== 'deck') return null;
    const c = hit.object as RankedRiskCell;
    return { layerId: 'risk', kind: 'risk-cell', id: c.cellRef, lngLat: hit.lngLat, data: c };
  },
  popup: RiskCellPopup,
});
