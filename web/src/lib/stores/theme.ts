/**
 * Theme and display density.
 *
 * Each SURFACE keeps its own theme: the console (`erss.theme`) and the mobile app
 * (`erss.theme.app`). They share an origin, so one key made them fight — switching the phone
 * app to dark on a laptop turned the command console dark on its next load, and back.
 *
 *   console   dark by default — DCAS asked for the sign-in screen and the console to open
 *             dark. Light is one click away on both (the sign-in screen has its own toggle),
 *             and the choice made on either is the one the other opens with.
 *   app       follows the PHONE by default ('system'), the way a phone app should, and keeps
 *             following it live (a phone that switches to dark at sunset takes the app with
 *             it). Choosing Light or Dark on the app pins it.
 *
 * Density 'wall' is the video-wall mode — a display density, not a separate app.
 *
 * index.html applies the same choice before first paint, so nothing flashes; keep the two in
 * step.
 */

import { createStore, useStore } from './createStore';

export type Theme = 'dark' | 'light';
/** What a person chose: a theme, or "whatever the device is using". */
export type ThemePref = Theme | 'system';
export type Density = 'normal' | 'wall';

const MOBILE = typeof location !== 'undefined' && location.pathname.startsWith('/app');
const THEME_KEY = MOBILE ? 'erss.theme.app' : 'erss.theme';
const DENSITY_KEY = 'erss.density';

/** localStorage can throw (private window, blocked site data) — never let it break a
 *  boot. A remembered preference is a convenience, not state we depend on. */
function read<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback; } catch { return fallback; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* nothing to do, and nothing breaks */ }
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const systemTheme = (): Theme => (darkQuery?.matches ? 'dark' : 'light');
const resolve = (pref: ThemePref): Theme => (pref === 'system' ? systemTheme() : pref);

function readPref(): ThemePref {
  const v = read<string>(THEME_KEY, MOBILE ? 'system' : 'dark');
  return v === 'light' || v === 'dark' || v === 'system' ? v : MOBILE ? 'system' : 'dark';
}

const initialPref = readPref();
export const themeStore = createStore<{ theme: Theme; pref: ThemePref; density: Density }>({
  theme: resolve(initialPref),
  pref: initialPref,
  density: read<Density>(DENSITY_KEY, 'normal'),
});

function apply(theme: Theme): void {
  themeStore.set({ theme });
  document.documentElement.setAttribute('data-theme', theme);
  // The browser chrome colour is READ from the token that was just applied, rather
  // than duplicated here — so theme.css stays the only place a colour is defined.
  const chrome = getComputedStyle(document.documentElement).getPropertyValue('--app-chrome-bg').trim();
  if (chrome) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
}

/** Choose light, dark, or follow the device — remembered for this surface. */
export function setThemePref(pref: ThemePref): void {
  themeStore.set({ pref });
  write(THEME_KEY, pref);
  apply(resolve(pref));
}

/** Pin a theme (the top-bar switch, the console's toggle). */
export function setTheme(theme: Theme): void {
  setThemePref(theme);
}

export function toggleTheme(): void {
  setTheme(themeStore.get().theme === 'dark' ? 'light' : 'dark');
}

export function setDensity(density: Density): void {
  themeStore.set({ density });
  if (density === 'wall') document.documentElement.setAttribute('data-density', 'wall');
  else document.documentElement.removeAttribute('data-density');
  write(DENSITY_KEY, density);
}

export const useTheme = () => useStore(themeStore, (s) => s.theme);
export const useThemePref = () => useStore(themeStore, (s) => s.pref);
export const useDensity = () => useStore(themeStore, (s) => s.density);

// Following the device: when the phone switches theme, the app goes with it.
darkQuery?.addEventListener?.('change', () => {
  if (themeStore.get().pref === 'system') apply(systemTheme());
});

// Apply whatever was restored by the inline script in index.html, so the store and the
// DOM cannot disagree.
apply(themeStore.get().theme);
setDensity(themeStore.get().density);
