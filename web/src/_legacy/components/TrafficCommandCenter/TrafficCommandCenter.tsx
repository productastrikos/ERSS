import { useState, useEffect, useRef, useMemo } from 'react';
import type { TrafficState, TrafficSignal } from '../../types';
import { SIGNAL_COLOR } from '../../data/trafficSignals';
import './TrafficCommandCenter.scss';

// ── Video mapping for signals ─────────────────────────────────────────────
const SIGNAL_VIDEOS = [
  '/traffic_cctv_1.mp4', '/traffic_cctv_2.mp4', '/traffic_cctv_3.mp4',
  '/traffic_cctv_4.mp4', '/traffic_cctv_5.mp4', '/traffic_cctv_6.mp4',
  '/traffic_cctv_7.mp4', '/traffic_cctv_8.mp4', '/traffic_cctv_9.mp4',
  '/traffic_cctv_10.mp4', '/traffic_cctv_11.mp4', '/traffic_cctv_12.mp4',
  '/traffic_cctv_13.mp4',
];

const CONGESTION_COLOR: Record<string, string> = {
  LOW:      '#4ade80',
  MEDIUM:   '#fbbf24',
  HIGH:     '#f97316',
  CRITICAL: '#ef4444',
};

interface TrafficCommandCenterProps {
  trafficState: TrafficState;
  onClose: () => void;
  onSignalControl?: (signalId: string, newState: 'RED' | 'YELLOW' | 'GREEN') => void;
}

