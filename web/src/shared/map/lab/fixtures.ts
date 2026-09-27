/**
 * Map lab fixtures — DEVELOPMENT ONLY.
 *
 * Hand-placed, clearly synthetic data for every fed layer, so each layer can be seen
 * and screenshot-compared before the page or feed that will drive it exists
 * (docs/14 §6: "screenshot-compare each domain"). Never imported by a surface.
 */

import type { Incident, MakaniPoint, Priority, UnitStatus } from '../../../lib/types';
import type { UnitPoint } from '../layers/units';
import type { RoutesData } from '../layers/routes';
import type { RiskData } from '../layers/risk';
import type { DemandData } from '../layers/demand';
import type { CrowdData } from '../layers/crowd';
import type { HotspotData } from '../layers/hotspot';
import type { CoverageData } from '../layers/coverage';
import type { DetailData } from '../layers/detail';
import type { Feature, Geometry } from 'geojson';
import type { TrafficFeed } from '../layers/agency/traffic';
import type { BmsBuilding, BmsFeed } from '../layers/agency/bms';
import type { WaterFeed } from '../layers/agency/water';
import type { WasteBin, WasteFeed } from '../layers/agency/waste';
import type { AirSensor, PollutionSource, WindVector } from '../layers/agency/environment';

const now = new Date().toISOString();

function incident(ref: string, priority: Priority, kind: string, lng: number, lat: number): Incident {
  return {
    ref, kind, subkind: null, priority, state: 'responding', outcome: null,
    lng, lat, makani: null, zoneRef: null, zoneName: null, sectorRef: null, floor: null, unitNo: null, accessNote: null,
    building: null,
    source: 'call_998', callerName: null, callerPhone: null, callerRole: null,
    chiefComplaint: null, triageCode: null, acuity: null, patientsCount: 1,
    reportedAt: now, triagedAt: null, dispatchedAt: null, firstOnsceneAt: null,
    firstAtPatientAt: null, closedAt: null, leadAgencyCode: 'DCAS', agenciesInvolved: ['DCAS'],
    escalationLevel: 'LOCAL', responseSec: null, primary: null, activeUnits: 0,
    isSeed: false, isResting: false, runRef: null,
  };
}

export const LAB_INCIDENTS: Incident[] = [
  incident('INC-LAB-0001', 'P1', 'cardiac_arrest', 55.2744, 25.1972),   // Downtown
  incident('INC-LAB-0002', 'P2', 'rta',            55.2410, 25.1560),   // SZR, Al Quoz
  incident('INC-LAB-0003', 'P3', 'trauma_fall',    55.1390, 25.0790),   // Marina
  incident('INC-LAB-0004', 'P4', 'non_emergency',  55.3320, 25.2620),   // Deira
  incident('INC-LAB-0005', 'P1', 'drowning',       55.1180, 25.1130),   // Palm
  incident('INC-LAB-0006', 'P3', 'heat_illness',   55.3870, 25.1215),   // DSO
];

function unit(ref: string, callsign: string, status: UnitStatus, lng: number, lat: number,
              heading: number | null, seriesSlot: number, glyph: string, agencyName: string): UnitPoint {
  return {
    ref, callsign, kind: glyph === 'ambulance' ? 'ALS' : 'PRV', agencyCode: glyph === 'ambulance' ? 'DCAS' : 'POLICE',
    homeStationRef: null, capabilities: [], crewSize: 2, status, shiftStart: null, shiftEnd: null,
    lng, lat, heading, speed: heading == null ? 0 : 54, lastSeenAt: now, standby: null,
    currentAssignmentRef: status === 'responding' ? 'ASG-LAB-0001' : null,
    seriesSlot, glyph, agencyName,
  };
}

