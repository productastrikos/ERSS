/**
 * Map glyphs — lucide-react, the product's one icon family, as deck.gl MASK icons.
 *
 * A mask icon is an alpha shape that deck.gl paints with `getColor`, so one image per
 * glyph serves every theme and every tone: colour comes from tokens at draw time, and
 * the atlas is never regenerated on a theme switch.
 *
 * Each glyph is rendered once into a detached React root and serialised to an SVG data
 * URL. That keeps the SVG paths owned by lucide rather than copied into this repo.
 */

import { createElement, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  Activity, Ambulance, Anchor, Banknote, BedDouble, Building, Building2, Bus, Car, Cctv,
  CarFront, Church, CircleDot, Coffee, Construction, Container, Crosshair, Droplet, Droplets, Dumbbell, EvCharger,
  Factory, FireExtinguisher, Flag, Flame, Footprints, Fuel, Gauge, GraduationCap, HeartPulse,
  Hospital, House, Lamp, Landmark, Leaf, MapPin, Pill, RadioTower, Recycle, Shield, ShoppingBag,
  ShoppingCart, Siren, SquareParking, Stethoscope, Toilet, TrafficCone, Trash2, TriangleAlert,
  Utensils, Warehouse, Waves, Wind, Wrench, Zap,
  type LucideProps,
} from 'lucide-react';

const GLYPHS = {
  // Agencies — agencies.glyph in the seed (server/config/jurisdiction.js)
  ambulance: Ambulance, shield: Shield, flame: Flame, anchor: Anchor,
  'traffic-cone': TrafficCone, 'trash-2': Trash2, zap: Zap, hospital: Hospital, landmark: Landmark,

  // Facilities and operations
  'heart-pulse': HeartPulse, siren: Siren, 'building-2': Building2, building: Building,
  house: House, 'map-pin': MapPin, 'triangle-alert': TriangleAlert, activity: Activity,
  crosshair: Crosshair, 'car-front': CarFront,

  // Detail geometry — POIs and street infrastructure
  utensils: Utensils, coffee: Coffee, pill: Pill, stethoscope: Stethoscope,
  'square-parking': SquareParking, fuel: Fuel, banknote: Banknote, 'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag, 'graduation-cap': GraduationCap, church: Church,
  'bed-double': BedDouble, dumbbell: Dumbbell, cctv: Cctv, lamp: Lamp, bus: Bus,
  footprints: Footprints, 'fire-extinguisher': FireExtinguisher, 'ev-charger': EvCharger,
  recycle: Recycle, droplet: Droplet, droplets: Droplets, toilet: Toilet, factory: Factory,
  'radio-tower': RadioTower, flag: Flag, gauge: Gauge, warehouse: Warehouse, car: Car,
  container: Container, construction: Construction, 'circle-dot': CircleDot,

  // Agency feeds
  waves: Waves, wind: Wind, wrench: Wrench, leaf: Leaf,
} satisfies Record<string, ComponentType<LucideProps>>;

export type GlyphName = keyof typeof GLYPHS;

export const isGlyph = (name: string | null | undefined): name is GlyphName =>
  !!name && Object.prototype.hasOwnProperty.call(GLYPHS, name);

/** Rendered size of the source image; deck scales it with `getSize`. */
export const GLYPH_PX = 48;

export interface MaskIcon {
  id: string;
  url: string;
  width: number;
  height: number;
  mask: true;
  anchorY?: number;
}

const cache = new Map<string, MaskIcon>();

/** A lucide glyph as a deck.gl mask icon. Unknown names fall back to a map pin. */
export function glyphIcon(name: string | null | undefined, strokeWidth = 2.25): MaskIcon {
  const glyph: GlyphName = isGlyph(name) ? name : 'map-pin';
  const id = `glyph:${glyph}:${strokeWidth}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const host = document.createElement('div');
  const root = createRoot(host);
  // currentColor resolves to the initial colour in an image context — the mask only
  // uses alpha, so no colour value is needed here at all.
  flushSync(() => root.render(createElement(GLYPHS[glyph], { size: GLYPH_PX, strokeWidth, color: 'currentColor' })));
  const svg = host.innerHTML;
  root.unmount();

  const icon: MaskIcon = {
    id,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: GLYPH_PX,
    height: GLYPH_PX,
    mask: true,
  };
  cache.set(id, icon);
  return icon;
}
