/**
 * The layer registry — every layer on every map is a descriptor declared here.
 *
 * A layer module exports a DESCRIPTOR, not side effects (docs/02 §5). It never touches
 * the map instance: it turns its data plus a render context into MapLibre source/layer
 * specifications and/or deck.gl layers, and MapCanvas does the rest. Visibility, order,
 * status and legend metadata live here, so the layer control and the legend are
 * generated from the registry rather than hand-maintained.
 *
 * NAMING CONTRACT — every id a descriptor produces (MapLibre sources, MapLibre layers,
 * deck.gl layers) starts with `${descriptor.id}:`. That prefix is how a click on the
 * canvas is routed back to the descriptor that drew it.
 */

import type { ComponentType } from 'react';
import type { Layer as DeckLayer } from '@deck.gl/core';
import type { LayerSpecification, MapGeoJSONFeature, SourceSpecification } from 'maplibre-gl';
import { createStore, useStore, type Store } from '../../lib/stores/createStore';
import type { Theme } from '../../lib/stores/theme';

// ── Descriptor ───────────────────────────────────────────────────────────────

/** The four groups of the layer control (docs/06 §2.2). Order here is display order. */
export type LayerGroup = 'operational' | 'analytical' | 'agency' | 'reference';

export const LAYER_GROUPS: ReadonlyArray<{ key: LayerGroup; label: string }> = [
  { key: 'operational', label: 'map.group.operational' },
  { key: 'analytical',  label: 'map.group.analytical' },
  { key: 'agency',      label: 'map.group.agency' },
  { key: 'reference',   label: 'map.group.reference' },
];

export interface LayerContext {
  theme: Theme;
  /** Rounded to a quarter step, so continuous zooming does not rebuild every layer. */
  zoom: number;
  /** Milliseconds on the animation clock. Advances only while an animated layer is visible. */
  time: number;
  /** performance.now() for this frame — the instant moving things are sampled at, shared
   *  with the follow camera so a vehicle and the camera riding with it never disagree. */
  now: number;
  reducedMotion: boolean;
  selection: MapSelection | null;
  /** What the camera is following, if anything — a followed object is drawn as the subject. */
  follow: MapViewState['follow'];
  /** Read another layer's data in the same view — e.g. BMS status over detail buildings. */
  dataOf<T>(layerId: string): T | undefined;
}

/** A legend swatch references TOKENS, never colours; the legend renders `var(token)`. */
export type LegendSwatch =
  | { kind: 'dot' | 'ring' | 'fill' | 'line' | 'dashed' | 'diamond' | 'chevron' | 'hazard' | 'hazard-ring' | 'disc-glyph'; token: string }
  | { kind: 'ramp'; tokens: readonly string[] };

export interface LegendEntry {
  /** i18n key — or display text taken from data when `raw` is set (an agency's name, say). */
  label: string;
  raw?: boolean;
  swatch: LegendSwatch;
  /** Identifies this row for `filterFor` and for remembering the isolate selection across
   *  a data refresh. Defaults to `label` (the untranslated key, stable even when `raw`
   *  the display text isn't — an agency code, say, not its name). */
  key?: string;
}

export interface MapSelection<T = unknown> {
  layerId: string;
  /** What was picked — 'incident', 'unit', 'zone', 'signal' … — for the page to act on. */
  kind: string;
  id: string;
  lngLat: [number, number];
  data: T;
}

export interface PopupProps<T = unknown> {
  selection: MapSelection<T>;
  view: MapView;
  onClose: () => void;
}

/** A hit on the canvas, before it is turned into a selection. */
export type PickHit =
  | { source: 'deck'; layerId: string; object: unknown; index: number; lngLat: [number, number] }
  | { source: 'maplibre'; layerId: string; feature: MapGeoJSONFeature; lngLat: [number, number] };

export interface MaplibreSpec<D> {
  /** GeoJSON (or other) sources, keyed by id. Recomputed only when the data changes. */
  sources(data: D, ctx: LayerContext): Record<string, SourceSpecification>;
  /** Style layers. Recomputed on theme/zoom/selection change; paint is diffed, not re-added. */
  layers(ctx: LayerContext): LayerSpecification[];
  /** Per-frame paint updates for animated layers (flow dashes, blinking bursts). */
  animate?(ctx: LayerContext): Array<{ layer: string; property: string; value: unknown }>;
  /** Layer ids whose features answer a click. */
  interactive?: string[];
}

