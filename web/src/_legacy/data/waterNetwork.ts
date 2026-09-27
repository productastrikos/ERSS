/**
 * Water Pipeline Management System — data, types, and network generation
 *
 * Hierarchy:  SOURCE → TREATMENT → STORAGE → PUMP → MAIN → DISTRIBUTION → END USER
 *
 * Real infra is fetched from /water + /infrastructure APIs at runtime.
 * This module provides:
 *   - Type definitions
 *   - Simulated storage tanks & buildings (missing from OSM)
 *   - Network graph builder (connects real + simulated nodes)
 *   - Incident simulation helpers
 */

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type WaterNodeType =
  | 'source'        // lake / reservoir / canal
  | 'treatment'     // wastewater plant
  | 'storage'       // overhead tank / underground reservoir (simulated)
  | 'pump'          // pumping station
  | 'tap'           // water tap
  | 'hydrant'       // fire hydrant
  | 'drinking'      // drinking water point
  | 'building';     // end-user building (simulated)

export type PipelineType = 'main' | 'distribution' | 'service';
export type PipelineStatus = 'normal' | 'low_pressure' | 'leak' | 'burst' | 'closed' | 'backup';

export interface WaterNode {
  id:         string;
  type:       WaterNodeType;
  name:       string;
  location:   [number, number]; // [lng, lat]
  population?: number;          // for buildings / distribution points
  capacity?:  number;           // litres for storage
  flowRate?:  number;           // L/min for pumps
  pressure?:  number;           // PSI
  status:     'active' | 'warning' | 'critical' | 'offline';
  zone:       string;
}

export interface Pipeline {
  id:          string;
  from:        string;           // node id
  to:          string;           // node id
  type:        PipelineType;
  flowRate:    number;           // L/min
  pressure:    number;           // PSI
  status:      PipelineStatus;
  length:      number;           // metres (approx)
  coordinates: [number, number][]; // line geometry [lng, lat][]
}

// ── Root cause types ──────────────────────────────────────────────────────────
export type WaterRootCause =
  | 'pipe_aging'
  | 'pressure_surge'
  | 'external_damage'
  | 'pump_failure'
  | 'corrosion'
  | 'ground_movement';

export interface WaterSensorReading {
  sensorId:    string;
  label:       string;
  value:       number;
  unit:        string;
  threshold:   number;
  anomaly:     boolean;
  trend:       'rising' | 'dropping' | 'stable';
}

export interface WaterAutoAction {
  id:      string;
  action:  string;
  icon:    string;
  status:  'pending' | 'executing' | 'done';
  detail:  string;
}

export interface WaterImpactDetail {
  buildings:   number;
  waterPoints: number;
  hydrants:    number;
  hospitals:   number;
  population:  number;
  downtimeEst: number;     // minutes
  nodeIds:     string[];
}

export interface WaterPostAnalytics {
  responseTimeSec:  number;
  repairDurationSec: number;
  totalDowntimeSec:  number;
  usersImpacted:     number;
  pipelinesAffected: number;
  resolvedAt:        number;
}

export interface WaterIncident {
  id:              string;
  pipelineId:      string;
  upstreamPipeIds: string[];   // pipes to close (turn orange)
  backupPipeIds:   string[];   // backup route (turn green)
  type:            'leak' | 'burst' | 'low_pressure' | 'contamination';
  location:        [number, number];
  severity:        'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  rootCause:       WaterRootCause;
  rootCauseLabel:  string;
  detectedAt:      number;
  status:          'detecting' | 'validating' | 'confirmed' | 'auto_response' | 'assigning' | 'assigned' | 'en_route' | 'repairing' | 'resolved';
  validationScore: number;     // 0–100 confidence %
  sensorReadings:  WaterSensorReading[];
  autoActions:     WaterAutoAction[];
  affectedNodes:   string[];
  impactDetail:    WaterImpactDetail;
  affectedUsers:   number;
  pressureDrop:    number;     // PSI lost
  flowReduction:   number;     // % reduction
  assignedTo?:     string;     // responder userId
  assignedName?:   string;
  analytics?:      WaterPostAnalytics;
}

