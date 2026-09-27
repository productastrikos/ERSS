/**
 * Today's KPIs. The server scopes them to the user, so `kpi:tick` carries no values —
 * it only says "refetch".
 */

import { createStore, useStore } from './createStore';
import { api, ApiError } from '../api';
import { onResync, onSocket } from '../socket';
import type { KpiToday } from '../types';

export const kpiStore = createStore<{ data: KpiToday | null; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }>({
  data: null, status: 'idle', error: null,
});

export async function loadKpis(): Promise<void> {
  if (!kpiStore.get().data) kpiStore.set({ status: 'loading' });
  try {
    kpiStore.set({ data: await api.kpiToday(), status: 'ready', error: null });
  } catch (err) {
    kpiStore.set({ status: 'error', error: (err as ApiError).message });
  }
}

let wired = false;
export function wireKpiFeed(): void {
  if (wired) return;
  wired = true;
  onSocket('kpi:tick', () => void loadKpis());
  onResync(() => void loadKpis());
}

export const useKpis = () => useStore(kpiStore);