export const LAB_UNITS: UnitPoint[] = [
  unit('U-AMB-014', 'AMB-14', 'responding', 55.2655, 25.1890, 40, 8, 'ambulance', 'DCAS'),
  unit('U-AMB-009', 'AMB-09', 'available',  55.2860, 25.2080, null, 8, 'ambulance', 'DCAS'),
  unit('U-AMB-021', 'AMB-21', 'relocating', 55.1520, 25.0900, 210, 8, 'ambulance', 'DCAS'),
  unit('U-PRV-022', 'PRV-22', 'responding', 55.2330, 25.1500, 60, 1, 'shield', 'Police'),
  unit('U-AMB-031', 'AMB-31', 'on_scene',   55.3860, 25.1225, null, 8, 'ambulance', 'DCAS'),
];

export const LAB_ROUTES: RoutesData = {
  routes: [{
    ref: 'ASG-LAB-0001',
    proposed: [[55.2655, 25.1890], [55.2690, 25.1905], [55.2712, 25.1935], [55.2744, 25.1972]],
    taken:    [[55.2655, 25.1890], [55.2668, 25.1912], [55.2700, 25.1918]],
    corridor: [[55.2655, 25.1890], [55.2690, 25.1905], [55.2712, 25.1935], [55.2744, 25.1972]],
    heldSignals: [{ id: 'SIG-LAB-1', lng: 55.2690, lat: 25.1905 }, { id: 'SIG-LAB-2', lng: 55.2712, lat: 25.1935 }],
  }],
};

function entrance(no: number, lng: number, lat: number, role: string): MakaniPoint {
  const code = `27450${String(81230 + no * 7).padStart(5, '0')}`;
  return {
    makani: code, formatted: `${code.slice(0, 5)} ${code.slice(5)}`, buildingName: 'Lab Tower',
    address: null, entranceNo: no, entranceCount: 4, entranceRole: role, floors: 63,
    zoneRef: null, zoneName: null, lng, lat, simulated: true,
  };
}

export const LAB_MAKANI: MakaniPoint[] = [
  entrance(1, 55.27420, 25.19745, 'main'),
  entrance(2, 55.27465, 25.19712, 'service'),
  entrance(3, 55.27402, 25.19690, 'car_park'),
  entrance(4, 55.27470, 25.19760, 'emergency'),
];

// ── Analytical ───────────────────────────────────────────────────────────────
// Deterministic, so a screenshot taken today compares with one taken tomorrow.

const noise = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Centres of synthetic intensity, [lng, lat, strength]. */
const PEAKS: Array<[number, number, number]> = [
  [55.3060, 25.2700, 1.0],   // Deira
  [55.2740, 25.1960, 0.9],   // Downtown
  [55.1400, 25.0780, 0.8],   // Marina
  [55.2300, 25.1400, 0.6],   // Al Quoz
  [55.3950, 25.1700, 0.5],   // International City
];

function intensity(lng: number, lat: number): number {
  return PEAKS.reduce((s, [x, y, k]) => {
    const d2 = ((lng - x) * 100) ** 2 + ((lat - y) * 110) ** 2;   // ~km²
    return s + k * Math.exp(-d2 / 18);
  }, 0);
}

export const LAB_RISK: RiskData = (() => {
  const cells: RiskData['cells'] = [];
  const size = 0.005;   // ≈500 m
  let i = 0;
  for (let lng = 55.10; lng < 55.45; lng += size) {
    for (let lat = 25.02; lat < 25.30; lat += size) {
      i++;
      const score = intensity(lng + size / 2, lat + size / 2) + noise(i) * 0.08;
      if (score < 0.12) continue;
      cells.push({
        cellRef: `R-${i}`,
        polygon: [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]],
        score,
        factors: [
          { name: 'historical_intensity', contribution: score * 0.5 },
          { name: 'junction_density', contribution: noise(i + 1) * 0.3 },
          { name: 'highrise_count', contribution: noise(i + 2) * 0.25 },
          { name: 'population', contribution: noise(i + 3) * 0.2 },
          { name: 'crowd_venue_proximity', contribution: -noise(i + 4) * 0.1 },
        ],
        gi: score > 0.75 ? { z: 2 + score, p: 0.01 } : { z: score - 0.4, p: 0.4 },
      });
    }
  }
  return { cells, band: 2, method: 'Risk Terrain Modelling · Poisson fit (lab fixture)', confidence: 0.31 };
})();