export type LayerSource<D> =
  /** Self-loading reference data over REST — fetched the first time the layer is shown. */
  | { kind: 'rest'; load: (signal: AbortSignal) => Promise<D> }
  /** Fed by a page or an agency feed through `setLayerData`. Until then: awaiting feed. */
  | { kind: 'feed' };

export interface LayerDescriptor<D = unknown> {
  id: string;
  group: LayerGroup;
  /** i18n key. */
  label: string;
  /** Paint order: higher draws above lower. MapLibre-native layers always sit beneath deck.gl layers. */
  order: number;
  defaultVisible: boolean;
  source: LayerSource<D>;
  /** Static, or derived from the layer's data (the agencies actually on the map). */
  legend?: LegendEntry[] | ((data: D) => LegendEntry[]);
  /** Fed by synthesised data — the layer control carries the "simulated source" chip. */
  simulated?: boolean;
  /** Layers this one reads through `ctx.dataOf`; their data changes re-run `sources`. */
  dependsOn?: string[];

  maplibre?: MaplibreSpec<D>;
  deck?(data: D, ctx: LayerContext): DeckLayer[];
  /** Drives the animation clock while visible — or only when the data needs it (a P1 is
   *  present). Ignored under prefers-reduced-motion. */
  animated?: boolean | ((data: D) => boolean);

  /** Turn a hit into a selection; null means "not interactive here". */
  pick?(hit: PickHit, data: D): MapSelection | null;
  /** Rendered for a selection this descriptor produced. Omit when the page owns the detail. */
  popup?: ComponentType<PopupProps>;
  /** Where an object is now — what makes follow possible for moving things. */
  locate?(data: D, id: string): [number, number] | null;
  /** Which way it is facing, for a chase camera. Degrees clockwise from north. */
  bearingOf?(data: D, id: string): number | null;
  /**
   * Where a moving object is at this INSTANT, for a camera that follows it frame by frame
   * (followCamera.ts). A descriptor that implements this gets a smooth ride; one that only
   * implements `locate` gets the camera eased to each new fix instead.
   */
  locateNow?(data: D, id: string, now: number): { at: [number, number]; heading: number | null } | null;
  /**
   * Narrow the layer's data to one legend row's category — `key` is that row's
   * `LegendEntry.key`. Powers "isolate" (docs below): when a legend row is selected,
   * every other layer is hidden and this layer draws only the matching subset. A
   * descriptor without this still isolates — it just draws everything it normally would.
   */
  filterFor?(data: D, key: string): D;
}

/**
 * Declare a descriptor. Erases the data type at the registry boundary — the registry
 * holds heterogeneous layers, and each descriptor only ever receives data that was set
 * against its own id.
 */
export function defineLayer<D>(descriptor: LayerDescriptor<D>): LayerDescriptor {
  return descriptor as unknown as LayerDescriptor;
}

// ── View — one map instance's state ──────────────────────────────────────────

export type LayerStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'awaiting-feed';

export interface MapViewState {
  visible: Record<string, boolean>;
  data: Record<string, unknown>;
  status: Record<string, LayerStatus>;
  errors: Record<string, string>;
  selection: MapSelection | null;
  /**
   * The camera tracks this object while set; dragging the map releases it.
   *
   * `chase` turns tracking into a chase camera: the view tilts in behind the object and
   * swings to face its direction of travel, so following an ambulance looks like riding
   * with it rather than watching a dot slide under a fixed compass.
   */
  follow: { layerId: string; id: string; chase?: boolean } | null;
  /**
   * Picked from a legend row: while set, every OTHER layer is hidden and this one draws
   * only the matching category (via its `filterFor`, if it declares one) — the answer to
   * "too many things on the map at once". `label` is the translated text, kept only so a
   * "Showing: …" chip needs no lookup back through the registry.
   */
  isolate: { layerId: string; key: string; label: string } | null;
}

export interface MapView {
  /** Persists visibility per surface: the Operations map and the Analytics map differ. */
  key: string;
  layers: LayerDescriptor[];
  store: Store<MapViewState>;
}

const storageKey = (key: string) => `erss.map.${key}.visible`;

