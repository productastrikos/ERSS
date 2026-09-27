/**
 * Road watch — the transport estate, on the operations map.
 *
 * This is what used to be a separate page. It is not one any more: the DSO signal
 * network and its corridors are just data, handed to the `traffic` and `cameras` layers on
 * the SAME map the Dashboard and the wall view already draw. An operator should never have
 * to answer "what is happening" twice.
 *
 * The building-management estate that used to come with it went with the indoor scenario:
 * the trial watches the road (server/config/poc.js). DSO_BUILDINGS stays exported for the
 * Operations map, which still draws the estate on demand.
 *
 * The baseline below is the DSO dataset (`_legacy/data/trafficSignals.ts`,
 * `_legacy/data/bmsBuildings.ts`) carried across unchanged — the same twelve signals,
 * the same thirteen corridors, the same buildings — so the picture during a response is
 * the one that build was designed around.
 *
 * What is NOT baseline is the response: `roadWatch(detections)` takes whatever the
 * detection engine currently has in flight and returns the estate AS IT NOW IS. A
 * confirmed collision locks its junction red, holds the side approaches, opens the
 * diversion and turns the two blocked corridors critical — because that is what the
 * signal plan in the SOP says will happen, and the map has to agree with the panel.
 */

import type { BmsBuilding, CongestionSegment, SignalPoint, TrafficFeed } from '../layers';
import type { Camera, Detection } from '../../../lib/types';
import type { CamerasFeed } from '../layers/agency/cameras';

// ── Baseline estate ──────────────────────────────────────────────────────────

/** The twelve DSO signals, with their real HCM-derived timings. */
export const DSO_SIGNALS: SignalPoint[] = [
  { id: 'DSO-SIG-101', name: 'DSO Central Roundabout', lng: 55.3823, lat: 25.1264, phase: 'GREEN', phaseRemainingSec: null, greenSec: 60, redSec: 37, cycleSec: 100, density: 32, connectedRoads: 4, status: 'ACTIVE' },
  { id: 'DSO-SIG-102', name: 'DSO West Boulevard Junction', lng: 55.3796, lat: 25.1219, phase: 'RED', phaseRemainingSec: null, greenSec: 45, redSec: 27, cycleSec: 75, density: 24, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-103', name: 'Academic City Road Entry', lng: 55.3842, lat: 25.1189, phase: 'GREEN', phaseRemainingSec: null, greenSec: 42, redSec: 25, cycleSec: 70, density: 18, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-104', name: 'Inner Residential Junction', lng: 55.3817, lat: 25.1284, phase: 'YELLOW', phaseRemainingSec: null, greenSec: 52, redSec: 35, cycleSec: 90, density: 12, connectedRoads: 4, status: 'ACTIVE' },
  { id: 'DSO-SIG-105', name: 'DSO HQ Entrance', lng: 55.3868, lat: 25.1238, phase: 'GREEN', phaseRemainingSec: null, greenSec: 42, redSec: 25, cycleSec: 70, density: 16, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-106', name: 'West Ring Road Entry', lng: 55.3780, lat: 25.1247, phase: 'RED', phaseRemainingSec: null, greenSec: 38, redSec: 24, cycleSec: 65, density: 11, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-107', name: 'North Tech Boulevard', lng: 55.3857, lat: 25.1292, phase: 'GREEN', phaseRemainingSec: null, greenSec: 60, redSec: 37, cycleSec: 100, density: 20, connectedRoads: 4, status: 'ACTIVE' },
  { id: 'DSO-SIG-108', name: 'South Academic Link', lng: 55.3802, lat: 25.1175, phase: 'YELLOW', phaseRemainingSec: null, greenSec: 40, redSec: 25, cycleSec: 68, density: 14, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-109', name: 'Residential North Gate', lng: 55.3836, lat: 25.1312, phase: 'GREEN', phaseRemainingSec: null, greenSec: 35, redSec: 22, cycleSec: 60, density: 9, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-110', name: 'West Service Interchange', lng: 55.3760, lat: 25.1215, phase: 'RED', phaseRemainingSec: null, greenSec: 38, redSec: 24, cycleSec: 65, density: 8, connectedRoads: 3, status: 'ACTIVE' },
  { id: 'DSO-SIG-111', name: 'East Tech Zone Entry', lng: 55.3890, lat: 25.1195, phase: 'GREEN', phaseRemainingSec: null, greenSec: 56, redSec: 36, cycleSec: 95, density: 19, connectedRoads: 4, status: 'ACTIVE' },
  { id: 'DSO-SIG-112', name: 'Academic City Southern Gate', lng: 55.3872, lat: 25.1152, phase: 'YELLOW', phaseRemainingSec: null, greenSec: 45, redSec: 27, cycleSec: 75, density: 55, connectedRoads: 3, status: 'ACTIVE' },
];