const DEMAND_ZONES: Array<[string, string, number, number]> = [
  ['Z-C0101', 'Al Ras', 55.2930, 25.2690], ['Z-C0105', 'Al Nahda', 55.3720, 25.2930],
  ['Z-C0106', 'Al Qusais', 55.3830, 25.2760], ['Z-C0201', 'Al Karama', 55.3060, 25.2450],
  ['Z-C0303', 'Umm Suqeim', 55.1930, 25.1580], ['Z-C0401', 'Dubai Marina', 55.1390, 25.0800],
  ['Z-C0402', 'Jumeirah Lake Towers', 55.1440, 25.0680], ['Z-C0501', 'Downtown Dubai', 55.2760, 25.1950],
  ['Z-C0502', 'Business Bay', 55.2660, 25.1860], ['Z-C0601', 'Al Quoz 1', 55.2390, 25.1460],
  ['Z-C0603', 'Al Barsha 1', 55.1990, 25.1130], ['Z-C0701', 'Mirdif', 55.4200, 25.2170],
  ['Z-C0703', 'International City', 55.4080, 25.1620], ['Z-C0704', 'Dubai Silicon Oasis', 55.3823, 25.1264],
  ['Z-C0804', 'Jumeirah Village', 55.2070, 25.0560],
];

export const LAB_DEMAND: DemandData = {
  points: DEMAND_ZONES.map(([zoneRef, zoneName, lng, lat], i) => {
    const predicted = 0.4 + intensity(lng, lat) * 3.2 + noise(i) * 0.6;
    return { zoneRef, zoneName, lng, lat, predicted, lower80: predicted * 0.62, upper80: predicted * 1.45 };
  }),
  from: new Date(Date.now() + 3600_000).toISOString(),
  to: new Date(Date.now() + 7200_000).toISOString(),
  method: 'Seasonal Poisson with covariates (lab fixture)',
  confidence: 0.78,
};

export const LAB_CROWD: CrowdData = {
  event: 'Lab event — Dubai Mall fountain show',
  density: Array.from({ length: 160 }, (_, i) => {
    const a = noise(i) * Math.PI * 2;
    const r = Math.sqrt(noise(i + 500)) * 0.006;
    return { lng: 55.2745 + Math.cos(a) * r, lat: 25.1965 + Math.sin(a) * r * 0.9, personsPerM2: 0.5 + (1 - r / 0.006) * 3.5 };
  }),
  chokePoints: [
    { id: 'CP-1', name: 'Gate 3', lng: 55.2772, lat: 25.1985, los: 'F', leadTimeMin: null, inflowPerMin: 410, capacityPerMin: 330 },
    { id: 'CP-2', name: 'Metro link', lng: 55.2712, lat: 25.1942, los: 'E', leadTimeMin: 14, inflowPerMin: 290, capacityPerMin: 310 },
    { id: 'CP-3', name: 'Boulevard east', lng: 55.2790, lat: 25.1930, los: 'D', leadTimeMin: 38, inflowPerMin: 160, capacityPerMin: 260 },
  ],
};

export const LAB_HOTSPOT: HotspotData = {
  kde: Array.from({ length: 900 }, (_, i) => {
    const peak = PEAKS[i % PEAKS.length];
    const a = noise(i) * Math.PI * 2;
    const r = noise(i + 900) * 0.03 * (1.2 - peak[2]);
    return { lng: peak[0] + Math.cos(a) * r, lat: peak[1] + Math.sin(a) * r, weight: 1 };
  }),
  clusters: [
    { id: 'HS-1', lng: 55.3060, lat: 25.2700, radiusM: 1400, z: 4.1, p: 0.001, count: 812 },
    { id: 'HS-2', lng: 55.2740, lat: 25.1960, radiusM: 1100, z: 3.2, p: 0.004, count: 544 },
    { id: 'HS-3', lng: 55.4600, lat: 25.2450, radiusM: 1800, z: -2.3, p: 0.03, count: 41 },
  ],
};

