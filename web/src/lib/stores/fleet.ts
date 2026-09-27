/**
 * The fleet — every unit, its status and its last position.
 *
 * Loaded over REST, moved by `unit:position` frames, and replaced wholesale by
 * `units:snapshot` on join and every 30 s — the correctness backstop, so drift from a
 * missed frame lasts half a minute at most.
 */

import { createStore, useStore } from './createStore';
import { api, ApiError } from '../api';
import { onResync, onSocket } from '../socket';
import type { Unit, UnitFrame } from '../types';

interface FleetState {
  units: Unit[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  asOf: number | null;
}

export const fleetStore = createStore<FleetState>({ units: [], status: 'idle', error: null, asOf: null });

export async function loadUnits(): Promise<void> {
  if (!fleetStore.get().units.length) fleetStore.set({ status: 'loading', error: null });
  try {
    const units = await api.units.list();
    fleetStore.set({ units, status: 'ready', error: null, asOf: Date.now() });
  } catch (err) {
    fleetStore.set({ status: 'error', error: (err as ApiError).message });
  }
}

function applyFrames(frames: UnitFrame[]) {
  const byRef = new Map(frames.map((f) => [f.unitRef, f]));
  let statusChanged = false;
  fleetStore.update((s) => ({
    units: s.units.map((u) => {
      const f = byRef.get(u.ref);
      if (!f) return u;
      if (f.status && f.status !== u.status) statusChanged = true;
      return { ...u, lng: f.lng ?? u.lng, lat: f.lat ?? u.lat, heading: f.heading ?? u.heading, speed: f.speed ?? u.speed, status: f.status ?? u.status };
    }),
  }));
  // A status change also moves the unit's current assignment, which frames do not carry.
  if (statusChanged) scheduleRefetch();
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefetch() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => { refetchTimer = null; void loadUnits(); }, 1000);
}

let wired = false;
export function wireFleetFeed(): void {
  if (wired) return;
  wired = true;
  onSocket('units:snapshot', ({ units }) => fleetStore.set({ units, status: 'ready', error: null, asOf: Date.now() }));
  onSocket('unit:position', applyFrames);
  onResync(() => void loadUnits());
}

export const useFleet = () => useStore(fleetStore);
