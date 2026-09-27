// ── BMS Building Data for DSO City-Wide Monitoring ───────────────────────────
// 80 buildings spanning DSO with realistic sensor telemetry

export type BuildingType = 'commercial' | 'residential' | 'tech' | 'villa' | 'mixed' | 'industrial';
export type BuildingStatus = 'normal' | 'warning' | 'critical';
export type BMSSystem = 'power' | 'hvac' | 'fire' | 'occupancy' | 'water';

export interface BMSBuilding {
  id: string;
  name: string;
  type: BuildingType;
  location: [number, number]; // [lng, lat]
  floors: number;
  height: number; // metres
  area: number; // sqm
  systems: BMSSystem[];
  yearBuilt: number;
  zone: string;
  status: BuildingStatus;

  // Real-time sensor data
  powerLoad: number;        // % of capacity (0-100)
  powerKW: number;          // actual kW consumption
  hvacEfficiency: number;   // % (0-100)
  temperatureAvg: number;   // °C indoor
  occupancy: number;        // % of capacity
  occupancyCount: number;   // people
  waterUsage: number;       // litres/hr
  waterPressure: number;    // bar
  smokeDetectors: number;   // count active
  fireAlarms: number;       // triggered count
  alerts: BMSAlert[];
}

export interface BMSAlert {
  id: string;
  system: BMSSystem;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

// ── Alert generator helper ────────────────────────────────────────────────────
function makeAlert(system: BMSSystem, severity: BMSAlert['severity'], message: string): BMSAlert {
  return {
    id: `ALT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    system,
    severity,
    message,
    timestamp: Date.now() - Math.floor(Math.random() * 3600000),
    acknowledged: false,
  };
}

// ── Status helper ────────────────────────────────────────────────────────────

// ── 80 DSO Buildings ──────────────────────────────────────────────────────────
export const bmsBuildings: BMSBuilding[] = [
  // ── TECH HUB CLUSTER ───────────────────────────────────────────────────────
  {
    id: 'BLD_001', name: 'The NEST', type: 'tech',
    location: [55.3790, 25.1205], floors: 12, height: 52, area: 18000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2018, zone: 'Tech Hub',
    status: 'normal', powerLoad: 68, powerKW: 420, hvacEfficiency: 88,
    temperatureAvg: 22, occupancy: 72, occupancyCount: 580,
    waterUsage: 1850, waterPressure: 3.2, smokeDetectors: 42, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_002', name: 'DSO HQ Tower', type: 'commercial',
    location: [55.3820, 25.1218], floors: 18, height: 76, area: 28000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2015, zone: 'Tech Hub',
    status: 'warning', powerLoad: 82, powerKW: 680, hvacEfficiency: 71,
    temperatureAvg: 24, occupancy: 85, occupancyCount: 920,
    waterUsage: 2200, waterPressure: 3.0, smokeDetectors: 64, fireAlarms: 0,
    alerts: [makeAlert('power', 'warning', 'Power load at 82% — approaching peak threshold')],
  },
  {
    id: 'BLD_003', name: 'Innovation Hub A', type: 'tech',
    location: [55.3835, 25.1240], floors: 8, height: 36, area: 12000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2019, zone: 'Tech Hub',
    status: 'normal', powerLoad: 55, powerKW: 210, hvacEfficiency: 91,
    temperatureAvg: 21, occupancy: 60, occupancyCount: 240,
    waterUsage: 980, waterPressure: 3.4, smokeDetectors: 28, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_004', name: 'Innovation Hub B', type: 'tech',
    location: [55.3852, 25.1232], floors: 8, height: 36, area: 11500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2019, zone: 'Tech Hub',
    status: 'critical', powerLoad: 95, powerKW: 340, hvacEfficiency: 62,
    temperatureAvg: 28, occupancy: 95, occupancyCount: 380,
    waterUsage: 1100, waterPressure: 2.6, smokeDetectors: 28, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'critical', 'Power overload — 95% of capacity'),
      makeAlert('hvac', 'warning', 'HVAC efficiency dropped to 62%'),
    ],
  },
  {
    id: 'BLD_005', name: 'Techno Park Center', type: 'tech',
    location: [55.3868, 25.1220], floors: 10, height: 44, area: 15000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Tech Hub',
    status: 'normal', powerLoad: 61, powerKW: 290, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 68, occupancyCount: 420,
    waterUsage: 1340, waterPressure: 3.1, smokeDetectors: 35, fireAlarms: 0,
    alerts: [],
  },

  // ── COMMERCIAL DISTRICT EAST ───────────────────────────────────────────────
  {
    id: 'BLD_006', name: 'DSO Mall', type: 'commercial',
    location: [55.3904, 25.1248], floors: 4, height: 22, area: 35000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2016, zone: 'Commercial East',
    status: 'warning', powerLoad: 79, powerKW: 890, hvacEfficiency: 74,
    temperatureAvg: 23, occupancy: 88, occupancyCount: 2100,
    waterUsage: 4500, waterPressure: 3.0, smokeDetectors: 120, fireAlarms: 0,
    alerts: [makeAlert('occupancy', 'warning', 'Near-capacity occupancy — 88%')],
  },
  {
    id: 'BLD_007', name: 'Apex Business Tower', type: 'commercial',
    location: [55.3921, 25.1265], floors: 22, height: 92, area: 24000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2014, zone: 'Commercial East',
    status: 'normal', powerLoad: 64, powerKW: 510, hvacEfficiency: 82,
    temperatureAvg: 23, occupancy: 71, occupancyCount: 680,
    waterUsage: 1620, waterPressure: 3.3, smokeDetectors: 74, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_008', name: 'Vertex Commercial Center', type: 'commercial',
    location: [55.3937, 25.1282], floors: 14, height: 60, area: 18500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Commercial East',
    status: 'normal', powerLoad: 58, powerKW: 360, hvacEfficiency: 87,
    temperatureAvg: 22, occupancy: 65, occupancyCount: 490,
    waterUsage: 1200, waterPressure: 3.2, smokeDetectors: 52, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_009', name: 'Silicon Gate Tower', type: 'commercial',
    location: [55.3954, 25.1298], floors: 26, height: 108, area: 30000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2013, zone: 'Commercial East',
    status: 'critical', powerLoad: 88, powerKW: 920, hvacEfficiency: 58,
    temperatureAvg: 27, occupancy: 78, occupancyCount: 940,
    waterUsage: 2800, waterPressure: 2.4, smokeDetectors: 98, fireAlarms: 1,
    alerts: [
      makeAlert('fire', 'critical', 'Fire alarm triggered — Floor 14, Zone B'),
      makeAlert('water', 'warning', 'Water pressure dropping — 2.4 bar'),
    ],
  },
  {
    id: 'BLD_010', name: 'DSO Souq Commercial', type: 'commercial',
    location: [55.3870, 25.1300], floors: 3, height: 14, area: 8500,
    systems: ['power','hvac','fire'], yearBuilt: 2020, zone: 'Commercial East',
    status: 'normal', powerLoad: 45, powerKW: 125, hvacEfficiency: 90,
    temperatureAvg: 21, occupancy: 55, occupancyCount: 220,
    waterUsage: 650, waterPressure: 3.5, smokeDetectors: 18, fireAlarms: 0,
    alerts: [],
  },

  // ── RESIDENTIAL NORTH ──────────────────────────────────────────────────────
  {
    id: 'BLD_011', name: 'Residential Block R1', type: 'residential',
    location: [55.3780, 25.1320], floors: 14, height: 58, area: 16000,
    systems: ['power','hvac','fire','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'normal', powerLoad: 58, powerKW: 380, hvacEfficiency: 84,
    temperatureAvg: 23, occupancy: 80, occupancyCount: 640,
    waterUsage: 3200, waterPressure: 3.1, smokeDetectors: 56, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_012', name: 'Residential Block R2', type: 'residential',
    location: [55.3798, 25.1338], floors: 14, height: 58, area: 16000,
    systems: ['power','hvac','fire','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'warning', powerLoad: 75, powerKW: 490, hvacEfficiency: 70,
    temperatureAvg: 25, occupancy: 88, occupancyCount: 712,
    waterUsage: 3600, waterPressure: 2.8, smokeDetectors: 56, fireAlarms: 0,
    alerts: [makeAlert('water', 'warning', 'Low water pressure detected — 2.8 bar')],
  },
  {
    id: 'BLD_013', name: 'DSO Villas Cluster A', type: 'villa',
    location: [55.3815, 25.1355], floors: 2, height: 9, area: 400,
    systems: ['power','fire'], yearBuilt: 2016, zone: 'Residential North',
    status: 'normal', powerLoad: 32, powerKW: 18, hvacEfficiency: 88,
    temperatureAvg: 24, occupancy: 70, occupancyCount: 5,
    waterUsage: 280, waterPressure: 3.4, smokeDetectors: 4, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_014', name: 'DSO Villas Cluster B', type: 'villa',
    location: [55.3832, 25.1370], floors: 2, height: 9, area: 420,
    systems: ['power','fire'], yearBuilt: 2016, zone: 'Residential North',
    status: 'normal', powerLoad: 28, powerKW: 15, hvacEfficiency: 90,
    temperatureAvg: 23, occupancy: 65, occupancyCount: 4,
    waterUsage: 260, waterPressure: 3.5, smokeDetectors: 4, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_015', name: 'Marina Residence Tower', type: 'residential',
    location: [55.3950, 25.1260], floors: 18, height: 74, area: 20000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Residential North',
    status: 'normal', powerLoad: 62, powerKW: 430, hvacEfficiency: 83,
    temperatureAvg: 22, occupancy: 75, occupancyCount: 580,
    waterUsage: 2900, waterPressure: 3.2, smokeDetectors: 64, fireAlarms: 0,
    alerts: [],
  },

  // ── INDUSTRIAL SOUTH ───────────────────────────────────────────────────────
  {
    id: 'BLD_016', name: 'Data Center DSO-1', type: 'industrial',
    location: [55.3760, 25.1188], floors: 4, height: 20, area: 14000,
    systems: ['power','hvac','fire','water'], yearBuilt: 2015, zone: 'Industrial South',
    status: 'warning', powerLoad: 86, powerKW: 2400, hvacEfficiency: 76,
    temperatureAvg: 20, occupancy: 15, occupancyCount: 22,
    waterUsage: 5800, waterPressure: 3.8, smokeDetectors: 48, fireAlarms: 0,
    alerts: [makeAlert('power', 'warning', 'Peak power load — 86% capacity, cooling demand high')],
  },
  {
    id: 'BLD_017', name: 'Data Center DSO-2', type: 'industrial',
    location: [55.3775, 25.1178], floors: 3, height: 16, area: 10000,
    systems: ['power','hvac','fire'], yearBuilt: 2018, zone: 'Industrial South',
    status: 'critical', powerLoad: 97, powerKW: 1850, hvacEfficiency: 52,
    temperatureAvg: 32, occupancy: 8, occupancyCount: 12,
    waterUsage: 4200, waterPressure: 3.6, smokeDetectors: 36, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'critical', 'CRITICAL: Server room exceeding thermal limit — 97% power load'),
      makeAlert('hvac', 'critical', 'HVAC failure — cooling inefficiency 52%'),
    ],
  },
  {
    id: 'BLD_018', name: 'Telecom Exchange', type: 'industrial',
    location: [55.3748, 25.1200], floors: 2, height: 12, area: 4200,
    systems: ['power','hvac','fire'], yearBuilt: 2014, zone: 'Industrial South',
    status: 'normal', powerLoad: 55, powerKW: 280, hvacEfficiency: 89,
    temperatureAvg: 21, occupancy: 12, occupancyCount: 8,
    waterUsage: 180, waterPressure: 3.3, smokeDetectors: 16, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_019', name: 'Logistics Hub', type: 'industrial',
    location: [55.3740, 25.1218], floors: 2, height: 11, area: 22000,
    systems: ['power','fire','occupancy'], yearBuilt: 2016, zone: 'Industrial South',
    status: 'normal', powerLoad: 44, powerKW: 195, hvacEfficiency: 80,
    temperatureAvg: 26, occupancy: 35, occupancyCount: 85,
    waterUsage: 420, waterPressure: 3.0, smokeDetectors: 40, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_020', name: 'Central Utilities Plant', type: 'industrial',
    location: [55.3730, 25.1235], floors: 2, height: 14, area: 8000,
    systems: ['power','hvac','water'], yearBuilt: 2013, zone: 'Industrial South',
    status: 'warning', powerLoad: 80, powerKW: 1200, hvacEfficiency: 68,
    temperatureAvg: 29, occupancy: 20, occupancyCount: 14,
    waterUsage: 12000, waterPressure: 4.2, smokeDetectors: 24, fireAlarms: 0,
    alerts: [makeAlert('hvac', 'warning', 'Cooling towers operating at reduced efficiency')],
  },

  // ── MIXED-USE DISTRICT ─────────────────────────────────────────────────────
  {
    id: 'BLD_021', name: 'DSO Boulevard A', type: 'mixed',
    location: [55.3890, 25.1165], floors: 16, height: 66, area: 22000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Boulevard',
    status: 'normal', powerLoad: 65, powerKW: 480, hvacEfficiency: 86,
    temperatureAvg: 22, occupancy: 73, occupancyCount: 720,
    waterUsage: 2100, waterPressure: 3.1, smokeDetectors: 68, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_022', name: 'DSO Boulevard B', type: 'mixed',
    location: [55.3908, 25.1180], floors: 16, height: 66, area: 21500,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Boulevard',
    status: 'normal', powerLoad: 67, powerKW: 495, hvacEfficiency: 84,
    temperatureAvg: 23, occupancy: 70, occupancyCount: 695,
    waterUsage: 2050, waterPressure: 3.2, smokeDetectors: 68, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_023', name: 'Axis Tower North', type: 'commercial',
    location: [55.3925, 25.1195], floors: 20, height: 84, area: 26000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2015, zone: 'Boulevard',
    status: 'warning', powerLoad: 81, powerKW: 720, hvacEfficiency: 69,
    temperatureAvg: 25, occupancy: 83, occupancyCount: 860,
    waterUsage: 2450, waterPressure: 2.9, smokeDetectors: 80, fireAlarms: 0,
    alerts: [makeAlert('hvac', 'warning', 'HVAC zone 3 operating at below-target efficiency')],
  },
  {
    id: 'BLD_024', name: 'Axis Tower South', type: 'commercial',
    location: [55.3943, 25.1210], floors: 20, height: 84, area: 25500,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2015, zone: 'Boulevard',
    status: 'normal', powerLoad: 59, powerKW: 530, hvacEfficiency: 88,
    temperatureAvg: 22, occupancy: 67, occupancyCount: 695,
    waterUsage: 1880, waterPressure: 3.3, smokeDetectors: 80, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_025', name: 'Promenade Hotel', type: 'commercial',
    location: [55.3960, 25.1228], floors: 24, height: 98, area: 32000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2014, zone: 'Boulevard',
    status: 'warning', powerLoad: 77, powerKW: 860, hvacEfficiency: 75,
    temperatureAvg: 24, occupancy: 90, occupancyCount: 1240,
    waterUsage: 5600, waterPressure: 3.0, smokeDetectors: 110, fireAlarms: 0,
    alerts: [makeAlert('occupancy', 'warning', 'Hotel occupancy at 90% — pool & gym at capacity')],
  },

  // ── ACADEMIC / RESEARCH ZONE ───────────────────────────────────────────────
  {
    id: 'BLD_026', name: 'Academic City Tower', type: 'commercial',
    location: [55.3823, 25.1264], floors: 12, height: 52, area: 18000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Academic Zone',
    status: 'normal', powerLoad: 56, powerKW: 310, hvacEfficiency: 87,
    temperatureAvg: 22, occupancy: 62, occupancyCount: 480,
    waterUsage: 1100, waterPressure: 3.2, smokeDetectors: 44, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_027', name: 'Research Institute A', type: 'tech',
    location: [55.3845, 25.1280], floors: 6, height: 28, area: 9000,
    systems: ['power','hvac','fire'], yearBuilt: 2019, zone: 'Academic Zone',
    status: 'normal', powerLoad: 48, powerKW: 180, hvacEfficiency: 90,
    temperatureAvg: 21, occupancy: 55, occupancyCount: 165,
    waterUsage: 520, waterPressure: 3.4, smokeDetectors: 22, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_028', name: 'Startup Incubator', type: 'tech',
    location: [55.3862, 25.1295], floors: 5, height: 22, area: 7200,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2020, zone: 'Academic Zone',
    status: 'normal', powerLoad: 45, powerKW: 145, hvacEfficiency: 93,
    temperatureAvg: 21, occupancy: 58, occupancyCount: 185,
    waterUsage: 480, waterPressure: 3.5, smokeDetectors: 20, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_029', name: 'Conference Center DSO', type: 'commercial',
    location: [55.3880, 25.1310], floors: 4, height: 18, area: 12000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Academic Zone',
    status: 'warning', powerLoad: 84, powerKW: 420, hvacEfficiency: 73,
    temperatureAvg: 23, occupancy: 92, occupancyCount: 1100,
    waterUsage: 3200, waterPressure: 2.9, smokeDetectors: 40, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'warning', 'Event load — 84% power draw during conference'),
      makeAlert('occupancy', 'warning', 'Near-full conference center — 92% occupancy'),
    ],
  },
  {
    id: 'BLD_030', name: 'Smart Lab Building', type: 'tech',
    location: [55.3898, 25.1325], floors: 7, height: 32, area: 10500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2021, zone: 'Academic Zone',
    status: 'normal', powerLoad: 52, powerKW: 220, hvacEfficiency: 92,
    temperatureAvg: 20, occupancy: 48, occupancyCount: 210,
    waterUsage: 580, waterPressure: 3.5, smokeDetectors: 26, fireAlarms: 0,
    alerts: [],
  },

  // ── ADDITIONAL BUILDINGS ───────────────────────────────────────────────────
  {
    id: 'BLD_031', name: 'DSO Gate Tower', type: 'commercial',
    location: [55.3855, 25.1168], floors: 28, height: 116, area: 35000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2012, zone: 'Gateway',
    status: 'normal', powerLoad: 70, powerKW: 840, hvacEfficiency: 80,
    temperatureAvg: 23, occupancy: 75, occupancyCount: 1050,
    waterUsage: 3400, waterPressure: 3.1, smokeDetectors: 112, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_032', name: 'DSO Gate Retail', type: 'commercial',
    location: [55.3868, 25.1178], floors: 3, height: 15, area: 11000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2012, zone: 'Gateway',
    status: 'normal', powerLoad: 62, powerKW: 290, hvacEfficiency: 82,
    temperatureAvg: 22, occupancy: 70, occupancyCount: 680,
    waterUsage: 1100, waterPressure: 3.2, smokeDetectors: 36, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_033', name: 'Enterprise Business A', type: 'commercial',
    location: [55.3915, 25.1155], floors: 15, height: 62, area: 20000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2016, zone: 'Enterprise Zone',
    status: 'critical', powerLoad: 91, powerKW: 760, hvacEfficiency: 60,
    temperatureAvg: 27, occupancy: 88, occupancyCount: 780,
    waterUsage: 2600, waterPressure: 2.6, smokeDetectors: 60, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'critical', 'Power load critical — 91% exceeds threshold'),
      makeAlert('hvac', 'warning', 'HVAC cooling capacity degraded'),
    ],
  },
  {
    id: 'BLD_034', name: 'Enterprise Business B', type: 'commercial',
    location: [55.3932, 25.1168], floors: 15, height: 62, area: 19500,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2016, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 63, powerKW: 540, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 68, occupancyCount: 600,
    waterUsage: 1800, waterPressure: 3.2, smokeDetectors: 60, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_035', name: 'Smart City Operations Center', type: 'tech',
    location: [55.3800, 25.1192], floors: 6, height: 28, area: 8500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2020, zone: 'Tech Hub',
    status: 'normal', powerLoad: 58, powerKW: 260, hvacEfficiency: 91,
    temperatureAvg: 21, occupancy: 55, occupancyCount: 165,
    waterUsage: 480, waterPressure: 3.4, smokeDetectors: 24, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_036', name: 'Cyber Security Hub', type: 'tech',
    location: [55.3818, 25.1208], floors: 5, height: 24, area: 7000,
    systems: ['power','hvac','fire'], yearBuilt: 2021, zone: 'Tech Hub',
    status: 'normal', powerLoad: 72, powerKW: 320, hvacEfficiency: 88,
    temperatureAvg: 20, occupancy: 45, occupancyCount: 120,
    waterUsage: 350, waterPressure: 3.3, smokeDetectors: 18, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_037', name: 'Residential Park View 1', type: 'residential',
    location: [55.3770, 25.1290], floors: 12, height: 50, area: 14500,
    systems: ['power','hvac','fire','water'], yearBuilt: 2019, zone: 'Residential North',
    status: 'normal', powerLoad: 54, powerKW: 320, hvacEfficiency: 86,
    temperatureAvg: 23, occupancy: 78, occupancyCount: 530,
    waterUsage: 2800, waterPressure: 3.1, smokeDetectors: 48, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_038', name: 'Residential Park View 2', type: 'residential',
    location: [55.3785, 25.1305], floors: 12, height: 50, area: 14500,
    systems: ['power','hvac','fire','water'], yearBuilt: 2019, zone: 'Residential North',
    status: 'warning', powerLoad: 76, powerKW: 450, hvacEfficiency: 72,
    temperatureAvg: 25, occupancy: 86, occupancyCount: 590,
    waterUsage: 3100, waterPressure: 2.9, smokeDetectors: 48, fireAlarms: 0,
    alerts: [makeAlert('hvac', 'warning', 'Residential HVAC load high — summer peak period')],
  },
  {
    id: 'BLD_039', name: 'Club House & Sports', type: 'commercial',
    location: [55.3802, 25.1322], floors: 3, height: 15, area: 8000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'normal', powerLoad: 60, powerKW: 195, hvacEfficiency: 84,
    temperatureAvg: 24, occupancy: 65, occupancyCount: 280,
    waterUsage: 4200, waterPressure: 3.5, smokeDetectors: 22, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_040', name: 'Medical Center DSO', type: 'commercial',
    location: [55.3819, 25.1338], floors: 5, height: 22, area: 9500,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2017, zone: 'Residential North',
    status: 'normal', powerLoad: 65, powerKW: 310, hvacEfficiency: 90,
    temperatureAvg: 22, occupancy: 58, occupancyCount: 240,
    waterUsage: 1900, waterPressure: 3.4, smokeDetectors: 30, fireAlarms: 0,
    alerts: [],
  },
  // ── MORE BUILDINGS ─────────────────────────────────────────────────────────
  {
    id: 'BLD_041', name: 'Office Complex Alpha', type: 'commercial',
    location: [55.3860, 25.1145], floors: 10, height: 44, area: 15000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2018, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 61, powerKW: 380, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 68, occupancyCount: 450,
    waterUsage: 1250, waterPressure: 3.2, smokeDetectors: 38, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_042', name: 'Office Complex Beta', type: 'commercial',
    location: [55.3877, 25.1158], floors: 10, height: 44, area: 14800,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2018, zone: 'Enterprise Zone',
    status: 'warning', powerLoad: 78, powerKW: 490, hvacEfficiency: 73,
    temperatureAvg: 24, occupancy: 80, occupancyCount: 520,
    waterUsage: 1480, waterPressure: 3.0, smokeDetectors: 38, fireAlarms: 0,
    alerts: [makeAlert('power', 'warning', 'Load approaching 80% during peak hours')],
  },
  {
    id: 'BLD_043', name: 'Retail Strip South A', type: 'commercial',
    location: [55.3894, 25.1172], floors: 2, height: 10, area: 5500,
    systems: ['power','fire'], yearBuilt: 2017, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 52, powerKW: 95, hvacEfficiency: 82,
    temperatureAvg: 23, occupancy: 60, occupancyCount: 180,
    waterUsage: 450, waterPressure: 3.3, smokeDetectors: 14, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_044', name: 'Retail Strip South B', type: 'commercial',
    location: [55.3910, 25.1185], floors: 2, height: 10, area: 5200,
    systems: ['power','fire'], yearBuilt: 2017, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 48, powerKW: 88, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 55, occupancyCount: 165,
    waterUsage: 430, waterPressure: 3.4, smokeDetectors: 14, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_045', name: 'Parking Garage P1', type: 'industrial',
    location: [55.3927, 25.1198], floors: 6, height: 20, area: 18000,
    systems: ['power','fire'], yearBuilt: 2015, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 38, powerKW: 125, hvacEfficiency: 70,
    temperatureAvg: 28, occupancy: 72, occupancyCount: 580,
    waterUsage: 0, waterPressure: 0, smokeDetectors: 36, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_046', name: 'FZ02 Free Zone Office', type: 'commercial',
    location: [55.3804, 25.1170], floors: 8, height: 36, area: 12000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Gateway',
    status: 'normal', powerLoad: 57, powerKW: 260, hvacEfficiency: 86,
    temperatureAvg: 22, occupancy: 65, occupancyCount: 340,
    waterUsage: 920, waterPressure: 3.2, smokeDetectors: 28, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_047', name: 'FZ04 Free Zone Office', type: 'commercial',
    location: [55.3820, 25.1182], floors: 8, height: 36, area: 11800,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Gateway',
    status: 'normal', powerLoad: 55, powerKW: 255, hvacEfficiency: 87,
    temperatureAvg: 22, occupancy: 62, occupancyCount: 325,
    waterUsage: 900, waterPressure: 3.3, smokeDetectors: 28, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_048', name: 'Green Energy Office', type: 'tech',
    location: [55.3838, 25.1195], floors: 6, height: 28, area: 8500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2022, zone: 'Tech Hub',
    status: 'normal', powerLoad: 38, powerKW: 125, hvacEfficiency: 96,
    temperatureAvg: 21, occupancy: 52, occupancyCount: 155,
    waterUsage: 380, waterPressure: 3.5, smokeDetectors: 20, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_049', name: 'Pharos Tower', type: 'commercial',
    location: [55.3975, 25.1215], floors: 30, height: 124, area: 42000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2013, zone: 'Commercial East',
    status: 'warning', powerLoad: 80, powerKW: 1200, hvacEfficiency: 72,
    temperatureAvg: 24, occupancy: 81, occupancyCount: 1450,
    waterUsage: 4800, waterPressure: 2.9, smokeDetectors: 130, fireAlarms: 0,
    alerts: [makeAlert('power', 'warning', 'High weekend load — 80% power draw')],
  },
  {
    id: 'BLD_050', name: 'Mosaic Residences', type: 'residential',
    location: [55.3835, 25.1350], floors: 16, height: 66, area: 19000,
    systems: ['power','hvac','fire','water'], yearBuilt: 2020, zone: 'Residential North',
    status: 'normal', powerLoad: 59, powerKW: 400, hvacEfficiency: 88,
    temperatureAvg: 23, occupancy: 82, occupancyCount: 665,
    waterUsage: 3350, waterPressure: 3.2, smokeDetectors: 60, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_051', name: 'Villa Community North', type: 'villa',
    location: [55.3849, 25.1362], floors: 2, height: 9, area: 380,
    systems: ['power','fire'], yearBuilt: 2017, zone: 'Residential North',
    status: 'normal', powerLoad: 30, powerKW: 14, hvacEfficiency: 88,
    temperatureAvg: 24, occupancy: 72, occupancyCount: 5,
    waterUsage: 250, waterPressure: 3.4, smokeDetectors: 4, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_052', name: 'Innovation Square', type: 'tech',
    location: [55.3842, 25.1248], floors: 14, height: 58, area: 20000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2020, zone: 'Tech Hub',
    status: 'normal', powerLoad: 63, powerKW: 420, hvacEfficiency: 89,
    temperatureAvg: 21, occupancy: 70, occupancyCount: 560,
    waterUsage: 1720, waterPressure: 3.3, smokeDetectors: 60, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_053', name: 'Nexus Business Park A', type: 'commercial',
    location: [55.3858, 25.1260], floors: 12, height: 52, area: 17000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2018, zone: 'Tech Hub',
    status: 'critical', powerLoad: 93, powerKW: 640, hvacEfficiency: 58,
    temperatureAvg: 28, occupancy: 91, occupancyCount: 740,
    waterUsage: 2100, waterPressure: 2.7, smokeDetectors: 52, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'critical', 'Critical overload — 93%, emergency load shed required'),
      makeAlert('hvac', 'critical', 'HVAC Zone 2 failed — switching to backup'),
    ],
  },
  {
    id: 'BLD_054', name: 'Nexus Business Park B', type: 'commercial',
    location: [55.3875, 25.1272], floors: 12, height: 52, area: 16800,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2018, zone: 'Tech Hub',
    status: 'normal', powerLoad: 60, powerKW: 400, hvacEfficiency: 87,
    temperatureAvg: 22, occupancy: 67, occupancyCount: 535,
    waterUsage: 1380, waterPressure: 3.2, smokeDetectors: 52, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_055', name: 'Multiplex Cinema', type: 'commercial',
    location: [55.3897, 25.1258], floors: 5, height: 24, area: 14000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Commercial East',
    status: 'normal', powerLoad: 70, powerKW: 480, hvacEfficiency: 82,
    temperatureAvg: 22, occupancy: 75, occupancyCount: 820,
    waterUsage: 1400, waterPressure: 3.1, smokeDetectors: 44, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_056', name: 'Retail Center West', type: 'commercial',
    location: [55.3755, 25.1252], floors: 3, height: 14, area: 9000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2019, zone: 'Residential North',
    status: 'normal', powerLoad: 58, powerKW: 195, hvacEfficiency: 83,
    temperatureAvg: 22, occupancy: 62, occupancyCount: 310,
    waterUsage: 780, waterPressure: 3.2, smokeDetectors: 22, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_057', name: 'Solar Research Center', type: 'tech',
    location: [55.3770, 25.1265], floors: 4, height: 20, area: 6500,
    systems: ['power','hvac','fire'], yearBuilt: 2022, zone: 'Tech Hub',
    status: 'normal', powerLoad: 22, powerKW: 85, hvacEfficiency: 94,
    temperatureAvg: 21, occupancy: 38, occupancyCount: 90,
    waterUsage: 280, waterPressure: 3.5, smokeDetectors: 16, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_058', name: 'Community Center', type: 'commercial',
    location: [55.3788, 25.1278], floors: 3, height: 14, area: 7500,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'normal', powerLoad: 55, powerKW: 165, hvacEfficiency: 86,
    temperatureAvg: 22, occupancy: 60, occupancyCount: 220,
    waterUsage: 920, waterPressure: 3.3, smokeDetectors: 20, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_059', name: 'Logistics Warehouse', type: 'industrial',
    location: [55.3721, 25.1225], floors: 1, height: 10, area: 30000,
    systems: ['power','fire'], yearBuilt: 2015, zone: 'Industrial South',
    status: 'normal', powerLoad: 42, powerKW: 260, hvacEfficiency: 70,
    temperatureAvg: 28, occupancy: 25, occupancyCount: 60,
    waterUsage: 300, waterPressure: 2.8, smokeDetectors: 48, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_060', name: 'Emergency Response Center', type: 'commercial',
    location: [55.3738, 25.1242], floors: 3, height: 14, area: 5000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Industrial South',
    status: 'normal', powerLoad: 52, powerKW: 130, hvacEfficiency: 91,
    temperatureAvg: 22, occupancy: 45, occupancyCount: 95,
    waterUsage: 420, waterPressure: 3.4, smokeDetectors: 16, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_061', name: 'GEMS Academy', type: 'commercial',
    location: [55.3755, 25.1258], floors: 4, height: 18, area: 12000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2016, zone: 'Academic Zone',
    status: 'normal', powerLoad: 60, powerKW: 275, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 85, occupancyCount: 950,
    waterUsage: 2100, waterPressure: 3.1, smokeDetectors: 36, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_062', name: 'Tech Tower Gamma', type: 'tech',
    location: [55.3808, 25.1258], floors: 16, height: 68, area: 21000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2019, zone: 'Tech Hub',
    status: 'warning', powerLoad: 77, powerKW: 560, hvacEfficiency: 74,
    temperatureAvg: 24, occupancy: 78, occupancyCount: 620,
    waterUsage: 1860, waterPressure: 3.0, smokeDetectors: 64, fireAlarms: 0,
    alerts: [makeAlert('hvac', 'warning', 'Server floor cooling challenged — 74% efficiency')],
  },
  {
    id: 'BLD_063', name: 'IoT Operations Hub', type: 'tech',
    location: [55.3825, 25.1272], floors: 5, height: 24, area: 7800,
    systems: ['power','hvac','fire'], yearBuilt: 2023, zone: 'Tech Hub',
    status: 'normal', powerLoad: 50, powerKW: 195, hvacEfficiency: 93,
    temperatureAvg: 21, occupancy: 48, occupancyCount: 140,
    waterUsage: 380, waterPressure: 3.4, smokeDetectors: 18, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_064', name: 'AI Research Lab', type: 'tech',
    location: [55.3843, 25.1286], floors: 6, height: 28, area: 9200,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2023, zone: 'Tech Hub',
    status: 'normal', powerLoad: 68, powerKW: 290, hvacEfficiency: 91,
    temperatureAvg: 20, occupancy: 55, occupancyCount: 185,
    waterUsage: 480, waterPressure: 3.4, smokeDetectors: 22, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_065', name: 'Smart Retail Plaza', type: 'commercial',
    location: [55.3860, 25.1298], floors: 3, height: 14, area: 8500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2021, zone: 'Commercial East',
    status: 'normal', powerLoad: 64, powerKW: 240, hvacEfficiency: 84,
    temperatureAvg: 22, occupancy: 70, occupancyCount: 380,
    waterUsage: 920, waterPressure: 3.2, smokeDetectors: 24, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_066', name: 'Executive Suites Tower', type: 'commercial',
    location: [55.3878, 25.1285], floors: 22, height: 90, area: 28000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2015, zone: 'Commercial East',
    status: 'warning', powerLoad: 76, powerKW: 740, hvacEfficiency: 71,
    temperatureAvg: 24, occupancy: 80, occupancyCount: 960,
    waterUsage: 2900, waterPressure: 2.9, smokeDetectors: 88, fireAlarms: 0,
    alerts: [makeAlert('hvac', 'warning', 'High floor HVAC zones running at reduced capacity')],
  },
  {
    id: 'BLD_067', name: 'Warehouse Complex W1', type: 'industrial',
    location: [55.3712, 25.1208], floors: 1, height: 9, area: 22000,
    systems: ['power','fire'], yearBuilt: 2014, zone: 'Industrial South',
    status: 'normal', powerLoad: 38, powerKW: 175, hvacEfficiency: 68,
    temperatureAvg: 30, occupancy: 20, occupancyCount: 40,
    waterUsage: 200, waterPressure: 2.7, smokeDetectors: 36, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_068', name: 'F&B District Hub', type: 'commercial',
    location: [55.3895, 25.1148], floors: 2, height: 10, area: 4500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2020, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 68, powerKW: 155, hvacEfficiency: 82,
    temperatureAvg: 23, occupancy: 75, occupancyCount: 280,
    waterUsage: 1800, waterPressure: 3.2, smokeDetectors: 14, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_069', name: 'Amenity Center', type: 'commercial',
    location: [55.3913, 25.1162], floors: 2, height: 9, area: 3800,
    systems: ['power','hvac','fire'], yearBuilt: 2019, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 50, powerKW: 95, hvacEfficiency: 86,
    temperatureAvg: 22, occupancy: 58, occupancyCount: 120,
    waterUsage: 540, waterPressure: 3.3, smokeDetectors: 10, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_070', name: 'Children Education Center', type: 'commercial',
    location: [55.3930, 25.1175], floors: 3, height: 14, area: 6500,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2018, zone: 'Enterprise Zone',
    status: 'normal', powerLoad: 55, powerKW: 145, hvacEfficiency: 88,
    temperatureAvg: 22, occupancy: 70, occupancyCount: 320,
    waterUsage: 780, waterPressure: 3.2, smokeDetectors: 18, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_071', name: 'Sunset Residences A', type: 'residential',
    location: [55.3948, 25.1188], floors: 18, height: 74, area: 18500,
    systems: ['power','hvac','fire','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'normal', powerLoad: 61, powerKW: 415, hvacEfficiency: 83,
    temperatureAvg: 23, occupancy: 79, occupancyCount: 604,
    waterUsage: 3050, waterPressure: 3.1, smokeDetectors: 58, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_072', name: 'Sunset Residences B', type: 'residential',
    location: [55.3965, 25.1202], floors: 18, height: 74, area: 18200,
    systems: ['power','hvac','fire','water'], yearBuilt: 2018, zone: 'Residential North',
    status: 'warning', powerLoad: 74, powerKW: 500, hvacEfficiency: 71,
    temperatureAvg: 25, occupancy: 87, occupancyCount: 660,
    waterUsage: 3320, waterPressure: 2.8, smokeDetectors: 58, fireAlarms: 0,
    alerts: [makeAlert('water', 'warning', 'Hot water supply pressure reduced — maintenance check needed')],
  },
  {
    id: 'BLD_073', name: 'Mixed Use Tower East', type: 'mixed',
    location: [55.3983, 25.1218], floors: 20, height: 84, area: 27000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2016, zone: 'Commercial East',
    status: 'normal', powerLoad: 66, powerKW: 640, hvacEfficiency: 82,
    temperatureAvg: 23, occupancy: 73, occupancyCount: 840,
    waterUsage: 2780, waterPressure: 3.1, smokeDetectors: 82, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_074', name: 'Tower of Light', type: 'commercial',
    location: [55.4000, 25.1235], floors: 32, height: 132, area: 45000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2012, zone: 'Commercial East',
    status: 'critical', powerLoad: 89, powerKW: 1450, hvacEfficiency: 61,
    temperatureAvg: 27, occupancy: 84, occupancyCount: 1680,
    waterUsage: 5600, waterPressure: 2.5, smokeDetectors: 140, fireAlarms: 2,
    alerts: [
      makeAlert('fire', 'critical', 'Fire alarm triggered — B2 basement level parking'),
      makeAlert('power', 'warning', 'Load surging post fire event — 89% capacity'),
    ],
  },
  {
    id: 'BLD_075', name: 'Block D Offices', type: 'commercial',
    location: [55.3755, 25.1170], floors: 8, height: 36, area: 11000,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2017, zone: 'Gateway',
    status: 'normal', powerLoad: 57, powerKW: 255, hvacEfficiency: 85,
    temperatureAvg: 22, occupancy: 64, occupancyCount: 310,
    waterUsage: 880, waterPressure: 3.2, smokeDetectors: 28, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_076', name: 'Block E Offices', type: 'commercial',
    location: [55.3772, 25.1182], floors: 8, height: 36, area: 10800,
    systems: ['power','hvac','fire','occupancy'], yearBuilt: 2017, zone: 'Gateway',
    status: 'normal', powerLoad: 54, powerKW: 248, hvacEfficiency: 87,
    temperatureAvg: 22, occupancy: 60, occupancyCount: 290,
    waterUsage: 860, waterPressure: 3.3, smokeDetectors: 28, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_077', name: 'Sky Residence 1', type: 'residential',
    location: [55.3789, 25.1196], floors: 20, height: 82, area: 24000,
    systems: ['power','hvac','fire','water'], yearBuilt: 2019, zone: 'Residential North',
    status: 'normal', powerLoad: 64, powerKW: 510, hvacEfficiency: 85,
    temperatureAvg: 23, occupancy: 80, occupancyCount: 860,
    waterUsage: 3800, waterPressure: 3.2, smokeDetectors: 76, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_078', name: 'Power Substation A', type: 'industrial',
    location: [55.3808, 25.1148], floors: 1, height: 8, area: 2500,
    systems: ['power'], yearBuilt: 2012, zone: 'Industrial South',
    status: 'warning', powerLoad: 85, powerKW: 4200, hvacEfficiency: 75,
    temperatureAvg: 35, occupancy: 5, occupancyCount: 3,
    waterUsage: 100, waterPressure: 3.0, smokeDetectors: 8, fireAlarms: 0,
    alerts: [makeAlert('power', 'warning', 'Grid substation at 85% rated capacity — demand management active')],
  },
  {
    id: 'BLD_079', name: 'Smart Parking Structure', type: 'industrial',
    location: [55.3825, 25.1162], floors: 7, height: 24, area: 24000,
    systems: ['power','fire'], yearBuilt: 2018, zone: 'Gateway',
    status: 'normal', powerLoad: 35, powerKW: 145, hvacEfficiency: 65,
    temperatureAvg: 32, occupancy: 68, occupancyCount: 1020,
    waterUsage: 0, waterPressure: 0, smokeDetectors: 48, fireAlarms: 0,
    alerts: [],
  },
  {
    id: 'BLD_080', name: 'Expo & Events Center', type: 'commercial',
    location: [55.3843, 25.1175], floors: 5, height: 26, area: 25000,
    systems: ['power','hvac','fire','occupancy','water'], yearBuilt: 2016, zone: 'Gateway',
    status: 'warning', powerLoad: 83, powerKW: 1050, hvacEfficiency: 70,
    temperatureAvg: 24, occupancy: 88, occupancyCount: 2800,
    waterUsage: 5200, waterPressure: 2.8, smokeDetectors: 90, fireAlarms: 0,
    alerts: [
      makeAlert('power', 'warning', 'Event underway — 83% power draw'),
      makeAlert('occupancy', 'warning', 'Large event — 88% capacity (2800 attendees)'),
    ],
  },
];

// ── Aggregated city stats ────────────────────────────────────────────────────
export function getBMSCityStats() {
  const total    = bmsBuildings.length;
  const critical = bmsBuildings.filter(b => b.status === 'critical').length;
  const warning  = bmsBuildings.filter(b => b.status === 'warning').length;
  const normal   = bmsBuildings.filter(b => b.status === 'normal').length;
  const avgPower = Math.round(bmsBuildings.reduce((s, b) => s + b.powerLoad, 0) / total);
  const avgHVAC  = Math.round(bmsBuildings.reduce((s, b) => s + b.hvacEfficiency, 0) / total);
  const avgOccup = Math.round(bmsBuildings.reduce((s, b) => s + b.occupancy, 0) / total);
  const totalAlerts = bmsBuildings.reduce((s, b) => s + b.alerts.length, 0);
  const fireBuildings = bmsBuildings.filter(b => b.fireAlarms > 0).length;
  const totalKW  = bmsBuildings.reduce((s, b) => s + b.powerKW, 0);
  return { total, critical, warning, normal, avgPower, avgHVAC, avgOccup, totalAlerts, fireBuildings, totalKW };
}

// ── Color helpers ────────────────────────────────────────────────────────────
export function getBuildingColor(b: BMSBuilding, layer: 'status' | 'power' | 'hvac' | 'occupancy' | 'water'): [number, number, number, number] {
  if (layer === 'status') {
    if (b.status === 'critical') return [255, 82, 82, 200];
    if (b.status === 'warning')  return [255, 152, 0, 200];
    return [0, 228, 0, 180];
  }
  if (layer === 'power') {
    const v = b.powerLoad;
    if (v > 90) return [255, 50, 50, 220];
    if (v > 75) return [255, 165, 0, 210];
    if (v > 55) return [0, 180, 255, 200];
    return [0, 100, 200, 180];
  }
  if (layer === 'hvac') {
    const v = b.hvacEfficiency;
    if (v < 60) return [255, 82, 82, 220];
    if (v < 75) return [255, 165, 0, 210];
    if (v < 88) return [0, 220, 200, 200];
    return [0, 255, 120, 190];
  }
  if (layer === 'occupancy') {
    const v = b.occupancy;
    if (v > 88) return [255, 100, 100, 220];
    if (v > 70) return [255, 200, 0, 210];
    return [100, 180, 255, 180];
  }
  if (layer === 'water') {
    const v = b.waterPressure;
    if (v < 2.6 || v === 0) return [255, 100, 100, 200];
    if (v < 3.0) return [255, 165, 0, 200];
    return [0, 180, 255, 190];
  }
  return [80, 140, 220, 180];
}
