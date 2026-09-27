/**
 * Demo drive — the phone drives its own ambulance along the real road route.
 *
 * The JBVNL pattern (jbvnl_app_context.md §13.3): a demonstration moves the device through
 * the SAME position pipeline a real GPS fix uses (socket `unit:position` →
 * services/positions.js), so the console map, the citizen's tracking screen and the
 * on-scene stamp all see an ordinary moving ambulance. Nothing downstream knows it is a
 * demo, which is what makes it a fair test.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { reportPosition } from '../../lib/socket';

type LngLat = [number, number];

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function pathLength(path: LngLat[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversine(path[i - 1], path[i]);
  return m;
}

/** Where a vehicle is after `travelled` metres along the path, and which way it faces. */
function pointAlong(path: LngLat[], cum: number[], travelled: number): { at: LngLat; heading: number } {
  if (travelled <= 0) return { at: path[0], heading: bearing(path[0], path[1] ?? path[0]) };
  let i = 1;
  while (i < cum.length && cum[i] < travelled) i++;
  if (i >= cum.length) return { at: path[path.length - 1], heading: bearing(path[path.length - 2] ?? path[0], path[path.length - 1]) };
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (travelled - cum[i - 1]) / seg;
  const a = path[i - 1];
  const b = path[i];
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
}

export interface DriveState {
  running: boolean;
  /** 'scene' or 'hospital' — which leg is being driven. */
  leg: string | null;
  at: LngLat | null;
  heading: number | null;
  remainingM: number;
  totalM: number;
  /** The road still ahead, for the map. */
  ahead: LngLat[] | null;
  arrived: boolean;
}

const IDLE: DriveState = { running: false, leg: null, at: null, heading: null, remainingM: 0, totalM: 0, ahead: null, arrived: false };

/** An ambulance on blue lights in Dubai traffic averages roughly 50 km/h door to door. */
export const DRIVE_SPEED_MPS = 14;

export function useDemoDrive() {
  const [state, setState] = useState<DriveState>(IDLE);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  const start = useCallback((path: LngLat[], leg: string, speedFactor: number, onArrive?: () => void) => {
    if (timer.current) clearInterval(timer.current);
    if (path.length < 2) return;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
    const total = cum[cum.length - 1];
    let travelled = 0;
    let last = Date.now();

    const step = () => {
      const now = Date.now();
      const dt = Math.min(3, (now - last) / 1000);
      last = now;
      // A little variation, so the speed trace looks like driving and not a conveyor belt.
      const speed = DRIVE_SPEED_MPS * speedFactor * (0.85 + Math.random() * 0.3);
      travelled = Math.min(total, travelled + speed * dt);
      const { at, heading } = pointAlong(path, cum, travelled);
      const arrived = travelled >= total;
      // Speed travels in km/h, as every position source reports it.
      reportPosition({ lng: at[0], lat: at[1], speed: arrived ? 0 : Math.round(speed * 3.6), heading });

      let i = 1;
      while (i < cum.length && cum[i] <= travelled) i++;
      setState({
        running: !arrived, leg, at, heading, remainingM: Math.max(0, total - travelled), totalM: total,
        ahead: arrived ? null : [at, ...path.slice(i)], arrived,
      });
      if (arrived) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        onArrive?.();
      }
    };
    setState({ ...IDLE, running: true, leg, at: path[0], heading: bearing(path[0], path[1]), remainingM: total, totalM: total, ahead: path });
    reportPosition({ lng: path[0][0], lat: path[0][1], speed: 0, heading: bearing(path[0], path[1]) });
    timer.current = setInterval(step, 1000);
  }, []);

  const reset = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setState(IDLE);
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return { drive: state, start, stop, reset };
}
