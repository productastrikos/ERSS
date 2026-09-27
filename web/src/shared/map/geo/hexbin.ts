/**
 * The demand surface, aggregated in the browser.
 *
 * The server sends every call in the window binned to a ~110 m grid (insights.geo). This
 * re-bins that grid into hexagons of whatever size the analyst has asked for, and computes
 * the four measures the surface can be coloured and raised by. It runs in a few
 * milliseconds on twelve thousand cells, which is what lets the hexagon size, the measure
 * and the hour of day be dials on the screen rather than round trips to the database.
 *
 * Hexagons rather than squares because a square grid has two spacings — a cell's edge
 * neighbours are closer than its corner neighbours — so a ridge of demand running
 * diagonally looks different from the same ridge running north. Every hexagon has six
 * equidistant neighbours, which is why every serious density map uses them.
 *
 * Measures are computed from SUMS, never from averages of averages: mean response time is
 * Σseconds / Σcalls across the cells in the hexagon, not the mean of each cell's mean.
 */

export type LngLat = [number, number];

/** The columnar payload from /api/insights/geo. */
export interface GeoSurface {
  at: string;
  window: { months: number; to: string };
  source: string;
  filters: unknown;
  cell: number;
  count: number;
  totals: { calls: number; urgent: number; respMeanSec: number | null; withinTargetPct: number | null };
  cells: {
    gx: number[];
    gy: number[];
    calls: number[];
    urgent: number[];
    respSec: number[];
    respN: number[];
    withinN: number[];
  };
  /** 24 slots per cell, flat — only when the time-lapse asked for it. */
  hours: number[] | null;
}

export type GeoMeasure = 'calls' | 'urgent' | 'response' | 'target';

export interface HexCell {
  /** Stable id: the axial coordinates of the hexagon. */
  id: string;
  centre: LngLat;
  calls: number;
  urgent: number;
  respSec: number;
  respN: number;
  withinN: number;
  /** The value the surface is coloured and raised by, in the chosen measure. */
  value: number;
  /** Null where a measure has nothing to stand on (no response times in this hexagon). */
  defined: boolean;
}

