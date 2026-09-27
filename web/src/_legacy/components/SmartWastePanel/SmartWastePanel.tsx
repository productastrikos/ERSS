// ─────────────────────────────────────────────────────────────────────────────
//  SmartWastePanel — Full IoT waste management lifecycle
//  Bins Overview → Fill Monitoring → Incident Simulation →
//  Create SOP → Assign Team → En Route → Collect → Resolved
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WasteView } from '../../types';
import {
  WASTE_BINS, OVERFLOW_BIN_ID, fillColor, fillLabel, BIN_TYPE_ICON,
} from '../../data/wasteBins';
import type { WasteBin } from '../../data/wasteBins';
import { getSocket } from '../../utils/socket';
import { haversine } from '../../data/responders';
import type { WasteTask, TaskStatus } from '../../data/responders';
import { buildRoute } from '../../data/technicians';
import './SmartWastePanel.scss';

// ── Types ─────────────────────────────────────────────────────────────────────
type WasteStage =
  | 'idle'        // normal operations view
  | 'detected'    // overflow alert triggered
  | 'sop_active'  // SOP created, ready to assign
  | 'assigning'   // team selection popup open
  | 'dispatched'  // task sent to mobile, responder en route
  | 'arrived'     // collection crew on scene
  | 'collecting'  // actively collecting
  | 'resolved';   // complete

interface TeamMember {
  userId: string; name: string; role: string;
  online: boolean; status: string;
  lastLat: number | null; lastLng: number | null;
  distKm?: number;
}

// ── SOP workflow steps ────────────────────────────────────────────────────────
const SOP_STEPS = [
  { icon: '📡', label: 'IoT sensor alert received — WB-007 fill: 96%' },
  { icon: '🧪', label: 'Sensor reading validated via secondary node' },
  { icon: '📋', label: 'Collection order generated (ID: WCO-2026-0414)' },
  { icon: '🔔', label: 'Supervisor notified via push notification' },
  { icon: '🚛', label: 'Dispatch collection crew to Silicon Gates Tower' },
  { icon: '🗑️', label: 'Collect and transport waste to depot' },
  { icon: '🧹', label: 'Sanitize bin area and reset sensor' },
  { icon: '✅', label: 'Update records and close collection ticket' },
];

