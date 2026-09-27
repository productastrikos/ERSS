import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  TrafficState, TrafficSimMode, TrafficView,
  TrafficSignal, RoadSegment, TrafficIncident,
} from '../../types';
import {
  TRAFFIC_SIGNALS, ROAD_SEGMENTS, DEFAULT_INCIDENTS,
  buildAccidentState,
  CONGESTION_COLOR, SIGNAL_COLOR,
} from '../../data/trafficSignals';
import AccidentResponsePanel, { type AccidentInfo } from '../AccidentResponsePanel/AccidentResponsePanel';
import type { AccidentTask } from '../../data/responders';
import { getSocket } from '../../utils/socket';
import './TrafficSignalManager.scss';

// ── AI Advisory presets ───────────────────────────────────────────────────────
const ADVISORIES = {
  congestion: {
    title:    'CONGESTION DETECTED',
    subtitle: 'DSO Central Roundabout — DSO-SIG-101',
    items: [
      'Increase green time (North–South) by +20 sec',
      'Reduce East–West cycle to 30 sec',
      'Suggest alternate route via Innovation Blvd',
    ],
    metric:    'Expected improvement: 35%',
    clearTime: undefined,
  },
  accident: {
    title:    'ACCIDENT DETECTED',
    subtitle: 'DSO West Boulevard Junction — DSO-SIG-102 · Impact Radius: 300 m',
    items: [
      'Lock signal RED for affected North lane',
      'Divert traffic via Academic City Road Entry',
      'Dispatch emergency response team immediately',
    ],
    metric:    undefined,
    clearTime: 'Estimated clearance: 18 mins',
  },
  prediction: {
    title:    'PREDICTIVE ALERT',
    subtitle: 'High congestion probability in next 10 minutes',
    items: [
      'Increase signal cycle efficiency by 25%',
      'Activate alternate routes pre-emptively',
      'Notify traffic enforcement units',
    ],
    metric:    'Congestion probability: 82%',
    clearTime: undefined,
  },
};


// ── 5-stage accident workflow labels ──────────────────────────────────────────
const STAGE_LABELS = ['Sensor', 'Detect', 'AI', 'Alert', 'Response'];

