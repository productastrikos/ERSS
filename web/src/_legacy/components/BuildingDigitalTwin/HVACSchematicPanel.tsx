/**
 * HVACSchematicPanel — Complete HVAC system schematic for The NEST building
 *
 * Includes:
 * - Full building HVAC architecture (clickable SVG)
 * - AHU-01 fault drilldown (internal schematic/wired-line view)
 * - Component tree sidebar
 * - Live status indicators with animated flow
 */

import { useState, useEffect } from 'react';
import './HVACSchematicPanel.scss';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ComponentStatus = 'running' | 'standby' | 'fault' | 'off' | 'ok' | 'online';

interface HVACComponent {
  id:      string;
  name:    string;
  status:  ComponentStatus;
  floor:   string;
  value?:  string;
  sub?:    string;
  fault?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HVAC Component Registry
// ─────────────────────────────────────────────────────────────────────────────
const HVAC_COMPONENTS: Record<string, HVACComponent> = {
  ct1:       { id: 'ct1',       name: 'Cooling Tower 1',    status: 'running',  floor: 'F3 Roof', value: '38°C EWT' },
  ct2:       { id: 'ct2',       name: 'Cooling Tower 2',    status: 'standby',  floor: 'F3 Roof', value: 'Standby' },
  ch1:       { id: 'ch1',       name: 'Chiller 1',          status: 'running',  floor: 'F3 Roof', value: '450 kW', sub: 'COP 5.2' },
  ch2:       { id: 'ch2',       name: 'Chiller 2',          status: 'standby',  floor: 'F3 Roof', value: '380 kW', sub: 'Standby' },
  cwp_a:     { id: 'cwp_a',     name: 'CW Pump A',          status: 'running',  floor: 'B1',      value: '35 L/s' },
  cwp_b:     { id: 'cwp_b',     name: 'CW Pump B',          status: 'standby',  floor: 'B1',      value: 'Standby' },
  chwp_a:    { id: 'chwp_a',    name: 'CHW Pump A',         status: 'running',  floor: 'B1',      value: '45 L/s' },
  chwp_b:    { id: 'chwp_b',    name: 'CHW Pump B',         status: 'standby',  floor: 'B1',      value: 'Standby' },
  buf_tank:  { id: 'buf_tank',  name: 'Buffer Tank',        status: 'ok',       floor: 'B1',      value: '2000 L',  sub: '6.2°C' },
  ahu01:     { id: 'ahu01',     name: 'AHU-01',             status: 'fault',    floor: 'F3 Roof', value: '0% airflow', sub: 'G + F1', fault: 'Supply fan bearing seized — Motor current: 0A — Vibration: 12.4 mm/s (alarm: 7)' },
  ahu02:     { id: 'ahu02',     name: 'AHU-02',             status: 'running',  floor: 'F3 Roof', value: '9500 CFM', sub: 'F2 + F3' },
  vav_lobby: { id: 'vav_lobby', name: 'VAV · Lobby',        status: 'fault',    floor: 'G',       value: '26.1°C ↑', fault: 'AHU-01 starved — no supply air' },
  vav_cafe:  { id: 'vav_cafe',  name: 'VAV · Cafeteria',    status: 'fault',    floor: 'G',       value: '27.4°C ↑', fault: 'AHU-01 starved — no supply air' },
  vav_f1a:   { id: 'vav_f1a',  name: 'VAV · Office F1-A',  status: 'fault',    floor: 'F1',      value: '28.3°C ↑', fault: 'AHU-01 starved — no supply air' },
  vav_f1b:   { id: 'vav_f1b',  name: 'VAV · Office F1-B',  status: 'fault',    floor: 'F1',      value: '27.9°C ↑', fault: 'AHU-01 starved — no supply air' },
  vav_f2:    { id: 'vav_f2',   name: 'VAV · F2 Offices',   status: 'running',  floor: 'F2',      value: '22.3°C ✓' },
  vav_f3:    { id: 'vav_f3',   name: 'VAV · F3 / Server',  status: 'running',  floor: 'F3',      value: '21.8°C ✓' },
  bms:       { id: 'bms',       name: 'BMS DDC',            status: 'online',   floor: 'F3-BMS',  value: 'Schneider SE8600', sub: 'ALARM ACTIVE' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<ComponentStatus, string> = {
  running: '#34d399',
  standby: '#6b7280',
  fault:   '#ef4444',
  off:     '#374151',
  ok:      '#34d399',
  online:  '#60a5fa',
};
const STATUS_LABEL: Record<ComponentStatus, string> = {
  running: 'RUNNING',
  standby: 'STANDBY',
  fault:   '⚠ FAULT',
  off:     'OFF',
  ok:      'OK',
  online:  'ONLINE',
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — SVG Schematic Primitives
// ─────────────────────────────────────────────────────────────────────────────
function SBox({ x, y, w, h, label, sub, status, onClick, pulse = false }:
  { x: number; y: number; w: number; h: number; label: string; sub?: string;
    status: ComponentStatus; onClick?: () => void; pulse?: boolean }) {
  const c = STATUS_COLOR[status];
  const isAlert = status === 'fault';
  return (
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <rect x={x} y={y} width={w} height={h} rx="4"
        fill={isAlert ? 'rgba(239,68,68,0.12)' : 'rgba(10,18,36,0.92)'}
        stroke={c} strokeWidth={isAlert ? 2 : 1}
        className={pulse ? 'hvac-box-pulse' : undefined} />
      {onClick && isAlert && (
        <rect x={x+2} y={y+2} width={w-4} height={h-4} rx="3"
          fill="none" stroke="rgba(255,100,100,0.3)" strokeWidth="1"
          className="hvac-box-inner-pulse" />
      )}
      <text x={x + w / 2} y={sub ? y + h / 2 - 7 : y + h / 2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="8.5" fontWeight="700" fill={c} fontFamily="Inter,system-ui">{label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 7}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="7" fill="rgba(156,163,175,0.85)" fontFamily="Inter,system-ui">{sub}
        </text>
      )}
      {isAlert && (
        <text x={x + w - 6} y={y + 8}
          textAnchor="middle" dominantBaseline="middle" fontSize="9" className="hvac-warn-blink">⚠</text>
      )}
    </g>
  );
}

function Pipe({ x1, y1, x2, y2, color = 'rgba(52,211,153,0.55)', dashed = false, animated = false }:
  { x1: number; y1: number; x2: number; y2: number;
    color?: string; dashed?: boolean; animated?: boolean }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color} strokeWidth={dashed ? 1.2 : 2}
      strokeDasharray={dashed ? '5,4' : animated ? '8,4' : undefined}
      className={animated ? 'hvac-pipe-flow' : undefined} />
  );
}

function PipeLabel({ x, y, text, color = 'rgba(52,211,153,0.6)' }:
  { x: number; y: number; text: string; color?: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize="7" fill={color}
      fontFamily="Inter,system-ui" fontStyle="italic">{text}
    </text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AHU-01 Internal Drilldown — Wired/Schematic Style
// ─────────────────────────────────────────────────────────────────────────────
function AHU01InternalSchematic({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(id);
  }, []);

  const blink = tick % 2 === 0;

  return (
    <div className="hvac-drilldown">
      <div className="hvac-drilldown__header">
        <div className="hvac-drilldown__title">
          <span className="hvac-drilldown__icon">❄️</span>
          <div>
            <div className="hvac-drilldown__name">AHU-01 — Internal Fault View</div>
            <div className="hvac-drilldown__sub">Air Handling Unit · Rooftop Plant Room F3</div>
          </div>
        </div>
        <button className="hvac-drilldown__close" onClick={onClose}>✕</button>
      </div>

      {/* Fault summary banner */}
      <div className="hvac-drilldown__fault-banner">
        <span style={{ fontSize: 16 }}>⚠</span>
        <div>
          <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>CRITICAL FAULT — Supply Fan Motor</div>
          <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 2 }}>
            Bearing seizure detected · Airflow: 0 CFM · Zone G + F1 unserved · 4 thermal alarms active
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>Alarm triggered</div>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>14 min ago</div>
        </div>
      </div>

      {/* Main internal schematic */}
      <div className="hvac-drilldown__schematic-wrap">
        <svg viewBox="0 0 760 320" className="hvac-drilldown__svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="da" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="rgba(52,211,153,0.7)" />
            </marker>
            <marker id="da-red" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="rgba(239,68,68,0.7)" />
            </marker>
            <filter id="glow-red">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect width="760" height="320" fill="rgba(6,10,20,0.96)" rx="8" />

          {/* ── AHU casing outline ──────────────────────────────── */}
          <rect x="10" y="50" width="740" height="220" rx="6"
            fill="none" stroke="rgba(100,130,160,0.3)" strokeWidth="2" strokeDasharray="8,4" />
          <text x="375" y="40" textAnchor="middle" fontSize="9" fill="rgba(96,165,250,0.5)"
            fontFamily="Inter,system-ui" letterSpacing="1">AHU-01 UNIT CASING — CROSS SECTION (SCHEMATIC)</text>

          {/* ── Outdoor Air intake arrow ─────────────────────────── */}
          <text x="15" y="115" fontSize="8" fill="rgba(96,165,250,0.7)" fontFamily="Inter,system-ui">OUTDOOR AIR</text>
          <text x="15" y="125" fontSize="8" fill="rgba(96,165,250,0.7)" fontFamily="Inter,system-ui">INTAKE</text>
          <line x1="15" y1="160" x2="55" y2="160" stroke="rgba(52,211,153,0.7)" strokeWidth="2" markerEnd="url(#da)" />

          {/* ── Section 1: OA Damper ─────────────────────────────── */}
          <rect x="58" y="90" width="80" height="140" rx="3"
            fill="rgba(15,25,45,0.9)" stroke="rgba(96,165,250,0.4)" strokeWidth="1" />
          <text x="98" y="108" textAnchor="middle" fontSize="8" fill="rgba(96,165,250,0.8)"
            fontFamily="Inter,system-ui" fontWeight="700">OA DAMPER</text>
          {/* Damper blades (open) */}
          {[-25,-12,0,12,25].map((dy, i) => (
            <line key={i} x1="65" y1={160 + dy} x2="132" y2={160 + dy - 8}
              stroke="rgba(96,165,250,0.6)" strokeWidth="2" />
          ))}
          <text x="98" y="235" textAnchor="middle" fontSize="7" fill="rgba(96,165,250,0.5)"
            fontFamily="Inter,system-ui">OPEN 45°</text>
          {/* airflow status */}
          <line x1="138" y1="160" x2="160" y2="160" stroke="rgba(52,211,153,0.6)" strokeWidth="2" markerEnd="url(#da)" />

          {/* ── Section 2: Pre-filter G3 ─────────────────────────── */}
          <rect x="163" y="90" width="70" height="140" rx="3"
            fill="rgba(15,25,45,0.9)" stroke="rgba(52,211,153,0.4)" strokeWidth="1" />
          <text x="198" y="108" textAnchor="middle" fontSize="8" fill="rgba(52,211,153,0.8)"
            fontFamily="Inter,system-ui" fontWeight="700">PRE-FILTER</text>
          <text x="198" y="119" textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.5)"
            fontFamily="Inter,system-ui">G3 grade</text>
          {/* Filter mesh */}
          {[0,8,16,24,32,40,48,56,64,72,80,88,96,104,112,120,128].map((dy) => (
            <line key={dy} x1="170" y1={100 + dy} x2="228" y2={100 + dy}
              stroke="rgba(52,211,153,0.25)" strokeWidth="0.8" />
          ))}
          {[0,8,16,24,32,40,48,56].map((dx) => (
            <line key={dx} x1={170 + dx} y1="100" x2={170 + dx} y2="228"
              stroke="rgba(52,211,153,0.25)" strokeWidth="0.8" />
          ))}
          <text x="198" y="235" textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.6)"
            fontFamily="Inter,system-ui">65% CLEAN</text>
          <line x1="233" y1="160" x2="258" y2="160" stroke="rgba(52,211,153,0.6)" strokeWidth="2" markerEnd="url(#da)" />

          {/* ── Section 3: HEPA F7 ───────────────────────────────── */}
          <rect x="261" y="90" width="70" height="140" rx="3"
            fill="rgba(15,25,45,0.9)" stroke="rgba(52,211,153,0.4)" strokeWidth="1" />
          <text x="296" y="108" textAnchor="middle" fontSize="8" fill="rgba(52,211,153,0.8)"
            fontFamily="Inter,system-ui" fontWeight="700">HEPA F7</text>
          {[0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120,125].map((dy) => (
            <line key={dy} x1="268" y1={100 + dy} x2={260 + 70} y2={100 + dy}
              stroke="rgba(52,211,153,0.2)" strokeWidth="0.6" />
          ))}
          <text x="296" y="235" textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.6)"
            fontFamily="Inter,system-ui">82% CLEAN</text>
          <line x1="331" y1="160" x2="356" y2="160" stroke="rgba(52,211,153,0.6)" strokeWidth="2" markerEnd="url(#da)" />

          {/* ── Section 4: Cooling Coil ──────────────────────────── */}
          <rect x="359" y="90" width="80" height="140" rx="3"
            fill="rgba(15,25,45,0.9)" stroke="rgba(52,211,153,0.4)" strokeWidth="1" />
          <text x="399" y="108" textAnchor="middle" fontSize="8" fill="rgba(52,211,153,0.8)"
            fontFamily="Inter,system-ui" fontWeight="700">COOLING COIL</text>
          <text x="399" y="119" textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.5)"
            fontFamily="Inter,system-ui">CHW 6°C supply</text>
          {/* Coil serpentine */}
          {[0,1,2,3,4,5,6].map(i => (
            <path key={i}
              d={`M ${370 + i * 10} 130 Q ${370 + i * 10 + 5} 155 ${370 + i * 10} 180 Q ${370 + i * 10 - 5} 205 ${370 + i * 10} 220`}
              fill="none" stroke="rgba(52,211,153,0.5)" strokeWidth="1.8" />
          ))}
          <text x="399" y="235" textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.6)"
            fontFamily="Inter,system-ui">ΔT = 6°C</text>
          <line x1="439" y1="160" x2="464" y2="160" stroke="rgba(52,211,153,0.6)" strokeWidth="2" markerEnd="url(#da)" />

          {/* ── Section 5: Supply Fan (FAULT) ────────────────────── */}
          <rect x="467" y="90" width="110" height="140" rx="3"
            fill={blink ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.18)'}
            stroke={blink ? 'rgba(239,68,68,0.6)' : '#ef4444'} strokeWidth={blink ? 1 : 2} />
          <text x="522" y="108" textAnchor="middle" fontSize="8" fill="#ef4444"
            fontFamily="Inter,system-ui" fontWeight="700">SUPPLY FAN</text>
          {/* Fan circle */}
          <circle cx="522" cy="165" r="28" fill="none" stroke="rgba(239,68,68,0.4)" strokeWidth="1.5" />
          <circle cx="522" cy="165" r="4"  fill="rgba(239,68,68,0.6)" />
          {/* Fan blades (stopped — no rotation) */}
          {[0, 60, 120, 180, 240, 300].map(deg => {
            const rad = (deg * Math.PI) / 180;
            const x0 = 522 + 6 * Math.cos(rad), y0 = 165 + 6  * Math.sin(rad);
            const x1 = 522 + 24 * Math.cos(rad + 0.5), y1 = 165 + 24 * Math.sin(rad + 0.5);
            return <line key={deg} x1={x0} y1={y0} x2={x1} y2={y1}
              stroke="rgba(239,68,68,0.6)" strokeWidth="3" strokeLinecap="round" />;
          })}
          {/* FAULT labels */}
          <text x="522" y="203" textAnchor="middle" fontSize="8.5" fill="#ef4444"
            fontFamily="monospace" fontWeight="700">⚠ SEIZED</text>
          <text x="522" y="215" textAnchor="middle" fontSize="7" fill="rgba(239,68,68,0.8)"
            fontFamily="Inter,system-ui">Vibration: 12.4 mm/s</text>
          <text x="522" y="225" textAnchor="middle" fontSize="7" fill="rgba(239,68,68,0.8)"
            fontFamily="Inter,system-ui">Motor I: 0A (stalled)</text>
          {/* No airflow — X mark on output */}
          <line x1="577" y1="155" x2="615" y2="155" stroke="rgba(239,68,68,0.3)"
            strokeWidth="2" strokeDasharray="4,4" />
          <text x="600" y="170" textAnchor="middle" fontSize="16" fill="rgba(239,68,68,0.7)">✕</text>

          {/* ── Supply Air plenum (no flow) ───────────────────────── */}
          <rect x="628" y="90" width="100" height="140" rx="3"
            fill="rgba(15,25,45,0.9)" stroke="rgba(107,114,128,0.4)" strokeWidth="1" strokeDasharray="4,3" />
          <text x="678" y="120" textAnchor="middle" fontSize="8" fill="rgba(107,114,128,0.6)"
            fontFamily="Inter,system-ui" fontWeight="700">SUPPLY AIR</text>
          <text x="678" y="133" textAnchor="middle" fontSize="8" fill="rgba(107,114,128,0.6)"
            fontFamily="Inter,system-ui" fontWeight="700">PLENUM</text>
          <text x="678" y="158" textAnchor="middle" fontSize="10" fill="rgba(239,68,68,0.5)">0 CFM</text>
          <text x="678" y="172" textAnchor="middle" fontSize="7.5" fill="rgba(107,114,128,0.5)"
            fontFamily="Inter,system-ui">(no flow)</text>
          {/* Downstream zone arrows (dashed/faded) */}
          <line x1="728" y1="130" x2="748" y2="120" stroke="rgba(107,114,128,0.25)"
            strokeWidth="1" strokeDasharray="3,3" />
          <text x="752" y="118" fontSize="7" fill="rgba(107,114,128,0.4)"
            fontFamily="Inter,system-ui">→ Lobby 26°C↑</text>
          <line x1="728" y1="160" x2="748" y2="160" stroke="rgba(107,114,128,0.25)"
            strokeWidth="1" strokeDasharray="3,3" />
          <text x="752" y="158" fontSize="7" fill="rgba(107,114,128,0.4)"
            fontFamily="Inter,system-ui">→ Cafe 27°C↑</text>
          <line x1="728" y1="190" x2="748" y2="200" stroke="rgba(107,114,128,0.25)"
            strokeWidth="1" strokeDasharray="3,3" />
          <text x="752" y="198" fontSize="7" fill="rgba(107,114,128,0.4)"
            fontFamily="Inter,system-ui">→ F1 28°C↑</text>

          {/* ── Return air path (bottom) ─────────────────────────── */}
          <text x="375" y="285" textAnchor="middle" fontSize="7.5"
            fill="rgba(96,165,250,0.35)" fontFamily="Inter,system-ui"
            fontStyle="italic">← Return air duct (to mixing box) ←</text>
          <line x1="580" y1="278" x2="120" y2="278"
            stroke="rgba(96,165,250,0.2)" strokeWidth="1.5" strokeDasharray="6,4" />
          <line x1="120" y1="278" x2="120" y2="260"
            stroke="rgba(96,165,250,0.2)" strokeWidth="1.5" strokeDasharray="6,4" />

          {/* ── Fault sensor readings (right side) ───────────────── */}
          <rect x="467" y="268" width="271" height="44" rx="4"
            fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.25)" strokeWidth="1" />
          <text x="480" y="282" fontSize="7.5" fill="rgba(239,68,68,0.8)"
            fontFamily="monospace" fontWeight="700">FAULT LOG  —  AHU-01-FAN-001</text>
          <text x="480" y="294" fontSize="7" fill="rgba(239,68,68,0.6)" fontFamily="monospace">
            {'VIB_ALARM: 12.4mm/s > 7.0mm/s setpt | PHASE_LOSS: 0A | TEMP_SA: 35.2°C (no cooling)'}
          </text>
          <text x="480" y="305" fontSize="7" fill="rgba(239,68,68,0.5)" fontFamily="monospace">
            {'ACTION: Isolate AHU-01 · Dispatch HVAC tech · Transfer load to AHU-02'}
          </text>
        </svg>
      </div>

      {/* Sensor readings grid */}
      <div className="hvac-drilldown__sensors">
        {[
          { label: 'Fan Vibration',   value: '12.4 mm/s', alarm: true,  limit: 'Alarm: 7.0' },
          { label: 'Motor Current',   value: '0.0 A',      alarm: true,  limit: 'Normal: 42A' },
          { label: 'Supply Air Temp', value: '35.2 °C',   alarm: true,  limit: 'Setpt: 14°C' },
          { label: 'Airflow',         value: '0 CFM',      alarm: true,  limit: 'Design: 12000' },
          { label: 'CHW Valve',       value: '72% open',   alarm: false, limit: 'Auto' },
          { label: 'Filter ΔP',       value: '38 Pa',      alarm: false, limit: 'Alarm: 100Pa' },
          { label: 'Zone G Temp',     value: '26.1 °C',   alarm: true,  limit: 'Setpt: 22°C' },
          { label: 'Zone F1 Temp',    value: '28.3 °C',   alarm: true,  limit: 'Setpt: 22°C' },
        ].map(s => (
          <div key={s.label} className={`hvac-drilldown__sensor ${s.alarm ? 'hvac-drilldown__sensor--alarm' : ''}`}>
            <div className="hvac-drilldown__sensor-lbl">{s.label}</div>
            <div className="hvac-drilldown__sensor-val">{s.value}</div>
            <div className="hvac-drilldown__sensor-limit">{s.limit}</div>
          </div>
        ))}
      </div>

      {/* Recommended actions */}
      <div className="hvac-drilldown__actions">
        <div className="hvac-drilldown__actions-title">🤖 AI Recommended Actions</div>
        <div className="hvac-drilldown__actions-list">
          {[
            '① Isolate AHU-01 electrical supply at MCC panel (tag-out required)',
            '② Engage AHU-01 bypass damper — redirect load to AHU-02 at 120% capacity',
            '③ Increase Chiller-1 output by 15% to compensate for increased AHU-02 load',
            '④ Deploy portable cooling units in Lobby + Cafeteria (Zone G impact)',
            '⑤ Order replacement bearing: SKF 6209-2RS · Est. repair time: 3.5 hr',
          ].map(a => (
            <div key={a} className="hvac-drilldown__action-item">{a}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Building HVAC Schematic
// ─────────────────────────────────────────────────────────────────────────────
function BuildingHVACSchematic({ onSelectComponent, faultActive }:
  { onSelectComponent: (id: string) => void; faultActive: boolean }) {

  const ahu01Status = faultActive ? 'fault' : 'running' as ComponentStatus;
  const vavGStatus  = faultActive ? 'fault' : 'running' as ComponentStatus;
  const ahu01Sub    = faultActive ? '0 CFM · G+F1 · FAULT' : '8500 CFM · G+F1';
  const ahu01Label  = faultActive ? '💨 AHU-01  ⚠' : '💨 AHU-01  ✓';
  const vavLobSub   = faultActive ? '26.1°C ↑  ⚠' : '22.1°C ✓';
  const vavCafSub   = faultActive ? '27.4°C ↑  ⚠' : '22.4°C ✓';
  const vavF1aSub   = faultActive ? '28.3°C ↑  ⚠' : '22.3°C ✓';
  const vavF1bSub   = faultActive ? '27.9°C ↑  ⚠' : '22.9°C ✓';
  const SA_FAULT_OR_OK = faultActive ? 'rgba(239,68,68,0.45)' : 'rgba(52,211,153,0.6)';
  const bmsAlarm    = faultActive ? 'ACTIVE ⚠ HVAC ALARM' : 'ACTIVE';
  const pipeAnim    = !faultActive;
  // CHW flow color (cold)
  const CHW = 'rgba(96,165,250,0.65)';
  const CW  = 'rgba(251,146,60,0.55)';
  const SA  = 'rgba(52,211,153,0.6)';
  const SA_FAULT = 'rgba(239,68,68,0.45)';

  return (
    <svg viewBox="0 0 760 460" className="hvac-main-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arr-chw" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="rgba(96,165,250,0.7)" />
        </marker>
        <marker id="arr-cw" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="rgba(251,146,60,0.7)" />
        </marker>
        <marker id="arr-sa" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="rgba(52,211,153,0.7)" />
        </marker>
        <marker id="arr-fault" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="rgba(239,68,68,0.7)" />
        </marker>
      </defs>

      <rect width="760" height="460" fill="rgba(6,10,20,0.0)" />

      {/* ═══════════════════════════════════════════════════════════
          COLUMN 1 — Generation (Chillers + Cooling Towers)  x=10–130
      ═════════════════════════════════════════════════════════════ */}
      <text x="65" y="16" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="0.8">F3 ROOFTOP PLANT</text>
      <SBox x={8}   y={22}  w={116} h={44} label="❄ CHILLER 1"     sub="450 kW · COP 5.2" status="running" />
      <SBox x={8}   y={74}  w={116} h={44} label="❄ CHILLER 2"     sub="380 kW · Standby"  status="standby" />
      <SBox x={8}   y={130} w={116} h={44} label="🌀 COOLING TWR 1" sub="38°C EWT · Active" status="running" />
      <SBox x={8}   y={182} w={116} h={44} label="🌀 COOLING TWR 2" sub="Standby"            status="standby" />

      {/* Condenser water loop (Chillers → Cooling Towers) */}
      <Pipe x1={68}  y1={66}  x2={68}  y2={74}  color={CW} />
      <Pipe x1={68}  y1={118} x2={68}  y2={130} color={CW} />
      <Pipe x1={68}  y1={152} x2={68}  y2={182} color={CW} />
      <PipeLabel x={86} y={122} text="CW Loop" color={`rgba(251,146,60,0.5)`} />

      {/* ═══════════════════════════════════════════════════════════
          COLUMN 2 — Distribution (Pumps + Header)  x=150–260
      ═════════════════════════════════════════════════════════════ */}
      <text x="205" y="16" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="0.8">B1 BASEMENT PLANT</text>
      <SBox x={148} y={22}  w={112} h={44} label="⚙ CHW PUMP A"    sub="45 L/s · Primary"  status="running" />
      <SBox x={148} y={74}  w={112} h={44} label="⚙ CHW PUMP B"    sub="Standby · Ready"   status="standby" />
      <SBox x={148} y={130} w={112} h={44} label="🫙 BUFFER TANK"   sub="2000 L · 6.2°C"   status="ok" />
      <SBox x={148} y={182} w={112} h={44} label="⚙ CW PUMP A"     sub="35 L/s · Primary"  status="running" />
      <SBox x={148} y={234} w={112} h={44} label="⚙ CW PUMP B"     sub="Standby"            status="standby" />

      {/* CHW pipes: Chillers → CHW Pumps */}
      <Pipe x1={124} y1={44}  x2={148} y2={44}  color={CHW} animated />
      <Pipe x1={124} y1={96}  x2={148} y2={96}  color={CHW} dashed />
      <Pipe x1={148} y1={66}  x2={148} y2={74}  color={CHW} animated />
      <Pipe x1={204} y1={118} x2={204} y2={130} color={CHW} animated />
      <PipeLabel x={136} y={42} text="6°C CHW" color={`rgba(96,165,250,0.55)`} />

      {/* CW pipes */}
      <Pipe x1={124} y1={152} x2={148} y2={204} color={CW} />
      <Pipe x1={124} y1={196} x2={148} y2={204} color={CW} />

      {/* ═══════════════════════════════════════════════════════════
          COLUMN 3 — Air Handling Units  x=282–400
      ═════════════════════════════════════════════════════════════ */}
      <text x="341" y="16" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="0.8">F3 ROOFTOP — AHUs</text>

      {/* AHU-01 — normal or fault based on incident */}
      <SBox x={282} y={22} w={118} h={56} label={ahu01Label}
        sub={ahu01Sub} status={ahu01Status} pulse={faultActive}
        onClick={faultActive ? () => onSelectComponent('ahu01') : undefined} />
      {/* Click hint only when fault */}
      {faultActive && (
        <text x="341" y="87" textAnchor="middle" fontSize="7" fill="rgba(239,68,68,0.5)"
          fontFamily="Inter,system-ui">↑ click for fault details</text>
      )}

      {/* AHU-02 OK */}
      <SBox x={282} y={104} w={118} h={48} label="💨 AHU-02  ✓"
        sub="9500 CFM · F2+F3" status="running" />

      {/* CHW to AHUs */}
      <Pipe x1={260} y1={130} x2={282} y2={50}  color={CHW} animated />
      <Pipe x1={260} y1={174} x2={282} y2={128} color={CHW} animated />

      {/* ═══════════════════════════════════════════════════════════
          COLUMN 4 — VAV / Zone Distribution  x=424–580
      ═════════════════════════════════════════════════════════════ */}
      <text x="500" y="16" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="0.8">ZONE DISTRIBUTION — VAV</text>

      {/* AHU-01 → zones (fault=dashed red, normal=animated green) */}
      <Pipe x1={400} y1={50}  x2={424} y2={40}  color={SA_FAULT_OR_OK} dashed={faultActive} animated={pipeAnim} />
      <Pipe x1={400} y1={50}  x2={424} y2={70}  color={SA_FAULT_OR_OK} dashed={faultActive} animated={pipeAnim} />
      <Pipe x1={400} y1={50}  x2={424} y2={100} color={SA_FAULT_OR_OK} dashed={faultActive} animated={pipeAnim} />
      <Pipe x1={400} y1={50}  x2={424} y2={130} color={SA_FAULT_OR_OK} dashed={faultActive} animated={pipeAnim} />

      <SBox x={424} y={22}  w={120} h={36} label="🌡 VAV · Lobby G"
        sub={vavLobSub} status={vavGStatus}
        onClick={faultActive ? () => onSelectComponent('vav_lobby') : undefined} />
      <SBox x={424} y={63}  w={120} h={36} label="🌡 VAV · Cafeteria G"
        sub={vavCafSub} status={vavGStatus}
        onClick={faultActive ? () => onSelectComponent('vav_cafe') : undefined} />
      <SBox x={424} y={104} w={120} h={36} label="🌡 VAV · Office F1-A"
        sub={vavF1aSub} status={vavGStatus}
        onClick={faultActive ? () => onSelectComponent('vav_f1a') : undefined} />
      <SBox x={424} y={145} w={120} h={36} label="🌡 VAV · Office F1-B"
        sub={vavF1bSub} status={vavGStatus}
        onClick={faultActive ? () => onSelectComponent('vav_f1b') : undefined} />

      {/* AHU-02 → zones (normal) */}
      <Pipe x1={400} y1={128} x2={424} y2={214} color={SA} animated />
      <Pipe x1={400} y1={128} x2={424} y2={255} color={SA} animated />
      <Pipe x1={400} y1={128} x2={424} y2={296} color={SA} animated />
      <Pipe x1={400} y1={128} x2={424} y2={337} color={SA} animated />

      <SBox x={424} y={200} w={120} h={36} label="🌡 VAV · F2 Offices"  sub="22.3°C ✓" status="running" />
      <SBox x={424} y={241} w={120} h={36} label="🌡 VAV · F2 Board Rm" sub="21.8°C ✓" status="running" />
      <SBox x={424} y={282} w={120} h={36} label="🌡 VAV · F3 Command"  sub="22.0°C ✓" status="running" />
      <SBox x={424} y={323} w={120} h={36} label="🌡 VAV · F3 Server"   sub="21.5°C ✓" status="running" />

      {/* ═══════════════════════════════════════════════════════════
          COLUMN 5 — Exhaust + DOAS  x=570–670
      ═════════════════════════════════════════════════════════════ */}
      <text x="620" y="16" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.4)"
        fontFamily="Inter,system-ui" letterSpacing="0.8">EXHAUST / DOAS</text>

      <SBox x={572} y={22}  w={112} h={36} label="💨 DOAS Unit"          sub="Fresh air · OA 35°C" status="running" />
      <SBox x={572} y={68}  w={112} h={36} label="🔄 Exhaust Fan F1"     sub="3800 CFM · Active"   status="running" />
      <SBox x={572} y={114} w={112} h={36} label="🔄 Exhaust Fan F2"     sub="3200 CFM · Active"   status="running" />
      <SBox x={572} y={160} w={112} h={36} label="🔄 Exhaust Fan F3"     sub="2800 CFM · Active"   status="running" />

      <Pipe x1={544} y1={240} x2={572} y2={86}  color="rgba(107,114,128,0.4)" dashed />
      <Pipe x1={544} y1={263} x2={572} y2={132} color="rgba(107,114,128,0.4)" dashed />
      <Pipe x1={544} y1={300} x2={572} y2={178} color="rgba(107,114,128,0.4)" dashed />
      <PipeLabel x={558} y={210} text="← Return" color="rgba(107,114,128,0.35)" />

      {/* ═══════════════════════════════════════════════════════════
          BMS DDC Controller  (bottom spanning)
      ═════════════════════════════════════════════════════════════ */}
      <rect x="8" y="390" width="676" height="36" rx="4"
        fill="rgba(10,18,36,0.95)" stroke="rgba(96,165,250,0.35)" strokeWidth="1" />
      <text x="350" y="404" textAnchor="middle" fontSize="8.5" fill="rgba(96,165,250,0.8)"
        fontWeight="700" fontFamily="Inter,system-ui">
        🖥 BMS DDC — Schneider EcoStruxure   ·   SE8600   ·   {bmsAlarm}</text>
      <text x="350" y="417" textAnchor="middle" fontSize="7.5" fill="rgba(96,165,250,0.45)"
        fontFamily="Inter,system-ui">
        Controls: Chillers · Pumps · AHU-01/02 · VAV · Exhaust · Setpoints · Schedules · Alarms
      </text>
      {/* BMS control lines */}
      {[68, 204, 341, 484].map(cx => (
        <line key={cx} x1={cx} y1={390} x2={cx} y2={360}
          stroke="rgba(96,165,250,0.15)" strokeWidth="1" strokeDasharray="3,3" />
      ))}

      {/* ═══════════════════════════════════════════════════════════
          Legend
      ═════════════════════════════════════════════════════════════ */}
      <g transform="translate(8, 442)">
        <rect x="0" y="0" width="6" height="6" rx="1" fill={CHW} />
        <text x="10" y="6" fontSize="7.5" fill="rgba(96,165,250,0.6)" fontFamily="Inter,system-ui">CHW 6°C</text>
        <rect x="70" y="0" width="6" height="6" rx="1" fill={CW} />
        <text x="80" y="6" fontSize="7.5" fill="rgba(251,146,60,0.6)" fontFamily="Inter,system-ui">CW Loop</text>
        <rect x="140" y="0" width="6" height="6" rx="1" fill={SA} />
        <text x="150" y="6" fontSize="7.5" fill="rgba(52,211,153,0.6)" fontFamily="Inter,system-ui">Supply Air ✓</text>
        <rect x="230" y="0" width="6" height="6" rx="1" fill={SA_FAULT} />
        <text x="240" y="6" fontSize="7.5" fill="rgba(239,68,68,0.6)" fontFamily="Inter,system-ui">Supply Air ✕ Fault</text>
        <text x="350" y="6" fontSize="7.5" fill="rgba(107,114,128,0.5)" fontFamily="Inter,system-ui">← Return / Exhaust</text>
      </g>

      {/* ── Title ── */}
      <text x="380" y="456" textAnchor="middle" fontSize="8.5"
        fill="rgba(52,211,153,0.3)" fontFamily="Inter,system-ui" letterSpacing="1">
        HVAC SYSTEM ARCHITECTURE — THE NEST BUILDING (DSO)
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Tree Sidebar
// ─────────────────────────────────────────────────────────────────────────────
function ComponentTree({ selected, onSelect, faultActive }:
  { selected: string | null; onSelect: (id: string) => void; faultActive: boolean }) {
  const components: Record<string, HVACComponent> = faultActive ? HVAC_COMPONENTS : {
    ...HVAC_COMPONENTS,
    ahu01:     { ...HVAC_COMPONENTS.ahu01,     status: 'running', value: '8500 CFM', fault: undefined },
    vav_lobby: { ...HVAC_COMPONENTS.vav_lobby, status: 'running', value: '22.1°C ✓', fault: undefined },
    vav_cafe:  { ...HVAC_COMPONENTS.vav_cafe,  status: 'running', value: '22.4°C ✓', fault: undefined },
    vav_f1a:   { ...HVAC_COMPONENTS.vav_f1a,   status: 'running', value: '22.3°C ✓', fault: undefined },
    vav_f1b:   { ...HVAC_COMPONENTS.vav_f1b,   status: 'running', value: '22.9°C ✓', fault: undefined },
    bms:       { ...HVAC_COMPONENTS.bms,       sub: 'ACTIVE' },
  };
  const groups = [
    { label: 'Refrigeration Plant', icon: '❄️', ids: ['ch1', 'ch2', 'ct1', 'ct2'] },
    { label: 'Pumps & Distribution', icon: '⚙', ids: ['chwp_a', 'chwp_b', 'buf_tank', 'cwp_a', 'cwp_b'] },
    { label: 'Air Handling Units', icon: '💨', ids: ['ahu01', 'ahu02'] },
    { label: 'Zone VAVs (G + F1)', icon: '🌡', ids: ['vav_lobby', 'vav_cafe', 'vav_f1a', 'vav_f1b'] },
    { label: 'Zone VAVs (F2 + F3)', icon: '🌡', ids: ['vav_f2', 'vav_f3'] },
    { label: 'Controls', icon: '🖥', ids: ['bms'] },
  ];

  return (
    <div className="hvac-tree">
      <div className="hvac-tree__header">HVAC Component Tree</div>
      {groups.map(g => (
        <div key={g.label} className="hvac-tree__group">
          <div className="hvac-tree__group-label">{g.icon} {g.label}</div>
          {g.ids.map(id => {
            const c = components[id];
            const col = STATUS_COLOR[c.status];
            return (
              <div key={id}
                className={`hvac-tree__item ${selected === id ? 'hvac-tree__item--sel' : ''} ${c.status === 'fault' ? 'hvac-tree__item--fault' : ''}`}
                onClick={() => onSelect(id)}>
                <span className="hvac-tree__dot" style={{ background: col }} />
                <div className="hvac-tree__item-body">
                  <div className="hvac-tree__item-name">{c.name}</div>
                  <div className="hvac-tree__item-val" style={{ color: col }}>
                    {STATUS_LABEL[c.status]}
                    {c.value ? ` · ${c.value}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Detail Panel
// ─────────────────────────────────────────────────────────────────────────────
function ComponentDetail({ id, onFaultDrilldown, faultActive }:
  { id: string; onFaultDrilldown: () => void; faultActive: boolean }) {
  const comps: Record<string, HVACComponent> = faultActive ? HVAC_COMPONENTS : {
    ...HVAC_COMPONENTS,
    ahu01:     { ...HVAC_COMPONENTS.ahu01,     status: 'running', value: '8500 CFM', fault: undefined },
    vav_lobby: { ...HVAC_COMPONENTS.vav_lobby, status: 'running', value: '22.1°C ✓', fault: undefined },
    vav_cafe:  { ...HVAC_COMPONENTS.vav_cafe,  status: 'running', value: '22.4°C ✓', fault: undefined },
    vav_f1a:   { ...HVAC_COMPONENTS.vav_f1a,   status: 'running', value: '22.3°C ✓', fault: undefined },
    vav_f1b:   { ...HVAC_COMPONENTS.vav_f1b,   status: 'running', value: '22.9°C ✓', fault: undefined },
    bms:       { ...HVAC_COMPONENTS.bms,       sub: 'ACTIVE' },
  };
  const c = comps[id];
  if (!c) return null;
  const col = STATUS_COLOR[c.status];
  return (
    <div className="hvac-detail">
      <div className="hvac-detail__name" style={{ color: col }}>{c.name}</div>
      <div className="hvac-detail__floor">{c.floor}</div>
      <div className="hvac-detail__status" style={{ color: col }}>
        <span className="hvac-detail__dot" style={{ background: col }} />
        {STATUS_LABEL[c.status]}
      </div>
      {c.value && <div className="hvac-detail__val">{c.value}</div>}
      {c.sub   && <div className="hvac-detail__sub">{c.sub}</div>}
      {c.fault && (
        <div className="hvac-detail__fault">
          <div className="hvac-detail__fault-title">⚠ Fault Description</div>
          <div className="hvac-detail__fault-text">{c.fault}</div>
          <button className="hvac-detail__drill-btn" onClick={onFaultDrilldown}>
            🔍 View Internal Schematic
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────
interface HVACSchematicPanelProps {
  incidentSim:   'fire' | 'hvac' | 'power' | 'occupancy' | 'energy' | null;
  incidentStage: number;
}

export default function HVACSchematicPanel({ incidentSim, incidentStage: _stage }: HVACSchematicPanelProps) {
  const faultActive = incidentSim === 'hvac';
  const [selected,   setSelected]   = useState<string | null>(faultActive ? 'ahu01' : null);
  const [drilldown,  setDrilldown]  = useState(false);

  // Auto-open drilldown if HVAC incident is active
  useEffect(() => {
    if (faultActive) setSelected('ahu01');
    else { setSelected(null); setDrilldown(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentSim]);

  return (
    <div className="hvac-panel">
      {/* ── Left: Component Tree ── */}
      <div className="hvac-panel__left">
        <ComponentTree selected={selected} onSelect={id => { setSelected(id); setDrilldown(false); }} faultActive={faultActive} />
        {selected && (
          <ComponentDetail
            id={selected}
            onFaultDrilldown={() => setDrilldown(true)}
            faultActive={faultActive}
          />
        )}
      </div>

      {/* ── Right: Main Schematic ── */}
      <div className="hvac-panel__right">
        <div className="hvac-panel__title">
          ❄️ HVAC System Architecture — Full Building
          {faultActive && <span className="hvac-panel__alarm">⚠ AHU-01 FAULT ACTIVE</span>}
        </div>
        <div className="hvac-panel__schematic-area">
          <BuildingHVACSchematic onSelectComponent={id => { setSelected(id); setDrilldown(false); }} faultActive={faultActive} />
        </div>
      </div>

      {/* ── Drilldown overlay ── */}
      {drilldown && (
        <div className="hvac-drilldown-overlay">
          <AHU01InternalSchematic onClose={() => setDrilldown(false)} />
        </div>
      )}
    </div>
  );
}