/** The thirteen corridors between them. */
export const DSO_CORRIDORS: CongestionSegment[] = [
  { id: 'DSO-RD-01', name: 'Silicon Oasis Avenue (N)', path: [[55.3796, 25.1219], [55.3823, 25.1264]], level: 'LOW', avgSpeedKph: 48, vehicleCount: 22 },
  { id: 'DSO-RD-02', name: 'Innovation Boulevard', path: [[55.3823, 25.1264], [55.3842, 25.1189]], level: 'LOW', avgSpeedKph: 55, vehicleCount: 15 },
  { id: 'DSO-RD-03', name: 'DSO Ring Road (W)', path: [[55.3842, 25.1189], [55.3817, 25.1284]], level: 'LOW', avgSpeedKph: 60, vehicleCount: 10 },
  { id: 'DSO-RD-04', name: 'Residential Loop South', path: [[55.3817, 25.1284], [55.3796, 25.1219]], level: 'LOW', avgSpeedKph: 52, vehicleCount: 12 },
  { id: 'DSO-RD-05', name: 'Central Connector', path: [[55.3823, 25.1264], [55.3817, 25.1284]], level: 'LOW', avgSpeedKph: 50, vehicleCount: 18 },
  { id: 'DSO-RD-06', name: 'Tech Park Boulevard (E)', path: [[55.3823, 25.1264], [55.3868, 25.1238]], level: 'LOW', avgSpeedKph: 53, vehicleCount: 14 },
  { id: 'DSO-RD-07', name: 'West Arterial Road', path: [[55.3796, 25.1219], [55.3780, 25.1247]], level: 'LOW', avgSpeedKph: 58, vehicleCount: 8 },
  { id: 'DSO-RD-08', name: 'Innovation Park Loop', path: [[55.3868, 25.1238], [55.3857, 25.1292]], level: 'LOW', avgSpeedKph: 54, vehicleCount: 11 },
  { id: 'DSO-RD-09', name: 'Western Service Road', path: [[55.3780, 25.1247], [55.3760, 25.1215]], level: 'LOW', avgSpeedKph: 62, vehicleCount: 7 },
  { id: 'DSO-RD-10', name: 'Academic City Link (S)', path: [[55.3842, 25.1189], [55.3802, 25.1175]], level: 'LOW', avgSpeedKph: 57, vehicleCount: 10 },
  { id: 'DSO-RD-11', name: 'North Residential Road', path: [[55.3817, 25.1284], [55.3836, 25.1312]], level: 'LOW', avgSpeedKph: 59, vehicleCount: 9 },
  { id: 'DSO-RD-12', name: 'East Tech Connector', path: [[55.3842, 25.1189], [55.3890, 25.1195]], level: 'LOW', avgSpeedKph: 55, vehicleCount: 13 },
  { id: 'DSO-RD-13', name: 'Southern Academic Ring', path: [[55.3802, 25.1175], [55.3872, 25.1152]], level: 'LOW', avgSpeedKph: 56, vehicleCount: 11 },
];

function building(
  id: string, name: string, type: string, lng: number, lat: number, floors: number, heightM: number,
  status: BmsBuilding['status'], power: number, hvac: number, occupancyPct: number, occupancyCount: number,
): BmsBuilding {
  return {
    id, name, type, lng, lat, floors, heightM, status,
    powerLoadPct: power, hvacEfficiencyPct: hvac,
    occupancyPct, occupancyCount, waterPressureBar: 3.2, fireAlarms: 0, alerts: [],
  };
}

/** The buildings the Civil Defence feed reports on. The NEST is three storeys here, not
 *  twelve: the twin models three, and an address the crew is given has to match the
 *  building the console draws. */
