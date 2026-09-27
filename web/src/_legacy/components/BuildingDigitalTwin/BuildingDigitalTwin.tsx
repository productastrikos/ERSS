import { useState, useEffect, useCallback } from 'react';
import './BuildingDigitalTwin.scss';
import NestBuilding3D from './NestBuilding3D';
import type { NestFloor, NestIncident } from './NestBuilding3D';
import HVACSchematicPanel from './HVACSchematicPanel';
import HVACIncidentPanel from './HVACIncidentPanel';

// ── Types ─────────────────────────────────────────────────────────────────────
type ViewMode   = 'floor' | 'system' | '3d' | 'walk';
type FloorId    = 'B1' | 'G' | 'F1' | 'F2' | 'F3';
type SystemId   = 'power' | 'hvac' | 'fire' | 'lighting' | 'water' | 'occupancy';
type IncidentSim = 'fire' | 'hvac' | 'power' | 'occupancy' | 'energy' | null;

interface RoomDef {
  id:       string;
  name:     string;
  x: number; y: number; w: number; h: number;
  systems:  SystemId[];
  incident?: 'fire' | 'hvac' | 'power';
  people:   number;
}

interface KPIState {
  powerLoad:      number;
  hvacEfficiency: number;
  temperature:    number;
  occupancy:      number;
  waterLevel:     number;
}

interface NotifItem {
  id:      string;
  agency:  string;
  icon:    string;
  status:  'sending' | 'sent' | 'delivered' | 'accepted' | 'en_route';
  sentAt:  number;
}

// ── Floor room definitions ────────────────────────────────────────────────────
const FLOORS: { id: FloorId; label: string }[] = [
  { id: 'B1', label: 'B1 · Basement' },
  { id: 'G',  label: 'G · Ground' },
  { id: 'F1', label: 'F1 · First' },
  { id: 'F2', label: 'F2 · Second' },
  { id: 'F3', label: 'F3 · Roof' },
];

const ROOMS: Record<FloorId, RoomDef[]> = {
  B1: [
    { id: 'elec',    name: 'Main Electrical', x: 8,   y: 8,   w: 108, h: 88, systems: ['power'],              incident: 'power', people: 0 },
    { id: 'ups',     name: 'UPS Room',        x: 126, y: 8,   w: 80,  h: 88, systems: ['power'],              people: 0 },
    { id: 'pump',    name: 'Pump Room',       x: 216, y: 8,   w: 88,  h: 88, systems: ['water'],              people: 0 },
    { id: 'parking', name: 'Parking',         x: 8,   y: 106, w: 296, h: 82, systems: [],                     people: 0 },
  ],
  G: [
    { id: 'lobby',    name: 'Main Lobby',  x: 8,   y: 8,   w: 138, h: 90, systems: ['occupancy', 'lighting'], people: 18 },
    { id: 'reception',name: 'Reception',   x: 156, y: 8,   w: 80,  h: 46, systems: ['occupancy', 'lighting'], people: 3  },
    { id: 'cafeteria',name: 'Cafeteria',   x: 156, y: 64,  w: 148, h: 60, systems: ['hvac', 'lighting'],      people: 24 },
    { id: 'server',   name: 'Server Room', x: 8,   y: 108, w: 90,  h: 80, systems: ['power', 'hvac', 'fire'], incident: 'fire', people: 0 },
    { id: 'security', name: 'Security',    x: 108, y: 108, w: 80,  h: 80, systems: ['occupancy'],             people: 2  },
  ],
  F1: [
    { id: 'office_a', name: 'Open Office A',  x: 8,   y: 8,   w: 152, h: 100, systems: ['occupancy', 'lighting', 'hvac'], people: 42 },
    { id: 'office_b', name: 'Open Office B',  x: 170, y: 8,   w: 134, h: 100, systems: ['occupancy', 'lighting', 'hvac'], people: 28 },
    { id: 'meeting1', name: 'Meeting Rm 1',   x: 8,   y: 118, w: 90,  h: 70,  systems: ['occupancy', 'lighting'],        people: 8  },
    { id: 'meeting2', name: 'Meeting Rm 2',   x: 108, y: 118, w: 90,  h: 70,  systems: ['occupancy', 'lighting'],        people: 0  },
    { id: 'it_room',  name: 'IT Room',        x: 208, y: 118, w: 96,  h: 70,  systems: ['power', 'hvac', 'fire'],        people: 4  },
  ],
  F2: [
    { id: 'exec',     name: 'Executive Suite', x: 8,   y: 8,   w: 128, h: 92, systems: ['occupancy', 'lighting', 'hvac'], people: 12 },
    { id: 'board',    name: 'Board Room',      x: 146, y: 8,   w: 158, h: 92, systems: ['occupancy', 'lighting', 'hvac'], people: 0  },
    { id: 'hr',       name: 'HR & Admin',      x: 8,   y: 110, w: 100, h: 78, systems: ['occupancy', 'lighting'],         people: 8  },
    { id: 'finance',  name: 'Finance Dept',    x: 118, y: 110, w: 100, h: 78, systems: ['occupancy', 'lighting'],         people: 10 },
    { id: 'training', name: 'Training Room',   x: 228, y: 110, w: 76,  h: 78, systems: ['occupancy', 'lighting', 'hvac'], people: 0  },
  ],
  F3: [
    { id: 'hvac_room', name: 'HVAC Plant',   x: 8,   y: 8,   w: 128, h: 90, systems: ['hvac', 'power'],   incident: 'hvac', people: 0 },
    { id: 'solar',     name: 'Solar Array',  x: 146, y: 8,   w: 158, h: 90, systems: ['power'],           people: 0 },
    { id: 'bms',       name: 'BMS Control',  x: 8,   y: 108, w: 128, h: 80, systems: ['power', 'fire'],   people: 3 },
    { id: 'wtank',     name: 'Water Tank',   x: 146, y: 108, w: 80,  h: 80, systems: ['water'],           people: 0 },
    { id: 'genset',    name: 'Generator',    x: 236, y: 108, w: 68,  h: 80, systems: ['power'],           people: 0 },
  ],
};

// ── Incident stage labels ─────────────────────────────────────────────────────
const INCIDENT_STAGES: Record<NonNullable<IncidentSim>, string[]> = { // eslint-disable-line
  fire: [
    '🔥 Smoke sensor triggered — Server Room',
    '🌡 Temperature rising: 24°C → 42°C detected',
    '⚠ Fire confirmed by BMS multi-sensor fusion',
    '🤖 AI Advisory generated — CRITICAL FIRE ALERT',
    '🚨 Evacuation initiated — all G Floor personnel',
    '❄ HVAC shutdown — preventing smoke spread',
    '� Sprinkler system activated — Server Room',
    '📡 Fire dept + security + FM notified',
    '🚒 Dubai Civil Defence en route — ETA 4 min',
  ],
  hvac: [
    '🌡 Temperature anomaly: Zone A exceeds 28°C',
    '💨 Airflow drop detected: AHU-01 → 38% capacity',
    '❌ AHU-01 FAILURE confirmed by sensor array',
    '🤖 AI suggests: immediate maintenance dispatch',
    '🔧 Technician dispatched — ETA 8 min',
  ],
  power: [
    '⚡ Load threshold exceeded: DSO-PANEL-3 at 94%',
    '📊 Risk of cascading failure — load analysis active',
    '🔌 Circuit DSO-PANEL-3 isolated automatically',
    '🔋 Backup UPS activated — critical loads protected',
    '🔧 Electrical technician alerted — ETA 12 min',
  ],
  occupancy: [
    '👥 Occupancy sensor: Innovation Hub at 148% capacity',
    '🚶 Crowd density exceeds safe threshold — F1 zone A',
    '🤖 AI Advisory: reroute people flow — door B2 & B3',
    '🔔 Access control notified — limiting new entries',
    '🛡 Security dispatched to Innovation Hub',
    '✅ Crowd density normalised — all thresholds green',
  ],
  energy: [
    '🌍 AI energy scan initiated — building-wide',
    '💡 Detected: 14 unoccupied zones with full HVAC + lighting',
    '🤖 AI Advisory: apply setback to 14 zones — save 280 kWh/day',
    '⚙ Setback applied: HVAC –18%, Lighting –22% in empty zones',
    '📊 Savings confirmed: 280 kWh/day · CO₂ reduction: 142 kg/day',
    '🏆 Energy optimisation complete — EcoStruxure AI target met',
  ],
};

