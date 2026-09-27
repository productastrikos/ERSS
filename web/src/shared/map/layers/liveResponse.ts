/**
 * The live response — the one layer the operations map exists for.
 *
 * It answers three questions at a glance, which is what a dashboard map must do before it
 * earns the space it takes:
 *
 *   WHERE ARE THE CALLS?      A column of light rises from every live emergency, its
 *                             height and hue set by priority. A column is visible across
 *                             the whole emirate at a tilt, where a 9-pixel dot is not.
 *   IS ANYONE GOING?          A dashed violet line joins the responding ambulance to its
 *                             call. One look says which alerts are covered and which are
 *                             not — a call with no link is a call with nobody on the way.
 *                             It is STRAIGHT, DASHED and a colour no road on this map uses,
 *                             because the first version was a priority-coloured arc and an
 *                             operator could not tell it from the route itself.
 *   WHERE HAVE THEY GOT TO?   The ambulance drives its route: the road ahead is drawn as
 *                             a lit path, the road behind fades out as a trail, and the
 *                             vehicle itself sits at its live position, turned to its
 *                             heading, carrying its callsign and its ETA.
 *
 * Everything here is measured, not decorative. The path is the remaining route the server
 * is actually steering the crew down (`/api/live/assignments`), the position is the unit's
 * last reported fix, and the ETA is the dispatch engine's prediction — the same one the
 * ETA-accuracy panel later holds to account.
 *
 * Priority is never colour alone: the column's HEIGHT, the route's WIDTH and the label all
 * carry it too (docs/05 §5.4).
 */

