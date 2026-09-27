/**
 * Vehicle motion — where an ambulance IS between two position fixes.
 *
 * The feed says where a vehicle was, about once a second, and the road ahead of it every
 * few seconds. Drawing it at the last fix makes it hop from fix to fix and sit still in
 * between — and a chase camera bolted to a hopping vehicle lurches, stops, lurches. That
 * was the "the ambulance doesn't move when I follow it" report: between fixes, nothing
 * on the screen moved at all.
 *
 * So the vehicle is DEAD-RECKONED along its own road at its own reported speed, frame by
 * frame, and each fix CORRECTS that estimate rather than replacing it:
 *
 *     target  = where the last fix put it + speed × time since that fix
 *     shown  += speed × dt                      (it keeps driving at its real speed)
 *     shown  += (target − shown) × (1 − e^(−dt/τ))   (and eases onto the truth)
 *
 * Three rules keep that honest rather than decorative:
 *   - It moves ALONG THE ROUTE, never across a block — the path is the one the server is
 *     steering the crew down, so an interpolated point is always on a real road.
 *   - It never reverses. A fix that lands slightly behind the estimate slows the vehicle
 *     until the truth catches up; it does not drag it backwards.
 *   - It never runs away. With no fix for EXTRAPOLATE_S the estimate stops where it is — a
 *     stalled feed shows a stopped vehicle, not one confidently driving on without data.
 *
 * Nothing here is React. The layer and the camera both sample it inside the animation
 * frame, so the vehicle and the camera following it are computed for the same instant
 * and cannot drift apart.
 */

export type LngLat = [number, number];

// ── Geometry on a polyline ───────────────────────────────────────────────────

const M_PER_DEG = 111_320;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points — equirectangular, exact to well under 0.1% at city scale. */
export function metres(a: LngLat, b: LngLat): number {
  const x = (b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2));
  const y = b[1] - a[1];
  return Math.sqrt(x * x + y * y) * M_PER_DEG;
}

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearing(a: LngLat, b: LngLat): number {
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1]))
    - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, in degrees (−180, 180]. */
export const turn = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

export interface Polyline {
  pts: LngLat[];
  /** Cumulative metres at each vertex; cum[0] = 0. */
  cum: number[];
  total: number;
}