// 0 = operator approval required at that stage index
const INCIDENT_DELAYS: Record<NonNullable<IncidentSim>, number[]> = {
  fire:      [2400, 2000, 1600, 0, 2500, 2200, 2000, 1800, 4000],
  hvac:      [2000, 2000, 1600, 0, 3500],
  power:     [2000, 1600, 2200, 2000, 0],
  occupancy: [2200, 1800, 0, 2000, 2500, 3000],
  energy:    [2000, 2200, 0, 3000, 2500, 3500],
};

const AI_ADVISORIES: Record<NonNullable<IncidentSim>, { riskLevel: string; actions: string[]; note: string }> = {
  fire: {
    riskLevel: 'CRITICAL',
    actions: [
      'Evacuate all personnel from Ground Floor immediately',
      'Shut down HVAC system to prevent smoke spread via ducts',
      'Activate full sprinkler coverage in Server Room',
      'Lock emergency exit routes — direct to Assembly Point B',
      'Notify Dubai Civil Defence, Building FM, and Security HQ',
    ],
    note: 'Classification: Class C (Electronic Fire). CO₂ suppression recommended. Do NOT use water on live electrical equipment.',
  },
  hvac: {
    riskLevel: 'HIGH',
    actions: [
      'Isolate AHU-01 — transfer load to AHU-02 backup circuit',
      'Increase Chiller-1 output for Zone A thermal compensation',
      'Issue temperature advisory for F1 office zones',
      'Dispatch HVAC maintenance team with AHU-01 service kit',
    ],
    note: 'Estimated repair time: 45 min. Temporary cooling units available from Building Services on Floor B1.',
  },
  power: {
    riskLevel: 'HIGH',
    actions: [
      'Reduce non-critical loads on DSO-PANEL-3 immediately',
      'Transfer Server Room & critical IT to dedicated UPS circuit',
      'Alert all floor occupants of potential power interruption',
      'Verify diesel generator auto-start sequence readiness',
    ],
    note: 'UPS runtime at current load: ~18 minutes. Priority: protect server hardware and fire alarm systems.',
  },
  occupancy: {
    riskLevel: 'MEDIUM',
    actions: [
      'Activate one-way flow via emergency exit corridor B',
      'Limit access-card entries to Innovation Hub — max 50 pax',
      'Redirect overflow to Amphitheater (capacity: 120)',
      'Issue in-app notification to all employees on F1',
    ],
    note: 'Maximum safe occupancy: 50 persons (Innovation Hub). Current count: 74. Activate overflow routing immediately.',
  },
  energy: {
    riskLevel: 'LOW',
    actions: [
      'Apply HVAC setback (18°C → 26°C) to 14 unoccupied zones',
      'Dim lighting to 10% in unoccupied rooms (F1 Training, F3 Board)',
      'Shift non-critical server workloads to off-peak window (22:00–06:00)',
      'Enable solar export mode — surplus to DEWA grid',
    ],
    note: 'Expected savings: 280 kWh/day, 142 kg CO₂/day. Annual target: 102,200 kWh (~AED 56,000/year savings).',
  },
};

const INITIAL_KPIS: KPIState = {
  powerLoad: 67, hvacEfficiency: 84, temperature: 23, occupancy: 65, waterLevel: 78,
};

// ── HVAC airflow paths per floor ──────────────────────────────────────────────
const HVAC_FLOWS: Partial<Record<FloorId, string[]>> = {
  G:  ['M 78 60 L 230 60', 'M 230 60 L 230 100', 'M 155 60 L 155 90'],
  F1: ['M 84 55 L 237 55', 'M 160 55 L 160 118', 'M 255 55 L 255 118'],
  F2: ['M 70 55 L 265 55', 'M 165 55 L 165 110'],
  F3: ['M 65 52 L 72 52', 'M 72 52 L 72 148'],
};

const WATER_PIPES: Partial<Record<FloorId, string[]>> = {
  B1: ['M 260 8 L 260 106 L 8 106', 'M 200 52 L 200 8'],
  G:  ['M 50 188 L 50 60 L 304 60'],
  F3: ['M 186 188 L 186 108 L 134 148'],
};

// ── KPI gauge sub-component ───────────────────────────────────────────────────
function KPICard({ label, value, unit, color, max }: { label: string; value: number; unit: string; color: string; max: number }) {
  const pct   = Math.min(100, (value / max) * 100);
  const r     = 20;
  const circ  = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <div className="bdt__kpi-card">
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(60,80,120,0.3)" strokeWidth="4" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 26 26)"
          style={{ transition: 'stroke-dashoffset 0.8s ease', filter: `drop-shadow(0 0 4px ${color})` }} />
        <text x="26" y="27" textAnchor="middle" dominantBaseline="middle"
          fontSize="9" fontWeight="700" fill={color} fontFamily="Inter,system-ui">
          {Math.round(value)}{unit.length <= 2 ? unit : ''}
        </text>
      </svg>
      <div className="bdt__kpi-label">{label}</div>
    </div>
  );
}

// ── System schematic views ────────────────────────────────────────────────────
function SchematicBox({ x, y, w, h, label, sub, color, alert = false }:
  { x: number; y: number; w: number; h: number; label: string; sub?: string; color: string; alert?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h}
        fill={alert ? 'rgba(239,68,68,0.18)' : 'rgba(15,22,40,0.95)'}
        stroke={alert ? '#ef4444' : color} strokeWidth={alert ? 1.8 : 1} rx="4"
        style={alert ? { filter: 'drop-shadow(0 0 6px rgba(239,68,68,0.5))' } : undefined}
        className={alert ? 'bdt__room-g--power' : undefined} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 7 : y + h / 2} textAnchor="middle"
        dominantBaseline="middle" fontSize="8" fontWeight="700" fill={color}
        fontFamily="Inter,system-ui">{label}</text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 7} textAnchor="middle"
        dominantBaseline="middle" fontSize="7" fill="rgba(156,163,175,0.8)"
        fontFamily="Inter,system-ui">{sub}</text>}
    </g>
  );
}

function SchematicArrow({ x1, y1, x2, y2, color, dashed = false }:
  { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.8"
      strokeDasharray={dashed ? '5,3' : undefined}
      markerEnd="url(#marrow)" className={dashed ? undefined : 'bdt__flow-line'} />
  );
}

function PowerSchematic({ incidentSim, stage }: { incidentSim: IncidentSim; stage: number }) {
  const isAlert = incidentSim === 'power' && stage >= 1;
  return (
    <svg viewBox="0 0 620 290" className="bdt__schematic-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="marrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="rgba(96,165,250,0.8)" />
        </marker>
      </defs>
      <rect width="620" height="290" fill="rgba(8,12,22,0.5)" rx="6" />
      {/* Connections */}
      <SchematicArrow x1={120} y1={104} x2={165} y2={104} color="rgba(96,165,250,0.7)" />
      <SchematicArrow x1={275} y1={104} x2={325} y2={104} color="rgba(96,165,250,0.7)" />
      <SchematicArrow x1={455} y1={88} x2={495} y2={48} color="rgba(74,222,128,0.7)" />
      <SchematicArrow x1={455} y1={104} x2={495} y2={104} color="rgba(52,211,153,0.7)" />
      <SchematicArrow x1={455} y1={120} x2={495} y2={160} color="rgba(251,191,36,0.7)" />
      <SchematicArrow x1={120} y1={210} x2={165} y2={210} color="rgba(251,146,60,0.5)" dashed />
      <SchematicArrow x1={275} y1={196} x2={370} y2={130} color="rgba(167,139,250,0.5)" dashed />
      {/* Boxes */}
      <SchematicBox x={10}  y={80}  w={110} h={48} label="⚡ UTILITY GRID"  sub="11 kV Supply"        color="#60a5fa" />
      <SchematicBox x={165} y={80}  w={110} h={48} label="🔄 TRANSFORMER"   sub="11kV / 400V"         color="#8b5cf6" />
      <SchematicBox x={325} y={80}  w={130} h={48} label="📊 MAIN LV PANEL" sub={isAlert ? '⚠ 94% LOAD' : '67% load'} color={isAlert ? '#ef4444' : '#60a5fa'} alert={isAlert && stage >= 1} />
      <SchematicBox x={495} y={20}  w={110} h={38} label="🖥 SERVER UPS"    sub="Critical"            color="#4ade80" />
      <SchematicBox x={495} y={84}  w={110} h={38} label="❄ HVAC PANEL"    sub="Non-critical"         color="#34d399" />
      <SchematicBox x={495} y={148} w={110} h={38} label="💡 OFFICES F1–F3" sub="Smart load"          color="#fbbf24" />
      <SchematicBox x={10}  y={186} w={110} h={48} label="⚙ GENERATOR"     sub="500 kVA diesel"      color="#fb923c" />
      <SchematicBox x={165} y={186} w={110} h={48} label="🔋 UPS SYSTEM"   sub="30 min backup"       color="#a78bfa" />
      {/* Label */}
      <text x="310" y="278" textAnchor="middle" fontSize="9" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="1">POWER DISTRIBUTION ONE-LINE DIAGRAM</text>
    </svg>
  );
}

