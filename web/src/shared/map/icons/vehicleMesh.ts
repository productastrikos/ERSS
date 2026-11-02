/**
 * The ambulance, as geometry — and as a top-down symbol for when it is too small to model.
 *
 * An ambulance on a job is the one thing on this map that MOVES, and for most of a
 * response it is the thing the room is watching. The first model was six boxes and a
 * light bar in a single flat colour; at a tilt it read as a white brick, and from a chase
 * camera — which sees the vehicle from BEHIND — it was a blank slab. This one is modelled
 * to be recognised from any side at thirty pixels:
 *
 *   from above    the white front and blue rear of the roof split by the red heartbeat,
 *                 the light bar, the dark windscreen
 *   from the side the raked cab, the tall patient box, glazed cab windows, wheels with hubs
 *                 — and the DCAS livery: white front, royal-blue rear behind a red ECG line,
 *                 "إسعاف / Ambulance", the red-and-white chequer along the sill
 *   from behind   blue rear doors with their windows, the heartbeat across them, the
 *                 wordmark, the chequer, tail lights and the beacon bar — the view a chase
 *                 camera actually has
 *
 * THE LIVERY IS THE CLIENT'S OWN. It is the Dubai Corporation for Ambulance Services'
 * Emergency Response Unit as it runs on the road (white Chevrolet box body, blue rear, the
 * red heartbeat between them, "Always in Safe Hands"), painted onto decal panels that sit a
 * hair proud of the body: a canvas texture drawn once (`ambulanceLiveryTexture`), mapped onto
 * both flanks, the cab doors, the rear doors and the roof (`ambulanceLiveryMesh`). Each flank
 * has its own copy of the art, so the wordmark reads correctly on both sides, as it does on
 * the vehicle.
 *
 * Built in code rather than loaded as a glTF on purpose: a control room may be air-gapped
 * (the fonts are self-hosted for the same reason), and the whole vehicle is ~1,900
 * triangles with no network request and nothing to cache-bust.
 *
 * COLOUR IS PAINT, NOT THEME. Every other mark on the map takes a token, because it is a
 * symbol. This is a model of a physical object: a DCAS ambulance is white and blue with red
 * markings whether the console is in dark mode or light, so its colours are baked into the
 * vertices (`colors`) and the livery texture, from ONE paint palette below, and the layer's
 * instance colour only tints or dims it. Legibility against either basemap comes from
 * shading and the contact shadow, not from recolouring the van.
 *
 * No normals are supplied, deliberately: without them SimpleMeshLayer derives a flat
 * normal per pixel from screen-space derivatives, which gives every panel a crisp faceted
 * edge — exactly the look a small hard-surface model needs — and makes face winding
 * irrelevant (the first version lit its faces from the inside because of a winding bug).
 *
 * Axes, matching deck.gl's mesh convention: +X forward, +Y to the vehicle's left, +Z up.
 * Units are METRES: 6.1 m long, 2.2 m wide, 3.0 m to the top of the beacons.
 */

type Vec3 = [number, number, number];
type Rgb = [number, number, number];
type P2 = [number, number];

/**
 * Raw mesh attributes in the shape `SimpleMeshLayer` accepts directly. A plain triangle
 * list — every triangle carries its own vertices, so a colour boundary is always a hard
 * edge and nothing needs indexing.
 */
export interface MeshData {
  positions: { value: Float32Array; size: number };
  colors: { value: Float32Array; size: number };
  [attribute: string]: { value: Float32Array; size: number };
}

// ── Paint ────────────────────────────────────────────────────────────────────

const WHITE: Rgb = [0.94, 0.94, 0.92];
/** DCAS red — the heartbeat, the chequer, the Arabic wordmark on the cab. */
const RED: Rgb = [0.86, 0.1, 0.16];
/** DCAS royal blue — the rear of the body and the English wordmark. */
const BLUE: Rgb = [0.13, 0.29, 0.66];
const GLASS: Rgb = [0.09, 0.12, 0.16];
const TRIM: Rgb = [0.17, 0.17, 0.18];
const TYRE: Rgb = [0.06, 0.06, 0.065];
const HUB: Rgb = [0.6, 0.61, 0.63];
const HEADLAMP: Rgb = [1, 0.96, 0.84];
const TAIL: Rgb = [0.72, 0.06, 0.07];
const ROOF_UNIT: Rgb = [0.8, 0.81, 0.82];
/** Beacons are drawn unlit and coloured per layer, so the lens is plain white here. */
const LENS: Rgb = [1, 1, 1];

