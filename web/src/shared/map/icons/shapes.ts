/**
 * Geometric marker parts drawn on canvas — rings, heading arrows, chevrons, diamonds —
 * as deck.gl MASK icons. Alpha only: colour is applied from tokens by `getColor`.
 *
 * deck.gl's ScatterplotLayer cannot dash a stroke, and the design system encodes unit
 * status by ring STYLE (solid available, dashed relocating — docs/05 §7.5), so the
 * ring is a shape here rather than a stroke there.
 */

import type { MaskIcon } from './glyphs';

const S = 64;   // source resolution; icons are scaled down by getSize
const cache = new Map<string, MaskIcon>();

function draw(id: string, paint: (ctx: CanvasRenderingContext2D) => void, anchorY?: number): MaskIcon {
  const hit = cache.get(id);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);   // the default fill and stroke are opaque — alpha is all a mask reads
  const icon: MaskIcon = { id, url: canvas.toDataURL(), width: S, height: S, mask: true, anchorY };
  cache.set(id, icon);
  return icon;
}

/** A ring hugging the edge of the icon box. */
export function ringIcon(style: 'solid' | 'dashed', weight = 5): MaskIcon {
  return draw(`shape:ring:${style}:${weight}`, (ctx) => {
    ctx.lineWidth = weight;
    if (style === 'dashed') ctx.setLineDash([9, 6]);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - weight / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/**
 * A heading arrow sitting OUTSIDE a centred disc, pointing up. Rotate it with
 * `getAngle: -heading` and it orbits the marker to show direction of travel.
 */
export function headingIcon(): MaskIcon {
  return draw('shape:heading', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(S / 2, 1);
    ctx.lineTo(S / 2 + 8, 12);
    ctx.lineTo(S / 2 - 8, 12);
    ctx.closePath();
    ctx.fill();
  });
}

/** A chevron pointing DOWN at its anchor — the Makani entrance marker. */
export function chevronIcon(): MaskIcon {
  return draw('shape:chevron', (ctx) => {
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, 14);
    ctx.lineTo(S / 2, S - 10);
    ctx.lineTo(S - 10, 14);
    ctx.stroke();
  }, S - 6);
}

/** A shafted arrow pointing UP (north) — rotate with `getAngle: -bearing`. Wind vectors. */
export function arrowIcon(): MaskIcon {
  return draw('shape:arrow', (ctx) => {
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(S / 2, S - 6);
    ctx.lineTo(S / 2, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(S / 2, 4);
    ctx.lineTo(S / 2 + 11, 22);
    ctx.lineTo(S / 2 - 11, 22);
    ctx.closePath();
    ctx.fill();
  });
}

export function diamondIcon(): MaskIcon {
  return draw('shape:diamond', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(S / 2, 4);
    ctx.lineTo(S - 4, S / 2);
    ctx.lineTo(S / 2, S - 4);
    ctx.lineTo(4, S / 2);
    ctx.closePath();
    ctx.fill();
  });
}

/** A map pin: a disc on a stem, anchored at the tip. For point assets like waste bins. */
export function pinIcon(): MaskIcon {
  return draw('shape:pin', (ctx) => {
    ctx.beginPath();
    ctx.arc(S / 2, 24, 20, Math.PI * 0.8, Math.PI * 0.2);   // over the top, clockwise
    ctx.lineTo(S / 2, S - 2);
    ctx.closePath();
    ctx.fill();
  }, S - 2);
}

/**
 * A rounded SQUARE ring — the fixed-infrastructure marker.
 *
 * The map's legibility rule is that SHAPE carries the category before colour or glyph
 * does: round marks are live or ambient points, square marks are buildings that do not
 * move (stations, hospitals, defibrillator cabinets), a solid vehicle is an ambulance
 * driving, and a column of light is an emergency. Forty circles differing only by a 9-px
 * glyph is not a system, which is what this replaces.
 */
export function plateIcon(style: 'solid' | 'dashed', weight = 5): MaskIcon {
  return draw(`shape:plate:${style}:${weight}`, (ctx) => {
    ctx.lineWidth = weight;
    ctx.lineJoin = 'round';
    if (style === 'dashed') ctx.setLineDash([9, 6]);
    const inset = weight / 2 + 2;
    ctx.beginPath();
    ctx.roundRect(inset, inset, S - inset * 2, S - inset * 2, 13);
    ctx.stroke();
  });
}

/** The filled body a `plateIcon` rings. */
export function plateFillIcon(): MaskIcon {
  return draw('shape:plate-fill', (ctx) => {
    ctx.beginPath();
    ctx.roundRect(3, 3, S - 6, S - 6, 13);
    ctx.fill();
  });
}

/**
 * A small triangular beacon pointing DOWN at its anchor — the camera mark.
 *
 * A camera already has a unique silhouette on the map: its field-of-view cone. Giving it
 * a full disc as well made it compete with the ambulances and the stations for the same
 * attention, so the mark itself is reduced to a wedge that sits at the apex of the cone
 * and reads as "the eye is here".
 */
export function beaconIcon(): MaskIcon {
  return draw('shape:beacon', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(S / 2, S - 4);
    ctx.lineTo(S / 2 + 13, S - 26);
    ctx.lineTo(S / 2 - 13, S - 26);
    ctx.closePath();
    ctx.fill();
  }, S - 4);
}

/**
 * A rounded road-warning TRIANGLE — the incident mark.
 *
 * The one silhouette on this map that means "something has happened on the road". Every
 * other category already owns a shape — a round disc is an ambulance, a square plate is a
 * fixed building, a wedge is a camera, a solid vehicle is an ambulance driving — and the
 * incident was the only thing left drawn as a plain dot, which put a P3 collision and a
 * parked ambulance into the same visual class at emirate zoom. A warning triangle is the
 * symbol every driver in the room already reads as "hazard ahead", before any colour or
 * label is legible.
 *
 * `hazardIcon` is the filled body; `hazardRingIcon` the outline that sits over it for the
 * P2 ring and for selection. Both are drawn about their own visual centre, which on a
 * triangle is well below the middle of the box — callers nudge the glyph down to match.
 */
export function hazardIcon(): MaskIcon {
  return draw('shape:hazard', (ctx) => {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(S / 2, 8);
    ctx.lineTo(S - 7, S - 9);
    ctx.lineTo(7, S - 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();   // the stroke rounds the three corners
  });
}

export function hazardRingIcon(weight = 5): MaskIcon {
  return draw(`shape:hazard-ring:${weight}`, (ctx) => {
    ctx.lineJoin = 'round';
    ctx.lineWidth = weight;
    const inset = weight / 2 + 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, inset + 1);
    ctx.lineTo(S - inset, S - inset - 1);
    ctx.lineTo(inset, S - inset - 1);
    ctx.closePath();
    ctx.stroke();
  });
}
