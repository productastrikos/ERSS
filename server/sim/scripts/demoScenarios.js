/**
 * The demonstration — three road incidents, each told from start to finish, one at a time.
 *
 * Random placement made poor demonstrations: a point dropped "near" an ambulance and
 * snapped to the nearest road often landed on the wrong carriageway of a divided road or
 * deep in a residential grid, and the crew then drove 3–4× the straight-line distance
 * through a dozen turns to reach it. Nobody watching could tell whether the AI had chosen
 * well, because no sensible driver would have chosen that road.
 *
 * So the trial runs these three. Each site was chosen by routing every trial station to
 * every snapped road point in the catchment (OSRM table + route with alternatives) and
 * keeping the ones where the best crew's road is direct — ≤ 1.5× the straight line, on
 * named roads — and where the AI's choice has a reason a dispatcher would recognise:
 *
 *   1  P1 multi-vehicle collision, Al Ruwayyah St (DSO east)
 *      The nearest crew is also the fastest — and its ROAD is the lesson: the main route
 *      via 82 Street has 2 roundabouts, the alternative via 64 Street has 4 and is slower
 *      though barely longer. The nearest ALS crew is twice as far by road: for a P1 the
 *      first crew on scene wins, and the BLS crew can call ALS support.
 *   2  P2 pedestrian struck, Warsan St 1 (International City)
 *      The crew at International City Station leaves straight onto International City
 *      St 1 → Manama St with no hard turns. HQ's ALS crew is 3.9 km with five manoeuvres,
 *      and its alternative road needs a U-turn on a divided carriageway.
 *   3  P1 driver collapsed at the wheel, Algeria St (Mirdif)
 *      The closest ambulance as the crow flies is a BLS crew — ruled out, a cardiac arrest
 *      needs ALS — and its road is the slower one anyway (five manoeuvres through the
 *      residential grid). The ALS crew at Mirdif AP 83 is two manoeuvres away.
 *
 * Like every script, this is the STIMULUS only (docs/10 rule 1): what the cameras saw and
 * where. The ambulance, the road, the hospital and every time on screen come from the
 * engines — the narrative above is what they are expected to find, not what they are told.
 */

/** @typedef {{ id: string, title: string, short: string, place: { name: string, lng: number, lat: number, detail: string }, cameraIds: string[], spec: object }} DemoScenario */

const base = (s) => ({
  type: 'rta_junction',
  cameraIds: s.cameraIds,
  place: { name: s.place.name, lng: s.place.lng, lat: s.place.lat, floor: null, roomName: null, buildingName: null, detail: s.place.detail },
  evidence: s.evidence,
  corroboration: s.corroboration,
  verdict: s.verdict,
  incident: { ...s.incident, lng: s.place.lng, lat: s.place.lat, detectedBy: s.cameraIds[0] },
});

