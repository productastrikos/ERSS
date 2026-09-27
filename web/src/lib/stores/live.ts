/**
 * The live picture — simulation state, the dashboard summary, where every ambulance on a
 * job is heading, the event feed and operational alerts.
 *
 * Same idiom as every other store: REST is the floor, the socket makes it live. Alerts and
 * the simulation state are wired for the life of a console session (the bell and the
 * status bar are on every page); the summary, the routes and the feed poll only while a
 * screen that shows them is mounted.
 */

import { useEffect } from 'react';
import { createStore, useStore } from './createStore';
import { api, ApiError } from '../api';
import { onResync, onSocket } from '../socket';
import { speak, tone } from '../sound';
import { routerStore } from '../router';
import type { AlertItem, Camera, Detection, FeedItem, LiveAssignments, LiveSummary, SimState } from '../types';

// ── Simulation ───────────────────────────────────────────────────────────────

export const simStore = createStore<{ state: SimState | null; busy: boolean; error: string | null }>({
  state: null, busy: false, error: null,
});

export async function loadSim(): Promise<void> {
  try {
    simStore.set({ state: await api.sim.get(), error: null });
  } catch (err) {
    simStore.set({ error: (err as ApiError).message });
  }
}

/** Run a simulation control and adopt the state it returns. */
export async function simControl(run: () => Promise<SimState | { state: SimState } | unknown>): Promise<boolean> {
  simStore.set({ busy: true, error: null });
  try {
    const out = await run();
    const state = out && typeof out === 'object' && 'state' in out ? (out as { state: SimState }).state
      : out && typeof out === 'object' && 'running' in out ? (out as SimState) : null;
    if (state) simStore.set({ state });
    else void loadSim();
    return true;
  } catch (err) {
    simStore.set({ error: (err as ApiError).message });
    return false;
  } finally {
    simStore.set({ busy: false });
  }
}

export const useSim = () => useStore(simStore);

// ── Dashboard summary ────────────────────────────────────────────────────────

export const summaryStore = createStore<{ data: LiveSummary | null; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }>({
  data: null, status: 'idle', error: null,
});

let summarySeq = 0;
export async function loadSummary(): Promise<void> {
  const seq = ++summarySeq;
  if (!summaryStore.get().data) summaryStore.set({ status: 'loading' });
  try {
    const data = await api.live.summary();
    if (seq !== summarySeq) return;
    summaryStore.set({ data, status: 'ready', error: null });
    simStore.set({ state: data.sim });
  } catch (err) {
    if (seq !== summarySeq) return;
    summaryStore.set({ status: 'error', error: (err as ApiError).message });
  }
}

export const useSummary = () => useStore(summaryStore);

// ── Ambulances on a job: the road still ahead of each ───────────────────────

type LngLat = [number, number];

/** How many fixes of tail to keep per ambulance. At a 3s poll that is about two minutes. */
const TRAIL_MAX = 40;
/** Fixes closer together than this are the same place; keeping them makes a lumpy tail. */
const TRAIL_MIN_M = 12;

/** Metres between two lng/lat pairs — equirectangular, exact enough for a tail. */
function metresApart(a: LngLat, b: LngLat): number {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const y = b[1] - a[1];
  return Math.sqrt(x * x + y * y) * 111_320;
}

export const liveRoutesStore = createStore<{
  data: LiveAssignments | null;
  /** unitRef → where it has been, newest last. The map draws this as a fading trail. */
  trails: ReadonlyMap<string, LngLat[]>;
}>({ data: null, trails: new Map() });

/**
 * The server sends where each ambulance IS, not where it has been — the breadcrumb history
 * is in `unit_positions`, and re-fetching it every three seconds just to draw a tail would
 * be absurd. So the console remembers the fixes it has already been sent, per unit, and
 * forgets them the moment that unit's job ends.
 */
function accumulateTrails(prev: ReadonlyMap<string, LngLat[]>, data: LiveAssignments): Map<string, LngLat[]> {
  const next = new Map<string, LngLat[]>();
  for (const a of data.assignments) {
    if (!a.unitPosition) continue;
    const tail = prev.get(a.unitRef) ?? [];
    const last = tail[tail.length - 1];
    if (last && metresApart(last, a.unitPosition) < TRAIL_MIN_M) {
      next.set(a.unitRef, tail);
      continue;
    }
    const grown = [...tail, a.unitPosition];
    next.set(a.unitRef, grown.length > TRAIL_MAX ? grown.slice(grown.length - TRAIL_MAX) : grown);
  }
  return next;
}

export async function loadLiveRoutes(): Promise<void> {
  try {
    const data = await api.live.assignments();
    liveRoutesStore.set({ data, trails: accumulateTrails(liveRoutesStore.get().trails, data) });
  } catch { /* the map keeps its last routes; the next poll retries */ }
}

