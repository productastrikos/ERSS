/**
 * The universal chart filter, client side — ONE state object every visualisation reads.
 *
 * Client requirement: wherever there is a graph, trend, bar or chart, it carries as many
 * filters as possible and a prediction. That is only coherent if "as many filters as
 * possible" means the SAME filters everywhere, so this module owns the vocabulary and
 * every page binds to it rather than inventing its own controls:
 *
 *   - the shape is the server's shape (server/lib/filters.ts), key for key, so
 *     `toQuery()` is a rename-free mapping and a console URL can be pasted into curl;
 *   - it lives in ONE module-level store, so a filter set on Overview is still set when
 *     the operator walks to Performance — a filter that resets per page is a filter
 *     nobody trusts;
 *   - it round-trips through the URL, so a filtered chart is a shareable link and the
 *     back button undoes a filter;
 *   - the prediction controls (on/off, horizon, interval) live here too, because
 *     "predicted" is a property of the view, not of one card.
 *
 * Endpoint window knobs (`days`, `weeks`, `months`) are DERIVED from the window preset —
 * the almanac naturally thinks in weeks and the monthly chart in months, and they should
 * not each need their own control.
 */

import { createStore, useStore } from './stores/createStore';
import { routerStore } from './router';
import { FILTER_LIST_KEYS, FILTER_NUM_KEYS, FILTER_TRI_KEYS, FILTER_URL_KEYS } from './filterKeys';

export type Tri = 'any' | 'yes' | 'no';
export type WindowPreset = '1d' | '7d' | '14d' | '30d' | '90d' | '180d' | '365d' | '730d' | 'custom';
export type Interval = 0 | 80 | 95;

export interface ChartFilters {
  // ── Window ────────────────────────────────────────────────────────────────
  window: WindowPreset;
  /** Only meaningful when window === 'custom'. Dates, GST, inclusive of `from`. */
  from: string | null;
  to: string | null;

  // ── Categorical, multi-select ─────────────────────────────────────────────
  kind: string[];
  priority: string[];
  source: string[];
  outcome: string[];
  zone: string[];
  zoneClass: string[];
  unitKind: string[];
  agency: string[];
  station: string[];
  complaint: string[];
  escalation: string[];

  // ── Temporal slices inside the window ─────────────────────────────────────
  dow: number[];
  hourFrom: number | null;
  hourTo: number | null;

  // ── Numeric bands ─────────────────────────────────────────────────────────
  floorMin: number | null;
  floorMax: number | null;
  acuityMin: number | null;
  acuityMax: number | null;
  responseMinSec: number | null;
  responseMaxSec: number | null;

  // ── Tri-state flags: 'any' is NOT the same as 'no' ────────────────────────
  withinTarget: Tri;
  highrise: Tri;
  transported: Tri;
  multiAgency: Tri;
  seeded: Tri;
  includeResting: Tri;

  // ── Prediction — a property of the whole view ─────────────────────────────
  predict: boolean;
  /** Steps ahead, in the unit each chart's own series uses (days, months, hours). */
  horizon: number;
  /** Which prediction interval to shade. 0 hides the band and keeps the dashed line. */
  interval: Interval;
  /** Show the seasonal-naive comparison line where an endpoint provides one. */
  showNaive: boolean;
}

export const DEFAULT_FILTERS: ChartFilters = {
  window: '30d',
  from: null,
  to: null,
  kind: [], priority: [], source: [], outcome: [],
  zone: [], zoneClass: [], unitKind: [], agency: [], station: [],
  complaint: [], escalation: [],
  dow: [], hourFrom: null, hourTo: null,
  floorMin: null, floorMax: null, acuityMin: null, acuityMax: null,
  responseMinSec: null, responseMaxSec: null,
  withinTarget: 'any', highrise: 'any', transported: 'any', multiAgency: 'any',
  seeded: 'any', includeResting: 'any',
  predict: true, horizon: 7, interval: 80, showNaive: false,
};

