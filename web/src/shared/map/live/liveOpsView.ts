/**
 * The live operations map's view and cameras.
 *
 * Module-level, so the camera position, the layer switches and an active chase all
 * survive leaving the page and coming back — walking to Insights and returning should not
 * reset a duty officer's screen. Kept out of `LiveOpsMap.tsx` so that file exports only a
 * component, which is what Fast Refresh needs to hot-reload the map without a full page
 * reload during a demo.
 */

import { createMapView } from '../layerRegistry';
import { LIVE_OPS_LAYERS } from '../layers';

/**
 * What is on the map when it opens: the calls, the ambulances, the links between them,
 * the cameras that raised the calls, and the city. Nothing else.
 *
 * Operators said the map had too many things on it to read, and they were right — it
 * opened with every station, every hospital, twelve signals, thirteen congestion
 * corridors and the building-management estate all drawn at once around the one thing
 * that mattered. Each of those is still one click away in the layer control; none of
 * them is on by default, because none of them answers "which call has nobody going to
 * it, and where has each ambulance got to?".
 *
 * The signals come on BY THEMSELVES while a camera-confirmed collision is being handled
 * (LiveOpsMap), because then the junction lock and the diversion are part of the
 * response the room is watching — and go off again when it is over.
 */
export const liveOpsMap = createMapView('live-ops', LIVE_OPS_LAYERS, {
  visible: {
    zones: false, stations: false, hospitals: false, traffic: false,
    // Buildings are the point of the tilted view; the camera estate is the point of the
    // trial. Both start on.
    buildings: true, cameras: true,
  },
});

/**
 * The resting camera: the trial catchment, tilted enough for the alert columns to stand up.
 *
 * Silicon Oasis out to Mirdif and Al Rashidiya — where the eight trial ambulances are
 * stationed and every road incident happens (server/sim/roadSites.js). It used to frame
 * the whole emirate, which for this build is thirty kilometres of empty map around a
 * picture the size of a thumbnail.
 */
export const CAMERA_3D = { center: [55.382, 25.168] as [number, number], zoom: 11.9, pitch: 45, bearing: -12 };
export const CAMERA_2D = { center: [55.382, 25.168] as [number, number], zoom: 11.9, pitch: 0, bearing: 0 };