export const DSO_BUILDINGS: BmsBuilding[] = [
  building('BLD_001', 'The NEST', 'tech', 55.3790, 25.1205, 3, 14, 'normal', 68, 88, 72, 58),
  building('BLD_002', 'DSO HQ Tower', 'commercial', 55.3820, 25.1218, 18, 76, 'warning', 82, 71, 85, 920),
  building('BLD_003', 'Innovation Hub A', 'tech', 55.3835, 25.1240, 8, 36, 'normal', 55, 91, 60, 240),
  building('BLD_004', 'Innovation Hub B', 'tech', 55.3852, 25.1232, 8, 36, 'normal', 62, 84, 71, 310),
  building('BLD_005', 'Techno Park Center', 'tech', 55.3868, 25.1220, 10, 44, 'normal', 61, 85, 68, 420),
  building('BLD_006', 'DSO Mall', 'commercial', 55.3904, 25.1248, 4, 22, 'warning', 79, 74, 88, 2100),
  building('BLD_016', 'Data Center DSO-1', 'industrial', 55.3760, 25.1188, 4, 20, 'warning', 86, 76, 15, 22),
];

// ── The estate as it now is ──────────────────────────────────────────────────

/** A detection that has got past the AI verdict and is a real, confirmed incident. */
const confirmed = (d: Detection) => d.stageIndex >= 2 && !!d.verdict;

/**
 * The collision's signal plan, from SOP `rta_junction`. Kept beside the corridor effect
 * it causes so the two can never say different things.
 */
const CRASH_PLAN = {
  junction: 'DSO-SIG-101',
  held: ['DSO-SIG-104', 'DSO-SIG-107'],
  opened: ['DSO-SIG-102', 'DSO-SIG-103'],
  extended: { 'DSO-SIG-105': 20, 'DSO-SIG-111': 20 },
  blocked: ['DSO-RD-02', 'DSO-RD-05'],
  queuing: ['DSO-RD-01', 'DSO-RD-06'],
};

export interface RoadWatch {
  traffic: TrafficFeed;
  cameras: CamerasFeed;
}

export function roadWatch(detections: Detection[], cameras: Camera[]): RoadWatch {
  const live = detections.filter(confirmed);
  const crash = live.find((d) => d.type === 'rta_junction') ?? null;

  const signals: SignalPoint[] = DSO_SIGNALS.map((s) => {
    if (!crash) return s;
    if (s.id === CRASH_PLAN.junction) return { ...s, phase: 'RED', phaseRemainingSec: null, density: 0, held: true };
    if (CRASH_PLAN.held.includes(s.id)) return { ...s, phase: 'RED', phaseRemainingSec: null, density: 0 };
    if (CRASH_PLAN.opened.includes(s.id)) return { ...s, phase: 'GREEN', phaseRemainingSec: null };
    const extra = CRASH_PLAN.extended[s.id as keyof typeof CRASH_PLAN.extended];
    return extra ? { ...s, phase: 'GREEN', greenSec: s.greenSec + extra, cycleSec: s.cycleSec + extra } : s;
  });

  const congestion: CongestionSegment[] = DSO_CORRIDORS.map((c) => {
    if (!crash) return c;
    if (CRASH_PLAN.blocked.includes(c.id)) return { ...c, level: 'CRITICAL', avgSpeedKph: 0, vehicleCount: 0 };
    if (CRASH_PLAN.queuing.includes(c.id)) return { ...c, level: 'CRITICAL', avgSpeedKph: 5, vehicleCount: 68 };
    return c;
  });

  return {
    traffic: {
      signals,
      congestion,
      intersections: DSO_SIGNALS.map((s) => [s.lng, s.lat] as [number, number]),
      accident: crash
        ? {
          id: crash.id,
          name: crash.place.name,
          lng: crash.place.lng,
          lat: crash.place.lat,
          severity: crash.verdict?.severity ?? 'HIGH',
          cameraUrl: crash.cameras.find((c) => c.primary)?.clipUrl ?? null,
        }
        : null,
    },
    cameras: { cameras, detecting: live.flatMap((d) => d.cameras.map((c) => c.id)) },
  };
}