export const WINDOW_PRESETS: Array<{ value: WindowPreset; label: string; days: number }> = [
  { value: '1d', label: '24h', days: 1 },
  { value: '7d', label: '7d', days: 7 },
  { value: '14d', label: '14d', days: 14 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
  { value: '180d', label: '6m', days: 180 },
  { value: '365d', label: '1y', days: 365 },
  { value: '730d', label: '2y', days: 730 },
];

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Named hour bands, so the common shift questions are one click rather than two sliders. */
export const HOUR_BANDS: Array<{ key: string; label: string; from: number; to: number }> = [
  { key: 'am_peak', label: 'AM peak 06–09', from: 6, to: 9 },
  { key: 'midday', label: 'Midday 10–16', from: 10, to: 16 },
  { key: 'pm_peak', label: 'PM peak 17–20', from: 17, to: 20 },
  { key: 'evening', label: 'Evening 21–22', from: 21, to: 22 },
  { key: 'night', label: 'Night 23–05', from: 23, to: 5 },
];

// ── The window, in whatever unit a chart thinks in ────────────────────────────

/** Day span of the current window, custom ranges included. */
export function windowDays(f: ChartFilters): number {
  if (f.window === 'custom') {
    const from = f.from ? Date.parse(`${f.from}T00:00:00Z`) : NaN;
    const to = f.to ? Date.parse(`${f.to}T00:00:00Z`) : Date.now();
    if (Number.isNaN(from)) return 30;
    return Math.max(1, Math.round((to - from) / 86_400_000));
  }
  return WINDOW_PRESETS.find((p) => p.value === f.window)?.days ?? 30;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The same window expressed in the unit an endpoint's own knob takes. */
export const windowWeeks = (f: ChartFilters) => clamp(windowDays(f) / 7, 1, 104);
export const windowMonths = (f: ChartFilters, min = 6, max = 60) => clamp(windowDays(f) / 30, min, max);

/** Horizon clamped to what a given unit's endpoint accepts. */
export const horizonDays = (f: ChartFilters) => (f.predict ? clamp(f.horizon, 0, 60) : 0);
export const horizonMonths = (f: ChartFilters) => (f.predict ? clamp(Math.max(1, f.horizon / 30), 0, 12) : 0);
export const horizonHours = (f: ChartFilters) => (f.predict ? clamp(f.horizon * 24, 0, 48) : 0);
export const horizonWeeks = (f: ChartFilters) => (f.predict ? clamp(Math.max(1, f.horizon / 7), 0, 8) : 0);

// ── To the wire ───────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | null | undefined>;

const tri = (v: Tri) => (v === 'any' ? undefined : v === 'yes');
const csv = (v: string[] | number[]) => (v.length ? v.join(',') : undefined);

/**
 * The universal filter as query parameters — the SAME key names the server parses, so
 * there is no translation table to drift.
 *
 * The window preset is deliberately NOT sent as from/to: each endpoint has its own
 * natural window knob (`days`/`weeks`/`months`) and sending both would double-constrain.
 * A custom range IS sent as from/to, which overrides the knob server-side.
 */
export function toQuery(f: ChartFilters): Query {
  const q: Query = {
    kind: csv(f.kind),
    priority: csv(f.priority),
    source: csv(f.source),
    outcome: csv(f.outcome),
    zone: csv(f.zone),
    zoneClass: csv(f.zoneClass),
    unitKind: csv(f.unitKind),
    agency: csv(f.agency),
    station: csv(f.station),
    complaint: csv(f.complaint),
    escalation: csv(f.escalation),
    dow: csv(f.dow),
    hourFrom: f.hourFrom ?? undefined,
    hourTo: f.hourTo ?? undefined,
    floorMin: f.floorMin ?? undefined,
    floorMax: f.floorMax ?? undefined,
    acuityMin: f.acuityMin ?? undefined,
    acuityMax: f.acuityMax ?? undefined,
    responseMinSec: f.responseMinSec ?? undefined,
    responseMaxSec: f.responseMaxSec ?? undefined,
    withinTarget: tri(f.withinTarget),
    highrise: tri(f.highrise),
    transported: tri(f.transported),
    multiAgency: tri(f.multiAgency),
    seeded: tri(f.seeded),
    includeResting: tri(f.includeResting),
  };
  if (f.window === 'custom') {
    // The server wants instants; the control offers GST dates. End-exclusive, so picking
    // the same day twice means that one whole day rather than nothing.
    if (f.from) q.from = `${f.from}T00:00:00+04:00`;
    if (f.to) q.to = `${nextDate(f.to)}T00:00:00+04:00`;
  }
  for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];
  return q;
}

/**
 * A cache key that changes exactly when a refetch is needed.
 *
 * `toQuery()` deliberately leaves out the window preset and the prediction controls —
 * they are view knobs each endpoint derives its own params from (`windowMonths`,
 * `horizonDays`, …), not WHERE-clause filters, so they don't belong on the wire. But a
 * refetch still has to happen when any of THEM changes too, or the range chips and the
 * Forecast controls look connected while quietly doing nothing.
 */
export function filterKey(f: ChartFilters, extra: Record<string, unknown> = {}): string {
  const q = toQuery(f);
  const parts = Object.keys(q).sort().map((k) => `${k}=${q[k]}`);
  parts.push(`window=${f.window}`, `predict=${f.predict}`, `horizon=${f.horizon}`, `interval=${f.interval}`, `naive=${f.showNaive}`);
  for (const k of Object.keys(extra).sort()) parts.push(`${k}=${String(extra[k])}`);
  return parts.join('&');
}

const nextDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

// ── How many filters are on, and what they say ───────────────────────────────

interface ActiveChip { key: keyof ChartFilters; label: string; value: string }

const LIST_LABELS: Partial<Record<keyof ChartFilters, string>> = {
  kind: 'Call type', priority: 'Priority', source: 'Origin', outcome: 'Outcome',
  zone: 'Zone', zoneClass: 'Zone class', unitKind: 'Unit type', agency: 'Agency',
  station: 'Station', complaint: 'Complaint', escalation: 'Escalation',
};

const TRI_LABELS: Partial<Record<keyof ChartFilters, [string, string]>> = {
  withinTarget: ['Target met', 'Target missed'],
  highrise: ['High-rise only', 'Ground / low-rise'],
  transported: ['Transported', 'Not transported'],
  multiAgency: ['Multi-agency', 'Single agency'],
  seeded: ['Seeded history', 'Live-recorded'],
  includeResting: ['Incl. demo resting state', 'Excl. demo resting state'],
};

/** One chip per active filter, for the bar's "what am I looking at" row. */
export function activeChips(f: ChartFilters, labelOf: (key: keyof ChartFilters, value: string) => string = (_, v) => v): ActiveChip[] {
  const out: ActiveChip[] = [];
  if (f.window === 'custom' && (f.from || f.to)) {
    out.push({ key: 'window', label: 'Window', value: `${f.from ?? '…'} → ${f.to ?? 'now'}` });
  }
  for (const key of Object.keys(LIST_LABELS) as Array<keyof ChartFilters>) {
    const v = f[key] as string[];
    if (v?.length) out.push({ key, label: LIST_LABELS[key]!, value: v.map((x) => labelOf(key, x)).join(', ') });
  }
  if (f.dow.length) out.push({ key: 'dow', label: 'Weekday', value: f.dow.map((d) => DOW_LABELS[d]).join(', ') });
  if (f.hourFrom != null || f.hourTo != null) {
    const a = String(f.hourFrom ?? 0).padStart(2, '0');
    const b = String(f.hourTo ?? 23).padStart(2, '0');
    out.push({ key: 'hourFrom', label: 'Hours', value: `${a}:00–${b}:59` });
  }
  const band = (min: number | null, max: number | null, key: keyof ChartFilters, label: string, unit = '') => {
    if (min == null && max == null) return;
    out.push({ key, label, value: `${min ?? '…'}–${max ?? '…'}${unit}` });
  };
  band(f.floorMin, f.floorMax, 'floorMin', 'Floor');
  band(f.acuityMin, f.acuityMax, 'acuityMin', 'Acuity');
  band(f.responseMinSec, f.responseMaxSec, 'responseMinSec', 'Response', 's');
  for (const key of Object.keys(TRI_LABELS) as Array<keyof ChartFilters>) {
    const v = f[key] as Tri;
    if (v !== 'any') out.push({ key, label: TRI_LABELS[key]![v === 'yes' ? 0 : 1], value: '' });
  }
  return out;
}

export const activeCount = (f: ChartFilters) => activeChips(f).length;

/** Clear one chip, by the key it reported. */
export function clearKey(key: keyof ChartFilters): Partial<ChartFilters> {
  if (key === 'window') return { window: DEFAULT_FILTERS.window, from: null, to: null };
  if (key === 'hourFrom') return { hourFrom: null, hourTo: null };
  if (key === 'floorMin') return { floorMin: null, floorMax: null };
  if (key === 'acuityMin') return { acuityMin: null, acuityMax: null };
  if (key === 'responseMinSec') return { responseMinSec: null, responseMaxSec: null };
  return { [key]: DEFAULT_FILTERS[key] } as Partial<ChartFilters>;
}

// ── The store, and its URL round trip ────────────────────────────────────────

const LIST_KEYS = FILTER_LIST_KEYS as unknown as Array<keyof ChartFilters>;
const NUM_KEYS = FILTER_NUM_KEYS as unknown as Array<keyof ChartFilters>;
const TRI_KEYS = FILTER_TRI_KEYS as unknown as Array<keyof ChartFilters>;

/**
 * Read the filter out of a query string. Unknown keys are ignored, so the page's own
 * parameters (`tab`, `incident`, `queue`) live in the same query string untouched.
 */
export function fromSearch(search: string): ChartFilters {
  const sp = new URLSearchParams(search);
  const f: ChartFilters = { ...DEFAULT_FILTERS };
  const w = sp.get('window');
  if (w && (WINDOW_PRESETS.some((p) => p.value === w) || w === 'custom')) f.window = w as WindowPreset;
  if (sp.get('from')) { f.from = sp.get('from')!.slice(0, 10); f.window = 'custom'; }
  if (sp.get('to')) { f.to = sp.get('to')!.slice(0, 10); f.window = 'custom'; }
  for (const k of LIST_KEYS) {
    const v = sp.get(k as string);
    if (v) (f[k] as string[]) = v.split(',').filter(Boolean);
  }
  const dow = sp.get('dow');
  if (dow) f.dow = dow.split(',').map(Number).filter((n) => n >= 0 && n <= 6);
  for (const k of NUM_KEYS) {
    const v = sp.get(k as string);
    if (v != null && v !== '' && Number.isFinite(Number(v))) (f[k] as number) = Number(v);
  }
  for (const k of TRI_KEYS) {
    const v = sp.get(k as string);
    if (v === 'true' || v === 'yes') (f[k] as Tri) = 'yes';
    else if (v === 'false' || v === 'no') (f[k] as Tri) = 'no';
  }
  if (sp.get('predict') != null) f.predict = sp.get('predict') !== 'false';
  const h = Number(sp.get('horizon'));
  if (Number.isFinite(h) && h > 0) f.horizon = clamp(h, 1, 60);
  // Presence has to be checked BEFORE parsing: `Number(null)` is 0, which is a VALID
  // interval value meaning "no band", so reading it unguarded turned every default URL
  // into a band-less one and quietly removed the uncertainty from every forecast.
  if (sp.has('interval')) {
    const iv = Number(sp.get('interval'));
    if (iv === 0 || iv === 80 || iv === 95) f.interval = iv;
  }
  if (sp.get('naive') != null) f.showNaive = sp.get('naive') !== 'false';
  return f;
}

/** The inverse: only non-default values are written, so a clean URL stays clean. */
export function toSearchParams(f: ChartFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.window !== DEFAULT_FILTERS.window) sp.set('window', f.window);
  if (f.window === 'custom') {
    if (f.from) sp.set('from', f.from);
    if (f.to) sp.set('to', f.to);
  }
  for (const k of LIST_KEYS) {
    const v = f[k] as string[];
    if (v.length) sp.set(k as string, v.join(','));
  }
  if (f.dow.length) sp.set('dow', f.dow.join(','));
  for (const k of NUM_KEYS) {
    const v = f[k] as number | null;
    if (v != null) sp.set(k as string, String(v));
  }
  for (const k of TRI_KEYS) {
    const v = f[k] as Tri;
    if (v !== 'any') sp.set(k as string, v === 'yes' ? 'true' : 'false');
  }
  if (!f.predict) sp.set('predict', 'false');
  if (f.horizon !== DEFAULT_FILTERS.horizon) sp.set('horizon', String(f.horizon));
  if (f.interval !== DEFAULT_FILTERS.interval) sp.set('interval', String(f.interval));
  if (f.showNaive) sp.set('naive', 'true');
  return sp;
}

