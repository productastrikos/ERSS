/**
 * Fleet composition.
 *
 * DCAS operates one of the most diverse emergency fleets in the world. Published
 * figures disagree on size — 127 licensed ambulance vehicles reported for 2023 against
 * 330+ active vehicles in secondary industry reporting — which most likely reflects
 * newly licensed procurement versus total lifetime inventory. Per-subtype counts are
 * not published at all.
 *
 * The seed therefore models ~95 DCAS units using the standard urban EMS distribution
 * the research recommends (roughly 70% BLS, 20% ALS, 10% specialty), adjusted for the
 * specialty types DCAS is known to operate. This is stated as a proxy in the product.
 */

export const DCAS_FLEET = [
  // kind, count, capabilities, crew
  { kind: 'BLS',        count: 46, capabilities: ['bls', 'defib'],                          crew: 2 },
  { kind: 'ALS',        count: 28, capabilities: ['als', 'bls', 'defib', 'vent'],           crew: 2 },
  { kind: 'MICU',       count: 5,  capabilities: ['als', 'icu', 'vent', 'neonatal'],        crew: 3,
    note: 'Hospital-grade intensive care on scene; includes neonatal incubator transport.' },
  { kind: 'MRU',        count: 12, capabilities: ['als', 'defib'],                          crew: 1,
    note: 'Rapid response motorcycle — congestion-immune, and the mega-event asset.' },
  { kind: 'MCU',        count: 3,  capabilities: ['bls', 'triage', 'mass_casualty'],        crew: 4,
    note: 'Mass casualty bus. Among the largest globally — triages dozens simultaneously.' },
  { kind: 'SUPERCAR',   count: 2,  capabilities: ['als', 'defib'],                          crew: 1,
    note: 'First responder hypercar. The Lykan HyperSport responder holds a Guinness record as the fastest and most expensive ambulance responder in the world.' },
  { kind: 'MARINE',     count: 4,  capabilities: ['bls', 'marine', 'defib'],                crew: 3,
    note: 'Coastline, artificial archipelagos and offshore. Marine routing, not road.' },
  { kind: 'SUPERVISOR', count: 6,  capabilities: ['als', 'command'],                        crew: 1 },
  { kind: 'AIR',        count: 2,  capabilities: ['als', 'aerial', 'vent'],                 crew: 3,
    note: 'Remote desert and maritime exfiltration. Coordinated, not owned.' },
];

export const PARTNER_FLEET = [
  { agency: 'POLICE',        kind: 'PRV',    count: 42, capabilities: ['patrol', 'defib'],      crew: 2 },
  { agency: 'CIVIL_DEFENCE', kind: 'FIRE',   count: 18, capabilities: ['fire', 'extrication'],  crew: 5 },
  { agency: 'CIVIL_DEFENCE', kind: 'RESCUE', count: 8,  capabilities: ['extrication', 'hazmat'], crew: 4 },
  { agency: 'COASTGUARD',    kind: 'MARINE', count: 6,  capabilities: ['marine', 'rescue'],     crew: 4 },
];

/** Callsign prefixes, so a unit ref reads like radio traffic. */
export const CALLSIGN = {
  BLS: 'Medic', ALS: 'Medic', MICU: 'Intensive', MRU: 'Rapid', MCU: 'Casualty',
  SUPERCAR: 'Falcon', MARINE: 'Marine', SUPERVISOR: 'Command', AIR: 'Air',
  PRV: 'Patrol', FIRE: 'Fire', RESCUE: 'Rescue',
};

/**
 * Which unit kinds can answer which incident kind, and the preference order.
 * The dispatch engine uses this as a HARD FILTER first, then scores within the
 * qualifying set — a BLS unit is never offered a cardiac arrest that needs ALS.
 */
export const CAPABILITY_REQUIREMENTS = {
  cardiac_arrest:   { required: ['als', 'defib'], preferred: ['ALS', 'MICU', 'MRU', 'SUPERCAR'] },
  cardiac:          { required: ['als'],          preferred: ['ALS', 'MICU', 'MRU'] },
  stroke:           { required: ['als'],          preferred: ['ALS', 'MICU'] },
  respiratory:      { required: ['als'],          preferred: ['ALS', 'MICU', 'BLS'] },
  rta:              { required: [],               preferred: ['ALS', 'BLS', 'MRU'] },
  trauma_fall:      { required: [],               preferred: ['BLS', 'ALS'] },
  workplace_injury: { required: [],               preferred: ['BLS', 'ALS'] },
  heat_illness:     { required: [],               preferred: ['BLS', 'MRU', 'ALS'] },
  obstetric:        { required: [],               preferred: ['ALS', 'BLS'] },
  paediatric:       { required: ['als'],          preferred: ['ALS', 'MICU'] },
  drowning:         { required: ['als', 'defib'], preferred: ['ALS', 'MARINE', 'MICU'] },
  psychiatric:      { required: [],               preferred: ['BLS'] },
  medical_general:  { required: [],               preferred: ['BLS', 'ALS'] },
  fire_related:     { required: [],               preferred: ['ALS', 'BLS'] },
  mass_casualty:    { required: ['mass_casualty'], preferred: ['MCU', 'ALS', 'BLS'] },
  non_emergency:    { required: [],               preferred: ['BLS'] },
};