export const LAB_COVERAGE: CoverageData = {
  targetMin: 8,
  areas: [
    { id: 'ST-DEIRA', center: [55.3150, 25.2600], targetRadiusM: 3600, lateRadiusM: 4700 },
    { id: 'ST-BARSHA', center: [55.2000, 25.1100], targetRadiusM: 4200, lateRadiusM: 5400 },
    { id: 'ST-MIRDIF', center: [55.4200, 25.2150], targetRadiusM: 4800, lateRadiusM: 6100 },
    { id: 'ST-DSO', center: [55.3820, 25.1250], targetRadiusM: 4400, lateRadiusM: 5700 },
  ],
};

// ── Detail geometry (DSO close-up) ───────────────────────────────────────────
// A few blocks of Dubai Silicon Oasis, shaped like /api/layers/all, so the detail layer
// can be checked on a machine without osm2pgsql tables or baked GeoJSON.

type P = Record<string, string | number | null>;
const fc = (features: Array<Feature<Geometry, P>>) => ({ type: 'FeatureCollection' as const, features });
const line = (coords: Array<[number, number]>, props: P): Feature<Geometry, P> =>
  ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
const pt = (lng: number, lat: number, props: P): Feature<Geometry, P> =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
const box = (lng: number, lat: number, w: number, h: number, props: P): Feature<Geometry, P> => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + w, lat], [lng + w, lat + h], [lng, lat + h], [lng, lat]]] },
  properties: props,
});

export const LAB_DETAIL: DetailData = {
  roads: fc([
    line([[55.3740, 25.1180], [55.3950, 25.1330]], { osm_id: 1, name: 'Silicon Oasis Boulevard', highway: 'primary', lanes: '3', maxspeed: '60', oneway: 'no' }),
    line([[55.3760, 25.1300], [55.3930, 25.1170]], { osm_id: 2, name: 'Dubai Silicon Oasis Road', highway: 'secondary', lanes: '2', maxspeed: '50' }),
    line([[55.3820, 25.1200], [55.3825, 25.1290]], { osm_id: 3, name: 'Tech Avenue', highway: 'tertiary', oneway: 'yes' }),
    line([[55.3790, 25.1235], [55.3880, 25.1250]], { osm_id: 4, name: null, highway: 'residential' }),
  ]),
  buildings: fc([
    box(55.3832, 25.1242, 0.0009, 0.0007, { osm_id: 101, name: 'Silicon Gates Tower', levels: '28', building: 'residential' }),
    box(55.3850, 25.1258, 0.0011, 0.0006, { osm_id: 102, name: 'DSO Headquarters', height: '62', building: 'office' }),
    box(55.3800, 25.1222, 0.0008, 0.0008, { osm_id: 103, name: null, levels: '6', building: 'yes', street: 'Tech Avenue', housenumber: '12' }),
    box(55.3868, 25.1228, 0.0012, 0.0005, { osm_id: 104, name: 'Techno Hub 1', height: '24', building: 'commercial' }),
    box(55.3812, 25.1270, 0.0006, 0.0006, { osm_id: 105, name: null, levels: '12', building: 'apartments' }),
  ]),
  pois: fc([
    pt(55.3842, 25.1238, { osm_id: 201, name: 'Oasis Pharmacy', amenity: 'pharmacy', phone: '+971 4 000 0000' }),
    pt(55.3858, 25.1249, { osm_id: 202, name: 'Silicon Café', amenity: 'cafe' }),
    pt(55.3808, 25.1248, { osm_id: 203, name: 'Oasis Mosque', amenity: 'place_of_worship' }),
  ]),
  parks: fc([box(55.3790, 25.1255, 0.0015, 0.0010, { osm_id: 301, name: 'Central Park', leisure: 'park' })]),
  water: fc([box(55.3875, 25.1275, 0.0008, 0.0004, { osm_id: 401, name: 'Lake', natural: 'water' })]),
  railways: fc([line([[55.3700, 25.1320], [55.3980, 25.1150]], { osm_id: 501, name: 'Etihad Rail (lab)', railway: 'rail' })]),
  infrastructure: fc([
    pt(55.3823, 25.1264, { osm_id: 601, highway: 'traffic_signals', name: 'DSO Central Roundabout' }),
    pt(55.3835, 25.1233, { osm_id: 602, man_made: 'surveillance' }),
    pt(55.3862, 25.1241, { osm_id: 603, emergency: 'fire_hydrant' }),
    pt(55.3815, 25.1229, { osm_id: 604, amenity: 'charging_station', operator: 'DEWA' }),
  ]),
};

