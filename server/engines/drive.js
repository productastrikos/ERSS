/**
 * drive — how an ambulance actually covers a road route. PURE.
 *
 * A route is not a distance divided by a speed. A loaded box ambulance under lights holds
 * a cruise speed set by the class of road it is on, brakes to a corner speed for every
 * turn, roundabout and U-turn, and takes time to get back up to speed afterwards — and a
 * crew will not throw a patient (or a colleague in the back) around to save two seconds.
 * That is why a route with eleven manoeuvres through a residential grid loses to a route
 * 300 m longer on an arterial road, and it is exactly the judgement an experienced
 * dispatcher or driver makes without thinking about it.
 *
 * This engine makes that judgement explicit. Given a road route (OSRM geometry, and when
 * available its manoeuvres and per-segment free-flow speeds) it builds a SPEED PROFILE —
 * the speed the vehicle can hold at every 10 m — from three limits:
 *
 *   cruise      by road class: motorway, arterial, local (from OSRM's free-flow speed)
 *   corners     each manoeuvre caps the speed through it (U-turn 14, sharp 18, turn 24,
 *               roundabout 26, slight 45, ramp 55 km/h); bends in the geometry count too
 *   physics     acceleration ≤ 1.4 m/s², braking ≤ 2.6 m/s², from rest at the station
 *
 * and, optionally, a fourth: congested stretches (sim/traffic.js) cap the speed inside
 * them. The time to drive the route is the integral of that profile. The SAME profile is
 * what the simulation drives (sim/live.js), so the arrival the AI predicts is the arrival
 * the crew makes — and the speed the map shows dropping at a roundabout is the braking
 * the model said would happen there.
 *
 * Every number the AI quotes when it explains a route choice (manoeuvres, share on major
 * roads, time lost to braking, average speed) comes out of this file.
 */

export const SAMPLE_M = 10;
/** m/s² — a laden box ambulance pulling away under lights. */
export const ACCEL = 1.4;
/** m/s² — firm, controlled braking; a crew does not brake hard with a patient aboard. */
export const DECEL = 2.6;

/** Emergency cruise ceilings by road class, km/h (lights and siren, Dubai road design). */
export const CRUISE_KMH = { motorway: 100, arterial: 72, local: 42 };
/** Corner speeds, km/h — the most a box body can carry through each manoeuvre. */
export const CORNER_KMH = { uturn: 14, sharp: 18, endofroad: 20, turn: 24, roundabout: 26, exitroundabout: 32, slight: 45, ramp: 55, junction: 50 };
/** A drive back to station is not on lights: everything is a fifth slower. */
const RETURN_FACTOR = 0.8;
/** Pulling up at the scene or the ambulance bay. */
const ARRIVE_MPS = 3;

const kmh = (mps) => mps * 3.6;
const mps = (k) => k / 3.6;

