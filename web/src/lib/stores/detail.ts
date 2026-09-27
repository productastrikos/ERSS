/**
 * The dashboard's detail panel — what is open on the right, and how to get back.
 *
 * Every card on the dashboard opens here rather than navigating away: the map stays in
 * view while the detail is read, which on a live picture is the whole point. The panel
 * REPLACES the right rail (Automatic dispatch + Live feed) while it is open, so it never
 * covers the map; closing it puts the rail back.
 *
 * It is a stack, not a single slot: an incident opens its ambulance, the ambulance opens
 * the job it is on, and "back" retraces the path the reader took.
 */

import { createStore, useStore } from './createStore';

export type KpiKey = 'response' | 'within' | 'active' | 'fleet' | 'ai';

export type DetailTarget =
  | { kind: 'auto' }
  | { kind: 'incident'; ref: string }
  | { kind: 'unit'; ref: string }
  | { kind: 'hospital'; ref: string }
  | { kind: 'kpi'; key: KpiKey }
  | { kind: 'feed' };

interface DetailState {
  stack: DetailTarget[];
  /** True when the director opened it, not a person — a person's choice is never replaced. */
  auto: boolean;
}

export const detailStore = createStore<DetailState>({ stack: [], auto: false });

const same = (a: DetailTarget | undefined, b: DetailTarget) => !!a && JSON.stringify(a) === JSON.stringify(b);

/** Open a card's detail. A second click on the card that is already open closes it. */
export function openDetail(target: DetailTarget, { toggle = false }: { toggle?: boolean } = {}): void {
  detailStore.update((s) => {
    const top = s.stack[s.stack.length - 1];
    if (same(top, target)) return toggle ? { stack: [], auto: false } : {};
    return { stack: [...s.stack, target].slice(-8), auto: false };
  });
}

/**
 * The incident director opening the story it is following. It replaces its own previous
 * panel, but leaves alone anything a person opened — reading an ambulance's crew when the
 * next alert lands must not be snatched away.
 */
export function openDetailAuto(target: DetailTarget): void {
  detailStore.update((s) => {
    if (s.stack.length && !s.auto) return {};
    return { stack: [target], auto: true };
  });
}

export const backDetail = () => detailStore.update((s) => ({ stack: s.stack.slice(0, -1), auto: false }));
export const closeDetail = () => detailStore.set({ stack: [], auto: false });

export const useDetail = (): DetailTarget | null => useStore(detailStore, (s) => s.stack[s.stack.length - 1] ?? null);
export const useDetailDepth = (): number => useStore(detailStore, (s) => s.stack.length);

/** Is this exact target the one on top? For a card's "open" styling. */
export function useIsOpen(target: DetailTarget): boolean {
  return useStore(detailStore, (s) => same(s.stack[s.stack.length - 1], target));
}
