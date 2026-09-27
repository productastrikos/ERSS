/**
 * Emergency facilities.
 *
 * Hospital names, locations and capability classes are REAL, drawn from published
 * information. ED bed counts and live occupancy are synthesised — capacity figures are
 * not public and change hourly.
 *
 * Station locations are APPROXIMATED: official GIS shapefiles of emergency facilities
 * are not published, for operational security.
 */

/**
 * Dubai's 24-hour emergency departments.
 *
 * Three capabilities create genuine routing overrides, and they are the reason the
 * hospital engine is more than a nearest-facility lookup:
 *   · hyperbaric — only 3 sites. CO poisoning from a high-rise fire, decompression
 *     sickness from offshore diving, specific crush trauma.
 *   · burns      — only 3 sites.
 *   · paeds      — Al Jalila is the designated centre.
 */
export const HOSPITALS = [
  {
    ref: 'HOS-01', name: 'Rashid Hospital', area: 'Oud Metha', operator: 'public',
    lng: 55.3160, lat: 25.2310, edBeds: 64,
    capabilities: ['trauma_l1', 'stroke', 'cath_lab', 'neurosurgery', 'toxicology', 'general'],
    note: 'Regional apex trauma centre. Dubai\'s first stroke unit (2011). Published mean door-to-needle 64.14 min — the improvement target for SC-04.',
  },
  {
    ref: 'HOS-02', name: 'Al Jalila Children\'s Specialty Hospital', area: 'Al Jaddaf', operator: 'public',
    lng: 55.3345, lat: 25.2245, edBeds: 28,
    capabilities: ['paeds', 'burns', 'general'],
    note: 'The designated paediatric centre.',
  },
  {
    ref: 'HOS-03', name: 'Jebel Ali Hospital', area: 'Jebel Ali', operator: 'public',
    lng: 55.1230, lat: 25.0230, edBeds: 24,
    capabilities: ['trauma_l1', 'general'],
  },
  {
    ref: 'HOS-04', name: 'Fakeeh University Hospital', area: 'Dubai Silicon Oasis', operator: 'private',
    lng: 55.3790, lat: 25.1220, edBeds: 42,
    capabilities: ['trauma_l1', 'hyperbaric', 'obstetric', 'general'],
    note: '350 beds, 35 adult ICU, 10 paediatric ICU. One of only three hyperbaric sites.',
  },
  {
    ref: 'HOS-05', name: 'Saudi German Hospital', area: 'Al Barsha', operator: 'private',
    lng: 55.2010, lat: 25.1090, edBeds: 36,
    capabilities: ['trauma_l1', 'hyperbaric', 'general'],
  },
  {
    ref: 'HOS-06', name: 'King\'s College Hospital London', area: 'Dubai Hills Estate', operator: 'private',
    lng: 55.2520, lat: 25.1030, edBeds: 30,
    capabilities: ['cath_lab', 'trauma_l1', 'general'],
  },
  {
    ref: 'HOS-07', name: 'Clemenceau Medical Center', area: 'Dubai Healthcare City', operator: 'private',
    lng: 55.3245, lat: 25.2320, edBeds: 26,
    capabilities: ['stroke', 'cath_lab', 'burns', 'general'],
  },
  {
    ref: 'HOS-08', name: 'International Modern Hospital', area: 'Mankhool', operator: 'private',
    lng: 55.2920, lat: 25.2490, edBeds: 22,
    capabilities: ['stroke', 'cath_lab', 'general'],
  },
  {
    ref: 'HOS-09', name: 'Trellis Hospital', area: 'Al Qusais', operator: 'private',
    lng: 55.3860, lat: 25.2790, edBeds: 24,
    capabilities: ['trauma_l1', 'burns', 'general'],
  },
  {
    ref: 'HOS-10', name: 'Aster Hospital Mankhool', area: 'Mankhool', operator: 'private',
    lng: 55.2955, lat: 25.2515, edBeds: 20, capabilities: ['general'],
  },
  {
    ref: 'HOS-11', name: 'Aster Hospital Muhaisnah', area: 'Muhaisnah', operator: 'private',
    lng: 55.4105, lat: 25.2845, edBeds: 20, capabilities: ['general'],
  },
  {
    ref: 'HOS-12', name: 'Aster Hospital Jebel Ali', area: 'Jebel Ali', operator: 'private',
    lng: 55.1050, lat: 25.0180, edBeds: 18, capabilities: ['general'],
  },
  {
    ref: 'HOS-13', name: 'HMS Mirdif Hospital', area: 'Mirdif', operator: 'private',
    lng: 55.4230, lat: 25.2210, edBeds: 22,
    capabilities: ['hyperbaric', 'general'],
  },
  {
    ref: 'HOS-14', name: 'Hatta Hospital', area: 'Hatta', operator: 'public',
    lng: 56.1210, lat: 24.8010, edBeds: 14, capabilities: ['general'],
    note: 'The long-transport case — 130 km from the city centre.',
  },
];

