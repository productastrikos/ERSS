/**
 * The camera estate — every CCTV the detection engine watches.
 *
 * One kind, because the trial watches the road (config/poc.js):
 *
 *   junction — RTA traffic cameras on signal masts. Fixed bearing, wide field, looking
 *              at a carriageway. These are the cameras that see a collision.
 *
 * The indoor estate — three cameras inside The NEST, and the building and room model that
 * made "floor 3, server room" a dispatchable address — went with the indoor scenario, and
 * is kept in `_archive/indoor-scenario/`.
 *
 * The trial's OTHER cameras are not here: two on each of the eight ambulances, one on the
 * road ahead and one on the cab. They move with the vehicle rather than standing on a
 * mast, so they are named on the incidents they raise (`detected_by` — sim/live.js) rather
 * than drawn as a fixed estate on the map.
 *
 * A camera is reference data, not simulation state: the map draws the estate whether or
 * not anything is happening on it, and `engines/detection.js` cites cameras by id as the
 * evidence for a detection. The clip is what the console plays when an operator opens
 * the feed — in production this is an RTSP/HLS URL, here it is a file in web/public/media.
 *
 * Bearings are compass degrees (0 = north) for the direction the camera LOOKS, which is
 * what the map needs to draw its view cone.
 */

/** Cameras whose analytics are enabled raise detections; the rest are watch-only. */
export const CAMERAS = [
  // ── DSO Central Roundabout — the junction the collision happens at ──────────
  {
    id: 'RTA-CAM-101A',
    name: 'DSO Central Roundabout — north mast',
    kind: 'junction',
    agencyCode: 'RTA',
    lng: 55.38195, lat: 25.12712,
    bearing: 168, fovDeg: 78, rangeM: 120,
    signalId: 'DSO-SIG-101',
    buildingId: null, floor: null, roomId: null,
    analytics: ['incident_detection', 'speed', 'density'],
    clipUrl: '/media/rw_crash_cam_a.mp4',
    idleClipUrl: '/media/traffic_cctv_2.mp4',
  },
  {
    id: 'RTA-CAM-101B',
    name: 'DSO Central Roundabout — south-east mast',
    kind: 'junction',
    agencyCode: 'RTA',
    lng: 55.38281, lat: 25.12588,
    bearing: 318, fovDeg: 78, rangeM: 120,
    signalId: 'DSO-SIG-101',
    buildingId: null, floor: null, roomId: null,
    analytics: ['incident_detection', 'density'],
    clipUrl: '/media/rw_crash_cam_b.mp4',
    idleClipUrl: '/media/traffic_cctv_4.mp4',
  },
  // Context cameras on the approaches — no analytics, but an operator opens them to see
  // how far the queue has reached.
  {
    id: 'RTA-CAM-102',
    name: 'DSO West Boulevard Junction',
    kind: 'junction', agencyCode: 'RTA',
    lng: 55.37840, lat: 25.12290,
    bearing: 45, fovDeg: 72, rangeM: 110,
    signalId: 'DSO-SIG-102',
    buildingId: null, floor: null, roomId: null,
    analytics: ['density'],
    clipUrl: '/media/traffic_cctv_7.mp4',
    idleClipUrl: '/media/traffic_cctv_7.mp4',
  },
  {
    id: 'RTA-CAM-103',
    name: 'Academic City Road Entry',
    kind: 'junction', agencyCode: 'RTA',
    lng: 55.38650, lat: 25.13010,
    bearing: 225, fovDeg: 72, rangeM: 110,
    signalId: 'DSO-SIG-103',
    buildingId: null, floor: null, roomId: null,
    analytics: ['density'],
    clipUrl: '/media/traffic_cctv_9.mp4',
    idleClipUrl: '/media/traffic_cctv_9.mp4',
  },

];

const BY_ID = new Map(CAMERAS.map((c) => [c.id, c]));

export const cameraById = (id) => BY_ID.get(id) ?? null;
export const camerasFor = (ids = []) => ids.map(cameraById).filter(Boolean);

