/**
 * The mobile surfaces' map views and the Dubai bounds check. Module-level, so a map keeps
 * its loaded layers when the crew switches tabs. Kept out of TrackMap.tsx, which exports
 * only a component.
 */

import type { Hospital } from '../lib/types';
import { createMapView, defineLayer, type LayerDescriptor } from '../shared/map/layerRegistry';
import { hospitalsLayer, incidentsLayer, responsesLayer, unitsLayer } from '../shared/map/layers';

export const responderMap = createMapView('m-responder', [incidentsLayer, unitsLayer, responsesLayer, hospitalsLayer], {
  persist: false, visible: { hospitals: true },
});

/**
 * The hospital the patient is being taken to — the hospitals layer's own marker, fed with that
 * ONE hospital rather than loading all of them: the caller's map shows where they are going,
 * not the emirate's emergency departments.
 */
export const destinationLayer = defineLayer<Hospital[]>({
  ...(hospitalsLayer as unknown as LayerDescriptor<Hospital[]>), id: 'destination', source: { kind: 'feed' }, filterFor: undefined,
});

export const citizenMap = createMapView('m-citizen', [incidentsLayer, unitsLayer, responsesLayer, destinationLayer], {
  persist: false, visible: { destination: true },
});

/** Dubai, generously — a position outside this box is not a Dubai ambulance's or caller's. */
export const DUBAI_BOX = { minLng: 54.85, maxLng: 56.45, minLat: 24.55, maxLat: 25.45 };

export const inDubai = (lng: number, lat: number) =>
  lng >= DUBAI_BOX.minLng && lng <= DUBAI_BOX.maxLng && lat >= DUBAI_BOX.minLat && lat <= DUBAI_BOX.maxLat;
