/**
 * SC-RW-02 · Collapse in a restricted server room, The NEST floor 3.
 *
 * The second thing the simulation shows, and the harder case. A lone technician collapses
 * between the racks on the third floor. The room is badge-restricted, he is the only
 * person on that wing, and the corridor camera shows nobody walking past for the whole
 * clip. There is no bystander, so under the old workflow there is no call — the response
 * clock does not start until somebody eventually finds him.
 *
 * What the platform can prove here is not heroism, it is arithmetic: the camera raises the
 * incident at the moment of collapse, and every step after it (door release, lift hold,
 * indoor route to the room) is a stage the crew would otherwise spend finding their way
 * through a building they do not have a key to.
 *
 * The building is fictional in the demonstration's terms — it is the DSO twin's own model
 * of a three-storey tech office, with its rooms and floors unchanged, so the 3D twin the
 * console opens and the address the crew is given agree with each other.
 */

import { query } from '../../lib/db.js';
import { makaniFor } from '../../db/seed/geo.js';
import { NEST, roomOf } from '../../data/reference/cameras.js';

export const ref = 'SC-RW-02';
export const name = 'Collapse — The NEST, floor 3 server room';

export const PLACE = { lng: NEST.lng, lat: NEST.lat, name: 'The NEST — floor 3, Server Room' };

/** The Makani entrance the crew is actually sent to. Computed with the same projection
 *  the seed uses, so the code sits in the right place in the national grid. */
export const MAKANI = makaniFor(NEST.lng, NEST.lat);

/**
 * The NEST is a building the twin models but the seed's Makani estate does not name.
 * Insert it once, idempotently, so the incident resolves to a real entrance with the
 * right floor count instead of snapping to whatever happens to be nearest.
 */
export async function ensureAddress() {
  await query(
    `INSERT INTO makani_points
       (makani, building_name, makani_address, entrance_no, entrance_count, entrance_role,
        floors, community_no, zone_id, geom)
     VALUES ($1, $2, $3, 1, 2, 'main', $4, NULL,
             (SELECT id FROM zones WHERE level = 'community'
               AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($5, $6), 4326)) LIMIT 1),
             ST_SetSRID(ST_MakePoint($5, $6), 4326))
     ON CONFLICT (makani) DO UPDATE
        SET building_name = EXCLUDED.building_name,
            floors        = EXCLUDED.floors,
            geom          = EXCLUDED.geom`,
    [MAKANI, NEST.name, `${NEST.name}, Dubai Silicon Oasis`, NEST.floors, NEST.lng, NEST.lat],
  );
}

export function spec({ runId = null } = {}) {
  const room = roomOf('F3_SRV');
  return {
    type: 'indoor_person_down',
    runId,
    cameraIds: ['NEST-F3-CAM-07', 'NEST-F3-CAM-08'],
    place: {
      name: PLACE.name,
      lng: PLACE.lng,
      lat: PLACE.lat,
      floor: 3,
      roomName: room.name,
      buildingName: NEST.name,
      detail: 'Badge-restricted room · 1 occupant · corridor clear',
      // The building, so the console can draw which floor of what rather than print a
      // number. Vertical access is the whole story in this scenario.
      building: {
        id: NEST.id,
        name: NEST.name,
        floors: NEST.floors,
        rooms: NEST.rooms,
        roomId: room.id,
      },
    },
    evidence: [
      { label: 'Camera', value: 'NEST-F3-CAM-07 · F3 Server Room', anomalous: false },
      { label: 'Pose classification', value: 'PERSON_DOWN, held 6.4 s', anomalous: true },
      { label: 'Motion in region', value: 'None for 6.4 s after fall', anomalous: true },
      { label: 'Room occupancy', value: '1 of 5 · no second person', anomalous: true },
      { label: 'Access control', value: 'No badge-out since 19:42', anomalous: true },
      { label: 'Corridor camera', value: 'NEST-F3-CAM-08 · no passer-by 90 s', anomalous: true },
      { label: 'Calls received', value: '0', anomalous: false },
    ],
    corroboration: [
      { source: 'Video analytics · NEST-F3-CAM-07', result: 'Fall detected, horizontal pose sustained' },
      { source: 'Video analytics · NEST-F3-CAM-08', result: 'Second angle confirms through partition; corridor empty' },
      { source: 'Access control · F3 server room', result: 'Badge in 19:42, no badge out — occupant still inside' },
      { source: 'BMS occupancy · The NEST F3', result: '1 person on the wing outside working hours' },
      { source: '998 call queue', result: 'No call from this building today' },
    ],
    verdict: {
      label: 'Person down — unwitnessed collapse',
      severity: 'HIGH',
      confidence: 0.89,
      ruledOut: [
        { label: 'Seated or crouching at work', answer: false },
        { label: 'Object left in frame', answer: false },
        { label: 'Sustained horizontal pose', answer: true },
        { label: 'No voluntary motion', answer: true },
      ],
    },
    incident: {
      kind: 'cardiac_arrest',
      priority: 'P1',
      makani: MAKANI,
      floor: 3,
      unitNo: `${room.name} (${room.id})`,
      chiefComplaint: 'Collapse, unresponsive, no bystander present',
      patientsCount: 1,
      accessNote: 'Badge-restricted server room — security to release F3 lobby and room doors; service lift 2 held at ground for stretcher',
      detectedBy: 'NEST-F3-CAM-07',
    },
  };
}
