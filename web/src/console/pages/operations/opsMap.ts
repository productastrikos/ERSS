/**
 * The Operations map view. Module-level, so layer visibility, loaded reference data and
 * the selection survive navigating away from the page and back.
 *
 * The DCAS layer set: operational, analytical and reference layers; partner-agency feeds
 * are left out of the ambulance service's console. The descriptors' defaults decide the
 * resting picture — incidents, ambulances, routes, zones and facilities on; analytical
 * surfaces off until an operator asks for them (docs/06 §2.2).
 */

import { createMapView } from '../../../shared/map/layerRegistry';
import { DCAS_LAYERS } from '../../../shared/map/layers';

export const opsMap = createMapView('operations', DCAS_LAYERS);