/**
 * DCAS operates 133 ambulance points: 68 primary ground stations plus standby points,
 * kiosks and co-located fire/police integrations. Named sites below are anchors; the
 * seed distributes the remainder by population and road access.
 */
export const AMBULANCE_ANCHORS = [
  { name: 'DCAS Headquarters, Warsan',  lng: 55.4090, lat: 25.1680, bays: 8 },
  { name: 'Rashid Hospital Station',    lng: 55.3155, lat: 25.2305, bays: 6 },
  { name: 'Deira Station',              lng: 55.3180, lat: 25.2680, bays: 4 },
  { name: 'Bur Dubai Station',          lng: 55.2950, lat: 25.2530, bays: 4 },
  { name: 'Marina Station',             lng: 55.1410, lat: 25.0810, bays: 5 },
  { name: 'Downtown Station',           lng: 55.2750, lat: 25.1980, bays: 5 },
  { name: 'Al Barsha Station',          lng: 55.2010, lat: 25.1120, bays: 4 },
  { name: 'Jebel Ali Station',          lng: 55.1050, lat: 25.0160, bays: 4 },
  { name: 'Mirdif Station',             lng: 55.4190, lat: 25.2180, bays: 3 },
  { name: 'Al Quoz Station',            lng: 55.2320, lat: 25.1400, bays: 3 },
  { name: 'DSO Station',                lng: 55.3820, lat: 25.1250, bays: 3 },
  { name: 'Palm Jumeirah Station',      lng: 55.1390, lat: 25.1130, bays: 3 },
  { name: 'International City Station', lng: 55.4070, lat: 25.1630, bays: 3 },
  { name: 'Dubai South Station',        lng: 55.1490, lat: 24.8980, bays: 3 },
  { name: 'Hatta Station',              lng: 56.1190, lat: 24.7990, bays: 2 },
];

/** Manned police stations. Patrol units originate here. */
export const POLICE_STATIONS = [
  { name: 'Al Barsha Police Station',   lng: 55.2050, lat: 25.1150 },
  { name: 'Jebel Ali Police Station',   lng: 55.1100, lat: 25.0200 },
  { name: 'Naif Police Station',        lng: 55.3050, lat: 25.2730 },
  { name: 'Al Qusais Police Station',   lng: 55.3840, lat: 25.2790 },
  { name: 'Al Rashidiya Police Station', lng: 55.3950, lat: 25.2340 },
  { name: 'Al Raffa Police Station',    lng: 55.2870, lat: 25.2590 },
  { name: 'Al Muraqqabat Police Station', lng: 55.3270, lat: 25.2640 },
  { name: 'Bur Dubai Police Station',   lng: 55.2960, lat: 25.2510 },
  { name: 'Al Khawaneej Police Station', lng: 55.4610, lat: 25.2480 },
];

/**
 * Smart Police Stations — 33 UNMANNED self-service kiosks.
 *
 * These must never appear as a dispatch origin: routing an incident to one yields no
 * physical responder. `dispatchable = false` is the mechanism, and this list is why
 * that column exists at all.
 */