export function polyline(pts: LngLat[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Index of the segment containing distance d (the segment runs pts[i-1] → pts[i]). */
function segmentAt(line: Polyline, d: number): number {
  let lo = 1;
  let hi = line.pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function pointAt(line: Polyline, d: number): LngLat {
  if (line.pts.length === 1) return line.pts[0];
  const dist = Math.min(line.total, Math.max(0, d));
  const i = segmentAt(line, dist);
  const a = line.pts[i - 1];
  const b = line.pts[i];
  const seg = line.cum[i] - line.cum[i - 1] || 1;
  const f = (dist - line.cum[i - 1]) / seg;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * The direction of travel at distance d, read over a short stretch of road rather than
 * one segment — OSRM geometry has vertices a metre apart at junctions, and a heading taken
 * from one of those spins the vehicle like a weathervane.
 */
export function headingAt(line: Polyline, d: number, back = 5, ahead = 14): number | null {
  if (line.total < 1) return null;
  const a = pointAt(line, d - back);
  const b = pointAt(line, d + ahead);
  return metres(a, b) < 0.5 ? null : bearing(a, b);
}

/** The road from distance d to the end, starting exactly at d. */
export function sliceFrom(line: Polyline, d: number): LngLat[] {
  if (line.pts.length < 2) return line.pts;
  const dist = Math.min(line.total, Math.max(0, d));
  const i = segmentAt(line, dist);
  return [pointAt(line, dist), ...line.pts.slice(i)];
}

/** The road from the start up to distance d. */
export function sliceTo(line: Polyline, d: number): LngLat[] {
  if (line.pts.length < 2) return line.pts;
  const dist = Math.min(line.total, Math.max(0, d));
  const i = segmentAt(line, dist);
  return [...line.pts.slice(0, i), pointAt(line, dist)];
}

/**
 * Where along the line a point sits: the distance of its nearest point on the line, and
 * how far off the line it is. Searched only within [from, to] so a route that doubles back
 * on itself does not snap a vehicle onto the opposite carriageway.
 */
export function project(line: Polyline, p: LngLat, from = 0, to = Infinity): { d: number; off: number } {
  if (line.pts.length < 2) return { d: 0, off: line.pts.length ? metres(line.pts[0], p) : Infinity };
  const lo = Math.max(1, segmentAt(line, Math.max(0, from)));
  const hi = Math.min(line.pts.length - 1, segmentAt(line, Math.min(line.total, to)));
  const kx = Math.cos(toRad(p[1])) * M_PER_DEG;
  let best = { d: 0, off: Infinity };
  for (let i = lo; i <= hi; i++) {
    const a = line.pts[i - 1];
    const b = line.pts[i];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * M_PER_DEG;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * M_PER_DEG;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + dx * t, cy = ay + dy * t;
    const off = Math.sqrt(cx * cx + cy * cy);
    if (off < best.off) best = { d: line.cum[i - 1] + (line.cum[i] - line.cum[i - 1]) * t, off };
  }
  return best;
}

// ── The motion model ─────────────────────────────────────────────────────────

/** Stop dead-reckoning this long after the last fix: a stalled feed shows a stopped vehicle. */
const EXTRAPOLATE_S = 2.6;
/** How hard a fix pulls the estimate (0 ignores fixes, 1 snaps to them). */
const FIX_GAIN = 0.4;
/** Time constant of the visual correction onto the estimate. */
const EASE_S = 0.45;
/** Time constant of the heading, so a corner is a sweep rather than a snap. */
const TURN_S = 0.3;
/** A fix this far off the line means the crew has left the route — trust the fix. */
const OFF_ROUTE_M = 70;
/** A jump this large is a new situation, not an error to be eased away. */
const SNAP_M = 350;

interface Track {
  line: Polyline | null;
  /** The estimate: distance along `line` at `anchorT`, travelling at `speed` m/s. */
  anchorD: number;
  anchorT: number;
  speed: number;
  /** Speed from the feed (km/h → m/s), or null when only positions arrive. */
  reportedSpeed: number | null;
  /** The previous fix, for estimating speed when the feed does not report one. */
  lastFix: { d: number; t: number } | null;
  /** What is on screen. */
  shownD: number;
  shownAt: LngLat;
  heading: number | null;
  frameT: number;
  /** Off-route or route-less vehicles glide towards their latest fix instead. */
  targetAt: LngLat;
}

export interface MotionSample {
  at: LngLat;
  /** Compass heading, smoothed; null until the vehicle has shown a direction. */
  heading: number | null;
  /** The road still ahead, starting exactly at `at` — null when there is no route. */
  ahead: LngLat[] | null;
  /** Metres per second the estimate is travelling at. */
  speed: number;
}

export class VehicleMotion {
  private readonly tracks = new Map<string, Track>();

  private track(key: string, at: LngLat, now: number): Track {
    let t = this.tracks.get(key);
    if (!t) {
      t = {
        line: null, anchorD: 0, anchorT: now, speed: 0, reportedSpeed: null, lastFix: null,
        shownD: 0, shownAt: at, heading: null, frameT: now, targetAt: at,
      };
      this.tracks.set(key, t);
    }
    return t;
  }

  /**
   * The road ahead, as the server has just re-planned it. `path[0]` is where the vehicle
   * was when the server answered.
   *
   * The server re-sends the SAME road, trimmed, every few seconds. Replacing the line each
   * time would restart every distance at zero and make the vehicle stutter at each poll,
   * so a path that ends where the current one ends and starts on it is read as a fix on
   * the line already held. Only a genuinely new road (a new leg, a re-route) replaces it.
   */
  route(key: string, path: LngLat[] | null, now: number): void {
    if (!path || path.length < 2) {
      const t = this.tracks.get(key);
      if (t) t.line = null;
      return;
    }
    const t = this.track(key, path[0], now);
    const end = path[path.length - 1];

    if (t.line) {
      const heldEnd = t.line.pts[t.line.pts.length - 1];
      const on = project(t.line, path[0]);
      if (metres(heldEnd, end) < 25 && on.off < 30) {
        this.correct(t, on.d, now);
        return;
      }
    }

    const line = polyline(path);
    // Carry what is on screen across onto the new road, so a re-route bends the vehicle's
    // course instead of teleporting it back to the first vertex.
    const carried = project(line, t.shownAt, 0, 500);
    t.line = line;
    t.shownD = carried.off < 60 ? carried.d : 0;
    if (carried.off >= 60) t.shownAt = path[0];
    t.anchorD = Math.max(0, Math.min(t.shownD, line.total));
    t.anchorT = now;
    t.lastFix = { d: t.anchorD, t: now };
    t.speed = t.reportedSpeed ?? t.speed;
  }

  /** A position fix from the feed. `speedKmh` is what the vehicle reports, when it does. */
  fix(key: string, at: LngLat, speedKmh: number | null, now: number): void {
    const t = this.track(key, at, now);
    if (speedKmh != null && Number.isFinite(speedKmh)) {
      t.reportedSpeed = speedKmh < 2 ? 0 : speedKmh / 3.6;
      t.speed = t.reportedSpeed;
    }
    t.targetAt = at;
    if (!t.line) return;

    const predicted = this.estimate(t, now);
    const on = project(t.line, at, predicted - 200, predicted + 500);
    if (on.off > OFF_ROUTE_M) {
      // Left the planned road. Drop it and glide to the fixes until the server re-plans.
      t.line = null;
      return;
    }
    this.correct(t, on.d, now);
  }

  private correct(t: Track, dFix: number, now: number): void {
    if (t.reportedSpeed == null && t.lastFix && now - t.lastFix.t > 300) {
      // No speed on the feed: infer it from how far the fixes moved along the road.
      const observed = Math.max(0, (dFix - t.lastFix.d) / ((now - t.lastFix.t) / 1000));
      t.speed = t.speed ? t.speed * 0.6 + observed * 0.4 : observed;
    }
    t.lastFix = { d: dFix, t: now };
    const predicted = this.estimate(t, now);
    const residual = dFix - predicted;
    t.anchorD = Math.abs(residual) > SNAP_M ? dFix : predicted + FIX_GAIN * residual;
    t.anchorT = now;
    if (Math.abs(residual) > SNAP_M) t.shownD = dFix;
  }

  private estimate(t: Track, now: number): number {
    const dt = Math.min(EXTRAPOLATE_S, Math.max(0, (now - t.anchorT) / 1000));
    return Math.min(t.line?.total ?? 0, t.anchorD + t.speed * dt);
  }

  /** Where the vehicle is at `now`, advancing the on-screen state to that instant. */
  sample(key: string, now: number): MotionSample | null {
    const t = this.tracks.get(key);
    if (!t) return null;
    const dt = Math.min(0.25, Math.max(0, (now - t.frameT) / 1000));
    t.frameT = now;
    const ease = 1 - Math.exp(-dt / EASE_S);
    let raw: number | null = null;

    if (t.line) {
      const target = this.estimate(t, now);
      // Keep driving at speed while the estimate is still ahead, then ease onto it — and
      // never backwards. Stalled (past EXTRAPOLATE_S) means the estimate stops, so the
      // speed term must stop with it.
      const live = (now - t.anchorT) / 1000 < EXTRAPOLATE_S;
      let next = t.shownD + (live && target > t.shownD ? t.speed * dt : 0);
      next += (target - next) * ease;
      t.shownD = Math.min(t.line.total, Math.max(t.shownD, next));
      t.shownAt = pointAt(t.line, t.shownD);
      raw = headingAt(t.line, t.shownD);
    } else {
      const prev = t.shownAt;
      t.shownAt = [
        prev[0] + (t.targetAt[0] - prev[0]) * ease,
        prev[1] + (t.targetAt[1] - prev[1]) * ease,
      ];
      if (metres(prev, t.targetAt) > 2) raw = bearing(prev, t.targetAt);
    }

    if (raw != null) {
      t.heading = t.heading == null ? raw : (t.heading + turn(t.heading, raw) * (1 - Math.exp(-dt / TURN_S)) + 360) % 360;
    }
    return {
      at: t.shownAt,
      heading: t.heading,
      ahead: t.line ? sliceFrom(t.line, t.shownD) : null,
      speed: t.line ? t.speed : 0,
    };
  }

  /** Forget every vehicle not in `keys` — its job has ended. */
  retain(keys: ReadonlySet<string>): void {
    for (const k of this.tracks.keys()) if (!keys.has(k)) this.tracks.delete(k);
  }

  has(key: string): boolean {
    return this.tracks.has(key);
  }

  /** Metres per second the vehicle is being driven at, without advancing anything. */
  speedOf(key: string): number | null {
    const t = this.tracks.get(key);
    return t ? (t.line ? t.speed : 0) : null;
  }
}