import { ColumnLayer, IconLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { CollisionFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import type { Priority, TrafficStretch } from '../../../lib/types';
import { defineLayer, type LayerContext } from '../layerRegistry';
import { rgba, type Rgba } from '../tokens';
import { liveMotion } from '../live/liveMotion';
import { fontStack, hazardMarker, incidentGlyph, memoOn, pulsePhase } from './kit';
import { glyphIcon } from '../icons/glyphs';
import { FLAT, metresPerPixel, vehicleLayers } from './vehicle3d';
import { LiveResponsePopup } from '../popups/OperationalPopups';

type LngLat = [number, number];

export interface LiveResponse {
  /** Assignment ref. */
  ref: string;
  state: string;
  leg: 'scene' | 'hospital' | null;
  unitRef: string;
  callsign: string;
  unitKind: string;
  unit: LngLat | null;
  /** Compass heading of travel, derived from the last two fixes. */
  heading: number | null;
  incidentRef: string;
  incident: LngLat;
  priority: Priority;
  kind: string;
  zoneName: string | null;
  hospital: { ref: string; name: string; position: LngLat } | null;
  /** The road still ahead, from the unit's position to its destination. */
  path: LngLat[] | null;
  /** Where it has been, newest last — accumulated client-side from the position feed. */
  trail: LngLat[];
  reportedAt: string;
  onsceneAt: string | null;
  etaPredictedAt: string | null;
  /** Seconds until the predicted arrival; negative when overdue. Null before dispatch. */
  etaSec: number | null;
  /** The congested stretches of the road ahead — the ONLY traffic this map draws, and
   *  simulated in this build (server/sim/traffic.js). */
  traffic: TrafficStretch[];
  trafficDelaySec: number;
  remainingM: number | null;
  speedKmh: number | null;
}

/** A live emergency with nobody assigned yet — the alerts that need a unit NOW. */
export interface LiveAlert {
  ref: string;
  priority: Priority;
  kind: string;
  position: LngLat;
  zoneName: string | null;
  reportedAt: string;
  /** Seconds since the call landed. */
  waitingSec: number;
}

export interface LiveResponseData {
  responses: LiveResponse[];
  alerts: LiveAlert[];
  at: string;
}

const findResponse = (data: LiveResponseData, id: string) =>
  data.responses.find((x) => x.ref === id || x.incidentRef === id || x.unitRef === id);

// ── Encoding ─────────────────────────────────────────────────────────────────

/** Column height in PIXELS on screen. Priority is height FIRST, colour second. */
const COLUMN_PX: Record<Priority, number> = { P1: 58, P2: 42, P3: 28, P4: 18 };
/** Radius of the column, in pixels. */
const COLUMN_RADIUS_PX = 5;

// ColumnLayer sizes in metres. Everything about an alert column is a screen quantity —
// "tall enough to spot from the other side of the emirate" — so the metres are derived
// from the pixels (vehicle3d.metresPerPixel), not chosen as metres and left to shrink
// into nothing when zoomed out.
/** The link is a relationship, not a road: thin, and the same weight for every priority —
 *  priority is already carried by the column it points at. */
const LINK_WIDTH_PX = 2.5;
/** Dash, gap — in multiples of the line width (PathStyleExtension's unit). */
const LINK_DASH: [number, number] = [3, 2.2];
/** One instance for the life of the module: deck.gl compares extensions by identity, and a
 *  new one every frame would recompile the shader every frame. */
const DASHED = new PathStyleExtension({ dash: true });
/** Two ambulances leaving one station together would print their ETA chips on top of
 *  each other. Colliding chips are thinned instead, the more urgent call's chip winning —
 *  every ETA is in the response rail regardless, so nothing is lost by hiding one. */
const DECLUTTER = new CollisionFilterExtension();
const LABEL_RANK: Record<Priority, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };
/** Where the callsign chip sits under a vehicle. */
const LABEL_OFFSET_PX = 30;

const priorityToken = (p: Priority) =>
  (p === 'P1' ? '--app-danger' : p === 'P2' ? '--app-accent' : p === 'P3' ? '--app-info' : '--app-text-muted');

const priorityColour = (p: Priority, alpha = 1): Rgba => rgba(priorityToken(p), alpha);

/**
 * Every line on this map means ONE thing, and its colour says which:
 *
 *   amber, solid      the road ahead, to the patient
 *   blue, solid       the road ahead, to hospital
 *   violet, dashed    "this ambulance is assigned to that incident" — not a road at all
 *
 * The road to a patient used to take the CALL's priority colour instead, which made a P3's
 * route to its patient the same blue as another crew's route to hospital, and a P1's route
 * the same red as the congestion overlay. Priority is already carried four other ways —
 * the triangle's colour, the column's height, the label and the route's width — so the
 * route's colour is free to say where the crew is going, which is what an operator asks.
 */
const legColour = (r: LiveResponse, alpha = 1): Rgba =>
  (r.leg === 'hospital' ? rgba('--app-info', alpha) : rgba('--app-accent', alpha));

/** Every live call: the ones being responded to, plus the ones still waiting. */
const columns = memoOn((d: LiveResponseData): Array<{ ref: string; position: LngLat; priority: Priority; kind: string; covered: boolean; label: string }> => [
  ...d.responses.map((r) => ({ ref: r.incidentRef, position: r.incident, priority: r.priority, kind: r.kind, covered: true, label: r.priority })),
  ...d.alerts.map((a) => ({ ref: a.ref, position: a.position, priority: a.priority, kind: a.kind, covered: false, label: a.priority })),
]);

/** Triangle height at the foot of a column, in pixels. */
const HAZARD_PX: Record<Priority, number> = { P1: 26, P2: 23, P3: 21, P4: 17 };

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What the chip under an ambulance says: its callsign, and how long until it arrives —
 *  with the unit, because "Medic 7 · 3:12" is a clock time to anyone glancing at a wall. */
function vehicleLabel(r: LiveResponse): string {
  if (r.state === 'onscene' || r.onsceneAt) return `${r.callsign} · on scene`;
  if (r.leg === 'hospital') return `${r.callsign} → hospital`;
  if (r.etaSec == null) return r.callsign;
  return r.etaSec < 0
    ? `${r.callsign} · ${mmss(-r.etaSec)} min late`
    : `${r.callsign} · ETA ${mmss(r.etaSec)} min`;
}

// ── The layer ────────────────────────────────────────────────────────────────

export const liveResponseLayer = defineLayer<LiveResponseData>({
  id: 'live',
  group: 'operational',
  label: 'map.layer.live',
  order: 95,
  defaultVisible: true,
  source: { kind: 'feed' },
  animated: (d) => d.responses.length > 0 || d.alerts.length > 0,
  // The key is the map's vocabulary, in the order the eye meets it: what an incident looks
  // like at each priority, then the three kinds of line. Each row is also a filter.
  legend: [
    { label: 'map.legend.liveP1', key: 'P1', swatch: { kind: 'hazard', token: '--app-danger' } },
    { label: 'map.legend.liveP2', key: 'P2', swatch: { kind: 'hazard', token: '--app-accent' } },
    { label: 'map.legend.liveP3', key: 'P3', swatch: { kind: 'hazard', token: '--app-info' } },
    { label: 'map.legend.liveP4', key: 'P4', swatch: { kind: 'hazard', token: '--app-text-muted' } },
    { label: 'map.legend.liveAlert', key: 'alert', swatch: { kind: 'hazard-ring', token: '--app-danger' } },
    { label: 'map.legend.liveEnroute', key: 'enroute', swatch: { kind: 'line', token: '--app-accent' } },
    { label: 'map.legend.liveTraffic', key: 'enroute', swatch: { kind: 'line', token: '--app-danger' } },
    { label: 'map.legend.liveLink', key: 'link', swatch: { kind: 'dashed', token: '--map-link' } },
    { label: 'map.legend.liveToHospital', key: 'hospital', swatch: { kind: 'line', token: '--app-info' } },
  ],
  filterFor: (data, key) => {
    if (key === 'P1' || key === 'P2' || key === 'P3' || key === 'P4') {
      return { ...data, responses: data.responses.filter((r) => r.priority === key), alerts: data.alerts.filter((a) => a.priority === key) };
    }
    if (key === 'alert') return { ...data, responses: [] };
    if (key === 'hospital') return { ...data, alerts: [], responses: data.responses.filter((r) => r.leg === 'hospital') };
    // The link and the road ahead both belong to the drive to the patient.
    return { ...data, alerts: [], responses: data.responses.filter((r) => r.leg !== 'hospital') };
  },

  deck: (data, ctx) => {
    const selected = ctx.selection?.layerId === 'live' ? ctx.selection.id : null;
    const phase = ctx.reducedMotion ? 0.4 : pulsePhase(ctx, 2200);

    const rows = sampled(data, ctx.now);

    return [
      ...alertColumns(data, ctx, phase, selected),
      ...roadAhead(rows, ctx),
      ...trafficOnRoute(rows, ctx),
      ...trails(rows, ctx),
      ...assignmentLinks(rows, ctx),
      ...vehicles(rows, data, ctx, selected),
    ];
  },

  pick: (hit, data) => {
    if (hit.source !== 'deck') return null;
    const o = hit.object as { ref?: string; incidentRef?: string; position?: LngLat; unit?: LngLat };
    const ref = o.incidentRef ?? o.ref;
    if (!ref) return null;
    const response = data.responses.find((r) => r.ref === ref || r.incidentRef === ref);
    // The vehicle itself is a different question from its route or its call: a click on
    // the ambulance asks about the AMBULANCE (crew, vehicle, telemetry).
    const onVehicle = hit.layerId.startsWith('live:vehicle');
    return {
      layerId: 'live',
      kind: response ? (onVehicle ? 'vehicle' : 'response') : 'alert',
      id: ref,
      lngLat: (o.unit ?? o.position ?? response?.incident ?? [0, 0]) as LngLat,
      data: response ?? data.alerts.find((a) => a.ref === ref),
    };
  },

  /** Following a response tracks the AMBULANCE, not the call — the call does not move. */
  locate: (data, id) => {
    const r = findResponse(data, id);
    if (r?.unit) return r.unit;
    return data.alerts.find((a) => a.ref === id)?.position ?? null;
  },

  /** A chase camera turns with the ambulance, not with the call. */
  bearingOf: (data, id) => findResponse(data, id)?.heading ?? null,

  /**
   * Riding with an ambulance: the camera is placed on the SAME dead-reckoned position the
   * vehicle is drawn at this frame, so it travels at the vehicle's own speed and the two
   * cannot drift apart. Where the motion model is not running, the last fix.
   */
  locateNow: (data, id, now) => {
    const r = findResponse(data, id);
    if (!r?.unit) return null;
    const s = liveMotion.sample(r.unitRef, now);
    return s ? { at: s.at, heading: s.heading ?? r.heading } : { at: r.unit, heading: r.heading };
  },

  popup: LiveResponsePopup,
});

// ── Where each vehicle is, this frame ────────────────────────────────────────

/**
 * Every responding vehicle as it stands at `ctx.now`: its dead-reckoned position and
 * heading (live/liveMotion.ts), the road still ahead trimmed to start exactly under it,
 * and its trail extended to meet it. Drawn at the last fix instead, the vehicle sits still
 * for most of every second and the route ahead starts somewhere behind it.
 *
 * Maps that do not run the motion model (Operations) get the fixes as they are.
 */
function sampled(data: LiveResponseData, now: number): LiveResponse[] {
  return data.responses.map((r) => {
    const s = r.unit ? liveMotion.sample(r.unitRef, now) : null;
    if (!s) return r;
    return {
      ...r,
      unit: s.at,
      heading: s.heading ?? r.heading,
      path: s.ahead && s.ahead.length > 1 ? s.ahead : r.path,
      trail: r.trail.length ? [...r.trail, s.at] : r.trail,
    };
  });
}

// ── Parts ────────────────────────────────────────────────────────────────────

/**
 * A column of light from every live call.
 *
 * Height is priority (P1 stands nearly a kilometre tall), so the most urgent call is the
 * one you see first from across the emirate — and it stays legible at a tilt, where a
 * ground dot disappears behind a tower. A call with nobody assigned pulses; a covered one
 * stands steady, so "still waiting" is a motion cue rather than another colour.
 */
function alertColumns(data: LiveResponseData, ctx: LayerContext, phase: number, selected: string | null): Layer[] {
  const cells = columns(data);
  if (!cells.length) return [];

  const mpp = metresPerPixel(ctx.zoom);

  return [
    new ColumnLayer<(typeof cells)[number]>({
      id: 'live:columns',
      data: cells,
      pickable: true,
      diskResolution: 12,
      radius: COLUMN_RADIUS_PX * mpp,
      extruded: true,
      elevationScale: 1,
      getPosition: (c) => c.position,
      getElevation: (c) => COLUMN_PX[c.priority] * mpp * (c.covered ? 1 : 0.85 + phase * 0.4),
      getFillColor: (c) => priorityColour(c.priority, c.covered ? 0.32 : 0.55),
      getLineColor: (c) => priorityColour(c.priority, c.ref === selected ? 1 : 0.8),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (c) => (c.ref === selected ? 2.5 : 1),
      material: false,
      transitions: { getElevation: ctx.reducedMotion ? 0 : 300 },
      updateTriggers: {
        getFillColor: [ctx.theme],
        getLineColor: [ctx.theme, selected],
        getLineWidth: [selected],
        getElevation: [phase, ctx.zoom],
      },
    }),

    // The foot of the column is the incident's own symbol — the road-warning triangle
    // with the kind of incident inside it (layers/kit.ts hazardMarker), the SAME mark the
    // incidents layer and the Operations map draw. It used to be a faint disc, which put
    // a live call into the same round family as the ambulances beside it; now the column
    // says "urgent" and the triangle says "incident", and neither can be read as a vehicle.
    // Drawn over the buildings, so a tower between the camera and the call cannot hide
    // what it is.
    ...hazardMarker({
      id: 'live:hazard',
      data: cells,
      ctx,
      position: (c) => c.position,
      glyph: (c) => incidentGlyph(c.kind),
      fill: (c) => priorityColour(c.priority),
      glyphColor: () => rgba('--app-on-color'),
      ring: (c) => (c.ref === selected ? rgba('--app-text') : null),
      size: (c) => HAZARD_PX[c.priority],
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      triggers: [selected],
    }),
  ];
}

/** The road still ahead: a casing for legibility over any basemap, then the lit path. */
function roadAhead(rows: LiveResponse[], ctx: LayerContext): Layer[] {
  const driving = rows.filter((r) => r.unit && r.path && r.path.length > 1);
  if (!driving.length) return [];
  const panel = rgba('--app-panel', 0.9);

  return [
    new PathLayer<LiveResponse>({
      id: 'live:route-casing',
      data: driving,
      widthUnits: 'pixels',
      getPath: (r) => r.path as LngLat[],
      getWidth: 9,
      getColor: panel,
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
    new PathLayer<LiveResponse>({
      id: 'live:route',
      data: driving,
      pickable: true,
      widthUnits: 'pixels',
      getPath: (r) => r.path as LngLat[],
      getWidth: (r) => (r.priority === 'P1' ? 5 : 4),
      getColor: (r) => legColour(r, 0.95),
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}

/**
 * Traffic, drawn ONLY where it matters: on the stretches of an ambulance's own road that
 * are congested, in red, over the route.
 *
 * The map used to draw the whole signal network and every corridor's congestion level at
 * once — green dashes between a dozen junctions — and the operator had to work out which
 * of it lay on the crew's way. Now the question is answered for them: if the road ahead of
 * a crew is red somewhere, that is where it will slow down, and nothing else is coloured.
 * Heavy traffic is the solid red; slow traffic the same red, thinner and lighter. A queue
 * behind a collision is heavy by definition. Simulated in this build, and the legend says so.
 */
function trafficOnRoute(rows: LiveResponse[], ctx: LayerContext): Layer[] {
  const stretches = rows
    .filter((r) => r.unit && r.path && r.path.length > 1)
    .flatMap((r) => r.traffic.map((t, i) => ({ ...t, id: `${r.ref}:${i}`, p1: r.priority === 'P1' })));
  if (!stretches.length) return [];
  return [
    new PathLayer<(typeof stretches)[number]>({
      id: 'live:traffic',
      data: stretches,
      widthUnits: 'pixels',
      getPath: (t) => t.path,
      getWidth: (t) => (t.level === 'heavy' ? 6 : 4.5) + (t.p1 ? 0.5 : 0),
      getColor: (t) => rgba('--app-danger', t.level === 'heavy' ? 1 : 0.72),
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}

/**
 * Where the ambulance has already been — a tail that fades out behind it.
 *
 * TripsLayer wants a timestamp per vertex; the trail is sampled at a steady interval, so
 * the index IS the time. `currentTime` is pinned to the newest sample so the whole tail is
 * always in frame, and `trailLength` controls how far back it stays visible.
 */
function trails(rows: LiveResponse[], ctx: LayerContext): Layer[] {
  const tailed = rows.filter((r) => r.trail.length > 1);
  if (!tailed.length) return [];
  const longest = Math.max(...tailed.map((r) => r.trail.length));

  return [
    new TripsLayer<LiveResponse>({
      id: 'live:trail',
      data: tailed,
      getPath: (r) => r.trail,
      getTimestamps: (r) => r.trail.map((_, i) => i + (longest - r.trail.length)),
      getColor: (r) => legColour(r, 1),
      widthUnits: 'pixels',
      getWidth: 3,
      opacity: 0.75,
      // Newest sample is at the end of every trail; the longest one sets "now".
      currentTime: longest,
      trailLength: Math.max(8, Math.round(longest * 0.8)),
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      parameters: FLAT,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}

/**
 * The displacement line: a straight, dashed violet link from each responding ambulance to
 * the call it has been given.
 *
 * This is the "is anyone going?" answer, and it works at every zoom: at the emirate level
 * the route is an illegible squiggle, but a straight line is one clean gesture from a
 * vehicle to a column. It shortens as the ambulance closes in — the link collapsing to
 * nothing IS the arrival.
 *
 * It used to be an arc in the call's priority colour, fading from the accent at the
 * ambulance: the same amber as the road ahead of a P2, springing from the same vehicle to
 * the same place. Operators read the two as one thing and asked which way the crew was
 * really going. So everything about it now says "not a road": it is STRAIGHT where a route
 * bends, DASHED where a route is solid, and VIOLET — `--map-link`, a hue reserved for it
 * and used by no operational layer — where every road on this map is a priority or
 * transport colour. It is drawn over the buildings (depthCompare: always) so a tower
 * standing between the two cannot break the relationship it states.
 *
 * Hidden while riding with a vehicle: at street height it is a line across the windscreen,
 * and the road ahead already says where the crew is going.
 */
function assignmentLinks(rows: LiveResponse[], ctx: LayerContext): Layer[] {
  const scene = rows.filter((r): r is LiveResponse & { unit: LngLat } => !!r.unit && r.leg === 'scene');
  if (!scene.length || ctx.follow?.layerId === 'live') return [];
  const link = rgba('--map-link', 0.95);
  const over = { depthCompare: 'always' as const, depthWriteEnabled: false };

  return [
    new PathLayer<LiveResponse>({
      id: 'live:link',
      data: scene,
      pickable: true,
      widthUnits: 'pixels',
      getPath: (r) => [r.unit as LngLat, r.incident],
      getWidth: LINK_WIDTH_PX,
      getColor: link,
      capRounded: true,
      // PathStyleExtension's props are not in PathLayer's own type; spread them untyped.
      ...({ getDashArray: LINK_DASH, dashJustified: true, dashGapPickable: true } as object),
      extensions: [DASHED],
      parameters: over,
      updateTriggers: { getColor: [ctx.theme] },
    }),

    // A small violet crosshair where the link lands, so the end of the line reads as
    // "this call" even where the column above it is hidden behind a tower at a tilt.
    new IconLayer<LiveResponse>({
      id: 'live:link-end',
      data: scene,
      sizeUnits: 'pixels',
      getPosition: (r) => r.incident,
      getIcon: () => glyphIcon('crosshair', 2.5),
      getSize: 16,
      getColor: link,
      parameters: over,
      updateTriggers: { getColor: [ctx.theme] },
    }),
  ];
}

/**
 * The ambulances themselves (layers/vehicle3d.ts draws them), and the chip under each one
 * saying who it is and how long until it arrives.
 */
function vehicles(rows: LiveResponse[], data: LiveResponseData, ctx: LayerContext, selected: string | null): Layer[] {
  const placed = rows.filter((r): r is LiveResponse & { unit: LngLat } => !!r.unit);
  if (!placed.length) return [];
  const riding = ctx.follow?.layerId === 'live' ? ctx.follow.id : null;
  const isRiding = (r: LiveResponse) => r.ref === riding || r.incidentRef === riding || r.unitRef === riding;

  return [
    ...vehicleLayers<LiveResponse>({
      id: 'live:vehicle',
      data: placed,
      ctx,
      position: (r) => r.unit as LngLat,
      heading: (r) => r.heading,
      tone: (r) => legColour(r),
      focus: isRiding,
      selected: (r) => r.ref === selected || r.incidentRef === selected,
      // Blue lights to the patient and to hospital; off once the crew is on scene.
      lights: (r) => !(r.state === 'onscene' || (r.onsceneAt && r.leg !== 'hospital')),
      triggers: [selected],
    }),

    new TextLayer<LiveResponse>({
      id: 'live:vehicle-label',
      // The vehicle being ridden with is named in the banner; a chip on it would sit
      // across the windscreen.
      data: placed.filter((r) => !isRiding(r)),
      getPosition: (r) => r.unit as LngLat,
      getText: vehicleLabel,
      getSize: 11,
      sizeUnits: 'pixels',
      getPixelOffset: [0, LABEL_OFFSET_PX],
      getColor: rgba('--app-text'),
      fontFamily: fontStack('--font-mono'),
      fontWeight: 700,
      characterSet: 'auto',
      background: true,
      getBackgroundColor: (r) => (r.etaSec != null && r.etaSec < 0 ? rgba('--app-danger', 0.9) : rgba('--app-panel', 0.94)),
      backgroundBorderRadius: 4,
      backgroundPadding: [5, 3],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      visible: ctx.zoom >= 11,
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      extensions: [DECLUTTER],
      // CollisionFilterExtension's props, likewise untyped on TextLayer.
      ...({ collisionEnabled: true, collisionGroup: 'live-vehicle-labels', getCollisionPriority: (r: LiveResponse) => LABEL_RANK[r.priority] } as object),
      updateTriggers: {
        getColor: [ctx.theme],
        getBackgroundColor: [ctx.theme],
        getText: [data.at],
      },
    }),
  ];
}
