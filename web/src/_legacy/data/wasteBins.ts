// ─────────────────────────────────────────────────────────────────────────────
//  DSO Smart Waste Bins — 15 IoT-enabled bins across Dubai Silicon Oasis
// ─────────────────────────────────────────────────────────────────────────────

export interface WasteBin {
  id:            string;
  name:          string;
  location:      [number, number]; // [lng, lat]
  zone:          string;
  fillLevel:     number;      // 0–100 %
  capacity:      number;      // litres
  batteryLevel:  number;      // 0–100 %
  lastCollected: string;      // ISO datetime
  binType:       'general' | 'recycling' | 'organic';
  sensorStatus:  'online' | 'offline';
}

export const OVERFLOW_BIN_ID = 'WB-007';

export const WASTE_BINS: WasteBin[] = [
  // ── Residential North ─────────────────────────────────────────────────────
  { id: 'WB-001', name: 'Silicon Heights Block A',    location: [55.3801, 25.1248], zone: 'Residential North',  fillLevel: 45, capacity: 240, batteryLevel: 87, lastCollected: '2026-04-13T08:30:00', binType: 'general',   sensorStatus: 'online'  },
  { id: 'WB-002', name: 'Silicon Heights Block B',    location: [55.3814, 25.1255], zone: 'Residential North',  fillLevel: 62, capacity: 240, batteryLevel: 92, lastCollected: '2026-04-13T08:30:00', binType: 'recycling', sensorStatus: 'online'  },
  { id: 'WB-003', name: 'North Residential Gate',     location: [55.3828, 25.1300], zone: 'Residential North',  fillLevel: 38, capacity: 240, batteryLevel: 78, lastCollected: '2026-04-13T09:00:00', binType: 'general',   sensorStatus: 'online'  },
  // ── Tech Zone ─────────────────────────────────────────────────────────────
  { id: 'WB-004', name: 'Tech Park Plaza',            location: [55.3858, 25.1238], zone: 'Tech Zone',          fillLevel: 55, capacity: 360, batteryLevel: 65, lastCollected: '2026-04-13T10:00:00', binType: 'general',   sensorStatus: 'online'  },
  { id: 'WB-005', name: 'DSO HQ Entrance',            location: [55.3875, 25.1225], zone: 'Tech Zone',          fillLevel: 71, capacity: 360, batteryLevel: 90, lastCollected: '2026-04-12T16:00:00', binType: 'recycling', sensorStatus: 'online'  },
  { id: 'WB-006', name: 'East Tech Building',         location: [55.3892, 25.1256], zone: 'Tech Zone',          fillLevel: 33, capacity: 360, batteryLevel: 95, lastCollected: '2026-04-13T12:00:00', binType: 'general',   sensorStatus: 'online'  },
  // ── The overflow candidate ─────────────────────────────────────────────────
  { id: 'WB-007', name: 'Silicon Gates Tower',        location: [55.3833, 25.1272], zone: 'Residential North',  fillLevel: 88, capacity: 240, batteryLevel: 72, lastCollected: '2026-04-12T14:00:00', binType: 'general',   sensorStatus: 'online'  },
  // ── Central / Parks ───────────────────────────────────────────────────────
  { id: 'WB-008', name: 'Central Roundabout',         location: [55.3820, 25.1268], zone: 'Central',            fillLevel: 52, capacity: 360, batteryLevel: 83, lastCollected: '2026-04-13T09:00:00', binType: 'organic',   sensorStatus: 'online'  },
  { id: 'WB-009', name: 'Garden Walk',                location: [55.3843, 25.1282], zone: 'Parks',              fillLevel: 60, capacity: 120, batteryLevel: 91, lastCollected: '2026-04-13T07:00:00', binType: 'organic',   sensorStatus: 'online'  },
  { id: 'WB-010', name: 'Central Park East',          location: [55.3858, 25.1262], zone: 'Parks',              fillLevel: 35, capacity: 120, batteryLevel: 94, lastCollected: '2026-04-13T06:30:00', binType: 'organic',   sensorStatus: 'online'  },
  // ── Residential West / South ──────────────────────────────────────────────
  { id: 'WB-011', name: 'West Boulevard',             location: [55.3784, 25.1222], zone: 'Residential West',   fillLevel: 47, capacity: 240, batteryLevel: 88, lastCollected: '2026-04-13T09:30:00', binType: 'general',   sensorStatus: 'online'  },
  { id: 'WB-012', name: 'Residential South Gate',     location: [55.3807, 25.1192], zone: 'Residential South',  fillLevel: 29, capacity: 240, batteryLevel: 77, lastCollected: '2026-04-13T11:00:00', binType: 'recycling', sensorStatus: 'online'  },
  // ── Commercial ────────────────────────────────────────────────────────────
  { id: 'WB-013', name: 'NEST Building',              location: [55.3793, 25.1208], zone: 'Commercial',         fillLevel: 74, capacity: 360, batteryLevel: 55, lastCollected: '2026-04-12T18:00:00', binType: 'recycling', sensorStatus: 'online'  },
  // ── Academic / East Gate ──────────────────────────────────────────────────
  { id: 'WB-014', name: 'Academic City Link',         location: [55.3845, 25.1192], zone: 'Academic',           fillLevel: 41, capacity: 240, batteryLevel: 82, lastCollected: '2026-04-13T10:30:00', binType: 'general',   sensorStatus: 'online'  },
  { id: 'WB-015', name: 'East Gate Service Road',     location: [55.3905, 25.1215], zone: 'East Gate',          fillLevel: 56, capacity: 240, batteryLevel: 76, lastCollected: '2026-04-13T10:30:00', binType: 'general',   sensorStatus: 'online'  },
];

/** Fill-level → colour string */
export function fillColor(pct: number): string {
  if (pct >= 90) return '#ef5350';
  if (pct >= 75) return '#FF8A65';
  if (pct >= 55) return '#FFB74D';
  return '#66BB6A';
}

/** Fill-level → status label */
export function fillLabel(pct: number): 'OVERFLOW' | 'CRITICAL' | 'WARNING' | 'NORMAL' {
  if (pct >= 90) return 'OVERFLOW';
  if (pct >= 75) return 'CRITICAL';
  if (pct >= 55) return 'WARNING';
  return 'NORMAL';
}

export const BIN_TYPE_ICON: Record<WasteBin['binType'], string> = {
  general:   '🗑️',
  recycling: '♻️',
  organic:   '🌱',
};
