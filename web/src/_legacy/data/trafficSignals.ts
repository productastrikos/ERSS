// ─────────────────────────────────────────────────────────────────────────────
//  DSO Traffic Signal Management — Data Model
//  All coordinates: [lng, lat] (GeoJSON / MapLibre convention)
//  Real DSO intersections sourced from OSM (≥3 roads meet at each node)
//  Expanded to 12 signals covering the full DSO road network
// ─────────────────────────────────────────────────────────────────────────────

import type { TrafficSignal, RoadSegment, TrafficIncident, EmergencyResponder } from '../types';

// ── Real DSO intersections (OSM-verified, ≥3 roads each) — 12 signals ────────
// Timing follows HCM (Highway Capacity Manual) & Abu Dhabi/Dubai RTA standards:
//   • Yellow = 3 s (standard UAE/GCC)
//   • All-red clearance = 2 s (baked into red_time)
//   • cycle_time = green + yellow(3) + red
//   • 4-arm major junction: 90–110 s cycle
//   • 3-arm minor junction: 60–80 s cycle
//   • DSO is a tech park → low density → green bias 55–65 % of cycle
export const TRAFFIC_SIGNALS: TrafficSignal[] = [
  {
    signal_id:       'DSO-SIG-101',
    name:            'DSO Central Roundabout',
    location:        [55.3823, 25.1264],
    connected_roads: 4,
    state:           'GREEN',
    cycle_time:      100, // 4-arm major
    vehicle_density: 32,
    green_time:      60,  // 60 % green split
    red_time:        37,  // 37 s red + 3 s yellow = 40 s non-green
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-102',
    name:            'DSO West Boulevard Junction',
    location:        [55.3796, 25.1219],
    connected_roads: 3,
    state:           'RED',
    cycle_time:      75,  // 3-arm
    vehicle_density: 24,
    green_time:      45,  // 60 % split
    red_time:        27,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-103',
    name:            'Academic City Road Entry',
    location:        [55.3842, 25.1189],
    connected_roads: 3,
    state:           'GREEN',
    cycle_time:      70,
    vehicle_density: 18,
    green_time:      42,
    red_time:        25,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-104',
    name:            'Inner Residential Junction',
    location:        [55.3817, 25.1284],
    connected_roads: 4,
    state:           'YELLOW',
    cycle_time:      90,  // 4-arm residential — shorter than arterial
    vehicle_density: 12,
    green_time:      52,
    red_time:        35,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-105',
    name:            'DSO HQ Entrance',
    location:        [55.3868, 25.1238],
    connected_roads: 3,
    state:           'GREEN',
    cycle_time:      70,
    vehicle_density: 16,
    green_time:      42,
    red_time:        25,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-106',
    name:            'West Ring Road Entry',
    location:        [55.3780, 25.1247],
    connected_roads: 3,
    state:           'RED',
    cycle_time:      65,
    vehicle_density: 11,
    green_time:      38,
    red_time:        24,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-107',
    name:            'North Tech Boulevard',
    location:        [55.3857, 25.1292],
    connected_roads: 4,
    state:           'GREEN',
    cycle_time:      100, // 4-arm
    vehicle_density: 20,
    green_time:      60,
    red_time:        37,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-108',
    name:            'South Academic Link',
    location:        [55.3802, 25.1175],
    connected_roads: 3,
    state:           'YELLOW',
    cycle_time:      68,
    vehicle_density: 14,
    green_time:      40,
    red_time:        25,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-109',
    name:            'Residential North Gate',
    location:        [55.3836, 25.1312],
    connected_roads: 3,
    state:           'GREEN',
    cycle_time:      60,  // low-traffic residential: shorter cycle ok
    vehicle_density: 9,
    green_time:      35,
    red_time:        22,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-110',
    name:            'West Service Interchange',
    location:        [55.3760, 25.1215],
    connected_roads: 3,
    state:           'RED',
    cycle_time:      65,
    vehicle_density: 8,
    green_time:      38,
    red_time:        24,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-111',
    name:            'East Tech Zone Entry',
    location:        [55.3890, 25.1195],
    connected_roads: 4,
    state:           'GREEN',
    cycle_time:      95,
    vehicle_density: 19,
    green_time:      56,
    red_time:        36,
    status:          'ACTIVE',
  },
  {
    signal_id:       'DSO-SIG-112',
    name:            'Academic City Southern Gate',
    location:        [55.3872, 25.1152],
    connected_roads: 3,
    state:           'YELLOW',
    cycle_time:      75,
    vehicle_density: 55,  // busier gate — higher density
    green_time:      45,
    red_time:        27,
    status:          'ACTIVE',
  },
];

