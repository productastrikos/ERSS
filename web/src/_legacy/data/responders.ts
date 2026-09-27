// ─────────────────────────────────────────────────────────────────────────────
//  DSO Traffic Accident – Emergency Response Personnel
//  Static data for POC — no backend needed
// ─────────────────────────────────────────────────────────────────────────────

export interface Responder {
  id:          string;
  name:        string;
  role:        'traffic_police' | 'ambulance' | 'maintenance' | 'fire';
  callSign:    string;
  phone:       string;
  location:    [number, number]; // [lng, lat]
  status:      'available' | 'busy' | 'offline';
  vehicle:     string;
  icon:        string;
}

export const RESPONDERS: Responder[] = [
  // ── Traffic Police ─────────────────────────────────────────────────────
  { id: 'TP01', name: 'Officer Raj Kumar',     role: 'traffic_police', callSign: 'Patrol-α1',   phone: '+971-50-200-0101', location: [55.3790, 25.1250], status: 'available', vehicle: 'Police Cruiser',    icon: '🚔' },
  { id: 'TP02', name: 'Sgt. Ahmed Khalil',     role: 'traffic_police', callSign: 'Patrol-α2',   phone: '+971-50-200-0102', location: [55.3860, 25.1195], status: 'available', vehicle: 'Police Bike',       icon: '🏍️' },
  { id: 'TP03', name: 'Cpl. Nasser Al Rashid', role: 'traffic_police', callSign: 'Patrol-α3',   phone: '+971-50-200-0103', location: [55.3920, 25.1290], status: 'available', vehicle: 'Police SUV',        icon: '🚔' },

  // ── Ambulance ──────────────────────────────────────────────────────────
  { id: 'AM01', name: 'Dr. Fatima Hassan',      role: 'ambulance',      callSign: 'Medic-1',     phone: '+971-50-200-0201', location: [55.3894, 25.1158], status: 'available', vehicle: 'Ambulance Unit 1',  icon: '🚑' },
  { id: 'AM02', name: 'Paramedic Ali Saeed',    role: 'ambulance',      callSign: 'Medic-2',     phone: '+971-50-200-0202', location: [55.3730, 25.1230], status: 'available', vehicle: 'Ambulance Unit 3',  icon: '🚑' },
  { id: 'AM03', name: 'Dr. Omar Abdulla',       role: 'ambulance',      callSign: 'Medic-3',     phone: '+971-50-200-0203', location: [55.3850, 25.1310], status: 'offline',   vehicle: 'Ambulance Unit 5',  icon: '🚑' },

  // ── Maintenance Crew ───────────────────────────────────────────────────
  { id: 'MC01', name: 'Eng. Yousef Ibrahim',    role: 'maintenance',    callSign: 'Maint-1',     phone: '+971-50-200-0301', location: [55.3810, 25.1180], status: 'available', vehicle: 'Road Crew Van',     icon: '🚧' },
  { id: 'MC02', name: 'Tech. Hamza Al Blooshi', role: 'maintenance',    callSign: 'Maint-2',     phone: '+971-50-200-0302', location: [55.3770, 25.1275], status: 'available', vehicle: 'Maintenance Truck', icon: '🔧' },

  // ── Fire ────────────────────────────────────────────────────────────────
  { id: 'FR01', name: 'Capt. Saif Al Mazrouei', role: 'fire',           callSign: 'Fire-1',      phone: '+971-800-997',     location: [55.3980, 25.1270], status: 'available', vehicle: 'Fire Engine',       icon: '🚒' },
  { id: 'FR02', name: 'Lt. Khalid Obaid',       role: 'fire',           callSign: 'Fire-2',      phone: '+971-800-998',     location: [55.3840, 25.1140], status: 'available', vehicle: 'Rescue Unit',       icon: '🚒' },
];

/** Haversine distance (km) */
export function haversine(a: [number, number], b: [number, number]): number {
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

/** Get available responders of a given role, sorted by distance from accident */
export function getNearestResponders(
  role: Responder['role'],
  accidentLoc: [number, number],
): (Responder & { distKm: number; etaMin: number })[] {
  return RESPONDERS
    .filter((r) => r.role === role && r.status === 'available')
    .map((r) => {
      const distKm = haversine(r.location, accidentLoc);
      const etaMin = Math.max(1, Math.round((distKm / 35) * 60)); // ~35 km/h city speed
      return { ...r, distKm, etaMin };
    })
    .sort((a, b) => a.distKm - b.distKm);
}

// ── Accident task lifecycle ──────────────────────────────────────────────
export type TaskStatus =
  | 'PENDING'     // just created
  | 'SENT'        // notification sent
  | 'DELIVERED'   // delivered to device
  | 'ACCEPTED'    // responder accepted
  | 'EN_ROUTE'    // travelling to scene
  | 'ARRIVED'     // on scene
  | 'RESOLVED';   // task completed

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING:   '#666',
  SENT:      '#ff9800',
  DELIVERED: '#2196f3',
  ACCEPTED:  '#4caf50',
  EN_ROUTE:  '#00bcd4',
  ARRIVED:   '#8bc34a',
  RESOLVED:  '#9e9e9e',
};