const R = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;
export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function bearing(a, b) {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const turnAngle = (h1, h2) => { const d = Math.abs(h2 - h1) % 360; return d > 180 ? 360 - d : d; };

function cumulative(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return cum;
}

function pointAt(coords, cum, d) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Road class from OSRM's free-flow speed for a segment, km/h. */
export function classOf(freeKmh) {
  if (freeKmh == null) return 'arterial';
  if (freeKmh >= 70) return 'motorway';
  if (freeKmh >= 38) return 'arterial';
  return 'local';
}

/** The corner a manoeuvre forces, or null for one that does not slow the vehicle. */
function cornerOf(step) {
  const type = step.type ?? '';
  const mod = step.modifier ?? '';
  if (type === 'depart' || type === 'arrive' || type === 'new name') return null;
  if (mod === 'uturn') return 'uturn';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
  if (type === 'exit roundabout' || type === 'exit rotary') return 'exitroundabout';
  if (type === 'end of road') return mod.startsWith('sharp') ? 'sharp' : 'endofroad';
  if (type === 'on ramp' || type === 'off ramp' || type === 'merge') return 'ramp';
  if (mod.startsWith('sharp')) return 'sharp';
  if (mod === 'left' || mod === 'right') return 'turn';
  if (mod.startsWith('slight')) return type === 'fork' ? 'ramp' : 'slight';
  if (mod === 'straight' && (type === 'turn' || type === 'continue')) return 'junction';
  return null;
}

/** A bend in the geometry itself, measured over ±20 m — catches what the steps do not name. */
function geometryCorners(coords, cum) {
  const out = [];
  const total = cum[cum.length - 1];
  for (let d = 20; d < total - 20; d += SAMPLE_M) {
    const a = pointAt(coords, cum, d - 20);
    const m = pointAt(coords, cum, d);
    const b = pointAt(coords, cum, d + 20);
    if (haversine(a, m) < 5 || haversine(m, b) < 5) continue;
    const ang = turnAngle(bearing(a, m), bearing(m, b));
    if (ang < 28) continue;
    // A U-turn through a gap in the central reserve is tight but spread over the width of
    // the reserve: over ±20 m it reads as a sharp turn. Over ±40 m the vehicle is plainly
    // heading back the way it came.
    const a2 = pointAt(coords, cum, Math.max(0, d - 40));
    const b2 = pointAt(coords, cum, Math.min(total, d + 40));
    const wide = haversine(a2, m) > 5 && haversine(m, b2) > 5 ? turnAngle(bearing(a2, m), bearing(m, b2)) : 0;
    const kind = ang >= 150 || wide >= 150 ? 'uturn' : ang >= 100 ? 'sharp' : ang >= 60 ? 'turn' : 'slight';
    out.push({ atM: d, kind, angle: Math.round(Math.max(ang, wide)), name: null, source: 'geometry' });
  }
  // A curve is several samples in a row; keep the tightest of each run.
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && c.atM - last.atM <= 30) {
      if (CORNER_KMH[c.kind] < CORNER_KMH[last.kind]) merged[merged.length - 1] = c;
      continue;
    }
    merged.push(c);
  }
  return merged;
}

/** Where along the route a manoeuvre's location falls, searching forward from `fromIdx`. */
function locate(coords, cum, loc, fromIdx) {
  let best = fromIdx;
  let bestD = Infinity;
  for (let i = fromIdx; i < coords.length; i++) {
    const d = haversine(coords[i], loc);
    if (d < bestD) { bestD = d; best = i; }
    if (bestD < 3 && d > 60) break;
  }
  return { idx: best, atM: cum[best] };
}

/**
 * Analyse a route.
 * @param {{ coords: Array<[number, number]>, steps?: Array<{ type: string, modifier?: string, name?: string, location: [number, number], distance?: number }>, speeds?: number[] }} route
 *   `speeds` — OSRM annotation, m/s per segment (coords.length − 1)
 * @param {{ mode?: 'emergency'|'return', fromRest?: boolean }} [opts]
 */
