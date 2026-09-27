/**
 * The incident director — the live map following an emergency by itself.
 *
 * The user's brief, in their words: "if an incident happens, zoom to that area, show the
 * nearby ambulances by itself, show the AI choosing the best route, auto-send the job to
 * the best ambulance, then automatically follow the ambulance with live details." This
 * hook is that sequence, driven by the data rather than by timers, so it can never run
 * ahead of what has actually happened:
 *
 *   deciding     a camera raised it and nobody is assigned: fly to the scene, then frame
 *                it with the ambulances the AI is weighing once their routes are in
 *   dispatched   the job has been sent: frame the chosen crew and the scene together
 *   following    the crew is rolling: ride with it (the chase camera, followCamera.ts)
 *   arrived      on scene: let go, settle over the scene, and after a beat pull back to
 *                the whole picture — ready for the next one
 *
 * Every step reads the live model (useLiveOps) and the AI's preview (decision:update);
 * the camera moves once per step, not on every poll. A person always wins: dragging the
 * map pauses the director for this story (lib/stores/director.ts), and the panel keeps
 * telling it.
 */

import { useEffect, useRef, type RefObject } from 'react';
import type { Map as MapLibre } from 'maplibre-gl';
import { onSocket } from '../../../lib/socket';
import { openDetailAuto } from '../../../lib/stores/detail';
import { usePreview } from '../../../lib/stores/decisions';
import { clearFollowRequest, directorStore, focusIncident, pauseDirector, useDirector } from '../../../lib/stores/director';
import type { MapCanvasHandle } from '../MapCanvas';
import type { MapFocus } from '../useMapFocus';
import { prefersReducedMotion } from '../useMapFocus';
import type { LiveOpsModel } from './useLiveOps';

type LngLat = [number, number];

export type DirectorPhase = 'idle' | 'deciding' | 'dispatched' | 'following' | 'arrived' | 'gone';

/** How long the room sees the arrival before the map pulls back to everything. */
const SETTLE_MS = 18_000;

export interface DirectorOptions {
  live: LiveOpsModel;
  focus: MapFocus;
  mapRef: RefObject<MapCanvasHandle | null>;
  is3D: boolean;
  /** Ride with a response (assignment ref). */
  startChase: (asgRef: string) => void;
  /** Stop riding with anything. */
  releaseChase: () => void;
  /** Frame everything happening. */
  frameAll: () => void;
  chasing: string | null;
}