// ── Default (idle) state ──────────────────────────────────────────────────────
function defaultTrafficState(): TrafficState {
  return {
    mode:                'idle',
    activeView:          'live',
    signals:             TRAFFIC_SIGNALS,
    roads:               ROAD_SEGMENTS,
    incidents:           DEFAULT_INCIDENTS,
    predictionPct:       0,
    aiAdvisory:          null,
    emergencyResponders: [],
    accidentLocation:    null,
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface TrafficSignalManagerProps {
  onClose:         () => void;
  onStateChange?:  (state: TrafficState) => void;
  /** Driven from Sidebar sub-item clicks to navigate to a specific tab */
  pendingView?:    TrafficView | null;
  /** Callback: dispatched AccidentTasks (for map live-tracking layer) */
  onAccidentTasksChange?: (tasks: AccidentTask[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TrafficSignalManager({ onClose, onStateChange, pendingView, onAccidentTasksChange }: TrafficSignalManagerProps) {
  const [state, setState]             = useState<TrafficState>(defaultTrafficState);
  const [tick,  setTick]              = useState(0);
  const [simRunning, setSimRunning]   = useState(false);
  // Accident workflow stage (0 = idle, 1-12 = live phases)
  const [accidentStage, setAccidentStage]       = useState(0);
  // Advanced Accident Response Panel state
  const [accidentInfo, setAccidentInfo]         = useState<AccidentInfo | null>(null);
  const [showResponsePanel, setShowResponsePanel] = useState(false);

  // ── Navigate to view driven by Sidebar ────────────────────────────────────
  useEffect(() => {
    if (pendingView) setState((p) => ({ ...p, activeView: pendingView }));
  }, [pendingView]);

  // ── Live signal cycling (idle mode) ──────────────────────────────────────
  useEffect(() => {
    if (state.mode !== 'idle') return;
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, [state.mode]);

  // ── Accident workflow: auto-advance stages 1-4 (sensor→detect→AI→alert) ──
  useEffect(() => {
    if (accidentStage < 1 || accidentStage > 4) return;
    const DELAYS = [0, 1800, 2200, 2200, 1600];
    const t = setTimeout(() => setAccidentStage((s) => s + 1), DELAYS[accidentStage]);
    return () => clearTimeout(t);
  }, [accidentStage]);

  // ── Stage 5: auto-open accident response panel ───────────────────────────
  useEffect(() => {
    if (accidentStage === 5 && accidentInfo) setShowResponsePanel(true);
  }, [accidentStage, accidentInfo]);

  // ── Per-signal phase cycling: each signal uses its own green_time/red_time ─
  // tick increments every 3 s. We compute elapsed seconds and derive the phase
  // from each signal's own cycle. Yellow is always 5 s within each cycle.
  const YELLOW_SEC = 3; // Real-world yellow: 3 seconds (UAE/international standard)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const idleSignals = useMemo(() => {
    if (state.mode !== 'idle') return state.signals;
    const elapsedSec = tick * 3;
    return state.signals.map((s, i) => {
      // Stagger start so all signals don't flip simultaneously
      const offset = (i * Math.floor(s.cycle_time / state.signals.length)) % s.cycle_time;
      const pos = (elapsedSec + offset) % s.cycle_time;
      let phase: TrafficSignal['state'];
      let phaseRemainingSec: number;
      if (pos < s.green_time) {
        phase             = 'GREEN';
        phaseRemainingSec = s.green_time - pos;
      } else if (pos < s.green_time + YELLOW_SEC) {
        phase             = 'YELLOW';
        phaseRemainingSec = (s.green_time + YELLOW_SEC) - pos;
      } else {
        phase             = 'RED';
        phaseRemainingSec = s.cycle_time - pos;
      }
      return { ...s, state: phase, phaseRemainingSec };
    });
  }, [state.signals, state.mode, tick]);

  // ── Live road fluctuation in idle mode — DSO is mostly green, ≤2 roads briefly amber
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveRoads = useMemo(() => {
    if (state.mode !== 'idle') return state.roads;
    return state.roads.map((r, i) => {
      // ~1-2 roads per tick show MEDIUM (deterministic hash so no flicker on same tick)
      const isAmber = ((i * 31 + tick * 7) % 17) < 2;
      return isAmber
        ? { ...r, congestion_level: 'MEDIUM' as const, avg_speed: 32, congestion_index: 0.38 }
        : r;
    });
  }, [state.roads, state.mode, tick]);

  // ── Emit live state upward (idleSignals + liveRoads carry cycling values) ─
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onStateChange?.({ ...state, signals: idleSignals, roads: liveRoads }); }, [state, onStateChange, idleSignals, liveRoads]);

  // ── Simulate accident ─────────────────────────────────────────────────────
  const triggerAccident = useCallback(() => {
    if (simRunning) return;
    setSimRunning(true);
    const preset = buildAccidentState();
    setState({
      mode:                'accident',
      activeView:          'accident',
      signals:             preset.signals,
      roads:               preset.roads,
      incidents:           preset.incidents,
      predictionPct:       0,
      aiAdvisory:          ADVISORIES.accident,
      emergencyResponders: [],
      accidentLocation:    preset.accidentLocation,
    });
    // Reset workflow and start from stage 1
    setAccidentStage(1);
    // Create AccidentInfo for the advanced response panel
    const now = Date.now();
    const accSig = preset.signals.find(s => s.state === 'RED') ?? preset.signals[0];
    setAccidentInfo({
      id:             `ARP-${Date.now()}`,
      signalId:       accSig.signal_id,
      signalName:     accSig.name,
      location:       preset.accidentLocation as [number, number],
      severity:       'HIGH',
      timestamp:      now,
      speedDrop:      48,
      vehicleDensity: 68,
      suddenStop:     true,
      cameraFlag:     true,
    });
    setShowResponsePanel(false);
    // Push accident signal states to socket server so mobile Signals tab syncs
    getSocket().emit('push_signals', preset.signals.map(s => ({ id: s.signal_id, state: s.state })));
    setTimeout(() => setSimRunning(false), 1500);
  }, [simRunning]);

  // ── Reset to normal ───────────────────────────────────────────────────────
  const resetAll = () => {
    setState(defaultTrafficState());
    setAccidentStage(0);
    setAccidentInfo(null);
    setShowResponsePanel(false);
    // Reset all signals back to default states on mobile too
    getSocket().emit('push_signals', TRAFFIC_SIGNALS.map(s => ({ id: s.signal_id, state: s.state })));
  };

  const setView = (v: TrafficView) => setState((p) => ({ ...p, activeView: v }));

  const displaySignals = state.mode === 'idle' ? idleSignals : state.signals;

  // ── Mode badge colour ─────────────────────────────────────────────────────
  const modeBadge: Record<TrafficSimMode, string> = {
    idle:       'tsm-badge--idle',
    congestion: 'tsm-badge--congestion',
    accident:   'tsm-badge--accident',
  };
  const modeLabel: Record<TrafficSimMode, string> = {
    idle:       'NORMAL OPS',
    congestion: 'CONGESTION ACTIVE',
    accident:   'ACCIDENT ACTIVE',
  };

  return (
    <div className="tsm">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="tsm__header">
        <div className="tsm__header-left">
          <span className="tsm__header-icon">🚦</span>
          <div>
            <div className="tsm__header-title">Traffic Signal Management</div>
            <div className="tsm__header-sub">MOBILITY SYSTEM · DSO COMMAND CENTER</div>
          </div>
        </div>
        <div className="tsm__header-right">
          <span className={`tsm-badge ${modeBadge[state.mode]}`}>{modeLabel[state.mode]}</span>
          <button className="tsm__close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="tsm__tabs">
        {(['live', 'accident'] as TrafficView[]).map((v) => (
          <button
            key={v}
            className={`tsm__tab ${state.activeView === v ? 'tsm__tab--active' : ''}`}
            onClick={() => setView(v)}
          >
            {TAB_LABELS[v]}
          </button>
        ))}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="tsm__body">

        {/* ══ LIVE TRAFFIC VIEW ══════════════════════════════════════════ */}
        {state.activeView === 'live' && (
          <div className="tsm__view">
            {/* Summary metrics */}
            <div className="tsm__metrics">
              <Metric label="Total Vehicles" value={state.roads.reduce((a, r) => a + r.vehicle_count, 0).toString()} unit="veh" />
              <Metric label="Avg Speed" value={Math.round(state.roads.reduce((a, r) => a + r.avg_speed, 0) / state.roads.length).toString()} unit="km/h" />
              <Metric label="Active Signals" value={displaySignals.filter((s) => s.status === 'ACTIVE').length.toString()} unit={`/ ${TRAFFIC_SIGNALS.length}`} />
              <Metric label="Incidents" value={state.incidents.length.toString()} unit="open" accent={state.incidents.length > 0} />
            </div>

            {/* Signal table */}
            <div className="tsm__section-title">🔴 LIVE SIGNALS</div>
            <div className="tsm__signals">
              {displaySignals.map((sig) => (
                <SignalCard key={sig.signal_id} signal={sig} />
              ))}
            </div>

            {/* Roads table */}
            <div className="tsm__section-title">🛣 ROAD NETWORK</div>
            <div className="tsm__roads">
              {state.roads.map((r) => (
                <RoadRow key={r.road_id} road={r} />
              ))}
            </div>

            {/* Active incidents */}
            {state.incidents.length > 0 && (
              <>
                <div className="tsm__section-title" style={{ color: '#ef4444' }}>⚠ ACTIVE INCIDENTS</div>
                {state.incidents.map((inc) => (
                  <IncidentCard key={inc.id} incident={inc} />
                ))}
              </>
            )}

            {/* AI Advisory */}
            {state.aiAdvisory && <AdvisoryBox advisory={state.aiAdvisory} />}
          </div>
        )}

        {/* ══ ACCIDENT SIMULATION — FULL 16-STAGE SMART CITY WORKFLOW ══════ */}
        {state.activeView === 'accident' && (
          <div className="tsm__view">
            {accidentStage === 0 ? (
              <div className="tsm__empty">
                <span style={{ fontSize: 32 }}>🚦</span>
                <p>No active accident. Click <strong>[Trigger Accident]</strong> below to simulate the full 16-stage Smart City Command Center response workflow.</p>
              </div>
            ) : (
              <>
                {/* ── Stage Progress Timeline ────────────────────────────── */}
                <div className="tsm__stage-timeline">
                  {STAGE_LABELS.map((label, i) => {
                    const st = i + 1;
                    const done   = accidentStage > st;
                    const active = accidentStage === st;
                    return (
                      <div key={i} className={`tsm__stage-node${done ? ' tsm__stage-node--done' : active ? ' tsm__stage-node--active' : ''}`}>
                        <div className="tsm__stage-dot">{done ? '✓' : st}</div>
                        <div className="tsm__stage-name">{label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* ── STAGE 1 — Sensor Data Injection ───────────────────── */}
                {accidentStage === 1 && (
                  <div className="tsm__stage-card tsm__stage-card--scanning">
                    <div className="tsm__stage-title">🧪 STAGE 1 — SENSOR DATA INJECTION</div>
                    <div className="tsm__sensor-grid">
                      {[
                        ['Location',       '[55.3823, 25.1264]',         false],
                        ['Speed',          '0 km/h ⚠',                   true],
                        ['Vehicle Cluster','18 vehicles in 50 m²',        true],
                        ['Camera Status',  'OBSTRUCTION_DETECTED',        true],
                        ['Inflow Rate',    '+18 veh/min (anomalous)',      true],
                        ['Timestamp',      new Date().toLocaleTimeString('en-AE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}), false],
                      ].map(([k, v, alert], i) => (
                        <div key={i} className={`tsm__sensor-row${alert ? ' tsm__sensor-row--alert' : ''}`}>
                          <span>{k as string}</span><span>{v as string}</span>
                        </div>
                      ))}
                    </div>
                    <div className="tsm__scanning-bar"><div className="tsm__scanning-fill" /></div>
                    <div className="tsm__scanning-label">Injecting anomaly data into detection pipeline…</div>
                  </div>
                )}

                {/* ── STAGE 2 — Multi-Layer Validation ──────────────────── */}
                {accidentStage === 2 && (
                  <div className="tsm__stage-card">
                    <div className="tsm__stage-title">🔍 STAGE 2 — MULTI-LAYER DETECTION</div>
                    {[
                      ['Traffic Camera AI',     'Anomaly blob detected (conf: 0.94)'],
                      ['Vehicle Speed Sensors', 'Speed drop: 48 → 0 km/h in 1.2 s'],
                      ['Traffic Density Data',  'Cluster: 18 vehicles / 50 m² zone'],
                      ['Camera Frame Analysis', 'Stationary object in lane 2 confirmed'],
                    ].map(([src, result], i) => (
                      <div key={i} className="tsm__detection-row">
                        <span className="tsm__det-src">✓ {src}</span>
                        <span className="tsm__det-result">{result}</span>
                      </div>
                    ))}
                    <div className="tsm__detect-verdict">⚠ ACCIDENT SUSPECTED — Forwarding to AI Engine</div>
                  </div>
                )}

                {/* ── STAGE 3 — AI Incident Confirmation ────────────────── */}
                {accidentStage === 3 && (
                  <div className="tsm__stage-card">
                    <div className="tsm__stage-title">🧠 STAGE 3 — AI INCIDENT CONFIRMATION</div>
                    <div className="tsm__ai-checks">
                      {[
                        ['Signal wait?',          false],
                        ['Normal congestion?',     false],
                        ['Road obstruction?',      true],
                        ['Sudden speed-zero?',     true],
                      ].map(([label, yes], i) => (
                        <div key={i} className={`tsm__ai-check tsm__ai-check--${yes ? 'yes' : 'no'}`}>
                          <span>{label as string}</span>
                          <span>{yes ? '✓ YES' : '✗ NO'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="tsm__ai-result">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span className="tsm__ai-type">TRAFFIC ACCIDENT</span>
                        <span className="tsm__ai-severity">HIGH</span>
                      </div>
                      <div className="tsm__ai-conf">
                        <span>AI Confidence</span>
                        <div className="tsm__conf-bar"><div className="tsm__conf-fill" style={{ width: '92%' }} /></div>
                        <span className="tsm__conf-pct">92%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── STAGE 4 — Command Center Alert ────────────────────── */}
                {accidentStage === 4 && (
                  <div className="tsm__alert-banner">
                    <div className="tsm__alert-tag">🚨 CRITICAL ALERT — STAGE 4</div>
                    <div className="tsm__alert-title">ACCIDENT DETECTED</div>
                    <div className="tsm__alert-loc">📍 DSO Central Roundabout</div>
                    <div className="tsm__alert-meta">
                      <span>Impact Radius: 300 m</span><span>·</span>
                      <span>Severity: HIGH</span><span>·</span>
                      <span>2 lanes blocked</span>
                    </div>
                    <div className="tsm__alert-time">{new Date().toLocaleTimeString('en-AE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
                  </div>
                )}

                {/* ── NOTIFICATION SYSTEM — visible from stage 4 onwards ─── */}

                {/* ── Stage 5+ — Response Activated ────────────────────── */}
                {accidentStage >= 5 && (
                  <div className="tsm__stage-card tsm__stage-card--ok">
                    <div className="tsm__stage-title">📋 STAGE 5 — RESPONSE ACTIVATED</div>
                    <p style={{ fontSize: 12, color: '#4fc3f7', lineHeight: 1.6, margin: '4px 0 8px' }}>
                      Accident response panel is open on the right. Assign teams, send mobile notifications, and track live positions from there.
                    </p>
                    {!showResponsePanel && (
                      <button
                        className="tsm__dispatch-btn tsm__dispatch-btn--resp"
                        style={{ width: '100%' }}
                        onClick={() => setShowResponsePanel(true)}
                      >
                        📋 Open Response Panel
                      </button>
                    )}
                  </div>
                )}

                {/* ── CCTV Live Feeds (visible from stage 4 onwards) ────── */}
                {accidentStage >= 4 && (
                  <>
                    <div className="tsm__section-title">📷 LIVE CCTV FEEDS</div>
                    <div className="tsm__cctv-grid">
                      {/* Normal junction CCTV */}
                      <div className="tsm__cctv-cam">
                        <div className="tsm__cctv-tag">SIGNAL CAM · DSO-SIG-101</div>
                        <video className="tsm__cctv-video" src="/traffic_cctv_1.mp4" autoPlay muted loop playsInline />
                        <div className="tsm__cctv-overlay">
                          <span className="tsm__cctv-rec">● REC</span>
                          <span>{new Date().toLocaleTimeString('en-AE',{hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                      </div>
                      {/* Accident scene — Cam 1 (normal angle) */}
                      <div className="tsm__cctv-cam tsm__cctv-cam--alert">
                        <div className="tsm__cctv-tag">SCENE CAM 1</div>
                        <video className="tsm__cctv-video" src="/traffic_accident_cctv.mp4" autoPlay muted loop playsInline />
                        <div className="tsm__cctv-overlay">
                          <span className="tsm__cctv-rec tsm__cctv-rec--alert">● INCIDENT</span>
                        </div>
                      </div>
                      {/* Accident scene — Cam 2 (mirrored = opposite angle) */}
                      <div className="tsm__cctv-cam tsm__cctv-cam--alert">
                        <div className="tsm__cctv-tag">SCENE CAM 2 (Opp. Angle)</div>
                        <video className="tsm__cctv-video tsm__cctv-video--mirror" src="/traffic_accident_cctv.mp4" autoPlay muted loop playsInline />
                        <div className="tsm__cctv-overlay">
                          <span className="tsm__cctv-rec tsm__cctv-rec--alert">● INCIDENT</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Simulation Controls ─────────────────────────────────────────── */}
      <div className="tsm__sim">
        <div className="tsm__sim-title">SIMULATE</div>
        <div className="tsm__sim-btns">
          <button
            className={`tsm__sim-btn tsm__sim-btn--acc ${state.mode === 'accident' ? 'tsm__sim-btn--active' : ''}`}
            onClick={triggerAccident}
            disabled={simRunning}
          >
            🚧 Trigger Accident
          </button>
          <button
            className="tsm__sim-btn tsm__sim-btn--reset"
            onClick={resetAll}
            disabled={simRunning || state.mode === 'idle'}
          >
            ↺ Reset
          </button>
        </div>
      </div>

      {/* ── Advanced Accident Response Panel ─────────────────────────────── */}
      {showResponsePanel && accidentInfo && (
        <AccidentResponsePanel
          accident={accidentInfo}
          signals={state.signals}
          onClose={() => setShowResponsePanel(false)}
          onTasksChange={onAccidentTasksChange}
          onResolved={() => {
            setShowResponsePanel(false);
            setAccidentInfo(null);
          }}
        />
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Metric({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className={`tsm__metric ${accent ? 'tsm__metric--accent' : ''}`}>
      <div className="tsm__metric-value">{value}<span className="tsm__metric-unit">{unit}</span></div>
      <div className="tsm__metric-label">{label}</div>
    </div>
  );
}

function SignalCard({ signal }: { signal: TrafficSignal }) {
  const color = SIGNAL_COLOR[signal.state] ?? '#888';
  return (
    <div className="tsm__signal-card">
      <div className="tsm__signal-light" style={{ background: color, boxShadow: `0 0 8px 2px ${color}` }} />
      <div className="tsm__signal-info">
        <div className="tsm__signal-name">{signal.name}</div>
        <div className="tsm__signal-meta">
          <span>{signal.signal_id}</span>
          <span>·</span>
          <span>{signal.connected_roads} roads</span>
          <span>·</span>
          <span>{signal.vehicle_density} veh/km</span>
        </div>
      </div>
      <div className="tsm__signal-state" style={{ color }}>
        {signal.state}
      </div>
    </div>
  );
}

function RoadRow({ road }: { road: RoadSegment }) {
  const color = CONGESTION_COLOR[road.congestion_level] ?? '#888';
  const pct   = Math.min(road.congestion_index * 100, 100);
  return (
    <div className="tsm__road-row">
      <div className="tsm__road-main">
        <span className="tsm__road-name">{road.name}</span>
        <span className="tsm__road-speed">{road.avg_speed} km/h</span>
        <span className="tsm__road-count">{road.vehicle_count} veh</span>
        <span className="tsm__road-level" style={{ color }}>{road.congestion_level}</span>
      </div>
      <div className="tsm__road-bar">
        <div className="tsm__road-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function IncidentCard({ incident, large }: { incident: TrafficIncident; large?: boolean }) {
  const color = incident.severity === 'HIGH' ? '#ef4444' : incident.severity === 'MEDIUM' ? '#f59e0b' : '#22c55e';
  return (
    <div className={`tsm__incident ${large ? 'tsm__incident--large' : ''}`} style={{ borderColor: color }}>
      <div className="tsm__incident-head" style={{ color }}>
        {incident.type === 'accident' ? '🚧' : '🔴'} {incident.type.toUpperCase()} · {incident.severity}
      </div>
      <div className="tsm__incident-name">{incident.name}</div>
      <div className="tsm__incident-desc">{incident.description}</div>
      <div className="tsm__incident-time">{new Date(incident.timestamp).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  );
}

function AdvisoryBox({ advisory }: { advisory: NonNullable<TrafficState['aiAdvisory']> }) {
  return (
    <div className="tsm__advisory">
      <div className="tsm__advisory-title">🤖 AI ADVISORY</div>
      <div className="tsm__advisory-head">{advisory.title}</div>
      <div className="tsm__advisory-sub">{advisory.subtitle}</div>
      <div className="tsm__advisory-divider" />
      <div className="tsm__advisory-rec-label">Recommended Actions:</div>
      <ol className="tsm__advisory-list">
        {advisory.items.map((item, i) => <li key={i}>{item}</li>)}
      </ol>
      {advisory.metric    && <div className="tsm__advisory-metric">{advisory.metric}</div>}
      {advisory.clearTime && <div className="tsm__advisory-metric">{advisory.clearTime}</div>}
    </div>
  );
}

const TAB_LABELS: Record<TrafficView, string> = {
  live:       'Live Traffic',
  congestion: 'Congestion',
  accident:   'Accident',
};

// ── End of TrafficSignalManager ────────────────────────────────────────────────