// ── A tiny triangle-list builder ─────────────────────────────────────────────

class Builder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];

  tri(a: Vec3, b: Vec3, c: Vec3, rgb: Rgb): void {
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.colors.push(...rgb);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, rgb: Rgb): void {
    this.tri(a, b, c, rgb);
    this.tri(a, c, d, rgb);
  }

  /** A convex polygon as a triangle fan. */
  fan(pts: Vec3[], rgb: Rgb): void {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], rgb);
  }

  /** An axis-aligned box: [x0, x1] × [y0, y1] × [z0, z1]. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rgb: Rgb): void {
    const c = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const faces = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
    for (const f of faces) this.quad(c(f[0]), c(f[1]), c(f[2]), c(f[3]), rgb);
  }

  /**
   * A convex side profile (x, z) extruded across the vehicle from y0 to y1, with its
   * perimeter chamfered by `bevel` at both ends — so the box body has soft shoulders
   * instead of the knife edges that made the old model read as a brick.
   */
  prism(profile: P2[], y0: number, y1: number, bevel: number, rgb: Rgb): void {
    const full = ccw(profile);
    const inset = bevel > 0 ? insetPolygon(full, bevel) : full;
    const at = (p: P2[], y: number): Vec3[] => p.map(([x, z]) => [x, y, z]);
    const rings = bevel > 0
      ? [at(inset, y0), at(full, y0 + bevel), at(full, y1 - bevel), at(inset, y1)]
      : [at(full, y0), at(full, y1)];
    this.fan(rings[0], rgb);
    this.fan(rings[rings.length - 1], rgb);
    for (let r = 0; r < rings.length - 1; r++) {
      const a = rings[r];
      const b = rings[r + 1];
      for (let i = 0; i < a.length; i++) {
        const j = (i + 1) % a.length;
        this.quad(a[i], a[j], b[j], b[i], rgb);
      }
    }
  }

  /** A wheel: a tyre (cylinder along Y) with a hub disc on its outer face. */
  wheel(x: number, yOuter: number, width: number, radius: number, z: number): void {
    const n = 14;
    const inner = yOuter - Math.sign(yOuter) * width;
    const ring = (y: number, r: number): Vec3[] =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return [x + Math.cos(a) * r, y, z + Math.sin(a) * r] as Vec3;
      });
    const outerRing = ring(yOuter, radius);
    const innerRing = ring(inner, radius);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(outerRing[i], outerRing[j], innerRing[j], innerRing[i], TYRE);
    }
    this.fan(innerRing, TYRE);
    this.fan(outerRing, TYRE);
    // The hub sits a hair proud of the tyre wall so the two never share a plane.
    const proud = yOuter + Math.sign(yOuter) * 0.012;
    this.fan(ring(proud, radius * 0.55), HUB);
  }

  /** A flat panel on a flank (constant y), given as an (x, z) outline. */
  flank(outline: P2[], y: number, rgb: Rgb): void {
    this.fan(outline.map(([x, z]) => [x, y, z] as Vec3), rgb);
  }

  /** A flat panel on a face of constant x, given as a (y, z) outline. */
  face(outline: P2[], x: number, rgb: Rgb): void {
    this.fan(outline.map(([y, z]) => [x, y, z] as Vec3), rgb);
  }

  /** A flat panel on a face of constant z (a roof), given as an (x, y) outline. */
  roof(outline: P2[], z: number, rgb: Rgb): void {
    this.fan(outline.map(([x, y]) => [x, y, z] as Vec3), rgb);
  }

  mesh(): MeshData {
    return {
      positions: { value: new Float32Array(this.positions), size: 3 },
      colors: { value: new Float32Array(this.colors), size: 3 },
    };
  }
}

function ccw(p: P2[]): P2[] {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[(i + 1) % p.length];
    area += x0 * z1 - x1 * z0;
  }
  return area >= 0 ? p : [...p].reverse();
}

/** Offset a convex, counter-clockwise polygon inwards by d along each edge's normal. */
function insetPolygon(p: P2[], d: number): P2[] {
  const n = p.length;
  return p.map((cur, i) => {
    const prev = p[(i - 1 + n) % n];
    const next = p[(i + 1) % n];
    const inward = (a: P2, b: P2): P2 => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      return [-dz / len, dx / len];
    };
    const n1 = inward(prev, cur);
    const n2 = inward(cur, next);
    const m: P2 = [n1[0] + n2[0], n1[1] + n2[1]];
    const mlen = Math.hypot(m[0], m[1]) || 1;
    const dir: P2 = [m[0] / mlen, m[1] / mlen];
    const k = d / Math.max(0.3, dir[0] * n1[0] + dir[1] * n1[1]);
    return [cur[0] + dir[0] * k, cur[1] + dir[1] * k];
  });
}

