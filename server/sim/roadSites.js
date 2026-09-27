/**
 * The carriageway — where a road incident can be.
 *
 * The trial watches the ROAD (config/poc.js), which changes where an incident is allowed
 * to happen. The emirate-wide simulation placed calls at Makani entrances, because a
 * Makani point is an addressable door and most 998 calls come from behind one. A door is
 * exactly the wrong place for this build: it sits on a building footprint, so the 3D map
 * draws the incident standing inside a tower, which is the one thing the client asked not
 * to see.
 *
 * So the sites below are points ON A CARRIAGEWAY, inside the trial catchment — Silicon
 * Oasis out through Academic City, International City, Al Warqa, Nad Al Sheba, Mirdif and
 * Al Rashidiya, which is where the trial's eight ambulances are stationed. Each was
 * checked to fall inside a community polygon, so the incident resolves to a real zone and
 * the demand analytics keep working.
 *
 * Coordinates are approximate to the lane: OSRM snaps to the nearest road when it routes,
 * and the ambulance drives to the road, which is what the crew would do.
 */

/** @typedef {{ id: string, road: string, zone: string, lng: number, lat: number, kind: 'motorway'|'arterial'|'junction' }} RoadSite */

/** @type {RoadSite[]} */
export const ROAD_SITES = [
  { id: 'RS-01', road: 'E311 Sheikh Mohammed Bin Zayed Road — Silicon Oasis interchange', zone: 'Dubai Silicon Oasis', lng: 55.3680, lat: 25.1180, kind: 'motorway' },
  { id: 'RS-02', road: 'DSO Central Roundabout', zone: 'Dubai Silicon Oasis', lng: 55.3823, lat: 25.1264, kind: 'junction' },
  { id: 'RS-03', road: 'Silicon Oasis Avenue, northbound', zone: 'Dubai Silicon Oasis', lng: 55.3760, lat: 25.1300, kind: 'arterial' },
  { id: 'RS-04', road: 'E66 Dubai–Al Ain Road — Academic City', zone: 'Academic City', lng: 55.4050, lat: 25.1100, kind: 'motorway' },
  { id: 'RS-05', road: 'Academic City Road, eastbound', zone: 'Dubai Silicon Oasis', lng: 55.3950, lat: 25.1150, kind: 'arterial' },
  { id: 'RS-06', road: 'Al Awir Road — International City', zone: 'International City', lng: 55.4180, lat: 25.1720, kind: 'arterial' },
  { id: 'RS-07', road: 'International City ring road', zone: 'International City', lng: 55.4120, lat: 25.1650, kind: 'arterial' },
  { id: 'RS-08', road: 'Al Warqa — Al Awir Road junction', zone: 'Al Warqa', lng: 55.3950, lat: 25.1930, kind: 'junction' },
  { id: 'RS-09', road: 'Al Warqa 3, Algeria Street', zone: 'Al Warqa', lng: 55.3900, lat: 25.1850, kind: 'arterial' },
  { id: 'RS-10', road: 'Nad Al Sheba — Dubai–Al Ain Road slip', zone: 'Nad Al Sheba', lng: 55.3400, lat: 25.1600, kind: 'motorway' },
  { id: 'RS-11', road: 'Nad Al Sheba 1, Meydan Road', zone: 'Nad Al Sheba', lng: 55.3300, lat: 25.1500, kind: 'arterial' },
  { id: 'RS-12', road: 'Al Khawaneej Road — Mirdif', zone: 'Mirdif', lng: 55.4250, lat: 25.2250, kind: 'arterial' },
  { id: 'RS-13', road: 'Mirdif, Algeria Street', zone: 'Mirdif', lng: 55.4180, lat: 25.2130, kind: 'arterial' },
  { id: 'RS-14', road: 'Al Rashidiya — Nad Al Hamar Road', zone: 'Al Rashidiya', lng: 55.3950, lat: 25.2280, kind: 'arterial' },
  { id: 'RS-15', road: 'Al Rashidiya, Airport Road approach', zone: 'Al Rashidiya', lng: 55.4020, lat: 25.2350, kind: 'arterial' },
];

/**
 * What a camera sees on a road, and how bad it is.
 *
 * Priority follows the mechanism, not a dice roll: a motorway impact is a P1 far more
 * often than a car park shunt, and the AI severity estimate the client asked for is
 * exactly this judgement made from the frame. `als` marks the ones a Basic Life Support
 * crew cannot finish on their own, so the capability filter in engines/dispatch.js is
 * exercised rather than bypassed.
 */
export const ROAD_EVENTS = [
  { key: 'multi_vehicle', label: 'Multi-vehicle collision', weight: 20, priorities: { P1: 0.45, P2: 0.45, P3: 0.10 }, patients: [2, 4], als: true,
    complaint: 'Multi-vehicle collision, occupants not out of vehicles' },
  { key: 'rear_end', label: 'Rear-end shunt', weight: 26, priorities: { P2: 0.35, P3: 0.55, P4: 0.10 }, patients: [1, 2], als: false,
    complaint: 'Rear-end impact, both drivers walking' },
  { key: 'motorcycle', label: 'Motorcycle down', weight: 12, priorities: { P1: 0.55, P2: 0.40, P3: 0.05 }, patients: [1, 1], als: true,
    complaint: 'Motorcycle rider down, not moving' },
  { key: 'pedestrian', label: 'Pedestrian struck', weight: 9, priorities: { P1: 0.50, P2: 0.45, P3: 0.05 }, patients: [1, 1], als: true,
    complaint: 'Pedestrian struck on the carriageway' },
  { key: 'rollover', label: 'Single-vehicle rollover', weight: 7, priorities: { P1: 0.60, P2: 0.35, P3: 0.05 }, patients: [1, 3], als: true,
    complaint: 'Vehicle on its roof, occupants trapped' },
  { key: 'lane_block', label: 'Vehicle stopped in a live lane', weight: 14, priorities: { P3: 0.55, P4: 0.45 }, patients: [1, 1], als: false,
    complaint: 'Vehicle stationary in a live lane, driver unresponsive at the wheel' },
  { key: 'hgv', label: 'Heavy goods vehicle involved', weight: 6, priorities: { P1: 0.40, P2: 0.50, P3: 0.10 }, patients: [1, 3], als: true,
    complaint: 'Lorry and car, cab intruded' },
  { key: 'cardiac_at_wheel', label: 'Driver collapsed at the wheel', weight: 6, priorities: { P1: 0.85, P2: 0.15 }, patients: [1, 1], als: true,
    kind: 'cardiac_arrest', complaint: 'Driver slumped at the wheel after the vehicle drifted to a stop' },
];

/** Every road event is a road traffic collision unless it says otherwise. */
export const eventKind = (event) => event.kind ?? 'rta';