// ── Views ─────────────────────────────────────────────────────────────────────
const VIEWS: { id: WasteView; icon: string; label: string }[] = [
  { id: 'bins',       icon: '🗑️', label: 'Bins'       },
  { id: 'monitoring', icon: '📊', label: 'Monitor'    },
  { id: 'incident',   icon: '🚨', label: 'Incident'   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const fmtEta = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const PRIORITY_ROLES = ['Waste Collector', 'Maintenance', 'Sanitation Engineer'];

// ── Props ─────────────────────────────────────────────────────────────────────
export interface SmartWastePanelProps {
  activeView:             WasteView;
  onViewChange:           (v: WasteView) => void;
  onClose:                () => void;
  onWasteTasksChange?:    (tasks: WasteTask[]) => void;
  onOverflowBinChange?:   (binId: string | null) => void;
  onBinFocus?:            (coords: [number, number]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SmartWastePanel({
  activeView, onViewChange, onClose, onWasteTasksChange, onOverflowBinChange, onBinFocus,
}: SmartWastePanelProps) {

  const [stage, setStage]           = useState<WasteStage>('idle');
  const [bins, setBins]             = useState<WasteBin[]>(WASTE_BINS);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [wasteTasks, setWasteTasks] = useState<WasteTask[]>([]);
  const [sopDoneCount, setSopDoneCount] = useState(0);
  const [validationPct, setValidationPct] = useState(0);
  const [timeline, setTimeline]     = useState<{ time: string; label: string; icon: string }[]>([]);
  const [collectingPct, setCollectingPct] = useState(0);

  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // ── Derived ──────────────────────────────────────────────────────────────
  const overflowBin = bins.find(b => b.id === OVERFLOW_BIN_ID)!;
  const totalBins   = bins.length;
  const normalCount = bins.filter(b => b.fillLevel < 55).length;
  const warnCount   = bins.filter(b => b.fillLevel >= 55 && b.fillLevel < 75).length;
  const critCount   = bins.filter(b => b.fillLevel >= 75 && b.fillLevel < 90).length;
  const overfCount  = bins.filter(b => b.fillLevel >= 90).length;

  // ── Push wasteTasks upstream ─────────────────────────────────────────────
  useEffect(() => { onWasteTasksChange?.(wasteTasks); }, [wasteTasks, onWasteTasksChange]);

  // ── WasteTask position ticker (500 ms) ───────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setWasteTasks(prev => {
        let changed = false;
        const updated = prev.map(t => {
          if (t.status === 'ARRIVED' || t.status === 'RESOLVED') return t;
          const elapsed = (Date.now() - t.sentAt) / 1000;
          let next: TaskStatus = t.status;
          let currentPos = t.currentPos;

          if (t.status === 'PENDING' && elapsed > 1) next = 'SENT';
          if (t.status === 'SENT'    && elapsed > 3) next = 'DELIVERED';
          if (t.status === 'ACCEPTED') {
            const sinceAccepted = t.acceptedAt ? (Date.now() - t.acceptedAt) / 1000 : 0;
            if (sinceAccepted > 2) next = 'EN_ROUTE';
          }
          if (t.status === 'EN_ROUTE') {
            const realGPS = (t as WasteTask & { realPos?: [number, number] }).realPos;
            if (realGPS) {
              currentPos = realGPS;
            } else {
              const travelElapsed = t.acceptedAt
                ? Math.max(0, (Date.now() - t.acceptedAt) / 1000)
                : Math.max(0, elapsed - 9);
              const travelTotal = t.distKm / 35 * 3600;
              if (t.routeCoords && t.routeCoords.length >= 2) {
                const pct  = Math.min(0.99, travelElapsed / Math.max(travelTotal, 30));
                const fIdx = pct * (t.routeCoords.length - 1);
                const lo   = Math.floor(fIdx);
                const hi   = Math.min(lo + 1, t.routeCoords.length - 1);
                const a    = fIdx - lo;
                currentPos = [
                  t.routeCoords[lo][0] + (t.routeCoords[hi][0] - t.routeCoords[lo][0]) * a,
                  t.routeCoords[lo][1] + (t.routeCoords[hi][1] - t.routeCoords[lo][1]) * a,
                ];
              } else {
                const pct = Math.min(0.95, travelElapsed / Math.max(travelTotal, 30));
                currentPos = [
                  t.origin[0] + (t.destination[0] - t.origin[0]) * pct,
                  t.origin[1] + (t.destination[1] - t.origin[1]) * pct,
                ];
              }
            }
          }
          if (next !== t.status || currentPos !== t.currentPos) {
            changed = true;
            return { ...t, status: next, currentPos };
          }
          return t;
        });
        return changed ? updated : prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ── Socket: team members list ─────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    socket.emit('get_users');
    const handler = (members: TeamMember[]) => {
      setTeamMembers(members.filter(m => m.online && m.lastLat != null));
    };
    socket.on('users_update', handler);
    return () => { socket.off('users_update', handler); };
  }, []);

  // ── Socket: real GPS + route from mobile ─────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const handleLocation = (data: { userId: string; lat: number; lng: number; taskId?: string }) => {
      setWasteTasks(prev => prev.map(t => {
        if (t.responderId !== data.userId && t.taskId !== data.taskId) return t;
        const pos: [number, number] = [data.lng, data.lat];
        const st = (t.status === 'ACCEPTED' || t.status === 'EN_ROUTE') ? 'EN_ROUTE' as TaskStatus : t.status;
        const updated = { ...t, currentPos: pos, status: st };
        (updated as WasteTask & { realPos: [number, number] }).realPos = pos;
        return updated as WasteTask;
      }));
    };
    const handleRoute = ({ taskId, coords }: { taskId: string; coords: [number, number][] }) => {
      setWasteTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, routeCoords: coords } : t));
    };
    socket.on('responder_location', handleLocation);
    socket.on('task_route',         handleRoute);
    return () => {
      socket.off('responder_location', handleLocation);
      socket.off('task_route',         handleRoute);
    };
  }, []);

  // ── Socket: task status updates from mobile ───────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const handle = (data: { taskId: string; status: string; ts: number }) => {
      if (!data.taskId.startsWith('WST-')) return;
      setWasteTasks(prev => prev.map(t => {
        if (t.taskId !== data.taskId) return t;
        const upd: Partial<WasteTask> = { status: data.status as TaskStatus };
        if (data.status === 'ACCEPTED') { upd.acceptedAt = data.ts; addTl('Collection crew accepted task', '✅'); }
        if (data.status === 'ARRIVED')  { upd.arrivedAt  = data.ts; addTl('Crew arrived at waste bin', '📍'); onArrived(); }
        if (data.status === 'RESOLVED') { upd.resolvedAt = data.ts; }
        return { ...t, ...upd };
      }));
    };
    socket.on('task_status_update', handle);
    return () => { socket.off('task_status_update', handle); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timeline helper ───────────────────────────────────────────────────────
  const addTl = useCallback((label: string, icon: string) => {
    setTimeline(p => [...p, { time: fmtTime(Date.now()), label, icon }]);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleSimulate = () => {
    // Spike WB-007 to 96% overflow
    setBins(p => p.map(b => b.id === OVERFLOW_BIN_ID ? { ...b, fillLevel: 96 } : b));
    onOverflowBinChange?.(OVERFLOW_BIN_ID);
    setStage('detected');
    onViewChange('incident');
    setValidationPct(0);
    // Auto-validate sensor animation
    let pct = 0;
    const iv = setInterval(() => {
      pct += 8;
      setValidationPct(Math.min(pct, 100));
      if (pct >= 100) clearInterval(iv);
    }, 80);
    addTl('Fill-level sensor triggered — WB-007 at 96%', '📡');
    // Focus map on overflow bin
    onBinFocus?.(overflowBin.location);
  };

  const handleCreateSOP = () => {
    setStage('sop_active');
    addTl('SOP created — 8-step collection workflow activated', '📋');
    // Auto-complete first 4 SOP steps with stagger
    [0, 1, 2, 3].forEach(i => {
      setTimeout(() => setSopDoneCount(i + 1), 400 + i * 500);
    });
  };

  const handleDispatch = (member: TeamMember) => {
    setShowAssign(false);
    if (!member.lastLat || !member.lastLng) return;

    const origin: [number, number]      = [member.lastLng, member.lastLat];
    const destination: [number, number] = overflowBin.location;
    const distKm = haversine(origin, destination);
    const now    = Date.now();
    const taskId = `WST-${now}`;

    const task: WasteTask = {
      taskId,
      responderId:   member.userId,
      responderName: member.name,
      role:          member.role,
      status:        'PENDING',
      binId:         overflowBin.id,
      binName:       overflowBin.name,
      origin,
      destination,
      currentPos:    origin,
      distKm,
      etaSec:        Math.max(60, (distKm / 35) * 3600),
      sentAt:        now,
      acceptedAt:    null,
      arrivedAt:     null,
      resolvedAt:    null,
    };

    setWasteTasks([task]);
    setStage('dispatched');
    setSopDoneCount(5); // step 5 = dispatching crew

    addTl(`Task dispatched → ${member.name}`, '🚛');

    const socket = getSocket();
    socket.emit('send_task', {
      taskId,
      responderId:   member.userId,
      responderName: member.name,
      title:         'Waste Collection Task',
      description:   `Bin WB-007 (Silicon Gates Tower) is at 96% capacity. Collect waste and transport to depot.`,
      location:      { lat: destination[1], lng: destination[0] },
      severity:      'medium',
      incidentType:  'waste_overflow',
    });

    // Fetch OSRM road route immediately on the dashboard side
    buildRoute(origin, destination).then(coords => {
      if (coords.length >= 2) {
        setWasteTasks(prev => prev.map(t =>
          t.taskId === taskId ? { ...t, routeCoords: coords } : t
        ));
      }
    });
  };

  const onArrived = () => {
    setStage('arrived');
    setSopDoneCount(6);
    addTl('Waste collection in progress', '🗑️');
    // Simulate collecting (3 s) then auto-resolve
    let pct = 0;
    const iv = setInterval(() => {
      pct += 5;
      setCollectingPct(Math.min(pct, 100));
      if (pct >= 100) {
        clearInterval(iv);
        setStage('collecting');
        setTimeout(() => {
          const socket = getSocket();
          setWasteTasks(prev => {
            const t = prev[0];
            if (t) socket.emit('task_completed', { taskId: t.taskId, userId: t.responderId });
            return prev.map(p => ({ ...p, status: 'RESOLVED' as TaskStatus, resolvedAt: Date.now() }));
          });
          setSopDoneCount(8);
          setStage('resolved');
          onOverflowBinChange?.(null);
          setBins(p => p.map(b => b.id === OVERFLOW_BIN_ID ? { ...b, fillLevel: 12 } : b));
          addTl('Waste collected — bin sanitized and reset to 12%', '✅');
        }, 1500);
      }
    }, 150);
  };

  const handleReset = () => {
    setBins(WASTE_BINS);
    setWasteTasks([]);
    setStage('idle');
    setSopDoneCount(0);
    setValidationPct(0);
    setCollectingPct(0);
    setTimeline([]);
    onOverflowBinChange?.(null);
    onViewChange('bins');
    if (tickRef.current) clearInterval(tickRef.current);
  };

  // ── Sorting for assign popup ──────────────────────────────────────────────
  const sortedMembers = [...teamMembers]
    .map(m => ({
      ...m,
      distKm: m.lastLng != null && m.lastLat != null
        ? haversine([m.lastLng, m.lastLat], overflowBin.location)
        : 99,
      isPriority: PRIORITY_ROLES.includes(m.role),
    }))
    .sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      return a.distKm - b.distKm;
    });

  // ── Render ────────────────────────────────────────────────────────────────
  const activeTask = wasteTasks[0] ?? null;

  return (
    <div className="swp-panel">
      {/* Header */}
      <div className="swp-panel__header">
        <div className="swp-panel__header-left">
          <span className="swp-panel__header-icon">🗑️</span>
          <div>
            <div className="swp-panel__header-title">Smart Waste Management</div>
            <div className="swp-panel__header-sub">Dubai Silicon Oasis · IoT Monitoring</div>
          </div>
        </div>
        <button className="swp-panel__close" onClick={onClose}>✕</button>
      </div>

      {/* Stats bar */}
      <div className="swp-panel__stats">
        <div className="swp-panel__stat swp-panel__stat--ok">
          <div className="swp-panel__stat-value">{normalCount}</div>
          <div className="swp-panel__stat-label">Normal</div>
        </div>
        <div className="swp-panel__stat swp-panel__stat--warn">
          <div className="swp-panel__stat-value">{warnCount}</div>
          <div className="swp-panel__stat-label">Warning</div>
        </div>
        <div className="swp-panel__stat swp-panel__stat--crit">
          <div className="swp-panel__stat-value">{critCount}</div>
          <div className="swp-panel__stat-label">Critical</div>
        </div>
        <div className="swp-panel__stat" style={{ borderColor: overfCount > 0 ? 'rgba(239,83,80,0.4)' : undefined }}>
          <div className="swp-panel__stat-value" style={{ color: overfCount > 0 ? '#ef5350' : 'white' }}>{overfCount}</div>
          <div className="swp-panel__stat-label">Overflow</div>
        </div>
        <div className="swp-panel__stat">
          <div className="swp-panel__stat-value">{totalBins}</div>
          <div className="swp-panel__stat-label">Total</div>
        </div>
      </div>

      {/* View tabs */}
      <div className="swp-panel__tabs">
        {VIEWS.map(v => (
          <button
            key={v.id}
            className={`swp-panel__tab${activeView === v.id ? ' swp-panel__tab--active' : ''}`}
            onClick={() => onViewChange(v.id)}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="swp-panel__body">

        {/* ── BINS VIEW ──────────────────────────────────────────────────────── */}
        {activeView === 'bins' && (
          <div className="swp-panel__bin-grid">
            {bins.map(bin => {
              const isOver = bin.id === OVERFLOW_BIN_ID && stage !== 'idle' && bin.fillLevel >= 90;
              const color  = fillColor(bin.fillLevel);
              const label  = fillLabel(bin.fillLevel);
              return (
                <div
                  key={bin.id}
                  className={`swp-panel__bin-card${isOver ? ' swp-panel__bin-card--overflow' : ''}`}
                  onClick={() => onBinFocus?.(bin.location)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="swp-panel__bin-card__type-badge">{BIN_TYPE_ICON[bin.binType]}</span>
                  <div className="swp-panel__bin-card__id">{bin.id}</div>
                  <div className="swp-panel__bin-card__name">{bin.name}</div>
                  <div className="swp-panel__bin-card__fill-bar-track">
                    <div className="swp-panel__bin-card__fill-bar" style={{ width: `${bin.fillLevel}%`, background: color }} />
                  </div>
                  <div className="swp-panel__bin-card__fill-row">
                    <span className="swp-panel__bin-card__fill-pct" style={{ color }}>{bin.fillLevel}%</span>
                    <span className="swp-panel__bin-card__status" style={{ color, background: `${color}18`, border: `1px solid ${color}44` }}>{label}</span>
                  </div>
                  <div className="swp-panel__bin-card__zone">{bin.zone}</div>
                  <div className="swp-panel__bin-card__battery">🔋 {bin.batteryLevel}%</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── MONITORING VIEW ────────────────────────────────────────────────── */}
        {activeView === 'monitoring' && (
          <>
            <div className="swp-panel__mon-section">
              <div className="swp-panel__mon-title">Fill Levels by Zone</div>
              {['Residential North', 'Tech Zone', 'Central', 'Parks', 'Residential West', 'Residential South', 'Commercial', 'Academic', 'East Gate'].map(zone => {
                const zoneBins = bins.filter(b => b.zone === zone);
                if (!zoneBins.length) return null;
                const avg = Math.round(zoneBins.reduce((s, b) => s + b.fillLevel, 0) / zoneBins.length);
                const col = fillColor(avg);
                return (
                  <div key={zone} className="swp-panel__mon-row">
                    <span className="swp-panel__mon-name">🗂️ {zone}</span>
                    <div className="swp-panel__mon-bar-wrap">
                      <div className="swp-panel__mon-bar" style={{ width: `${avg}%`, background: col }} />
                    </div>
                    <span className="swp-panel__mon-pct" style={{ color: col }}>{avg}%</span>
                  </div>
                );
              })}
            </div>

            <div className="swp-panel__mon-section">
              <div className="swp-panel__mon-title">Bins Needing Attention</div>
              {bins
                .filter(b => b.fillLevel >= 55)
                .sort((a, b) => b.fillLevel - a.fillLevel)
                .map(bin => {
                  const col = fillColor(bin.fillLevel);
                  return (
                    <div key={bin.id} className="swp-panel__mon-row" onClick={() => onBinFocus?.(bin.location)} style={{ cursor: 'pointer' }}>
                      <span className="swp-panel__mon-name">{BIN_TYPE_ICON[bin.binType]} {bin.name}</span>
                      <div className="swp-panel__mon-bar-wrap">
                        <div className="swp-panel__mon-bar" style={{ width: `${bin.fillLevel}%`, background: col }} />
                      </div>
                      <span className="swp-panel__mon-pct" style={{ color: col }}>{bin.fillLevel}%</span>
                    </div>
                  );
                })}
            </div>

            <div className="swp-panel__mon-section">
              <div className="swp-panel__mon-title">Battery Status</div>
              {bins
                .filter(b => b.batteryLevel < 70)
                .sort((a, b) => a.batteryLevel - b.batteryLevel)
                .map(bin => (
                  <div key={bin.id} className="swp-panel__mon-row">
                    <span className="swp-panel__mon-name">🔋 {bin.name}</span>
                    <div className="swp-panel__mon-bar-wrap">
                      <div className="swp-panel__mon-bar" style={{ width: `${bin.batteryLevel}%`, background: bin.batteryLevel < 30 ? '#ef5350' : '#FFB74D' }} />
                    </div>
                    <span className="swp-panel__mon-pct" style={{ color: bin.batteryLevel < 30 ? '#ef5350' : '#FFB74D' }}>{bin.batteryLevel}%</span>
                  </div>
                ))}
              {bins.filter(b => b.batteryLevel < 70).length === 0 && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '12px' }}>All batteries healthy ✓</div>
              )}
            </div>
          </>
        )}

        {/* ── INCIDENT VIEW ──────────────────────────────────────────────────── */}
        {activeView === 'incident' && (
          <>
            {/* ── idle: simulate button ── */}
            {stage === 'idle' && (
              <>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 14, lineHeight: 1.6 }}>
                  Simulate a waste bin overflow incident to trigger the full IoT response workflow — from sensor alert to collection completion.
                </div>
                <button className="swp-panel__btn swp-panel__btn--simulate" onClick={handleSimulate}>
                  🧪 Simulate Bin Overflow
                </button>
              </>
            )}

            {/* ── detected: alert + validation progress ── */}
            {stage === 'detected' && (
              <>
                <div className="swp-panel__alert">
                  <div className="swp-panel__alert-header">
                    <span className="swp-panel__alert-icon">⚠️</span>
                    <div>
                      <div className="swp-panel__alert-title">Smart Waste Bin Overflow Alert</div>
                      <div className="swp-panel__alert-sub">📍 Silicon Gates Tower · {overflowBin.zone}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.60)', marginBottom: 8 }}>
                    Fill-level sensor on <b style={{ color: '#ef5350' }}>WB-007</b> exceeds 90% threshold — immediate collection required.
                  </div>
                  <div className="swp-panel__alert-sensors">
                    {['Fill-level ultrasonic sensor', 'Bin IoT node', 'Waste Management Platform'].map(s => (
                      <span key={s} className="swp-panel__alert-sensor">{s}</span>
                    ))}
                  </div>
                  {validationPct < 100 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', marginBottom: 4 }}>Validating sensor data…</div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${validationPct}%`, background: '#66BB6A', transition: 'width 0.1s' }} />
                      </div>
                    </div>
                  )}
                </div>
                {validationPct >= 100 && (
                  <button className="swp-panel__btn swp-panel__btn--sop" onClick={handleCreateSOP}>
                    📋 Create SOP Workflow
                  </button>
                )}
              </>
            )}

            {/* ── sop_active / dispatched / arrived / collecting / resolved: SOP + assign + timeline ── */}
            {['sop_active', 'assigning', 'dispatched', 'arrived', 'collecting', 'resolved'].includes(stage) && (
              <>
                {/* Alert compact bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(239,83,80,0.07)', border: '1px solid rgba(239,83,80,0.20)', borderRadius: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#ef5350' }}>WB-007 — Silicon Gates Tower</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>
                      {stage === 'resolved' ? 'Resolved — Fill level: 12%' : `Overflow — Fill level: ${bins.find(b => b.id === OVERFLOW_BIN_ID)?.fillLevel ?? 96}%`}
                    </div>
                  </div>
                  {stage === 'resolved' && <span style={{ color: '#66BB6A', fontSize: 18 }}>✅</span>}
                </div>

                {/* SOP Steps */}
                <div className="swp-panel__sop">
                  <div className="swp-panel__sop-title">📋 Collection SOP — WCO-2026-0414</div>
                  {SOP_STEPS.map((step, i) => {
                    const done   = i < sopDoneCount;
                    const active = i === sopDoneCount && stage !== 'resolved';
                    const cls    = done ? 'done' : active ? 'active' : 'pending';
                    return (
                      <div key={i} className={`swp-panel__sop-step swp-panel__sop-step--${cls}`}>
                        <span className="swp-panel__sop-step__icon">{step.icon}</span>
                        <span className="swp-panel__sop-step__label">{step.label}</span>
                        <span className="swp-panel__sop-step__check">{done ? '✓' : active ? '⟳' : ''}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Assign button */}
                {stage === 'sop_active' && sopDoneCount >= 4 && (
                  <button className="swp-panel__btn swp-panel__btn--assign" onClick={() => setShowAssign(true)}>
                    👷 Assign Collection Crew
                  </button>
                )}

                {/* Active task card */}
                {activeTask && ['dispatched', 'arrived', 'collecting', 'resolved'].includes(stage) && (
                  <div className="swp-panel__task-card">
                    <div className="swp-panel__task-card-header">
                      <div>
                        <div className="swp-panel__task-card-name">🚛 {activeTask.responderName}</div>
                        <div className="swp-panel__task-card-role">{activeTask.role}</div>
                      </div>
                      <span className="swp-panel__task-card-badge" style={{
                        background: activeTask.status === 'ARRIVED' || activeTask.status === 'RESOLVED' ? 'rgba(102,187,106,0.18)' : 'rgba(255,183,77,0.15)',
                        border: `1px solid ${activeTask.status === 'ARRIVED' || activeTask.status === 'RESOLVED' ? 'rgba(102,187,106,0.35)' : 'rgba(255,183,77,0.30)'}`,
                        color: activeTask.status === 'ARRIVED' || activeTask.status === 'RESOLVED' ? '#66BB6A' : '#FFB74D',
                      }}>{activeTask.status}</span>
                    </div>
                    {stage === 'arrived' && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', marginBottom: 4 }}>Collecting waste…</div>
                        <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${collectingPct}%`, background: '#66BB6A', transition: 'width 0.15s' }} />
                        </div>
                      </div>
                    )}
                    <div className="swp-panel__task-card-metrics">
                      <div className="swp-panel__task-card-metric">
                        <div className="swp-panel__task-card-metric-val">{activeTask.distKm.toFixed(1)} km</div>
                        <div className="swp-panel__task-card-metric-lbl">Distance</div>
                      </div>
                      <div className="swp-panel__task-card-metric">
                        <div className="swp-panel__task-card-metric-val">{fmtEta(activeTask.etaSec)}</div>
                        <div className="swp-panel__task-card-metric-lbl">ETA</div>
                      </div>
                      <div className="swp-panel__task-card-metric">
                        <div className="swp-panel__task-card-metric-val">{activeTask.routeCoords ? '🛣️' : '📍'}</div>
                        <div className="swp-panel__task-card-metric-lbl">{activeTask.routeCoords ? 'Road Route' : 'Direct'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analytics after resolved */}
                {stage === 'resolved' && (
                  <div className="swp-panel__analytics">
                    <div className="swp-panel__analytics-title">📊 Collection Analytics</div>
                    <div className="swp-panel__analytics-row"><span>Bin ID</span><span>WB-007 · Silicon Gates Tower</span></div>
                    <div className="swp-panel__analytics-row"><span>Fill before collection</span><span>96%</span></div>
                    <div className="swp-panel__analytics-row"><span>Fill after collection</span><span>12%</span></div>
                    <div className="swp-panel__analytics-row"><span>Waste collected</span><span>~203 L</span></div>
                    <div className="swp-panel__analytics-row"><span>Responder</span><span>{activeTask?.responderName ?? '–'}</span></div>
                    <div className="swp-panel__analytics-row"><span>Response time</span><span>{activeTask?.acceptedAt ? `${Math.round((Date.now() - activeTask.sentAt) / 1000)} s` : '–'}</span></div>
                  </div>
                )}

                {/* Timeline */}
                {timeline.length > 0 && (
                  <>
                    <div className="swp-panel__mon-title" style={{ marginBottom: 8, marginTop: 4 }}>📅 Timeline</div>
                    <div className="swp-panel__timeline">
                      {[...timeline].reverse().map((entry, i) => (
                        <div key={i} className="swp-panel__tl-entry">
                          <span className="swp-panel__tl-icon">{entry.icon}</span>
                          <span className="swp-panel__tl-label">{entry.label}</span>
                          <span className="swp-panel__tl-time">{entry.time}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {stage === 'resolved' && (
                  <button className="swp-panel__btn swp-panel__btn--reset" onClick={handleReset}>
                    🔄 Reset Simulation
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Assign team popup ─────────────────────────────────────────────── */}
      {showAssign && (
        <div className="swp-panel__assign-overlay">
          <div className="swp-panel__assign-popup">
            <div className="swp-panel__assign-popup-header">
              <span className="swp-panel__assign-popup-title">👷 Select Collection Crew</span>
              <button className="swp-panel__assign-popup-cancel" onClick={() => setShowAssign(false)}>✕</button>
            </div>
            <div className="swp-panel__assign-popup-list">
              {sortedMembers.length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '20px' }}>
                  No team members online
                </div>
              )}
              {sortedMembers.map(m => (
                <div
                  key={m.userId}
                  className={`swp-panel__assign-popup-item${!m.online ? ' swp-panel__assign-popup-item--offline' : ''}`}
                  onClick={() => m.online && handleDispatch(m)}
                >
                  <div className="swp-panel__assign-popup-avatar">
                    {m.role.includes('Waste') ? '🗑️' : m.role.includes('Maintenance') ? '🔧' : '👷'}
                  </div>
                  <div className="swp-panel__assign-popup-info">
                    <div className="swp-panel__assign-popup-name">
                      {m.name}
                      {m.isPriority && <span className="swp-panel__assign-popup-priority">★ PRIORITY</span>}
                    </div>
                    <div className="swp-panel__assign-popup-role">{m.role} · {m.status}</div>
                  </div>
                  <div className="swp-panel__assign-popup-dist">{(m.distKm ?? 0).toFixed(1)} km</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
