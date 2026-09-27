/**
 * Shared marker construction for layer modules.
 *
 * Every point marker is "a glyph in a body with a coloured ring". Building that once
 * keeps the map coherent and keeps colour arrays out of the layer modules — they pass
 * tokens.
 *
 * The body has a SHAPE, and the shape carries the category before colour or glyph does:
 *
 *   disc      a live or ambient point — a signal, a sensor, a bin, an ambulance at rest
 *   plate     fixed infrastructure that does not move — a station, a hospital, an AED
 *   hazard    an incident on the road — a warning triangle (hazardMarker, below)
 *
 * Two more categories are not markers at all, because they should never be mistaken for
 * one: a live emergency also stands up as a column of light (layers/liveResponse.ts), and
 * an ambulance on a job is a 3D vehicle turned to its heading (icons/vehicleMesh.ts). The
 * rule that makes the map readable is that you can tell WHAT something is from its
 * silhouette alone, before you have read a single glyph.
 */

import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { glyphIcon } from '../icons/glyphs';
import { hazardIcon, hazardRingIcon, plateFillIcon, plateIcon, ringIcon } from '../icons/shapes';
import { cssValue, rgba, type Rgba } from '../tokens';
import type { LayerContext } from '../layerRegistry';

type LngLat = [number, number];

export interface DiscMarkerOptions<T> {
  /** Descriptor-prefixed base id, e.g. `units:markers`. */
  id: string;
  data: T[];
  ctx: LayerContext;
  position: (d: T) => LngLat;
  glyph: (d: T) => string | null;
  /** Ring colour. */
  ring: (d: T) => Rgba;
  ringStyle?: (d: T) => 'solid' | 'dashed';
  /** Glyph colour; defaults to --app-text. */
  glyphColor?: (d: T) => Rgba;
  /** Body fill, fixed or per datum; defaults to --app-panel. */
  fill?: Rgba | ((d: T) => Rgba);
  /** Body radius in pixels (half-width for a plate). */
  radius?: number | ((d: T) => number);
  /** The silhouette. `disc` for live and ambient points, `plate` for fixed buildings. */
  shape?: 'disc' | 'plate';
  pickable?: boolean;
  visible?: boolean;
  /** Extra values that should rebuild colour attributes when they change. */
  triggers?: unknown[];
}

export function discMarker<T>(o: DiscMarkerOptions<T>): Layer[] {
  const radiusOf = typeof o.radius === 'function' ? o.radius : () => (o.radius as number | undefined) ?? 11;
  const fill = o.fill ?? rgba('--app-panel');
  const fillOf = typeof fill === 'function' ? fill : () => fill;
  const text = rgba('--app-text');
  const triggers = [o.ctx.theme, ...(o.triggers ?? [])];
  const visible = o.visible ?? true;

  const plate = o.shape === 'plate';

  return [
    // The body. A disc is a ScatterplotLayer; a plate is a filled mask, because a
    // rounded square is not something Scatterplot can draw.
    plate
      ? new IconLayer<T>({
        id: `${o.id}:disc`,
        data: o.data,
        visible,
        pickable: o.pickable ?? true,
        sizeUnits: 'pixels',
        getPosition: o.position,
        getIcon: () => plateFillIcon(),
        getSize: (d) => radiusOf(d) * 2,
        getColor: fillOf,
        updateTriggers: { getColor: triggers, getSize: triggers },
      })
      : new ScatterplotLayer<T>({
        id: `${o.id}:disc`,
        data: o.data,
        visible,
        pickable: o.pickable ?? true,
        radiusUnits: 'pixels',
        getPosition: o.position,
        getRadius: radiusOf,
        getFillColor: fillOf,
        stroked: false,
        updateTriggers: { getFillColor: triggers, getRadius: triggers },
      }),
    new IconLayer<T>({
      id: `${o.id}:ring`,
      data: o.data,
      visible,
      sizeUnits: 'pixels',
      getPosition: o.position,
      getIcon: (d) => (plate ? plateIcon(o.ringStyle?.(d) ?? 'solid') : ringIcon(o.ringStyle?.(d) ?? 'solid')),
      getSize: (d) => radiusOf(d) * 2 + 3,
      getColor: o.ring,
      updateTriggers: { getColor: triggers, getIcon: triggers, getSize: triggers },
    }),
    new IconLayer<T>({
      id: `${o.id}:glyph`,
      data: o.data,
      visible,
      sizeUnits: 'pixels',
      getPosition: o.position,
      getIcon: (d) => glyphIcon(o.glyph(d)),
      getSize: (d) => Math.round(radiusOf(d) * 1.15),
      getColor: o.glyphColor ?? (() => text),
      updateTriggers: { getColor: triggers, getIcon: triggers, getSize: triggers },
    }),
  ];
}

export interface HazardMarkerOptions<T> {
  /** Descriptor-prefixed base id, e.g. `incidents:markers`. */
  id: string;
  data: T[];
  ctx: LayerContext;
  position: (d: T) => LngLat;
  glyph: (d: T) => string | null;
  /** The triangle's body. */
  fill: (d: T) => Rgba;
  glyphColor: (d: T) => Rgba;
  /** An outline over the body — the P2 ring, or selection. `null` draws none. */
  ring?: (d: T) => Rgba | null;
  /** Height of the triangle in pixels. */
  size?: number | ((d: T) => number);
  pickable?: boolean;
  /** GPU parameters, e.g. to draw over the buildings. */
  parameters?: Record<string, unknown>;
  triggers?: unknown[];
}

