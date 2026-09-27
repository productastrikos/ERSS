/**
 * A finished job, reconstructed as something that can be played back.
 *
 * The record of a response is three different things at once: the roads the crew actually
 * drove (`route_taken` to the scene, `route_hospital` on the transport leg), a GPS
 * breadcrumb every couple of seconds, and the stage timestamps. None of them alone is a
 * replay — the routes have no clock, the breadcrumbs cut every corner, and the stages are
 * only five instants.
 *
 * So this puts them together: each breadcrumb is PROJECTED ONTO THE ROAD the crew drove,
 * which turns it into "how far along that road were they at that second". Between two
 * breadcrumbs the vehicle then travels along the road rather than across the block, and
 * the playback runs on the real clock — a 6-minute response takes six minutes at 1×, and
 * exactly one minute at 6×. That is what makes the replay comparable with the live screen
 * rather than a cartoon of it.
 *
 * Where a road was not recorded (an older job, or a leg the simulation never drove), the
 * breadcrumbs are used as they are. The result says which, so the screen can be honest
 * about what it is showing.
 */

import type { ReplayResult } from '../../../lib/types';
import { bearing, metres, pointAt, polyline, project, turn, type LngLat, type Polyline } from '../motion';

export interface TripStage {
  key: string;
  /** i18n key for the label under the scrubber. */
  label: string;
  at: number;
}

export interface Trip {
  /** Wall-clock bounds of the job, in epoch ms. */
  from: number;
  to: number;
  /** One sample per second: position and heading. */
  step: number;
  points: LngLat[];
  headings: number[];
  stages: TripStage[];
  /** The roads, for drawing. */
  proposed: LngLat[] | null;
  driven: LngLat[] | null;
  transport: LngLat[] | null;
  /** True when a leg had to be drawn from breadcrumbs because no road was recorded. */
  fromBreadcrumbs: boolean;
  incident: LngLat;
  hospital: LngLat | null;
  unitRef: string;
  callsign: string;
}

const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null);

/** A road with timed samples along it: [epoch ms, metres travelled]. */
interface TimedLeg {
  line: Polyline;
  marks: Array<[number, number]>;
}

/**
 * Turn breadcrumbs inside a window into distances along the road they were driving.
 * Distances are forced to run forwards: a GPS fix that projects slightly behind the last
 * one would otherwise make the replay twitch backwards.
 */
function timeLeg(line: Polyline, crumbs: Array<{ t: number; at: LngLat }>, from: number, to: number): TimedLeg {
  const marks: Array<[number, number]> = [[from, 0]];
  let last = 0;
  for (const c of crumbs) {
    if (c.t <= from || c.t >= to) continue;
    const p = project(line, c.at, Math.max(0, last - 50), last + 2000);
    // A fix a long way off this road belongs to another part of the job (a detour, or the
    // crew parked): keep the road's own progression rather than snapping to it.
    if (p.off > 120) continue;
    const d = Math.max(last, p.d);
    if (marks.length && c.t <= marks[marks.length - 1][0]) continue;
    marks.push([c.t, d]);
    last = d;
  }
  marks.push([to, line.total]);
  return { line, marks };
}

/** Position at a time inside a timed leg. */
function legAt(leg: TimedLeg, t: number): LngLat {
  const m = leg.marks;
  if (t <= m[0][0]) return pointAt(leg.line, m[0][1]);
  for (let i = 1; i < m.length; i++) {
    if (t <= m[i][0]) {
      const span = m[i][0] - m[i - 1][0] || 1;
      const f = (t - m[i - 1][0]) / span;
      return pointAt(leg.line, m[i - 1][1] + (m[i][1] - m[i - 1][1]) * f);
    }
  }
  return pointAt(leg.line, m[m.length - 1][1]);
}

