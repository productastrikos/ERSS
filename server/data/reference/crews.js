/**
 * The trial fleet's vehicles and crews — DEMO DATA.
 *
 * Every name, staff number and plate below is invented for the demonstration. The trial's
 * real roster is DCAS's to supply and is not in this build; the console labels this data
 * "Demo roster" wherever it shows it, so nobody mistakes an invented paramedic for a real
 * one. The shape is what matters: who is driving, who is leading clinically, what they are
 * certified for, how long they have been on shift, and what the vehicle carries.
 *
 * Two cameras per vehicle (config/poc.js): one on the road ahead — the sensor the trial is
 * about — and one on the cab. The cab feed films staff, so under the agreed privacy terms
 * it is blurred at source and never opened from the console for performance review.
 */

const EQUIPMENT = {
  ALS: ['Cardiac monitor / defibrillator', 'Mechanical CPR device', 'Transport ventilator', 'IV / IO drug kit', 'Spinal board and collars', 'Oxygen and advanced airway'],
  BLS: ['AED', 'Oxygen and airway kit', 'Spinal board and collars', 'Trauma bag', 'Powered stretcher'],
  MICU: ['ICU ventilator', 'Infusion pumps', 'Cardiac monitor / defibrillator', 'Blood-gas analyser', 'Mechanical CPR device', 'Neonatal transport mount'],
};

/** Shift start as GST clock hours; the roster repeats daily. */
const crew = (name, role, title, staffId, yearsService, certs) => ({ name, role, title, staffId, yearsService, certs });

export const TRIAL_CREWS = {
  'AMB-122': {
    plate: 'Dubai A 51220', vehicle: 'Mercedes-Benz Sprinter 519 CDI', year: 2023, shiftFromHour: 7,
    crew: [
      crew('Khalid Al Mansoori', 'driver', 'EMT · driver', 'DCAS-2217', 9, ['Emergency vehicle operations', 'BLS']),
      crew('Priya Nair', 'lead', 'Advanced paramedic', 'DCAS-3104', 7, ['ALS', 'PHTLS', 'ACLS']),
    ],
  },
  'AMB-16': {
    plate: 'Dubai A 50716', vehicle: 'Toyota HiAce ambulance', year: 2022, shiftFromHour: 7,
    crew: [
      crew('Omar Farouk', 'driver', 'EMT · driver', 'DCAS-2481', 5, ['Emergency vehicle operations', 'BLS']),
      crew('Fatima Al Hashimi', 'lead', 'EMT (basic)', 'DCAS-2930', 4, ['BLS', 'PHTLS']),
    ],
  },
  'MICU-03': {
    plate: 'Dubai A 60003', vehicle: 'Mercedes-Benz Sprinter 519 · MICU fit-out', year: 2024, shiftFromHour: 8,
    crew: [
      crew('Saeed Al Ketbi', 'driver', 'EMT · driver', 'DCAS-1766', 12, ['Emergency vehicle operations', 'BLS']),
      crew('Joseph Mathew', 'lead', 'Critical-care paramedic', 'DCAS-3322', 10, ['ALS', 'Critical care transport', 'PALS']),
      crew('Dr. Rania Haddad', 'physician', 'Emergency physician', 'DCAS-M-0419', 8, ['Pre-hospital emergency medicine', 'ATLS']),
    ],
  },
  'AMB-103': {
    plate: 'Dubai A 51103', vehicle: 'Mercedes-Benz Sprinter 519 CDI', year: 2023, shiftFromHour: 6,
    crew: [
      crew('Rashid Al Nuaimi', 'driver', 'EMT · driver', 'DCAS-2055', 11, ['Emergency vehicle operations', 'BLS']),
      crew('Sara Kamal', 'lead', 'Advanced paramedic', 'DCAS-3187', 6, ['ALS', 'ACLS', 'PHTLS']),
    ],
  },
  'AMB-19': {
    plate: 'Dubai A 50719', vehicle: 'Toyota HiAce ambulance', year: 2021, shiftFromHour: 7,
    crew: [
      crew('Imran Qureshi', 'driver', 'EMT · driver', 'DCAS-2602', 6, ['Emergency vehicle operations', 'BLS']),
      crew('Noura Al Falasi', 'lead', 'EMT (basic)', 'DCAS-2844', 3, ['BLS']),
    ],
  },
  'AMB-21': {
    plate: 'Dubai A 50721', vehicle: 'Toyota HiAce ambulance', year: 2022, shiftFromHour: 8,
    crew: [
      crew('Hamad Al Zaabi', 'driver', 'EMT · driver', 'DCAS-2390', 7, ['Emergency vehicle operations', 'BLS']),
      crew('Grace Fernandes', 'lead', 'EMT (basic)', 'DCAS-2977', 5, ['BLS', 'PHTLS']),
    ],
  },
  'AMB-07': {
    plate: 'Dubai A 50707', vehicle: 'Toyota HiAce ambulance', year: 2021, shiftFromHour: 6,
    crew: [
      crew('Yousef Al Blooshi', 'driver', 'EMT · driver', 'DCAS-1983', 13, ['Emergency vehicle operations', 'BLS']),
      crew('Anjali Menon', 'lead', 'EMT (basic)', 'DCAS-2715', 4, ['BLS']),
    ],
  },
  'AMB-101': {
    plate: 'Dubai A 51101', vehicle: 'Mercedes-Benz Sprinter 519 CDI', year: 2024, shiftFromHour: 7,
    crew: [
      crew('Ahmed Al Shamsi', 'driver', 'EMT · driver', 'DCAS-2144', 10, ['Emergency vehicle operations', 'BLS']),
      crew('Daniel Okafor', 'lead', 'Advanced paramedic', 'DCAS-3256', 8, ['ALS', 'ACLS', 'PHTLS']),
    ],
  },
};

/** Shift start for a unit TODAY, as an ISO instant, or null when it has no roster entry. */
export function shiftStartToday(unitRef, nowMs = Date.now()) {
  const r = TRIAL_CREWS[unitRef];
  if (!r) return null;
  const gst = new Date(nowMs + 4 * 3600_000);
  const start = Date.UTC(gst.getUTCFullYear(), gst.getUTCMonth(), gst.getUTCDate(), r.shiftFromHour) - 4 * 3600_000;
  // Before today's start, the crew on board is the one that started yesterday (a 12-hour
  // shift that runs past midnight is not modelled — the trial is a day-shift trial).
  return new Date(start <= nowMs ? start : start - 24 * 3600_000).toISOString();
}

/** A unit's profile: vehicle, crew, equipment and its two cameras. */
export function profileFor(unitRef, kind) {
  const r = TRIAL_CREWS[unitRef];
  if (!r) return null;
  return {
    demo: true,
    plate: r.plate,
    vehicle: r.vehicle,
    year: r.year,
    equipment: EQUIPMENT[kind] ?? EQUIPMENT.BLS,
    crew: r.crew,
    driver: r.crew.find((c) => c.role === 'driver') ?? null,
    lead: r.crew.find((c) => c.role === 'lead') ?? null,
    cameras: [
      { id: `${unitRef}-CAM-F`, name: 'Road camera · forward', facing: 'road', note: 'Crash detection runs on this feed at the edge' },
      { id: `${unitRef}-CAM-C`, name: 'Cab camera', facing: 'cab', note: 'Faces blurred at source · not used for discipline during the trial' },
    ],
  };
}