// ── Transport feed ───────────────────────────────────────────────────────────
// Signal positions and timings from the DSO dataset (_legacy/data/trafficSignals.ts).

export const LAB_TRAFFIC: TrafficFeed = {
  signals: [
    { id: 'DSO-SIG-101', name: 'DSO Central Roundabout', lng: 55.3823, lat: 25.1264, phase: 'GREEN', phaseRemainingSec: 34, greenSec: 60, redSec: 37, cycleSec: 100, density: 32, connectedRoads: 4, status: 'ACTIVE' },
    { id: 'DSO-SIG-102', name: 'DSO West Boulevard Junction', lng: 55.3796, lat: 25.1219, phase: 'RED', phaseRemainingSec: 12, greenSec: 45, redSec: 27, cycleSec: 75, density: 24, connectedRoads: 3, status: 'ACTIVE' },
    { id: 'DSO-SIG-103', name: 'Academic City Road Entry', lng: 55.3842, lat: 25.1189, phase: 'GREEN', phaseRemainingSec: 20, greenSec: 42, redSec: 25, cycleSec: 70, density: 18, connectedRoads: 3, status: 'ACTIVE', held: true },
    { id: 'DSO-SIG-104', name: 'Inner Residential Junction', lng: 55.3817, lat: 25.1284, phase: 'YELLOW', phaseRemainingSec: 2, greenSec: 50, redSec: 32, cycleSec: 85, density: 28, connectedRoads: 4, status: 'ACTIVE' },
    { id: 'DSO-SIG-105', name: 'East Gate Junction', lng: 55.3890, lat: 25.1240, phase: 'FLASHING', phaseRemainingSec: null, greenSec: 45, redSec: 30, cycleSec: 78, density: 9, connectedRoads: 3, status: 'FAULT' },
  ],
  congestion: [
    { id: 'R-1', name: 'Silicon Oasis Boulevard', level: 'LOW', path: [[55.3740, 25.1180], [55.3823, 25.1264], [55.3950, 25.1330]] },
    { id: 'R-2', name: 'Dubai Silicon Oasis Road', level: 'HIGH', path: [[55.3760, 25.1300], [55.3817, 25.1284], [55.3930, 25.1170]] },
    { id: 'R-3', name: 'Academic City Road', level: 'CRITICAL', path: [[55.3842, 25.1189], [55.3900, 25.1120]] },
    { id: 'R-4', name: 'West Boulevard', level: 'MEDIUM', path: [[55.3796, 25.1219], [55.3720, 25.1150]] },
  ],
  intersections: [[55.3823, 25.1264], [55.3796, 25.1219], [55.3842, 25.1189], [55.3817, 25.1284], [55.3890, 25.1240]],
  accident: { id: 'ACC-LAB-1', name: 'Collision — Academic City Rd', lng: 55.3868, lat: 25.1160, severity: 'HIGH' },
};

// ── Civil Defence (BMS) feed ─────────────────────────────────────────────────
// Positions and readings from the DSO dataset (_legacy/data/bmsBuildings.ts).

function bms(id: string, name: string, type: string, lng: number, lat: number, floors: number, heightM: number,
             status: BmsBuilding['status'], power: number, hvac: number, occupancy: number, count: number,
             pressure: number, fireAlarms: number): BmsBuilding {
  return {
    id, name, type, lng, lat, floors, heightM, status, powerLoadPct: power, hvacEfficiencyPct: hvac,
    occupancyPct: occupancy, occupancyCount: count, waterPressureBar: pressure, fireAlarms,
    alerts: status === 'normal' ? [] : [
      { id: `${id}-A1`, system: fireAlarms ? 'fire' : 'power', severity: status === 'critical' ? 'critical' : 'warning',
        message: fireAlarms ? 'Smoke detected — floor 14 east stair' : `Power load at ${power}% of capacity` },
    ],
  };
}