export function analyse(route, { mode = 'emergency', fromRest = true } = {}) {
  const coords = route.coords;
  if (!coords || coords.length < 2) return null;
  const cum = cumulative(coords);
  const totalM = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(totalM / SAMPLE_M) + 1);
  const at = (i) => Math.min(totalM, i * SAMPLE_M);

  // ── Road class and cruise, per sample ─────────────────────────────────────
  const segClass = [];
  const segFree = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const free = route.speeds?.[i] != null ? kmh(route.speeds[i]) : null;
    segFree.push(free);
    segClass.push(classOf(free));
  }
  const cruise = new Float64Array(n);
  const cls = new Array(n);
  let seg = 0;
  const modeF = mode === 'return' ? RETURN_FACTOR : 1;
  for (let i = 0; i < n; i++) {
    const d = at(i);
    while (seg < segClass.length - 1 && cum[seg + 1] < d) seg++;
    const c = segClass[seg] ?? 'arterial';
    cls[i] = c;
    const free = segFree[seg];
    // Lights and siren buy ~30 % over the flow of traffic, up to the class ceiling; never
    // below 30 km/h on a road a car can use at all.
    const ceiling = CRUISE_KMH[c];
    const k = free != null ? Math.min(ceiling, Math.max(30, free * 1.3)) : ceiling;
    cruise[i] = mps(k * modeF);
  }

  // ── Corners: the named manoeuvres, then the bends in the geometry ────────────
  const corners = [];
  let from = 0;
  for (const s of route.steps ?? []) {
    const kind = cornerOf(s);
    if (!s.location) continue;
    const loc = locate(coords, cum, s.location, from);
    from = loc.idx;
    if (!kind) continue;
    corners.push({ atM: loc.atM, kind, name: s.name || null, modifier: s.modifier ?? null, type: s.type, source: 'step' });
  }
  for (const g of geometryCorners(coords, cum)) {
    if (corners.some((c) => Math.abs(c.atM - g.atM) <= 25)) continue;   // already a named manoeuvre
    corners.push(g);
  }
  corners.sort((a, b) => a.atM - b.atM);

  const limit = new Float64Array(n);
  for (let i = 0; i < n; i++) limit[i] = cruise[i];
  for (const c of corners) {
    const v = mps(CORNER_KMH[c.kind] * (mode === 'return' ? 0.9 : 1));
    const i0 = Math.max(0, Math.floor((c.atM - 8) / SAMPLE_M));
    const i1 = Math.min(n - 1, Math.ceil((c.atM + 8) / SAMPLE_M));
    for (let i = i0; i <= i1; i++) limit[i] = Math.min(limit[i], v);
  }

  const profile = build(limit, { fromRest });
  const noCorners = build(cruise, { fromRest });

  // ── What the route is made of ──────────────────────────────────────────────
  const share = { motorway: 0, arterial: 0, local: 0 };
  for (let i = 0; i < coords.length - 1; i++) share[segClass[i]] += cum[i + 1] - cum[i];
  for (const k of Object.keys(share)) share[k] = totalM ? share[k] / totalM : 0;

  const roads = [];
  for (const s of route.steps ?? []) {
    if (!s.name || s.type === 'arrive') continue;
    const last = roads[roads.length - 1];
    if (last?.name === s.name) last.m += s.distance ?? 0;
    else roads.push({ name: s.name, m: s.distance ?? 0 });
  }

  const braking = corners.filter((c) => CORNER_KMH[c.kind] <= 32);
  return {
    coords, cum, totalM: Math.round(totalM), exactM: totalM, sampleM: SAMPLE_M,
    limit, cruise, profile: profile.v, tcum: profile.tcum,
    timeSec: Math.round(profile.time),
    /** How much of the time is braking for and pulling out of corners. */
    cornerLossSec: Math.max(0, Math.round(profile.time - noCorners.time)),
    corners,
    counts: {
      manoeuvres: braking.length,
      roundabouts: corners.filter((c) => c.kind === 'roundabout').length,
      uturns: corners.filter((c) => c.kind === 'uturn').length,
      sharp: corners.filter((c) => c.kind === 'sharp' || c.kind === 'endofroad').length,
      turns: corners.filter((c) => c.kind === 'turn').length,
    },
    share,
    majorShare: share.motorway + share.arterial,
    roads: roads.filter((r) => r.m >= 60).map((r) => ({ name: r.name, m: Math.round(r.m) })),
    avgKmh: profile.time > 0 ? Math.round(kmh(totalM / profile.time)) : null,
    topKmh: Math.round(kmh(Math.max(...profile.v))),
    mode,
  };
}

/** The forward (acceleration) and backward (braking) passes over a speed ceiling. */
function build(limit, { fromRest = true } = {}) {
  const n = limit.length;
  const v = new Float64Array(n);
  v[0] = fromRest ? 0 : limit[0];
  for (let i = 1; i < n; i++) v[i] = Math.min(limit[i], Math.sqrt(v[i - 1] ** 2 + 2 * ACCEL * SAMPLE_M));
  v[n - 1] = Math.min(v[n - 1], ARRIVE_MPS);
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * DECEL * SAMPLE_M));
  const tcum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const avg = Math.max(0.8, (v[i - 1] + v[i]) / 2);
    tcum[i] = tcum[i - 1] + SAMPLE_M / avg;
  }
  return { v, tcum, time: tcum[n - 1] };
}

/**
 * The same route with congested stretches capping the speed inside them.
 * @param {ReturnType<typeof analyse>} a
 * @param {Array<{ fromM: number, toM: number, factor: number }>} segments  sim/traffic.js
 */
