/**
 * The follow camera — a camera that is bolted to a moving vehicle, frame by frame.
 *
 * The first version eased the camera to the vehicle each time a position arrived: a 900 ms
 * ease, then nothing until the next fix. Riding with an ambulance therefore meant watching
 * the city lurch forward, stop, lurch forward — and since the vehicle itself also sat
 * still between fixes, it read as "the ambulance doesn't move". This runs inside the map's
 * animation frame instead and places the camera on the vehicle's position FOR THAT FRAME
 * (see motion.ts), so the camera travels at exactly the vehicle's speed and the vehicle
 * stays put on screen while the city streams past it.
 *
 * What the camera owns while riding, and what it hands back:
 *   - centre      always the vehicle (entering, it glides there rather than cutting)
 *   - bearing     a chase turns with the vehicle, smoothed so a corner is a sweep
 *   - pitch       a chase tilts in to CHASE_PITCH so the towers stand up around the road
 *   - zoom        the operator's — the wheel and the +/- buttons still work, through
 *                 this class, because MapLibre's own zoom handlers are cancelled by the
 *                 per-frame camera update (`jumpTo` stops every running gesture)
 *   - a drag      is the operator taking the camera back, and releases the follow
 *
 * A chase puts the vehicle in the lower third of the view, satnav-style, so most of the
 * screen is the road ahead and the buildings along it rather than the tarmac behind.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { turn, type LngLat } from './motion';

/** Low enough to see the road ahead with the towers standing up, high enough for context. */
export const CHASE_PITCH = 62;
/** Street height: the vehicle is a vehicle, not a speck, and the blocks either side are in frame. */
export const CHASE_ZOOM = 17.1;
/** How much of the view's height sits above the vehicle in a chase. */
const LOOK_AHEAD = 0.3;

const ENTER_S = 0.55;    // how quickly the camera settles onto the vehicle when a ride starts
const ZOOM_S = 0.18;     // wheel zoom smoothing
const BEARING_S = 0.55;  // turn-with-the-vehicle smoothing
const MIN_ZOOM = 11;
const MAX_ZOOM = 19.5;

export interface FollowFix {
  at: LngLat;
  heading: number | null;
}

export class FollowCamera {
  private readonly map: MapLibreMap;
  private readonly chase: boolean;
  private readonly instant: boolean;
  private center: LngLat;
  private zoom: number;
  private zoomTarget: number;
  private pitch: number;
  private bearing: number;
  private look = 0;
  private last = 0;
  /** Where the camera was relative to the vehicle when the ride started; decays to zero. */
  private offset: LngLat | null = null;
  private start = 0;
  private disposed = false;

  constructor(map: MapLibreMap, opts: { chase: boolean; reducedMotion: boolean }) {
    this.map = map;
    this.chase = opts.chase;
    this.instant = opts.reducedMotion;
    const c = map.getCenter();
    this.center = [c.lng, c.lat];
    this.zoom = map.getZoom();
    this.zoomTarget = opts.chase ? Math.max(this.zoom, CHASE_ZOOM) : this.zoom;
    this.pitch = map.getPitch();
    this.bearing = map.getBearing();

    map.stop();
    map.scrollZoom.disable();
    map.getCanvasContainer().addEventListener('wheel', this.onWheel, { passive: false });
    map.on('zoomstart', this.onZoomButton);
  }

  /** Place the camera for this frame. `now` is the animation frame's timestamp (ms). */
  frame(fix: FollowFix, now: number): void {
    if (this.disposed) return;
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    const k = (tau: number) => (this.instant ? 1 : 1 - Math.exp(-dt / tau));

    // Centre: the vehicle, plus whatever offset the camera started from decaying to zero.
    // Chasing the vehicle exponentially instead would leave a permanent lag of speed × τ
    // behind it — a few metres that grow and shrink as it brakes, which reads as judder.
    if (!this.offset) {
      this.offset = [this.center[0] - fix.at[0], this.center[1] - fix.at[1]];
      this.start = now;
    }
    const left = this.instant ? 0 : Math.exp(-(now - this.start) / 1000 / (ENTER_S / 2));
    this.center = [fix.at[0] + this.offset[0] * left, fix.at[1] + this.offset[1] * left];
    this.zoom += (this.zoomTarget - this.zoom) * k(ZOOM_S);

    const opts: Parameters<MapLibreMap['jumpTo']>[0] = { center: this.center, zoom: this.zoom };
    if (this.chase) {
      this.pitch += (CHASE_PITCH - this.pitch) * k(ENTER_S);
      if (fix.heading != null) this.bearing = (this.bearing + turn(this.bearing, fix.heading) * k(BEARING_S) + 360) % 360;
      this.look += (LOOK_AHEAD - this.look) * k(ENTER_S);
      const h = this.map.getCanvas().clientHeight || 600;
      opts.pitch = this.pitch;
      opts.bearing = this.bearing;
      opts.padding = { top: Math.round(h * this.look), bottom: 0, left: 0, right: 0 };
    } else {
      // A plain follow centres the object — including straight after a chase whose padding
      // reset was cut short by this follower starting.
      opts.padding = { top: 0, bottom: 0, left: 0, right: 0 };
    }
    this.map.jumpTo(opts);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.map.getCanvasContainer().removeEventListener('wheel', this.onWheel);
    this.map.off('zoomstart', this.onZoomButton);
    this.map.scrollZoom.enable();
    // The look-ahead padding is camera state MapLibre keeps; leaving it would offset every
    // later fitBounds and flyTo by a third of the screen.
    if (this.chase) this.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: this.instant ? 0 : 400 });
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    this.zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoomTarget - px / 320));
  };

  /** The +/- buttons start an ease that the next frame would cancel; take their intent. */
  private readonly onZoomButton = (e: { originalEvent?: Event }) => {
    const button = (e.originalEvent?.target as Element | null | undefined)?.closest?.('button');
    if (!button) return;
    if (button.classList.contains('maplibregl-ctrl-zoom-in')) this.zoomTarget = Math.min(MAX_ZOOM, this.zoomTarget + 1);
    else if (button.classList.contains('maplibregl-ctrl-zoom-out')) this.zoomTarget = Math.max(MIN_ZOOM, this.zoomTarget - 1);
  };
}
