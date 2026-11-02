/**
 * The proof-of-concept scope — what this build is allowed to be about.
 *
 * The client agreed a narrow PoC and the product has to look like that PoC, not like the
 * emirate-wide system the codebase is capable of: five to ten ambulances, two cameras on
 * each, three AI modules, three months. Everything here is that agreement expressed once,
 * so no screen has to decide for itself what "the fleet" means.
 *
 *   FLEET       the eight ambulances in the trial. The console shows these and nothing
 *               else, and dispatch may only choose between them — an ambulance that is
 *               not on the map must never turn up on an incident.
 *   ROAD_ONLY   the trial watches the ROAD. No incident is placed inside a building, on a
 *               floor, or in a room, because none of those is what a road camera sees.
 *   CALLS       off. Every incident in the trial is raised by a camera, not by a phone
 *               call — "we respond before the call comes" is the whole claim being made,
 *               and a 998 call stream running underneath it would contradict it.
 *
 * This is a SCOPE, not a migration: nothing is deleted. The other 174 vehicles, the call
 * traffic and the indoor detection are all still in the database and still in the code
 * paths that serve the full system — they are simply out of scope for this build, and
 * turning `enabled` off here restores the emirate-wide product exactly as it was.
 */

export const poc = {
  enabled: true,

  /**
   * The trial fleet: eight ambulances inside the Dubai Silicon Oasis catchment, where the
   * road-watch cameras are. Three ALS, four BLS and one mobile ICU — the mix the service
   * actually turns out to a collision — with no two callsigns alike, because an operator
   * reading "Medic 3" off the map must not have to ask which Medic 3.
   *
   * Motorcycles, marine, air, supervisors and every partner-agency vehicle are out: the
   * agreement says ambulances.
   */
  fleet: [
    'AMB-122',   // Medic 22    · ALS  · DSO Station
    'AMB-16',    // Medic 16    · BLS  · Dubai Silicon Oasis Ambulance Point 95
    'MICU-03',   // Intensive 3 · MICU · Dubai Silicon Oasis Ambulance Point 97
    'AMB-103',   // Medic 3     · ALS  · DCAS Headquarters, Warsan
    'AMB-19',    // Medic 19    · BLS  · International City Station
    'AMB-21',    // Medic 21    · BLS  · International City Standby Point 93
    'AMB-07',    // Medic 7     · BLS  · Mirdif Station
    'AMB-101',   // Medic 1     · ALS  · Mirdif Ambulance Point 83
  ],

  /**
   * Each trial ambulance's home station. The reference seed spreads the emirate's fleet
   * over random stations, which scattered these eight from Jumeirah to Al Qusais; the
   * live simulation holds them to these on every start and reset (sim/live.js
   * alignTrialFleet), and a crew that clears drives back here.
   */
  homes: {
    'AMB-122': 'STN-DCAS-11',
    'AMB-16': 'STN-DCAS-110',
    'MICU-03': 'STN-DCAS-112',
    'AMB-103': 'STN-DCAS-01',
    'AMB-19': 'STN-DCAS-13',
    'AMB-21': 'STN-DCAS-108',
    'AMB-07': 'STN-DCAS-09',
    'AMB-101': 'STN-DCAS-98',
  },

  /**
   * The trial catchment — Silicon Oasis out to Al Rashidiya and Mirdif, with a margin
   * (sim/roadSites.js). What "the area the trial covers" means wherever a number is about
   * the eight ambulances: coverage measured over the whole emirate with a fleet of eight
   * read as 8% and said nothing about the trial.
   */
  catchment: { west: 55.31, south: 25.09, east: 55.45, north: 25.25 },

  /**
   * The six communities the eight ambulances are stationed to serve — each within 4 km of
   * a trial station. Coverage is measured over these: the catchment box above has a margin
   * that reaches Oud Metha and Al Jaddaf, 8–10 km from the nearest trial ambulance, which
   * the trial was never meant to cover.
   */
  communities: [
    'Z-C0704',   // Dubai Silicon Oasis
    'Z-C0703',   // International City
    'Z-C0701',   // Mirdif
    'Z-C0706',   // Al Rashidiya
    'Z-C0702',   // Al Warqa
    'Z-C0705',   // Academic City
  ],

  /** The ambulance the demo crew phone (RSP-AMB122) is bound to. */
  crewDemoUnit: 'AMB-122',

  /** Two cameras per ambulance: one on the road ahead, one on the cab. */
  camerasPerUnit: 2,

  /** No incident has a floor, a room or a building. The trial is the carriageway. */
  roadOnly: true,

  /** No 998 call stream. Cameras raise the work, the AI dispatches it. */
  calls: false,
};

/** The refs the console may show and dispatch may choose, or `null` for "no limit". */
export const pocFleet = () => (poc.enabled ? poc.fleet : null);

/** How many ambulances the trial runs. Quoted in the UI rather than counted, so the
 *  number the client agreed and the number on screen cannot drift apart. */
export const pocFleetSize = () => poc.fleet.length;

export const inPocFleet = (ref) => !poc.enabled || poc.fleet.includes(ref);

/** The trial's communities by ref, or `null` for "the whole emirate". */
export const pocCommunities = () => (poc.enabled ? poc.communities : null);