export function useIncidentDirector(o: DirectorOptions): { phase: DirectorPhase; ref: string | null; paused: boolean } {
  const director = useDirector();
  const preview = usePreview(director.ref);
  const { live } = o;

  // ── Pick up every new incident the moment it exists ────────────────────────
  useEffect(() => onSocket('incident:new', (inc) => {
    if (inc.isResting || inc.state === 'closed') return;
    focusIncident(inc.ref);
    openDetailAuto({ kind: 'incident', ref: inc.ref });
  }), []);

  // ── …and a story already in progress when the screen opens ─────────────────
  const pickedUp = useRef(false);
  useEffect(() => {
    if (pickedUp.current || directorStore.get().ref || !live.at) return;
    pickedUp.current = true;
    // The newest incident that nobody has reached yet: a call still waiting, else a crew
    // still driving to one.
    const waiting = [...live.alerts].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0];
    const driving = [...live.responses].filter((r) => !r.onsceneAt && r.leg === 'scene')
      .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0];
    const ref = waiting?.ref ?? driving?.incidentRef ?? null;
    if (!ref) return;
    focusIncident(ref);
    openDetailAuto({ kind: 'incident', ref });
  }, [live]);

  // ── Where the story is ─────────────────────────────────────────────────────
  const response = director.ref ? live.responses.find((r) => r.incidentRef === director.ref) ?? null : null;
  const alert = director.ref ? live.alerts.find((a) => a.ref === director.ref) ?? null : null;
  const phase: DirectorPhase = !director.ref ? 'idle'
    : !response ? (alert ? 'deciding' : 'gone')
      : response.onsceneAt || response.state === 'onscene' || response.leg === 'hospital' ? 'arrived'
        : response.state === 'enroute' ? 'following'
          : 'dispatched';

  const incidentAt: LngLat | null = response?.incident ?? alert?.position ?? null;
  const candidateAt = (preview?.candidates ?? []).slice(0, 3).map((c) => c.position).filter((p): p is LngLat => !!p);
  const weighing = preview?.status === 'ready' && candidateAt.length > 0;

  // The latest of everything the camera effect needs, without making each a dependency —
  // the effect must fire once per STEP, not every time a vehicle moves a metre.
  const latest = useRef({ o, response, incidentAt, candidateAt });
  useEffect(() => { latest.current = { o, response, incidentAt, candidateAt }; });

  // A person dragging the map takes the camera for this story.
  useEffect(() => {
    let map: MapLibre | undefined;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDrag = (e: { originalEvent?: unknown }) => { if (e.originalEvent) pauseDirector(); };
    const attach = () => {
      map = o.mapRef.current?.map() ?? undefined;
      if (map) { map.on('dragstart', onDrag); return; }
      if (tries++ < 40) timer = setTimeout(attach, 250);
    };
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      map?.off('dragstart', onDrag);
    };
  }, [o.mapRef]);

  // ── The camera, once per step ──────────────────────────────────────────────
  const step = `${director.ref}|${phase}|${phase === 'deciding' ? (weighing ? 'weighing' : 'scene') : ''}|${director.paused}`;
  useEffect(() => {
    if (!director.ref || director.paused) return undefined;
    const { o: opts, response: r, incidentAt: at, candidateAt: cands } = latest.current;
    const map = opts.mapRef.current?.map();
    const pitch = opts.is3D ? 52 : 0;
    const fly = (center: LngLat, zoom: number) => {
      if (!map) return;
      if (prefersReducedMotion()) map.jumpTo({ center, zoom, pitch });
      else map.flyTo({ center, zoom, pitch, duration: 1600, essential: true });
    };

    if (phase === 'deciding' && at) {
      if (opts.chasing) opts.releaseChase();
      if (cands.length) opts.focus.fitTo([at, ...cands], { padding: 120, maxZoom: 15.2 });
      else fly(at, 15.4);
    } else if (phase === 'dispatched' && r) {
      if (opts.chasing) opts.releaseChase();
      opts.focus.fitTo(r.unit ? [r.unit, r.incident] : [r.incident], { padding: 150, maxZoom: 15.6 });
    } else if (phase === 'following' && r) {
      opts.startChase(r.ref);
    } else if (phase === 'arrived' && r) {
      if (opts.chasing) opts.releaseChase();
      fly(r.incident, 16.2);
      const back = setTimeout(() => latest.current.o.frameAll(), SETTLE_MS);
      return () => clearTimeout(back);
    }
    return undefined;
    // `step` is the whole dependency: it changes exactly when the story moves on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── "Follow on map" from a panel ───────────────────────────────────────────
  useEffect(() => {
    const req = director.followRequest;
    if (!req) return;
    // The routes feed (useLiveOps, ~3 s poll) can lag a moment behind a fresh dispatch —
    // the panel's own decision trace often shows the new assignment before `live.responses`
    // has it. Clearing the request on the FIRST check, whether or not it matched, dropped
    // a click made in that window with no sign anything happened. Keep it live and re-check
    // on every routes update instead, for a few seconds, rather than a one-shot look.
    const match = live.responses.some((r) => r.ref === req.asgRef);
    if (match) {
      clearFollowRequest();
      o.startChase(req.asgRef);
    } else if (Date.now() - req.at > 6000) {
      clearFollowRequest();
    }
  }, [director.followRequest, live.responses, o]);

  return { phase, ref: director.ref, paused: director.paused };
}