// ── Real DSO road segments — 13 segments connecting all 12 signals ───────────
export const ROAD_SEGMENTS: RoadSegment[] = [
  {
    road_id:          'DSO-RD-01',
    name:             'Silicon Oasis Avenue (N)',
    start:            [55.3796, 25.1219],
    end:              [55.3823, 25.1264],
    vehicle_count:    22,
    avg_speed:        48,
    congestion_level: 'LOW',
    congestion_index: 0.18,
  },
  {
    road_id:          'DSO-RD-02',
    name:             'Innovation Boulevard',
    start:            [55.3823, 25.1264],
    end:              [55.3842, 25.1189],
    vehicle_count:    15,
    avg_speed:        55,
    congestion_level: 'LOW',
    congestion_index: 0.12,
  },
  {
    road_id:          'DSO-RD-03',
    name:             'DSO Ring Road (W)',
    start:            [55.3842, 25.1189],
    end:              [55.3817, 25.1284],
    vehicle_count:    10,
    avg_speed:        60,
    congestion_level: 'LOW',
    congestion_index: 0.09,
  },
  {
    road_id:          'DSO-RD-04',
    name:             'Residential Loop South',
    start:            [55.3817, 25.1284],
    end:              [55.3796, 25.1219],
    vehicle_count:    12,
    avg_speed:        52,
    congestion_level: 'LOW',
    congestion_index: 0.14,
  },
  {
    road_id:          'DSO-RD-05',
    name:             'Central Connector',
    start:            [55.3823, 25.1264],
    end:              [55.3817, 25.1284],
    vehicle_count:    18,
    avg_speed:        50,
    congestion_level: 'LOW',
    congestion_index: 0.16,
  },
  {
    road_id:          'DSO-RD-06',
    name:             'Tech Park Boulevard (E)',
    start:            [55.3823, 25.1264],
    end:              [55.3868, 25.1238],
    vehicle_count:    14,
    avg_speed:        53,
    congestion_level: 'LOW',
    congestion_index: 0.13,
  },
  {
    road_id:          'DSO-RD-07',
    name:             'West Arterial Road',
    start:            [55.3796, 25.1219],
    end:              [55.3780, 25.1247],
    vehicle_count:    8,
    avg_speed:        58,
    congestion_level: 'LOW',
    congestion_index: 0.07,
  },
  {
    road_id:          'DSO-RD-08',
    name:             'Innovation Park Loop',
    start:            [55.3868, 25.1238],
    end:              [55.3857, 25.1292],
    vehicle_count:    11,
    avg_speed:        54,
    congestion_level: 'LOW',
    congestion_index: 0.11,
  },
  {
    road_id:          'DSO-RD-09',
    name:             'Western Service Road',
    start:            [55.3780, 25.1247],
    end:              [55.3760, 25.1215],
    vehicle_count:    7,
    avg_speed:        62,
    congestion_level: 'LOW',
    congestion_index: 0.06,
  },
  {
    road_id:          'DSO-RD-10',
    name:             'Academic City Link (S)',
    start:            [55.3842, 25.1189],
    end:              [55.3802, 25.1175],
    vehicle_count:    10,
    avg_speed:        57,
    congestion_level: 'LOW',
    congestion_index: 0.10,
  },
  {
    road_id:          'DSO-RD-11',
    name:             'North Residential Road',
    start:            [55.3817, 25.1284],
    end:              [55.3836, 25.1312],
    vehicle_count:    9,
    avg_speed:        59,
    congestion_level: 'LOW',
    congestion_index: 0.08,
  },
  {
    road_id:          'DSO-RD-12',
    name:             'East Tech Connector',
    start:            [55.3842, 25.1189],
    end:              [55.3890, 25.1195],
    vehicle_count:    13,
    avg_speed:        55,
    congestion_level: 'LOW',
    congestion_index: 0.12,
  },
  {
    road_id:          'DSO-RD-13',
    name:             'Southern Academic Ring',
    start:            [55.3802, 25.1175],
    end:              [55.3872, 25.1152],
    vehicle_count:    11,
    avg_speed:        56,
    congestion_level: 'LOW',
    congestion_index: 0.10,
  },
];

// ── Default (normal ops) incident list ───────────────────────────────────────
export const DEFAULT_INCIDENTS: TrafficIncident[] = [];

