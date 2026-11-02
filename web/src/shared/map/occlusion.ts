/**
 * How much of the map is hidden behind panels laid over it.
 *
 * The AI response drawer slides over the right third of the live map. The camera did not
 * know: it centred the incident, framed the ambulances and rode with the crew on the WHOLE
 * canvas — so the ambulance being followed sat at the drawer's edge, half under it, and the
 * road it was about to take ran beneath the panel. Every camera move now pads by what is
 * covered, so what the camera is showing sits in the part of the map a person can see.
 *
 * A panel opts in with `data-map-occluder="right" | "left" | "top" | "bottom"` — the side of
 * the map it covers. Nothing here knows which panels exist.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

export interface Insets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Pixels of the map covered on each side, right now. */
export function occlusion(map: MapLibreMap | null | undefined): Insets {
  if (!map || typeof document === 'undefined') return NO_INSETS;
  const box = map.getContainer().getBoundingClientRect();
  if (!box.width || !box.height) return NO_INSETS;
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  document.querySelectorAll<HTMLElement>('[data-map-occluder]').forEach((el) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, box.right) - Math.max(r.left, box.left);
    const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
    if (w <= 0 || h <= 0) return;
    switch (el.dataset.mapOccluder) {
      case 'right': out.right = Math.max(out.right, box.right - Math.max(r.left, box.left)); break;
      case 'left': out.left = Math.max(out.left, Math.min(r.right, box.right) - box.left); break;
      case 'top': out.top = Math.max(out.top, Math.min(r.bottom, box.bottom) - box.top); break;
      case 'bottom': out.bottom = Math.max(out.bottom, box.bottom - Math.max(r.top, box.top)); break;
      default: break;
    }
  });
  // A panel covering nearly all of a narrow map (the drawer on a phone-width console) leaves
  // nothing to centre in: ignore it rather than squeeze the view to a sliver.
  if (out.left + out.right > box.width * 0.7) { out.left = 0; out.right = 0; }
  if (out.top + out.bottom > box.height * 0.7) { out.top = 0; out.bottom = 0; }
  return out;
}

/** `base` pixels of breathing room on every side, plus whatever is covered. */
export const padded = (ins: Insets, base: number): Insets => ({
  top: base + ins.top, right: base + ins.right, bottom: base + ins.bottom, left: base + ins.left,
});
