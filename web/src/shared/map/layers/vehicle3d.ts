/**
 * Drawing an ambulance — one implementation, used by the live map and by the replay.
 *
 * A vehicle on this map is a SOLID turned to its heading: a shape that is not a circle
 * cannot be confused with the forty circles around it, and a shape with a front says which
 * way the crew is travelling without an arrow orbiting it. The model is
 * icons/vehicleMesh.ts; this file decides how big it is drawn, what it stands on, and what
 * it turns into when it is too small to model.
 *
 * THE SCALE PROBLEM. A 3D object that holds a constant size on screen has to grow
 * physically as the camera pulls back — held at 40 px from the emirate view this one would
 * be a kilometre long, a white monolith sorting in front of towers it is nowhere near. So
 * the model is capped at a few times life size (a long lorry: an exaggeration nobody reads
 * as one), and below the zoom where that is still big enough to make out it becomes the
 * same vehicle seen from directly above, laid flat on the road. Zooming out is a change of
 * detail, never a change of object.
 *
 * OCCLUSION. The map is interleaved with MapLibre's buildings, so a tower in front of the
 * vehicle hides it — correct, and the reason the city reads as solid. But a chase camera
 * sits behind and above the vehicle, and in the Marina that puts a tower between the two
 * more often than not. So an x-ray pass draws a faint silhouette wherever the vehicle is
 * behind something: it is never lost, and it is never mistaken for being in front.
 */

import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import type { Layer } from '@deck.gl/core';
import type { LayerContext } from '../layerRegistry';
import { AMBULANCE_LENGTH_M, ambulanceBeaconMesh, ambulanceMesh, ambulanceTopIcon, headingToOrientation } from '../icons/vehicleMesh';
import { rgba, type Rgba } from '../tokens';

type LngLat = [number, number];

/** Ground metres per screen pixel at Dubai's latitude. */
const COS_LAT = Math.cos(25.2 * (Math.PI / 180));
export const metresPerPixel = (zoom: number) => (156_543.03 * COS_LAT) / 2 ** zoom;

/** On-screen length the model aims for, in pixels, while the cap allows it. */
const TARGET_PX = 40;
/** The vehicle being ridden with is the subject of the screen, and is drawn larger. */
const FOCUS_PX = 58;
/** Never more than a long lorry — past this the model is scenery standing over the city. */
const MAX_SCALE = 4;
const FOCUS_MAX_SCALE = 6.5;
/** Below this drawn length the top-down symbol reads better — and at about the symbol's
 *  own size, so the hand-over from one to the other is not a jump in size. */
const MODEL_MIN_PX = 28;
/** The symbol's length on screen. */
const SYMBOL_PX = 34;

/** Lit, slightly glossy paint: enough shading to read every panel at a tilt. */
const PAINT = { ambient: 0.5, diffuse: 0.62, shininess: 48, specularColor: [70, 70, 70] as [number, number, number] };

/** Depth rules for the x-ray silhouette: drawn ONLY where something is in front of it. */
const XRAY = { depthCompare: 'greater' as const, depthWriteEnabled: false };
/**
 * Ground marks test against depth (a tower in front still hides them) but never WRITE it.
 * Two flat marks at z = 0 that both write depth fight pixel by pixel — that is what tore
 * the route line into red-and-black shreds under a tilted camera.
 */
export const FLAT = { depthWriteEnabled: false };

export function vehicleScale(zoom: number, focus = false): number {
  const wanted = ((focus ? FOCUS_PX : TARGET_PX) * metresPerPixel(zoom)) / AMBULANCE_LENGTH_M;
  return Math.min(focus ? FOCUS_MAX_SCALE : MAX_SCALE, Math.max(1, wanted));
}

export interface VehicleOptions<T> {
  /** Descriptor-prefixed base id, e.g. `live:vehicle`. */
  id: string;
  data: T[];
  ctx: LayerContext;
  position: (d: T) => LngLat;
  heading: (d: T) => number | null;
  /** The ring under the vehicle — what it is doing (to a patient, to hospital). */
  tone: (d: T) => Rgba;
  /** The vehicle a camera is riding with: drawn larger, ring brighter. */
  focus?: (d: T) => boolean;
  selected?: (d: T) => boolean;
  /** Beacons flashing — on a job under blue lights. */
  lights?: (d: T) => boolean;
  pickable?: boolean;
  /** Values that should rebuild colours when they change. */
  triggers?: unknown[];
  /**
   * Floor the model's on-screen length, boosting scale past MAX_SCALE/FOCUS_MAX_SCALE if
   * that's what it takes. The realism cap exists so a pulled-back live map of forty
   * real-scale vehicles never turns into forty lorries; a replay draws exactly one
   * ambulance on an otherwise empty stage, so there is no fleet to distort and every
   * reason to keep it a solid instead of handing it to the flat top-down symbol the
   * instant its framed overview zooms out past MODEL_MIN_PX.
   */
  minModelPx?: number;
}