// ── Congestion simulation preset ─────────────────────────────────────────────
export function buildCongestionState(): {
  signals: TrafficSignal[];
  roads: RoadSegment[];
  incidents: TrafficIncident[];
} {
  return {
    signals: TRAFFIC_SIGNALS.map((s) => {
      // Primary congestion node
      if (s.signal_id === 'DSO-SIG-101')
        return { ...s, state: 'RED' as const, vehicle_density: 75, status: 'ACTIVE' as const };
      // Backup congestion spillover
      if (s.signal_id === 'DSO-SIG-102')
        return { ...s, state: 'RED' as const, vehicle_density: 62, status: 'ACTIVE' as const };
      // Tech park experiencing secondary build-up
      if (s.signal_id === 'DSO-SIG-105' || s.signal_id === 'DSO-SIG-107')
        return { ...s, state: 'YELLOW' as const, vehicle_density: 40, status: 'ACTIVE' as const };
      return s;
    }),
    roads: ROAD_SEGMENTS.map((r) => {
      if (r.road_id === 'DSO-RD-01' || r.road_id === 'DSO-RD-05')
        return { ...r, vehicle_count: 75, avg_speed: 8, congestion_level: 'CRITICAL' as const, congestion_index: 0.92 };
      if (r.road_id === 'DSO-RD-06' || r.road_id === 'DSO-RD-08')
        return { ...r, vehicle_count: 55, avg_speed: 15, congestion_level: 'HIGH' as const, congestion_index: 0.78 };
      return r;
    }),
    incidents: [
      {
        id: 'EVT-CONG-001',
        type: 'congestion',
        location: [55.3823, 25.1264],
        name: 'DSO Central Roundabout',
        description: 'Heavy congestion detected — vehicle density 75 veh/km',
        severity: 'HIGH',
        timestamp: Date.now(),
        resolved: false,
      },
    ],
  };
}

// ── Accident simulation preset ────────────────────────────────────────────────
// Accident placed at DSO Central Roundabout road intersection [55.3823, 25.1264]
// (OSM-verified road node — central junction of DSO Boulevard)
export function buildAccidentState(): {
  signals:             TrafficSignal[];
  roads:               RoadSegment[];
  incidents:           TrafficIncident[];
  accidentLocation:    [number, number];
  emergencyResponders: EmergencyResponder[];
} {
  return {
    signals: TRAFFIC_SIGNALS.map((s) => {
      // Accident junction — locked RED
      if (s.signal_id === 'DSO-SIG-101')
        return { ...s, state: 'RED' as const, vehicle_density: 0, status: 'ACTIVE' as const };
      // Side approaches locked to prevent more vehicles entering
      if (s.signal_id === 'DSO-SIG-104' || s.signal_id === 'DSO-SIG-107')
        return { ...s, state: 'RED' as const, vehicle_density: 0, status: 'ACTIVE' as const };
      // Open diversion routes
      if (s.signal_id === 'DSO-SIG-102' || s.signal_id === 'DSO-SIG-103')
        return { ...s, state: 'GREEN' as const };
      // Extended green on tech park routes to absorb diverted traffic
      if (s.signal_id === 'DSO-SIG-105' || s.signal_id === 'DSO-SIG-111')
        return { ...s, state: 'GREEN' as const, green_time: s.green_time + 20 };
      return s;
    }),
    roads: ROAD_SEGMENTS.map((r) => {
      // Block roads immediately connecting to the accident junction (DSO-SIG-101)
      if (r.road_id === 'DSO-RD-02' || r.road_id === 'DSO-RD-05')
        return { ...r, vehicle_count: 0, avg_speed: 0, congestion_level: 'CRITICAL' as const, congestion_index: 1 };
      // Heavy queue building on incoming roads
      if (r.road_id === 'DSO-RD-01' || r.road_id === 'DSO-RD-06')
        return { ...r, vehicle_count: 68, avg_speed: 5, congestion_level: 'CRITICAL' as const, congestion_index: 0.94 };
      return r;
    }),
    incidents: [
      {
        id: 'EVT-ACC-001',
        type: 'accident',
        location: [55.3823, 25.1264],
        name: 'DSO Central Roundabout',
        description: 'Multi-vehicle collision — 2 lanes blocked · 150+ vehicles affected · Emergency response in progress',
        severity: 'HIGH',
        timestamp: Date.now(),
        resolved: false,
      },
    ],
    accidentLocation:    [55.3823, 25.1264],
    emergencyResponders: [],
  };
}

// ── Congestion level → Google Maps–style colour map ───────────────────────────
export const CONGESTION_COLOR: Record<string, string> = {
  LOW:      '#4ade80',   // soft green   — free flow
  MEDIUM:   '#fbbf24',   // amber        — moderate
  HIGH:     '#f97316',   // orange       — heavy
  CRITICAL: '#ef4444',   // red          — stop-and-go / blocked
};

// ── Signal state → colour map ─────────────────────────────────────────────────
export const SIGNAL_COLOR: Record<string, string> = {
  GREEN:    '#22c55e',
  YELLOW:   '#f59e0b',
  RED:      '#ef4444',
  FLASHING: '#f97316',
};