export const SMART_POLICE_STATIONS = [
  { name: 'SPS Arabian Ranches',    lng: 55.2700, lat: 25.0520 },
  { name: 'SPS City Walk',          lng: 55.2640, lat: 25.2080 },
  { name: 'SPS La Mer',             lng: 55.2410, lat: 25.2280 },
  { name: 'SPS Expo City',          lng: 55.1520, lat: 24.9640 },
  { name: 'SPS Dubai Silicon Oasis', lng: 55.3800, lat: 25.1230 },
  { name: 'SPS Dragon Mart',        lng: 55.4130, lat: 25.1750 },
  { name: 'SPS DAFZA',              lng: 55.3720, lat: 25.2620 },
  { name: 'SPS Last Exit E311',     lng: 55.2200, lat: 25.0100 },
  { name: 'SPS Mall of the Emirates', lng: 55.2000, lat: 25.1180 },
  { name: 'SPS Dubai Mall',         lng: 55.2790, lat: 25.1980 },
  { name: 'SPS Ibn Battuta',        lng: 55.1190, lat: 25.0450 },
  { name: 'SPS Mirdif City Centre', lng: 55.4230, lat: 25.2170 },
];

export const CIVIL_DEFENCE_STATIONS = [
  { name: 'Al Quoz Fire Station',          lng: 55.2340, lat: 25.1420 },
  { name: 'Al Barsha Fire Station',        lng: 55.2020, lat: 25.1100 },
  { name: 'Palm Jumeirah Fire Station',    lng: 55.1400, lat: 25.1140 },
  { name: 'Al Karama Fire Station',        lng: 55.3070, lat: 25.2440 },
  { name: 'Nad Al Sheba Fire Station',     lng: 55.3220, lat: 25.1580 },
  { name: 'Emirates Martyrs Fire Station', lng: 55.2720, lat: 25.2140 },
  { name: 'Al Rashidiya Fire Station',     lng: 55.3930, lat: 25.2310 },
  { name: 'Deira Fire Station',            lng: 55.3210, lat: 25.2700 },
  { name: 'Jebel Ali Fire Station',        lng: 55.1080, lat: 25.0190 },
  { name: 'Dubai South Fire Station',      lng: 55.1500, lat: 24.9000 },
  // The world's first mobile, sustainable floating fire station — coastal, island and
  // shipping-lane response. Marine routing, not road.
  { name: 'Floating Fire Station (Marina)', lng: 55.1330, lat: 25.0870, floating: true },
];

export const COASTGUARD_STATIONS = [
  { name: 'Coastguard Port Rashid',   lng: 55.2740, lat: 25.2460 },
  { name: 'Coastguard Jebel Ali',     lng: 55.0600, lat: 24.9900 },
  { name: 'Coastguard Dubai Marina',  lng: 55.1310, lat: 25.0840 },
  { name: 'Coastguard Hamriya',       lng: 55.3350, lat: 25.2900 },
];

/**
 * Public access defibrillator sites.
 *
 * The real registry is RESTRICTED — coordinate-level AED locations are not published,
 * for property security and anti-tampering. These are plausible sites.
 *
 * What matters more than the locations is the BEHAVIOUR: DCAS runs a telemetry-enabled
 * network (Lifepak CR2). Opening a cabinet transmits to the control room and
 * auto-generates a high-acuity incident at those coordinates. That is modelled, because
 * it is how the real system works — and because bystander AED use across the GCC is
 * below 3%, so an AED that calls for help by itself is worth more than one that waits.
 */
export const AED_SITE_KINDS = [
  { kind: 'mall',    weight: 22, perSite: [4, 12] },
  { kind: 'metro',   weight: 18, perSite: [2, 4] },
  { kind: 'mosque',  weight: 14, perSite: [1, 2] },
  { kind: 'office',  weight: 16, perSite: [2, 6] },
  { kind: 'school',  weight: 12, perSite: [1, 3] },
  { kind: 'park',    weight: 8,  perSite: [1, 2] },
  { kind: 'stadium', weight: 4,  perSite: [4, 10] },
  { kind: 'hotel',   weight: 6,  perSite: [2, 5] },
];
