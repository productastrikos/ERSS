/**
 * The domain clock, client side.
 *
 * Elapsed counters and ETA countdowns must run on the SERVER's clock, not the laptop's:
 * during a scenario the domain clock is offset, scaled and pausable (server/lib/clock.js),
 * and even when idle a demo laptop's clock can be a minute out. The clock is anchored to
 * every snapshot the server sends (bootstrap, run:clock) and extrapolated between them.
 *
 * `useNow()` ticks once a second, from ONE shared interval that runs only while something
 * on screen is counting.
 */

import { useSyncExternalStore } from 'react';
import type { ClockSnapshot } from '../types';

let anchor = { serverMs: Date.now(), clientMs: Date.now(), speed: 1, state: 'idle' as ClockSnapshot['state'] };

export function anchorClock(snapshot: Pick<ClockSnapshot, 'now' | 'speed' | 'state'>): void {
  const serverMs = Date.parse(snapshot.now);
  if (Number.isNaN(serverMs)) return;
  anchor = { serverMs, clientMs: Date.now(), speed: snapshot.speed || 1, state: snapshot.state };
  tick();
}

/** Milliseconds since the epoch, as the domain sees them. */
export function domainNow(): number {
  if (anchor.state === 'paused') return anchor.serverMs;
  const rate = anchor.state === 'running' ? anchor.speed : 1;
  return anchor.serverMs + (Date.now() - anchor.clientMs) * rate;
}

const listeners = new Set<() => void>();
let current = domainNow();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  current = domainNow();
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) timer = setInterval(tick, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