function FireSchematic({ incidentSim, stage }: { incidentSim: IncidentSim; stage: number }) {
  const isAlert = incidentSim === 'fire' && stage >= 1;
  return (
    <svg viewBox="0 0 620 290" className="bdt__schematic-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="marrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="rgba(239,68,68,0.8)" />
        </marker>
      </defs>
      <rect width="620" height="290" fill="rgba(8,12,22,0.5)" rx="6" />
      {/* Connections */}
      <line x1="120" y1="104" x2="175" y2="104" stroke="rgba(239,68,68,0.5)" strokeWidth="1.8" />
      <line x1="285" y1="104" x2="340" y2="55"  stroke="rgba(239,68,68,0.5)" strokeWidth="1.5" />
      <line x1="285" y1="104" x2="340" y2="104" stroke="rgba(239,68,68,0.5)" strokeWidth="1.5" />
      <line x1="285" y1="104" x2="340" y2="155" stroke="rgba(239,68,68,0.5)" strokeWidth="1.5" />
      <line x1="285" y1="104" x2="340" y2="205" stroke="rgba(239,68,68,0.5)" strokeWidth="1.5" />
      <line x1="450" y1="55"  x2="505" y2="25"  stroke="rgba(239,68,68,0.5)" strokeWidth="1.2" />
      <line x1="450" y1="55"  x2="505" y2="70"  stroke="rgba(239,68,68,0.5)" strokeWidth="1.2" />
      {/* Component boxes */}
      <SchematicBox x={10}  y={80}  w={110} h={48} label="🚨 FIRE PANEL"  sub="Notifier NFS-320"  color="#ef4444" alert={isAlert && stage >= 3} />
      <SchematicBox x={175} y={80}  w={110} h={48} label="🤖 AI ENGINE"   sub="Multi-sensor fusion" color="#a78bfa" />
      <SchematicBox x={340} y={30}  w={110} h={48} label="Floor B1"       sub={isAlert ? '0 triggers' : 'Normal'}  color={isAlert ? '#4ade80' : '#6b7280'} />
      <SchematicBox x={340} y={80}  w={110} h={48} label="Floor G"        sub={isAlert ? '⚠ FIRE ZONE' : 'Normal'}  color={isAlert ? '#ef4444' : '#6b7280'} alert={isAlert && stage >= 1} />
      <SchematicBox x={340} y={130} w={110} h={48} label="Floor F1"       sub="2 sensors active"  color="#6b7280" />
      <SchematicBox x={340} y={180} w={110} h={48} label="Floor F2–F3"    sub="Normal operation"  color="#6b7280" />
      <SchematicBox x={505} y={10}  w={110} h={38} label="💧 SPRINKLER"   sub={isAlert && stage >= 7 ? 'ACTIVATED ✓' : 'Armed standby'} color={isAlert && stage >= 7 ? '#60a5fa' : '#6b7280'} />
      <SchematicBox x={505} y={58}  w={110} h={38} label="🔔 ALARM BELL"  sub={isAlert ? 'SOUNDING ⚠' : 'Silent'}  color={isAlert ? '#facc15' : '#6b7280'} />
      <text x="310" y="278" textAnchor="middle" fontSize="9" fill="rgba(239,68,68,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="1">FIRE DETECTION & SUPPRESSION SYSTEM</text>
    </svg>
  );
}

