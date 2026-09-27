/**
 * URL routing for the console — the path IS the page.
 *
 * A refresh keeps the page, the back button works, and an alert can deep-link straight to
 * an incident on the Operations tab of Command Centre (/command?tab=operations&incident=
 * INC-…). Deliberately tiny: History API + one store, no dependency. /app is the mobile
 * surface and is routed by role, not by path (main.tsx).
 */

import { createStore, useStore } from './stores/createStore';
import { FILTER_URL_KEYS } from './filterKeys';

/** `key` changes on every navigation, so a page can react to "go to this incident" even
 *  when the URL it is sent to matches one it was already sent to earlier. */
interface Location { path: string; search: string; key: number }

let seq = 0;
const read = (): Location => ({ path: window.location.pathname, search: window.location.search, key: ++seq });

export const routerStore = createStore<Location>(read());

window.addEventListener('popstate', () => routerStore.set(read()));

/** Go to a path (optionally with a query string). Same-page links do not stack history. */
export function navigate(to: string, { replace = false } = {}): void {
  to = carryFilters(to);
  const current = `${window.location.pathname}${window.location.search}`;
  if (to === current) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  routerStore.set(read());
  window.scrollTo?.(0, 0);
}

export const useLocation = () => useStore(routerStore);

/**
 * The universal chart filter (lib/filters.ts) is cross-page state: a slice chosen on
 * Overview still applies on Performance. It also round-trips through the URL, so every
 * navigation has to carry it forward — otherwise the store keeps the filter, the URL
 * loses it, and the next back button silently resets every chart.
 *
 * Imported lazily (`FILTER_URL_KEYS` only, via a static import that filters.ts does not
 * mirror) so router.ts stays free of a cycle: filters.ts imports routerStore from here.
 */
function carryFilters(to: string): string {
  const [path, search = ''] = to.split('?');
  const target = new URLSearchParams(search);
  const here = new URLSearchParams(window.location.search);
  for (const key of FILTER_URL_KEYS) {
    if (!target.has(key) && here.has(key)) target.set(key, here.get(key)!);
  }
  const qs = target.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Open an incident on the Operations workbench (a tab of Command Centre) — the one
 *  deep link everything uses. */
export const openIncident = (ref: string) => navigate(`/command?tab=operations&incident=${encodeURIComponent(ref)}`);