export function withTraffic(a, segments = []) {
  if (!a) return null;
  if (!segments.length) return { ...a, trafficDelaySec: 0, timeWithTrafficSec: a.timeSec, traffic: [] };
  const limit = Float64Array.from(a.limit);
  for (const s of segments) {
    const i0 = Math.max(0, Math.floor(s.fromM / SAMPLE_M));
    const i1 = Math.min(limit.length - 1, Math.ceil(s.toM / SAMPLE_M));
    for (let i = i0; i <= i1; i++) limit[i] = Math.min(limit[i], Math.max(mps(8), a.cruise[i] * s.factor));
  }
  const p = build(limit);
  return {
    ...a,
    profile: p.v, tcum: p.tcum,
    timeWithTrafficSec: Math.round(p.time),
    trafficDelaySec: Math.max(0, Math.round(p.time - a.timeSec)),
    traffic: segments,
  };
}

/** Speed the profile allows at `m` metres along, m/s. */
export function speedAt(a, m) {
  const i = Math.max(0, Math.min(a.profile.length - 1, m / a.sampleM));
  const lo = Math.floor(i);
  const hi = Math.min(a.profile.length - 1, lo + 1);
  return a.profile[lo] + (a.profile[hi] - a.profile[lo]) * (i - lo);
}

/** Seconds still to drive from `m` metres along. */
export function remainingSec(a, m) {
  const t = a.tcum;
  const i = Math.max(0, Math.min(t.length - 1, m / a.sampleM));
  const lo = Math.floor(i);
  const hi = Math.min(t.length - 1, lo + 1);
  const now = t[lo] + (t[hi] - t[lo]) * (i - lo);
  return Math.max(0, Math.round(t[t.length - 1] - now));
}

/** Metres covered `t` seconds into the drive — the profile followed in time. */
export function distanceAt(a, t) {
  const tc = a.tcum;
  const last = tc.length - 1;
  const end = a.exactM ?? a.totalM;
  if (t <= 0) return 0;
  if (t >= tc[last]) return end;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tc[mid] <= t) lo = mid; else hi = mid;
  }
  const span = tc[hi] - tc[lo] || 1;
  return Math.min(end, (lo + (t - tc[lo]) / span) * a.sampleM);
}

const CORNER_LABEL = {
  uturn: 'U-turn', sharp: 'sharp turn', endofroad: 'T-junction', turn: 'turn', roundabout: 'roundabout',
  exitroundabout: 'roundabout exit', slight: 'bend', ramp: 'slip road', junction: 'junction',
};

/** The next manoeuvre ahead of `m` that slows the vehicle: what, where, and to what speed. */
export function upcoming(a, m) {
  const c = a.corners.find((x) => x.atM > m + 5 && CORNER_KMH[x.kind] <= 45);
  if (!c) return null;
  const dir = c.kind === 'turn' || c.kind === 'sharp' || c.kind === 'endofroad' ? (c.modifier?.match(/left|right/)?.[0] ?? null) : null;
  return {
    kind: c.kind,
    label: `${dir ? `${dir} ` : ''}${CORNER_LABEL[c.kind] ?? c.kind}${c.name ? ` onto ${c.name}` : ''}`,
    inM: Math.max(0, Math.round(c.atM - m)),
    kmh: CORNER_KMH[c.kind],
  };
}