/** Cut every corner of a polygon at distance r along both edges. */
function chamfer(p: P2[], r: number): P2[] {
  const out: P2[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n];
    const cur = p[i];
    const next = p[(i + 1) % n];
    const toward = (a: P2, b: P2): P2 => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.min(r, len * 0.4) / (len || 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    out.push(toward(cur, prev), toward(cur, next));
  }
  return out;
}

// ── The vehicle ──────────────────────────────────────────────────────────────

/** Patient compartment. */
const BOX = { x0: -3.0, x1: 0.86, z0: 0.78, z1: 2.9, half: 1.1 };
/** Cab: narrower than the box, raked windscreen. The profile is (x, z). */
const CAB_HALF = 1.03;
const CAB_PROFILE: P2[] = [
  [0.8, 0.78], [2.94, 0.78], [3.04, 1.02], [2.98, 1.28], [2.46, 1.43], [1.74, 2.3], [0.8, 2.34],
];
/** Offset that keeps a painted panel off the surface it is painted on — no z-fighting. */
const PROUD = 0.014;

function buildShell(): MeshData {
  const b = new Builder();

  // Body shells.
  b.prism(chamfer([[BOX.x0, BOX.z0], [BOX.x1, BOX.z0], [BOX.x1, BOX.z1], [BOX.x0, BOX.z1]], 0.13),
    -BOX.half, BOX.half, 0.1, WHITE);
  b.prism(chamfer(CAB_PROFILE, 0.07), -CAB_HALF, CAB_HALF, 0.09, WHITE);

  // Chassis, bumpers and the dark band that sits the body on its wheels.
  b.box(-2.8, 2.9, -0.92, 0.92, 0.3, 0.82, TRIM);
  b.box(2.9, 3.1, -1.0, 1.0, 0.45, 0.84, TRIM);               // front bumper
  b.box(-3.13, -2.96, -1.06, 1.06, 0.5, 0.72, TRIM);          // rear step
  b.box(2.99, 3.07, -0.62, 0.62, 0.86, 1.0, TRIM);            // grille
  b.box(1.98, 2.16, 1.0, 1.27, 1.62, 1.96, TRIM);             // mirrors
  b.box(1.98, 2.16, -1.27, -1.0, 1.62, 1.96, TRIM);
  b.box(-2.78, -2.2, -0.46, 0.46, BOX.z1 - 0.02, BOX.z1 + 0.2, ROOF_UNIT);   // roof air-con

  // Lamps.
  b.box(2.96, 3.04, 0.66, 0.92, 1.04, 1.16, HEADLAMP);
  b.box(2.96, 3.04, -0.92, -0.66, 1.04, 1.16, HEADLAMP);
  b.box(-3.04, -2.98, 0.9, 1.06, 0.9, 1.44, TAIL);
  b.box(-3.04, -2.98, -1.06, -0.9, 0.9, 1.44, TAIL);

  // Windscreen — a panel lying on the rake, lifted off it along the rake's normal.
  const [ax, az] = [2.46, 1.43];
  const [bx, bz] = [1.74, 2.3];
  const len = Math.hypot(bx - ax, bz - az);
  const nx = (bz - az) / len, nz = -(bx - ax) / len;   // forward-and-up
  const lift = (t: number, y: number): Vec3 => [ax + (bx - ax) * t + nx * PROUD, y, az + (bz - az) * t + nz * PROUD];
  b.quad(lift(0.06, -0.9), lift(0.06, 0.9), lift(0.94, 0.9), lift(0.94, -0.9), GLASS);

  // Cab side windows, following the rake of the windscreen.
  const cabWindow: P2[] = [[0.96, 1.5], [2.28, 1.5], [1.74, 2.16], [0.96, 2.16]];
  b.flank(cabWindow, CAB_HALF + PROUD, GLASS);
  b.flank(cabWindow, -CAB_HALF - PROUD, GLASS);

  // The rear doors — windows, split and paint — are on the livery texture (below).

  // Wheels.
  // Tucked just inside the body line, as a van's are, so a tyre never shares a plane with
  // the panel above it.
  for (const x of [2.2, -1.92]) {
    b.wheel(x, 1.04, 0.28, 0.4, 0.4);
    b.wheel(x, -1.04, 0.28, 0.4, 0.4);
  }

  // The livery — DCAS blue, the heartbeat, the wordmarks, the chequer — is not geometry:
  // it is a texture on decal panels (ambulanceLiveryMesh / ambulanceLiveryTexture).

  return b.mesh();
}

