/**
 * The mobile surfaces' map views and the Dubai bounds check. Module-level, so a map keeps
 * its loaded layers when the crew switches tabs. Kept out of TrackMap.tsx, which exports
 * only a component.
 */

import { createMapView } from '../shared/map/layerRegistry';
import { hospitalsLayer, incidentsLayer, responsesLayer, unitsLayer } from '../shared/map/layers';

export const responderMap = createMapView('m-responder', [incidentsLayer, unitsLayer, responsesLayer, hospitalsLayer], {
  persist: false, visible: { hospitals: true },
});

export const citizenMap = createMapView('m-citizen', [incidentsLayer, unitsLayer, responsesLayer], { persist: false });

/** Dubai, generously — a position outside this box is not a Dubai ambulance's or caller's. */
export const DUBAI_BOX = { minLng: 54.85, maxLng: 56.45, minLat: 24.55, maxLat: 25.45 };

export const inDubai = (lng: number, lat: number) =>
  lng >= DUBAI_BOX.minLng && lng <= DUBAI_BOX.maxLng && lat >= DUBAI_BOX.minLat && lat <= DUBAI_BOX.maxLat;
