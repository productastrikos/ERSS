// ─────────────────────────────────────────────────────────────────────────────
//  AccidentResponsePanel — Full accident lifecycle:
//  Detection → Alert → AI Advisory → Assignment → Live Tracking → Resolution
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TrafficSignal } from '../../types';
import { getSocket } from '../../utils/socket';
import { buildRoute } from '../../data/technicians';
import {
  type Responder,
  type AccidentTask,
  type TaskStatus,
  type AccidentAIAdvisory,
  ROLE_COLORS,
  ROLE_LABELS,
  TASK_STATUS_COLORS,
  getNearestResponders,
  generateAIAdvisory,
  haversine,
} from '../../data/responders';
import './AccidentResponsePanel.scss';

// ── Props ────────────────────────────────────────────────────────────────────
export interface AccidentInfo {
  id:            string;
  signalId:      string;
  signalName:    string;
  location:      [number, number]; // [lng, lat]
  severity:      'LOW' | 'MEDIUM' | 'HIGH';
  timestamp:     number;
  speedDrop:     number;
  vehicleDensity: number;
  suddenStop:    boolean;
  cameraFlag:    boolean;
}

interface Props {
  accident:       AccidentInfo;
  signals:        TrafficSignal[];
  onClose:        () => void;
  /** Callback: dispatched tasks (for map animation layer) */
  onTasksChange?: (tasks: AccidentTask[]) => void;
  /** Callback: resolved */
  onResolved?:    () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const fmtETA = (sec: number) => {
  if (sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// ── Shared team member type (populated from socket users_update) ────────────
interface TeamMember {
  userId:  string;
  name:    string;
  role:    string;
  online:  boolean;
  status:  string;
  lastLat: number | null;
  lastLng: number | null;
  distKm?: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function AccidentResponsePanel({ accident, signals, onClose, onTasksChange, onResolved }: Props) {
  // ── State ──────────────────────────────────────────────────────────────
  type Phase = 'detected' | 'advisory' | 'assign' | 'tracking' | 'resolved';
  const [phase, setPhase]               = useState<Phase>('detected');
  const [advisory, setAdvisory]         = useState<AccidentAIAdvisory | null>(null);
  const [showAssignPopup, setShowAssign]= useState(false);
  const [tasks, setTasks]               = useState<AccidentTask[]>([]);
  const [teamMembers, setTeamMembers]   = useState<TeamMember[]>([]);
  const [showTeamMgr, setShowTeamMgr]   = useState(false);
  const [timeline, setTimeline]         = useState<{ time: string; label: string; icon: string }[]>([
    { time: fmtTime(accident.timestamp), label: 'Accident detected by sensor fusion', icon: '🚨' },
  ]);

  const tickRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // ── Socket: track all registered team members (online + offline) ───────────
  useEffect(() => {
    const socket = getSocket();
    const handleUsers = (list: { userId: string; name: string; role: string; online: boolean; status: string; lastLat: number | null; lastLng: number | null }[]) => {
      setTeamMembers(list.map(u => ({
        ...u,
        distKm: (u.lastLat != null && u.lastLng != null)
          ? haversine([u.lastLng, u.lastLat], accident.location)
          : undefined,
      })));
    };
    socket.on('users_update', handleUsers);
    socket.emit('get_users');
    return () => { socket.off('users_update', handleUsers); };
  }, [accident.location]);

  // ── AI Advisory auto-generate ──────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const ai = generateAIAdvisory(accident.severity, accident.signalName);
      setAdvisory(ai);
      setPhase('advisory');
      addTimeline('AI advisory generated', '🤖');
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Task lifecycle ticker ──────────────────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setTasks(prev => {
        let changed = false;
        const updated = prev.map(t => {
          if (t.status === 'ARRIVED' || t.status === 'RESOLVED') return t;
          const elapsed = (Date.now() - t.sentAt) / 1000;
          let next: TaskStatus = t.status;
          let acceptedAt = t.acceptedAt;
          let arrivedAt  = t.arrivedAt;
          let currentPos = t.currentPos;
          let etaSec     = t.etaSec;

          if (t.status === 'PENDING' && elapsed > 1) next = 'SENT';
          if (t.status === 'SENT' && elapsed > 3)    next = 'DELIVERED';
          // No auto-advance past DELIVERED — waits for real mobile accept
          // EN_ROUTE: 2s after accepted (real accept sets acceptedAt via socket)
          if (t.status === 'ACCEPTED') {
            const sinceAccepted = t.acceptedAt ? (Date.now() - t.acceptedAt) / 1000 : 0;
            if (sinceAccepted > 2) next = 'EN_ROUTE';
          }
          if (t.status === 'EN_ROUTE') {
            // Use real accept time so interpolation starts correctly regardless of how long accept took
            const travelElapsed = t.acceptedAt
              ? Math.max(0, (Date.now() - t.acceptedAt) / 1000)
              : Math.max(0, elapsed - 9);
            const travelTotal   = t.distKm / 35 * 3600;
            etaSec = Math.max(0, travelTotal - travelElapsed);

            if ((t as AccidentTask & { realPos?: [number, number] }).realPos) {
              // Priority 1: real GPS position from mobile app (already follows road if mobile OSRM worked)
              currentPos = (t as AccidentTask & { realPos?: [number, number] }).realPos!;
            } else if (t.routeCoords && t.routeCoords.length >= 2) {
              // Priority 2: interpolate along OSRM road waypoints fetched by dashboard
              const pct  = Math.min(0.99, travelElapsed / Math.max(travelTotal, 30));
              const fIdx = pct * (t.routeCoords.length - 1);
              const lo   = Math.floor(fIdx);
              const hi   = Math.min(lo + 1, t.routeCoords.length - 1);
              const a    = fIdx - lo;
              const wp1  = t.routeCoords[lo];
              const wp2  = t.routeCoords[hi];
              currentPos = [
                wp1[0] + (wp2[0] - wp1[0]) * a,
                wp1[1] + (wp2[1] - wp1[1]) * a,
              ];
            } else {
              // Priority 3: straight-line fallback (route not yet loaded)
              const pct = Math.min(0.95, travelElapsed / Math.max(travelTotal, 30));
              currentPos = [
                t.origin[0] + (t.destination[0] - t.origin[0]) * pct,
                t.origin[1] + (t.destination[1] - t.origin[1]) * pct,
              ];
            }
          }

          if (next !== t.status) {
            changed = true;
            return { ...t, status: next, acceptedAt, arrivedAt, currentPos, etaSec };
          }
          if (t.status === 'EN_ROUTE') {
            changed = true;
            return { ...t, currentPos, etaSec };
          }
          return t;
        });
        return changed ? updated : prev;
      });
    }, 500);
    return () => clearInterval(tickRef.current);
  }, []);

