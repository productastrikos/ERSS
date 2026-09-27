/**
 * The socket — fan-out only. docs/04 §10.
 *
 * Nothing is ever written through here (the one exception, unit:position, belongs to the
 * responder app). A dropped connection degrades LIVENESS, never correctness: on reconnect
 * every open screen refetches over REST (`onResync`) and rejoins its rooms. There is no
 * replay buffer, on purpose.
 *
 * Handlers are registered on this module, not on the socket, so they survive the socket
 * being recreated across a sign-out and sign-in.
 */

import { io, type Socket } from 'socket.io-client';
import { createStore, useStore } from './stores/createStore';
import { config } from './config';
import { getToken } from './authToken';
import type { ServerEvents } from './types';

export type SocketStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export const socketStore = createStore<{ status: SocketStatus; since: number | null }>({ status: 'idle', since: null });

let socket: Socket | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;

type Handler = (payload: never) => void;
const handlers = new Map<string, Set<Handler>>();
const resyncHandlers = new Set<() => void>();
/** incident ref → how many screens are watching it. */
const watched = new Map<string, number>();

export function connectSocket(): void {
  if (socket) return;
  // The same per-tab token the REST client sends (lib/authToken.ts) — never the cookie,
  // or every tab's socket would join the rooms of whoever signed in last.
  const options = { withCredentials: false, transports: ['websocket', 'polling'], auth: { token: getToken() ?? '' } };
  socket = config.socketUrl ? io(config.socketUrl, options) : io(options);
  socketStore.set({ status: 'connecting', since: null });

  let everConnected = false;
  socket.on('connect', () => {
    socketStore.set({ status: 'live', since: Date.now() });
    for (const ref of watched.keys()) socket?.emit('incident:watch', { ref });
    // Refetch, never replay: whatever was missed while disconnected is read over REST.
    if (everConnected) for (const h of resyncHandlers) h();
    everConnected = true;
  });
  socket.on('disconnect', () => socketStore.set({ status: 'reconnecting', since: Date.now() }));
  socket.on('connect_error', () => socketStore.set({ status: everConnected ? 'reconnecting' : 'offline', since: Date.now() }));

  socket.onAny((event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) {
      try { (h as (p: unknown) => void)(payload); } catch (err) { console.error(`[socket] ${event} handler failed`, err); }
    }
  });

  presenceTimer = setInterval(() => socket?.emit('presence:ping', {}), 20_000);
}

export function disconnectSocket(): void {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  socket?.close();
  socket = null;
  socketStore.set({ status: 'idle', since: null });
}

/** Subscribe to a server event. Returns the unsubscribe. */
export function onSocket<K extends keyof ServerEvents>(event: K, handler: (payload: ServerEvents[K]) => void): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  const set = handlers.get(event)!;
  set.add(handler as Handler);
  return () => { set.delete(handler as Handler); };
}

/** Called after a RE-connection, so a screen can refetch what it shows. */
export function onResync(handler: () => void): () => void {
  resyncHandlers.add(handler);
  return () => { resyncHandlers.delete(handler); };
}

/**
 * Run every resync handler now, as if the socket had just reconnected — for an action
 * that invalidates everything on screen without an actual disconnect (a PoC restart:
 * the incident queue, fleet, feed, alerts and open traces are all stale the instant
 * `sim.reset()` returns, and a real screen must not wait for a socket drop to notice).
 */
export function resyncNow(): void {
  for (const h of resyncHandlers) h();
}

/** Join an incident's room while a screen shows it. Reference-counted. */
export function watchIncident(ref: string): () => void {
  const n = watched.get(ref) ?? 0;
  watched.set(ref, n + 1);
  if (n === 0) socket?.emit('incident:watch', { ref });
  return () => {
    const left = (watched.get(ref) ?? 1) - 1;
    if (left > 0) { watched.set(ref, left); return; }
    watched.delete(ref);
    socket?.emit('incident:unwatch', { ref });
  };
}

export const useSocketStatus = () => useStore(socketStore);

/** The one client→server write the socket carries (docs/02 §6): a responder's own
 *  position, speed in km/h. High-frequency and lossy by nature — silently dropped if not
 *  connected. */
export function reportPosition(payload: { lng: number; lat: number; speed?: number | null; heading?: number | null }): void {
  socket?.emit('unit:position', payload);
}