/**
 * The beacons, split in two so they can flash alternately: the left-hand lamps (red) and
 * the right-hand lamps (blue) — cab light bar halves plus the box's four corner beacons.
 */
function buildBeacons(side: 1 | -1): MeshData {
  const b = new Builder();
  const y = (a: number, c: number): [number, number] => (side > 0 ? [a, c] : [-c, -a]);
  // Cab light bar half, on the cab roof — the view from in front and from above.
  b.box(1.0, 1.52, ...y(0.04, 0.96), 2.32, 2.58, LENS);
  // A bar across the back of the box roof: at thirty pixels from a chase camera, this is
  // the only lamp actually in view, and an ambulance under blue lights has to look like one.
  b.box(-3.0, -2.76, ...y(0.04, 0.98), BOX.z1 - 0.02, BOX.z1 + 0.22, LENS);
  // Corner beacons at the front of the box.
  b.box(0.52, 0.84, ...y(0.74, 1.06), BOX.z1 - 0.02, BOX.z1 + 0.2, LENS);
  return b.mesh();
}

// ── The livery: decal panels and the art painted on them ────────────────────
//
// Five panels (two flanks, two cab doors, the rear doors, the roof) each map a rectangle of
// ONE canvas atlas. The canvas's top row is v = 0 (luma.gl uploads it unflipped). Each panel
// is the flat part of its face, corners cut so no decal overhangs the body's bevel, lifted
// PROUD off the paint so the two never fight for the same depth.

const ATLAS = { w: 1024, h: 512 };
interface Region { x: number; y: number; w: number; h: number }
const R_FLANK_L: Region = { x: 0, y: 0, w: 508, h: 266 };
const R_FLANK_R: Region = { x: 516, y: 0, w: 508, h: 266 };
const R_REAR: Region = { x: 0, y: 274, w: 236, h: 226 };
const R_ROOF: Region = { x: 244, y: 274, w: 410, h: 223 };
const R_CAB_L: Region = { x: 662, y: 274, w: 250, h: 100 };
const R_CAB_R: Region = { x: 662, y: 382, w: 250, h: 100 };

/** The flat of the box flank (and roof length): inside the 0.1 m bevel. */
const FLANK = { x0: BOX.x0 + 0.11, x1: BOX.x1 - 0.11, z0: BOX.z0 + 0.11, z1: BOX.z1 - 0.11 };
/** The cab door, below the side window and clear of the bonnet's rake. */
const CAB_DOOR = { x0: 0.95, x1: 2.3, z0: 0.9, z1: 1.44 };
/** Across the back and the roof. */
const ACROSS = { y0: -BOX.half + 0.11, y1: BOX.half - 0.11 };
/** The chequer band along the sill — the same physical height on the box and the cab. */
const CHEQUER_M = 0.18;

/** A textured triangle list: positions and texture coordinates, colour left white. */
class DecalBuilder {
  readonly positions: number[] = [];
  readonly texCoords: number[] = [];

  /** A convex outline, each vertex carrying its own UV, as a triangle fan. */
  panel(pts: Vec3[], uv: (p: Vec3) => [number, number]): void {
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        this.positions.push(...p);
        this.texCoords.push(...uv(p));
      }
    }
  }

  mesh(): MeshData {
    const n = this.positions.length / 3;
    return {
      positions: { value: new Float32Array(this.positions), size: 3 },
      colors: { value: new Float32Array(n * 3).fill(1), size: 3 },
      texCoords: { value: new Float32Array(this.texCoords), size: 2 },
    };
  }
}

/** Atlas UV for a point (s, t) in [0, 1] of a region — s across, t down. */
const atlasUv = (r: Region, s: number, t: number): [number, number] =>
  [(r.x + s * r.w) / ATLAS.w, (r.y + t * r.h) / ATLAS.h];

