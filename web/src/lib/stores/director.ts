/**
 * The incident director — which story the live map is following by itself.
 *
 * When a camera raises an incident the map goes to it without being asked: it frames the
 * scene and the ambulances around it while the AI weighs them, frames the chosen crew when
 * the job is sent, rides with it to the scene, and pulls back once it has arrived
 * (shared/map/live/useIncidentDirector.ts). This store is the part of that the rest of the
 * console can see and steer: what is being followed, and whether a person has taken the
 * camera back.
 *
 * A person always wins. Dragging the map, riding with a different crew or framing another
 * row pauses the director for the current story; the next incident, or "Resume", hands the
 * camera back.
 */

import { createStore, useStore } from './createStore';

export interface DirectorState {
  /** The incident being followed, or null before the first one. */
  ref: string | null;
  /** Where it is, from the alert itself — so the map can go there before the live feed has it. */
  at: [number, number] | null;
  /** When it was picked up (ms). */
  since: number;
  /** A person has the camera for this story. */
  paused: boolean;
  /** "Follow this ambulance" from a panel — the map picks it up and rides with it. */
  followRequest: { asgRef: string; at: number } | null;
}

export const directorStore = createStore<DirectorState>({ ref: null, at: null, since: 0, paused: false, followRequest: null });

export function focusIncident(ref: string, at: [number, number] | null = null): void {
  if (directorStore.get().ref === ref) return;
  directorStore.set({ ref, at, since: Date.now(), paused: false });
}

export const pauseDirector = () => { if (!directorStore.get().paused) directorStore.set({ paused: true }); };
export const resumeDirector = () => directorStore.set({ paused: false });

/** A panel's "Follow on map": ride with this crew. It is a person's choice, so the
 *  director stands back for the rest of the story. */
export const requestFollow = (asgRef: string) => directorStore.set({ followRequest: { asgRef, at: Date.now() }, paused: true });
export const clearFollowRequest = () => directorStore.set({ followRequest: null });

/** A PoC restart: the story being followed no longer exists. */
export const resetDirector = () => directorStore.set({ ref: null, at: null, since: 0, paused: false, followRequest: null });

export const useDirector = () => useStore(directorStore);