export const LAB_BMS: BmsFeed = {
  mode: 'status',
  buildings: [
    bms('BLD_001', 'The NEST', 'tech', 55.3790, 25.1205, 12, 52, 'normal', 68, 88, 72, 580, 3.2, 0),
    bms('BLD_002', 'DSO HQ Tower', 'commercial', 55.3820, 25.1218, 18, 76, 'warning', 82, 71, 85, 920, 3.0, 0),
    bms('BLD_003', 'Innovation Hub A', 'tech', 55.3835, 25.1240, 8, 36, 'normal', 55, 91, 60, 240, 3.4, 0),
    bms('BLD_004', 'Innovation Hub B', 'tech', 55.3852, 25.1232, 8, 36, 'critical', 95, 62, 95, 380, 2.6, 0),
    bms('BLD_005', 'Techno Park Center', 'tech', 55.3868, 25.1220, 10, 44, 'normal', 61, 85, 68, 420, 3.1, 0),
    bms('BLD_006', 'DSO Mall', 'commercial', 55.3904, 25.1248, 4, 22, 'warning', 79, 74, 88, 2100, 3.0, 0),
    bms('BLD_009', 'Silicon Gate Tower', 'commercial', 55.3954, 25.1298, 26, 108, 'critical', 88, 58, 78, 940, 2.4, 1),
    bms('BLD_016', 'Data Center DSO-1', 'industrial', 55.3760, 25.1188, 4, 20, 'warning', 86, 76, 15, 22, 3.8, 0),
    bms('BLD_017', 'Data Center DSO-2', 'industrial', 55.3775, 25.1178, 3, 16, 'critical', 97, 52, 8, 12, 3.6, 0),
    bms('BLD_029', 'Conference Center DSO', 'commercial', 55.3880, 25.1310, 4, 18, 'warning', 84, 73, 92, 1100, 2.9, 0),
  ],
};

// ── Utility (DEWA) feed ──────────────────────────────────────────────────────
// A small DSO network with a burst on a distribution main: upstream valve closed,
// backup route open, three downstream nodes affected.

export const LAB_WATER: WaterFeed = {
  nodes: [
    { id: 'WN-SRC', kind: 'source', name: 'DSO Lake intake', lng: 55.3880, lat: 25.1300, status: 'active', flowLpm: 5400 },
    { id: 'WN-PMP', kind: 'pump', name: 'Pumping station P1', lng: 55.3850, lat: 25.1285, status: 'active', pressurePsi: 72, flowLpm: 3100 },
    { id: 'WN-STO', kind: 'storage', name: 'Overhead tank T2', lng: 55.3795, lat: 25.1275, status: 'active', capacityL: 850000 },
    { id: 'WN-TRT', kind: 'treatment', name: 'Wastewater plant', lng: 55.3760, lat: 25.1185, status: 'active' },
    { id: 'WN-B1', kind: 'building', name: 'Silicon Heights A', lng: 55.3835, lat: 25.1228, status: 'critical', population: 640, affected: true },
    { id: 'WN-B2', kind: 'building', name: 'Silicon Heights B', lng: 55.3848, lat: 25.1215, status: 'critical', population: 590, affected: true },
    { id: 'WN-HYD', kind: 'hydrant', name: 'Hydrant H-07', lng: 55.3826, lat: 25.1210, status: 'warning', pressurePsi: 18, affected: true },
    { id: 'WN-TAP', kind: 'tap', name: 'Plaza tap', lng: 55.3810, lat: 25.1240, status: 'active', pressurePsi: 58 },
  ],
  pipes: [
    { id: 'P-M1', class: 'main', status: 'normal', path: [[55.3880, 25.1300], [55.3850, 25.1285], [55.3795, 25.1275]] },
    { id: 'P-D1', class: 'distribution', status: 'closed', path: [[55.3850, 25.1285], [55.3842, 25.1255]] },
    { id: 'P-D2', class: 'distribution', status: 'burst', path: [[55.3842, 25.1255], [55.3838, 25.1232]] },
    { id: 'P-D3', class: 'distribution', status: 'backup', path: [[55.3795, 25.1275], [55.3810, 25.1240], [55.3826, 25.1210]] },
    { id: 'P-S1', class: 'service', status: 'low_pressure', path: [[55.3838, 25.1232], [55.3835, 25.1228]] },
    { id: 'P-S2', class: 'service', status: 'low_pressure', path: [[55.3838, 25.1232], [55.3848, 25.1215]] },
    { id: 'P-M2', class: 'main', status: 'normal', path: [[55.3795, 25.1275], [55.3760, 25.1185]] },
  ],
  incident: { id: 'WB-LAB-1', pipeId: 'P-D2', kind: 'burst', severity: 'HIGH', lng: 55.3840, lat: 25.1244, affectedUsers: 1230, pressureDropPsi: 41 },
};