function buildLivery(): MeshData {
  const d = new DecalBuilder();
  const rect = (a0: number, a1: number, b0: number, b1: number): P2[] => chamfer([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], 0.1);
  const fx = (x: number) => (FLANK.x1 - x) / (FLANK.x1 - FLANK.x0);          // 0 at the front
  const fz = (z: number) => (FLANK.z1 - z) / (FLANK.z1 - FLANK.z0);          // 0 at the top
  const ay = (y: number) => (ACROSS.y1 - y) / (ACROSS.y1 - ACROSS.y0);       // 0 on the left (+Y)

  // Flanks. Seen from the vehicle's left (+Y) the front is on the viewer's left; from its
  // right, on the viewer's right — so each side gets the art laid out for it.
  const flank = rect(FLANK.x0, FLANK.x1, FLANK.z0, FLANK.z1);
  const yl = BOX.half + PROUD;
  d.panel(flank.map(([x, z]) => [x, yl, z] as Vec3), ([x, , z]) => atlasUv(R_FLANK_L, fx(x), fz(z)));
  d.panel(flank.map(([x, z]) => [x, -yl, z] as Vec3), ([x, , z]) => atlasUv(R_FLANK_R, 1 - fx(x), fz(z)));

  // Cab doors — the cab is narrower than the box.
  const door = rect(CAB_DOOR.x0, CAB_DOOR.x1, CAB_DOOR.z0, CAB_DOOR.z1);
  const cx = (x: number) => (CAB_DOOR.x1 - x) / (CAB_DOOR.x1 - CAB_DOOR.x0);
  const cz = (z: number) => (CAB_DOOR.z1 - z) / (CAB_DOOR.z1 - CAB_DOOR.z0);
  const yc = CAB_HALF + PROUD;
  d.panel(door.map(([x, z]) => [x, yc, z] as Vec3), ([x, , z]) => atlasUv(R_CAB_L, cx(x), cz(z)));
  d.panel(door.map(([x, z]) => [x, -yc, z] as Vec3), ([x, , z]) => atlasUv(R_CAB_R, 1 - cx(x), cz(z)));

  // Rear doors: standing behind it you face the way it does, so its left (+Y) is your left.
  const back = rect(ACROSS.y0, ACROSS.y1, FLANK.z0, FLANK.z1);
  d.panel(back.map(([y, z]) => [BOX.x0 - PROUD, y, z] as Vec3), ([, y, z]) => atlasUv(R_REAR, ay(y), fz(z)));

  // Roof, read from above with the nose to the left: the vehicle's RIGHT side is then at the
  // top. (Nose left with its left side on top would be a mirror image, and 998 would read
  // backwards from every heading.)
  const roof = rect(FLANK.x0, FLANK.x1, ACROSS.y0, ACROSS.y1);
  d.panel(roof.map(([x, y]) => [x, y, BOX.z1 + PROUD] as Vec3), ([x, y]) => atlasUv(R_ROOF, fx(x), 1 - ay(y)));

  return d.mesh();
}

// ── The art ──────────────────────────────────────────────────────────────────

const css = ([r, g, b]: Rgb, a = 1) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;
const DISPLAY = "'Lexend Deca', 'Lato', sans-serif";
/** Arabic is set in whatever Arabic face the device has: neither brand face carries it. */
const ARABIC = "'Segoe UI', 'Noto Naskh Arabic', 'Geeza Pro', sans-serif";

type Ctx = CanvasRenderingContext2D;

/** Text centred at (x, y), shrunk to fit `maxW` rather than overrunning a panel's edge. */
function label(g: Ctx, text: string, x: number, y: number, px: number, font: string, colour: string, maxW: number, weight = 800, rtl = false): void {
  g.save();
  g.font = `${weight} ${px}px ${font}`;
  g.direction = rtl ? 'rtl' : 'ltr';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = colour;
  const w = g.measureText(text).width;
  if (w > maxW) {
    g.translate(x, y);
    g.scale(maxW / w, 1);
    g.fillText(text, 0, 0);
  } else {
    g.fillText(text, x, y);
  }
  g.restore();
}

/** Two rows of alternating red and white squares between x0 and x1, the band's top at y. */
function chequer(g: Ctx, x0: number, x1: number, y: number, h: number): void {
  const cell = h / 2;
  g.fillStyle = css(WHITE);
  g.fillRect(x0, y, x1 - x0, h);
  g.fillStyle = css(RED);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; x0 + i * cell < x1; i++) {
      if ((i + row) % 2) continue;
      g.fillRect(x0 + i * cell, y + row * cell, Math.min(cell, x1 - (x0 + i * cell)), cell);
    }
  }
}

/**
 * The heartbeat: a red trace along a path, with one beat in it. `along` maps the trace's
 * progress (0..1) to a canvas point, `across` is the unit vector the beat swings along, and
 * `amp` its height in pixels.
 */