/**
 * The incident mark: a road-warning triangle with the kind of incident as its glyph.
 *
 * Shared by the incidents layer and the live-response columns, so an incident is the SAME
 * symbol wherever it appears — a column of light standing on a triangle is still, first,
 * a triangle. The glyph sits on the triangle's visual centre (two-thirds of the way down),
 * not the middle of its bounding box, or it reads as floating off the top.
 */
export function hazardMarker<T>(o: HazardMarkerOptions<T>): Layer[] {
  const sizeOf = typeof o.size === 'function' ? o.size : () => (o.size as number | undefined) ?? 22;
  const triggers = [o.ctx.theme, ...(o.triggers ?? [])];
  const ringOf = o.ring;
  const ringed = ringOf ? o.data.filter((d) => ringOf(d) != null) : [];

  return [
    new IconLayer<T>({
      id: `${o.id}:body`,
      data: o.data,
      pickable: o.pickable ?? true,
      sizeUnits: 'pixels',
      getPosition: o.position,
      getIcon: () => hazardIcon(),
      getSize: sizeOf,
      getColor: o.fill,
      parameters: o.parameters,
      updateTriggers: { getColor: triggers, getSize: triggers },
    }),
    ...(ringOf && ringed.length ? [new IconLayer<T>({
      id: `${o.id}:ring`,
      data: ringed,
      sizeUnits: 'pixels',
      getPosition: o.position,
      getIcon: () => hazardRingIcon(),
      getSize: (d) => sizeOf(d) + 5,
      getColor: (d) => ringOf(d) ?? rgba('--app-text'),
      parameters: o.parameters,
      updateTriggers: { getColor: triggers, getSize: triggers },
    })] : []),
    new IconLayer<T>({
      id: `${o.id}:glyph`,
      data: o.data,
      sizeUnits: 'pixels',
      getPosition: o.position,
      getIcon: (d) => glyphIcon(o.glyph(d), 2.6),
      getSize: (d) => Math.round(sizeOf(d) * 0.46),
      getPixelOffset: (d) => [0, Math.round(sizeOf(d) * 0.11)],
      getColor: o.glyphColor,
      parameters: o.parameters,
      updateTriggers: { getColor: triggers, getIcon: triggers, getSize: triggers, getPixelOffset: triggers },
    }),
  ];
}

/** The glyph an incident kind wears inside its triangle. Road-only in this build, so
 *  nearly everything is a vehicle; the medical kinds keep their own mark. */
export function incidentGlyph(kind: string): string {
  if (kind === 'cardiac_arrest' || kind === 'cardiac') return 'heart-pulse';
  if (kind === 'rta' || kind === 'trauma_fall') return 'car-front';
  return 'activity';
}

export interface LabelOptions<T> {
  id: string;
  data: T[];
  ctx: LayerContext;
  position: (d: T) => LngLat;
  text: (d: T) => string;
  /** Pixel offset from the anchor; default sits just below a disc marker. */
  offset?: [number, number];
  size?: number;
  mono?: boolean;
  bold?: boolean;
  color?: Rgba;
  visible?: boolean;
  triggers?: unknown[];
}

/** A label on a panel-coloured plate — legible over any basemap, in either theme. */
export function label<T>(o: LabelOptions<T>): TextLayer<T> {
  const triggers = [o.ctx.theme, ...(o.triggers ?? [])];
  return new TextLayer<T>({
    id: `${o.id}:label`,
    data: o.data,
    visible: o.visible ?? true,
    getPosition: o.position,
    getText: o.text,
    getSize: o.size ?? 11,
    sizeUnits: 'pixels',
    getPixelOffset: o.offset ?? [0, 20],
    getColor: o.color ?? rgba('--app-text'),
    fontFamily: fontStack(o.mono ? '--font-mono' : '--font-body'),
    fontWeight: o.bold ? 700 : 400,
    characterSet: 'auto',
    background: true,
    getBackgroundColor: rgba('--app-panel', 0.92),
    backgroundBorderRadius: 4,
    backgroundPadding: [4, 2],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    updateTriggers: { getColor: triggers, getBackgroundColor: triggers, getText: o.triggers ?? [] },
  });
}

/** The first family of a font token, for the canvas-backed deck.gl font atlas. */
export function fontStack(token: '--font-body' | '--font-display' | '--font-mono'): string {
  return cssValue(token) || 'system-ui';
}

/**
 * Memoise a derivation on the identity of its input. Layer factories run every frame
 * while anything is animating; filtering 900 AEDs sixty times a second is avoidable.
 */
export function memoOn<K extends object, V>(derive: (input: K) => V): (input: K) => V {
  const cache = new WeakMap<K, V>();
  return (input) => {
    let v = cache.get(input);
    if (v === undefined) {
      v = derive(input);
      cache.set(input, v);
    }
    return v;
  };
}

/** The 2 s P1 pulse phase in [0, 1). */
export const pulsePhase = (ctx: LayerContext, periodMs = 2000) => (ctx.time % periodMs) / periodMs;