export const ROLE_COLORS: Record<Responder['role'], string> = {
  traffic_police: '#4287f5',
  ambulance:      '#4caf50',
  fire:           '#ff5722',
  maintenance:    '#ff9800',
};

export const ROLE_LABELS: Record<Responder['role'], string> = {
  traffic_police: 'Traffic Police',
  ambulance:      'Ambulance',
  fire:           'Fire & Rescue',
  maintenance:    'Maintenance Crew',
};

export interface AccidentTask {
  taskId:        string;
  responderId:   string;
  responderName: string;
  role:          Responder['role'];
  vehicle:       string;
  icon:          string;
  status:        TaskStatus;
  origin:        [number, number];
  destination:   [number, number];
  currentPos:    [number, number]; // live position (interpolated)
  distKm:        number;
  etaSec:        number;
  sentAt:        number;
  acceptedAt:    number | null;
  arrivedAt:     number | null;
  resolvedAt:    number | null;
  commModes:     ('app' | 'sms' | 'email')[];
  routeCoords?:  [number, number][]; // full OSRM road route geometry from mobile
}

// ── Water-pipeline task (mirrors AccidentTask for map tracking) ──────────────
export interface WasteTask {
  taskId:        string;
  responderId:   string;
  responderName: string;
  role:          string;
  status:        TaskStatus;
  binId:         string;
  binName:       string;
  origin:        [number, number];
  destination:   [number, number];
  currentPos:    [number, number];
  distKm:        number;
  etaSec:        number;
  sentAt:        number;
  acceptedAt:    number | null;
  arrivedAt:     number | null;
  resolvedAt:    number | null;
  routeCoords?:  [number, number][];
}

export interface WaterTask {
  taskId:        string;
  responderId:   string;
  responderName: string;
  role:          string;
  status:        TaskStatus;
  origin:        [number, number]; // [lng, lat]
  destination:   [number, number];
  currentPos:    [number, number];
  distKm:        number;
  etaSec:        number;
  sentAt:        number;
  acceptedAt:    number | null;
  arrivedAt:     number | null;
  resolvedAt:    number | null;
  routeCoords?:  [number, number][];
}

// ── AI Advisory templates ────────────────────────────────────────────────
export interface AccidentAIAdvisory {
  severity:     'LOW' | 'MEDIUM' | 'HIGH';
  suggestions:  string[];
  signalPlan:   string;
  diversion:    string;
  clearTimeEst: string;
}

export function generateAIAdvisory(severity: 'LOW' | 'MEDIUM' | 'HIGH', signalName: string): AccidentAIAdvisory {
  const PLANS: Record<string, AccidentAIAdvisory> = {
    LOW: {
      severity: 'LOW',
      suggestions: [
        'Deploy 1 traffic officer in 5 min',
        `Set ${signalName} to FLASHING mode`,
        'Enable smart routing to alternate lanes',
        'Monitor via CCTV for 10 min',
      ],
      signalPlan:   'Extend green on adjacent arms by 15 sec',
      diversion:    'No diversion required — single-lane obstruction',
      clearTimeEst: '10–15 minutes',
    },
    MEDIUM: {
      severity: 'MEDIUM',
      suggestions: [
        'Dispatch ambulance within 3 min',
        'Send 1 traffic police unit',
        `Lock ${signalName} to RED for accident arm`,
        'Divert vehicles via Academic City Road (Route B)',
        'Set 2 nearby junctions to extended GREEN',
      ],
      signalPlan:   'RED-lock accident arm, extend green on diversion route +20 sec',
      diversion:    'Divert southbound via Academic City Road → Silicon Central alternate',
      clearTimeEst: '20–30 minutes',
    },
    HIGH: {
      severity: 'HIGH',
      suggestions: [
        'Dispatch ambulance within 2 min — critical injuries likely',
        'Send 2 traffic police units for crowd & traffic control',
        'Dispatch fire & rescue for vehicle extrication',
        `Lock ${signalName} and 2 adjacent signals to RED`,
        'Activate full diversion via Route B & Route C',
        'Alert hospital ER for incoming casualties',
        'Deploy maintenance crew for debris clearance',
      ],
      signalPlan:   'RED-lock 3 intersections, activate contraflow on alternate route',
      diversion:    'Full diversion: northbound → Academic City Rd; southbound → Silicon Oasis Bypass',
      clearTimeEst: '45–60 minutes',
    },
  };
  return PLANS[severity];
}