// ── Municipality feed ────────────────────────────────────────────────────────
// Bins from the DSO dataset (_legacy/data/wasteBins.ts); WB-007 is its overflow case.

function bin(id: string, name: string, lng: number, lat: number, zone: string, fillPct: number,
             capacityL: number, batteryPct: number, kind: WasteBin['kind'], sensor: WasteBin['sensor'] = 'online'): WasteBin {
  return { id, name, lng, lat, zone, fillPct, capacityL, batteryPct, kind, sensor,
           lastCollectedAt: new Date(Date.now() - (fillPct / 100) * 30 * 3600_000).toISOString() };
}

export const LAB_WASTE: WasteFeed = {
  bins: [
    bin('WB-001', 'Silicon Heights Block A', 55.3801, 25.1248, 'Residential North', 45, 240, 87, 'general'),
    bin('WB-002', 'Silicon Heights Block B', 55.3814, 25.1255, 'Residential North', 62, 240, 92, 'recycling'),
    bin('WB-004', 'Tech Park Plaza', 55.3858, 25.1238, 'Tech Zone', 55, 360, 65, 'general'),
    bin('WB-005', 'DSO HQ Entrance', 55.3875, 25.1225, 'Tech Zone', 71, 360, 90, 'recycling'),
    bin('WB-007', 'Silicon Gates Tower', 55.3833, 25.1272, 'Residential North', 96, 240, 72, 'general'),
    bin('WB-008', 'Central Roundabout', 55.3820, 25.1268, 'Central', 52, 360, 83, 'organic'),
    bin('WB-009', 'Garden Walk', 55.3843, 25.1282, 'Parks', 60, 120, 91, 'organic'),
    bin('WB-013', 'NEST Building', 55.3793, 25.1208, 'Commercial', 78, 360, 55, 'recycling'),
    bin('WB-012', 'Residential South Gate', 55.3807, 25.1192, 'Residential South', 29, 240, 12, 'recycling', 'offline'),
  ],
};

// ── Environment feed ─────────────────────────────────────────────────────────
// Sensors and sources from the DSO dataset (_legacy/data/environmentSensors.ts,
// pollutionSources.ts). The wind grid is the legacy grid, made deterministic.

function air(id: string, name: string, lng: number, lat: number, zone: string, aqi: number, pm25: number, pm10: number,
             co2: number, no2: number, o3: number, temperatureC: number, humidityPct: number, windKph: number, windDirDeg: number): AirSensor {
  return { id, name, lng, lat, zone, aqi, pm25, pm10, co2, no2, o3, temperatureC, humidityPct, windKph, windDirDeg, lastCalibration: '2026-08-30' };
}