export const useLiveRoutes = () => useStore(liveRoutesStore, (s) => s.data);
export const useLiveTrails = () => useStore(liveRoutesStore, (s) => s.trails);

// ── Feed ─────────────────────────────────────────────────────────────────────

const FEED_MAX = 80;

export const feedStore = createStore<{ items: FeedItem[]; fresh: Record<number, true>; status: 'idle' | 'ready' | 'error' }>({
  items: [], fresh: {}, status: 'idle',
});

export async function loadFeed(): Promise<void> {
  try {
    const items = await api.feed(FEED_MAX);
    feedStore.set({ items, status: 'ready' });
  } catch {
    if (!feedStore.get().items.length) feedStore.set({ status: 'error' });
  }
}

function pushFeed(item: FeedItem) {
  feedStore.update((s) => {
    if (s.items.some((i) => i.id === item.id)) return {};
    return { items: [item, ...s.items].slice(0, FEED_MAX), fresh: { ...s.fresh, [item.id]: true } };
  });
  setTimeout(() => feedStore.update((s) => {
    const fresh = { ...s.fresh };
    delete fresh[item.id];
    return { fresh };
  }), 3000);
}

export const useFeed = () => useStore(feedStore);

// ── Alerts ───────────────────────────────────────────────────────────────────

const SOUND_KEY = 'erss.alerts.sound';
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };

interface AlertState {
  items: AlertItem[];
  /** Arrived since the panel was last opened. */
  unread: number;
  /** The one alert interrupting the screen right now. */
  popup: AlertItem | null;
  queue: AlertItem[];
  sound: boolean;
  open: boolean;
}

export const alertStore = createStore<AlertState>({
  items: [], unread: 0, popup: null, queue: [], sound: readSound(), open: false,
});

export async function loadAlerts(): Promise<void> {
  try {
    const items = await api.alerts.list(80);
    // What was raised before this screen opened is history — listed, never popped up.
    alertStore.set({ items });
  } catch { /* the bell stays empty; the socket still delivers new alerts */ }
}

/** Popups are for the live moment only: at most this many wait behind the current one. */
const QUEUE_MAX = 3;

/**
 * Pages whose map follows each new incident by itself (useIncidentDirector): there the
 * camera flies to it and the rail opens its AI log, so a "new P1" card over the map, or the
 * detection dialog over the rail, would cover the very thing it announces. The alert is
 * still listed in the bell and still sounds; the camera evidence is one click away.
 */
const FOLLOWING_PAGES = new Set(['/dashboard', '/live']);
const FOLLOWED_CATEGORIES = new Set(['p1', 'detection']);
const followedHere = () => FOLLOWING_PAGES.has(routerStore.get().path);

function receiveAlert(alert: AlertItem) {
  alertStore.update((s) => {
    if (s.items.some((a) => a.id === alert.id)) return {};
    const items = [alert, ...s.items].slice(0, 150);
    if (!alert.popup || (FOLLOWED_CATEGORIES.has(alert.category) && followedHere())) return { items, unread: s.open ? 0 : s.unread + 1 };
    if (!s.popup) return { items, unread: s.open ? 0 : s.unread + 1, popup: alert };
    // Critical alerts jump the queue; the queue drops its oldest rather than growing.
    const queue = alert.level === 'critical' ? [alert, ...s.queue] : [...s.queue, alert];
    return { items, unread: s.open ? 0 : s.unread + 1, queue: queue.slice(0, QUEUE_MAX) };
  });
  if (alert.popup && alertStore.get().sound) {
    tone(alert.level === 'critical' ? 'critical' : 'warning');
    if (alert.level === 'critical') setTimeout(() => speak(alert.speech), 900);
  }
}

export function dismissPopup(): void {
  alertStore.update((s) => ({ popup: s.queue[0] ?? null, queue: s.queue.slice(1) }));
}

export function acknowledgeAlert(id: string): void {
  alertStore.update((s) => ({ items: s.items.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) }));
  void api.alerts.ack(id).catch(() => {});
}

export function setAlertPanel(open: boolean): void {
  alertStore.set(open ? { open, unread: 0 } : { open });
}

export function setAlertSound(on: boolean): void {
  alertStore.set({ sound: on });
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* a preference */ }
  if (!on) try { window.speechSynthesis?.cancel(); } catch { /* optional */ }
}

export const useAlerts = () => useStore(alertStore);

// ── Camera detections ────────────────────────────────────────────────────────
//
// A detection arrives as five socket frames, one per stage, each carrying the WHOLE
// detection rather than a patch — so a console that joins mid-sequence is immediately
// correct, and a dropped frame costs an animation step rather than the truth.

const DETECTION_MAX = 20;

interface DetectionState {
  items: Detection[];
  /** The detection the console is currently showing in full. */
  openId: string | null;
}

export const detectionStore = createStore<DetectionState>({ items: [], openId: null });

