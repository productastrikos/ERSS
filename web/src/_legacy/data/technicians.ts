import type { TechnicianProfile } from '../types';
import { OSRM_URL } from '../config';

/** Technician / response-team profiles, keyed by incident id */
export const TECHNICIANS: Record<string, TechnicianProfile> = {
  power_grid_failure:  { id: 'T01', name: 'Ahmed Hassan',        role: 'Power Grid Engineer',          phone: '+971-50-100-0001', coordinates: [55.3805, 25.1199] },
  streetlight_failure: { id: 'T02', name: 'Khalid Al Mansouri',  role: 'City Lighting Technician',     phone: '+971-50-100-0002', coordinates: [55.3828, 25.1192] },
  waste_overflow:      { id: 'T03', name: 'Omar Rashid',         role: 'Waste Collection Driver',      phone: '+971-50-100-0003', coordinates: [55.3840, 25.1160] },
  fire_alarm:          { id: 'T04', name: 'Fatima Al Zaabi',     role: 'Civil Defence Officer',        phone: '+971-800-997',     coordinates: [55.3795, 25.1200] },
  water_pipe_leak:     { id: 'T05', name: 'Yousef Al Hamdan',    role: 'Water Network Technician',     phone: '+971-50-100-0005', coordinates: [55.3784, 25.1248] },
  drone_incident:      { id: 'T06', name: 'Sara Mohammed',       role: 'Drone Operations Supervisor',  phone: '+971-50-100-0006', coordinates: [55.3850, 25.1180] },
  traffic_congestion:  { id: 'T07', name: 'Ali Al Nuaimi',       role: 'Traffic Control Officer',      phone: '+971-50-100-0007', coordinates: [55.3831, 25.1130] },
  smart_irrigation:    { id: 'T08', name: 'Noor Al Rashidi',     role: 'Landscape & Irrigation Lead',  phone: '+971-50-100-0008', coordinates: [55.3850, 25.1225] },
  cyber_attack:        { id: 'T09', name: 'Reem Al Maktoum',     role: 'SOC Cybersecurity Analyst',    phone: '+971-50-100-0009', coordinates: [55.3810, 25.1200] },
  ev_charging_fault:   { id: 'T10', name: 'Hassan Al Blooshi',   role: 'EV Infrastructure Technician', phone: '+971-50-100-0010', coordinates: [55.3840, 25.1195] },
};

const FALLBACK: TechnicianProfile = {
  id: 'T00', name: 'City Operations Team', role: 'General Maintenance',
  phone: '+971-4-501-5500', coordinates: [55.3810, 25.1200],
};

export function getTechnician(incidentId: string): TechnicianProfile {
  return TECHNICIANS[incidentId] ?? FALLBACK;
}

/** Haversine distance (km) between two [lng, lat] points */
export function calcDistance(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** ETA in minutes at city speed (~30 km/h) — minimum 2 */
export function calcETA(distKm: number): number {
  return Math.max(2, Math.round((distKm / 30) * 60));
}

/** Build a road-following route using the OSRM public API (OpenStreetMap). Falls back to straight line. */
export async function buildRoute(
  from: [number, number],
  to:   [number, number],
): Promise<[number, number][]> {
  try {
    const url = `${OSRM_URL}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates?.length >= 2) {
      return data.routes[0].geometry.coordinates as [number, number][];
    }
  } catch {
    // Network error — fall through to straight-line fallback
  }
  return [from, to];
}