export const LAB_AIR: AirSensor[] = [
  air('AQI-001', 'Academic City Junction', 55.3823, 25.1264, 'Main Road', 165, 85, 145, 450, 95, 62, 38, 45, 12, 135),
  air('AQI-002', 'Innovation Boulevard North', 55.3890, 25.1290, 'Main Road', 142, 72, 128, 420, 88, 58, 37, 48, 15, 140),
  air('AQI-004', 'Silicon Park Gateway', 55.3795, 25.1235, 'Main Road', 135, 68, 118, 410, 82, 55, 36, 50, 14, 145),
  air('AQI-005', 'Axis Residence Complex', 55.3750, 25.1280, 'Residential', 92, 38, 68, 380, 45, 48, 35, 55, 10, 130),
  air('AQI-009', 'DSO Headquarters Plaza', 55.3870, 25.1245, 'Commercial', 118, 52, 92, 400, 65, 55, 36, 48, 13, 142),
  air('AQI-013', 'Central Park North', 55.3805, 25.1295, 'Park', 42, 12, 28, 340, 22, 35, 32, 65, 6, 120),
  air('AQI-018', 'Manufacturing District', 55.3740, 25.1220, 'Industrial', 148, 70, 125, 440, 85, 68, 39, 40, 17, 152),
  air('AQI-020', 'Lake Promenade', 55.3905, 25.1215, 'Park', 48, 14, 30, 345, 24, 38, 33, 62, 8, 128),
];

function source(id: string, name: string, lng: number, lat: number, kind: PollutionSource['kind'], emission: PollutionSource['emission'],
                contributionPct: number, affectedRadiusM: number, activeHours: string, mitigation: PollutionSource['mitigation'],
                pm25: number, no2: number, voc: number, trafficPerHour: number | null, description: string): PollutionSource {
  return { id, name, lng, lat, kind, emission, contributionPct, affectedRadiusM, activeHours, mitigation,
           pollutants: { pm25, pm10: Math.round(pm25 * 1.7), no2, co2: 440, voc }, trafficPerHour, description };
}

export const LAB_POLLUTION: PollutionSource[] = [
  source('PM-TRAFFIC-001', 'Academic City Junction', 55.3823, 25.1264, 'traffic', 'critical', 18, 400, '06:00-23:00', 'monitoring', 85, 95, 120, 285, 'High traffic congestion during peak hours. Major intersection with traffic signals.'),
  source('PM-TRAFFIC-003', 'Transit Hub', 55.3860, 25.1275, 'traffic', 'high', 14, 380, '05:00-23:00', 'monitoring', 68, 86, 108, 320, 'Public transit interchange. Peak congestion 08:00-09:00 and 17:00-19:00.'),
  source('PM-INDUSTRIAL-001', 'Manufacturing District', 55.3742, 25.1295, 'industrial', 'critical', 12, 500, '24/7', 'active', 70, 85, 180, null, 'Industrial manufacturing zone. Air filtration systems installed.'),
  source('PM-INDUSTRIAL-003', 'Data Center Alpha', 55.3768, 25.1272, 'industrial', 'high', 8, 320, '24/7', 'active', 60, 75, 95, null, 'Large-scale data center. HVAC cooling optimised for efficiency.'),
  source('PM-CONSTRUCTION-001', 'Residential Phase 4 Site', 55.3915, 25.1195, 'construction', 'medium', 6, 250, '07:00-18:00', 'active', 55, 40, 60, null, 'Dust suppression in place during earthworks.'),
];

export const LAB_WIND: WindVector[] = (() => {
  const out: WindVector[] = [];
  const [rows, cols] = [8, 10];
  const [latMin, latMax, lngMin, lngMax] = [25.1200, 25.1350, 55.3710, 55.3960];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = noise(i + 4000);
      out.push({
        id: `WIND-${String(i).padStart(3, '0')}`,
        lat: latMin + (r + 0.5) * ((latMax - latMin) / rows),
        lng: lngMin + (c + 0.5) * ((lngMax - lngMin) / cols),
        towardsDeg: 140 + (n * 20 - 10),
        speedKph: 15 + (noise(i + 5000) * 6 - 3),
        altitudeM: i % 7 === 0 ? 50 : 10,
      });
      i++;
    }
  }
  return out;
})();
