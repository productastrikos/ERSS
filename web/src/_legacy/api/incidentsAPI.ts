import type { IncidentLiveData } from '../types';

const API_BASE = 'https://dso_api.astrikos.xyz:8443';

const JSON_FILE_MAP: Record<string, string> = {
  power_grid_failure:   'power_incident',
  streetlight_failure:  'streetlight_incident',
  waste_overflow:       'waste_incident',
  fire_alarm:           'fire_incident',
  water_pipe_leak:      'water_leak',
  drone_incident:       'drone_incident',
  traffic_congestion:   'traffic_incident',
  smart_irrigation:     'irrigation_incident',
  cyber_attack:         'cyber_incident',
  ev_charging_fault:    'ev_charger_fault',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapToLiveData(raw: any): IncidentLiveData {
  return {
    incident_id:   raw.incident_id,
    sensor_id:     raw.sensor?.sensor_id ?? raw.sensor_id ?? '',
    sensor_value:  raw.sensor?.value     ?? raw.sensor_value ?? 0,
    sensor_unit:   raw.sensor?.unit      ?? raw.sensor_unit  ?? '',
    threshold:     raw.sensor?.threshold ?? raw.threshold    ?? 0,
    work_order_id: raw.work_order_id,
    assigned_team: raw.assigned_team,
    timestamp:     raw.timestamp,
  };
}

/**
 * Fetch live incident data.
 * 1. Tries FastAPI backend  GET /api/incidents/{type}
 * 2. Falls back to local JSON in src/data/incidents/
 */
export async function fetchIncidentLiveData(incidentId: string): Promise<IncidentLiveData | null> {
  const fileName = JSON_FILE_MAP[incidentId];
  if (!fileName) return null;

  // --- Try API first ---------------------------------------------------------
  try {
    const res = await fetch(`${API_BASE}/api/incidents/${fileName}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const raw = await res.json();
      return mapToLiveData(raw);
    }
  } catch {
    // backend offline — fall through to local JSON
  }

  // --- Local JSON fallback ---------------------------------------------------
  try {
    const mod = await import(`../data/incidents/${fileName}.json`);
    return mapToLiveData(mod.default ?? mod);
  } catch {
    return null;
  }
}