function WaterSchematic() {
  return (
    <svg viewBox="0 0 620 290" className="bdt__schematic-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="620" height="290" fill="rgba(8,12,22,0.5)" rx="6" />
      <line x1="120" y1="55"  x2="175" y2="55"  stroke="rgba(129,140,248,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="120" y1="145" x2="175" y2="145" stroke="rgba(129,140,248,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="285" y1="55"  x2="340" y2="55"  stroke="rgba(129,140,248,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="285" y1="145" x2="340" y2="145" stroke="rgba(129,140,248,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="450" y1="55"  x2="505" y2="25"  stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" />
      <line x1="450" y1="55"  x2="505" y2="75"  stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" />
      <line x1="450" y1="145" x2="505" y2="125" stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" />
      <line x1="450" y1="145" x2="505" y2="175" stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" />
      <SchematicBox x={10}  y={30}  w={110} h={50} label="💧 MAINS SUPPLY" sub="DEWA 6 bar"       color="#818cf8" />
      <SchematicBox x={10}  y={120} w={110} h={50} label="💧 ROOFTOP TANK" sub="78% · 4800 L"    color="#818cf8" />
      <SchematicBox x={175} y={30}  w={110} h={50} label="⚙ PUMP A"        sub="Primary · Online"  color="#60a5fa" />
      <SchematicBox x={175} y={120} w={110} h={50} label="⚙ PUMP B"        sub="Standby · Ready"   color="#6b7280" />
      <SchematicBox x={340} y={30}  w={110} h={50} label="💦 PRV STATION"  sub="4 bar regulated"  color="#818cf8" />
      <SchematicBox x={340} y={120} w={110} h={50} label="🚿 SPRINKLER"    sub="Armed · All zones" color="#34d399" />
      <SchematicBox x={505} y={10}  w={110} h={38} label="Floors B1–G"     sub="Supplied"         color="#818cf8" />
      <SchematicBox x={505} y={58}  w={110} h={38} label="Floors F1–F2"    sub="Supplied"         color="#818cf8" />
      <SchematicBox x={505} y={110} w={110} h={38} label="Floor F3"        sub="Supplied"         color="#818cf8" />
      <SchematicBox x={505} y={154} w={110} h={38} label="🏭 Cooling Tower" sub="Makeup: 120 L/h" color="#818cf8" />
      <text x="310" y="278" textAnchor="middle" fontSize="9" fill="rgba(129,140,248,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="1">WATER DISTRIBUTION & MONITORING SYSTEM</text>
    </svg>
  );
}

function LightingSchematic() {
  return (
    <svg viewBox="0 0 620 290" className="bdt__schematic-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="620" height="290" fill="rgba(8,12,22,0.5)" rx="6" />
      <line x1="115" y1="104" x2="170" y2="104" stroke="rgba(251,191,36,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="280" y1="104" x2="335" y2="55"  stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />
      <line x1="280" y1="104" x2="335" y2="104" stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />
      <line x1="280" y1="104" x2="335" y2="155" stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />
      <line x1="280" y1="104" x2="335" y2="205" stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" />
      <SchematicBox x={10}  y={80}  w={105} h={48} label="🎮 DALI CONTROLLER" sub="Smart BMS v3"  color="#fbbf24" />
      <SchematicBox x={170} y={80}  w={110} h={48} label="📡 OCCUPANCY HUB"   sub="Sensor fusion" color="#a78bfa" />
      <SchematicBox x={335} y={30}  w={110} h={48} label="💡 Floor B1"        sub="0% load (empty)" color="#6b7280" />
      <SchematicBox x={335} y={80}  w={110} h={48} label="💡 Floor G"         sub="85% — Lobby active" color="#fbbf24" />
      <SchematicBox x={335} y={130} w={110} h={48} label="💡 Floor F1"        sub="92% — Full office" color="#fbbf24" />
      <SchematicBox x={335} y={180} w={110} h={48} label="💡 Floor F2"        sub="40% — Partial"    color="#fbbf24" />
      <SchematicBox x={10}  y={180} w={105} h={48} label="🌞 SOLAR PANELS"    sub="22 kWp / 14 kW"  color="#fbbf24" />
      <text x="310" y="278" textAnchor="middle" fontSize="9" fill="rgba(251,191,36,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="1">SMART LIGHTING CONTROL — AUTO-DIM WITH OCCUPANCY</text>
    </svg>
  );
}

function OccupancySchematic() {
  return (
    <svg viewBox="0 0 620 290" className="bdt__schematic-svg" xmlns="http://www.w3.org/2000/svg">
      <rect width="620" height="290" fill="rgba(8,12,22,0.5)" rx="6" />
      <line x1="115" y1="104" x2="170" y2="104" stroke="rgba(167,139,250,0.6)" strokeWidth="2" className="bdt__flow-line" />
      <line x1="280" y1="85"  x2="335" y2="55"  stroke="rgba(167,139,250,0.5)" strokeWidth="1.5" />
      <line x1="280" y1="104" x2="335" y2="104" stroke="rgba(167,139,250,0.5)" strokeWidth="1.5" />
      <line x1="280" y1="123" x2="335" y2="155" stroke="rgba(167,139,250,0.5)" strokeWidth="1.5" />
      <line x1="445" y1="55"  x2="500" y2="30"  stroke="rgba(167,139,250,0.4)" strokeWidth="1.2" />
      <line x1="445" y1="55"  x2="500" y2="75"  stroke="rgba(167,139,250,0.4)" strokeWidth="1.2" />
      <SchematicBox x={10}  y={80}  w={105} h={48} label="🔐 ACCESS SERVER"  sub="Active Directory"  color="#a78bfa" />
      <SchematicBox x={170} y={80}  w={110} h={48} label="🧠 PEOPLE COUNT AI" sub="Real-time fusion"  color="#a78bfa" />
      <SchematicBox x={335} y={30}  w={110} h={48} label="🚪 ENTRY GATES ×4"  sub="154 badges online" color="#a78bfa" />
      <SchematicBox x={335} y={80}  w={110} h={48} label="📸 CCTV ×22"        sub="All zones covered" color="#60a5fa" />
      <SchematicBox x={335} y={130} w={110} h={48} label="📡 BLE SENSORS"     sub="Floor-level count"  color="#a78bfa" />
      <SchematicBox x={500} y={10}  w={110} h={38} label="Lobby: 18 people"   sub="Normal flow"        color="#4ade80" />
      <SchematicBox x={500} y={58}  w={110} h={38} label="F1: 70 people"      sub="Full capacity"      color="#fbbf24" />
      <text x="310" y="278" textAnchor="middle" fontSize="9" fill="rgba(167,139,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="1">ACCESS CONTROL & OCCUPANCY MONITORING</text>
    </svg>
  );
}

function SystemSchematic({ activeSystem, incidentSim, incidentStage }: {
  activeSystem: SystemId | null; incidentSim: IncidentSim; incidentStage: number;
}) {
  const sys = activeSystem ?? (incidentSim as SystemId | null);
  if (!sys) {
    return (
      <div className="bdt__schematic-empty">
        <span style={{ fontSize: 40 }}>⚙️</span>
        <p>Select a subsystem from the left panel<br />to view its schematic diagram</p>
      </div>
    );
  }
  if (sys === 'power')     return <PowerSchematic incidentSim={incidentSim} stage={incidentStage} />;
  if (sys === 'fire')      return <FireSchematic incidentSim={incidentSim} stage={incidentStage} />;
  if (sys === 'water')     return <WaterSchematic />;
  if (sys === 'lighting')  return <LightingSchematic />;
  if (sys === 'occupancy') return <OccupancySchematic />;
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
interface BuildingDigitalTwinProps { onClose: () => void; }

// ══════════════════════════════════════════════════════════════════════════════
// BMS TEAM MANAGEMENT PANEL — predefined login profiles for BMS response team
// ══════════════════════════════════════════════════════════════════════════════
const SOCKET_SERVER_URL = 'http://192.168.0.223:3001';
const BMS_ROLES = ['HVAC Technician', 'Electrical Engineer', 'Fire Safety Officer', 'Facility Manager'];

const PREDEFINED_BMS = [
  { userId: 'HV-001', name: 'Tech Arjun',    role: 'HVAC Technician',       password: 'HVAC@dso1'   },
  { userId: 'EE-001', name: 'Eng. Sana',      role: 'Electrical Engineer',   password: 'Elec@dso1'   },
  { userId: 'FS-001', name: 'Officer Jaya',   role: 'Fire Safety Officer',   password: 'FSafe@dso1'  },
  { userId: 'FM-001', name: 'Manager Ravi',   role: 'Facility Manager',      password: 'Facil@dso1'  },
];

function BMSTeamPanel() {
  const [members, setMembers] = useState<{ userId: string; name: string; role: string; online: boolean; status: string }[]>([]);
  const [showPasswords, setShowPasswords] = useState(false);

  useEffect(() => {
    fetch(`${SOCKET_SERVER_URL}/api/users`)
      .then(r => r.json())
      .then((all: { userId: string; name: string; role: string; online: boolean; status: string }[]) =>
        setMembers(all.filter(u => BMS_ROLES.includes(u.role)))
      )
      .catch(() => { /* server may be offline */ });
  }, []);

  return (
    <div style={{ fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: '10px', lineHeight: 1.4, marginBottom: '4px' }}>
        Predefined BMS team accounts. Share ID + password so they can log in via the mobile app.
      </div>

      {/* Predefined credentials */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '9px', color: '#58a6ff', fontWeight: 700, letterSpacing: '0.05em' }}>PREDEFINED ACCOUNTS</span>
        <button
          onClick={() => setShowPasswords(p => !p)}
          style={{ background: 'transparent', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff', borderRadius: '4px', padding: '1px 6px', fontSize: '9px', cursor: 'pointer' }}
        >
          {showPasswords ? '🙈 Hide' : '👁 Show'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {PREDEFINED_BMS.map(c => {
          const live = members.find(m => m.userId === c.userId);
          return (
            <div key={c.userId} style={{ display: 'grid', gridTemplateColumns: '55px 1fr auto auto', gap: '5px', alignItems: 'center', padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: '5px' }}>
              <span style={{ fontFamily: 'monospace', color: '#58a6ff', fontWeight: 700, fontSize: '10px' }}>{c.userId}</span>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ color: '#cdd9e5', fontWeight: 600, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ color: '#8b949e', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.role}</div>
              </div>
              <span style={{ fontFamily: 'monospace', color: '#ffa657', fontSize: '9px' }}>
                {showPasswords ? c.password : '••••••••'}
              </span>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: live?.online ? '#3fb950' : '#444', flexShrink: 0, display: 'inline-block' }} title={live?.online ? live.status : 'offline'} />
            </div>
          );
        })}
      </div>

      {/* Live status */}
      {members.filter(m => m.online).length > 0 && (
        <>
          <div style={{ fontSize: '9px', color: '#58a6ff', fontWeight: 700, letterSpacing: '0.05em', marginTop: '4px' }}>ONLINE NOW</div>
          {members.filter(m => m.online).map(m => (
            <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 6px', background: 'rgba(63,185,80,0.06)', borderRadius: '5px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3fb950', flexShrink: 0, display: 'inline-block' }} />
              <span style={{ flex: 1, fontWeight: 600, color: '#cdd9e5', fontSize: '10px' }}>{m.name}</span>
              <span style={{ color: '#3fb950', fontSize: '9px' }}>{m.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function BuildingDigitalTwin({ onClose }: BuildingDigitalTwinProps) {
  const [viewMode,      setViewMode]      = useState<ViewMode>('3d');
  const [nest3dFloor,   setNest3dFloor]   = useState<NestFloor | null>(null);
  const [activeFloor,   setActiveFloor]   = useState<FloorId>('G');
  const [activeSystem,  setActiveSystem]  = useState<SystemId | null>(null);
  const [incidentSim,   setIncidentSim]   = useState<IncidentSim>(null);
  const [incidentStage, setIncidentStage] = useState(0);
  const [simRunning,    setSimRunning]    = useState(false);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [approvedAI,    setApprovedAI]    = useState(false);
  const [showAIPanel,   setShowAIPanel]   = useState(false);
  const [resolved,      setResolved]      = useState(false);
  const [kpis,          setKpis]          = useState<KPIState>(INITIAL_KPIS);
  const [showBmsTeamMgr, setShowBmsTeamMgr] = useState(false);
  const [showHVACIncident, setShowHVACIncident] = useState(false);

  // ── Auto-advance stages ─────────────────────────────────────────────────
  useEffect(() => {
    if (!incidentSim || incidentStage === 0) return;
    const delays = INCIDENT_DELAYS[incidentSim];
    const idx    = incidentStage - 1;
    if (idx >= delays.length) return;
    const delay = delays[idx];
    if (delay === 0) return; // manual step
    const t = setTimeout(() => setIncidentStage((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [incidentSim, incidentStage]);

  // ── Show AI advisory panel at the approval step ─────────────────────────
  useEffect(() => {
    if (!incidentSim) return;
    const delays = INCIDENT_DELAYS[incidentSim];
    const idx    = incidentStage - 1;
    if (idx >= 0 && idx < delays.length && delays[idx] === 0 && !approvedAI) {
      setShowAIPanel(true);
    }
  }, [incidentSim, incidentStage, approvedAI]);

  // ── Adjust KPIs based on incident ───────────────────────────────────────
  useEffect(() => {
    if (!incidentSim || incidentStage === 0) { setKpis(INITIAL_KPIS); return; }
    setKpis(() => {
      if (incidentSim === 'fire') return {
        powerLoad:      Math.min(INITIAL_KPIS.powerLoad + incidentStage * 2, 94),
        hvacEfficiency: incidentStage >= 6 ? 0 : INITIAL_KPIS.hvacEfficiency,
        temperature:    Math.min(INITIAL_KPIS.temperature + incidentStage * 2.2, 42),
        occupancy:      incidentStage >= 5 ? Math.max(INITIAL_KPIS.occupancy - 40, 10) : INITIAL_KPIS.occupancy,
        waterLevel:     INITIAL_KPIS.waterLevel,
      };
      if (incidentSim === 'hvac') return {
        ...INITIAL_KPIS,
        hvacEfficiency: Math.max(INITIAL_KPIS.hvacEfficiency - incidentStage * 14, 10),
        temperature:    Math.min(INITIAL_KPIS.temperature + incidentStage * 1.3, 32),
      };
      if (incidentSim === 'power') return {
        ...INITIAL_KPIS,
        powerLoad: Math.min(94 + incidentStage * 0.8, 98),
      };
      if (incidentSim === 'occupancy') return {
        ...INITIAL_KPIS,
        occupancy: Math.min(INITIAL_KPIS.occupancy + incidentStage * 6, 148),
      };
      if (incidentSim === 'energy') return {
        ...INITIAL_KPIS,
        powerLoad:      Math.max(INITIAL_KPIS.powerLoad - incidentStage * 5, 32),
        hvacEfficiency: Math.min(INITIAL_KPIS.hvacEfficiency + incidentStage * 2, 98),
      };
      return INITIAL_KPIS;
    });
  }, [incidentSim, incidentStage]);

  // ── Seed notifications at stage 8 for fire ──────────────────────────────
  useEffect(() => {
    if (incidentSim !== 'fire' || incidentStage !== 8) return;
    const now = Date.now();
    setNotifications([
      { id: 'n1', agency: 'Dubai Civil Defence', icon: '🚒', status: 'sending', sentAt: now },
      { id: 'n2', agency: 'Building Security',   icon: '🛡️', status: 'sending', sentAt: now },
      { id: 'n3', agency: 'Facility Manager',    icon: '🏢', status: 'sending', sentAt: now },
    ]);
  }, [incidentSim, incidentStage]);

  // ── Seed notifications for HVAC at stage 5 ──────────────────────────────
  useEffect(() => {
    if (incidentSim !== 'hvac' || incidentStage !== 5) return;
    const now = Date.now();
    setNotifications([
      { id: 'n1', agency: 'HVAC Technician', icon: '🔧', status: 'sending', sentAt: now },
      { id: 'n2', agency: 'Facility Manager', icon: '🏢', status: 'sending', sentAt: now },
    ]);
  }, [incidentSim, incidentStage]);

  // ── Seed notifications for power at stage 5 ─────────────────────────────
  useEffect(() => {
    if (incidentSim !== 'power' || incidentStage !== 5) return;
    const now = Date.now();
    setNotifications([
      { id: 'n1', agency: 'Electrical Technician', icon: '⚡', status: 'sending', sentAt: now },
      { id: 'n2', agency: 'Building Manager',       icon: '🏢', status: 'sending', sentAt: now },
    ]);
  }, [incidentSim, incidentStage]);

  // ── Seed notifications for occupancy at stage 5 ──────────────────────────
  useEffect(() => {
    if (incidentSim !== 'occupancy' || incidentStage !== 5) return;
    const now = Date.now();
    setNotifications([
      { id: 'n1', agency: 'Security Team',     icon: '🛡️', status: 'sending', sentAt: now },
      { id: 'n2', agency: 'Facility Manager',  icon: '🏢', status: 'sending', sentAt: now },
    ]);
  }, [incidentSim, incidentStage]);

  // ── Seed notifications for energy at stage 4 ─────────────────────────────
  useEffect(() => {
    if (incidentSim !== 'energy' || incidentStage !== 4) return;
    const now = Date.now();
    setNotifications([
      { id: 'n1', agency: 'BMS Controller',    icon: '🤖', status: 'sending', sentAt: now },
      { id: 'n2', agency: 'Facility Manager',  icon: '🏢', status: 'sending', sentAt: now },
    ]);
  }, [incidentSim, incidentStage]);

  // ── Auto-progress notifications ─────────────────────────────────────────
  useEffect(() => {
    if (notifications.length === 0) return;
    const PROG: NotifItem['status'][] = ['sending', 'sent', 'delivered', 'accepted', 'en_route'];
    const THRESH = [0, 2, 5, 9, 14];
    const timer  = setInterval(() => {
      const now = Date.now();
      setNotifications((prev) => {
        let changed = false;
        const next = prev.map((n) => {
          if (n.status === 'en_route') return n;
          const elapsed  = (now - n.sentAt) / 1000;
          const curIdx   = PROG.indexOf(n.status);
          const nextIdx  = curIdx + 1;
          if (nextIdx < PROG.length && elapsed > THRESH[nextIdx]) {
            changed = true;
            return { ...n, status: PROG[nextIdx] };
          }
          return n;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [notifications.length]);

  // ── Trigger incident ─────────────────────────────────────────────────────
  const triggerIncident = useCallback((type: NonNullable<IncidentSim>) => {
    if (simRunning) return;
    setSimRunning(true);
    setIncidentSim(type);
    setIncidentStage(1);
    setApprovedAI(false);
    setShowAIPanel(false);
    setNotifications([]);
    setResolved(false);
    if (type === 'fire' || type === 'power') setActiveFloor('G');
    if (type === 'hvac')  setActiveFloor('F3');
    if (type === 'occupancy') setActiveFloor('F1');
    if (type === 'energy')    setActiveFloor('G');
    if (type === 'fire')      setActiveSystem('fire');
    if (type === 'hvac')      setActiveSystem('hvac');
    if (type === 'power')     setActiveSystem('power');
    if (type === 'occupancy') setActiveSystem('occupancy');
    if (type === 'energy')    setActiveSystem('lighting');
    setTimeout(() => setSimRunning(false), 400);
  }, [simRunning]);

  const approveAIPlan = () => {
    setApprovedAI(true);
    setShowAIPanel(false);
    setIncidentStage((s) => s + 1);
  };

  const resolveIncident = () => {
    setResolved(true);
    setKpis(INITIAL_KPIS);
    setTimeout(() => {
      setIncidentSim(null);
      setIncidentStage(0);
      setNotifications([]);
      setResolved(false);
      setApprovedAI(false);
      setActiveSystem(null);
    }, 3000);
  };

  const resetAll = () => {
    setIncidentSim(null);
    setIncidentStage(0);
    setNotifications([]);
    setApprovedAI(false);
    setShowAIPanel(false);
    setSimRunning(false);
    setResolved(false);
    setKpis(INITIAL_KPIS);
    setActiveSystem(null);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const stages      = incidentSim ? INCIDENT_STAGES[incidentSim] : [];
  const totalStages = stages.length;
  const isLastStage = incidentStage > 0 && incidentStage >= totalStages;
  const advisory    = incidentSim ? AI_ADVISORIES[incidentSim] : null;
  const rooms       = ROOMS[activeFloor];

  const SYS_COLORS: Record<SystemId, string> = {
    power: '#60a5fa', hvac: '#34d399', fire: '#ef4444',
    lighting: '#fbbf24', water: '#818cf8', occupancy: '#a78bfa',
  };

  const NOTIF_LABEL: Record<NotifItem['status'], string> = {
    sending: 'Sending…', sent: 'Sent', delivered: 'Delivered',
    accepted: 'Accepted', en_route: 'En Route ✓',
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="bdt">

      {/* ═══ HEADER ════════════════════════════════════════════════════════ */}
      <div className="bdt__header">
        <div className="bdt__header-left">
          <span className="bdt__header-icon">🏢</span>
          <div>
            <div className="bdt__header-title">Schneider Electric Office · DSO</div>
            <div className="bdt__header-sub">Dubai Silicon Oasis · Smart Building Digital Twin · EcoStruxure™ Platform</div>
          </div>
        </div>
        <div className="bdt__header-center">
          <span className={`bdt__badge ${incidentSim ? 'bdt__badge--alert' : 'bdt__badge--live'}`}>
            <span className="bdt__badge-dot" />
            {incidentSim ? `${incidentSim.toUpperCase()} INCIDENT` : 'LIVE MONITORING'}
          </span>
          <span className="bdt__badge bdt__badge--info">3 Floors · 12,400 m²</span>
          <span className="bdt__badge bdt__badge--info">BMS v3.4 · Online</span>
        </div>
        <div className="bdt__header-right">
          <div className="bdt__view-toggle">
            <button
              className={`bdt__view-btn ${viewMode === '3d' ? 'bdt__view-btn--active' : ''}`}
              onClick={() => setViewMode('3d')}>🧊 3D Model</button>
            <button
              className={`bdt__view-btn ${viewMode === 'floor' ? 'bdt__view-btn--active' : ''}`}
              onClick={() => setViewMode('floor')}>🏗 Floor Plan</button>
            <button
              className={`bdt__view-btn ${viewMode === 'system' ? 'bdt__view-btn--active' : ''}`}
              onClick={() => setViewMode('system')}>⚙ Schematic</button>
            <button
              className={`bdt__view-btn ${viewMode === 'walk' ? 'bdt__view-btn--active' : ''}`}
              onClick={() => setViewMode('walk')}>🚶 Walk</button>
          </div>
          <button className="bdt__close" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {/* ═══ BODY ══════════════════════════════════════════════════════════ */}
      <div className="bdt__body">

        {/* ── LEFT PANEL ──────────────────────────────────────────────── */}
        <div className="bdt__left">

          {/* Subsystems */}
          <div className="bdt__section-label">BUILDING SYSTEMS</div>
          <div className="bdt__subsystems">
            {([
              ['power',     '🔌', 'Power & UPS'],
              ['hvac',      '🌡', 'HVAC & Cooling'],
              ['fire',      '🔥', 'Fire Safety'],
              ['lighting',  '💡', 'Smart Lighting'],
              ['water',     '🚰', 'Water Management'],
              ['occupancy', '👤', 'Access & Occupancy'],
            ] as [SystemId, string, string][]).map(([id, icon, label]) => {
              const hasAlert =
                (incidentSim === 'fire'      && id === 'fire'      && incidentStage > 0) ||
                (incidentSim === 'hvac'      && id === 'hvac'      && incidentStage > 0) ||
                (incidentSim === 'power'     && id === 'power'     && incidentStage > 0) ||
                (incidentSim === 'occupancy' && id === 'occupancy' && incidentStage > 0);
              return (
                <button
                  key={id}
                  className={`bdt__sys-btn bdt__sys-btn--${id} ${activeSystem === id ? 'bdt__sys-btn--active' : ''} ${hasAlert ? 'bdt__sys-btn--alert' : ''}`}
                  onClick={() => {
                    setActiveSystem((prev) => prev === id ? null : id);
                    if (id === 'hvac') { setViewMode('system'); setActiveSystem('hvac'); }
                  }}
                >
                  <span className="bdt__sys-icon">{icon}</span>
                  <span className="bdt__sys-label">{label}</span>
                  {hasAlert && <span className="bdt__sys-alert-dot" />}
                </button>
              );
            })}
          </div>

          {/* KPIs */}
          <div className="bdt__section-label" style={{ marginTop: 18 }}>LIVE KPIs</div>
          <div className="bdt__kpis">
            <KPICard label="Power Load"      value={kpis.powerLoad}      unit="%" color={kpis.powerLoad > 85 ? '#ef4444' : '#60a5fa'} max={100} />
            <KPICard label="HVAC Effic."     value={kpis.hvacEfficiency} unit="%" color={kpis.hvacEfficiency < 40 ? '#fb923c' : '#34d399'} max={100} />
            <KPICard label="Temperature"     value={kpis.temperature}    unit="°" color={kpis.temperature > 30 ? '#ef4444' : kpis.temperature > 26 ? '#fb923c' : '#34d399'} max={50} />
            <KPICard label="Occupancy"       value={kpis.occupancy}      unit="%" color="#a78bfa" max={100} />
            <KPICard label="Water Level"     value={kpis.waterLevel}     unit="%" color="#818cf8" max={100} />
          </div>

          {/* Simulate */}
          <div className="bdt__section-label" style={{ marginTop: 18 }}>SIMULATE</div>
          <div className="bdt__simulate">
            <button
              className={`bdt__sim-btn bdt__sim-btn--fire ${incidentSim === 'fire' ? 'bdt__sim-btn--active' : ''}`}
              onClick={() => triggerIncident('fire')}
              disabled={simRunning || (incidentSim !== null && incidentSim !== 'fire')}
            >🔥 Fire Incident</button>
            <button
              className={`bdt__sim-btn bdt__sim-btn--hvac ${incidentSim === 'hvac' ? 'bdt__sim-btn--active' : ''}`}
              onClick={() => { triggerIncident('hvac'); setViewMode('system'); }}
              disabled={simRunning || (incidentSim !== null && incidentSim !== 'hvac')}
            >🌡 HVAC Failure</button>
            <button
              className={`bdt__sim-btn bdt__sim-btn--power ${incidentSim === 'power' ? 'bdt__sim-btn--active' : ''}`}
              onClick={() => triggerIncident('power')}
              disabled={simRunning || (incidentSim !== null && incidentSim !== 'power')}
            >⚡ Power Overload</button>
            {/* <button
              className={`bdt__sim-btn bdt__sim-btn--occupancy ${incidentSim === 'occupancy' ? 'bdt__sim-btn--active' : ''}`}
              onClick={() => triggerIncident('occupancy')}
              disabled={simRunning || (incidentSim !== null && incidentSim !== 'occupancy')}
            >👥 Occupancy Alert</button> */}
            <button
              className={`bdt__sim-btn bdt__sim-btn--energy ${incidentSim === 'energy' ? 'bdt__sim-btn--active' : ''}`}
              onClick={() => triggerIncident('energy')}
              disabled={simRunning || (incidentSim !== null && incidentSim !== 'energy')}
            >🌍 Energy Optimize</button>
            {incidentSim && (
              <button className="bdt__sim-btn bdt__sim-btn--reset" onClick={resetAll}>↺ Reset</button>
            )}
          </div>

          {/* AI Energy Insight */}
          <div className="bdt__energy-insight">
            <div className="bdt__energy-top">🌍 AI Energy Insight</div>
            <div className="bdt__energy-body">F1–F2 unoccupied zones detected. HVAC setback can reduce load ~18% saving est. 280 kWh/day.</div>
          </div>

          {/* BMS Team Management */}
          <div className="bdt__section-label" style={{ marginTop: 18 }}>
            BMS TEAM
            <button
              onClick={() => setShowBmsTeamMgr(v => !v)}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8b949e', borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
            >
              {showBmsTeamMgr ? '✕' : '⚙ Manage'}
            </button>
          </div>
          {showBmsTeamMgr && (
            <BMSTeamPanel />
          )}

        </div>

        {/* ── CENTER ──────────────────────────────────────────────────── */}
        <div className="bdt__center">
          {viewMode === 'floor' ? (
            <>
              {/* Floor tabs */}
              <div className="bdt__floor-tabs">
                {FLOORS.map((f) => (
                  <button
                    key={f.id}
                    className={`bdt__floor-tab ${activeFloor === f.id ? 'bdt__floor-tab--active' : ''}`}
                    onClick={() => setActiveFloor(f.id)}
                  >{f.label}</button>
                ))}
              </div>

              {/* SVG Floor plan */}
              <div className="bdt__floor-wrapper">
                <svg viewBox="0 0 314 200" className="bdt__floor-svg" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="fgrid" width="16" height="16" patternUnits="userSpaceOnUse">
                      <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(96,165,250,0.055)" strokeWidth="0.4" />
                    </pattern>
                    <filter id="fglow-r">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                    <filter id="fglow-o">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                    <filter id="fglow-y">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>
                  <rect width="314" height="200" fill="rgba(8,12,22,0.97)" rx="4" />
                  <rect width="314" height="200" fill="url(#fgrid)" rx="4" />
                  <rect x="1.5" y="1.5" width="311" height="197" fill="none" stroke="rgba(0,229,255,0.15)" strokeWidth="1" rx="3" />

                  {/* Rooms */}
                  {rooms.map((room) => {
                    const isFire  = incidentSim === 'fire'  && incidentStage >= 1 && room.id === 'server';
                    const isHvac  = incidentSim === 'hvac'  && incidentStage >= 1 && room.id === 'hvac_room';
                    const isPower = incidentSim === 'power' && incidentStage >= 1 && room.id === 'elec';
                    const sysMatch = activeSystem && room.systems.includes(activeSystem);

                    let fill   = room.people > 0 ? 'rgba(22,30,52,0.9)' : 'rgba(14,19,34,0.95)';
                    let stroke = room.people > 0 ? 'rgba(80,100,150,0.55)' : 'rgba(50,65,100,0.4)';
                    let sw     = 0.8;

                    if (sysMatch) {
                      const sysColors: Record<SystemId, [string, string]> = {
                        power: ['rgba(96,165,250,0.16)','rgba(96,165,250,0.7)'],
                        hvac:  ['rgba(52,211,153,0.16)','rgba(52,211,153,0.7)'],
                        fire:  ['rgba(239,68,68,0.16)','rgba(239,68,68,0.7)'],
                        lighting: ['rgba(251,191,36,0.16)','rgba(251,191,36,0.7)'],
                        water: ['rgba(129,140,248,0.16)','rgba(129,140,248,0.7)'],
                        occupancy: ['rgba(167,139,250,0.16)','rgba(167,139,250,0.7)'],
                      };
                      [fill, stroke] = sysColors[activeSystem!]; sw = 1.3;
                    }
                    if (isFire)  { fill = 'rgba(239,68,68,0.28)';  stroke = '#ef4444'; sw = 1.8; }
                    if (isHvac)  { fill = 'rgba(251,146,60,0.28)'; stroke = '#fb923c'; sw = 1.8; }
                    if (isPower) { fill = 'rgba(250,204,21,0.24)'; stroke = '#facc15'; sw = 1.8; }

                    const cx = room.x + room.w / 2;
                    const cy = room.y + room.h / 2;
                    const small = room.w < 72 || room.h < 52;
                    const alertFilter = isFire ? 'url(#fglow-r)' : isHvac ? 'url(#fglow-o)' : isPower ? 'url(#fglow-y)' : undefined;

                    return (
                      <g key={room.id}
                        className={`bdt__room-g${isFire ? ' bdt__room-g--fire' : isHvac ? ' bdt__room-g--hvac' : isPower ? ' bdt__room-g--power' : ''}`}>
                        <rect x={room.x} y={room.y} width={room.w} height={room.h}
                          fill={fill} stroke={stroke} strokeWidth={sw} rx="2"
                          filter={alertFilter} />
                        {/* Pulsing alert ring */}
                        {(isFire || isHvac || isPower) && (
                          <rect x={room.x} y={room.y} width={room.w} height={room.h}
                            fill="none"
                            stroke={isFire ? '#ef4444' : isHvac ? '#fb923c' : '#facc15'}
                            strokeWidth="2" rx="2" opacity="0.5"
                            className="bdt__alert-ring" />
                        )}
                        {/* Room name */}
                        <text x={cx} y={small ? cy : cy - (room.people > 0 ? 7 : 0)}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={small ? 6.5 : 8}
                          fill={(isFire || isHvac || isPower) ? '#fff' : sysMatch ? '#e2e8f0' : '#8896b3'}
                          fontWeight={(isFire || isHvac || isPower || sysMatch) ? '600' : '400'}
                          fontFamily="Inter,system-ui,sans-serif">
                          {room.name}
                        </text>
                        {/* Occupancy */}
                        {room.people > 0 && !small && (
                          <text x={cx} y={cy + 8} textAnchor="middle"
                            fontSize="6.5" fill="rgba(167,139,250,0.75)"
                            fontFamily="Inter,system-ui">
                            👤 {room.people}
                          </text>
                        )}
                        {/* System icon in corner */}
                        {sysMatch && !small && (
                          <text x={room.x + 5} y={room.y + 11} fontSize="8.5" opacity="0.75">
                            {({ power:'⚡', hvac:'❄', fire:'🔥', lighting:'💡', water:'💧', occupancy:'👥' } as Record<SystemId,string>)[activeSystem!]}
                          </text>
                        )}
                        {/* Smoke particles (fire stage 2+) */}
                        {isFire && incidentStage >= 2 && (
                          <>
                            <circle cx={room.x + 18} cy={room.y + 8}  r="5" fill="rgba(120,130,145,0.35)" className="bdt__smoke bdt__smoke--1" />
                            <circle cx={room.x + 44} cy={room.y + 4}  r="6" fill="rgba(120,130,145,0.28)" className="bdt__smoke bdt__smoke--2" />
                            <circle cx={room.x + 70} cy={room.y + 10} r="4" fill="rgba(120,130,145,0.32)" className="bdt__smoke bdt__smoke--3" />
                          </>
                        )}
                      </g>
                    );
                  })}

                  {/* HVAC airflow overlays */}
                  {activeSystem === 'hvac' && HVAC_FLOWS[activeFloor]?.map((d, i) => (
                    <path key={i} d={d} fill="none"
                      stroke={incidentSim === 'hvac' && incidentStage >= 2
                        ? 'rgba(251,146,60,0.4)'
                        : 'rgba(52,211,153,0.4)'}
                      strokeWidth="1.6" strokeDasharray="5,3"
                      className={incidentSim === 'hvac' && incidentStage >= 2 ? undefined : 'bdt__flow-path'} />
                  ))}
                  {/* Water pipe overlays */}
                  {activeSystem === 'water' && WATER_PIPES[activeFloor]?.map((d, i) => (
                    <path key={i} d={d} fill="none"
                      stroke="rgba(129,140,248,0.5)"
                      strokeWidth="2" strokeDasharray="6,4"
                      className="bdt__flow-path" />
                  ))}
                </svg>

                {/* Incident stage overlay badge */}
                {incidentSim && incidentStage >= 1 && (
                  <div className={`bdt__floor-badge bdt__floor-badge--${incidentSim}`}>
                    {incidentSim === 'fire' ? '🔥' : incidentSim === 'hvac' ? '🌡' : '⚡'}
                    {' '}{stages[incidentStage - 1] ?? 'Monitoring…'}
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="bdt__floor-legend">
                <span className="bdt__leg"><span className="bdt__leg-dot" style={{ background: '#3b4a6b' }} />Unoccupied</span>
                <span className="bdt__leg"><span className="bdt__leg-dot" style={{ background: '#a78bfa' }} />Occupied</span>
                {incidentSim === 'fire'  && <span className="bdt__leg"><span className="bdt__leg-dot bdt__leg-dot--pulse" style={{ background: '#ef4444' }} />Fire Alert</span>}
                {incidentSim === 'hvac'  && <span className="bdt__leg"><span className="bdt__leg-dot bdt__leg-dot--pulse" style={{ background: '#fb923c' }} />HVAC Alert</span>}
                {incidentSim === 'power' && <span className="bdt__leg"><span className="bdt__leg-dot bdt__leg-dot--pulse" style={{ background: '#facc15' }} />Power Alert</span>}
                {activeSystem && <span className="bdt__leg"><span className="bdt__leg-dot" style={{ background: SYS_COLORS[activeSystem] }} />{activeSystem.charAt(0).toUpperCase() + activeSystem.slice(1)} System</span>}
              </div>
            </>
          ) : viewMode === 'walk' ? (
            <div className="bdt__3d-wrapper bdt__walk-wrapper">
              <NestBuilding3D
                selectedFloor={null}
                incidentSim={incidentSim as NestIncident}
                incidentStage={incidentStage}
                walkMode={true}
                onFloorClick={() => {}}
                onRoomClick={(roomId) => console.log('Walk room click:', roomId)}
              />
            </div>
          ) : viewMode === 'system' ? (
            <div className="bdt__schematic-wrapper">
              {(activeSystem === 'hvac' || incidentSim === 'hvac') ? (
                <>
                  <HVACSchematicPanel incidentSim={incidentSim} incidentStage={incidentStage} />
                  {incidentSim === 'hvac' && (
                    <button
                      className="bdt__sop-float-btn"
                      onClick={() => setShowHVACIncident(true)}
                      title="Create SOP and resolve step-by-step"
                    >📋 Create SOP &amp; Resolve</button>
                  )}
                </>
              ) : (
                <SystemSchematic
                  activeSystem={activeSystem}
                  incidentSim={incidentSim}
                  incidentStage={incidentStage}
                />
              )}
            </div>
          ) : (
            <div className="bdt__3d-wrapper" style={{ position: 'relative' }}>
              <NestBuilding3D
                selectedFloor={nest3dFloor}
                incidentSim={incidentSim as NestIncident}
                incidentStage={incidentStage}
                activeSystem={activeSystem}
                onFloorClick={(f) => setNest3dFloor((prev) => prev === f ? null : f)}
                onRoomClick={(roomId) => console.log('Room clicked:', roomId)}
              />
              {incidentSim === 'hvac' && (
                <button
                  className="bdt__sop-float-btn"
                  onClick={() => setShowHVACIncident(true)}
                  title="Create SOP and resolve step-by-step"
                >📋 Create SOP &amp; Resolve</button>
              )}
              {/* Floor selector overlay */}
              {/* <div className="bdt__3d-floor-pills">
                {(['F1','F2','F3','F4'] as NestFloor[]).map((f) => (
                  <button
                    key={f}
                    className={`bdt__3d-pill ${nest3dFloor === f ? 'bdt__3d-pill--active' : ''}`}
                    onClick={() => setNest3dFloor((prev) => prev === f ? null : f)}
                  >
                    {f === 'F1' ? '① Ground' : f === 'F2' ? '② Offices' : f === 'F3' ? '③ Executive' : '④ Data Center'}
                  </button>
                ))}
                {nest3dFloor && (
                  <button className="bdt__3d-pill bdt__3d-pill--reset" onClick={() => setNest3dFloor(null)}>All Floors</button>
                )}
              </div> */}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────────────── */}
        <div className="bdt__right">
          <div className="bdt__right-header">
            <span className="bdt__right-title">🎛 BUILDING CONTROL</span>
            {incidentSim && (
              <span className={`bdt__right-badge bdt__right-badge--${incidentSim}`}>
                {incidentSim === 'fire' ? '🔥' : incidentSim === 'hvac' ? '🌡' : '⚡'} INCIDENT
              </span>
            )}
          </div>

          {/* ── Workflow ── */}
          {incidentSim && incidentSim !== 'hvac' && incidentStage > 0 && (
            <div className="bdt__workflow">
              <div className="bdt__wf-title">RESPONSE WORKFLOW</div>
              <div className="bdt__wf-steps">
                {stages.map((label, i) => {
                  const idx    = i + 1;
                  const done   = incidentStage > idx;
                  const active = incidentStage === idx;
                  return (
                    <div key={i} className={`bdt__wf-step${done ? ' bdt__wf-step--done' : active ? ' bdt__wf-step--active' : ''}`}>
                      <div className="bdt__wf-dot">{done ? '✓' : idx}</div>
                      <div className="bdt__wf-label">{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── AI Advisory (pending approval) ── */}
          {incidentSim !== 'hvac' && showAIPanel && !approvedAI && advisory && (
            <div className="bdt__advisory">
              <div className={`bdt__adv-badge bdt__adv-badge--${advisory.riskLevel.toLowerCase()}`}>
                🤖 AI ADVISORY — {advisory.riskLevel}
              </div>
              <div className="bdt__adv-actions">
                {advisory.actions.map((a, i) => (
                  <div key={i} className="bdt__adv-action">{i + 1}. {a}</div>
                ))}
              </div>
              <div className="bdt__adv-note">{advisory.note}</div>
              <div className="bdt__adv-btns">
                <button className="bdt__approve-btn" onClick={approveAIPlan}>✅ Approve & Execute</button>
                <button className="bdt__modify-btn"  onClick={approveAIPlan}>✏ Modify Plan</button>
              </div>
            </div>
          )}

          {/* ── Approved advisory ── */}
          {incidentSim !== 'hvac' && approvedAI && advisory && (
            <div className="bdt__advisory bdt__advisory--approved">
              <div className="bdt__adv-badge bdt__adv-badge--approved">✅ AI PLAN APPROVED & EXECUTING</div>
              <div className="bdt__adv-actions">
                {advisory.actions.slice(0, 3).map((a, i) => (
                  <div key={i} className="bdt__adv-action bdt__adv-action--done">{i + 1}. {a}</div>
                ))}
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {incidentSim !== 'hvac' && notifications.length > 0 && (
            <div className="bdt__notifications">
              <div className="bdt__wf-title">NOTIFICATIONS</div>
              {notifications.map((n) => (
                <div key={n.id} className="bdt__notif">
                  <span className="bdt__notif-icon">{n.icon}</span>
                  <div className="bdt__notif-body">
                    <div className="bdt__notif-agency">{n.agency}</div>
                    <div className={`bdt__notif-status bdt__notif-status--${n.status}`}>
                      {NOTIF_LABEL[n.status]}
                    </div>
                  </div>
                  <div className="bdt__notif-bar">
                    <div className={`bdt__notif-fill bdt__notif-fill--${n.status}`} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Resolve button ── */}
          {incidentSim !== 'hvac' && isLastStage && !resolved && (
            <button className="bdt__resolve-btn" onClick={resolveIncident}>✅ Mark Incident Resolved</button>
          )}
          {incidentSim !== 'hvac' && resolved && (
            <div className="bdt__resolved">🟢 INCIDENT RESOLVED — Systems Normalizing…</div>
          )}
          {/* ── HVAC: prompt to use SOP panel ── */}
          {incidentSim === 'hvac' && (
            <div className="bdt__health" style={{ textAlign: 'center', padding: '20px 12px' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🌡️</div>
              <div style={{ color: '#34d399', fontWeight: 700, fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>HVAC FAULT DETECTED</div>
              <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5, marginBottom: 14 }}>AHU-01 airflow at 38% capacity. Use the SOP panel in the 3D or HVAC view to create and execute a resolution plan.</div>
              <button
                className="bdt__sop-float-btn"
                style={{ position: 'static', width: '100%', justifyContent: 'center', fontSize: 11 }}
                onClick={() => setShowHVACIncident(true)}
              >📋 Create SOP &amp; Resolve</button>
            </div>
          )}

          {/* ── Idle system health ── */}
          {!incidentSim && (
            <div className="bdt__health">
              <div className="bdt__wf-title">SYSTEM HEALTH</div>
              {([
                ['Power',    '🔌', '#60a5fa', 'All LV/MV panels nominal'],
                ['HVAC',     '🌡', '#34d399', 'All AHUs at full speed'],
                ['Fire',     '🔥', '#4ade80', '28/28 sensors active — No alarm'],
                ['Lighting', '💡', '#fbbf24', 'Auto-dim active — saving 22%'],
                ['Water',    '💧', '#818cf8', 'Tank 78% — Pumps OK'],
                ['Access',   '👤', '#a78bfa', '154 active badges on site'],
              ] as [string, string, string, string][]).map(([name, icon, color, status]) => (
                <div key={name} className="bdt__health-row">
                  <span className="bdt__health-icon">{icon}</span>
                  <div className="bdt__health-body">
                    <div className="bdt__health-name">{name}</div>
                    <div className="bdt__health-status" style={{ color }}>{status}</div>
                  </div>
                  <span className="bdt__health-dot" style={{ background: color }} />
                </div>
              ))}
              <div style={{ marginTop: 16 }}>
                <div className="bdt__wf-title">ACTIVE ALERTS</div>
                <div className="bdt__no-alerts">
                  <span>✅</span>
                  <div>
                    <div>No active alerts</div>
                    <div className="bdt__no-alerts-sub">All systems operational</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ HVAC INCIDENT RESPONSE PANEL ═══════════════════════════════════ */}
      {showHVACIncident && (
        <HVACIncidentPanel
          onClose={() => setShowHVACIncident(false)}
          onResolve={() => { resetAll(); setShowHVACIncident(false); }}
        />
      )}
    </div>
  );
}
