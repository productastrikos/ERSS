/**
 * Which basemap the maps draw on — the theme's own map, a full-colour street map, or
 * satellite imagery. One choice for every map on a surface, like the theme: pick
 * Satellite on the dashboard and Replay opens on it too.
 *
 * The console remembers it per browser (`erss.basemap`); the mobile app keeps its own key
 * and has no switch, so it stays on the theme's map.
 */

import { createStore, useStore } from './createStore';

export type Basemap = 'standard' | 'streets' | 'satellite';

const MOBILE = typeof location !== 'undefined' && location.pathname.startsWith('/app');
const KEY = MOBILE ? 'erss.basemap.app' : 'erss.basemap';

/** localStorage can throw (private window, blocked site data) — a preference, never state. */
function read(): Basemap {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'streets' || v === 'satellite' ? v : 'standard';
  } catch {
    return 'standard';
  }
}

export const basemapStore = createStore<{ basemap: Basemap }>({ basemap: read() });

export function setBasemap(basemap: Basemap): void {
  basemapStore.set({ basemap });
  try { localStorage.setItem(KEY, basemap); } catch { /* nothing breaks */ }
}

export const useBasemap = () => useStore(basemapStore, (s) => s.basemap);
