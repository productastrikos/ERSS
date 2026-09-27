/**
 * Dubai reference geography.
 *
 * Dubai is officially divided into NINE sectors, subdivided into communities — the
 * standard locality level used for planning, statistics and dispatch zoning. The real
 * emirate has ~226 communities; 42 are modelled here, chosen so that every scenario
 * location and every demographic pattern is represented.
 *
 * Centroids are real. Boundary polygons are GENERATED around them (see seed/geo.js) —
 * official boundary geometry is restricted and not publicly downloadable.
 *
 * Population figures are apportioned from the Dubai Statistics Center total of
 * 4.58M resident / 6.392M daytime. The daytime multiplier is the important column: the
 * ~1.8M daily influx is the largest single driver of spatial demand variation in the
 * emirate, and a static population figure models it away entirely.
 */

/** class: urban | suburban | industrial | freezone | coastal | desert */
export const SECTORS = [
  { ref: 'Z-S01', name: 'Deira',                        class: 'urban' },
  { ref: 'Z-S02', name: 'Bur Dubai',                    class: 'urban' },
  { ref: 'Z-S03', name: 'Jumeirah & Coastal',           class: 'coastal' },
  { ref: 'Z-S04', name: 'Marina, JLT & Palm',           class: 'coastal' },
  { ref: 'Z-S05', name: 'Downtown & Business Bay',      class: 'urban' },
  { ref: 'Z-S06', name: 'Al Quoz & Industrial',         class: 'industrial' },
  { ref: 'Z-S07', name: 'Mirdif, Al Warqa & Eastern',   class: 'suburban' },
  { ref: 'Z-S08', name: 'Jebel Ali, DIP & Southern',    class: 'freezone' },
  { ref: 'Z-S09', name: 'Nad Al Sheba, Khawaneej & Hatta', class: 'desert' },
];

/**
 * radiusM  — mean radius of the generated boundary
 * pop      — resident population
 * dayMult  — daytime population multiplier. > 1 means people come here to work;
 *            < 1 means people leave it to work elsewhere.
 * highrise — buildings above 20 floors. Drives the Vertical Response Time penalty,
 *            which in Dubai's tower clusters is 4–8 minutes — comparable to the drive.
 */
