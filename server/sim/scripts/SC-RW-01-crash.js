/**
 * SC-RW-01 · Collision at DSO Central Roundabout, detected by camera.
 *
 * The first thing the simulation shows. A multi-vehicle collision at a signalised
 * junction: the speed sensors see 48 km/h fall to zero in 1.2 s, the density analytics
 * see eighteen vehicles standing in 50 m², and the camera sees a stationary object in a
 * live lane. Nobody has called.
 *
 * The script provides the STIMULUS only (docs/10 §Script mechanics rule 1). It states
 * what the cameras saw. It does not state the ETA, the unit, or the response time —
 * those come from the engines, or the demonstration proves nothing.
 *
 * Grounding: the junction, its signal ids and the diversion plan are the DSO traffic
 * dataset's own (`buildAccidentState` in the retired city twin), so the signal states the
 * map shows during the response are the ones that build was designed around.
 */

export const ref = 'SC-RW-01';
export const name = 'Collision — DSO Central Roundabout';

/** Where it happens. The junction the two analytics cameras both look at. */
export const PLACE = { lng: 55.3823, lat: 25.1264, name: 'DSO Central Roundabout' };

/** The signal plan the collision forces. Fed to the transport layer so the map shows the
 *  junction locked and the diversion open while the ambulance is driving to it. */
export const SIGNAL_PLAN = {
  locked: ['DSO-SIG-101', 'DSO-SIG-104', 'DSO-SIG-107'],
  opened: ['DSO-SIG-102', 'DSO-SIG-103'],
  extendedGreen: { 'DSO-SIG-105': 20, 'DSO-SIG-111': 20 },
  blockedRoads: ['DSO-RD-02', 'DSO-RD-05'],
  queuingRoads: ['DSO-RD-01', 'DSO-RD-06'],
};

export function spec({ runId = null } = {}) {
  return {
    type: 'rta_junction',
    runId,
    cameraIds: ['RTA-CAM-101A', 'RTA-CAM-101B'],
    place: {
      name: PLACE.name,
      lng: PLACE.lng,
      lat: PLACE.lat,
      floor: null,
      roomName: null,
      buildingName: null,
      detail: 'Inner two lanes blocked · impact radius 300 m',
    },
    evidence: [
      { label: 'Location', value: '[55.3823, 25.1264]', anomalous: false },
      { label: 'Mean approach speed', value: '48 → 0 km/h in 1.2 s', anomalous: true },
      { label: 'Vehicle cluster', value: '18 vehicles in 50 m²', anomalous: true },
      { label: 'Camera frame', value: 'OBSTRUCTION_DETECTED, lane 2', anomalous: true },
      { label: 'Inflow rate', value: '+18 veh/min against signal state', anomalous: true },
      { label: 'Calls received', value: '0', anomalous: false },
    ],
    corroboration: [
      { source: 'Traffic camera AI · RTA-CAM-101A', result: 'Anomaly blob, stationary 4.1 s' },
      { source: 'Traffic camera AI · RTA-CAM-101B', result: 'Second angle confirms two vehicles at rest across lanes' },
      { source: 'Inductive loop speed sensors', result: 'Speed drop 48 → 0 km/h in 1.2 s' },
      { source: 'Junction density feed', result: 'Cluster 18 vehicles / 50 m², growing' },
      { source: '998 call queue', result: 'No call from this cell in the last 10 minutes' },
    ],
    verdict: {
      label: 'Road traffic collision',
      severity: 'HIGH',
      confidence: 0.92,
      ruledOut: [
        { label: 'Signal wait', answer: false },
        { label: 'Normal congestion', answer: false },
        { label: 'Road obstruction', answer: true },
        { label: 'Sudden speed-zero', answer: true },
      ],
    },
    incident: {
      kind: 'rta',
      priority: 'P1',
      lng: PLACE.lng,
      lat: PLACE.lat,
      chiefComplaint: 'Multi-vehicle collision, occupants not out of vehicles',
      patientsCount: 2,
      accessNote: 'Inner two lanes blocked — approach from the Academic City side, junction held RED',
      detectedBy: 'RTA-CAM-101A',
    },
  };
}
