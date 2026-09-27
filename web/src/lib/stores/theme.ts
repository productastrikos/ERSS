/**
 * Theme and display density.
 *
 * Light is the default. Dark exists because the Astrikos specification makes both
 * mandatory, and because a video wall or a night-shift command room wants it.
 *
 * Density 'wall' is the video-wall mode — a display density, not a separate app.
 */

import { createStore, useStore } from './createStore';

export type Theme = 'dark' | 'light';
export type Density = 'normal' | 'wall';

const THEME_KEY = 'erss.theme';
const DENSITY_KEY = 'erss.density';

/** localStorage can throw (private window, blocked site data) — never let it break a
 *  boot. A remembered preference is a convenience, not state we depend on. */
function read<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback; } catch { return fallback; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* nothing to do, and nothing breaks */ }
}

export const themeStore = createStore<{ theme: Theme; density: Density }>({
  theme: read<Theme>(THEME_KEY, 'light'),
  density: read<Density>(DENSITY_KEY, 'normal'),
});

export function setTheme(theme: Theme): void {
  themeStore.set({ theme });
  document.documentElement.setAttribute('data-theme', theme);

  // The browser chrome colour is READ from the token that was just applied, rather
  // than duplicated here — so theme.css stays the only place a colour is defined.
  const chrome = getComputedStyle(document.documentElement)
    .getPropertyValue('--app-chrome-bg').trim();
  if (chrome) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);

  write(THEME_KEY, theme);
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
export const useDensity = () => useStore(themeStore, (s) => s.density);

// Apply whatever was restored by the inline script in index.html, so the store and the
// DOM cannot disagree.
setTheme(themeStore.get().theme);
setDensity(themeStore.get().density);
