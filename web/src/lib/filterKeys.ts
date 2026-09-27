/**
 * The query-string keys the universal chart filter owns.
 *
 * A module of its own for one reason: `router.ts` has to carry these across a navigation,
 * and `filters.ts` has to read `routerStore` to push a filter change into history. Both
 * importing this leaf keeps that a line, not a cycle.
 *
 * Every name matches the server's own filter parameter (server/lib/filters.js), so a
 * console URL can be pasted straight into a curl against /api/insights/*.
 */

export const FILTER_LIST_KEYS = [
  'kind', 'priority', 'source', 'outcome', 'zone', 'zoneClass', 'unitKind', 'agency',
  'station', 'complaint', 'escalation',
] as const;

export const FILTER_NUM_KEYS = [
  'hourFrom', 'hourTo', 'floorMin', 'floorMax', 'acuityMin', 'acuityMax',
  'responseMinSec', 'responseMaxSec',
] as const;

export const FILTER_TRI_KEYS = [
  'withinTarget', 'highrise', 'transported', 'multiAgency', 'seeded', 'includeResting',
] as const;

/** Everything the filter writes to the URL — the rest of a query string is a page's own. */
export const FILTER_URL_KEYS: string[] = [
  'window', 'from', 'to', 'dow', 'predict', 'horizon', 'interval', 'naive',
  ...FILTER_LIST_KEYS, ...FILTER_NUM_KEYS, ...FILTER_TRI_KEYS,
];