function readVisible(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeVisible(key: string, visible: Record<string, boolean>): void {
  try { localStorage.setItem(storageKey(key), JSON.stringify(visible)); } catch { /* a preference, not state */ }
}

export function createMapView(
  key: string,
  layers: LayerDescriptor[],
  overrides: { visible?: Record<string, boolean>; persist?: boolean } = {},
): MapView {
  if (import.meta.env.DEV) assertUniqueIds(layers);

  const remembered = overrides.persist === false ? {} : readVisible(key);
  const visible: Record<string, boolean> = {};
  const status: Record<string, LayerStatus> = {};
  for (const l of layers) {
    visible[l.id] = overrides.visible?.[l.id] ?? remembered[l.id] ?? l.defaultVisible;
    status[l.id] = l.source.kind === 'feed' ? 'awaiting-feed' : 'idle';
  }

  const store = createStore<MapViewState>({ visible, data: {}, status, errors: {}, selection: null, follow: null, isolate: null });
  if (overrides.persist !== false) {
    store.subscribe(() => writeVisible(key, store.get().visible));
  }
  return { key, layers: [...layers].sort((a, b) => a.order - b.order), store };
}

export function setVisible(view: MapView, layerId: string, on: boolean): void {
  view.store.update((s) => ({ visible: { ...s.visible, [layerId]: on } }));
}

/** Feed a layer. `null` returns it to "awaiting feed"; an empty array is a real, empty feed. */
export function setLayerData<D>(view: MapView, layerId: string, data: D | null): void {
  view.store.update((s) => {
    const nextData = { ...s.data };
    if (data === null) delete nextData[layerId];
    else nextData[layerId] = data;
    return {
      data: nextData,
      status: { ...s.status, [layerId]: data === null ? 'awaiting-feed' : isEmpty(data) ? 'empty' : 'ready' },
    };
  });
}

export function setLayerStatus(view: MapView, layerId: string, status: LayerStatus, error?: string): void {
  view.store.update((s) => ({
    status: { ...s.status, [layerId]: status },
    errors: error ? { ...s.errors, [layerId]: error } : s.errors,
  }));
}

export function select(view: MapView, selection: MapSelection | null): void {
  view.store.set({ selection });
}

export function setFollow(view: MapView, target: MapViewState['follow']): void {
  view.store.set({ follow: target });
}

/** Isolate one legend row, or pass `null` to show everything again. */
export function setIsolate(view: MapView, target: { layerId: string; key: string; label: string } | null): void {
  view.store.set({ isolate: target });
}

/** Whether a layer draws at all right now — its own toggle, gated by any isolate. */
export function isLayerActive(state: MapViewState, layerId: string): boolean {
  if (state.isolate && state.isolate.layerId !== layerId) return false;
  return !!state.visible[layerId];
}

/** A layer's data, narrowed to the isolated category when one applies to it. */
export function dataForLayer<D>(state: MapViewState, layer: LayerDescriptor<D>): D | undefined {
  const raw = state.data[layer.id] as D | undefined;
  if (raw === undefined) return raw;
  if (state.isolate?.layerId === layer.id && layer.filterFor) return layer.filterFor(raw, state.isolate.key);
  return raw;
}

export const useMapView = (view: MapView) => useStore(view.store);

/** The descriptor that owns an id produced under the naming contract. */
export function ownerOf(view: MapView, id: string): LayerDescriptor | undefined {
  const prefix = id.split(':')[0];
  return view.layers.find((l) => l.id === prefix);
}

/**
 * True when a layer's data has nothing to draw: an empty array, an empty
 * FeatureCollection, or an object whose collections are ALL empty (seven empty detail
 * layers, a routes payload with no routes). Scalars alongside them — a target minute,
 * a method name — do not count as content.
 */
export function isEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  if (!data || typeof data !== 'object') return false;
  if ('features' in data) return ((data as { features?: unknown[] }).features?.length ?? 0) === 0;
  const nested = Object.values(data).filter((v) => v !== null && typeof v === 'object');
  return nested.length > 0 && nested.every(isEmpty);
}

function assertUniqueIds(layers: LayerDescriptor[]): void {
  const seen = new Set<string>();
  for (const l of layers) {
    if (l.id.includes(':')) throw new Error(`[map] layer id "${l.id}" must not contain ':'`);
    if (seen.has(l.id)) throw new Error(`[map] duplicate layer id "${l.id}"`);
    seen.add(l.id);
  }
}
