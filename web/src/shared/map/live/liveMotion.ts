/**
 * The live map's motion model, fed from the two streams that describe a moving ambulance:
 *
 *   /api/live/assignments   the road still ahead of each crew (every 3 s, and on change)
 *   socket `unit:position`  where each one is and how fast it is going (about once a second)
 *
 * Kept out of the layer and out of React. The layer and the chase camera SAMPLE it inside
 * the animation frame (see ../motion.ts); this module only feeds it, and only while a live
 * map is on screen.
 */

import { VehicleMotion } from '../motion';
import { liveRoutesStore } from '../../../lib/stores/live';
import { onSocket } from '../../../lib/socket';

/** Keyed by unit ref: a unit has one position whatever job it is on. */
export const liveMotion = new VehicleMotion();

function feedRoutes(): void {
  const data = liveRoutesStore.get().data;
  if (!data) return;
  const now = performance.now();
  const keep = new Set<string>();
  for (const a of data.assignments) {
    if (!a.unitPosition) continue;
    keep.add(a.unitRef);
    // First sight of a unit: start it where the server says it is.
    if (!liveMotion.has(a.unitRef)) liveMotion.fix(a.unitRef, a.unitPosition, null, now);
    liveMotion.route(a.unitRef, a.path, now);
    // No road ahead (on scene, at hospital, a phone the simulation is not steering): the
    // vehicle glides to a fix. Arrived at the scene or the hospital, that fix is the
    // PLACE it arrived at, not the last GPS sample along the road — the last road fix
    // lands wherever the route happened to end (the nearest driveable point), which can
    // read as short of the actual marker; the assignment already carries the exact
    // incident/hospital coordinate to settle onto instead.
    if (!a.path || a.path.length < 2) {
      const arrivedAt = a.state === 'onscene' ? a.incidentPosition
        : a.state === 'transporting' && a.hospital ? a.hospital.position
        : a.unitPosition;
      liveMotion.fix(a.unitRef, arrivedAt, null, now);
    }
  }
  liveMotion.retain(keep);
}

let users = 0;
let offs: Array<() => void> = [];

/** Start feeding the model; the returned function stops. Counted, so two maps can share it. */
export function wireLiveMotion(): () => void {
  if (users++ === 0) {
    offs = [
      liveRoutesStore.subscribe(feedRoutes),
      onSocket('unit:position', (frames) => {
        const now = performance.now();
        for (const f of frames) {
          // Only units on a job are modelled; the idle fleet is drawn by the units layer.
          if (liveMotion.has(f.unitRef)) liveMotion.fix(f.unitRef, [f.lng, f.lat], f.speed, now);
        }
      }),
    ];
    feedRoutes();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--users === 0) {
      for (const off of offs) off();
      offs = [];
    }
  };
}
