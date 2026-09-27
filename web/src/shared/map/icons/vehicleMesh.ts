/**
 * The ambulance, as geometry — and as a top-down symbol for when it is too small to model.
 *
 * An ambulance on a job is the one thing on this map that MOVES, and for most of a
 * response it is the thing the room is watching. The first model was six boxes and a
 * light bar in a single flat colour; at a tilt it read as a white brick, and from a chase
 * camera — which sees the vehicle from BEHIND — it was a blank slab. This one is modelled
 * to be recognised from any side at thirty pixels:
 *
 *   from above    the red cross on the roof, the light bar, the dark windscreen
 *   from the side the raked cab, the tall patient box, the red battenburg band, a cross,
 *                 glazed cab windows, wheels with hubs
 *   from behind   the rear-door windows, the red-and-white chequer, tail lights, and the
 *                 corner beacons — the view a chase camera actually has
 *
 * Built in code rather than loaded as a glTF on purpose: a control room may be air-gapped
 * (the fonts are self-hosted for the same reason), and the whole vehicle is ~1,900
 * triangles with no network request and nothing to cache-bust.
 *
 * COLOUR IS PAINT, NOT THEME. Every other mark on the map takes a token, because it is a
 * symbol. This is a model of a physical object: an ambulance is white with red markings
 * whether the console is in dark mode or light, so its colours are baked into the vertices
 * (`colors`) and the layer's instance colour only tints or dims it. Legibility against
 * either basemap comes from shading and the contact shadow, not from recolouring the van.
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
const RED: Rgb = [0.84, 0.11, 0.13];
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

  // Rear doors: two windows, and the split between the doors.
  const rear = BOX.x0 - PROUD;
  b.face([[0.12, 1.98], [0.84, 1.98], [0.84, 2.52], [0.12, 2.52]], rear, GLASS);
  b.face([[-0.84, 1.98], [-0.12, 1.98], [-0.12, 2.52], [-0.84, 2.52]], rear, GLASS);
  b.face([[-0.02, 0.9], [0.02, 0.9], [0.02, 2.8], [-0.02, 2.8]], rear - 0.001, TRIM);

  // Wheels.
  // Tucked just inside the body line, as a van's are, so a tyre never shares a plane with
  // the panel above it.
  for (const x of [2.2, -1.92]) {
    b.wheel(x, 1.04, 0.28, 0.4, 0.4);
    b.wheel(x, -1.04, 0.28, 0.4, 0.4);
  }

  // ── Livery ──
  // Battenburg: two rows of alternating red blocks along the box, the one pattern that
  // says "emergency ambulance" to anyone at any distance.
  // Kept inside the flat part of the flank — the outer 0.12 m is bevel.
  const rows: Array<[number, number]> = [[0.92, 1.24], [1.24, 1.56]];
  const cols = 7;
  const w = (BOX.x1 - 0.12 - (BOX.x0 + 0.12)) / cols;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2) continue;
      const x0 = BOX.x0 + 0.12 + c * w;
      const cell: P2[] = [[x0, rows[r][0]], [x0 + w, rows[r][0]], [x0 + w, rows[r][1]], [x0, rows[r][1]]];
      b.flank(cell, BOX.half + PROUD, RED);
      b.flank(cell, -BOX.half - PROUD, RED);
    }
  }
  // The band carries on round the cab as a stripe.
  const cabStripe: P2[] = [[0.86, 1.1], [2.84, 1.1], [2.84, 1.36], [0.86, 1.36]];
  b.flank(cabStripe, CAB_HALF + PROUD, RED);
  b.flank(cabStripe, -CAB_HALF - PROUD, RED);
  // And across the back as a chequer, for the chase camera's view.
  for (let c = 0; c < 6; c++) {
    const y0 = -0.98 + c * (1.96 / 6);
    const y1 = y0 + 1.96 / 6;
    for (let r = 0; r < 2; r++) {
      if ((r + c) % 2) continue;
      const z0 = 0.92 + r * 0.3;
      b.face([[y0, z0], [y1, z0], [y1, z0 + 0.3], [y0, z0 + 0.3]], rear, RED);
    }
  }

  // Crosses: one on each flank, one on the roof — the roof cross is what an operator sees
  // from a tilted overview.
  const crossAt = (cx: number, cz: number, arm: number, bar: number): P2[][] => [
    [[cx - arm, cz - bar], [cx + arm, cz - bar], [cx + arm, cz + bar], [cx - arm, cz + bar]],
    [[cx - bar, cz - arm], [cx + bar, cz - arm], [cx + bar, cz + arm], [cx - bar, cz + arm]],
  ];
  for (const part of crossAt(-1.15, 2.26, 0.42, 0.13)) {
    b.flank(part, BOX.half + PROUD * 2, RED);
    b.flank(part, -BOX.half - PROUD * 2, RED);
  }
  for (const part of crossAt(-0.9, 0, 0.62, 0.2)) b.roof(part, BOX.z1 + PROUD, RED);

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

let shell: MeshData | null = null;
let beaconLeft: MeshData | null = null;
let beaconRight: MeshData | null = null;

/** The whole painted vehicle — body, glass, wheels, trim and livery — in one draw. */
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
 * detail, not a change of object. Laid FLAT on the map (billboard: false) and turned to
 * the heading, it lies on the road the way the vehicle does.
 *
 * Full colour, not a mask, for the same reason the model's paint is baked: it is a
 * picture of a white vehicle with red markings. A dark keyline keeps it legible on the
 * light basemap.
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
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 6;
    rr(10, 8, 44, 112, 9);
    g.fillStyle = '#F0F0EB';
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20,20,20,0.85)';
    g.stroke();
    // Bonnet and windscreen (the front is at the top).
    rr(15, 12, 34, 12, 5);
    g.fillStyle = '#D9D9D4';
    g.fill();
    rr(14, 25, 36, 11, 3);
    g.fillStyle = '#18202A';
    g.fill();
    // Light bar: red left, blue right.
    g.fillStyle = '#D81E22';
    g.fillRect(14, 39, 17, 6);
    g.fillStyle = '#2A62E0';
    g.fillRect(33, 39, 17, 6);
    // Roof cross.
    g.fillStyle = '#D81E22';
    g.fillRect(27, 60, 10, 38);
    g.fillRect(16, 74, 32, 10);
    // Rear edge.
    g.fillStyle = '#2A2A2C';
    g.fillRect(14, 114, 36, 4);
  }
  topDown = { id: 'ambulance-top', url: canvas.toDataURL(), width: W, height: H, mask: false };
  return topDown;
}