export function vehicleLayers<T>(o: VehicleOptions<T>): Layer[] {
  if (!o.data.length) return [];
  const { ctx } = o;
  const triggers = [ctx.theme, ...(o.triggers ?? [])];
  const isFocus = o.focus ?? (() => false);
  const isSelected = o.selected ?? (() => false);
  const lit = o.lights ?? (() => true);
  const orientation = (d: T) => headingToOrientation(o.heading(d));
  const mpp = metresPerPixel(ctx.zoom);

  const focused = o.data.filter(isFocus);
  const others = o.data.filter((d) => !isFocus(d));

  // Alternating flash: red, blue, red, blue — steady (both lit, dimmer) under reduced motion.
  const cycle = ctx.reducedMotion ? 0 : (ctx.now % 640) / 640;
  const left = ctx.reducedMotion ? 0.85 : cycle < 0.5 ? 1 : 0.18;
  const right = ctx.reducedMotion ? 0.85 : cycle < 0.5 ? 0.18 : 1;

  const layers: Layer[] = [];
  const groups: Array<[string, T[], boolean]> = [[`${o.id}`, others, false], [`${o.id}-focus`, focused, true]];

  for (const [id, rows, focus] of groups) {
    if (!rows.length) continue;
    let scale = vehicleScale(ctx.zoom, focus);
    let modelPx = (AMBULANCE_LENGTH_M * scale) / mpp;
    if (o.minModelPx != null && modelPx < o.minModelPx) {
      scale = (o.minModelPx * mpp) / AMBULANCE_LENGTH_M;
      modelPx = o.minModelPx;
    }
    const model = modelPx >= MODEL_MIN_PX;
    // Tucked just inside the vehicle's own length: a wider ring reads as a halo around it
    // rather than as the ground it is standing on.
    const ringM = (AMBULANCE_LENGTH_M * scale) * 0.42;

    // What it stands on: a tone ring (to a patient / to hospital), and a soft shadow.
    layers.push(new ScatterplotLayer<T>({
      id: `${id}:ring`,
      data: rows,
      radiusUnits: model ? 'meters' : 'pixels',
      getPosition: o.position,
      getRadius: model ? ringM : SYMBOL_PX * 0.62,
      getFillColor: (d) => withAlpha(o.tone(d), isSelected(d) ? 0.34 : 0.16),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (isSelected(d) || focus ? 2.5 : 1.5),
      getLineColor: (d) => withAlpha(o.tone(d), 0.95),
      parameters: FLAT,
      updateTriggers: { getFillColor: triggers, getLineColor: triggers, getLineWidth: triggers },
    }));

    if (!model) {
      layers.push(new IconLayer<T>({
        id: `${id}:symbol`,
        data: rows,
        pickable: o.pickable ?? true,
        billboard: false,
        sizeUnits: 'pixels',
        getPosition: o.position,
        getIcon: () => ambulanceTopIcon(),
        getSize: SYMBOL_PX,
        // deck.gl angles run counter-clockwise; a compass heading runs clockwise.
        getAngle: (d) => -(o.heading(d) ?? 0),
        parameters: FLAT,
      }));
      continue;
    }

    const common = {
      data: rows,
      getPosition: o.position,
      getOrientation: orientation,
      sizeScale: scale,
    };

    layers.push(
      // The x-ray silhouette first, while the depth buffer holds only what is in front.
      new SimpleMeshLayer<T>({
        ...common,
        id: `${id}:xray`,
        mesh: ambulanceMesh(),
        getColor: [255, 255, 255, 70],
        material: false,
        parameters: XRAY,
      }),
      new SimpleMeshLayer<T>({
        ...common,
        id: `${id}:body`,
        pickable: o.pickable ?? true,
        mesh: ambulanceMesh(),
        getColor: [255, 255, 255, 255],
        material: PAINT,
      }),
      // Beacons are unlit: a lamp is a light source, and shading one makes it look off.
      new SimpleMeshLayer<T>({
        ...common,
        id: `${id}:beacon-left`,
        mesh: ambulanceBeaconMesh('left'),
        getColor: (d) => (lit(d) ? scaleRgb(rgba('--app-danger'), left) : [70, 70, 72, 255]),
        material: false,
        updateTriggers: { getColor: [...triggers, left] },
      }),
      new SimpleMeshLayer<T>({
        ...common,
        id: `${id}:beacon-right`,
        mesh: ambulanceBeaconMesh('right'),
        getColor: (d) => (lit(d) ? scaleRgb(rgba('--app-info'), right) : [70, 70, 72, 255]),
        material: false,
        updateTriggers: { getColor: [...triggers, right] },
      }),
    );
  }
  return layers;
}

const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], Math.round(255 * a)];

/** Brighten or dim a lamp colour; a dim lamp keeps a floor so the lens still reads. */
function scaleRgb(c: Rgba, k: number): Rgba {
  const f = 0.35 + 0.65 * k;
  return [Math.min(255, c[0] * f + 40 * k), Math.min(255, c[1] * f + 40 * k), Math.min(255, c[2] * f + 40 * k), 255];
}