/** @type {DemoScenario[]} */
export const DEMO_SCENARIOS = [
  {
    id: 'DEMO-1',
    title: 'Multi-vehicle collision · Al Ruwayyah St',
    short: 'P1 collision · DSO east',
    place: { name: 'Al Ruwayyah St — east of Dubai Silicon Oasis', lng: 55.40563, lat: 25.12809, detail: 'Two vehicles across the eastbound lanes · debris in lane 2' },
    cameraIds: ['RTA-CAM-211', 'RTA-CAM-212'],
    evidence: [
      { label: 'Location', value: '[55.4056, 25.1281] · Al Ruwayyah St eastbound', anomalous: false },
      { label: 'Mean approach speed', value: '64 → 0 km/h in 1.3 s', anomalous: true },
      { label: 'Camera frame', value: 'COLLISION_DETECTED · 2 vehicles across lanes 1–2', anomalous: true },
      { label: 'Queue growth', value: '+11 vehicles/min behind the obstruction', anomalous: true },
      { label: 'Occupant movement', value: 'None from the second vehicle for 6 s', anomalous: true },
      { label: 'Calls received', value: '0', anomalous: false },
    ],
    corroboration: [
      { source: 'Traffic camera AI · RTA-CAM-211', result: 'Impact frame — two vehicles, airbag deployment visible' },
      { source: 'Traffic camera AI · RTA-CAM-212', result: 'Second angle confirms both vehicles at rest across lanes 1–2' },
      { source: 'Loop speed sensors', result: 'Eastbound speed 64 → 0 km/h in 1.3 s' },
      { source: '998 call queue', result: 'No call from this cell in the last 10 minutes' },
    ],
    verdict: {
      label: 'Multi-vehicle collision', severity: 'HIGH', confidence: 0.94,
      ruledOut: [
        { label: 'Breakdown', answer: false },
        { label: 'Normal congestion', answer: false },
        { label: 'Impact signature', answer: true },
        { label: 'Occupant not moving', answer: true },
      ],
    },
    incident: {
      kind: 'rta', priority: 'P1', patientsCount: 2,
      chiefComplaint: 'Two-car collision at speed — one occupant not moving',
      accessNote: 'Multi-vehicle collision — Al Ruwayyah St, eastbound lanes 1–2 blocked',
    },
  },
  {
    id: 'DEMO-2',
    title: 'Pedestrian struck · Warsan St 1',
    short: 'P2 pedestrian · International City',
    place: { name: 'Warsan St 1 — International City', lng: 55.41448, lat: 25.15045, detail: 'Pedestrian down in the nearside lane · van stopped' },
    cameraIds: ['RTA-CAM-221'],
    evidence: [
      { label: 'Location', value: '[55.4145, 25.1505] · Warsan St 1', anomalous: false },
      { label: 'Camera frame', value: 'PERSON_DOWN · carriageway, nearside lane', anomalous: true },
      { label: 'Vehicle', value: 'Van stopped 4 m beyond, hazard lights on', anomalous: true },
      { label: 'Person movement', value: 'Moving, not standing for 20 s', anomalous: true },
      { label: 'Calls received', value: '0', anomalous: false },
    ],
    corroboration: [
      { source: 'Traffic camera AI · RTA-CAM-221', result: 'Pedestrian contact with a reversing van, person down' },
      { source: 'Pose analytics', result: 'Conscious — sitting up, guarding the left leg' },
      { source: '998 call queue', result: 'No call from this cell in the last 10 minutes' },
    ],
    verdict: {
      label: 'Pedestrian struck', severity: 'MEDIUM', confidence: 0.9,
      ruledOut: [
        { label: 'Person crossing', answer: false },
        { label: 'Vehicle contact', answer: true },
        { label: 'Person unable to stand', answer: true },
      ],
    },
    incident: {
      kind: 'rta', priority: 'P2', patientsCount: 1,
      chiefComplaint: 'Pedestrian struck by a reversing van — conscious, left leg injury',
      accessNote: 'Pedestrian struck — Warsan St 1, International City, nearside lane',
    },
  },
  {
    id: 'DEMO-3',
    title: 'Driver collapsed at the wheel · Algeria St',
    short: 'P1 cardiac · Mirdif',
    place: { name: 'Algeria St — Mirdif', lng: 55.42418, lat: 25.22569, detail: 'Vehicle drifted to a stop against the kerb · driver slumped' },
    cameraIds: ['RTA-CAM-231'],
    evidence: [
      { label: 'Location', value: '[55.4242, 25.2257] · Algeria St northbound', anomalous: false },
      { label: 'Vehicle track', value: 'Drifted across a lane at 18 km/h, stopped against the kerb', anomalous: true },
      { label: 'Camera frame', value: 'DRIVER_SLUMPED · no head movement 25 s', anomalous: true },
      { label: 'Brake lights', value: 'Off — vehicle held by the kerb, not the driver', anomalous: true },
      { label: 'Calls received', value: '0', anomalous: false },
    ],
    corroboration: [
      { source: 'Traffic camera AI · RTA-CAM-231', result: 'Uncontrolled drift then stop, no braking' },
      { source: 'Cabin pose analytics', result: 'Driver slumped over the wheel, no movement' },
      { source: '998 call queue', result: 'No call from this cell in the last 10 minutes' },
    ],
    verdict: {
      label: 'Driver collapsed at the wheel', severity: 'HIGH', confidence: 0.88,
      ruledOut: [
        { label: 'Parked vehicle', answer: false },
        { label: 'Collision', answer: false },
        { label: 'Loss of control without braking', answer: true },
        { label: 'Occupant unresponsive', answer: true },
      ],
    },
    incident: {
      kind: 'cardiac_arrest', priority: 'P1', patientsCount: 1,
      chiefComplaint: 'Driver slumped at the wheel after the vehicle drifted to a stop — not responding',
      accessNote: 'Driver collapsed at the wheel — Algeria St, Mirdif, northbound kerb',
    },
  },
];

/** The detection spec for engines/detection.js. */
export function specFor(scenario, { runId = null } = {}) {
  return { ...base(scenario), runId };
}