export const COMMUNITIES = [
  // ── Sector 1 · Deira ────────────────────────────────────────────────────────
  { ref: 'Z-C0101', name: 'Al Ras',            sector: 'Z-S01', lng: 55.2930, lat: 25.2690, radiusM: 900,  pop: 24_000,  dayMult: 2.1, highrise: 6,   class: 'urban' },
  { ref: 'Z-C0102', name: 'Naif',              sector: 'Z-S01', lng: 55.3060, lat: 25.2720, radiusM: 1000, pop: 38_000,  dayMult: 1.9, highrise: 9,   class: 'urban' },
  { ref: 'Z-C0103', name: 'Al Muraqqabat',     sector: 'Z-S01', lng: 55.3260, lat: 25.2620, radiusM: 1200, pop: 46_000,  dayMult: 1.7, highrise: 22,  class: 'urban' },
  { ref: 'Z-C0104', name: 'Port Saeed',        sector: 'Z-S01', lng: 55.3320, lat: 25.2500, radiusM: 1100, pop: 21_000,  dayMult: 2.4, highrise: 18,  class: 'urban' },
  { ref: 'Z-C0105', name: 'Al Nahda',          sector: 'Z-S01', lng: 55.3720, lat: 25.2930, radiusM: 1400, pop: 82_000,  dayMult: 0.8, highrise: 31,  class: 'urban' },
  { ref: 'Z-C0106', name: 'Al Qusais',         sector: 'Z-S01', lng: 55.3830, lat: 25.2760, radiusM: 1700, pop: 94_000,  dayMult: 1.1, highrise: 14,  class: 'urban' },
  { ref: 'Z-C0107', name: 'Muhaisnah',         sector: 'Z-S01', lng: 55.4090, lat: 25.2870, radiusM: 1900, pop: 118_000, dayMult: 0.9, highrise: 5,   class: 'suburban' },

  // ── Sector 2 · Bur Dubai ────────────────────────────────────────────────────
  { ref: 'Z-C0201', name: 'Al Karama',         sector: 'Z-S02', lng: 55.3060, lat: 25.2450, radiusM: 1100, pop: 62_000,  dayMult: 1.4, highrise: 12,  class: 'urban' },
  { ref: 'Z-C0202', name: 'Mankhool',          sector: 'Z-S02', lng: 55.2940, lat: 25.2530, radiusM: 1000, pop: 44_000,  dayMult: 1.6, highrise: 16,  class: 'urban' },
  { ref: 'Z-C0203', name: 'Al Raffa',          sector: 'Z-S02', lng: 55.2860, lat: 25.2580, radiusM: 850,  pop: 27_000,  dayMult: 1.8, highrise: 7,   class: 'urban' },
  { ref: 'Z-C0204', name: 'Oud Metha',         sector: 'Z-S02', lng: 55.3140, lat: 25.2340, radiusM: 1200, pop: 19_000,  dayMult: 2.8, highrise: 9,   class: 'urban' },
  { ref: 'Z-C0205', name: 'Al Jaddaf',         sector: 'Z-S02', lng: 55.3330, lat: 25.2230, radiusM: 1300, pop: 24_000,  dayMult: 2.2, highrise: 26,  class: 'urban' },
  { ref: 'Z-C0206', name: 'Dubai Healthcare City', sector: 'Z-S02', lng: 55.3250, lat: 25.2310, radiusM: 900, pop: 8_000, dayMult: 4.2, highrise: 11, class: 'urban' },
  { ref: 'Z-C0207', name: 'Port Rashid',       sector: 'Z-S02', lng: 55.2760, lat: 25.2470, radiusM: 1200, pop: 11_000,  dayMult: 2.0, highrise: 4,   class: 'coastal' },

  // ── Sector 3 · Jumeirah & Coastal ───────────────────────────────────────────
  { ref: 'Z-C0301', name: 'Jumeirah 1',        sector: 'Z-S03', lng: 55.2500, lat: 25.2230, radiusM: 1500, pop: 22_000,  dayMult: 1.3, highrise: 3,   class: 'coastal' },
  { ref: 'Z-C0302', name: 'Jumeirah 3',        sector: 'Z-S03', lng: 55.2150, lat: 25.1960, radiusM: 1600, pop: 18_000,  dayMult: 1.1, highrise: 2,   class: 'coastal' },
  { ref: 'Z-C0303', name: 'Umm Suqeim',        sector: 'Z-S03', lng: 55.1930, lat: 25.1580, radiusM: 1800, pop: 29_000,  dayMult: 1.4, highrise: 8,   class: 'coastal' },
  { ref: 'Z-C0304', name: 'Al Safa',           sector: 'Z-S03', lng: 55.2340, lat: 25.1830, radiusM: 1500, pop: 25_000,  dayMult: 1.2, highrise: 6,   class: 'urban' },
  { ref: 'Z-C0305', name: 'Al Wasl',           sector: 'Z-S03', lng: 55.2520, lat: 25.1960, radiusM: 1300, pop: 21_000,  dayMult: 1.5, highrise: 9,   class: 'urban' },
  { ref: 'Z-C0306', name: 'Al Sufouh',         sector: 'Z-S03', lng: 55.1700, lat: 25.1090, radiusM: 1700, pop: 16_000,  dayMult: 2.6, highrise: 21,  class: 'coastal' },

  // ── Sector 4 · Marina, JLT & Palm ───────────────────────────────────────────
  { ref: 'Z-C0401', name: 'Dubai Marina',      sector: 'Z-S04', lng: 55.1390, lat: 25.0800, radiusM: 1500, pop: 68_000,  dayMult: 1.5, highrise: 112, class: 'coastal' },
  { ref: 'Z-C0402', name: 'Jumeirah Lake Towers', sector: 'Z-S04', lng: 55.1440, lat: 25.0680, radiusM: 1300, pop: 52_000, dayMult: 2.3, highrise: 87, class: 'urban' },
  { ref: 'Z-C0403', name: 'Palm Jumeirah',     sector: 'Z-S04', lng: 55.1380, lat: 25.1120, radiusM: 2600, pop: 34_000,  dayMult: 2.0, highrise: 42,  class: 'coastal' },
  { ref: 'Z-C0404', name: 'Jumeirah Beach Residence', sector: 'Z-S04', lng: 55.1330, lat: 25.0770, radiusM: 900, pop: 27_000, dayMult: 2.4, highrise: 40, class: 'coastal' },
  { ref: 'Z-C0405', name: 'Dubai Internet City', sector: 'Z-S04', lng: 55.1620, lat: 25.0950, radiusM: 1400, pop: 9_000,  dayMult: 6.1, highrise: 18,  class: 'freezone' },
  { ref: 'Z-C0406', name: 'Dubai Media City',  sector: 'Z-S04', lng: 55.1560, lat: 25.0980, radiusM: 1100, pop: 7_000,   dayMult: 5.4, highrise: 14,  class: 'freezone' },
  { ref: 'Z-C0407', name: 'Discovery Gardens', sector: 'Z-S04', lng: 55.1400, lat: 25.0430, radiusM: 1400, pop: 61_000,  dayMult: 0.7, highrise: 4,   class: 'suburban' },

  // ── Sector 5 · Downtown & Business Bay ──────────────────────────────────────
  { ref: 'Z-C0501', name: 'Downtown Dubai',    sector: 'Z-S05', lng: 55.2760, lat: 25.1950, radiusM: 1400, pop: 41_000,  dayMult: 3.8, highrise: 76,  class: 'urban' },
  { ref: 'Z-C0502', name: 'Business Bay',      sector: 'Z-S05', lng: 55.2660, lat: 25.1860, radiusM: 1600, pop: 57_000,  dayMult: 3.1, highrise: 98,  class: 'urban' },
  { ref: 'Z-C0503', name: 'DIFC',              sector: 'Z-S05', lng: 55.2820, lat: 25.2120, radiusM: 900,  pop: 12_000,  dayMult: 7.4, highrise: 34,  class: 'urban' },
  { ref: 'Z-C0504', name: 'Trade Centre',      sector: 'Z-S05', lng: 55.2880, lat: 25.2250, radiusM: 1200, pop: 18_000,  dayMult: 4.6, highrise: 29,  class: 'urban' },
  { ref: 'Z-C0505', name: 'Za\'abeel',         sector: 'Z-S05', lng: 55.3010, lat: 25.2160, radiusM: 1500, pop: 14_000,  dayMult: 2.9, highrise: 12,  class: 'urban' },

  // ── Sector 6 · Al Quoz & Industrial ─────────────────────────────────────────
  { ref: 'Z-C0601', name: 'Al Quoz 1',         sector: 'Z-S06', lng: 55.2390, lat: 25.1460, radiusM: 1700, pop: 31_000,  dayMult: 2.7, highrise: 2,   class: 'industrial' },
  { ref: 'Z-C0602', name: 'Al Quoz Industrial', sector: 'Z-S06', lng: 55.2260, lat: 25.1330, radiusM: 2100, pop: 46_000, dayMult: 3.2, highrise: 0,   class: 'industrial' },
  { ref: 'Z-C0603', name: 'Al Barsha 1',       sector: 'Z-S06', lng: 55.1990, lat: 25.1130, radiusM: 1500, pop: 49_000,  dayMult: 1.8, highrise: 24,  class: 'urban' },
  { ref: 'Z-C0604', name: 'Al Barsha South',   sector: 'Z-S06', lng: 55.2130, lat: 25.0920, radiusM: 1900, pop: 58_000,  dayMult: 1.2, highrise: 17,  class: 'suburban' },
  { ref: 'Z-C0605', name: 'Dubai Hills Estate', sector: 'Z-S06', lng: 55.2480, lat: 25.1050, radiusM: 2000, pop: 36_000, dayMult: 1.3, highrise: 19,  class: 'suburban' },

  // ── Sector 7 · Mirdif, Al Warqa & Eastern ───────────────────────────────────
  { ref: 'Z-C0701', name: 'Mirdif',            sector: 'Z-S07', lng: 55.4200, lat: 25.2170, radiusM: 2000, pop: 74_000,  dayMult: 0.8, highrise: 3,   class: 'suburban' },
  { ref: 'Z-C0702', name: 'Al Warqa',          sector: 'Z-S07', lng: 55.4020, lat: 25.1940, radiusM: 2100, pop: 68_000,  dayMult: 0.7, highrise: 2,   class: 'suburban' },
  { ref: 'Z-C0703', name: 'International City', sector: 'Z-S07', lng: 55.4080, lat: 25.1620, radiusM: 2000, pop: 92_000, dayMult: 0.8, highrise: 6,   class: 'suburban' },
  { ref: 'Z-C0704', name: 'Dubai Silicon Oasis', sector: 'Z-S07', lng: 55.3823, lat: 25.1264, radiusM: 2200, pop: 44_000, dayMult: 2.1, highrise: 23, class: 'freezone' },
  { ref: 'Z-C0705', name: 'Academic City',     sector: 'Z-S07', lng: 55.4210, lat: 25.1180, radiusM: 2100, pop: 17_000,  dayMult: 3.4, highrise: 5,   class: 'freezone' },
  { ref: 'Z-C0706', name: 'Al Rashidiya',      sector: 'Z-S07', lng: 55.3940, lat: 25.2320, radiusM: 1700, pop: 43_000,  dayMult: 1.1, highrise: 4,   class: 'suburban' },

  // ── Sector 8 · Jebel Ali, DIP & Southern ────────────────────────────────────
  { ref: 'Z-C0801', name: 'Jebel Ali Industrial', sector: 'Z-S08', lng: 55.0770, lat: 25.0100, radiusM: 3200, pop: 58_000, dayMult: 3.6, highrise: 1, class: 'industrial' },
  { ref: 'Z-C0802', name: 'Dubai Investments Park', sector: 'Z-S08', lng: 55.1770, lat: 24.9880, radiusM: 2800, pop: 47_000, dayMult: 2.4, highrise: 2, class: 'industrial' },
  { ref: 'Z-C0803', name: 'Dubai South',       sector: 'Z-S08', lng: 55.1480, lat: 24.8960, radiusM: 3400, pop: 29_000,  dayMult: 3.9, highrise: 6,   class: 'freezone' },
  { ref: 'Z-C0804', name: 'Jumeirah Village',  sector: 'Z-S08', lng: 55.2070, lat: 25.0560, radiusM: 2200, pop: 71_000,  dayMult: 0.9, highrise: 28,  class: 'suburban' },

  // ── Sector 9 · Nad Al Sheba, Khawaneej & Hatta ──────────────────────────────
  { ref: 'Z-C0901', name: 'Nad Al Sheba',      sector: 'Z-S09', lng: 55.3210, lat: 25.1560, radiusM: 2600, pop: 26_000,  dayMult: 1.2, highrise: 3,   class: 'suburban' },
  { ref: 'Z-C0902', name: 'Al Khawaneej',      sector: 'Z-S09', lng: 55.4620, lat: 25.2470, radiusM: 2600, pop: 31_000,  dayMult: 0.8, highrise: 1,   class: 'suburban' },
  { ref: 'Z-C0903', name: 'Al Lisaili',        sector: 'Z-S09', lng: 55.5800, lat: 24.9300, radiusM: 6000, pop: 4_000,   dayMult: 1.1, highrise: 0,   class: 'desert' },
  // Hatta is the long-transport case: an exclave ~130 km from the city, and the reason
  // the coverage model must not be judged on average distance alone.
  { ref: 'Z-C0904', name: 'Hatta',             sector: 'Z-S09', lng: 56.1180, lat: 24.7980, radiusM: 5000, pop: 13_000,  dayMult: 1.4, highrise: 0,   class: 'desert' },
];

/** Primary arterial corridors — used for congestion, preemption and RTA correlation. */
export const CORRIDORS = [
  { ref: 'E11',  name: 'Sheikh Zayed Road',              signals: 34 },
  { ref: 'E44',  name: 'Al Khail Road',                  signals: 22 },
  { ref: 'E311', name: 'Sheikh Mohammed Bin Zayed Road', signals: 26 },
  { ref: 'E611', name: 'Emirates Road',                  signals: 14 },
  { ref: 'D89',  name: 'Al Ittihad Road',                signals: 18 },
  { ref: 'D94',  name: 'Jumeirah Road',                  signals: 21 },
  { ref: 'D62',  name: 'Al Wasl Road',                   signals: 19 },
  { ref: 'D63',  name: 'Umm Suqeim Road',                signals: 16 },
];