/** The next manoeuvre ahead of `m`, for the crew's co-pilot and the ride-along card. */
export function nextCorner(a, m) {
  return a.corners.find((c) => c.atM > m + 5 && CORNER_KMH[c.kind] <= 45) ?? null;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const km = (m) => `${(Math.max(0, m ?? 0) / 1000).toFixed(1)} km`;

/** "4 manoeuvres (2 roundabouts, 1 U-turn)" */
export function manoeuvreText(c) {
  const parts = [];
  if (c.roundabouts) parts.push(`${c.roundabouts} roundabout${c.roundabouts === 1 ? '' : 's'}`);
  if (c.uturns) parts.push(`${c.uturns} U-turn${c.uturns === 1 ? '' : 's'}`);
  if (c.sharp) parts.push(`${c.sharp} sharp`);
  const n = c.manoeuvres;
  if (!n) return 'no hard turns';
  return `${n} manoeuvre${n === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/** The roads a route uses, as a crew would read them: "82 Street › Al Ruwayyah St". */
export function roadsText(a, max = 3) {
  const named = a.roads.filter((r) => r.m >= 120).slice(0, max).map((r) => r.name);
  return named.length ? named.join(' › ') : null;
}

/** One line a driver would recognise: distance, manoeuvres, road mix, speed. */
export function summaryText(a) {
  return `${km(a.totalM)} · ${manoeuvreText(a.counts)} · ${pct(a.majorShare)} on main roads · avg ${a.avgKmh} km/h`;
}

/**
 * Why the chosen route beats another for the same journey — the reasons an experienced
 * driver would give, each backed by a number from the profiles.
 * @returns {string[]}
 */
export function whyRoute(best, other) {
  const out = [];
  const tBest = best.timeWithTrafficSec ?? best.timeSec;
  const tOther = other.timeWithTrafficSec ?? other.timeSec;
  const faster = tOther - tBest;
  const shorter = other.totalM - best.totalM;
  if (shorter < -50 && faster > 0) {
    out.push(`${km(-shorter)} longer but ${mmss(faster)} min faster — distance is not time`);
  } else if (faster > 0) {
    out.push(`${mmss(faster)} min faster${shorter > 50 ? ` and ${km(shorter)} shorter` : ''}`);
  }
  const dm = other.counts.manoeuvres - best.counts.manoeuvres;
  if (dm > 0) {
    out.push(`${dm} fewer manoeuvre${dm === 1 ? '' : 's'} to brake for (${best.counts.manoeuvres} vs ${other.counts.manoeuvres}) — ${mmss(other.cornerLossSec)} lost to corners on the other road`);
  } else if (dm < 0) {
    // The trade-off made the other way, said plainly: more braking, but less waiting.
    out.push(`accepts ${-dm} more manoeuvre${dm === -1 ? '' : 's'} (${best.counts.manoeuvres} vs ${other.counts.manoeuvres}, ~${mmss(best.cornerLossSec - other.cornerLossSec)} min of extra braking) to stay out of the queue`);
  }
  if (other.counts.uturns > best.counts.uturns) out.push('no U-turn — the other road reverses on a divided carriageway');
  const dr = other.counts.roundabouts - best.counts.roundabouts;
  if (dr > 0) out.push(`${dr} fewer roundabout${dr === 1 ? '' : 's'} (each costs a laden ambulance ~8 s braking and pulling away)`);
  if (best.majorShare - other.majorShare >= 0.15) out.push(`${pct(best.majorShare)} on main roads vs ${pct(other.majorShare)} — higher, steadier speed and room for traffic to pull over`);
  const dTraffic = (other.trafficDelaySec ?? 0) - (best.trafficDelaySec ?? 0);
  if (dTraffic >= 10) out.push(`avoids ${mmss(dTraffic)} min of congestion on the other road (simulated traffic)`);
  return out;
}

/** Pick the best of several analysed routes for one journey: least time including traffic. */
export function best(options) {
  return [...options].filter(Boolean).sort((a, b) => (a.timeWithTrafficSec ?? a.timeSec) - (b.timeWithTrafficSec ?? b.timeSec))[0] ?? null;
}

/** A compact, JSON-safe summary of an analysed route (no profile arrays). */
export function summary(a, { withPath = false } = {}) {
  if (!a) return null;
  return {
    distanceM: a.totalM,
    driveSec: a.timeSec,
    timeSec: a.timeWithTrafficSec ?? a.timeSec,
    trafficDelaySec: a.trafficDelaySec ?? 0,
    cornerLossSec: a.cornerLossSec,
    counts: a.counts,
    majorShare: Math.round(a.majorShare * 100) / 100,
    share: Object.fromEntries(Object.entries(a.share).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    roads: a.roads.slice(0, 6),
    avgKmh: a.avgKmh,
    topKmh: a.topKmh,
    text: summaryText(a),
    via: roadsText(a),
    ...(withPath ? { path: a.coords } : {}),
  };
}
