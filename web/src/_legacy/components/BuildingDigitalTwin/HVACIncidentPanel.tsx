import { useState, useEffect, useRef } from 'react';
import './HVACIncidentPanel.scss';

// ── Types ─────────────────────────────────────────────────────────────────────
type StepStatus = 'pending' | 'in_progress' | 'waiting_approval' | 'done' | 'skipped';
type TeamRole   = 'HVAC Tech' | 'Facility Manager' | 'BMS Engineer' | 'Temp Labour' | 'Procurement';

interface RemedStep {
  id:       string;
  seq:      number;
  title:    string;
  detail:   string;
  owner:    TeamRole;
  eta:      string;          // human-readable e.g. "8 min"
  etaMs:    number;          // actual timer ms
  requires: 'auto' | 'approval';
  status:   StepStatus;
  startedAt?: number;
}

interface TeamMember {
  name:   string;
  role:   TeamRole;
  badge:  string;
  phone:  string;
  status: 'notified' | 'acknowledged' | 'on_site' | 'standby';
  eta:    string;
}

interface NotifTarget {
  id:     string;
  team:   string;
  icon:   string;
  method: 'SMS' | 'App Push' | 'Email' | 'Radio';
  status: 'queued' | 'sending' | 'delivered' | 'acknowledged';
  sentAt: number;
}

// ── Static data ───────────────────────────────────────────────────────────────
const HVAC_FAULT = {
  id:          'INC-2026-0413-007',
  timestamp:   '13 Apr 2026 · 09:42:18',
  severity:    'HIGH' as const,
  unit:        'AHU-01',
  location:    'F1 – Left Wing · Duct Shaft α',
  fault:       'Airflow < 38% nominal · Compressor trip',
  temp:        '28.4°C (setpoint 22°C)',
  affected:    'F1: Lobby, Cafeteria, Training Rm, Lab · 6 FCUs offline',
  occupants:   97,
  sla:         '45 min',
};

const REMEDIATION_STEPS: Omit<RemedStep, 'status' | 'startedAt'>[] = [
  {
    id: 'R1', seq: 1,
    title:   'Confirm fault via BMS sensor array',
    detail:  'Cross-check AHU-01 trip code with vibration sensor, differential pressure and compressor log. Rule out sensor false-positive.',
    owner:   'BMS Engineer',   eta: '3 min',  etaMs: 3000,  requires: 'auto',
  },
  {
    id: 'R2', seq: 2,
    title:   'Isolate AHU-01 — transfer load to AHU-02',
    detail:  'Via BMS: navigate HVAC → AHU-01 → Emergency Bypass. Enable Load Transfer to AHU-02. Verify AHU-02 ramp-up to 110 % capacity.',
    owner:   'BMS Engineer',   eta: '4 min',  etaMs: 4000,  requires: 'approval',
  },
  {
    id: 'R3', seq: 3,
    title:   'Issue temperature advisory to F1 occupants',
    detail:  'Send building-wide push notification + PA announcement. Advise occupants of temporary HVAC delay. Open window vents on south façade.',
    owner:   'Facility Manager', eta: '2 min', etaMs: 2000, requires: 'auto',
  },
  {
    id: 'R4', seq: 4,
    title:   'Dispatch HVAC technician to AHU-01',
    detail:  'Technician to bring: AHU-01 service kit, compressor contactor spare, refrigerant re-charge kit. Access via F3 plant stairwell.',
    owner:   'HVAC Tech',      eta: '8 min',  etaMs: 6000,  requires: 'auto',
  },
  {
    id: 'R5', seq: 5,
    title:   'Deploy temporary cooling units — F1 hotspots',
    detail:  'Retrieve 3× portable AC units from B1 store (bay 4). Position: Lobby corridor, Training Rm doorway, Lab entrance. Connect to F1 dedicated circuit.',
    owner:   'Temp Labour',    eta: '15 min', etaMs: 8000,  requires: 'approval',
  },
  {
    id: 'R6', seq: 6,
    title:   'Diagnose & repair AHU-01',
    detail:  'Technician on-site: inspect compressor contactor, check refrigerant charge, re-seat belt drive. Log all findings in BMS maintenance record.',
    owner:   'HVAC Tech',      eta: '35 min', etaMs: 10000, requires: 'auto',
  },
  {
    id: 'R7', seq: 7,
    title:   'Recommission AHU-01 & rebalance zones',
    detail:  'Restart AHU-01. Monitor airflow ramp-up. Re-assign FCUs to primary AHU-01 feed. Withdraw portable units when zone temp reaches 23°C.',
    owner:   'BMS Engineer',   eta: '10 min', etaMs: 5000,  requires: 'approval',
  },
  {
    id: 'R8', seq: 8,
    title:   'Close incident — sign off & log',
    detail:  'Facility Manager verifies all zones at setpoint ±1°C. Record incident in CAFM system. Schedule AHU-01 preventive maintenance within 7 days.',
    owner:   'Facility Manager', eta: '5 min', etaMs: 2000, requires: 'approval',
  },
];