/**
 * Case mix.
 *
 * ⚠ No published DCAS percentage breakdown exists — the research could not establish
 * one from any primary source. These are PROXY weights from comparable Gulf urban EMS,
 * held inside the bands the research does give: RTC and trauma 15–20%, cardiac and
 * respiratory 25–30%, general medical the remainder. Labelled as a proxy in the UI, and
 * the first thing to replace when the dcas_activity-open schema is obtained.
 *
 * zoneBias shifts a kind toward certain zone classes; seasonal/diurnal multipliers are
 * applied by the history generator.
 */
export const CASE_MIX = [
  { kind: 'medical_general',  weight: 24, priorities: { P1: 0.04, P2: 0.26, P3: 0.52, P4: 0.18 } },
  { kind: 'trauma_fall',      weight: 14, priorities: { P1: 0.06, P2: 0.34, P3: 0.50, P4: 0.10 },
    zoneBias: { industrial: 1.4, suburban: 1.2 } },
  { kind: 'rta',              weight: 13, priorities: { P1: 0.22, P2: 0.46, P3: 0.28, P4: 0.04 },
    zoneBias: { urban: 1.3, industrial: 1.2, desert: 1.5 } },
  { kind: 'cardiac',          weight: 8,  priorities: { P1: 0.38, P2: 0.44, P3: 0.16, P4: 0.02 } },
  { kind: 'cardiac_arrest',   weight: 2,  priorities: { P1: 1.00, P2: 0, P3: 0, P4: 0 } },
  { kind: 'respiratory',      weight: 8,  priorities: { P1: 0.24, P2: 0.46, P3: 0.28, P4: 0.02 } },
  { kind: 'stroke',           weight: 5,  priorities: { P1: 0.62, P2: 0.32, P3: 0.06, P4: 0 } },
  { kind: 'heat_illness',     weight: 5,  priorities: { P1: 0.08, P2: 0.40, P3: 0.46, P4: 0.06 },
    zoneBias: { industrial: 2.4, freezone: 1.6, coastal: 1.2 }, summerOnly: true },
  { kind: 'workplace_injury', weight: 5,  priorities: { P1: 0.08, P2: 0.38, P3: 0.46, P4: 0.08 },
    zoneBias: { industrial: 3.2, freezone: 2.0 } },
  { kind: 'obstetric',        weight: 3,  priorities: { P1: 0.18, P2: 0.52, P3: 0.28, P4: 0.02 } },
  { kind: 'psychiatric',      weight: 3,  priorities: { P1: 0.06, P2: 0.24, P3: 0.58, P4: 0.12 } },
  { kind: 'paediatric',       weight: 3,  priorities: { P1: 0.22, P2: 0.44, P3: 0.30, P4: 0.04 },
    zoneBias: { suburban: 1.4 } },
  { kind: 'drowning',         weight: 2,  priorities: { P1: 0.66, P2: 0.26, P3: 0.08, P4: 0 },
    zoneBias: { coastal: 4.0 }, summerOnly: true },
  { kind: 'fire_related',     weight: 2,  priorities: { P1: 0.34, P2: 0.44, P3: 0.20, P4: 0.02 } },
  { kind: 'non_emergency',    weight: 3,  priorities: { P1: 0, P2: 0.04, P3: 0.30, P4: 0.66 } },
];

export const CHIEF_COMPLAINTS = {
  medical_general:  ['Abdominal pain', 'Fever', 'Dizziness', 'Vomiting', 'Weakness', 'Allergic reaction'],
  trauma_fall:      ['Fall from height', 'Fall on same level', 'Head injury after fall', 'Hip pain after fall'],
  rta:              ['Vehicle collision', 'Multi-vehicle collision', 'Pedestrian struck', 'Motorcycle collision'],
  cardiac:          ['Chest pain', 'Palpitations', 'Chest tightness radiating to arm'],
  cardiac_arrest:   ['Unconscious, not breathing', 'Collapsed, no pulse'],
  respiratory:      ['Shortness of breath', 'Asthma exacerbation', 'Choking'],
  stroke:           ['Facial droop and arm weakness', 'Sudden slurred speech', 'Sudden one-sided weakness'],
  heat_illness:     ['Heat exhaustion', 'Collapse in heat', 'Heat stroke — altered mental state'],
  workplace_injury: ['Crush injury', 'Laceration with bleeding', 'Fall from scaffold', 'Chemical exposure'],
  obstetric:        ['Labour', 'Antepartum bleeding', 'Imminent delivery'],
  psychiatric:      ['Behavioural disturbance', 'Self-harm', 'Panic attack'],
  paediatric:       ['Child febrile seizure', 'Child breathing difficulty', 'Child injury'],
  drowning:         ['Near drowning', 'Submersion, unresponsive'],
  fire_related:     ['Smoke inhalation', 'Burns', 'Trapped by fire'],
  non_emergency:    ['Inter-facility transfer', 'Scheduled transport', 'Dialysis transport'],
  mass_casualty:    ['Multiple casualties'],
};
