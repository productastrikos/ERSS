/**
 * What a chart does when you click it, and the labels the filter bar prints.
 *
 * Separate from FilterBar.tsx for two reasons. The mechanical one is Fast Refresh: a file
 * that exports both components and helpers loses hot reloading. The real one is that these
 * are the operations a CHART performs — clicking a bar, clicking a heat cell, clicking an
 * hour — and pages import them without importing the bar at all.
 *
 * Each takes the current filter as an argument rather than reading the store, because a
 * click handler cannot call a hook. Choosing a value from the bar and clicking it on a
 * chart end up in exactly the same place.
 */

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import type { FilterOptions } from '../../lib/types';
import { SOURCE_LABEL, UNIT_KIND_LABEL } from '../../lib/format';
import { type ChartFilters, setFilters } from '../../lib/filters';

// ── The option lists ─────────────────────────────────────────────────────────

/** Loaded once per session: a whole-year aggregate that rarely moves. */
let optionsCache: FilterOptions | null = null;
let optionsInFlight: Promise<FilterOptions> | null = null;

export function useFilterOptions(): FilterOptions | null {
  const [opts, setOpts] = useState<FilterOptions | null>(optionsCache);
  useEffect(() => {
    if (optionsCache) return;
    let cancelled = false;
    optionsInFlight ??= api.insights.filterOptions();
    optionsInFlight
      .then((o) => { optionsCache = o; if (!cancelled) setOpts(o); })
      .catch(() => { optionsInFlight = null; });
    return () => { cancelled = true; };
  }, []);
  return opts;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const kindLabel = (k: string) => { const s = t(`kind.${k}`); return s === `kind.${k}` ? k.replace(/_/g, ' ') : s; };
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Human label for any filter value, shared by the bar and the active chips. */
export function labelFor(key: keyof ChartFilters, value: string, opts: FilterOptions | null): string {
  switch (key) {
    case 'kind': return kindLabel(value);
    case 'source': return SOURCE_LABEL[value] ?? titleCase(value);
    case 'unitKind': return UNIT_KIND_LABEL[value] ?? value;
    case 'zone': return opts?.zones.find((z) => z.value === value)?.label ?? value;
    case 'station': return opts?.stations.find((s) => s.value === value)?.label ?? value;
    case 'agency': return opts?.agencies.find((a) => a.value === value)?.label ?? value;
    case 'outcome': return titleCase(value);
    case 'zoneClass': return titleCase(value);
    default: return value;
  }
}

// ── Chart-driven filtering ───────────────────────────────────────────────────

/** Toggle one value of a list dimension — what a bar click means. */
export function toggleValue(f: ChartFilters, key: keyof ChartFilters, value: string): void {
  const cur = (f[key] as string[]) ?? [];
  setFilters({ [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } as Partial<ChartFilters>);
}

/** Filter to one weekday and hour — what an almanac cell click means. Clicking the same
 *  cell again clears it, so the grid is a toggle rather than a one-way trap. */
export function pickCell(f: ChartFilters, dow: number, hour: number): void {
  const already = f.dow.length === 1 && f.dow[0] === dow && f.hourFrom === hour && f.hourTo === hour;
  setFilters(already ? { dow: [], hourFrom: null, hourTo: null } : { dow: [dow], hourFrom: hour, hourTo: hour });
}

/** Filter to one hour of the day — what a click on an hourly chart means. */
export function pickHour(f: ChartFilters, hour: number): void {
  const already = f.hourFrom === hour && f.hourTo === hour;
  setFilters(already ? { hourFrom: null, hourTo: null } : { hourFrom: hour, hourTo: hour });
}