  // ── Push task changes upstream ─────────────────────────────────────────
  useEffect(() => { onTasksChange?.(tasks); }, [tasks, onTasksChange]);

  // ── Auto-transition to tracking phase when first task dispatched ───────
  useEffect(() => {
    if (tasks.length > 0 && phase === 'assign') setPhase('tracking');
  }, [tasks, phase]);

  // ── Auto-resolve when all tasks arrived ────────────────────────────────
  useEffect(() => {
    if (tasks.length > 0 && tasks.every(t => t.status === 'ARRIVED' || t.status === 'RESOLVED')) {
      if (phase !== 'resolved') {
        addTimeline('All responders on scene', '✅');
      }
    }
  }, [tasks, phase]);


  // ── Timeline helper ────────────────────────────────────────────────────
  const addTimeline = useCallback((label: string, icon: string) => {
    setTimeline(prev => [...prev, { time: fmtTime(Date.now()), label, icon }]);
  }, []);

  // ── Dispatch a responder ───────────────────────────────────────────────
  const dispatchResponder = useCallback((
    responder: Responder & { distKm: number; etaMin: number },
    commModes: ('app' | 'sms' | 'email')[],
  ) => {
    const task: AccidentTask = {
      taskId:        `${accident.id}-${responder.id}`,
      responderId:   responder.id,
      responderName: responder.name,
      role:          responder.role,
      vehicle:       responder.vehicle,
      icon:          responder.icon,
      status:        'PENDING',
      origin:        responder.location,
      destination:   accident.location,
      currentPos:    responder.location,
      distKm:        responder.distKm,
      etaSec:        responder.etaMin * 60,
      sentAt:        Date.now(),
      acceptedAt:    null,
      arrivedAt:     null,
      resolvedAt:    null,
      commModes,
    };
    setTasks(prev => [...prev, task]);
    addTimeline(`${ROLE_LABELS[responder.role]}: ${responder.name} dispatched`, responder.icon);

    // Fetch road-following route from OSRM immediately (dashboard-side, independent of mobile).
    // This ensures the route line and marker animation follow roads even if the mobile app
    // cannot reach the OSRM server or hasn't relayed its own route yet.
    buildRoute(task.origin, task.destination).then(coords => {
      if (coords.length >= 2) {
        setTasks(prev => prev.map(t =>
          t.taskId === task.taskId ? { ...t, routeCoords: coords } : t
        ));
      }
    });

    // Emit task to mobile responder via socket
    const socket = getSocket();
    socket.emit('send_task', {
      taskId:        task.taskId,
      responderId:   responder.id,
      responderName: responder.name,
      role:          ROLE_LABELS[responder.role],
      vehicle:       responder.vehicle,
      icon:          responder.icon,
      signalName:    accident.signalName,
      severity:      accident.severity,
      location:      accident.location,
      distKm:        responder.distKm,
      etaMin:        responder.etaMin,
      message:       `Accident at ${accident.signalName}. Severity: ${accident.severity}. Please respond immediately.`,
      // Incident metadata for mobile responder
      incidentType:  `Speed drop ${accident.speedDrop}% | Vehicles: ${accident.vehicleDensity}${accident.suddenStop ? ' | Sudden stop' : ''}`,
      detectedAt:    new Date(accident.timestamp).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      // CCTV data (only if camera flagged the incident)
      cctvCameraId:  accident.cameraFlag ? `CAM-${accident.signalId.replace(/[^A-Za-z0-9]/g, '-').toUpperCase()}` : undefined,
      cctvTimestamp: accident.cameraFlag ? new Date(accident.timestamp).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : undefined,
    });

    setShowAssign(false);
  }, [accident, addTimeline]);


