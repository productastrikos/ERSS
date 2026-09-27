/**
 * Turning an aggregate's `{ actual, forecast }` pair into chart series.
 *
 * Every insights endpoint returns the same two-part shape — measured rows, then forecast
 * rows carrying the same keys plus `lower80`/`upper80`/`lower95`/`upper95`. Every chart
 * then has to do the same four fiddly things: build one shared label axis across both
 * arrays, join the dashed line to the last measured point so there is no gap, attach the
 * band the operator chose, and work out where "the future" begins.
 *
 * Doing that once here is what keeps the forecast rendered IDENTICALLY on eight pages.
 * A card that drew its prediction slightly differently would quietly teach the operator
 * that the dashing means something page-specific, which is exactly the confusion the
 * convention exists to prevent.
 */

import type { LineSeries } from './index';

export interface BandFields {
  lower80?: number;
  upper80?: number;
  lower95?: number;
  upper95?: number;
}

export interface TrendSpec {
  name: string;
  /** Measured rows, oldest first. */
  actual: readonly object[];
  /** Forecast rows, same label/value keys, oldest first. Band fields optional. */
  forecast?: readonly object[];
  /** Which field holds the x label ('day', 'month', 'hour'). */
  labelKey: string;
  /** Which field holds the y value. Forecast rows may use a different one. */
  valueKey: string;
  forecastValueKey?: string;
  tone?: string;
  /** 80, 95, or 0 for no band. */
  interval?: number;
}

export interface Trend {
  series: LineSeries[];
  labels: string[];
  /** x of the first forecast point, for the divider and the future wash. */
  forecastFromX: number | null;
  /** True when a forecast was requested but the series was too short to produce one. */
  forecastEmpty: boolean;
}

const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rows come from typed interfaces, which have no index signature — read through here. */
const field = (row: object, key: string): unknown => (row as Record<string, unknown>)[key];

/**
 * @param specs one per metric on the chart; the first one's labels lead the axis
 * @param opts.forecastSuffix what the dashed series is called, e.g. "Calls · forecast"
 */
export function buildTrend(
  specs: TrendSpec[],
  { forecastSuffix = 'forecast' }: { forecastSuffix?: string } = {},
): Trend {
  // One shared axis: measured labels in order, then any forecast label not already on it.
  const labels: string[] = [];
  const index = new Map<string, number>();
  const push = (label: string) => {
    if (index.has(label)) return;
    index.set(label, labels.length);
    labels.push(label);
  };
  for (const s of specs) for (const r of s.actual) push(String(field(r, s.labelKey)));
  let firstForecastLabel: string | null = null;
  for (const s of specs) {
    for (const r of s.forecast ?? []) {
      const label = String(field(r, s.labelKey));
      if (!index.has(label) && firstForecastLabel == null) firstForecastLabel = label;
      push(label);
    }
  }

  const series: LineSeries[] = [];
  let forecastEmpty = false;

  for (const s of specs) {
    const measured = s.actual
      .map((r) => ({ x: index.get(String(field(r, s.labelKey)))!, y: asNum(field(r, s.valueKey)) }))
      .filter((p) => p.x != null);
    series.push({ name: s.name, points: measured, tone: s.tone });

    const fcKey = s.forecastValueKey ?? s.valueKey;
    const fcRows = (s.forecast ?? []).filter((r) => asNum(field(r, fcKey)) != null);
    if (!fcRows.length) {
      if (s.forecast) forecastEmpty = true;
      continue;
    }

    // The dashed line starts ON the last measured point, so measurement and prediction
    // meet instead of leaving a visual gap the eye reads as missing data.
    const lastMeasured = [...measured].reverse().find((p) => p.y != null);
    const points = [
      ...(lastMeasured ? [lastMeasured] : []),
      ...fcRows.map((r) => ({ x: index.get(String(field(r, s.labelKey)))!, y: asNum(field(r, fcKey)) })),
    ];

    const iv = s.interval ?? 80;
    const lowKey = iv === 95 ? 'lower95' : 'lower80';
    const highKey = iv === 95 ? 'upper95' : 'upper80';
    const band = iv
      ? [
        // Pin the band's left edge to the last measurement, so it opens from the known
        // value rather than appearing as a floating ribbon.
        ...(lastMeasured?.y != null ? [{ x: lastMeasured.x, lower: lastMeasured.y, upper: lastMeasured.y }] : []),
        ...fcRows
          .map((r) => ({
            x: index.get(String(field(r, s.labelKey)))!,
            lower: asNum(field(r, lowKey)) ?? asNum(field(r, fcKey)) ?? 0,
            upper: asNum(field(r, highKey)) ?? asNum(field(r, fcKey)) ?? 0,
          })),
      ]
      : undefined;

    series.push({ name: `${s.name} · ${forecastSuffix}`, points, tone: s.tone, dashed: true, band });
  }

  return {
    series,
    labels,
    forecastFromX: firstForecastLabel != null ? index.get(firstForecastLabel)! : null,
    forecastEmpty,
  };
}

/** The x-label accessor a LineChart wants, from a label array. */
export const labelAt = (labels: string[]) => (x: number) => labels[x] ?? '';

/** 'YYYY-MM-DD' → 'Mon 14', short enough for an axis tick. */
export function shortDay(label: string): string {
  const d = new Date(`${label}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return label;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** 'YYYY-MM' → 'Mar 26'. */
export function shortMonth(label: string): string {
  const d = new Date(`${label}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return label;
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${m} ${String(d.getUTCFullYear()).slice(2)}`;
}