function heartbeat(g: Ctx, along: (k: number) => [number, number], across: [number, number], amp: number, width: number, beatAt = 0.5): void {
  // One P-QRS-T complex as (progress offset, swing) pairs around `beatAt`.
  const beat: Array<[number, number]> = [
    [-0.16, 0], [-0.13, 0.18], [-0.1, 0], [-0.06, 0], [-0.04, -0.28], [0, 1], [0.035, -0.62], [0.06, 0],
    [0.1, 0], [0.14, 0.26], [0.18, 0],
  ];
  const pts: Array<[number, number]> = [along(0)];
  for (const [dk, sw] of beat) {
    const [x, y] = along(beatAt + dk);
    pts.push([x + across[0] * sw * amp, y + across[1] * sw * amp]);
  }
  pts.push(along(1));
  g.save();
  g.strokeStyle = css(RED);
  g.lineWidth = width;
  g.lineJoin = 'miter';
  g.miterLimit = 6;
  g.lineCap = 'butt';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

/** The 998 badge: white on red, rounded. */
function badge998(g: Ctx, cx: number, cy: number, h: number): void {
  const w = h * 1.9;
  g.fillStyle = css(RED);
  g.beginPath();
  g.roundRect(cx - w / 2, cy - h / 2, w, h, h * 0.2);
  g.fill();
  label(g, '998', cx, cy + h * 0.04, h * 0.72, DISPLAY, css(WHITE), w * 0.9, 900);
}

/**
 * One flank of the patient box. `frontLeft`: the vehicle's nose is at the region's left edge
 * (the left flank, seen from outside); otherwise at its right edge. Positions are worked in
 * "front fraction" f (0 at the nose end of the box, 1 at the tail) so both sides are one design.
 */
function paintFlank(g: Ctx, r: Region, frontLeft: boolean): void {
  const X = (f: number) => r.x + (frontLeft ? f : 1 - f) * r.w;
  const Y = (t: number) => r.y + t * r.h;
  const pxPerM = r.h / (FLANK.z1 - FLANK.z0);

  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = css(WHITE);
  g.fillRect(r.x, r.y, r.w, r.h);

  // The blue rear, behind a boundary that leans back as it rises — as on the vehicle.
  const edge = (t: number) => 0.535 + 0.085 * (1 - t);
  g.fillStyle = css(BLUE);
  g.beginPath();
  g.moveTo(X(edge(0)), Y(0));
  g.lineTo(X(1.02), Y(0));
  g.lineTo(X(1.02), Y(1));
  g.lineTo(X(edge(1)), Y(1));
  g.closePath();
  g.fill();

  // The chequer along the sill, under the white.
  const band = CHEQUER_M * pxPerM;
  const sillEnd = X(edge(1) - 0.01);
  chequer(g, Math.min(X(0), sillEnd), Math.max(X(0), sillEnd), Y(1) - band, band);

  // The heartbeat up the boundary, its beat swinging toward the nose.
  const nose: [number, number] = [frontLeft ? -1 : 1, 0];
  heartbeat(g, (k) => [X(edge(1 - k) - 0.008), Y(1 - k)], nose, 0.065 * r.w, Math.max(3, 0.04 * pxPerM), 0.5);

  // Blue side: the wordmark, white.
  const blueMid = X((edge(0.5) + 1) / 2 + 0.01);
  const blueW = (1 - edge(0.5)) * r.w * 0.86;
  label(g, 'إسعاف', blueMid, Y(0.36), r.h * 0.2, ARABIC, css(WHITE), blueW, 800, true);
  label(g, 'Ambulance', blueMid, Y(0.56), r.h * 0.12, DISPLAY, css(WHITE), blueW, 800);

  // White side: the motto in blue, the unit's name in red, the 998 badge by the boundary.
  const whiteMid = X(0.27);
  const whiteW = 0.42 * r.w;
  label(g, 'دوما بأيد أمينة', whiteMid, Y(0.27), r.h * 0.07, ARABIC, css(BLUE), whiteW, 700, true);
  label(g, 'Always in Safe Hands', whiteMid, Y(0.35), r.h * 0.05, DISPLAY, css(BLUE), whiteW, 700);
  label(g, 'وحدة الإستجابة الطارئة', whiteMid, Y(0.5), r.h * 0.075, ARABIC, css(RED), whiteW, 800, true);
  label(g, 'EMERGENCY RESPONSE UNIT', whiteMid, Y(0.585), r.h * 0.05, DISPLAY, css(RED), whiteW, 800);
  badge998(g, X(0.47), Y(0.11), r.h * 0.09);
  g.restore();
}

/** A cab door: "إسعاف" in red over "Ambulance" in blue, the chequer running on from the box. */
function paintCab(g: Ctx, r: Region, frontLeft: boolean): void {
  const X = (f: number) => r.x + (frontLeft ? f : 1 - f) * r.w;
  const pxPerM = r.h / (CAB_DOOR.z1 - CAB_DOOR.z0);
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = css(WHITE);
  g.fillRect(r.x, r.y, r.w, r.h);
  const band = CHEQUER_M * pxPerM;
  chequer(g, r.x, r.x + r.w, r.y + r.h - band, band);
  const mid = X(0.55);
  label(g, 'إسعاف', mid, r.y + r.h * 0.27, r.h * 0.34, ARABIC, css(RED), r.w * 0.6, 800, true);
  label(g, 'Ambulance', mid, r.y + r.h * 0.55, r.h * 0.18, DISPLAY, css(BLUE), r.w * 0.6, 800);
  g.restore();
}

/** The rear doors, seen from behind: blue, two windows, the heartbeat, the wordmark, the chequer. */
function paintRear(g: Ctx, r: Region): void {
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + t * r.h;
  const pxPerM = r.h / (FLANK.z1 - FLANK.z0);
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = css(BLUE);
  g.fillRect(r.x, r.y, r.w, r.h);
  // Windows, framed.
  for (const [u0, u1] of [[0.08, 0.44], [0.56, 0.92]]) {
    g.fillStyle = css(TRIM);
    g.beginPath();
    g.roundRect(X(u0) - 2, Y(0.12) - 2, X(u1) - X(u0) + 4, Y(0.43) - Y(0.12) + 4, 5);
    g.fill();
    g.fillStyle = css(GLASS);
    g.beginPath();
    g.roundRect(X(u0), Y(0.12), X(u1) - X(u0), Y(0.43) - Y(0.12), 4);
    g.fill();
  }
  const band = CHEQUER_M * pxPerM;
  chequer(g, r.x, r.x + r.w, Y(1) - band, band);
  // The split between the two doors — under the paint that crosses it, as on the vehicle.
  g.fillStyle = css(TRIM, 0.85);
  g.fillRect(X(0.5) - 1, Y(0.04), 2, Y(1) - band - Y(0.04));
  heartbeat(g, (k) => [X(k), Y(0.585)], [0, -1], 0.075 * r.h, Math.max(3, 0.04 * pxPerM), 0.3);
  label(g, 'إسعاف', X(0.5), Y(0.71), r.h * 0.12, ARABIC, css(WHITE), r.w * 0.8, 800, true);
  label(g, 'Ambulance', X(0.5), Y(0.82), r.h * 0.08, DISPLAY, css(WHITE), r.w * 0.8, 800);
  g.restore();
}

/** The roof, nose at the left: white forward, blue aft, the heartbeat across, 998 for the air. */
function paintRoof(g: Ctx, r: Region): void {
  const X = (f: number) => r.x + f * r.w;
  const Y = (t: number) => r.y + t * r.h;
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.fillStyle = css(WHITE);
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = css(BLUE);
  g.fillRect(X(0.58), r.y, r.w * 0.42, r.h);
  heartbeat(g, (k) => [X(0.575), Y(k)], [-1, 0], 0.09 * r.w, Math.max(3, 0.05 * r.h), 0.5);
  badge998(g, X(0.3), Y(0.5), r.h * 0.34);
  g.restore();
}

let livery: MeshData | null = null;
let liveryArt: HTMLCanvasElement | null = null;

/** The livery's decal panels — drawn with `ambulanceLiveryTexture()` as the texture. */
export function ambulanceLiveryMesh(): MeshData {
  livery ??= buildLivery();
  return livery;
}

/** The livery art, one atlas for every panel. Drawn once, on first use. */
export function ambulanceLiveryTexture(): HTMLCanvasElement {
  if (liveryArt) return liveryArt;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.w;
  canvas.height = ATLAS.h;
  const g = canvas.getContext('2d');
  if (g) {
    // Gutters between regions take the body's white, so a far-off mip level bleeds white.
    g.fillStyle = css(WHITE);
    g.fillRect(0, 0, ATLAS.w, ATLAS.h);
    paintFlank(g, R_FLANK_L, true);
    paintFlank(g, R_FLANK_R, false);
    paintCab(g, R_CAB_L, true);
    paintCab(g, R_CAB_R, false);
    paintRear(g, R_REAR);
    paintRoof(g, R_ROOF);
  }
  liveryArt = canvas;
  return canvas;
}

let shell: MeshData | null = null;
let beaconLeft: MeshData | null = null;
let beaconRight: MeshData | null = null;

/** The painted vehicle — body, glass, wheels and trim — in one draw. The livery is a
 *  second, textured draw over it (ambulanceLiveryMesh). */
export function ambulanceMesh(): MeshData {
  shell ??= buildShell();
  return shell;
}

/** Left-hand beacons (drawn red) and right-hand beacons (drawn blue), flashed in turn. */
export function ambulanceBeaconMesh(side: 'left' | 'right'): MeshData {
  if (side === 'left') return (beaconLeft ??= buildBeacons(1));
  return (beaconRight ??= buildBeacons(-1));
}

/** Nose-to-tail length of the model in metres — the divisor for on-screen sizing. */
export const AMBULANCE_LENGTH_M = 6.2;

/**
 * deck.gl yaw for a compass heading.
 *
 * `getOrientation` is `[pitch, yaw, roll]` in degrees, with yaw turning counter-clockwise
 * around +Z starting from +X. The mesh drives along +X; a compass heading runs clockwise
 * from north (+Y). Hence 90 − heading, and the two conventions stop fighting.
 */
export const headingToOrientation = (heading: number | null | undefined): [number, number, number] =>
  [0, 90 - (heading ?? 0), 0];

// ── The far view: the same vehicle, seen from above ──────────────────────────

export interface ColourIcon {
  id: string;
  url: string;
  width: number;
  height: number;
  mask: false;
}

let topDown: ColourIcon | null = null;

/**
 * The ambulance from directly above, nose up — what the 3D model looks like from a
 * satellite, so shrinking from model to symbol as the camera pulls back is a change of
 * detail, not a change of object: the white front, the blue rear, the red heartbeat
 * between them, the light bar. Laid FLAT on the map (billboard: false) and turned to the
 * heading, it lies on the road the way the vehicle does.
 *
 * Full colour, not a mask, for the same reason the model's paint is baked: it is a picture
 * of a DCAS vehicle, in the same paint palette as the model. A dark keyline keeps it legible
 * on the light basemap.
 */
export function ambulanceTopIcon(): ColourIcon {
  if (topDown) return topDown;
  const W = 64;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (g) {
    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
    };
    // Soft shadow so it sits on the road rather than floating over it.
    g.shadowColor = css(TYRE, 0.55);
    g.shadowBlur = 6;
    rr(10, 8, 44, 112, 9);
    g.fillStyle = css(WHITE);
    g.fill();
    g.shadowBlur = 0;
    // The blue rear of the box, clipped to the body's outline.
    g.save();
    rr(10, 8, 44, 112, 9);
    g.clip();
    g.fillStyle = css(BLUE);
    g.fillRect(10, 76, 44, 46);
    g.restore();
    rr(10, 8, 44, 112, 9);
    g.lineWidth = 3;
    g.strokeStyle = css(TYRE, 0.85);
    g.stroke();
    // Bonnet and windscreen (the front is at the top).
    rr(15, 12, 34, 12, 5);
    g.fillStyle = css(ROOF_UNIT);
    g.fill();
    rr(14, 25, 36, 11, 3);
    g.fillStyle = css(GLASS);
    g.fill();
    // Light bar: red left, blue right.
    g.fillStyle = css(RED);
    g.fillRect(14, 39, 17, 6);
    g.fillStyle = css(BLUE);
    g.fillRect(33, 39, 17, 6);
    // The heartbeat across the boundary.
    g.strokeStyle = css(RED);
    g.lineWidth = 3.2;
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(11, 76);
    g.lineTo(24, 76);
    g.lineTo(27, 70);
    g.lineTo(31, 84);
    g.lineTo(35, 66);
    g.lineTo(38, 79);
    g.lineTo(41, 76);
    g.lineTo(53, 76);
    g.stroke();
    // 998 on the white of the roof.
    g.fillStyle = css(RED);
    rr(20, 52, 24, 12, 2);
    g.fill();
    // Rear edge.
    g.fillStyle = css(TRIM);
    g.fillRect(14, 114, 36, 4);
  }
  topDown = { id: 'ambulance-top-dcas', url: canvas.toDataURL(), width: W, height: H, mask: false };
  return topDown;
}