export async function loadDetections(): Promise<void> {
  try {
    detectionStore.set({ items: await api.detections.list() });
  } catch { /* the socket still delivers the next one */ }
}

function receiveDetection(d: Detection) {
  detectionStore.update((s) => {
    const items = [d, ...s.items.filter((x) => x.id !== d.id)].slice(0, DETECTION_MAX);
    // Open it on the stage that first asks for a human: the confirmed verdict. Opening at
    // stage 1 would put a panel over the map every time an analytics frame twitched.
    const open = s.openId ?? (d.stage === 'confirm' && !followedHere() ? d.id : null);
    return { items, openId: open };
  });
}

export const openDetection = (id: string | null) => detectionStore.set({ openId: id });

export const useDetections = () => useStore(detectionStore);
export const useOpenDetection = (): Detection | null =>
  useStore(detectionStore, (s) => (s.openId ? s.items.find((d) => d.id === s.openId) ?? null : null));
/** The detection that raised an incident, if a camera did rather than a caller. */
export const useDetectionFor = (incidentRef: string | null | undefined): Detection | null =>
  useStore(detectionStore, (s) => (incidentRef ? s.items.find((d) => d.incidentRef === incidentRef) ?? null : null));

// ── The camera estate ────────────────────────────────────────────────────────
//
// Reference data, fetched once per session: the cameras exist whether or not anything is
// happening on them, and the map draws them either way.

export const camerasStore = createStore<{ items: Camera[]; loaded: boolean }>({ items: [], loaded: false });

export async function loadCameras(): Promise<void> {
  if (camerasStore.get().loaded) return;
  try {
    camerasStore.set({ items: await api.cameras(), loaded: true });
  } catch { /* the map draws no cameras; the next sign-in retries */ }
}

export const useCameras = () => useStore(camerasStore, (s) => s.items);

// ── Wiring ───────────────────────────────────────────────────────────────────

let wired = false;
/** Once per console session: alerts, simulation state and the feed stream. */
export function wireLiveFeeds(): void {
  if (!wired) {
    wired = true;
    onSocket('alert:new', receiveAlert);
    onSocket('sim:state', (state) => simStore.set({ state }));
    onSocket('feed:item', pushFeed);
    onSocket('detection:stage', receiveDetection);
    onResync(() => { void loadAlerts(); void loadSim(); void loadDetections(); });
  }
  // Loaded on every sign-in: a second user in the same tab must not inherit the first's bell.
  alertStore.set({ unread: 0, popup: null, queue: [] });
  void loadAlerts();
  void loadSim();
  void loadDetections();
  void loadCameras();
}

/** The road ahead of every ambulance on a job, every 3 s while a live map is on screen
 *  (the paths shorten as ambulances drive), and at once when an assignment moves. */
export function useLiveRoutesPolling(): void {
  useEffect(() => {
    void loadLiveRoutes();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void loadLiveRoutes(); }, 600);
    };
    const offs = [onSocket('assignment:update', soon), onResync(() => void loadLiveRoutes())];
    const every = setInterval(() => void loadLiveRoutes(), 3000);
    return () => {
      for (const off of offs) off();
      clearInterval(every);
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/**
 * Keep the dashboard's data fresh while it is on screen: the summary every 10 s and soon
 * after anything that moves a KPI; the feed on load (the socket streams the rest); routes.
 */
export function useLivePolling(): void {
  useLiveRoutesPolling();
  useEffect(() => {
    void loadSummary();
    void loadFeed();

    let summaryTimer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (summaryTimer) return;
      summaryTimer = setTimeout(() => { summaryTimer = null; void loadSummary(); }, 1200);
    };

    const offs = [
      onSocket('kpi:tick', soon),
      onSocket('incident:new', soon),
      onSocket('incident:closed', soon),
      onSocket('assignment:update', soon),
      onResync(() => { void loadSummary(); void loadFeed(); }),
    ];
    const everySummary = setInterval(() => void loadSummary(), 10_000);
    return () => {
      for (const off of offs) off();
      clearInterval(everySummary);
      if (summaryTimer) clearTimeout(summaryTimer);
    };
  }, []);
}

/** Response routes for a map's `responses` layer. */
export function responseRoutes(data: LiveAssignments | null): Array<{ ref: string; leg: 'scene' | 'hospital' | 'return' | 'relocate'; priority: LiveAssignments['assignments'][number]['priority'] | null; path: Array<[number, number]> }> {
  if (!data) return [];
  return [
    ...data.assignments
      .filter((a) => a.leg && a.path && a.path.length > 1)
      .map((a) => ({ ref: a.ref, leg: a.leg!, priority: a.priority, path: a.path! })),
    ...data.legs.map((l) => ({ ref: `${l.unitRef}:${l.leg}`, leg: l.leg, priority: null, path: l.path })),
  ];
}