export function buildTrip(r: ReplayResult): Trip | null {
  const a = r.assignments.find((x) => x.isPrimary) ?? r.assignments[0];
  if (!a) return null;

  const incident: LngLat = [r.incident.lng, r.incident.lat];
  const hospital: LngLat | null = a.hospital ? [a.hospital.lng, a.hospital.lat] : null;
  const crumbs = r.track
    .filter((p) => p.unitRef === a.unitRef)
    .map((p) => ({ t: Date.parse(p.ts), at: [p.lng, p.lat] as LngLat }))
    .sort((x, y) => x.t - y.t);

  const offered = ms(a.offeredAt) ?? ms(r.incident.reportedAt) ?? Date.now();
  const enroute = ms(a.enrouteAt) ?? ms(a.acknowledgedAt) ?? offered;
  const onscene = ms(a.onsceneAt) ?? ms(r.incident.firstOnsceneAt);
  const transporting = ms(a.transportingAt);
  const atHospital = ms(a.atHospitalAt);
  const cleared = ms(a.clearedAt);
  const to = cleared ?? atHospital ?? onscene ?? enroute + 60_000;
  const from = offered;
  if (to <= from) return null;

  let fromBreadcrumbs = false;

  // The two driven legs, each with its own clock.
  const legs: Array<{ from: number; to: number; leg: TimedLeg | null; still: LngLat | null }> = [];
  const crumbLine = (f: number, t: number): Polyline | null => {
    const inside = crumbs.filter((c) => c.t >= f && c.t <= t).map((c) => c.at);
    return inside.length > 1 ? polyline(inside) : null;
  };

  // Waiting to roll: parked wherever the first breadcrumb is.
  const start = crumbs[0]?.at ?? (a.routeTaken?.[0] ?? incident);
  legs.push({ from, to: enroute, leg: null, still: start });

  if (onscene && onscene > enroute) {
    const road = a.routeTaken && a.routeTaken.length > 1 ? polyline(a.routeTaken) : crumbLine(enroute, onscene);
    if (road && !(a.routeTaken && a.routeTaken.length > 1)) fromBreadcrumbs = true;
    legs.push(road
      ? { from: enroute, to: onscene, leg: timeLeg(road, crumbs, enroute, onscene), still: null }
      : { from: enroute, to: onscene, leg: null, still: incident });
  }

  const sceneEnd = transporting ?? to;
  if (onscene && sceneEnd > onscene) legs.push({ from: onscene, to: sceneEnd, leg: null, still: incident });

  if (transporting && atHospital && atHospital > transporting) {
    const road = a.routeHospital && a.routeHospital.length > 1 ? polyline(a.routeHospital) : crumbLine(transporting, atHospital);
    if (road && !(a.routeHospital && a.routeHospital.length > 1)) fromBreadcrumbs = true;
    legs.push(road
      ? { from: transporting, to: atHospital, leg: timeLeg(road, crumbs, transporting, atHospital), still: null }
      : { from: transporting, to: atHospital, leg: null, still: hospital ?? incident });
  }
  if (atHospital && to > atHospital) legs.push({ from: atHospital, to, leg: null, still: hospital ?? incident });

  // One sample a second — enough to interpolate smoothly, small enough for an hour-long job.
  const step = 1000;
  const count = Math.min(7200, Math.ceil((to - from) / step) + 1);
  const points: LngLat[] = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    const t = from + i * step;
    const active = legs.find((l) => t >= l.from && t <= l.to) ?? legs[legs.length - 1];
    cursor = active.leg ? legAt(active.leg, t) : active.still ?? cursor;
    points.push(cursor);
  }

  // Headings from the track itself, smoothed the way a vehicle turns rather than a cursor.
  const headings: number[] = [];
  let held: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const ahead = points[Math.min(points.length - 1, i + 3)];
    const raw = metres(points[i], ahead) > 3 ? bearing(points[i], ahead) : null;
    if (raw != null) held = held == null ? raw : (held + turn(held, raw) * 0.35 + 360) % 360;
    headings.push(held ?? 0);
  }

  const stages: TripStage[] = [
    { key: 'dispatched', label: 'replay.stage.dispatched', at: offered },
    { key: 'enroute', label: 'replay.stage.enroute', at: enroute },
    ...(onscene ? [{ key: 'onscene', label: 'replay.stage.onscene', at: onscene }] : []),
    ...(transporting ? [{ key: 'transporting', label: 'replay.stage.transporting', at: transporting }] : []),
    ...(atHospital ? [{ key: 'atHospital', label: 'replay.stage.atHospital', at: atHospital }] : []),
  ].filter((s) => s.at >= from && s.at <= to);

  return {
    from, to, step, points, headings, stages,
    proposed: a.routeProposed ?? null,
    driven: a.routeTaken ?? null,
    transport: a.routeHospital ?? null,
    fromBreadcrumbs,
    incident,
    hospital,
    unitRef: a.unitRef,
    callsign: a.callsign,
  };
}

/** Where the vehicle was at `t` (epoch ms), interpolated between samples. */
export function tripAt(trip: Trip, t: number): { at: LngLat; heading: number | null; index: number } {
  const raw = (Math.min(trip.to, Math.max(trip.from, t)) - trip.from) / trip.step;
  const i = Math.min(trip.points.length - 1, Math.floor(raw));
  const j = Math.min(trip.points.length - 1, i + 1);
  const f = raw - i;
  const a = trip.points[i];
  const b = trip.points[j];
  return {
    at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    heading: trip.headings[i] ?? null,
    index: i,
  };
}

/**
 * The playback clock.
 *
 * Mutable and read from the animation frame rather than held in React state: the vehicle's
 * position has to be computed for the frame it is drawn in, and pushing a cursor through
 * React sixty times a second would re-render the whole page to move one marker. The UI
 * reads it a few times a second for the scrubber.
 */
export class PlaybackClock {
  playing = false;
  speed = 1;
  /** Trip time (epoch ms) at the last anchor. */
  private cursor = 0;
  private anchor = 0;
  private range: [number, number] = [0, 1];

  load(trip: Trip | null): void {
    this.range = trip ? [trip.from, trip.to] : [0, 1];
    this.cursor = this.range[0];
    this.playing = false;
    this.anchor = performance.now();
  }

  at(now: number): number {
    if (!this.playing) return this.cursor;
    const t = this.cursor + (now - this.anchor) * this.speed;
    return Math.min(this.range[1], t);
  }

  /** 0–1 through the job. */
  progress(now: number): number {
    const span = this.range[1] - this.range[0] || 1;
    return (this.at(now) - this.range[0]) / span;
  }

  ended(now: number): boolean {
    return this.at(now) >= this.range[1];
  }

  play(): void {
    if (this.ended(performance.now())) this.seekProgress(0);
    this.cursor = this.at(performance.now());
    this.anchor = performance.now();
    this.playing = true;
  }

  pause(): void {
    this.cursor = this.at(performance.now());
    this.anchor = performance.now();
    this.playing = false;
  }

  setSpeed(speed: number): void {
    this.cursor = this.at(performance.now());
    this.anchor = performance.now();
    this.speed = speed;
  }

  seek(t: number): void {
    this.cursor = Math.min(this.range[1], Math.max(this.range[0], t));
    this.anchor = performance.now();
  }

  seekProgress(p: number): void {
    this.seek(this.range[0] + (this.range[1] - this.range[0]) * p);
  }
}