  // ── Socket: listen for real mobile events ─────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { taskId: string; status: string; userId: string; ts: number }) => {
      setTasks(prev => prev.map(t => {
        if (t.taskId !== data.taskId) return t;
        const upd: Partial<AccidentTask> = { status: data.status as TaskStatus };
        if (data.status === 'ACCEPTED') {
          upd.acceptedAt = data.ts;
          addTimeline('Task accepted on mobile device', '✅');
        }
        if (data.status === 'ARRIVED') {
          upd.arrivedAt = data.ts;
          addTimeline('Responder arrived at scene', '📍');
        }
        if (data.status === 'RESOLVED') {
          upd.resolvedAt = data.ts;
          addTimeline('Responder marked task complete', '🟢');
        }
        return { ...t, ...upd };
      }));
    };

    const handleLocation = (data: { userId: string; lat: number; lng: number; taskId: string }) => {
      setTasks(prev => prev.map(t => {
        if (t.taskId !== data.taskId) return t;
        const newPos: [number, number] = [data.lng, data.lat];
        const newStatus: TaskStatus = (t.status === 'ACCEPTED' || t.status === 'EN_ROUTE') ? 'EN_ROUTE' : t.status;
        // Store realPos so the ticker uses the real GPS instead of straight-line
        const updated = { ...t, currentPos: newPos, status: newStatus };
        (updated as AccidentTask & { realPos: [number, number] }).realPos = newPos;
        return updated as AccidentTask;
      }));
    };

    const handleRoute = ({ taskId, coords }: { taskId: string; coords: [number, number][] }) => {
      setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, routeCoords: coords } : t));
    };
    socket.on('task_status_update', handleStatus);
    socket.on('responder_location', handleLocation);
    socket.on('task_route', handleRoute);
    return () => {
      socket.off('task_status_update', handleStatus);
      socket.off('responder_location', handleLocation);
      socket.off('task_route', handleRoute);
    };
  }, [addTimeline]);

  // ── Mark resolved ──────────────────────────────────────────────────────
  const handleResolve = useCallback(() => {
    // Notify server so each responder's status resets to 'available' immediately,
    // instead of waiting for the mobile's 4-second mark_arrived auto-timer.
    const socket = getSocket();
    setTasks(prev => {
      prev.forEach(t => {
        if (t.status !== 'RESOLVED') {
          socket.emit('task_completed', { taskId: t.taskId, userId: t.responderId });
        }
      });
      return prev.map(t => ({ ...t, status: 'RESOLVED' as TaskStatus, resolvedAt: Date.now() }));
    });
    setPhase('resolved');
    addTimeline('Incident resolved — traffic normalizing', '🟢');
    onResolved?.();
  }, [addTimeline, onResolved]);

  // ── Severity badge ─────────────────────────────────────────────────────
  const sevColor = { LOW: '#4caf50', MEDIUM: '#ff9800', HIGH: '#f44336' }[accident.severity];

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="accident-panel">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="accident-panel__header">
        <div className="accident-panel__title-row">
          <span className="accident-panel__icon">🚨</span>
          <h2>Accident Response Center</h2>
          <button className="accident-panel__close" onClick={onClose}>✕</button>
        </div>
        <div className="accident-panel__badges">
          <span className="badge" style={{ background: sevColor }}>{accident.severity}</span>
          <span className="badge badge--id">{accident.id}</span>
          <span className="badge badge--phase">{phase.toUpperCase()}</span>
        </div>
        {/* ── Team members strip (all registered, online + offline) ─── */}
        <div className="online-strip">
          <span className="online-strip__label">👥 Team:</span>
          {teamMembers.length === 0 ? (
            <span className="online-strip__none">No members — add below</span>
          ) : (
            teamMembers.map(u => (
              <span
                key={u.userId}
                className={`online-strip__user ${u.online ? '' : 'online-strip__user--offline'}`}
                title={`${u.name} (${u.userId}) — ${u.status}`}
              >
                <span className={`online-dot online-dot--${u.online ? (u.status === 'available' ? 'online' : 'busy') : 'offline'}`} />
                {u.name.split(' ')[0]} <em>({u.userId})</em>
              </span>
            ))
          )}
          <button
            className="btn btn--ghost"
            style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '11px', borderRadius: '6px' }}
            onClick={() => setShowTeamMgr(v => !v)}
          >
            {showTeamMgr ? '✕ Close' : '⚙ Manage'}
          </button>
        </div>
      </div>

      {/* ── Team Management Panel ──────────────────────────────────── */}
      {showTeamMgr && (
        <TeamManagementPanel
          roles={['Traffic Police', 'Ambulance', 'Fire', 'Maintenance']}
          incidentLoc={accident.location}
          teamMembers={teamMembers}
          onCreated={() => { /* users_update socket will refresh teamMembers */ }}
          onDeleted={() => { /* users_update socket will refresh teamMembers */ }}
        />
      )}

      {/* ── Incident Details ────────────────────────────────────────────── */}
      <section className="accident-panel__section">
        <h3>🚗 Incident Details</h3>
        <div className="detail-grid">
          <div className="detail-item"><span className="label">Location</span><span className="value">{accident.signalName}</span></div>
          <div className="detail-item"><span className="label">Signal</span><span className="value">{accident.signalId}</span></div>
          <div className="detail-item"><span className="label">Severity</span><span className="value" style={{ color: sevColor }}>{accident.severity}</span></div>
          <div className="detail-item"><span className="label">Time</span><span className="value">{fmtTime(accident.timestamp)}</span></div>
          <div className="detail-item"><span className="label">Speed Drop</span><span className="value">{accident.speedDrop} km/h</span></div>
          <div className="detail-item"><span className="label">Vehicle Density</span><span className="value">{accident.vehicleDensity}/min</span></div>
          <div className="detail-item"><span className="label">Sudden Stop</span><span className="value" style={{ color: accident.suddenStop ? '#f44336' : '#999' }}>{accident.suddenStop ? 'YES' : 'NO'}</span></div>
          <div className="detail-item"><span className="label">CCTV Alert</span><span className="value" style={{ color: accident.cameraFlag ? '#f44336' : '#999' }}>{accident.cameraFlag ? 'YES' : 'NO'}</span></div>
        </div>
      </section>

      {/* ── AI Advisory ─────────────────────────────────────────────────── */}
      {advisory && (
        <section className="accident-panel__section accident-panel__ai">
          <h3>🤖 AI Advisory</h3>
          <div className="ai-suggestions">
            {advisory.suggestions.map((s, i) => (
              <div key={i} className="ai-suggestion-item">
                <span className="ai-bullet">•</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="ai-meta">
            <div><strong>Signal Plan:</strong> {advisory.signalPlan}</div>
            <div><strong>Diversion:</strong> {advisory.diversion}</div>
            <div><strong>Est. Clear Time:</strong> {advisory.clearTimeEst}</div>
          </div>
          {phase === 'advisory' && (
            <div className="ai-actions">
              <button className="btn btn--primary" onClick={() => { setPhase('assign'); setShowAssign(true); addTimeline('AI plan approved — assigning response teams', '🎯'); }}>
                ✅ Approve & Assign Team
              </button>
              <button className="btn btn--secondary" onClick={() => setShowAssign(true)}>
                ✏️ Modify & Assign
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Assignment Button (after initial assignment too) ─────────── */}
      {(phase === 'tracking' || phase === 'assign') && !showAssignPopup && (
        <section className="accident-panel__section">
          <button className="btn btn--primary btn--full" onClick={() => setShowAssign(true)}>
            📲 Assign Response Team
          </button>
        </section>
      )}

      {/* ── Response Team Tracking ──────────────────────────────────────── */}
      {tasks.length > 0 && (
        <section className="accident-panel__section">
          <h3>🚓 Response Team Tracking</h3>
          <div className="task-list">
            {tasks.map(task => (
              <div key={task.taskId} className="task-card" style={{ borderLeftColor: ROLE_COLORS[task.role] }}>
                <div className="task-card__head">
                  <span className="task-card__icon">{task.icon}</span>
                  <div className="task-card__info">
                    <div className="task-card__name">{task.responderName}</div>
                    <div className="task-card__vehicle">{task.vehicle}</div>
                  </div>
                  <span className="task-card__status" style={{ background: TASK_STATUS_COLORS[task.status] }}>
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
                {task.status === 'EN_ROUTE' && (
                  <div className="task-card__progress">
                    <div className="progress-bar">
                      <div
                        className="progress-bar__fill"
                        style={{
                          width: `${Math.min(100, (1 - haversine(task.currentPos, task.destination) / Math.max(task.distKm, 0.01)) * 100)}%`,
                          background: ROLE_COLORS[task.role],
                        }}
                      />
                    </div>
                    <span className="task-card__eta">ETA: {fmtETA(task.etaSec)}</span>
                  </div>
                )}
                {task.status === 'ARRIVED' && (
                  <div className="task-card__arrived">✅ On scene</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Signal Status (nearby signals affected) ─────────────────── */}
      <section className="accident-panel__section">
        <h3>🚦 Nearby Signal Status</h3>
        <div className="signal-status-list">
          {signals
            .filter(s => haversine(s.location, accident.location) < 1.5)
            .sort((a, b) => haversine(a.location, accident.location) - haversine(b.location, accident.location))
            .slice(0, 5)
            .map(s => {
              const dist = haversine(s.location, accident.location);
              const isAccident = s.signal_id === accident.signalId;
              return (
                <div key={s.signal_id} className={`signal-row ${isAccident ? 'signal-row--accident' : ''}`}>
                  <span className="signal-row__light" style={{ background: isAccident ? '#f44336' : s.state === 'RED' ? '#f44336' : s.state === 'GREEN' ? '#4caf50' : '#ff9800' }}>●</span>
                  <span className="signal-row__name">{s.name}</span>
                  <span className="signal-row__dist">{dist.toFixed(1)} km</span>
                  <span className="signal-row__state">{isAccident ? 'RED LOCKED' : s.state}</span>
                </div>
              );
            })}
        </div>
      </section>

      {/* ── Resolution ─────────────────────────────────────────────────── */}
      {phase === 'tracking' && tasks.length > 0 && tasks.every(t => t.status === 'ARRIVED') && (
        <section className="accident-panel__section accident-panel__resolve">
          <button className="btn btn--success btn--full" onClick={handleResolve}>
            ✅ Mark Incident Resolved
          </button>
        </section>
      )}

      {phase === 'resolved' && (
        <section className="accident-panel__section accident-panel__resolved-summary">
          <h3>✅ Incident Resolved</h3>
          <div className="detail-grid">
            <div className="detail-item"><span className="label">Incident ID</span><span className="value">{accident.id}</span></div>
            <div className="detail-item"><span className="label">Response Time</span><span className="value">{Math.round((Date.now() - accident.timestamp) / 60000)} min</span></div>
            <div className="detail-item"><span className="label">Teams Deployed</span><span className="value">{tasks.length}</span></div>
            <div className="detail-item"><span className="label">Status</span><span className="value" style={{ color: '#4caf50' }}>CLOSED</span></div>
          </div>
        </section>
      )}

      {/* ── Timeline ───────────────────────────────────────────────────── */}
      <section className="accident-panel__section accident-panel__timeline">
        <h3>📋 Incident Timeline</h3>
        <div className="timeline-list">
          {timeline.map((e, i) => (
            <div key={i} className="timeline-item">
              <span className="timeline-time">{e.time}</span>
              <span className="timeline-icon">{e.icon}</span>
              <span className="timeline-label">{e.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ ASSIGNMENT POPUP ═══════════════════════════════════════════ */}
      {showAssignPopup && (
        <AssignmentPopup
          accident={accident}
          existingTaskIds={new Set(tasks.map(t => t.responderId))}
          teamMembers={teamMembers}
          onDispatch={dispatchResponder}
          onClose={() => setShowAssign(false)}
        />
      )}

    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENT POPUP — select role, personnel, comm modes, preview & send
// ══════════════════════════════════════════════════════════════════════════════

// Maps the socket server's role strings → Responder role enum
const SOCKET_ROLE_MAP: Record<string, Responder['role']> = {
  'Traffic Police': 'traffic_police',
  'Ambulance':      'ambulance',
  'Fire':           'fire',
  'Maintenance':    'maintenance',
};
const ROLE_ICONS: Record<Responder['role'], string> = {
  traffic_police: '🚔', ambulance: '🚑', fire: '🚒', maintenance: '🔧',
};
const ROLE_VEH: Record<Responder['role'], string> = {
  traffic_police: 'Response Unit', ambulance: 'Ambulance Unit', fire: 'Fire Unit', maintenance: 'Maintenance Crew',
};

function AssignmentPopup({
  accident,
  existingTaskIds,
  teamMembers,
  onDispatch,
  onClose,
}: {
  accident:        AccidentInfo;
  existingTaskIds: Set<string>;
  teamMembers:     Pick<TeamMember, 'userId' | 'name' | 'role' | 'online' | 'status' | 'distKm' | 'lastLat' | 'lastLng'>[];
  onDispatch:      (r: Responder & { distKm: number; etaMin: number }, comms: ('app' | 'sms' | 'email')[]) => void;
  onClose:         () => void;
}) {
  type Role = Responder['role'];
  const [selectedRole, setRole]   = useState<Role>('traffic_police');
  const [selectedId, setSelected] = useState<string | null>(null);
  const [comms, setComms]         = useState<Set<'app' | 'sms' | 'email'>>(new Set(['app']));

  // ── Build candidates: real registered members first, static fallback ───
  const buildCandidates = (role: Role) => {
    const realMembers = teamMembers
      .filter(tm => SOCKET_ROLE_MAP[tm.role] === role && !existingTaskIds.has(tm.userId))
      .map(tm => ({
        id:       tm.userId,
        name:     tm.name,
        role,
        callSign: tm.userId,
        phone:    '—',
        location: [tm.lastLng ?? 55.3823, tm.lastLat ?? 25.1264] as [number, number],
        status:   (tm.online && tm.status !== 'offline' ? 'available' : 'offline') as Responder['status'],
        vehicle:  ROLE_VEH[role],
        icon:     ROLE_ICONS[role],
        distKm:   tm.distKm ?? 0,
        etaMin:   tm.distKm ? Math.max(1, Math.round((tm.distKm / 35) * 60)) : 0,
        member:   tm,
      }))
      .sort((a, b) => a.distKm - b.distKm);

    // Static demo fallback only when nobody is registered for this role
    if (realMembers.length > 0) return realMembers;

    return getNearestResponders(role, accident.location)
      .filter(r => !existingTaskIds.has(r.id))
      .map(r => {
        const m = teamMembers.find(tm => tm.userId === r.id);
        return { ...r, distKm: m?.distKm ?? r.distKm, member: m ?? null };
      });
  };

  const candidates = buildCandidates(selectedRole);
  const selected = candidates.find(r => r.id === selectedId) ?? null;

  // Auto-select nearest (prefer online real member) when role changes
  useEffect(() => {
    const c = buildCandidates(selectedRole);
    // Prefer nearest online member; fallback to nearest overall
    const online = c.find(r => r.member?.online);
    setSelected((online ?? c[0])?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole, accident.location, existingTaskIds, teamMembers]);

  const toggleComm = (m: 'app' | 'sms' | 'email') => {
    setComms(prev => {
      const n = new Set(prev);
      if (n.has(m)) n.delete(m); else n.add(m);
      return n;
    });
  };

  const handleSend = () => {
    if (!selected) return;
    onDispatch(selected, Array.from(comms));
  };

  const ROLES: Role[] = ['traffic_police', 'ambulance', 'maintenance', 'fire'];

  return (
    <div className="assign-overlay">
      <div className="assign-popup">
        <div className="assign-popup__header">
          <h3>📲 Assign Response Team</h3>
          <button className="assign-popup__close" onClick={onClose}>✕</button>
        </div>

        {/* Role selector */}
        <div className="assign-popup__section">
          <label>Select Role</label>
          <div className="role-selector">
            {ROLES.map(role => (
              <button
                key={role}
                className={`role-btn ${selectedRole === role ? 'role-btn--active' : ''}`}
                style={{ '--role-color': ROLE_COLORS[role] } as React.CSSProperties}
                onClick={() => setRole(role)}
              >
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>

        {/* Personnel list */}
        <div className="assign-popup__section">
          <label>Select Personnel</label>
          <div className="personnel-list">
            {candidates.length === 0 && (
              <div className="no-candidates">
                No {ROLE_LABELS[selectedRole]} available — create a profile using ⚙ Manage in the panel header.
              </div>
            )}
            {candidates.map(r => {
              const m = r.member;
              const isReal   = !!m;                          // came from socket (registered)
              const isOnline = m?.online ?? false;
              const statusLabel = isReal
                ? (isOnline
                    ? (m!.status === 'available' ? '🟢 Avail'
                      : m!.status === 'en_route'  ? '🔵 En Route'
                      : m!.status === 'on_scene'  ? '🔴 On Scene'
                      : '🟠 Busy')
                    : '⚫ Offline')
                : null;
              const metaLine = isReal
                ? `${r.vehicle} • ID: ${r.callSign}`     // real: show their ID
                : `${r.vehicle} • ${r.callSign}`;         // static: show call sign
              return (
                <div
                  key={r.id}
                  className={`personnel-card ${selectedId === r.id ? 'personnel-card--selected' : ''} ${isOnline ? 'personnel-card--online' : ''} ${isReal ? 'personnel-card--real' : ''}`}
                  onClick={() => setSelected(r.id)}
                >
                  <span className="personnel-card__icon">{r.icon}</span>
                  <div className="personnel-card__info">
                    <div className="personnel-card__name">
                      {r.name}
                      {statusLabel && <span className={`status-label status-label--${isOnline ? (m?.status === 'available' ? 'avail' : 'busy') : 'offline'}`}>{statusLabel}</span>}
                    </div>
                    <div className="personnel-card__meta">{metaLine}</div>
                  </div>
                  <div className="personnel-card__dist">
                    <strong>{r.distKm > 0 ? r.distKm.toFixed(1) : '—'} {r.distKm > 0 ? 'km' : ''}</strong>
                    <span>{r.etaMin > 0 ? `~${r.etaMin} min` : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Communication mode */}
        <div className="assign-popup__section">
          <label>Communication Mode</label>
          <div className="comm-modes">
            {(['app', 'sms', 'email'] as const).map(m => (
              <label key={m} className="comm-mode">
                <input type="checkbox" checked={comms.has(m)} onChange={() => toggleComm(m)} />
                <span>{m === 'app' ? '📱 App Notification' : m === 'sms' ? '💬 SMS (Mock)' : '📧 Email (Mock)'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Message preview */}
        {selected && (
          <div className="assign-popup__section">
            <label>Message Preview</label>
            <div className="message-preview">
              "Accident detected at {accident.signalName}. Severity: {accident.severity}. You have been assigned as {ROLE_LABELS[selected.role]}. Distance: {selected.distKm.toFixed(1)} km. Please respond immediately."
            </div>
          </div>
        )}

        {/* Send */}
        <button
          className="btn btn--primary btn--full"
          disabled={!selected}
          onClick={handleSend}
        >
          📤 SEND TASK
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEAM MANAGEMENT PANEL — Dashboard operator creates / removes predefined
// team member profiles. Team only needs to login on mobile.
// ══════════════════════════════════════════════════════════════════════════════
const SOCKET_SERVER = 'http://192.168.0.223:3001';

// ── Profile detail popup ──────────────────────────────────────────────────
function ProfilePopup({
  member,
  incidentLoc,
  onClose,
  onDeleted,
}: {
  member:      TeamMember;
  incidentLoc: [number, number];
  onClose:     () => void;
  onDeleted:   () => void;
}) {
  const [newPwd,    setNewPwd]    = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg,  setResetMsg]  = useState<string | null>(null);
  const [distKm,    setDistKm]    = useState<number | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  // Live distance — recalculates every 2 s from socket users_update
  useEffect(() => {
    const calc = () => {
      // Fetch fresh coords from server
      fetch(`${SOCKET_SERVER}/api/users`)
        .then(r => r.json())
        .then((all: TeamMember[]) => {
          const fresh = all.find(u => u.userId === member.userId);
          if (fresh?.lastLat && fresh?.lastLng) {
            const dist = haversine(
              [fresh.lastLng, fresh.lastLat] as [number, number],
              incidentLoc,
            );
            setDistKm(dist);
          }
        })
        .catch(() => {});
    };
    calc();
    const timer = setInterval(calc, 2000);
    return () => clearInterval(timer);
  }, [member.userId, incidentLoc]);

  const handleResetPwd = async () => {
    if (!newPwd.trim()) return;
    setResetting(true); setResetMsg(null);
    try {
      const res = await fetch(`${SOCKET_SERVER}/api/users/${member.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPwd.trim() }),
      });
      if (res.ok) { setResetMsg('Password updated! Share the new password with the team member.'); setNewPwd(''); }
      else        { setError('Failed to reset password'); }
    } catch { setError('Cannot reach server'); }
    finally   { setResetting(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${member.name} (${member.userId})?`)) return;
    try {
      await fetch(`${SOCKET_SERVER}/api/users/${member.userId}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch { setError('Cannot reach server'); }
  };

  const roleColor: Record<string,string> = {
    'Traffic Police': '#4287f5', 'Ambulance': '#4caf50',
    'Fire': '#ff5722', 'Maintenance': '#ff9800',
    'HVAC Technician': '#58a6ff', 'Electrical Engineer': '#f0bc3e',
    'Fire Safety Officer': '#f85149', 'Facility Manager': '#d2a8ff',
  };
  const rc = roleColor[member.role] ?? '#8b949e';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: '14px',
        width: '100%', maxWidth: '360px', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${rc}22, ${rc}08)`, borderBottom: '1px solid #30363d', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: `${rc}22`, border: `2px solid ${rc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
            {member.role === 'Ambulance' ? '🚑' : member.role === 'Fire' || member.role === 'Fire Safety Officer' ? '🚒' : member.role === 'Maintenance' ? '🔧' : '👮'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#e6edf3' }}>{member.name}</div>
            <div style={{ fontSize: '11px', color: rc, fontWeight: 600 }}>{member.role}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '18px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}>✕</button>
        </div>

        {/* Info rows */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            ['🪪 Responder ID', <span style={{ fontFamily: 'monospace', color: '#58a6ff', fontWeight: 700 }}>{member.userId}</span>],
            ['👤 Full Name',  member.name],
            ['🏷 Role / Team', <span style={{ color: rc, fontWeight: 600 }}>{member.role}</span>],
            ['📡 Status',     <span style={{ color: member.online ? '#3fb950' : '#8b949e', fontWeight: 600 }}>
              {member.online ? `🟢 ${member.status ?? 'Online'}` : '⚫ Offline'}
            </span>],
            ['📏 Distance to Scene', distKm !== null
              ? <span style={{ color: distKm < 1 ? '#3fb950' : distKm < 3 ? '#f0bc3e' : '#f85149', fontWeight: 700 }}>
                  {distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(2)} km`}
                  <span style={{ fontWeight: 400, color: '#8b949e', fontSize: '10px', marginLeft: 4 }}>live ●</span>
                </span>
              : <span style={{ color: '#555' }}>—</span>],
            ['🔑 Password', <span style={{ color: '#8b949e', fontSize: '12px' }}>Hidden — use reset below to change</span>],
          ].map(([label, val], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', fontSize: '12px', gap: '8px' }}>
              <span style={{ color: '#8b949e', flexShrink: 0 }}>{label}</span>
              <span style={{ color: '#e6edf3', textAlign: 'right' }}>{val}</span>
            </div>
          ))}

          {/* Reset password */}
          <div style={{ marginTop: '4px', display: 'flex', gap: '6px' }}>
            <input
              className="team-mgr-input"
              type="password"
              placeholder="Set new password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleResetPwd()}
              style={{ flex: 1, fontSize: '12px' }}
            />
            <button
              onClick={handleResetPwd}
              disabled={resetting || !newPwd.trim()}
              style={{ background: '#1f6feb', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', color: '#fff', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
            >{resetting ? '…' : '🔑 Reset'}</button>
          </div>
          {resetMsg && <div style={{ fontSize: '11px', color: '#3fb950', padding: '4px 8px', background: 'rgba(63,185,80,0.1)', borderRadius: '6px' }}>✅ {resetMsg}</div>}
          {error   && <div style={{ fontSize: '11px', color: '#f85149' }}>⚠ {error}</div>}

          {/* Delete */}
          <button
            onClick={handleDelete}
            style={{ marginTop: '2px', background: 'transparent', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149', borderRadius: '6px', padding: '7px', fontSize: '12px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' }}
          >🗑 Remove Profile</button>
        </div>
      </div>
    </div>
  );
}

const PREDEFINED_RESPONDERS = [
  { userId: 'TP-001', name: 'Officer Ahmed',   role: 'Traffic Police', password: 'Traffic@dso1' },
  { userId: 'TP-002', name: 'Officer Priya',   role: 'Traffic Police', password: 'Traffic@dso2' },
  { userId: 'AM-001', name: 'Paramedic Raj',   role: 'Ambulance',      password: 'Ambul@dso1'   },
  { userId: 'FR-001', name: 'Firefighter Zaid',role: 'Fire',           password: 'Fire@dso1'    },
  { userId: 'MC-001', name: 'Tech Kumar',       role: 'Maintenance',    password: 'Maint@dso1'   },
  { userId: 'WE-001', name: 'Eng. Sara',        role: 'Water Engineer', password: 'Water@dso1'   },
];

function TeamManagementPanel({
  teamMembers,
  incidentLoc,
}: {
  roles:       string[];
  teamMembers: TeamMember[];
  incidentLoc: [number, number];
  onCreated:   () => void;
  onDeleted:   () => void;
}) {
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);

  return (
    <section className="accident-panel__section" style={{ background: 'rgba(88,166,255,0.03)', border: '1px solid rgba(88,166,255,0.15)', borderRadius: '10px', margin: '0 0 4px' }}>
      <h3>⚙ Team Credentials</h3>
      <p style={{ fontSize: '12px', color: '#8b949e', marginBottom: '10px' }}>
        Predefined responder accounts. Share the Responder ID + password with each team member to log in on the mobile app.
      </p>

      {/* ── Predefined credentials table ─────────────── */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#58a6ff', fontWeight: 600, letterSpacing: '0.05em' }}>PREDEFINED ACCOUNTS</span>
          <button
            onClick={() => setShowPasswords(p => !p)}
            style={{ background: 'transparent', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
          >
            {showPasswords ? '🙈 Hide' : '👁 Show Passwords'}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {PREDEFINED_RESPONDERS.map(c => {
            const live = teamMembers.find(m => m.userId === c.userId);
            return (
              <div key={c.userId} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr auto auto', gap: '6px', alignItems: 'center', padding: '5px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', fontSize: '11px' }}>
                <span style={{ fontFamily: 'monospace', color: '#58a6ff', fontWeight: 700 }}>{c.userId}</span>
                <span style={{ color: '#e6edf3', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.role}</span>
                <span style={{ fontFamily: 'monospace', color: '#ffa657', fontSize: '10px', letterSpacing: '0.03em' }}>
                  {showPasswords ? c.password : '••••••••'}
                </span>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: live?.online ? '#3fb950' : '#444', flexShrink: 0, display: 'inline-block' }} title={live?.online ? live.status : 'offline'} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Profile popup ─────────────────────────────── */}
      {selectedMember && (
        <ProfilePopup
          member={selectedMember}
          incidentLoc={incidentLoc}
          onClose={() => setSelectedMember(null)}
          onDeleted={() => setSelectedMember(null)}
        />
      )}

      {/* ── Live team status ──────────────────────────── */}
      {teamMembers.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: '#58a6ff', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '6px' }}>LIVE STATUS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {teamMembers.map(u => (
              <div
                key={u.userId}
                onClick={() => setSelectedMember(u)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(88,166,255,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: u.online ? '#3fb950' : '#444', flexShrink: 0, display: 'inline-block' }} />
                <span style={{ flex: 1, fontWeight: 600 }}>{u.name}</span>
                <span style={{ color: '#8b949e' }}>{u.role}</span>
                <span style={{ fontFamily: 'monospace', color: '#58a6ff', fontSize: '11px' }}>{u.userId}</span>
                <span style={{ color: u.online ? '#3fb950' : '#8b949e', fontSize: '11px' }}>{u.online ? u.status : 'offline'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
