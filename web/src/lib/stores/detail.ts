/**
 * The detail drawer — what is open on the right, and how to get back.
 *
 * Every card on the dashboard, the wall view and the live map opens here rather than
 * navigating away. The drawer is a full-height slide-over from the right edge
 * (console/detail/DetailPanel.tsx): it OVERLAPS the page — the rail, the edge of the map —
 * instead of taking a slot in the layout, slides away when closed, and leaves a tab on the
 * edge to bring the last thing back. The incident director opens it by itself when a
 * camera raises an incident, so the AI's reasoning is on screen the moment it starts.
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
  /** What was on top when the drawer last closed — the edge tab brings it back. */
  last: DetailTarget | null;
  /** Still drawn while the drawer slides shut; cleared when the animation ends. */
  closing: DetailTarget | null;
}

export const detailStore = createStore<DetailState>({ stack: [], auto: false, last: null, closing: null });

const same = (a: DetailTarget | undefined | null, b: DetailTarget) => !!a && JSON.stringify(a) === JSON.stringify(b);
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shut the drawer, remembering what was in it. */
function shut(s: DetailState): Partial<DetailState> {
  const top = s.stack[s.stack.length - 1] ?? null;
  return { stack: [], auto: false, last: top ?? s.last, closing: top && !reducedMotion() ? top : null };
}

/** Open a card's detail. A second click on the card that is already open closes it. */
export function openDetail(target: DetailTarget, { toggle = false }: { toggle?: boolean } = {}): void {
  detailStore.update((s) => {
    const top = s.stack[s.stack.length - 1];
    if (same(top, target)) return toggle ? shut(s) : {};
    return { stack: [...s.stack, target].slice(-8), auto: false, closing: null };
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
    return { stack: [target], auto: true, closing: null };
  });
}

export const backDetail = () => detailStore.update((s) => (s.stack.length > 1
  ? { stack: s.stack.slice(0, -1), auto: false }
  : shut(s)));
export const closeDetail = () => detailStore.update((s) => shut(s));
/** The edge tab: bring back what was last open. */
export const reopenDetail = (fallback?: DetailTarget | null) => detailStore.update((s) => {
  const t = s.last ?? fallback ?? null;
  return t ? { stack: [t], auto: false, closing: null } : {};
});
/** The slide-out finished. */
export const closedDetail = () => detailStore.update((s) => (s.closing ? { closing: null } : {}));
/** Forget everything — a restart of the PoC removes the incidents the drawer pointed at. */
export const resetDetail = () => detailStore.set({ stack: [], auto: false, last: null, closing: null });

export const useDetail = (): DetailTarget | null => useStore(detailStore, (s) => s.stack[s.stack.length - 1] ?? null);
export const useDetailDepth = (): number => useStore(detailStore, (s) => s.stack.length);
export const useDetailDrawer = () => useStore(detailStore, (s) => ({
  target: s.stack[s.stack.length - 1] ?? null,
  depth: s.stack.length,
  closing: s.closing,
  last: s.last,
}));

/** Is this exact target the one on top? For a card's "open" styling. */
export function useIsOpen(target: DetailTarget): boolean {
  return useStore(detailStore, (s) => same(s.stack[s.stack.length - 1], target));
}
