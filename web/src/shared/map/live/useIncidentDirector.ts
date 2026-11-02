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
 *   arrived      on scene: let go and settle over the scene while the crew works
 *   transporting the patient is aboard and the crew leaves for hospital: ride with it
 *                again, all the way to the ambulance bay — and take the camera back to do
 *                it even if a person had it, because this is the second half of the story
 *   handover     at hospital: settle over the hospital, then pull back to the whole
 *                picture — ready for the next one
 *
 * Every step reads the live model (useLiveOps) and the AI's preview (decision:update);
 * the camera moves once per step, not on every poll. A person always wins: dragging the
 * map pauses the director for this story (lib/stores/director.ts), and the panel keeps
 * telling it.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map as MapLibre } from 'maplibre-gl';
import { onSocket } from '../../../lib/socket';
import { openDetailAuto } from '../../../lib/stores/detail';
import { usePreview } from '../../../lib/stores/decisions';
import { clearFollowRequest, directorStore, focusIncident, pauseDirector, resumeDirector, useDirector } from '../../../lib/stores/director';
import type { MapCanvasHandle } from '../MapCanvas';
import type { MapFocus } from '../useMapFocus';
import { prefersReducedMotion } from '../useMapFocus';
import { occlusion } from '../occlusion';
import type { LiveOpsModel } from './useLiveOps';

type LngLat = [number, number];

export type DirectorPhase = 'idle' | 'deciding' | 'dispatched' | 'following' | 'arrived' | 'transporting' | 'handover' | 'gone';

/** How long the room sees the arrival before the map pulls back to everything. */
const SETTLE_MS = 18_000;
/**
 * How long the map holds close on the scene when an alert lands, before it widens to show
 * the ambulances the AI is weighing. The AI's preview is ready within a second or two, and
 * framing the candidates straight away meant the zoom to the incident was never seen.
 */
const SCENE_DWELL_MS = 6_000;
const SCENE_ZOOM = 16;

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
  // With its own position, so the map goes there now rather than on the next poll.
  useEffect(() => onSocket('incident:new', (inc) => {
    if (inc.isResting || inc.state === 'closed') return;
    focusIncident(inc.ref, inc.lng != null && inc.lat != null ? [inc.lng, inc.lat] : null);
    openDetailAuto({ kind: 'incident', ref: inc.ref });
  }), []);

  // The close-up on the scene is held for a beat before the AI's candidates are framed.
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const ref = director.ref;
    if (!ref) return undefined;
    const id = window.setTimeout(() => setSettled(ref), SCENE_DWELL_MS);
    return () => window.clearTimeout(id);
  }, [director.ref]);

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
    // …else any response still running (on scene, to hospital, handing over): opened
    // mid-story, the screen should still tell the rest of it — and ride to hospital.
    const running = [...live.responses].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))[0];
    const ref = waiting?.ref ?? driving?.incidentRef ?? running?.incidentRef ?? null;
    if (!ref) return;
    focusIncident(ref);
    openDetailAuto({ kind: 'incident', ref });
  }, [live]);

  // ── Where the story is ─────────────────────────────────────────────────────
  const response = director.ref ? live.responses.find((r) => r.incidentRef === director.ref) ?? null : null;
  const alert = director.ref ? live.alerts.find((a) => a.ref === director.ref) ?? null : null;
  const phase: DirectorPhase = !director.ref ? 'idle'
    : !response ? (alert || director.at ? 'deciding' : 'gone')
      : response.leg === 'hospital' || response.state === 'transporting' ? 'transporting'
        : response.state === 'at_hospital' ? 'handover'
          : response.onsceneAt || response.state === 'onscene' ? 'arrived'
            : response.state === 'enroute' ? 'following'
              : 'dispatched';

  // The crew leaving for hospital is the second half of the story: the map rides with it
  // again by itself, even if a person took the camera during the scene.
  const transportKey = phase === 'transporting' ? `${director.ref}|transport` : null;
  useEffect(() => {
    if (transportKey && directorStore.get().paused) resumeDirector();
  }, [transportKey]);

  const incidentAt: LngLat | null = response?.incident ?? alert?.position ?? director.at ?? null;
  const candidateAt = (preview?.candidates ?? []).slice(0, 3).map((c) => c.position).filter((p): p is LngLat => !!p);
  const weighing = preview?.status === 'ready' && candidateAt.length > 0 && settled === director.ref;

  // The latest of everything the camera effect needs, without making each a dependency —
  // the effect must fire once per STEP, not every time a vehicle moves a metre.
  const latest = useRef({ o, response, incidentAt, candidateAt });
  useEffect(() => { latest.current = { o, response, incidentAt, candidateAt }; });

  // ── …and a camera alert before the incident even exists ────────────────────
  // The five-stage detection raises its alert before it creates the incident; the room's
  // eyes go to the alert, so the map goes to where the camera is looking at the same moment.
  const seenDetections = useRef(new Set<string>());
  useEffect(() => onSocket('detection:stage', (d) => {
    if (!d?.id || !d.place || seenDetections.current.has(d.id)) return;
    seenDetections.current.add(d.id);
    const { o: opts } = latest.current;
    const map = opts.mapRef.current?.map();
    if (!map) return;
    if (opts.chasing) opts.releaseChase();
    const center: LngLat = [d.place.lng, d.place.lat];
    const padding = occlusion(map);
    if (prefersReducedMotion()) map.jumpTo({ center, zoom: SCENE_ZOOM, pitch: opts.is3D ? 52 : 0, padding });
    else map.flyTo({ center, zoom: SCENE_ZOOM, pitch: opts.is3D ? 52 : 0, padding, duration: 1800, essential: true });
  }), []);

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
      const padding = occlusion(map);   // centre it in what is visible, not under the drawer
      if (prefersReducedMotion()) map.jumpTo({ center, zoom, pitch, padding });
      else map.flyTo({ center, zoom, pitch, padding, duration: 1600, essential: true });
    };

    if (phase === 'deciding' && at) {
      if (opts.chasing) opts.releaseChase();
      if (weighing && cands.length) opts.focus.fitTo([at, ...cands], { padding: 120, maxZoom: 15.2 });
      else fly(at, SCENE_ZOOM);
    } else if (phase === 'dispatched' && r) {
      if (opts.chasing) opts.releaseChase();
      opts.focus.fitTo(r.unit ? [r.unit, r.incident] : [r.incident], { padding: 150, maxZoom: 15.6 });
    } else if (phase === 'following' && r) {
      opts.startChase(r.ref);
    } else if (phase === 'arrived' && r) {
      if (opts.chasing) opts.releaseChase();
      fly(r.incident, 16.2);
    } else if (phase === 'transporting' && r) {
      // Ride with the ambulance to the hospital. The routes feed can lag the state change
      // by a poll, so the chase is started on the response that is ON the hospital leg.
      opts.startChase(r.ref);
    } else if (phase === 'handover' && r) {
      if (opts.chasing) opts.releaseChase();
      fly(r.hospital?.position ?? r.unit ?? r.incident, 16.2);
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
