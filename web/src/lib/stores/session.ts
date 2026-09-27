/**
 * Session and bootstrap state.
 *
 * `bootstrap()` is ONE request that returns everything a surface needs on load —
 * user, jurisdiction pack, agencies, feeds, scenarios, clock, integration status.
 * A cold load is one round trip, not eleven.
 */

import { createStore, useStore } from './createStore';
import { anchorClock, domainNow, useNow } from './now';
import { api, ApiError } from '../api';
import { setToken } from '../authToken';
import type { Bootstrap, SessionUser, ClockSnapshot, PocScope } from '../types';

/** The tab title names who is signed in here — with three tabs open, that is the
 *  difference between testing the right screen and the wrong one. */
function titleFor(user: SessionUser | null): void {
  document.title = user ? `${user.name} · ${user.roleLabel} — ERSS Dubai` : 'ERSS Dubai';
}

interface SessionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  user: SessionUser | null;
  boot: Bootstrap | null;
  clock: ClockSnapshot | null;
  error: string | null;
  /** True when the backend is reachable but its database is not — a distinct state
   *  from "offline", and one the UI must say out loud rather than showing zeros. */
  dbDown: boolean;
  /** When this browser tab most recently recognised a signed-in user — a fresh sign-in
   *  AND a reload of an already-valid session both count. Powers useQuietWindow(): the
   *  dashboard's cold open, so a sign-in never lands mid-story. */
  signedInAt: number | null;
}

export const sessionStore = createStore<SessionState>({
  status: 'idle',
  user: null,
  boot: null,
  clock: null,
  error: null,
  dbDown: false,
  signedInAt: null,
});

export async function loadBootstrap(): Promise<void> {
  sessionStore.set({ status: 'loading', error: null });
  try {
    const boot = await api.bootstrap();
    // Counters and countdowns run on the server's clock, not this device's.
    anchorClock({ now: boot.serverTime, speed: boot.clock.speed, state: boot.clock.state });
    // A token the server no longer honours (expired, revoked, a reseeded database) is
    // dropped, so the tab shows the login screen instead of failing request by request.
    if (!boot.user) setToken(null);
    titleFor(boot.user);
    sessionStore.set({
      status: 'ready',
      user: boot.user,
      boot,
      clock: boot.clock,
      error: null,
      dbDown: false,
      // Every successful bootstrap that lands a user starts a fresh quiet window — a
      // tab reload counts as "just logged in" as much as the form does; both are a
      // console reappearing after not being watched. On the domain clock (not
      // Date.now()), like every other countdown in this app — see lib/stores/now.ts.
      signedInAt: boot.user ? domainNow() : null,
    });
  } catch (err) {
    const e = err as ApiError;
    // The backend address is derived from configuration, never written here — so the
    // message stays true if the port or host changes.
    const backend = import.meta.env.VITE_API_URL || `${window.location.origin} (dev proxy)`;
    sessionStore.set({
      status: 'error',
      error: e.isOffline
        ? `Cannot reach the ERSS backend at ${backend}. Is it running?`
        : e.isDbDown
          ? `Database unavailable${e.hint ? ` — ${e.hint}` : ''}`
          : e.message,
      dbDown: e.isDbDown,
    });
  }
}

export async function signIn(identifier: string, password: string): Promise<SessionUser> {
  const { user, token } = await api.auth.login(identifier, password);
  setToken(token);
  sessionStore.set({ user });
  // Re-bootstrap: permissions, zone scope and the nav all depend on who is asking.
  await loadBootstrap();
  return user;
}

export async function signOut(): Promise<void> {
  try { await api.auth.logout(); } catch { /* clearing local state matters more */ }
  setToken(null);
  sessionStore.set({ user: null });
  await loadBootstrap();
}

export function setClock(clock: ClockSnapshot): void {
  anchorClock(clock);
  sessionStore.set({ clock });
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export const useSession = () => useStore(sessionStore);
export const useUser = () => useStore(sessionStore, (s) => s.user);
export const useClock = () => useStore(sessionStore, (s) => s.clock);
export const useBoot = () => useStore(sessionStore, (s) => s.boot);

/** The trial's scope. Before bootstrap lands it reads as the trial — never flash the
 *  emirate-wide controls on a build that is not going to show them. */
const POC_DEFAULT: PocScope = { enabled: true, fleetSize: 8, camerasPerUnit: 2, roadOnly: true, calls: false };
export const usePoc = (): PocScope => useStore(sessionStore, (s) => s.boot?.poc ?? POC_DEFAULT);

/** Capability check. The nav is generated from these, so a role without a capability
 *  sees no item rather than a disabled one. */
export function useCan(capability: string): boolean {
  const user = useUser();
  return user?.capabilities.includes(capability) ?? false;
}

export function can(capability: string): boolean {
  return sessionStore.get().user?.capabilities.includes(capability) ?? false;
}

const QUIET_WINDOW_MS = 30_000;

/**
 * True for the first `ms` after this tab most recently recognised a signed-in user — a
 * cold open, so a sign-in (or a reload) never lands mid-story no matter what the shared
 * PoC simulation already has running. Rides the existing domain-clock tick (useNow, once
 * a second) rather than a clock read during render or a setState-in-effect of its own.
 */
export function useQuietWindow(ms: number = QUIET_WINDOW_MS): boolean {
  const signedInAt = useStore(sessionStore, (s) => s.signedInAt);
  const now = useNow();
  return signedInAt != null && now - signedInAt < ms;
}