export interface WaterNetworkState {
  nodes:      WaterNode[];
  pipelines:  Pipeline[];
  incident:   WaterIncident | null;
  stats: {
    totalFlow:       number;
    activePipelines: number;
    avgPressure:     number;
    alerts:          number;
    leaks:           number;
    lowPressure:     number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DSO CENTRE & ZONES
// ─────────────────────────────────────────────────────────────────────────────

const DSO = { lng: 55.3823, lat: 25.1264 };

export const WATER_ZONES = [
  { id: 'zone-1', name: 'Zone 1 — North Residential', center: [55.3836, 25.1312] as [number, number] },
  { id: 'zone-2', name: 'Zone 2 — Central Commercial', center: [55.3823, 25.1264] as [number, number] },
  { id: 'zone-3', name: 'Zone 3 — South Academic', center: [55.3842, 25.1189] as [number, number] },
  { id: 'zone-4', name: 'Zone 4 — West Industrial', center: [55.3780, 25.1247] as [number, number] },
];

// ─────────────────────────────────────────────────────────────────────────────
//  SIMULATED NODES (Storage tanks & buildings not in OSM)
// ─────────────────────────────────────────────────────────────────────────────

export const SIMULATED_STORAGE: WaterNode[] = [
  { id: 'ST-001', type: 'storage', name: 'North Elevated Tank',   location: [55.3840, 25.1298], capacity: 80000,  status: 'active', zone: 'zone-1', pressure: 85, flowRate: 300 },
  { id: 'ST-002', type: 'storage', name: 'Central UG Reservoir',  location: [55.3810, 25.1255], capacity: 120000, status: 'active', zone: 'zone-2', pressure: 90, flowRate: 450 },
  { id: 'ST-003', type: 'storage', name: 'South Storage Facility',location: [55.3850, 25.1200], capacity: 60000,  status: 'active', zone: 'zone-3', pressure: 78, flowRate: 250 },
  { id: 'ST-004', type: 'storage', name: 'West Industrial Tank',  location: [55.3770, 25.1235], capacity: 100000, status: 'active', zone: 'zone-4', pressure: 82, flowRate: 350 },
];

export const SIMULATED_BUILDINGS: WaterNode[] = [
  { id: 'BLD-W01', type: 'building', name: 'Silicon Heights Tower A', location: [55.3856, 25.1305], population: 320, status: 'active', zone: 'zone-1' },
  { id: 'BLD-W02', type: 'building', name: 'Silicon Heights Tower B', location: [55.3848, 25.1295], population: 280, status: 'active', zone: 'zone-1' },
  { id: 'BLD-W03', type: 'building', name: 'DSO Tech Office Park',    location: [55.3818, 25.1272], population: 150, status: 'active', zone: 'zone-2' },
  { id: 'BLD-W04', type: 'building', name: 'Silicon Mall',            location: [55.3825, 25.1260], population: 500, status: 'active', zone: 'zone-2' },
  { id: 'BLD-W05', type: 'building', name: 'Academic City Residence', location: [55.3845, 25.1195], population: 200, status: 'active', zone: 'zone-3' },
  { id: 'BLD-W06', type: 'building', name: 'Innovation Hub',          location: [55.3835, 25.1185], population: 120, status: 'active', zone: 'zone-3' },
  { id: 'BLD-W07', type: 'building', name: 'West Industrial Complex', location: [55.3778, 25.1240], population: 80,  status: 'active', zone: 'zone-4' },
  { id: 'BLD-W08', type: 'building', name: 'DSO Headquarters',        location: [55.3798, 25.1225], population: 250, status: 'active', zone: 'zone-2' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  NETWORK BUILDER — road-following pipeline backbone for Dubai Silicon Oasis
//
//  Pipeline topology (follows actual DSO road corridors):
//    DEWA supply (E66/south boundary) → South Booster Pump Station
//    → South Ring Road Junction → Central Distribution Hub
//    → North Trunk  (N1 → N2 → North Elevated Storage Tank)
//    → West Boulevard Trunk  (WEW1 → WEW2 → West Storage Tank)
//    → East Boulevard Trunk  (EEW1 → EEW2 → EEW3 → East Storage / Academic City)
//    + Distribution branches: NW residential loop, north zone, south-east tech,
//      central-east corridor
//    + Short L-shaped service connections for every API node
// ─────────────────────────────────────────────────────────────────────────────

// ── Utility helpers (also used by incident simulation below) ─────────────────
function dist(a: [number, number], b: [number, number]): number {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Nearest zone lookup — uses WATER_ZONES which have `center` not `location` */
function nearestZone(loc: [number, number]): typeof WATER_ZONES[0] {
  let best = WATER_ZONES[0];
  let bestD = Infinity;
  for (const z of WATER_ZONES) {
    const d = dist(loc, z.center);
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}

let pipeIdCounter = 0;
function nextPipeId(): string {
  return `WP-${String(++pipeIdCounter).padStart(3, '0')}`;
}

// ── Backbone type definitions ─────────────────────────────────────────────────
interface BBNode {
  id: string; name: string; type: WaterNodeType;
  loc: [number, number]; pressure: number; flowRate: number; capacity?: number;
}
interface BBPipe {
  fromId: string; toId: string; type: PipelineType;
  path: [number, number][];
}

/**
 * DSO Road-Following Backbone Junction Nodes
 *
 * Coordinates are verified to lie inside the DSO boundary polygon.
 * Positions reflect key road junctions based on the DSO road network:
 *   — Al Ain Road (E66) south supply entry
 *   — Internal N-S spine road (central "heartbeat" road of DSO)
 *   — Main boulevard running roughly E-W (slight NW-SE due to DSO orientation)
 *   — West Silicon Village residential loop roads
 *   — East Tech Zone / Academic City branch
 *   — North lakeside residential area (near DSO canal)
 */
const DSO_BB_NODES: BBNode[] = [
  // South supply chain
  { id: 'J-DEWA',    name: 'DEWA Supply Point — E66 Meter',       type: 'source',  loc: [55.3801, 25.1078], pressure: 110, flowRate: 850 },
  { id: 'J-PUMP-S',  name: 'DSO South Booster Pump Station',      type: 'pump',    loc: [55.3808, 25.1148], pressure:  95, flowRate: 620 },
  { id: 'J-JUNC-S',  name: 'South Ring Road Junction',            type: 'pump',    loc: [55.3818, 25.1218], pressure:  88, flowRate: 510 },
  // Central backbone hub
  { id: 'J-MAIN',    name: 'Central Distribution Hub',            type: 'storage', loc: [55.3822, 25.1265], pressure:  85, flowRate: 560, capacity: 120000 },
  // North trunk
  { id: 'J-N1',      name: 'North Spine Junction 1',              type: 'pump',    loc: [55.3823, 25.1295], pressure:  82, flowRate: 360 },
  { id: 'J-N2',      name: 'North Spine Junction 2',              type: 'pump',    loc: [55.3825, 25.1320], pressure:  80, flowRate: 290 },
  { id: 'J-STORE-N', name: 'North Elevated Storage Tank',         type: 'storage', loc: [55.3824, 25.1345], pressure:  78, flowRate: 310, capacity: 80000 },
  // West boulevard branch
  { id: 'J-WEW1',    name: 'West Boulevard Junction 1',           type: 'pump',    loc: [55.3758, 25.1258], pressure:  83, flowRate: 330 },
  { id: 'J-WEW2',    name: 'West Boulevard Junction 2',           type: 'pump',    loc: [55.3715, 25.1238], pressure:  80, flowRate: 255 },
  { id: 'J-STORE-W', name: 'West Residential Storage Tank',       type: 'storage', loc: [55.3692, 25.1215], pressure:  77, flowRate: 270, capacity: 60000 },
  // East boulevard branch
  { id: 'J-EEW1',    name: 'East Boulevard Junction 1',           type: 'pump',    loc: [55.3858, 25.1268], pressure:  84, flowRate: 385 },
  { id: 'J-EEW2',    name: 'East Boulevard Junction 2',           type: 'pump',    loc: [55.3905, 25.1270], pressure:  82, flowRate: 305 },
  { id: 'J-EEW3',    name: 'East Boulevard Junction 3',           type: 'pump',    loc: [55.3948, 25.1268], pressure:  80, flowRate: 245 },
  { id: 'J-STORE-E', name: 'East Storage / Academic City Supply', type: 'storage', loc: [55.3978, 25.1265], pressure:  78, flowRate: 220, capacity: 90000 },
  // Distribution branches
  { id: 'J-NW-D',    name: 'NW Residential Distribution Node',    type: 'pump',    loc: [55.3712, 25.1228], pressure:  74, flowRate: 180 },
  { id: 'J-W-D',     name: 'West Residential Distribution Node',  type: 'pump',    loc: [55.3710, 25.1192], pressure:  72, flowRate: 155 },
  { id: 'J-SW-D',    name: 'SW Silicon Village Distribution',     type: 'pump',    loc: [55.3733, 25.1148], pressure:  70, flowRate: 140 },
  { id: 'J-N-WEST',  name: 'North-West Zone Supply Node',         type: 'pump',    loc: [55.3760, 25.1318], pressure:  76, flowRate: 200 },
  { id: 'J-N-EAST',  name: 'North-East Zone Supply Node',         type: 'pump',    loc: [55.3868, 25.1325], pressure:  77, flowRate: 225 },
  { id: 'J-SE-T',    name: 'South-East Tech Zone Supply',         type: 'pump',    loc: [55.3872, 25.1218], pressure:  79, flowRate: 250 },
  { id: 'J-CE',      name: 'Central-East Distribution Node',      type: 'pump',    loc: [55.3928, 25.1242], pressure:  78, flowRate: 235 },
];

/**
 * DSO Road-Following Backbone Pipes
 *
 * Each path[] traces the actual road corridor between two junction nodes.
 * Multi-point coordinates make pipelines follow road bends instead of
 * drawing straight abstract lines.
 */
const DSO_BB_PIPES: BBPipe[] = [
  // ── Main trunk: South supply → Central Hub ───────────────────────────────
  { fromId: 'J-DEWA',    toId: 'J-PUMP-S',  type: 'main',
    path: [[55.3801,25.1078],[55.3802,25.1100],[55.3805,25.1128],[55.3808,25.1148]] },
  { fromId: 'J-PUMP-S',  toId: 'J-JUNC-S',  type: 'main',
    path: [[55.3808,25.1148],[55.3812,25.1172],[55.3815,25.1195],[55.3818,25.1218]] },
  { fromId: 'J-JUNC-S',  toId: 'J-MAIN',    type: 'main',
    path: [[55.3818,25.1218],[55.3820,25.1238],[55.3821,25.1252],[55.3822,25.1265]] },
  // ── North trunk ──────────────────────────────────────────────────────────
  { fromId: 'J-MAIN',    toId: 'J-N1',      type: 'main',
    path: [[55.3822,25.1265],[55.3823,25.1278],[55.3823,25.1295]] },
  { fromId: 'J-N1',      toId: 'J-N2',      type: 'main',
    path: [[55.3823,25.1295],[55.3824,25.1308],[55.3825,25.1320]] },
  { fromId: 'J-N2',      toId: 'J-STORE-N', type: 'main',
    path: [[55.3825,25.1320],[55.3824,25.1332],[55.3824,25.1345]] },
  // ── West boulevard trunk (follows road curving NW with DSO layout) ────────
  { fromId: 'J-MAIN',    toId: 'J-WEW1',    type: 'main',
    path: [[55.3822,25.1265],[55.3800,25.1262],[55.3780,25.1260],[55.3758,25.1258]] },
  { fromId: 'J-WEW1',    toId: 'J-WEW2',    type: 'main',
    path: [[55.3758,25.1258],[55.3740,25.1250],[55.3722,25.1243],[55.3715,25.1238]] },
  { fromId: 'J-WEW2',    toId: 'J-STORE-W', type: 'main',
    path: [[55.3715,25.1238],[55.3707,25.1230],[55.3698,25.1222],[55.3692,25.1215]] },
  // ── East boulevard trunk ─────────────────────────────────────────────────
  { fromId: 'J-MAIN',    toId: 'J-EEW1',    type: 'main',
    path: [[55.3822,25.1265],[55.3840,25.1266],[55.3858,25.1268]] },
  { fromId: 'J-EEW1',    toId: 'J-EEW2',    type: 'main',
    path: [[55.3858,25.1268],[55.3880,25.1269],[55.3905,25.1270]] },
  { fromId: 'J-EEW2',    toId: 'J-EEW3',    type: 'main',
    path: [[55.3905,25.1270],[55.3927,25.1269],[55.3948,25.1268]] },
  { fromId: 'J-EEW3',    toId: 'J-STORE-E', type: 'main',
    path: [[55.3948,25.1268],[55.3963,25.1267],[55.3978,25.1265]] },
  // ── West residential distribution loop (Silicon Village roads) ───────────
  { fromId: 'J-WEW2',    toId: 'J-NW-D',    type: 'distribution',
    path: [[55.3715,25.1238],[55.3713,25.1232],[55.3712,25.1228]] },
  { fromId: 'J-NW-D',    toId: 'J-W-D',     type: 'distribution',
    path: [[55.3712,25.1228],[55.3711,25.1212],[55.3710,25.1200],[55.3710,25.1192]] },
  { fromId: 'J-W-D',     toId: 'J-SW-D',    type: 'distribution',
    path: [[55.3710,25.1192],[55.3715,25.1175],[55.3722,25.1160],[55.3733,25.1148]] },
  { fromId: 'J-SW-D',    toId: 'J-PUMP-S',  type: 'distribution',
    path: [[55.3733,25.1148],[55.3752,25.1140],[55.3770,25.1140],[55.3790,25.1142],[55.3808,25.1148]] },
  // ── North zone distribution ───────────────────────────────────────────────
  { fromId: 'J-N2',      toId: 'J-N-WEST',  type: 'distribution',
    path: [[55.3825,25.1320],[55.3807,25.1318],[55.3785,25.1318],[55.3760,25.1318]] },
  { fromId: 'J-STORE-N', toId: 'J-N-EAST',  type: 'distribution',
    path: [[55.3824,25.1345],[55.3843,25.1338],[55.3856,25.1332],[55.3868,25.1325]] },
  // ── South-East tech zone distribution ─────────────────────────────────────
  { fromId: 'J-JUNC-S',  toId: 'J-SE-T',    type: 'distribution',
    path: [[55.3818,25.1218],[55.3840,25.1218],[55.3858,25.1218],[55.3872,25.1218]] },
  { fromId: 'J-EEW1',    toId: 'J-SE-T',    type: 'distribution',
    path: [[55.3858,25.1268],[55.3860,25.1248],[55.3864,25.1232],[55.3872,25.1218]] },
  // ── Central-East distribution ─────────────────────────────────────────────
  { fromId: 'J-EEW2',    toId: 'J-CE',      type: 'distribution',
    path: [[55.3905,25.1270],[55.3912,25.1258],[55.3920,25.1249],[55.3928,25.1242]] },
  { fromId: 'J-SE-T',    toId: 'J-CE',      type: 'distribution',
    path: [[55.3872,25.1218],[55.3895,25.1228],[55.3912,25.1235],[55.3928,25.1242]] },
];

/**
 * Build the full water network graph from API features + simulated data.
 *
 * Pipeline structure:
 *  1. Fixed backbone — real DSO road-following mains + distribution pipes
 *  2. API water sources → service connection to nearest backbone junction
 *  3. API infrastructure (pumps, taps, hydrants) → service connection
 *  4. API buildings → service connection (named buildings, max ~200)
 *
 * @param waterFeatures     GeoJSON from /water API
 * @param infraFeatures     GeoJSON from /infrastructure API
 * @param buildingFeatures  GeoJSON from /buildings API
 */
export function buildWaterNetwork(
  waterFeatures: GeoJSON.FeatureCollection,
  infraFeatures: GeoJSON.FeatureCollection,
  buildingFeatures?: GeoJSON.FeatureCollection,
): { nodes: WaterNode[]; pipelines: Pipeline[] } {
  pipeIdCounter = 0;
  const nodes: WaterNode[] = [];
  const pipelines: Pipeline[] = [];

  // ── Step 1: Create all backbone junction nodes ────────────────────────────
  const junctionNodes: WaterNode[] = DSO_BB_NODES.map(n => ({
    id:       n.id,
    type:     n.type,
    name:     n.name,
    location: n.loc,
    pressure: n.pressure,
    flowRate: n.flowRate,
    capacity: n.capacity,
    status:   'active' as const,
    zone:     nearestZone(n.loc).id,
  }));
  nodes.push(...junctionNodes);

  // ── Step 2: Create all backbone pipeline segments ─────────────────────────
  const bbNodeMap = new Map<string, WaterNode>(junctionNodes.map(j => [j.id, j]));
  for (const bp of DSO_BB_PIPES) {
    const fromNode = bbNodeMap.get(bp.fromId)!;
    const toNode   = bbNodeMap.get(bp.toId)!;
    const length   = bp.path.reduce(
      (sum, pt, i) => (i === 0 ? 0 : sum + dist(bp.path[i - 1], pt)), 0,
    );
    const basePressure = bp.type === 'main' ? 88 : 70;
    const baseFlow     = bp.type === 'main' ? 380 : 130;
    pipelines.push({
      id:          nextPipeId(),
      from:        fromNode.id,
      to:          toNode.id,
      type:        bp.type,
      flowRate:    baseFlow     + Math.round(Math.random() * 40),
      pressure:    basePressure + Math.round((Math.random() - 0.5) * 12),
      status:      'normal',
      length:      Math.round(length),
      coordinates: bp.path,
    });
  }

  // ── Helpers for API node service connections ──────────────────────────────

  /** Find the nearest backbone junction to a given coordinate */
  function nearestJunction(loc: [number, number]): WaterNode {
    let best = junctionNodes[0];
    let bestD = Infinity;
    for (const j of junctionNodes) {
      const d = dist(loc, j.location);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  /**
   * L-shaped road-following service connection path.
   * Travels along the longitude axis first, then the latitude axis —
   * mimicking how real service pipes follow street grids to reach buildings.
   */
  function serviceLinePath(from: [number, number], junc: WaterNode): [number, number][] {
    const to = junc.location;
    return [from, [to[0], from[1]], to];
  }

  /** Build a service-type Pipeline connecting an API node to its nearest junction */
  function makeServicePipe(apiNode: WaterNode, junc: WaterNode): Pipeline {
    const path   = serviceLinePath(apiNode.location, junc);
    const length = path.reduce((sum, pt, i) => (i === 0 ? 0 : sum + dist(path[i - 1], pt)), 0);
    return {
      id:          nextPipeId(),
      from:        junc.id,
      to:          apiNode.id,
      type:        'service',
      flowRate:    20 + Math.round(Math.random() * 30),
      pressure:    45 + Math.round((Math.random() - 0.5) * 10),
      status:      'normal',
      length:      Math.round(length),
      coordinates: path,
    };
  }

  /** Extract a [lng, lat] centroid from any GeoJSON geometry */
  function extractLoc(geom: GeoJSON.Geometry): [number, number] | null {
    if (geom.type === 'Point') return geom.coordinates as [number, number];
    if (geom.type === 'LineString') {
      const coords = geom.coordinates as number[][];
      const mid = coords[Math.floor(coords.length / 2)];
      return [mid[0], mid[1]];
    }
    if (geom.type === 'Polygon') {
      const ring = (geom.coordinates as number[][][])[0];
      return [
        ring.reduce((s, c) => s + c[0], 0) / ring.length,
        ring.reduce((s, c) => s + c[1], 0) / ring.length,
      ];
    }
    if (geom.type === 'MultiPolygon') {
      const ring = (geom.coordinates as number[][][][])[0][0];
      return [
        ring.reduce((s, c) => s + c[0], 0) / ring.length,
        ring.reduce((s, c) => s + c[1], 0) / ring.length,
      ];
    }
    return null;
  }

  /** Check if a coordinate is within approximate DSO bounds */
  function inDSO(loc: [number, number]): boolean {
    return Math.abs(loc[0] - DSO.lng) < 0.04 && Math.abs(loc[1] - DSO.lat) < 0.04;
  }

  // ── Step 3: Extract API water sources (lakes, reservoirs, canals) ─────────
  for (const f of waterFeatures.features) {
    const loc = extractLoc(f.geometry);
    if (!loc || !inDSO(loc)) continue;
    const p = f.properties as Record<string, string | null>;
    const apiNode: WaterNode = {
      id:       `SRC-${p.osm_id ?? nodes.length}`,
      type:     'source',
      name:     p.name || p.water || 'Water Source',
      location: loc,
      status:   'active',
      zone:     nearestZone(loc).id,
      pressure: 95,
      flowRate: 500,
    };
    nodes.push(apiNode);
    pipelines.push(makeServicePipe(apiNode, nearestJunction(loc)));
  }

  // ── Step 4: Extract API infrastructure nodes ──────────────────────────────
  for (const f of infraFeatures.features) {
    const loc = extractLoc(f.geometry);
    if (!loc || !inDSO(loc)) continue;
    const p    = f.properties as Record<string, string | null>;
    const cat  = p.category;
    const zone = nearestZone(loc).id;
    let apiNode: WaterNode | null = null;

    if (cat === 'pumping_station' || p.man_made === 'pumping_station') {
      apiNode = { id: `PMP-${p.osm_id ?? nodes.length}`, type: 'pump',     name: p.name || 'Pumping Station', location: loc, status: 'active', zone, pressure: 80, flowRate: 220 };
    } else if (cat === 'wastewater_plant' || p.man_made === 'wastewater_plant') {
      apiNode = { id: `TRT-${p.osm_id ?? nodes.length}`, type: 'treatment', name: p.name || 'Water Treatment',  location: loc, status: 'active', zone, pressure: 70, flowRate: 300 };
    } else if (cat === 'water_tap' || p.man_made === 'water_tap') {
      apiNode = { id: `TAP-${p.osm_id ?? nodes.length}`, type: 'tap',      name: p.name || 'Water Tap',        location: loc, status: 'active', zone };
    } else if (cat === 'drinking_water' || p.amenity === 'drinking_water') {
      apiNode = { id: `DRK-${p.osm_id ?? nodes.length}`, type: 'drinking', name: p.name || 'Drinking Water',   location: loc, status: 'active', zone };
    } else if (cat === 'fire_hydrant' || p.emergency === 'fire_hydrant') {
      apiNode = { id: `HYD-${p.osm_id ?? nodes.length}`, type: 'hydrant',  name: p.name || 'Fire Hydrant',     location: loc, status: 'active', zone };
    }
    if (!apiNode) continue;
    nodes.push(apiNode);
    pipelines.push(makeServicePipe(apiNode, nearestJunction(loc)));
  }

  // ── Step 5: Extract API buildings ─────────────────────────────────────────
  const buildings: WaterNode[] = [];
  if (buildingFeatures && buildingFeatures.features.length > 0) {
    const popEstimate = (bType: string | null, levels: string | null): number => {
      const lv   = parseInt(levels ?? '1', 10) || 1;
      const base = bType === 'residential' || bType === 'apartments' ? 40
                 : bType === 'office'      || bType === 'commercial'  ? 25
                 : bType === 'retail'      || bType === 'mall'        ? 80
                 : bType === 'university'  || bType === 'school'      ? 60
                 : bType === 'hotel'                                   ? 50 : 15;
      return base * Math.max(1, lv);
    };
    for (const f of buildingFeatures.features) {
      const loc = extractLoc(f.geometry);
      if (!loc || !inDSO(loc)) continue;
      const p = f.properties as Record<string, string | null>;
      if (!p.name && p.building === 'yes') continue; // skip unnamed generic buildings
      buildings.push({
        id:         `BLD-${p.osm_id ?? buildings.length}`,
        type:       'building',
        name:       p.name || `${p.building ?? 'Building'}`,
        location:   loc,
        population: popEstimate(p.building, p.levels),
        status:     'active',
        zone:       nearestZone(loc).id,
      });
    }
  }
  if (buildings.length === 0) buildings.push(...SIMULATED_BUILDINGS);

  for (const bld of buildings) {
    nodes.push(bld);
    pipelines.push(makeServicePipe(bld, nearestJunction(bld.location)));
  }

  return { nodes, pipelines };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STATS CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export function computeStats(pipelines: Pipeline[]): WaterNetworkState['stats'] {
  const active = pipelines.filter(p => p.status === 'normal' || p.status === 'backup');
  return {
    totalFlow:       active.reduce((s, p) => s + p.flowRate, 0),
    activePipelines: active.length,
    avgPressure:     active.length > 0 ? Math.round(active.reduce((s, p) => s + p.pressure, 0) / active.length) : 0,
    alerts:          pipelines.filter(p => p.status !== 'normal' && p.status !== 'backup').length,
    leaks:           pipelines.filter(p => p.status === 'leak' || p.status === 'burst').length,
    lowPressure:     pipelines.filter(p => p.pressure < 40).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  INCIDENT SIMULATION — full lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** Traverse downstream from a broken pipeline to find all affected nodes */
export function findAffectedNodes(
  brokenPipeId: string,
  pipelines: Pipeline[],
  nodes: WaterNode[],
): { affectedNodes: string[]; affectedUsers: number; impactDetail: WaterImpactDetail } {
  const broken = pipelines.find(p => p.id === brokenPipeId);
  if (!broken) return { affectedNodes: [], affectedUsers: 0, impactDetail: { buildings: 0, waterPoints: 0, hydrants: 0, hospitals: 0, population: 0, downtimeEst: 0, nodeIds: [] } };

  const visited = new Set<string>();
  const queue = [broken.to];
  visited.add(broken.from);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const p of pipelines) {
      if (p.from === current && !visited.has(p.to)) queue.push(p.to);
    }
  }
  visited.delete(broken.from);

  const affectedIds = Array.from(visited);
  let buildings = 0, waterPoints = 0, hydrants = 0, hospitals = 0, population = 0;
  for (const id of affectedIds) {
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === 'building') { buildings++; population += node.population ?? 0; }
    if (node.type === 'tap' || node.type === 'drinking') waterPoints++;
    if (node.type === 'hydrant') hydrants++;
    if (node.name?.toLowerCase().includes('hospital') || node.name?.toLowerCase().includes('clinic')) hospitals++;
  }
  const downtimeEst = 30 + buildings * 2 + hydrants * 15;

  return {
    affectedNodes: affectedIds,
    affectedUsers: population,
    impactDetail: { buildings, waterPoints, hydrants, hospitals, population, downtimeEst, nodeIds: affectedIds },
  };
}

const ROOT_CAUSES: { cause: WaterRootCause; label: string; probability: number }[] = [
  { cause: 'pressure_surge',   label: 'Pressure Surge in Main Line',               probability: 0.30 },
  { cause: 'pipe_aging',       label: 'Aged Pipeline — Material Fatigue',           probability: 0.25 },
  { cause: 'external_damage',  label: 'External Damage — Construction Activity',    probability: 0.20 },
  { cause: 'corrosion',        label: 'Internal Corrosion — Scale Buildup',         probability: 0.15 },
  { cause: 'pump_failure',     label: 'Pump Station Pressure Spike',               probability: 0.07 },
  { cause: 'ground_movement',  label: 'Ground Subsidence / Settlement',             probability: 0.03 },
];

function pickRootCause(): { cause: WaterRootCause; label: string } {
  let r = Math.random();
  for (const rc of ROOT_CAUSES) {
    r -= rc.probability;
    if (r <= 0) return rc;
  }
  return ROOT_CAUSES[0];
}

function generateSensorReadings(pressureDrop: number, flowReduction: number): WaterSensorReading[] {
  return [
    {
      sensorId: 'PS-001', label: 'Line Pressure',
      value: Math.max(8, 75 - pressureDrop + Math.round((Math.random() - 0.5) * 4)),
      unit: 'PSI', threshold: 30, anomaly: pressureDrop > 25, trend: 'dropping',
    },
    {
      sensorId: 'FS-002', label: 'Flow Rate',
      value: Math.max(5, 380 - Math.round(380 * flowReduction / 100) + Math.round((Math.random() - 0.5) * 20)),
      unit: 'L/min', threshold: 200, anomaly: flowReduction > 35, trend: 'dropping',
    },
    {
      sensorId: 'VS-003', label: 'Vibration',
      value: +(0.8 + Math.random() * 2.2).toFixed(2),
      unit: 'mm/s', threshold: 1.5, anomaly: true, trend: 'rising',
    },
    {
      sensorId: 'TM-004', label: 'Temperature Delta',
      value: +(Math.random() * 3).toFixed(1),
      unit: '°C', threshold: 2.0, anomaly: false, trend: 'stable',
    },
  ];
}

function generateAutoActions(severity: WaterIncident['severity'], hasBackup: boolean): WaterAutoAction[] {
  const actions: WaterAutoAction[] = [
    { id: 'AA-1', action: 'Close upstream isolation valve',       icon: '🔴', status: 'pending', detail: 'Valve UV-14 on main north trunk' },
    { id: 'AA-2', action: 'Reduce pressure in adjacent zones',   icon: '⬇️', status: 'pending', detail: 'PRV-Zone2 throttled to 45 PSI' },
  ];
  if (hasBackup) {
    actions.push({ id: 'AA-3', action: 'Activate backup pipeline route', icon: '🟢', status: 'pending', detail: 'Switching to alternate distribution loop' });
  }
  if (severity === 'HIGH' || severity === 'CRITICAL') {
    actions.push({ id: 'AA-4', action: 'Issue public conservation notice', icon: '📢', status: 'pending', detail: 'SMS alert to affected zone residents' });
    actions.push({ id: 'AA-5', action: 'Alert DSO Fire Station',           icon: '🚒', status: 'pending', detail: 'Notify of reduced hydrant coverage' });
  }
  actions.push({ id: 'AA-6', action: 'Enable SCADA bypass mode',          icon: '💻', status: 'pending', detail: 'Automated rerouting via SCADA system' });
  return actions;
}

/** Simulate a full-lifecycle pipeline break */
export function simulatePipelineBreak(
  pipelines: Pipeline[],
  nodes: WaterNode[],
): WaterIncident | null {
  const candidates = pipelines.filter(p => (p.type === 'distribution' || p.type === 'main') && p.status === 'normal');
  if (candidates.length === 0) return null;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const fromNode = nodes.find(n => n.id === target.from);
  const toNode   = nodes.find(n => n.id === target.to);
  const loc = midpoint(
    fromNode?.location ?? target.coordinates[0],
    toNode?.location   ?? target.coordinates[target.coordinates.length - 1],
  );

  const pressureDrop = 20 + Math.round(Math.random() * 50);
  const flowReduction = 35 + Math.round(Math.random() * 50);

  const { affectedNodes, affectedUsers, impactDetail } = findAffectedNodes(target.id, pipelines, nodes);
  const severity: WaterIncident['severity'] =
    affectedUsers > 500 ? 'CRITICAL' : affectedUsers > 200 ? 'HIGH' : affectedUsers > 80 ? 'MEDIUM' : 'LOW';

  // Find upstream pipes (same pipeline chain going into target.from)
  const upstreamPipeIds = pipelines
    .filter(p => p.to === target.from && p.type === target.type)
    .slice(0, 2)
    .map(p => p.id);

  // Find candidate backup pipes (parallel paths)
  const backupPipeIds = pipelines
    .filter(p => p.type === 'distribution' && p.id !== target.id &&
      p.status === 'normal' && p.from !== target.from)
    .slice(0, 3)
    .map(p => p.id);

  const { cause, label } = pickRootCause();

  return {
    id:              `WI-${Date.now()}`,
    pipelineId:      target.id,
    upstreamPipeIds,
    backupPipeIds,
    type:            Math.random() > 0.4 ? 'burst' : 'leak',
    location:        loc,
    severity,
    rootCause:       cause,
    rootCauseLabel:  label,
    detectedAt:      Date.now(),
    status:          'detecting',
    validationScore: 0,
    sensorReadings:  generateSensorReadings(pressureDrop, flowReduction),
    autoActions:     generateAutoActions(severity, backupPipeIds.length > 0),
    affectedNodes,
    impactDetail,
    affectedUsers,
    pressureDrop,
    flowReduction,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  AI ADVISORY GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface WaterAIAdvisory {
  title:       string;
  riskLevel:   'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actions:     string[];
  impacts:     string[];
  etaMinutes:  number;
}

export function generateWaterAdvisory(incident: WaterIncident, _nodes: WaterNode[]): WaterAIAdvisory {
  const { impactDetail } = incident;
  const impacts: string[] = [];
  if (impactDetail.hydrants > 0)
    impacts.push(`⚠ ${impactDetail.hydrants} fire hydrant(s) offline — emergency response impacted`);
  if (impactDetail.buildings > 0)
    impacts.push(`⚠ ${impactDetail.buildings} buildings (${impactDetail.population} users) without water`);
  if (impactDetail.hospitals > 0)
    impacts.push(`🏥 CRITICAL — ${impactDetail.hospitals} medical facility affected`);
  if (incident.pressureDrop > 40)
    impacts.push('⚠ Severe pressure drop — adjacent zone cascade failure risk');
  if (incident.flowReduction > 60)
    impacts.push('⚠ Major flow reduction — conservation advisory mandatory');
  if (impacts.length === 0)
    impacts.push('Minor distribution disruption — monitoring zone in isolation');

  const actions = [
    `Isolate failure at valve UV-${14 + Math.floor(Math.random() * 10)} on ${incident.type === 'burst' ? 'main trunk' : 'distribution ring'}`,
    'Dispatch certified pipe maintenance crew (Grade A)',
  ];
  if (incident.severity === 'HIGH' || incident.severity === 'CRITICAL') {
    actions.push('Activate emergency backup supply tankers for critical zones');
    actions.push('Issue DSO resident conservation SMS alert (±850 households)');
  }
  if (impactDetail.hydrants > 0) actions.push('Coordinate with DSO Fire & Rescue — hydrant coverage gap');
  actions.push('Deploy pressure loggers on upstream segments PS-A3 & PS-B1');
  actions.push('Prepare repair kit: DN200 ductile iron coupling + O-rings');
  if (incident.rootCause === 'pipe_aging')
    actions.push('Schedule full zone pipe condition assessment post-repair');

  const eta = incident.severity === 'CRITICAL' ? 12 : incident.severity === 'HIGH' ? 22 : 38;
  return {
    title: incident.type === 'burst'
      ? `Pipe Burst — ${incident.severity} — ${incident.rootCauseLabel}`
      : `Water Leak — ${incident.severity} — ${incident.rootCauseLabel}`,
    riskLevel:   incident.severity,
    actions,
    impacts,
    etaMinutes:  eta,
  };
}

/** Generate post-incident analytics */
export function generatePostAnalytics(
  incident: WaterIncident,
  repairStartedAt: number,
  resolvedAt: number,
): WaterPostAnalytics {
  return {
    responseTimeSec:   Math.round((repairStartedAt - incident.detectedAt) / 1000),
    repairDurationSec: Math.round((resolvedAt - repairStartedAt) / 1000),
    totalDowntimeSec:  Math.round((resolvedAt - incident.detectedAt) / 1000),
    usersImpacted:     incident.affectedUsers,
    pipelinesAffected: 1 + incident.upstreamPipeIds.length,
    resolvedAt,
  };
}
