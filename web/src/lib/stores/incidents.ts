/**
 * Incidents — the queue, and the detail of whichever incidents are open on screen.
 *
 * REST is the floor: the queue renders from GET /api/incidents alone. The socket makes it
 * live — an event applies its full summary at once, then a debounced refetch (500 ms,
 * docs/04 §11) settles ordering and membership, so the list is never wrong for long even
 * if an event was missed.
 */

import { useEffect } from 'react';
import { createStore, useStore } from './createStore';
import { api, ApiError } from '../api';
import { onResync, onSocket, watchIncident } from '../socket';
import type { Incident, IncidentDetail, Priority } from '../types';

export type QueueScope = 'active' | 'all';

interface QueueState {
  items: Incident[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  scope: QueueScope;
  /** ref → when it arrived over the socket, for the one-time arrival pulse. */
  arrived: Record<string, number>;
  loadedAt: number | null;
}

export const incidentStore = createStore<QueueState>({
  items: [], status: 'idle', error: null, scope: 'active', arrived: {}, loadedAt: null,
});

const RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

function sortFor(scope: QueueScope, items: Incident[]): Incident[] {
  return [...items].sort(scope === 'active'
    ? (a, b) => RANK[a.priority] - RANK[b.priority] || a.reportedAt.localeCompare(b.reportedAt)
    : (a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

let loadSeq = 0;
export async function loadIncidents(): Promise<void> {
  const { scope, items } = incidentStore.get();
  const seq = ++loadSeq;
  if (!items.length) incidentStore.set({ status: 'loading', error: null });
  try {
    const page = await api.incidents.list({ status: scope, limit: scope === 'active' ? 300 : 200 });
    if (seq !== loadSeq) return;   // a newer load (scope change) superseded this one
    incidentStore.set({ items: sortFor(scope, page.items), status: 'ready', error: null, loadedAt: Date.now() });
  } catch (err) {
    if (seq !== loadSeq) return;
    incidentStore.set({ status: 'error', error: (err as ApiError).message });
  }
}

export function setQueueScope(scope: QueueScope): void {
  if (incidentStore.get().scope === scope) return;
  incidentStore.set({ scope, items: [], status: 'loading' });
  void loadIncidents();
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefetch() {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => { refetchTimer = null; void loadIncidents(); }, 500);
}

/** How long a newly arrived card is marked fresh — long enough for its one pulse. */
const FRESH_MS = 4000;

function applySummary(summary: Incident, isNew: boolean) {
  incidentStore.update((s) => {
    const others = s.items.filter((i) => i.ref !== summary.ref);
    const keep = s.scope === 'all' || summary.state !== 'closed';
    return {
      items: sortFor(s.scope, keep ? [...others, summary] : others),
      arrived: isNew ? { ...s.arrived, [summary.ref]: Date.now() } : s.arrived,
    };
  });
  if (isNew) {
    setTimeout(() => incidentStore.update((s) => {
      const rest = { ...s.arrived };
      delete rest[summary.ref];
      return { arrived: rest };
    }), FRESH_MS);
  }
}

type ArrivalListener = (incident: Incident) => void;
const arrivalListeners = new Set<ArrivalListener>();
/** For the P1 arrival tone — the store stays free of audio. */
export function onIncidentArrival(listener: ArrivalListener): () => void {
  arrivalListeners.add(listener);
  return () => { arrivalListeners.delete(listener); };
}

let wired = false;
/** Wire the queue to the socket, once for the life of the console. */
export function wireIncidentFeed(): void {
  if (wired) return;
  wired = true;
  onSocket('incident:new', (inc) => {
    applySummary(inc, true);
    for (const l of arrivalListeners) l(inc);
    scheduleRefetch();
  });
  onSocket('incident:update', ({ patch }) => { applySummary(patch, false); scheduleRefetch(); });
  onSocket('incident:closed', () => scheduleRefetch());
  onResync(() => void loadIncidents());
}

// ── Detail ──────────────────────────────────────────────────────────────────

interface DetailEntry {
  data: IncidentDetail | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

export const detailStore = createStore<{ byRef: Record<string, DetailEntry> }>({ byRef: {} });

const EMPTY_ENTRY: DetailEntry = { data: null, status: 'loading', error: null };

const setEntry = (ref: string, patch: Partial<DetailEntry>) =>
  detailStore.update((s) => ({
    byRef: { ...s.byRef, [ref]: { ...(s.byRef[ref] ?? EMPTY_ENTRY), ...patch } },
  }));

export async function refreshDetail(ref: string): Promise<IncidentDetail | null> {
  if (!detailStore.get().byRef[ref]?.data) setEntry(ref, { status: 'loading', error: null });
  try {
    const data = await api.incidents.get(ref);
    setEntry(ref, { data, status: 'ready', error: null });
    return data;
  } catch (err) {
    setEntry(ref, { status: 'error', error: (err as ApiError).message });
    return null;
  }
}

const detailTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleDetail(ref: string) {
  const t = detailTimers.get(ref);
  if (t) clearTimeout(t);
  detailTimers.set(ref, setTimeout(() => { detailTimers.delete(ref); void refreshDetail(ref); }, 300));
}

/**
 * The full record for one incident, kept live while mounted: joins the incident's room,
 * and refetches (debounced) on anything that touches it.
 */
export function useIncidentDetail(ref: string | null): DetailEntry | undefined {
  useEffect(() => {
    if (!ref) return;
    void refreshDetail(ref);
    const offs = [
      watchIncident(ref),
      onSocket('incident:timeline', (p) => { if (p.ref === ref) scheduleDetail(ref); }),
      onSocket('incident:update', (p) => { if (p.ref === ref) scheduleDetail(ref); }),
      onSocket('assignment:update', (p) => { if (p.incidentRef === ref) scheduleDetail(ref); }),
      onSocket('agency:notified', (p) => { if (p.incidentRef === ref) scheduleDetail(ref); }),
      onResync(() => void refreshDetail(ref)),
    ];
    return () => { for (const off of offs) off(); };
  }, [ref]);
  return useStore(detailStore, (s) => (ref ? s.byRef[ref] : undefined));
}

export const useQueue = () => useStore(incidentStore);
