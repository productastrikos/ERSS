/**
 * Geometry helpers for the seed.
 *
 * Community boundary geometry is RESTRICTED in Dubai — Dubai Pulse indexes "Community",
 * "Sectors" and "Entrances" datasets but raw GeoJSON/Shapefile download needs
 * governmental API clearance. The seed therefore builds boundaries as generated
 * polygons around real community centroids: approximate at the edges, exact enough for
 * zone-level analytics, and labelled as approximated in the product.
 */

const R_EARTH_M = 6_371_000;

/** Metres per degree of longitude at a given latitude. */
export const mPerDegLng = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
export const M_PER_DEG_LAT = 110_574;

export function haversineM(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

/** Move a point by a distance and bearing. */
export function offset(point, metres, bearingDeg) {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    lng: point.lng + (Math.sin(rad) * metres) / mPerDegLng(point.lat),
    lat: point.lat + (Math.cos(rad) * metres) / M_PER_DEG_LAT,
  };
}

/**
 * An irregular polygon around a centroid — a plausible community shape rather than a
 * circle. `radiusM` is the mean radius; the perimeter wobbles deterministically.
 */
export function blobPolygon(centre, radiusM, rng, { points = 14, wobble = 0.28, aspect = 1 } = {}) {
  const ring = [];
  // A smooth, closed perturbation: two harmonics with random phase, so neighbouring
  // vertices stay correlated and the shape does not look like a spiky star.
  const p1 = rng.float(0, Math.PI * 2);
  const p2 = rng.float(0, Math.PI * 2);
  const a1 = rng.float(0.4, 1) * wobble;
  const a2 = rng.float(0.2, 0.6) * wobble;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const r = radiusM * (1 + a1 * Math.sin(theta * 2 + p1) + a2 * Math.sin(theta * 3 + p2));
    const dx = Math.cos(theta) * r * aspect;
    const dy = Math.sin(theta) * r;
    ring.push([
      centre.lng + dx / mPerDegLng(centre.lat),
      centre.lat + dy / M_PER_DEG_LAT,
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

/** GeoJSON MultiPolygon literal for a PostGIS insert. */
export function multiPolygon(ring) {
  return JSON.stringify({ type: 'MultiPolygon', coordinates: [[ring]] });
}

export function point(lng, lat) {
  return JSON.stringify({ type: 'Point', coordinates: [lng, lat] });
}

export function lineString(coords) {
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

/** A random point inside a circle, uniformly by area (sqrt, not linear). */
export function randomInCircle(centre, radiusM, rng) {
  const r = radiusM * Math.sqrt(rng.next());
  const theta = rng.float(0, Math.PI * 2);
  return {
    lng: centre.lng + (Math.cos(theta) * r) / mPerDegLng(centre.lat),
    lat: centre.lat + (Math.sin(theta) * r) / M_PER_DEG_LAT,
  };
}

/** Clamp to the emirate bounding box so nothing lands in the Gulf or Oman. */
export function clampToBbox(p, bbox) {
  return {
    lng: Math.min(Math.max(p.lng, bbox.minLng), bbox.maxLng),
    lat: Math.min(Math.max(p.lat, bbox.minLat), bbox.maxLat),
  };
}

/**
 * Makani number generation.
 *
 * The real code is a projection of the Dubai Local Transverse Mercator grid: two
 * five-digit blocks corresponding to local Easting and Northing, giving ~1 m² accuracy.
 * The exact proprietary transform is not published, so this reproduces the STRUCTURE
 * and the spatial monotonicity — nearby points get nearby codes — without claiming to
 * be the real projection. Values are seeded, not licensed.
 */
const DLTM_ORIGIN = { lng: 55.0, lat: 24.7 };

export function makaniFor(lng, lat) {
  const easting = Math.round(((lng - DLTM_ORIGIN.lng) * mPerDegLng(lat)) / 10);
  const northing = Math.round(((lat - DLTM_ORIGIN.lat) * M_PER_DEG_LAT) / 10);
  const e = String(Math.abs(easting) % 100000).padStart(5, '0');
  const n = String(Math.abs(northing) % 100000).padStart(5, '0');
  return `${e}${n}`;
}

export const formatMakani = (code) => `${code.slice(0, 5)} ${code.slice(5)}`;