export interface HexSurface {
  cells: HexCell[];
  /** Radius used, in metres. */
  radiusM: number;
  measure: GeoMeasure;
  /** Ascending break points — the ramp's band edges (5 breaks for 6 bands). */
  breaks: number[];
  min: number;
  max: number;
  /** The busiest hexagon — what column height is drawn against, whatever the measure is. */
  maxCalls: number;
  /** Totals for the hexagons actually produced. */
  totals: { calls: number; hexes: number };
}

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Cube rounding — the standard way to snap a fractional axial coordinate to a hexagon. */
function axialRound(q: number, r: number): [number, number] {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

/**
 * Bin the grid into pointy-top hexagons of `radiusM` (centre to corner).
 *
 * `hour` picks one hour of the day out of the surface's histogram — the time-lapse — and
 * scales the other measures by that hour's share, so "mean response in this hexagon at
 * 02:00" is not silently the whole day's mean.
 */
export function hexbin(
  surface: GeoSurface,
  opts: { radiusM: number; measure: GeoMeasure; hour?: number | null; minCalls?: number },
): HexSurface {
  const { cells } = surface;
  const n = cells.gx.length;
  const radius = Math.max(60, opts.radiusM);
  const hour = opts.hour ?? null;
  const minCalls = opts.minCalls ?? 1;

  // A local metric frame centred on the data: at emirate scale the error from treating
  // longitude as locally linear is centimetres, and it keeps the hexagons regular.
  let lat0 = 0;
  for (let i = 0; i < n; i++) lat0 += cells.gy[i];
  lat0 = n ? ((lat0 / n) + 0.5) * surface.cell : 25.2;
  const kx = mPerDegLng(lat0);

  const bins = new Map<string, HexCell>();
  const sqrt3 = Math.sqrt(3);

  for (let i = 0; i < n; i++) {
    const share = hour == null ? 1
      : surface.hours ? (cells.calls[i] ? surface.hours[i * 24 + hour] / cells.calls[i] : 0)
        : 1;
    if (share <= 0) continue;

    const lng = (cells.gx[i] + 0.5) * surface.cell;
    const lat = (cells.gy[i] + 0.5) * surface.cell;
    const x = lng * kx;
    const y = lat * M_PER_DEG_LAT;
    const [q, r] = axialRound((sqrt3 / 3 * x - y / 3) / radius, (2 / 3 * y) / radius);
    const id = `${q}:${r}`;

    let cell = bins.get(id);
    if (!cell) {
      const cx = radius * sqrt3 * (q + r / 2);
      const cy = radius * 1.5 * r;
      cell = {
        id,
        centre: [cx / kx, cy / M_PER_DEG_LAT],
        calls: 0, urgent: 0, respSec: 0, respN: 0, withinN: 0, value: 0, defined: false,
      };
      bins.set(id, cell);
    }
    cell.calls += hour == null ? cells.calls[i] : surface.hours ? surface.hours[i * 24 + hour] : cells.calls[i];
    cell.urgent += cells.urgent[i] * share;
    cell.respSec += cells.respSec[i] * share;
    cell.respN += cells.respN[i] * share;
    cell.withinN += cells.withinN[i] * share;
  }

  const out: HexCell[] = [];
  for (const cell of bins.values()) {
    if (cell.calls < minCalls) continue;
    const { value, defined } = measureOf(cell, opts.measure);
    cell.value = value;
    cell.defined = defined;
    out.push(cell);
  }

  const values = out.filter((c) => c.defined).map((c) => c.value).sort((a, b) => a - b);
  return {
    cells: out,
    radiusM: radius,
    measure: opts.measure,
    breaks: quantiles(values, 5),
    min: values.length ? values[0] : 0,
    max: values.length ? values[values.length - 1] : 0,
    maxCalls: Math.max(1, ...out.map((c) => c.calls)),
    totals: { calls: out.reduce((a, c) => a + c.calls, 0), hexes: out.length },
  };
}

function measureOf(c: HexCell, measure: GeoMeasure): { value: number; defined: boolean } {
  switch (measure) {
    case 'urgent':
      return { value: c.calls ? (100 * c.urgent) / c.calls : 0, defined: c.calls > 0 };
    case 'response':
      return { value: c.respN ? c.respSec / c.respN : 0, defined: c.respN >= 3 };
    case 'target':
      return { value: c.respN ? (100 * c.withinN) / c.respN : 0, defined: c.respN >= 3 };
    default:
      return { value: c.calls, defined: c.calls > 0 };
  }
}

/**
 * Band edges by QUANTILE, not by equal width — with two fallbacks for the shapes a
 * quantile split cannot handle.
 *
 * Demand is a power law: a handful of hexagons around a mall or an interchange carry
 * hundreds of calls while most carry a handful. Split into equal-width bands, the whole
 * emirate lands in band one and the map says nothing. Quantiles put roughly the same
 * number of hexagons in each band, which is what makes the pattern visible.
 *
 * But quantiles fail on TIES, and both measures here produce them: an hour of one month is
 * three hundred hexagons with one call each, and target attainment piles up at 100%. Five
 * identical edges give a legend reading "1 1 1 1 2", so there is a ladder:
 *
 *   1. quantiles over the data          — the default, and right for call volume
 *   2. one band per value               — when there are barely more values than bands
 *   3. quantiles over the DISTINCT values — when the data ties: it spreads the bands across
 *      the range that exists rather than across the crowd sitting on one number, which is
 *      what attainment (everything between 60% and 100%) needs
 *   4. equal width                      — the last resort, when even that is degenerate
 */
function quantiles(sorted: number[], count: number): number[] {
  if (sorted.length < count + 1) return [];

  const distinct: number[] = [];
  for (const v of sorted) if (distinct[distinct.length - 1] !== v) distinct.push(v);
  if (distinct.length <= count + 1) return distinct.slice(0, count);

  const cut = (values: number[]) => Array.from({ length: count }, (_, i) => {
    const pos = ((i + 1) / (count + 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    return values[lo] + (values[hi] - values[lo]) * (pos - lo);
  });

  const byData = cut(sorted);
  if (new Set(byData).size === count) return byData;

  const byValue = cut(distinct);
  if (new Set(byValue).size === count) return byValue;

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (!(max > min)) return byData;
  return Array.from({ length: count }, (_, i) => min + ((i + 1) / (count + 1)) * (max - min));
}

/** Which band (0…5) a value falls in. */
export function bandOf(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

/** A measure's value, formatted for a legend or a tooltip. */
export function formatMeasure(measure: GeoMeasure, value: number): string {
  switch (measure) {
    case 'urgent':
    case 'target':
      return `${Math.round(value)}%`;
    case 'response': {
      const s = Math.round(value);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    default:
      return Math.round(value).toLocaleString('en-GB');
  }
}

/** Response time and target attainment are better when LOWER / HIGHER respectively. */
export const measureIsInverted = (measure: GeoMeasure) => measure === 'target';