export const filtersStore = createStore<ChartFilters>(fromSearch(window.location.search));

/** Subscribe to the whole filter, or a slice of it. */
export function useFilters(): ChartFilters {
  return useStore(filtersStore);
}

let writing = false;

/**
 * Change the filter and push it into the URL.
 *
 * `replace` for a drag (an hour slider) so the back button is not filled with every
 * intermediate value; a push for a discrete choice, so back undoes exactly one decision.
 */
export function setFilters(patch: Partial<ChartFilters>, { replace = false } = {}): void {
  filtersStore.update((cur) => {
    const next = { ...cur, ...patch };
    // Choosing a preset abandons a custom range, and vice versa — holding both would
    // leave the bar showing one window and the server applying the other.
    if (patch.window && patch.window !== 'custom') { next.from = null; next.to = null; }
    if ((patch.from !== undefined || patch.to !== undefined) && (next.from || next.to)) next.window = 'custom';
    syncUrl(next, replace);
    return next;
  });
}

export function resetFilters(): void {
  setFilters({ ...DEFAULT_FILTERS });
}

function syncUrl(f: ChartFilters, replace: boolean) {
  const sp = new URLSearchParams(window.location.search);
  for (const k of FILTER_URL_KEYS) sp.delete(k);
  for (const [k, v] of toSearchParams(f)) sp.set(k, v);
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  writing = true;
  try {
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    routerStore.set({ path: window.location.pathname, search: window.location.search, key: Date.now() });
  } finally {
    writing = false;
  }
}

// Back/forward must move the filter too, or the URL and the charts disagree.
window.addEventListener('popstate', () => {
  if (writing) return;
  filtersStore.set(fromSearch(window.location.search));
});
