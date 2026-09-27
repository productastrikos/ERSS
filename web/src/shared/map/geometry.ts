/**
 * Small, dependency-free geometry for layer modules and feeds. Planar approximations,
 * accurate to well under 1% at the scale of an emirate — the map needs placement, not
 * survey-grade distance.
 */

export type LngLat = [number, number];

const M_PER_DEG = 111_320;

/** Approximate ground distance in metres. */
export function metres(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * M_PER_DEG;
  const dLng = (b[0] - a[0]) * M_PER_DEG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** A closed ring approximating a circle on the ground. */
export function circle(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const [lng, lat] = center;
  const dLat = radiusM / M_PER_DEG;
  const dLng = radiusM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  return ring;
}

/**
 * The point a fraction of the way along a path, by distance, with the heading of the
 * segment it falls on. Replaces DSOMap's index-stepping animation, which moved a marker
 * by vertex count and so sped up wherever OSRM happened to emit dense geometry.
 */
export function along(path: LngLat[], fraction: number): { at: LngLat; heading: number } | null {
  if (!path.length) return null;
  if (path.length === 1) return { at: path[0], heading: 0 };

  const lengths = path.slice(1).map((p, i) => metres(path[i], p));
  const total = lengths.reduce((s, x) => s + x, 0);
  let target = Math.min(1, Math.max(0, fraction)) * total;

  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.min(1, target / lengths[i]) : 0;
      const [a, b] = [path[i], path[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
    }
    target -= lengths[i];
  }
  return { at: path[path.length - 1], heading: 0 };
}

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * The remaining part of a route from a vehicle's current position — the nearest vertex
 * onward, prefixed with the position itself. Moved from DSOMap.tsx (`trimRoute`).
 */
export function remaining(path: LngLat[], from: LngLat): LngLat[] {
  if (path.length < 2) return path;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = (path[i][0] - from[0]) ** 2 + (path[i][1] - from[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return [from, ...path.slice(best + 1)];
}
