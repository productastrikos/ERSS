/**
 * Theme tokens for the map.
 *
 * deck.gl wants colour as `[r, g, b, a]` and MapLibre paint wants a colour string;
 * neither can read a CSS custom property. This module resolves `var(--app-*)` from the
 * live document at render time, so the map rethemes with the rest of the product and
 * theme.css stays the only file holding a colour literal (docs/05 §7.5).
 *
 * The cache is keyed by the document's `data-theme`, not by a store subscription:
 * the theme store notifies BEFORE the attribute flips, so a subscriber resolving
 * eagerly would read the outgoing theme.
 */

export type Rgba = [number, number, number, number];

/** Status tone → token. The same vocabulary as `Chip` and `Dot` in shared/ui. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const TONE_TOKEN: Record<Tone, string> = {
  neutral: '--app-text-faint',
  accent:  '--app-accent',
  success: '--app-success',
  warning: '--app-warning',
  danger:  '--app-danger',
  info:    '--app-info',
};

/** Magnitude surfaces — risk, demand, crowd, KDE. One hue, light → dark, never a rainbow. */
export const SEQUENTIAL = [
  '--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700',
] as const;

/** Agencies take a categorical series slot (agencies.series_slot, 1–8). */
export const seriesToken = (slot: number | null | undefined): string =>
  `--series-${Math.min(8, Math.max(1, slot ?? 1))}`;

const cache = new Map<string, Rgba>();
const warned = new Set<string>();

/** Transparent, and the visible failure mode for an unknown token. */
const clear = (): Rgba => new Array(4).fill(0) as Rgba;

function themeKey(): string {
  return typeof document === 'undefined'
    ? 'none'
    : document.documentElement.getAttribute('data-theme') ?? 'dark';
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Alpha → 0–255. */
export function parseColour(raw: string): Rgba | null {
  const v = raw.trim();

  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    const out: Rgba = [n(0), n(2), n(4), hex.length === 8 ? n(6) : 255];
    return out.some(Number.isNaN) ? null : out;
  }

  const fn = /^rgba?\((.+)\)$/i.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const alpha = parts[3] === undefined ? 1
      : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out: Rgba = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha * 255]
      .map((x) => Math.round(Math.min(255, Math.max(0, x)))) as Rgba;
    return out.some(Number.isNaN) ? null : out;
  }

  return null;
}

function resolve(token: string): Rgba {
  const key = `${themeKey()}|${token}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = typeof document === 'undefined'
    ? ''
    : getComputedStyle(document.documentElement).getPropertyValue(token);
  const parsed = raw ? parseColour(raw) : null;

  if (!parsed) {
    if (!warned.has(token)) {
      warned.add(token);
      console.warn(`[map/tokens] ${token} is not a colour token in theme.css — rendering transparent`);
    }
    return clear();
  }
  cache.set(key, parsed);
  return parsed;
}

/**
 * A token as a deck.gl colour. `alpha` (0–1) MULTIPLIES the token's own alpha, so a
 * token already carrying transparency (the *-bg and *-border family) stays proportional.
 */
export function rgba(token: string, alpha = 1): Rgba {
  const [r, g, b, a] = resolve(token);
  return [r, g, b, Math.min(255, Math.round(a * alpha))];
}

/** A token as a MapLibre paint colour string. */
export function css(token: string, alpha = 1): string {
  const [r, g, b, a] = rgba(token, alpha);
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

/** A tone as a deck.gl colour. */
export const toneRgba = (tone: Tone, alpha = 1): Rgba => rgba(TONE_TOKEN[tone], alpha);

/** A ramp of tokens, e.g. for HeatmapLayer `colorRange`. */
export function ramp(tokens: readonly string[], alpha = 1): Rgba[] {
  return tokens.map((t) => rgba(t, alpha));
}

/** Pick a step of a ramp for a value in [0, 1]. */
export function rampAt(tokens: readonly string[], t: number, alpha = 1): Rgba {
  const i = Math.min(tokens.length - 1, Math.max(0, Math.floor(t * tokens.length)));
  return rgba(tokens[i], alpha);
}

/** A non-colour token (font stacks for TextLayer). */
export function cssValue(token: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