// ── Real-geometry arm computation ────────────────────────────────────────────
const computeArms = (signal: TrafficSignal, roads: TrafficState['roads']) => {
  const CX = 200, CY = 200, ARM_LEN = 165, HALF_W = 26, GAP = 46;
  const [sigLng, sigLat] = signal.location;
  const cosLat = Math.cos(sigLat * Math.PI / 180);
  const PROX = 1e-4;
  return roads.flatMap(r => {
    const sM = Math.abs(r.start[0] - sigLng) < PROX && Math.abs(r.start[1] - sigLat) < PROX;
    const eM = Math.abs(r.end[0]   - sigLng) < PROX && Math.abs(r.end[1]   - sigLat) < PROX;
    if (!sM && !eM) return [];
    const far = sM ? r.end : r.start;
    const dwx = (far[0] - sigLng) * cosLat;
    const dwy = -(far[1] - sigLat);
    const mag = Math.hypot(dwx, dwy);
    if (mag < 1e-9) return [];
    const ux = dwx / mag, uy = dwy / mag;
    const px = -uy,       py =  ux;
    const innerX = CX + GAP     * ux, innerY = CY + GAP     * uy;
    const tipX   = CX + ARM_LEN * ux, tipY   = CY + ARM_LEN * uy;
    const poly = [
      [innerX + HALF_W * px, innerY + HALF_W * py],
      [innerX - HALF_W * px, innerY - HALF_W * py],
      [tipX   - HALF_W * px, tipY   - HALF_W * py],
      [tipX   + HALF_W * px, tipY   + HALF_W * py],
    ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const sigX = innerX + (HALF_W + 8) * px,  sigY = innerY + (HALF_W + 8) * py;
    const t    = 0.64;
    const lbX  = innerX + (tipX - innerX) * t + (HALF_W + 14) * px;
    const lbY  = innerY + (tipY - innerY) * t + (HALF_W + 14) * py;
    let   la   = Math.atan2(uy, ux) * 180 / Math.PI;
    if (la >  90) la -= 180;
    if (la < -90) la += 180;
    const slX  = innerX + (tipX - innerX) * 0.38 - (HALF_W + 10) * px;
    const slY  = innerY + (tipY - innerY) * 0.38 - (HALF_W + 10) * py;
    return [{ r, ux, uy, px, py, innerX, innerY, tipX, tipY, poly, sigX, sigY, lbX, lbY, la, slX, slY }];
  });
};

// ── Intersection SVG View ─────────────────────────────────────────────────────
function IntersectionView({
  signal,
  trafficState,
  onControl,
}: {
  signal: TrafficSignal;
  trafficState: TrafficState;
  onControl?: (signalId: string, s: 'RED' | 'YELLOW' | 'GREEN') => void;
}) {
  // Live signal: driven by trafficState (which carries idle-cycling states from TrafficSignalManager)
  const liveSignal = trafficState.signals.find(s => s.signal_id === signal.signal_id) ?? signal;

  const [localPhase, setLocalPhase] = useState<'GREEN' | 'YELLOW' | 'RED'>(
    liveSignal.state as 'GREEN' | 'YELLOW' | 'RED',
  );
  const [countdown, setCountdown] = useState(() =>
    liveSignal.state === 'GREEN' ? liveSignal.green_time :
    liveSignal.state === 'RED'   ? liveSignal.red_time   : 5,
  );
  const [manualOverride, setManualOverride] = useState<'RED' | 'YELLOW' | 'GREEN' | null>(null);
  const [tick, setTick] = useState(0);

  const phaseRef     = useRef<'GREEN' | 'YELLOW' | 'RED'>(localPhase);
  const prevStateRef = useRef(liveSignal.state);
  phaseRef.current   = localPhase;

  // Sync phase from live trafficState signal cycling
  useEffect(() => {
    if (manualOverride) return;
    if (prevStateRef.current === liveSignal.state) return;
    prevStateRef.current = liveSignal.state;
    const p = liveSignal.state as 'GREEN' | 'YELLOW' | 'RED';
    setLocalPhase(p);
    setCountdown(p === 'GREEN' ? liveSignal.green_time : p === 'RED' ? liveSignal.red_time : 5);
  });

  // Local countdown (also handles phase cycling between external updates)
  useEffect(() => {
    const id = setInterval(() => {
      if (manualOverride) return;
      setCountdown(c => {
        if (c > 1) return c - 1;
        const cur = phaseRef.current;
        if (cur === 'GREEN')  { setLocalPhase('YELLOW'); return 5; }
        if (cur === 'YELLOW') { setLocalPhase('RED');    return liveSignal.red_time; }
        setLocalPhase('GREEN'); return liveSignal.green_time;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [liveSignal.red_time, liveSignal.green_time, manualOverride]);

  // Vehicle animation tick
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % 2000), 300);
    return () => clearInterval(id);
  }, []);

  const activePhase = manualOverride ?? localPhase;
  const sigColor    = SIGNAL_COLOR[activePhase] ?? '#888';

  // Real road geometry from lat/lng coordinates (rememoized when signal changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const arms = useMemo(() => computeArms(signal, trafficState.roads), [signal.signal_id, trafficState.roads]);

  return (
    <div className="intersection-view">
      {/* ── header bar ── */}
      <div className="iv-header">
        <div className="iv-header-left">
          <span className="iv-sig-id">{signal.signal_id}</span>
          <span className="iv-sig-name">{signal.name}</span>
        </div>
        <div className="iv-header-right">
          <span className="iv-coords">
            {signal.location[1].toFixed(4)}°N, {signal.location[0].toFixed(4)}°E
          </span>
          <span className={`iv-status-badge iv-status-badge--${signal.status.toLowerCase()}`}>
            {signal.status}
          </span>
        </div>
      </div>

      {/* ── main body: SVG intersection + side telemetry ── */}
      <div className="iv-body">

        {/* SVG intersection canvas — real road geometry from lat/lng */}
        <div className="iv-svg-wrap">
          <svg viewBox="0 0 400 400" className="iv-svg">
            {/* Background asphalt */}
            <rect width="400" height="400" fill="#0d1117"/>

            {/* ── Road arm surfaces (real angles from lat/lng) ── */}
            {arms.map(a => (
              <polygon key={a.r.road_id + '-asp'} points={a.poly} fill="#1c2337"/>
            ))}

            {/* ── Center intersection box ── */}
            <circle cx="200" cy="200" r="47" fill="#1c2337"/>

            {/* ── Congestion heat overlays ── */}
            {arms.map(a => (
              <polygon
                key={a.r.road_id + '-heat'}
                points={a.poly}
                fill={CONGESTION_COLOR[a.r.congestion_level]}
                fillOpacity={a.r.congestion_index * 0.42}
              />
            ))}

            {/* ── Center box (on top of heat, keeps intersection clean) ── */}
            <circle cx="200" cy="200" r="47" fill="#1c2337" fillOpacity="0.92"/>
            <circle cx="200" cy="200" r="47" fill="none" stroke="#374151" strokeWidth="1"/>

            {/* ── Lane dividers (dashed center line per arm) ── */}
            {arms.map(a => (
              <line
                key={a.r.road_id + '-div'}
                x1={a.innerX} y1={a.innerY} x2={a.tipX} y2={a.tipY}
                stroke="#374151" strokeWidth="1.5" strokeDasharray="9,7"
              />
            ))}

            {/* ── Stop lines at arm entry (red when phase=RED) ── */}
            {arms.map(a => (
              <line
                key={a.r.road_id + '-stop'}
                x1={a.innerX + 26 * a.px} y1={a.innerY + 26 * a.py}
                x2={a.innerX - 26 * a.px} y2={a.innerY - 26 * a.py}
                stroke={activePhase === 'RED' ? '#ef4444aa' : '#4b556333'}
                strokeWidth="3"
              />
            ))}

            {/* ── Animated vehicle dots flowing along each arm ── */}
            {arms.map(a => {
              const maxV = Math.min(Math.ceil(a.r.vehicle_count / 16), 8);
              const sf   = activePhase === 'RED'    ? 0.0004
                         : activePhase === 'YELLOW' ? 0.0018
                         : (a.r.avg_speed / 50) * 0.005;
              return Array.from({ length: maxV }).map((_, vi) => {
                let t = ((vi / maxV) + tick * sf) % 1.0;
                if (activePhase === 'RED' && t > 0.82) t = 0.82 + (t - 0.82) * 0.06;
                const vx   = a.tipX + (a.innerX - a.tipX) * t;
                const vy   = a.tipY + (a.innerY - a.tipY) * t;
                const lane = (vi % 2 === 0 ? 0.38 : -0.38) * 26;
                return (
                  <circle
                    key={`v-${a.r.road_id}-${vi}`}
                    cx={vx + lane * a.px} cy={vy + lane * a.py}
                    r="3.5" fill="#60a5fa" fillOpacity="0.85"
                  />
                );
              });
            })}

            {/* ── Signal head per arm (right side at stop line) ── */}
            {arms.map(a => (
              <SignalHead key={a.r.road_id + '-sh'} cx={a.sigX} cy={a.sigY} phase={activePhase}/>
            ))}

            {/* ── Road name labels (rotated along arm) ── */}
            {arms.map(a => (
              <text
                key={a.r.road_id + '-name'}
                x={a.lbX} y={a.lbY}
                textAnchor="middle" fill="#6b7280" fontSize="8"
                transform={`rotate(${a.la.toFixed(1)},${a.lbX.toFixed(1)},${a.lbY.toFixed(1)})`}
              >
                {a.r.name.length > 21 ? a.r.name.slice(0, 20) + '…' : a.r.name}
              </text>
            ))}

            {/* ── Speed + congestion labels (left side of arm) ── */}
            {arms.map(a => (
              <text
                key={a.r.road_id + '-spd'}
                x={a.slX} y={a.slY}
                textAnchor="middle"
                fill={CONGESTION_COLOR[a.r.congestion_level]}
                fontSize="8" fontWeight="600"
                transform={`rotate(${a.la.toFixed(1)},${a.slX.toFixed(1)},${a.slY.toFixed(1)})`}
              >
                {a.r.avg_speed} km/h
              </text>
            ))}

            {/* ── Centre countdown ring ── */}
            <circle cx="200" cy="200" r="30" fill="rgba(0,0,0,0.78)" stroke={sigColor} strokeWidth="2.5"
              style={{ filter: `drop-shadow(0 0 8px ${sigColor}66)` }}
            />
            <text x="200" y="196" textAnchor="middle" fill={sigColor} fontSize="20" fontWeight="bold" fontFamily="monospace">
              {countdown}
            </text>
            <text x="200" y="212" textAnchor="middle" fill="#9ca3af" fontSize="8.5" letterSpacing="1">
              {activePhase}
            </text>

            {arms.length === 0 && (
              <text x="200" y="200" textAnchor="middle" fill="#6b7280" fontSize="12">No road data</text>
            )}
          </svg>
        </div>

        {/* side telemetry panel */}
        <div className="iv-telemetry">

          {/* signal phase control */}
          <div className="iv-tele-card iv-tele-card--control">
            <div className="iv-tele-label">SIGNAL PHASE CONTROL</div>
            <div className="iv-phase-btns">
              {(['RED', 'YELLOW', 'GREEN'] as const).map((s) => (
                <button
                  key={s}
                  className={`iv-phase-btn iv-phase-btn--${s.toLowerCase()} ${manualOverride === s ? 'iv-phase-btn--active' : ''}`}
                  onClick={() => {
                    setManualOverride(manualOverride === s ? null : s);
                    onControl?.(signal.signal_id, s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {manualOverride && (
              <button className="iv-override-clear" onClick={() => setManualOverride(null)}>
                ↺ Resume Auto
              </button>
            )}
          </div>

          {/* timing */}
          <div className="iv-tele-card">
            <div className="iv-tele-label">TIMING PLAN</div>
            <div className="iv-tele-rows">
              <div className="iv-tele-row">
                <span>Cycle Time</span><span className="iv-tele-val">{liveSignal.cycle_time}s</span>
              </div>
              <div className="iv-tele-row">
                <span>Green</span><span className="iv-tele-val" style={{color:'#4ade80'}}>{liveSignal.green_time}s</span>
              </div>
              <div className="iv-tele-row">
                <span>Yellow</span><span className="iv-tele-val" style={{color:'#fbbf24'}}>5s</span>
              </div>
              <div className="iv-tele-row">
                <span>Red</span><span className="iv-tele-val" style={{color:'#ef4444'}}>{liveSignal.red_time}s</span>
              </div>
            </div>
          </div>

          {/* traffic metrics */}
          <div className="iv-tele-card">
            <div className="iv-tele-label">TRAFFIC METRICS</div>
            <div className="iv-tele-rows">
              <div className="iv-tele-row">
                <span>Vehicle Density</span><span className="iv-tele-val">{liveSignal.vehicle_density} veh</span>
              </div>
              <div className="iv-tele-row">
                <span>Connections</span><span className="iv-tele-val">{arms.length} roads</span>
              </div>
            </div>
          </div>

          {/* connected roads */}
          <div className="iv-tele-card">
            <div className="iv-tele-label">CONNECTED ROADS</div>
            <div className="iv-road-list">
              {arms.length === 0 && (
                <div className="iv-tele-row" style={{opacity:0.5}}><span>No matched roads</span></div>
              )}
              {arms.map((a) => (
                <div key={a.r.road_id} className="iv-road-row">
                  <span className="iv-road-name">{a.r.name}</span>
                  <span className={`iv-cong-dot iv-cong-dot--${a.r.congestion_level.toLowerCase()}`}/>
                  <span className="iv-road-speed">{a.r.avg_speed} km/h</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mini signal head SVG component ───────────────────────────────────────────
function SignalHead({ cx, cy, phase }: { cx: number; cy: number; phase: string }) {
  return (
    <g>
      <rect x={cx - 8} y={cy - 22} width="16" height="44" rx="4" fill="#111" stroke="#374151" strokeWidth="1"/>
      {/* Red */}
      <circle cx={cx} cy={cy - 14} r="5" fill={phase === 'RED'    ? '#ef4444' : '#1f2937'}
        style={phase === 'RED'    ? {filter:'drop-shadow(0 0 4px #ef4444)'} : {}}/>
      {/* Yellow */}
      <circle cx={cx} cy={cy}      r="5" fill={phase === 'YELLOW' ? '#fbbf24' : '#1f2937'}
        style={phase === 'YELLOW' ? {filter:'drop-shadow(0 0 4px #fbbf24)'} : {}}/>
      {/* Green */}
      <circle cx={cx} cy={cy + 14} r="5" fill={phase === 'GREEN'  ? '#4ade80' : '#1f2937'}
        style={phase === 'GREEN'  ? {filter:'drop-shadow(0 0 4px #4ade80)'} : {}}/>
    </g>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const TrafficCommandCenter = ({
  trafficState,
  onClose,
  onSignalControl,
}: TrafficCommandCenterProps) => {
  const [selectedSignal, setSelectedSignal] = useState<TrafficSignal>(trafficState.signals[0]);
  const [centerView, setCenterView] = useState<'schematic' | 'cctv'>('schematic');
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  );

  useEffect(() => {
    const t = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const totalVehicles        = trafficState.roads.reduce((s, r) => s + r.vehicle_count, 0);
  const avgSpeed             = Math.round(trafficState.roads.reduce((s, r) => s + r.avg_speed, 0) / trafficState.roads.length);
  const selectedSignalIdx    = trafficState.signals.findIndex(s => s.signal_id === selectedSignal.signal_id);
  const selectedSignalVideo  = SIGNAL_VIDEOS[selectedSignalIdx >= 0 ? selectedSignalIdx : 0];
  const liveSelectedSignal   = trafficState.signals[selectedSignalIdx] ?? selectedSignal;

  return (
    <div className="traffic-command-center">
      <div className="command-center-overlay" onClick={onClose}/>

      <div className="command-center-modal">
        {/* ── Header ── */}
        <div className="command-center-header">
          <div className="header-left">
            <div className="header-icon">🚦</div>
            <div className="header-title">
              <h1>DSO TRAFFIC COMMAND CENTER</h1>
              <span className="header-subtitle">Dubai Silicon Oasis · Real-time Traffic Management System</span>
            </div>
          </div>
          <div className="header-right">
            <div className="header-meta">
              <span className="header-meta-item">🚗 {totalVehicles} vehicles</span>
              <span className="header-meta-item">⚡ {avgSpeed} km/h avg</span>
            </div>
            <div className="header-time">{currentTime}</div>
            <div className="header-status">
              <span className="status-dot"/>
              SYSTEM ONLINE
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── 3-column body ── */}
        <div className="command-center-content">

          {/* ── LEFT: signal list ── */}
          <div className="left-panel">
            <div className="left-panel-header">
              <span>SIGNAL ROSTER</span>
              <span className="left-panel-count">{trafficState.signals.length}</span>
            </div>
            <div className="signal-list">
              {trafficState.signals.map((sig) => {
                const color = SIGNAL_COLOR[sig.state] ?? '#888';
                const road  = trafficState.roads.find(
                  (r) => r.start[0].toFixed(4) === sig.location[0].toFixed(4)
                       || r.end[0].toFixed(4)   === sig.location[0].toFixed(4)
                );
                return (
                  <div
                    key={sig.signal_id}
                    className={`signal-row ${selectedSignal.signal_id === sig.signal_id ? 'signal-row--active' : ''}`}
                    onClick={() => setSelectedSignal(sig)}
                  >
                    {/* signal head mini */}
                    <div className="signal-row-head">
                      <div className="srh-dot" style={{background: sig.state === 'RED'    ? '#ef4444' : '#1f2937', boxShadow: sig.state==='RED'    ? '0 0 6px #ef4444': 'none'}}/>
                      <div className="srh-dot" style={{background: sig.state === 'YELLOW' ? '#fbbf24' : '#1f2937', boxShadow: sig.state==='YELLOW' ? '0 0 6px #fbbf24': 'none'}}/>
                      <div className="srh-dot" style={{background: sig.state === 'GREEN'  ? '#4ade80' : '#1f2937', boxShadow: sig.state==='GREEN'  ? '0 0 6px #4ade80': 'none'}}/>
                    </div>

                    <div className="signal-row-info">
                      <div className="signal-row-id">{sig.signal_id}</div>
                      <div className="signal-row-name">{sig.name}</div>
                      {road && (
                        <div className="signal-row-road">
                          <span className={`signal-row-cong signal-row-cong--${road.congestion_level.toLowerCase()}`}>
                            {road.congestion_level}
                          </span>
                          <span className="signal-row-speed">{road.avg_speed} km/h</span>
                        </div>
                      )}
                    </div>

                    <div className="signal-row-metrics">
                      <div className="signal-row-state" style={{ color }}>●</div>
                      <div className="signal-row-density">{sig.vehicle_density}</div>
                      <div className="signal-row-density-label">veh</div>
                    </div>
                    <button
                      className="signal-row-cam-btn"
                      title="View CCTV feed"
                      onClick={(e) => { e.stopPropagation(); setSelectedSignal(sig); setCenterView('cctv'); }}
                    >
                      📹
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── CENTRE: intersection view or CCTV feed ── */}
          <div className="center-panel">
            {centerView === 'schematic' ? (
              <IntersectionView
                key={selectedSignal.signal_id}
                signal={selectedSignal}
                trafficState={trafficState}
                onControl={onSignalControl}
              />
            ) : (
              <div className="cctv-fullview">
                <div className="cctv-fv-header">
                  <div className="cctv-fv-info">
                    <span className="cctv-fv-id">{selectedSignal.signal_id}</span>
                    <span className="cctv-fv-name">{selectedSignal.name}</span>
                    <span className={`iv-status-badge iv-status-badge--${selectedSignal.status.toLowerCase()}`}>{selectedSignal.status}</span>
                  </div>
                  <div className="cctv-fv-actions">
                    <span className="iv-coords">{selectedSignal.location[1].toFixed(4)}°N, {selectedSignal.location[0].toFixed(4)}°E</span>
                    <button className="cctv-fv-back-btn" onClick={() => setCenterView('schematic')}>🗺 Road View</button>
                  </div>
                </div>
                <div className="cctv-fv-body">
                  <div className="cctv-fv-video-wrap">
                    <video
                      key={selectedSignal.signal_id}
                      src={selectedSignalVideo}
                      autoPlay muted loop playsInline
                      className="cctv-fv-video"
                    />
                    <div className="cctv-fv-overlay-tl"><span className="cctv-live-dot">⬤</span> LIVE</div>
                    <div className="cctv-fv-overlay-tr">{currentTime}</div>
                    <div className="cctv-fv-overlay-bl">📹 {selectedSignal.signal_id}</div>
                    <div className="cctv-fv-overlay-br" style={{ color: SIGNAL_COLOR[liveSelectedSignal.state] }}>● {liveSelectedSignal.state}</div>
                  </div>
                  <div className="cctv-fv-stats">
                    {([
                      { label: 'PHASE',   val: liveSelectedSignal.state,                       clr: SIGNAL_COLOR[liveSelectedSignal.state] },
                      { label: 'DENSITY', val: `${liveSelectedSignal.vehicle_density} veh`,   clr: undefined },
                      { label: 'CYCLE',   val: `${liveSelectedSignal.cycle_time}s`,            clr: undefined },
                      { label: 'GREEN',   val: `${liveSelectedSignal.green_time}s`,            clr: '#4ade80' },
                      { label: 'RED',     val: `${liveSelectedSignal.red_time}s`,              clr: '#ef4444' },
                    ] as { label: string; val: string; clr?: string }[]).map(({ label, val, clr }) => (
                      <div key={label} className="cctv-fv-stat">
                        <span className="cctv-fv-stat-label">{label}</span>
                        <span className="cctv-fv-stat-val" style={clr ? { color: clr } : undefined}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: CCTV feeds (unchanged) ── */}
          <div className="right-panel">
            <div className="camera-grid-header">
              <h3>LIVE CAMERA FEEDS</h3>
              <span className="feed-count">{trafficState.signals.length} Active</span>
            </div>
            <div className="camera-grid">
              {trafficState.signals.map((signal, idx) => (
                <div
                  key={signal.signal_id}
                  className={`camera-card ${selectedSignal?.signal_id === signal.signal_id ? 'selected' : ''}`}
                  onClick={() => setSelectedSignal(signal)}
                >
                  <div className="camera-feed">
                    <video
                      src={SIGNAL_VIDEOS[idx % SIGNAL_VIDEOS.length]}
                      autoPlay muted loop playsInline
                      className="camera-video"
                    />
                    <div className="camera-overlay">
                      <div className="camera-label">
                        <span className="camera-icon">📹</span>
                        {signal.signal_id}
                      </div>
                      <div className="camera-status" style={{ backgroundColor: SIGNAL_COLOR[signal.state] }}>
                        {signal.state}
                      </div>
                    </div>
                  </div>
                  <div className="camera-info">
                    <div className="camera-name">{signal.name}</div>
                    <div className="camera-stats">
                      <span>🚗 {signal.vehicle_density}</span>
                      <span>⏱️ {signal.cycle_time}s</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default TrafficCommandCenter;