const TEAM_MEMBERS: TeamMember[] = [
  { name: 'Khalid Al Mansoori', role: 'HVAC Tech',        badge: '🔧', phone: '+971-50-111-2233', status: 'notified',  eta: '8 min'  },
  { name: 'Sarah Chen',         role: 'BMS Engineer',      badge: '💻', phone: '+971-50-244-5566', status: 'notified',  eta: '2 min'  },
  { name: 'Ravi Menon',         role: 'Facility Manager',  badge: '🏢', phone: '+971-55-377-8899', status: 'notified',  eta: '5 min'  },
  { name: 'Mohammed Al Zaabi',  role: 'Temp Labour',       badge: '🔨', phone: '+971-52-488-0011', status: 'standby',   eta: '12 min' },
  { name: 'Layla Ibrahim',      role: 'Procurement',       badge: '📦', phone: '+971-56-599-2233', status: 'standby',   eta: 'Remote' },
];

const NOTIF_TARGETS: Omit<NotifTarget, 'status' | 'sentAt'>[] = [
  { id: 't1', team: 'HVAC Maintenance',  icon: '🔧', method: 'App Push' },
  { id: 't2', team: 'BMS Control Room',  icon: '💻', method: 'App Push' },
  { id: 't3', team: 'Facility Manager',  icon: '🏢', method: 'SMS'      },
  { id: 't4', team: 'Building Security', icon: '🛡️', method: 'Radio'    },
  { id: 't5', team: 'HR / EHS Office',   icon: '👷', method: 'Email'    },
  { id: 't6', team: 'DSO Operations',    icon: '📡', method: 'Email'    },
];

const STATUS_PROG: NotifTarget['status'][] = ['queued','sending','delivered','acknowledged'];
const STATUS_THRESH_S = [0, 1.5, 4, 8];

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending:          'Pending',
  in_progress:      'In Progress',
  waiting_approval: 'Awaiting Approval',
  done:             'Completed',
  skipped:          'Skipped',
};

interface Props {
  onClose:    () => void;
  onResolve?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function HVACIncidentPanel({ onClose, onResolve }: Props) {
  const [phase,      setPhase]      = useState<'brief' | 'plan' | 'exec'>('brief');
  const [steps,      setSteps]      = useState<RemedStep[]>(
    REMEDIATION_STEPS.map(s => ({ ...s, status: 'pending' as StepStatus }))
  );
  const [notifs,     setNotifs]     = useState<NotifTarget[]>([]);
  const [team,       setTeam]       = useState<TeamMember[]>(TEAM_MEMBERS);
  const [activeStep, setActiveStep] = useState(-1);   // which step is expanded
  const [elapsed,    setElapsed]    = useState(0);
  const [incidentStarted, setIncidentStarted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Elapsed clock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!incidentStarted) return;
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [incidentStarted]);

  // ── Launch incident: seed notifications and start ──────────────────────
  const launchIncident = () => {
    setIncidentStarted(true);
    const now = Date.now();
    setNotifs(NOTIF_TARGETS.map(t => ({ ...t, status: 'queued', sentAt: now })));
    setPhase('plan');
  };

  // ── Auto-progress notifications ────────────────────────────────────────
  useEffect(() => {
    if (notifs.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setNotifs(prev => {
        let changed = false;
        const next = prev.map(n => {
          const curIdx  = STATUS_PROG.indexOf(n.status);
          const elapsed = (now - n.sentAt) / 1000;
          const nextIdx = curIdx + 1;
          if (nextIdx < STATUS_PROG.length && elapsed > STATUS_THRESH_S[nextIdx]) {
            changed = true;
            return { ...n, status: STATUS_PROG[nextIdx] };
          }
          return n;
        });
        return changed ? next : prev;
      });
    }, 800);
    return () => clearInterval(t);
  }, [notifs.length]);

  // ── Auto-progress team status ──────────────────────────────────────────
  useEffect(() => {
    if (!incidentStarted) return;
    const timers = [
      setTimeout(() => setTeam(prev => prev.map(m =>
        m.role === 'BMS Engineer' ? { ...m, status: 'acknowledged' } : m)), 4000),
      setTimeout(() => setTeam(prev => prev.map(m =>
        m.role === 'BMS Engineer' ? { ...m, status: 'on_site' } : m)), 9000),
      setTimeout(() => setTeam(prev => prev.map(m =>
        m.role === 'Facility Manager' ? { ...m, status: 'acknowledged' } : m)), 6000),
      setTimeout(() => setTeam(prev => prev.map(m =>
        m.role === 'HVAC Tech' ? { ...m, status: 'acknowledged' } : m)), 12000),
      setTimeout(() => setTeam(prev => prev.map(m =>
        m.role === 'HVAC Tech' ? { ...m, status: 'on_site' } : m)), 22000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [incidentStarted]);

  // ── Start execution phase ──────────────────────────────────────────────
  const startExecution = () => {
    setPhase('exec');
    beginStep(0);
  };

  // ── Begin a step ──────────────────────────────────────────────────────
  const beginStep = (idx: number) => {
    if (idx >= REMEDIATION_STEPS.length) return;
    const step = REMEDIATION_STEPS[idx];
    setSteps(prev => prev.map((s, i) =>
      i === idx ? { ...s, status: step.requires === 'approval' ? 'waiting_approval' : 'in_progress', startedAt: Date.now() }
                : s
    ));
    setActiveStep(idx);

    if (step.requires === 'auto') {
      setTimeout(() => completeStep(idx), step.etaMs);
    }
    // if 'approval', user must tap Approve
  };

  const approveStep = (idx: number) => {
    setSteps(prev => prev.map((s, i) =>
      i === idx ? { ...s, status: 'in_progress', startedAt: Date.now() } : s
    ));
    const step = REMEDIATION_STEPS[idx];
    setTimeout(() => completeStep(idx), step.etaMs);
  };

  const completeStep = (idx: number) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'done' } : s));
    const nextIdx = idx + 1;
    if (nextIdx < REMEDIATION_STEPS.length) {
      setTimeout(() => beginStep(nextIdx), 600);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const doneCount   = steps.filter(s => s.status === 'done').length;
  const totalSteps  = steps.length;
  const pct         = Math.round((doneCount / totalSteps) * 100);
  const allDone     = doneCount === totalSteps;
  const elapsedStr  = `${String(Math.floor(elapsed / 60)).padStart(2,'0')}:${String(elapsed % 60).padStart(2,'0')}`;
  const nAck        = notifs.filter(n => n.status === 'acknowledged').length;

  const stepColor = (s: StepStatus) => {
    if (s === 'done')             return '#4ade80';
    if (s === 'in_progress')      return '#60a5fa';
    if (s === 'waiting_approval') return '#fbbf24';
    if (s === 'pending')          return '#475569';
    return '#6b7280';
  };

  const notifStatusColor = (s: NotifTarget['status']) => {
    if (s === 'acknowledged') return '#4ade80';
    if (s === 'delivered')    return '#60a5fa';
    if (s === 'sending')      return '#fbbf24';
    return '#475569';
  };

  const teamStatusColor = (s: TeamMember['status']) => {
    if (s === 'on_site')      return '#4ade80';
    if (s === 'acknowledged') return '#60a5fa';
    if (s === 'notified')     return '#fbbf24';
    return '#475569';
  };

  return (
    <div className="hip__overlay">
      <div className="hip__panel">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="hip__header">
          <div className="hip__header-left">
            <span className="hip__badge hip__badge--high">HIGH</span>
            <div>
              <div className="hip__title">HVAC Fault — AHU-01 Failure</div>
              <div className="hip__subtitle">{HVAC_FAULT.id} · {HVAC_FAULT.timestamp}</div>
            </div>
          </div>
          <div className="hip__header-right">
            {incidentStarted && (
              <div className="hip__timer">
                <span className="hip__timer-icon">⏱</span>
                <span className="hip__timer-val">{elapsedStr}</span>
                <span className="hip__timer-lbl">elapsed</span>
                <span className="hip__timer-sla">SLA: {HVAC_FAULT.sla}</span>
              </div>
            )}
            <button className="hip__close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── Phase tabs ─────────────────────────────────────────────── */}
        <div className="hip__tabs">
          {(['brief','plan','exec'] as const).map(t => (
            <button key={t}
              className={`hip__tab ${phase === t ? 'hip__tab--active' : ''}`}
              onClick={() => setPhase(t)}>
              {t === 'brief' ? '📋 Incident Brief'
               : t === 'plan'  ? '📝 Response Plan'
               :                  `⚙ Execution ${pct}%`}
            </button>
          ))}
        </div>

        {/* ── BRIEF ──────────────────────────────────────────────────── */}
        {phase === 'brief' && (
          <div className="hip__body hip__body--brief">

            {/* Fault card */}
            <div className="hip__fault-card">
              <div className="hip__fault-header">
                <span className="hip__pulse-dot" />
                <span>ACTIVE FAULT</span>
                <span className="hip__fault-unit">{HVAC_FAULT.unit}</span>
              </div>
              <div className="hip__fault-grid">
                {[
                  ['Location',    HVAC_FAULT.location],
                  ['Fault code',  HVAC_FAULT.fault],
                  ['Zone temp',   HVAC_FAULT.temp],
                  ['Affected',    HVAC_FAULT.affected],
                  ['Occupants',   `${HVAC_FAULT.occupants} people at risk`],
                  ['SLA target',  HVAC_FAULT.sla],
                ].map(([k, v]) => (
                  <div key={k} className="hip__fault-row">
                    <span className="hip__fault-key">{k}</span>
                    <span className="hip__fault-val">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* AI advisory */}
            <div className="hip__ai-advisory">
              <div className="hip__ai-header">
                <span className="hip__ai-icon">🤖</span>
                <span>AI Advisory — Recommended Actions</span>
                <span className="hip__ai-risk hip__ai-risk--high">Risk: HIGH</span>
              </div>
              <ol className="hip__ai-list">
                {[
                  'Isolate AHU-01 — transfer zone load to AHU-02 backup circuit immediately',
                  'Increase Chiller-1 setpoint output for Zone A thermal compensation',
                  'Issue temperature advisory to all F1 occupants via push notification',
                  'Dispatch HVAC maintenance team with AHU-01 service kit (ETA 8 min)',
                  'Deploy 3× portable AC units from B1 store to F1 hotspot zones',
                  'Recommission AHU-01 on-site repair — estimated 35 min downtime',
                ].map((a, i) => (
                  <li key={i} className="hip__ai-action">{a}</li>
                ))}
              </ol>
              <div className="hip__ai-note">
                💡 Estimated repair time: 45 min. Portable cooling units available at B1 bay 4. Occupancy advisory: consider relocating training sessions from F1 Training Rm.
              </div>
            </div>

            {/* Impact summary row */}
            <div className="hip__impact-row">
              {[
                { label: 'Airflow', value: '38%',   color: '#ef4444', sub: 'of nominal' },
                { label: 'Zone Temp', value: '28.4°', color: '#fb923c', sub: 'F1 average' },
                { label: 'FCUs down', value: '6',   color: '#fbbf24', sub: 'cassettes' },
                { label: 'Occupants', value: '97',  color: '#60a5fa', sub: 'affected'  },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="hip__impact-card">
                  <div className="hip__impact-val" style={{ color }}>{value}</div>
                  <div className="hip__impact-label">{label}</div>
                  <div className="hip__impact-sub">{sub}</div>
                </div>
              ))}
            </div>

            <button className="hip__cta" onClick={launchIncident} disabled={incidentStarted}>
              {incidentStarted ? '✓ Plan Activated' : '🚀 Activate Response Plan'}
            </button>
          </div>
        )}

        {/* ── PLAN ───────────────────────────────────────────────────── */}
        {phase === 'plan' && (
          <div className="hip__body hip__body--plan">
            <div className="hip__plan-cols">

              {/* Left: Notification status */}
              <div className="hip__plan-col">
                <div className="hip__section-title">📡 Notifications Sent</div>
                <div className="hip__notif-list">
                  {notifs.map(n => (
                    <div key={n.id} className="hip__notif-row">
                      <span className="hip__notif-icon">{n.icon}</span>
                      <div className="hip__notif-info">
                        <div className="hip__notif-team">{n.team}</div>
                        <div className="hip__notif-method">{n.method}</div>
                      </div>
                      <div className="hip__notif-status" style={{ color: notifStatusColor(n.status) }}>
                        <span className="hip__notif-dot" style={{ background: notifStatusColor(n.status) }} />
                        {n.status.charAt(0).toUpperCase() + n.status.slice(1)}
                      </div>
                    </div>
                  ))}
                  {notifs.length === 0 && (
                    <div className="hip__empty">Activate plan to send notifications</div>
                  )}
                </div>
                <div className="hip__notif-summary">
                  {nAck}/{notifs.length} teams acknowledged
                </div>
              </div>

              {/* Right: Team dispatch */}
              <div className="hip__plan-col">
                <div className="hip__section-title">👷 Team Dispatch</div>
                <div className="hip__team-list">
                  {team.map(m => (
                    <div key={m.name} className="hip__team-row">
                      <span className="hip__team-badge">{m.badge}</span>
                      <div className="hip__team-info">
                        <div className="hip__team-name">{m.name}</div>
                        <div className="hip__team-role">{m.role} · {m.phone}</div>
                      </div>
                      <div className="hip__team-right">
                        <div className="hip__team-status" style={{ color: teamStatusColor(m.status) }}>
                          {m.status === 'on_site' ? '✓ On site'
                           : m.status === 'acknowledged' ? '✓ Ack'
                           : m.status === 'notified'     ? '📲 Notified'
                           :                               '⏳ Standby'}
                        </div>
                        <div className="hip__team-eta">ETA {m.eta}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Remediation plan overview */}
            <div className="hip__section-title" style={{ marginTop: '1rem' }}>📋 Remediation Plan Overview</div>
            <div className="hip__plan-steps">
              {REMEDIATION_STEPS.map((s) => (
                <div key={s.id} className="hip__plan-step">
                  <div className="hip__plan-step-seq">{s.seq}</div>
                  <div className="hip__plan-step-body">
                    <div className="hip__plan-step-title">{s.title}</div>
                    <div className="hip__plan-step-meta">
                      <span className="hip__plan-step-owner">{s.owner}</span>
                      <span className="hip__plan-step-eta">⏱ {s.eta}</span>
                      {s.requires === 'approval' && <span className="hip__plan-step-appr">⚠ Approval required</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button className="hip__cta" onClick={startExecution} disabled={!incidentStarted || (phase as string) === 'exec'}>
              {(phase as string) === 'exec' ? '✓ Execution in progress' : '▶ Begin Step-by-Step Execution'}
            </button>
          </div>
        )}

        {/* ── EXECUTION ──────────────────────────────────────────────── */}
        {phase === 'exec' && (
          <div className="hip__body hip__body--exec">

            {/* Progress bar */}
            <div className="hip__progress-bar-wrap">
              <div className="hip__progress-bar-track">
                <div className="hip__progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="hip__progress-label">{doneCount}/{totalSteps} steps complete · {pct}%</div>
            </div>

            {/* Steps */}
            <div className="hip__exec-steps">
              {steps.map((step, idx) => {
                const color = stepColor(step.status);
                const isActive = activeStep === idx;
                return (
                  <div
                    key={step.id}
                    className={`hip__exec-step ${isActive ? 'hip__exec-step--active' : ''} hip__exec-step--${step.status}`}
                    onClick={() => setActiveStep(isActive ? -1 : idx)}
                  >
                    {/* Step header */}
                    <div className="hip__exec-step-header">
                      <div className="hip__exec-step-num" style={{ borderColor: color, color }}>
                        {step.status === 'done' ? '✓' : step.seq}
                      </div>
                      <div className="hip__exec-step-title">{step.title}</div>
                      <div className="hip__exec-step-meta">
                        <span className="hip__exec-step-owner">{step.owner}</span>
                        <span className="hip__exec-step-status" style={{ color }}>
                          {STEP_STATUS_LABEL[step.status]}
                        </span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isActive && (
                      <div className="hip__exec-step-detail">
                        <div className="hip__exec-step-text">{step.detail}</div>
                        <div className="hip__exec-step-actions">
                          <span className="hip__exec-step-eta">⏱ Expected: {step.eta}</span>
                          {step.status === 'waiting_approval' && (
                            <button
                              className="hip__approve-btn"
                              onClick={e => { e.stopPropagation(); approveStep(idx); }}>
                              ✅ Approve &amp; Execute
                            </button>
                          )}
                          {step.status === 'in_progress' && (
                            <span className="hip__in-prog-indicator">
                              <span className="hip__spinner" />
                              In progress…
                            </span>
                          )}
                          {step.status === 'done' && (
                            <span className="hip__done-badge">✓ Completed</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Resolution */}
            {allDone && (
              <div className="hip__resolved">
                <div className="hip__resolved-icon">✅</div>
                <div className="hip__resolved-title">Incident Resolved</div>
                <div className="hip__resolved-sub">
                  All {totalSteps} remediation steps complete · AHU-01 recommissioned · Zones at setpoint
                </div>
                <div className="hip__resolved-meta">
                  ⏱ Resolution time: {elapsedStr} · SLA: {HVAC_FAULT.sla}
                  {elapsed <= 2700 ? ' ✓ Within SLA' : ' ⚠ SLA breached'}
                </div>
                <button className="hip__cta hip__cta--green" onClick={() => { onResolve?.(); onClose(); }}>
                  ✓ Close &amp; Log Incident
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
