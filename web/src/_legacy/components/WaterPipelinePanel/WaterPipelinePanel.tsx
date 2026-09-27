// ─────────────────────────────────────────────────────────────────────────────
//  WaterPipelinePanel — Full lifecycle:
//  Detecting → Validating → Confirmed → Auto Response →
//  Assigning → En Route → Repairing → Resolved → Analytics
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { WaterView } from '../../types';
import type {
  WaterNetworkState,
  WaterNode,
  Pipeline,
  WaterIncident,
  WaterAIAdvisory,
} from '../../data/waterNetwork';
import {
  buildWaterNetwork,
  computeStats,
  simulatePipelineBreak,
  generateWaterAdvisory,
  generatePostAnalytics,
  WATER_ZONES,
} from '../../data/waterNetwork';
import { getSocket } from '../../utils/socket';
import { haversine } from '../../data/responders';
import type { WaterTask, TaskStatus } from '../../data/responders';
import { buildRoute } from '../../data/technicians';
import './WaterPipelinePanel.scss';

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = 'https://dso_api.astrikos.xyz:8443';

const VIEWS: { id: WaterView; icon: string; label: string }[] = [
  { id: 'network',    icon: '🗺️', label: 'Network' },
  { id: 'monitoring', icon: '📊', label: 'Monitoring' },
  { id: 'incident',   icon: '🚨', label: 'Incidents' },
];

const SEV_COLOR: Record<string, string> = {
  LOW: '#4FC3F7', MEDIUM: '#FFB74D', HIGH: '#FF8A65', CRITICAL: '#ef5350',
};

const STAGE_LABELS: Partial<Record<WaterIncident['status'], string>> = {
  detecting:     '🔍 Detecting',
  validating:    '🧪 Validating',
  confirmed:     '⚠ Confirmed',
  auto_response: '🤖 Auto Response',
  assigning:     '📋 Assigning',
  assigned:      '👷 Assigned',
  en_route:      '🚗 En Route',
  repairing:     '🔧 Repairing',
  resolved:      '✅ Resolved',
};

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// ── Mini SVG gauge ────────────────────────────────────────────────────────────
function ArcGauge({ value, max, color, label, unit }: {
  value: number; max: number; color: string; label: string; unit: string;
}) {
  const r = 28; const circ = 2 * Math.PI * r;
  const dash = (Math.min(value, max) / max) * circ;
  return (
    <div className="wpp-gauge">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: 'stroke-dasharray 0.6s ease' }} />
        <text x="36" y="33" textAnchor="middle" fill="white" fontSize="12" fontWeight="700">{value}</text>
        <text x="36" y="44" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7">{unit}</text>
      </svg>
      <span className="wpp-gauge__label">{label}</span>
    </div>
  );
}

// ── Team member type from socket ──────────────────────────────────────────────
interface TeamMember {
  userId: string; name: string; role: string;
  online: boolean; status: string;
  lastLat: number | null; lastLng: number | null;
  distKm?: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface WaterPipelinePanelProps {
  activeView:    WaterView;
  onViewChange:  (v: WaterView) => void;
  onClose:       () => void;
  onNetworkReady?:    (nodes: WaterNode[], pipelines: Pipeline[]) => void;
  onIncidentChange?:  (incident: WaterIncident | null) => void;
  onWaterTasksChange?: (tasks: WaterTask[]) => void;
  onNodeFocus?:   (coords: [number, number]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WaterPipelinePanel({
  activeView, onViewChange, onClose, onNetworkReady, onIncidentChange, onWaterTasksChange, onNodeFocus,
}: WaterPipelinePanelProps) {

  // ── State ──────────────────────────────────────────────────────────────────
  const [network, setNetwork]         = useState<WaterNetworkState | null>(null);
  const [loading, setLoading]         = useState(true);
  const [incident, setIncident]       = useState<WaterIncident | null>(null);
  const [advisory, setAdvisory]       = useState<WaterAIAdvisory | null>(null);
  const [tickValues, setTickValues]   = useState({ flow: 0, pressure: 0 });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showAssign, setShowAssign]   = useState(false);
  const [waterTasks, setWaterTasks]   = useState<WaterTask[]>([]);
  const [repairStartedAt, setRepairStartedAt] = useState<number>(0);
  const [timeline, setTimeline]       = useState<{ time: string; label: string; icon: string }[]>([]);
  const [validationPct, setValidationPct] = useState(0);
  const validationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const addTimeline = useCallback((label: string, icon: string) => {
    setTimeline(prev => [...prev, { time: fmtTime(Date.now()), label, icon }]);
  }, []);

  // ── Load water network from API ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wRes, iRes, bRes] = await Promise.all([
          fetch(`${API_BASE}/water`),
          fetch(`${API_BASE}/infrastructure`),
          fetch(`${API_BASE}/buildings`),
        ]);
        const [wJson, iJson, bJson] = await Promise.all([wRes.json(), iRes.json(), bRes.json()]);
        if (cancelled) return;
        const { nodes, pipelines } = buildWaterNetwork(wJson, iJson, bJson);
        const stats = computeStats(pipelines);
        setNetwork({ nodes, pipelines, incident: null, stats });
        onNetworkReady?.(nodes, pipelines);
      } catch {
        const { nodes, pipelines } = buildWaterNetwork(
          { type: 'FeatureCollection', features: [] },
          { type: 'FeatureCollection', features: [] },
        );
        if (!cancelled) {
          setNetwork({ nodes, pipelines, incident: null, stats: computeStats(pipelines) });
          onNetworkReady?.(nodes, pipelines);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live monitoring tick ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!network) return;
    const tick = () => setTickValues({
      flow:     network.stats.totalFlow + Math.round((Math.random() - 0.5) * 200),
      pressure: network.stats.avgPressure + Math.round((Math.random() - 0.5) * 5),
    });
    tick();
    tickRef.current = setInterval(tick, 3000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [network]);

  // ── Socket: team members ─────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const handleUsers = (list: TeamMember[]) => {
      setTeamMembers(list.map(u => ({
        ...u,
        distKm: (u.lastLat != null && u.lastLng != null && incident?.location)
          ? haversine([u.lastLng, u.lastLat], incident.location)
          : undefined,
      })));
    };
    socket.on('users_update', handleUsers);
    socket.emit('get_users');
    return () => { socket.off('users_update', handleUsers); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.location]);

  // ── Push waterTasks upstream for map route tracking ──────────────────────────
  useEffect(() => { onWaterTasksChange?.(waterTasks); }, [waterTasks, onWaterTasksChange]);

  // ── WaterTask ticker: interpolate currentPos along road route ────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setWaterTasks(prev => {
        let changed = false;
        const updated = prev.map(t => {
          if (t.status === 'ARRIVED' || t.status === 'RESOLVED') return t;
          const elapsed = (Date.now() - t.sentAt) / 1000;
          let next: TaskStatus = t.status;
          let currentPos = t.currentPos;
          if (t.status === 'ACCEPTED') {
            const sinceAccepted = t.acceptedAt ? (Date.now() - t.acceptedAt) / 1000 : 0;
            if (sinceAccepted > 2) next = 'EN_ROUTE';
          }
          if (t.status === 'EN_ROUTE') {
            const realGPS = (t as WaterTask & { realPos?: [number, number] }).realPos;
            if (realGPS) {
              // Priority 1: real GPS from mobile — on-road once mobile has snapped to waypoints
              currentPos = realGPS;
            } else {
              const travelElapsed = t.acceptedAt
                ? Math.max(0, (Date.now() - t.acceptedAt) / 1000)
                : Math.max(0, elapsed - 9);
              const travelTotal   = t.distKm / 35 * 3600;
              if (t.routeCoords && t.routeCoords.length >= 2) {
                // Priority 2: interpolate along OSRM road waypoints
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
                // Priority 3: straight-line fallback
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

  // ── Socket: real GPS + route from mobile → update waterTask ─────────────────
  useEffect(() => {
    const socket = getSocket();
    const handleLocation = (data: { userId: string; lat: number; lng: number }) => {
      setWaterTasks(prev => prev.map(t => {
        if (t.responderId !== data.userId) return t;
        const pos: [number, number] = [data.lng, data.lat];
        const st = (t.status === 'ACCEPTED' || t.status === 'EN_ROUTE') ? 'EN_ROUTE' as TaskStatus : t.status;
        // Store as realPos so the ticker uses real GPS (Priority 1) instead of interpolating
        const updated = { ...t, currentPos: pos, status: st };
        (updated as WaterTask & { realPos: [number, number] }).realPos = pos;
        return updated as WaterTask;
      }));
    };
    const handleRoute = ({ taskId, coords }: { taskId: string; coords: [number, number][] }) => {
      setWaterTasks(prev => prev.map(t =>
        t.taskId === taskId ? { ...t, routeCoords: coords } : t
      ));
    };
    socket.on('responder_location', handleLocation);
    socket.on('task_route', handleRoute);
    return () => {
      socket.off('responder_location', handleLocation);
      socket.off('task_route', handleRoute);
    };
  }, []);

  // ── Socket: task status updates ──────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const handleTaskStatus = (data: { taskId: string; status: string; ts: number }) => {
      if (!data.taskId.startsWith('WTK-')) return;
      // Update waterTask status
      const statusMap: Record<string, TaskStatus> = {
        ACCEPTED: 'ACCEPTED', EN_ROUTE: 'EN_ROUTE', ARRIVED: 'ARRIVED', RESOLVED: 'RESOLVED',
      };
      const nextStatus = statusMap[data.status];
      if (nextStatus) {
        setWaterTasks(prev => prev.map(t => {
          if (t.taskId !== data.taskId) return t;
          return {
            ...t,
            status:     nextStatus,
            acceptedAt: data.status === 'ACCEPTED' ? data.ts : t.acceptedAt,
            arrivedAt:  data.status === 'ARRIVED'  ? data.ts : t.arrivedAt,
            resolvedAt: data.status === 'RESOLVED' ? data.ts : t.resolvedAt,
          };
        }));
      }
      // Update incident panel stage
      const incMap: Record<string, WaterIncident['status']> = {
        ACCEPTED: 'en_route', EN_ROUTE: 'en_route', ARRIVED: 'repairing', RESOLVED: 'resolved',
      };
      const next = incMap[data.status];
      if (!next) return;
      if (data.status === 'ACCEPTED')  addTimeline('Task accepted — crew en route', '✅');
      if (data.status === 'ARRIVED')   addTimeline('Crew arrived on site', '📍');
      if (data.status === 'RESOLVED') {
        addTimeline('Crew marked pipeline repaired', '✅');
        setIncident(prev => {
          if (!prev) return prev;
          const analytics = generatePostAnalytics(prev, repairStartedAt || Date.now() - 120000, Date.now());
          return { ...prev, status: 'resolved', analytics };
        });
        setNetwork(prev => {
          if (!prev || !incident) return prev;
          const np = prev.pipelines.map(p =>
            (p.id === incident.pipelineId || incident.upstreamPipeIds.includes(p.id) || incident.backupPipeIds.includes(p.id))
              ? { ...p, status: 'normal' as const, pressure: 75 + Math.round(Math.random() * 15) }
              : p
          );
          return { ...prev, pipelines: np, stats: computeStats(np) };
        });
        onIncidentChange?.(null);
        return;
      }
      setIncident(prev => prev ? { ...prev, status: next } : prev);
    };
    socket.on('task_status_update', handleTaskStatus);
    return () => { socket.off('task_status_update', handleTaskStatus); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.pipelineId, addTimeline, repairStartedAt]);

  // ── Trigger incident ─────────────────────────────────────────────────────────
  const triggerIncident = useCallback(() => {
    if (!network) return;
    const inc = simulatePipelineBreak(network.pipelines, network.nodes);
    if (!inc) return;

    setNetwork(prev => {
      if (!prev) return prev;
      const newPipelines = prev.pipelines.map(p => {
        if (p.id === inc.pipelineId)            return { ...p, status: 'burst'  as const };
        if (inc.upstreamPipeIds.includes(p.id)) return { ...p, status: 'closed' as const };
        if (inc.backupPipeIds.includes(p.id))   return { ...p, status: 'backup' as const };
        return p;
      });
      return { ...prev, pipelines: newPipelines, stats: computeStats(newPipelines) };
    });

    setIncident(inc);
    setTimeline([{ time: fmtTime(inc.detectedAt), label: 'Pressure anomaly detected by SCADA sensor', icon: '🔍' }]);
    setAdvisory(null);
    setShowAssign(false);
    setValidationPct(0);
    onIncidentChange?.(inc);
    onViewChange('incident');

    // Animate validation progress → confirmed → auto-response → assigning
    if (validationRef.current) clearInterval(validationRef.current);
    let pct = 0;
    setIncident(p => p ? { ...p, status: 'validating' } : p);
    addTimeline('Cross-checking sensor network…', '🧪');

    validationRef.current = setInterval(() => {
      pct += 4 + Math.round(Math.random() * 6);
      const val = Math.min(92, pct);
      setValidationPct(val);
      setIncident(p => p ? { ...p, validationScore: val } : p);

      if (pct >= 92) {
        clearInterval(validationRef.current!);
        setIncident(p => p ? { ...p, status: 'confirmed', validationScore: 92 } : p);
        addTimeline('Leakage confirmed — 92% confidence', '⚠');

        setTimeout(() => {
          const adv = generateWaterAdvisory(inc, network.nodes);
          setAdvisory(adv);
          addTimeline('AI advisory generated', '🤖');

          setTimeout(() => {
            setIncident(p => p ? { ...p, status: 'auto_response' } : p);
            addTimeline('Automated system response initiated', '🤖');

            inc.autoActions.forEach((_action, idx) => {
              setTimeout(() => {
                setIncident(p => {
                  if (!p) return p;
                  const updated = p.autoActions.map((a, i) =>
                    i === idx ? { ...a, status: 'done' as const } : a
                  );
                  const allDone = updated.every(a => a.status === 'done');
                  return { ...p, autoActions: updated, status: allDone ? 'assigning' : p.status };
                });
                addTimeline(inc.autoActions[idx].action, inc.autoActions[idx].icon);
              }, 700 * (idx + 1));
            });
          }, 1200);
        }, 800);
      }
    }, 200);
  }, [network, onIncidentChange, onViewChange, addTimeline]);

  // ── Dispatch responder ───────────────────────────────────────────────────────
  const dispatchResponder = useCallback((member: TeamMember) => {
    if (!incident) return;
    const taskId = `WTK-${incident.id}-${member.userId}`;

    // Create a trackable WaterTask for the map layer
    const origin:      [number, number] = member.lastLng != null && member.lastLat != null
      ? [member.lastLng, member.lastLat]
      : incident.location;
    const destination: [number, number] = incident.location;
    const distKm = member.distKm ?? 2;

    const waterTask: WaterTask = {
      taskId,
      responderId:   member.userId,
      responderName: member.name,
      role:          member.role,
      status:        'PENDING',
      origin,
      destination,
      currentPos:    origin,
      distKm,
      etaSec:        Math.round(distKm / 35 * 3600),
      sentAt:        Date.now(),
      acceptedAt:    null,
      arrivedAt:     null,
      resolvedAt:    null,
    };
    setWaterTasks(prev => [...prev, waterTask]);

    // Fetch road route from OSRM (dashboard-side, independent of mobile)
    buildRoute(origin, destination).then(coords => {
      if (coords.length >= 2) {
        setWaterTasks(prev => prev.map(t =>
          t.taskId === taskId ? { ...t, routeCoords: coords } : t
        ));
      }
    });

    setIncident(prev => prev ? { ...prev, status: 'assigned', assignedTo: member.userId, assignedName: member.name } : prev);
    addTimeline(`${member.name} (${member.userId}) dispatched via app`, '👷');
    setShowAssign(false);

    const socket = getSocket();
    socket.emit('send_task', {
      taskId,
      responderId:   member.userId,
      responderName: member.name,
      role:          member.role,
      icon:          '🔧',
      vehicle:       'Water Maintenance Van',
      taskType:      'water_pipeline',
      severity:      incident.severity,
      location:      incident.location,
      distKm,
      etaMin:        Math.round(distKm / 35 * 60),
      pipelineId:    incident.pipelineId,
      rootCause:     incident.rootCauseLabel,
      affectedUsers: incident.affectedUsers,
      detectedAt:    fmtTime(incident.detectedAt),
      message:       `🚨 Pipeline break at [${incident.location[1].toFixed(4)}, ${incident.location[0].toFixed(4)}]. Severity: ${incident.severity}. ${incident.affectedUsers} users affected. Cause: ${incident.rootCauseLabel}. Immediate action required.`,
    });
  }, [incident, addTimeline]);

  // ── Manual advance repair stage ──────────────────────────────────────────────
  const advanceRepair = useCallback(() => {
    setIncident(prev => {
      if (!prev) return prev;
      const order: WaterIncident['status'][] = ['assigning','assigned','en_route','repairing','resolved'];
      const idx = order.indexOf(prev.status);
      if (idx < 0 || idx >= order.length - 1) return prev;
      const next = order[idx + 1];
      if (next === 'repairing') setRepairStartedAt(Date.now());
      if (next === 'resolved') {
        const resolvedAt = Date.now();
        addTimeline('Pipeline restored — pressure normalizing', '✅');
        setNetwork(p => {
          if (!p) return p;
          const np = p.pipelines.map(pipe =>
            (pipe.id === prev.pipelineId || prev.upstreamPipeIds.includes(pipe.id) || prev.backupPipeIds.includes(pipe.id))
              ? { ...pipe, status: 'normal' as const, pressure: 75 + Math.round(Math.random() * 15) }
              : pipe
          );
          return { ...p, pipelines: np, stats: computeStats(np) };
        });
        onIncidentChange?.(null);
        const analytics = generatePostAnalytics(prev, repairStartedAt || Date.now() - 120000, resolvedAt);
        return { ...prev, status: 'resolved', analytics };
      }
      addTimeline(STAGE_LABELS[next] ?? next, '→');
      return { ...prev, status: next };
    });
  }, [addTimeline, onIncidentChange, repairStartedAt]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const nodesByType = useMemo(() => {
    if (!network) return {} as Record<string, WaterNode[]>;
    const map: Record<string, WaterNode[]> = {};
    for (const n of network.nodes) (map[n.type] ??= []).push(n);
    return map;
  }, [network]);

  useEffect(() => () => {
    if (validationRef.current) clearInterval(validationRef.current);
  }, []);

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Network
  // ════════════════════════════════════════════════════════════════════════════
  const renderNetwork = () => {
    if (!network) return null;
    const nodeTypeMeta = [
      { type: 'source',   icon: '💧', label: 'Water Sources',    color: '#4FC3F7' },
      { type: 'treatment',icon: '🏭', label: 'Treatment Plants', color: '#81C784' },
      { type: 'storage',  icon: '🏢', label: 'Storage Tanks',    color: '#4DD0E1' },
      { type: 'pump',     icon: '⚙️', label: 'Pump Stations',    color: '#FFB74D' },
      { type: 'tap',      icon: '🚰', label: 'Water Taps',       color: '#90CAF9' },
      { type: 'hydrant',  icon: '🚒', label: 'Fire Hydrants',    color: '#ef5350' },
      { type: 'drinking', icon: '🥤', label: 'Drinking Points',  color: '#80DEEA' },
      { type: 'building', icon: '🏠', label: 'Buildings',        color: '#CE93D8' },
    ];
    return (
      <div className="wpp-content">
        <div className="wpp-section-title">Water Distribution Network</div>
        <div className="wpp-subtitle">SOURCE → TREATMENT → STORAGE → PUMP → DISTRIBUTION → END USER</div>
        <div className="wpp-kpi-grid">
          <div className="wpp-kpi"><span className="wpp-kpi__val">{network.nodes.length}</span><span className="wpp-kpi__lbl">Nodes</span></div>
          <div className="wpp-kpi"><span className="wpp-kpi__val">{network.pipelines.length}</span><span className="wpp-kpi__lbl">Pipelines</span></div>
          <div className="wpp-kpi wpp-kpi--ok"><span className="wpp-kpi__val">{network.stats.activePipelines}</span><span className="wpp-kpi__lbl">Active</span></div>
          <div className="wpp-kpi wpp-kpi--warning"><span className="wpp-kpi__val">{network.stats.alerts}</span><span className="wpp-kpi__lbl">Alerts</span></div>
        </div>
        <div className="wpp-section-title" style={{ marginTop: 8 }}>Infrastructure Nodes</div>
        <div className="wpp-node-list">
          {nodeTypeMeta.map(({ type, icon, label, color }) => {
            const items = nodesByType[type] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={type} className="wpp-node-group">
                <div className="wpp-node-group__header">
                  <span className="wpp-node-group__icon">{icon}</span>
                  <span className="wpp-node-group__label" style={{ color }}>{label}</span>
                  <span className="wpp-node-group__count">{items.length}</span>
                </div>
                <ul className="wpp-node-group__items">
                  {items.slice(0, 4).map(n => (
                    <li key={n.id} className="wpp-node-item" onClick={() => onNodeFocus?.(n.location)}>
                      <span className="wpp-node-item__name">{n.name}</span>
                      <span className={`wpp-node-item__status wpp-node-item__status--${n.status}`}>{n.status}</span>
                    </li>
                  ))}
                  {items.length > 4 && <li className="wpp-node-item wpp-node-item--more">+{items.length - 4} more</li>}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="wpp-section-title" style={{ marginTop: 8 }}>Distribution Zones</div>
        <div className="wpp-zones">
          {WATER_ZONES.map(z => (
            <div key={z.id} className="wpp-zone-card" onClick={() => onNodeFocus?.(z.center)}>
              <div className="wpp-zone-card__name">{z.name}</div>
              <div className="wpp-zone-card__stats">
                <span>{network.nodes.filter(n => n.zone === z.id).length} nodes</span>
                <span>{network.pipelines.filter(p => network.nodes.find(n => n.id === p.from)?.zone === z.id).length} pipes</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Monitoring
  // ════════════════════════════════════════════════════════════════════════════
  const renderMonitoring = () => {
    if (!network) return null;
    const pipesByType = {
      main:         network.pipelines.filter(p => p.type === 'main'),
      distribution: network.pipelines.filter(p => p.type === 'distribution'),
      service:      network.pipelines.filter(p => p.type === 'service'),
    };
    return (
      <div className="wpp-content">
        <div className="wpp-section-title">Real-Time Flow Monitoring</div>
        <div className="wpp-live-tag"><span className="wpp-live-dot" />LIVE — updating every 3s</div>
        <div className="wpp-gauge-row">
          <ArcGauge value={tickValues.flow}     max={20000} color="#4FC3F7" label="Total Flow"   unit="L/min" />
          <ArcGauge value={tickValues.pressure} max={120}   color="#81C784" label="Avg Pressure" unit="PSI"   />
          <ArcGauge value={network.stats.activePipelines} max={network.pipelines.length} color="#FFB74D" label="Active" unit="pipes" />
        </div>
        <div className="wpp-section-title" style={{ marginTop: 8 }}>Pipeline Breakdown</div>
        {(['main', 'distribution', 'service'] as const).map(type => {
          const pipes = pipesByType[type];
          const avgP  = pipes.length > 0 ? Math.round(pipes.reduce((s, p) => s + p.pressure, 0) / pipes.length) : 0;
          const avgF  = pipes.length > 0 ? Math.round(pipes.reduce((s, p) => s + p.flowRate, 0) / pipes.length) : 0;
          const color = type === 'main' ? '#4FC3F7' : type === 'distribution' ? '#81C784' : '#CE93D8';
          return (
            <div key={type} className="wpp-pipe-row">
              <div className="wpp-pipe-row__type" style={{ borderLeftColor: color }}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </div>
              <div className="wpp-pipe-row__stats">
                <span>{pipes.length} pipes</span><span>Avg {avgP} PSI</span><span>{avgF} L/min</span>
              </div>
            </div>
          );
        })}
        <div className="wpp-section-title" style={{ marginTop: 8 }}>⚠ Active Alerts ({network.stats.alerts})</div>
        {network.stats.alerts === 0 && <div className="wpp-empty">All systems operating normally</div>}
        {network.pipelines.filter(p => p.status !== 'normal' && p.status !== 'backup').map(p => {
          const fromNode = network.nodes.find(n => n.id === p.from);
          return (
            <div key={p.id} className="wpp-alert-row" onClick={() => fromNode && onNodeFocus?.(fromNode.location)}>
              <span className="wpp-alert-row__icon">{p.status === 'burst' ? '💥' : p.status === 'leak' ? '💦' : p.status === 'closed' ? '🔴' : '⚠'}</span>
              <div className="wpp-alert-row__info">
                <span className="wpp-alert-row__pipe">{p.id}</span>
                <span className="wpp-alert-row__detail">{fromNode?.name ?? p.from} → {p.status.toUpperCase()} · {p.pressure} PSI</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Incident
  // ════════════════════════════════════════════════════════════════════════════
  const renderIncident = () => (
    <div className="wpp-content">
      <div className="wpp-section-title">Pipeline Incident Management</div>

      {/* No active incident */}
      {!incident && (
        <>
          <div className="wpp-empty" style={{ marginBottom: 8 }}>
            No active incident. Simulate a pipeline break to run the full response lifecycle.
          </div>
          <button className="wpp-btn wpp-btn--danger" onClick={triggerIncident} disabled={!network}>
            💥 Simulate Pipeline Break
          </button>
        </>
      )}

      {/* Active incident ──────────────────────────────────────────────── */}
      {incident && (
        <div className="wpp-incident">

          {/* Status bar */}
          <div className="wpp-incident__status-bar" style={{ borderLeftColor: SEV_COLOR[incident.severity] }}>
            <span className="wpp-incident__sev" style={{ background: SEV_COLOR[incident.severity] }}>{incident.severity}</span>
            <span className="wpp-incident__type">{incident.type === 'burst' ? '💥 Burst' : '💦 Leak'}</span>
            <span className="wpp-incident__stage">{STAGE_LABELS[incident.status] ?? incident.status}</span>
          </div>

          {/* ── Detecting / Validating: sensor readout ── */}
          {(incident.status === 'detecting' || incident.status === 'validating') && (
            <div className="wpp-validation-card">
              <div className="wpp-validation-title">🧪 Cross-checking sensor network…</div>
              <div className="wpp-validation-bar-wrap">
                <div className="wpp-validation-bar" style={{ width: `${validationPct}%` }} />
              </div>
              <div className="wpp-validation-pct">{validationPct}% confidence</div>
              <div className="wpp-sensor-list">
                {incident.sensorReadings.map(sr => (
                  <div key={sr.sensorId} className={`wpp-sensor-row ${sr.anomaly ? 'wpp-sensor-row--anomaly' : ''}`}>
                    <span className="wpp-sensor-id">{sr.sensorId}</span>
                    <span className="wpp-sensor-label">{sr.label}</span>
                    <span className={`wpp-sensor-trend wpp-sensor-trend--${sr.trend}`}>
                      {sr.trend === 'dropping' ? '↓' : sr.trend === 'rising' ? '↑' : '→'}
                    </span>
                    <span className="wpp-sensor-val" style={{ color: sr.anomaly ? '#ef5350' : '#81C784' }}>
                      {sr.value} {sr.unit}
                    </span>
                    {sr.anomaly && <span className="wpp-sensor-alert">⚠</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Confirmed+: details, root cause, impact ── */}
          {incident.status !== 'detecting' && incident.status !== 'validating' && (
            <>
              <div className="wpp-incident__detail-grid">
                <div className="wpp-d"><span className="wpp-d__l">Pipeline</span><span className="wpp-d__v">{incident.pipelineId}</span></div>
                <div className="wpp-d"><span className="wpp-d__l">Pressure Drop</span><span className="wpp-d__v" style={{ color: '#ef5350' }}>{incident.pressureDrop} PSI</span></div>
                <div className="wpp-d"><span className="wpp-d__l">Flow Reduction</span><span className="wpp-d__v" style={{ color: '#FF8A65' }}>{incident.flowReduction}%</span></div>
                <div className="wpp-d"><span className="wpp-d__l">Confidence</span><span className="wpp-d__v" style={{ color: '#81C784' }}>{incident.validationScore}%</span></div>
              </div>

              <div className="wpp-root-cause">
                <span className="wpp-root-cause__icon">🔬</span>
                <div>
                  <div className="wpp-root-cause__title">Probable Cause</div>
                  <div className="wpp-root-cause__label">{incident.rootCauseLabel}</div>
                </div>
              </div>

              <div className="wpp-section-title" style={{ marginTop: 10 }}>📊 Impact Analysis</div>
              <div className="wpp-impact-grid">
                <div className="wpp-impact-item">
                  <span className="wpp-impact-item__icon">🏠</span>
                  <span className="wpp-impact-item__val">{incident.impactDetail.buildings}</span>
                  <span className="wpp-impact-item__lbl">Buildings</span>
                </div>
                <div className="wpp-impact-item">
                  <span className="wpp-impact-item__icon">👥</span>
                  <span className="wpp-impact-item__val">{incident.impactDetail.population}</span>
                  <span className="wpp-impact-item__lbl">Users</span>
                </div>
                <div className="wpp-impact-item">
                  <span className="wpp-impact-item__icon">🚰</span>
                  <span className="wpp-impact-item__val">{incident.impactDetail.waterPoints}</span>
                  <span className="wpp-impact-item__lbl">Water Points</span>
                </div>
                <div className={`wpp-impact-item ${incident.impactDetail.hydrants > 0 ? 'wpp-impact-item--critical' : ''}`}>
                  <span className="wpp-impact-item__icon">🚒</span>
                  <span className="wpp-impact-item__val">{incident.impactDetail.hydrants}</span>
                  <span className="wpp-impact-item__lbl">Hydrants</span>
                </div>
                <div className="wpp-impact-item">
                  <span className="wpp-impact-item__icon">⏱</span>
                  <span className="wpp-impact-item__val">{incident.impactDetail.downtimeEst}</span>
                  <span className="wpp-impact-item__lbl">Est. min</span>
                </div>
              </div>
              <button className="wpp-btn wpp-btn--ghost" style={{ marginTop: 4 }} onClick={() => onNodeFocus?.(incident.location)}>
                📍 View on Map
              </button>
            </>
          )}

          {/* ── Auto-response actions ── */}
          {(['auto_response','assigning','assigned','en_route','repairing','resolved'] as WaterIncident['status'][]).includes(incident.status) && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>⚡ Automated System Response</div>
              <div className="wpp-auto-actions">
                {incident.autoActions.map(a => (
                  <div key={a.id} className={`wpp-auto-action wpp-auto-action--${a.status}`}>
                    <span className="wpp-auto-action__icon">{a.icon}</span>
                    <div className="wpp-auto-action__body">
                      <div className="wpp-auto-action__name">{a.action}</div>
                      <div className="wpp-auto-action__detail">{a.detail}</div>
                    </div>
                    <span className="wpp-auto-action__status">
                      {a.status === 'done' ? '✅' : a.status === 'executing' ? '⏳' : '◌'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── AI Advisory ── */}
          {advisory && incident.status !== 'detecting' && incident.status !== 'validating' && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>🤖 AI Advisory</div>
              <div className="wpp-advisory">
                <div className="wpp-advisory__title">{advisory.title}</div>
                <div className="wpp-advisory__impacts">
                  {advisory.impacts.map((imp, i) => <div key={i} className="wpp-advisory__impact">{imp}</div>)}
                </div>
                <div className="wpp-advisory__actions-title">Recommended Actions:</div>
                <ol className="wpp-advisory__actions">
                  {advisory.actions.map((a, i) => <li key={i}>{a}</li>)}
                </ol>
                <div className="wpp-advisory__eta">⏱ Est. resolution: {advisory.etaMinutes} min</div>
              </div>
            </>
          )}

          {/* ── Assignment ── */}
          {(incident.status === 'assigning' || incident.status === 'assigned') && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>👷 Team Assignment</div>
              {incident.status === 'assigning' && (
                <button className="wpp-btn wpp-btn--primary" onClick={() => setShowAssign(true)}>
                  📋 Assign Maintenance Crew
                </button>
              )}
              {incident.status === 'assigned' && incident.assignedName && (
                <div className="wpp-assigned-card">
                  <span className="wpp-assigned-card__icon">👷</span>
                  <div>
                    <div className="wpp-assigned-card__name">{incident.assignedName}</div>
                    <div className="wpp-assigned-card__id">{incident.assignedTo}</div>
                    <div className="wpp-assigned-card__sub">Waiting for mobile accept…</div>
                  </div>
                  <span className="wpp-assigned-card__badge wpp-assigned-card__badge--assigned">ASSIGNED</span>
                </div>
              )}
            </>
          )}

          {/* ── En route / Repairing ── */}
          {(incident.status === 'en_route' || incident.status === 'repairing') && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>🚗 Field Response</div>
              <div className="wpp-assigned-card">
                <span className="wpp-assigned-card__icon">{incident.status === 'repairing' ? '🔧' : '🚐'}</span>
                <div>
                  <div className="wpp-assigned-card__name">{incident.assignedName}</div>
                  <div className="wpp-assigned-card__sub">{incident.status === 'repairing' ? 'Repairing on site' : 'Driving to pipeline'}</div>
                </div>
                <span className={`wpp-assigned-card__badge wpp-assigned-card__badge--${incident.status}`}>
                  {incident.status === 'repairing' ? 'REPAIRING' : 'EN ROUTE'}
                </span>
              </div>
            </>
          )}

          {/* ── Workflow stepper ── */}
          {incident.status !== 'detecting' && incident.status !== 'validating' && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>📲 Response Workflow</div>
              <div className="wpp-workflow">
                {(['confirmed','auto_response','assigning','assigned','en_route','repairing','resolved'] as WaterIncident['status'][]).map((stage, idx) => {
                  const order = ['detecting','validating','confirmed','auto_response','assigning','assigned','en_route','repairing','resolved'];
                  const cur = order.indexOf(incident.status);
                  const me  = order.indexOf(stage);
                  const done   = me <= cur;
                  const active = me === cur;
                  const icons: Partial<Record<WaterIncident['status'], string>> = {
                    confirmed:'⚠', auto_response:'🤖', assigning:'📋',
                    assigned:'👷', en_route:'🚗', repairing:'🔧', resolved:'✅',
                  };
                  return (
                    <div key={stage} className={`wpp-workflow__step ${done ? 'wpp-workflow__step--done' : ''} ${active ? 'wpp-workflow__step--active' : ''}`}>
                      <div className="wpp-workflow__marker">{done ? '✓' : idx + 1}</div>
                      <span>{icons[stage]} {(STAGE_LABELS[stage] ?? stage).replace(/^[^\s]+\s/, '')}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Action buttons ── */}
          <div className="wpp-btn-row" style={{ marginTop: 10 }}>
            {incident.status === 'assigning' && !showAssign && (
              <button className="wpp-btn wpp-btn--primary" onClick={() => setShowAssign(true)}>
                📋 Assign Team
              </button>
            )}
            {(incident.status === 'assigned' || incident.status === 'en_route' || incident.status === 'repairing') && (
              <button className="wpp-btn wpp-btn--primary" onClick={advanceRepair}>
                {incident.status === 'assigned'  ? '🚗 Mark En Route' :
                 incident.status === 'en_route'  ? '🔧 Start Repair'  :
                 '✅ Mark Fixed'}
              </button>
            )}
            {incident.status === 'resolved' && (
              <button className="wpp-btn wpp-btn--secondary" onClick={() => {
                setIncident(null); setAdvisory(null); setTimeline([]); setValidationPct(0);
                setWaterTasks([]);
                onIncidentChange?.(null);
              }}>
                🔄 Reset Simulation
              </button>
            )}
          </div>

          {/* ── Post-incident analytics ── */}
          {incident.status === 'resolved' && incident.analytics && (
            <>
              <div className="wpp-section-title wpp-section-title--resolved" style={{ marginTop: 12 }}>
                📈 Post-Incident Analytics
              </div>
              <div className="wpp-analytics">
                <div className="wpp-analytics__row"><span>Response Time</span><span className="wpp-analytics__val">{fmtDuration(incident.analytics.responseTimeSec)}</span></div>
                <div className="wpp-analytics__row"><span>Repair Duration</span><span className="wpp-analytics__val">{fmtDuration(incident.analytics.repairDurationSec)}</span></div>
                <div className="wpp-analytics__row"><span>Total Downtime</span><span className="wpp-analytics__val" style={{ color: '#ef5350' }}>{fmtDuration(incident.analytics.totalDowntimeSec)}</span></div>
                <div className="wpp-analytics__row"><span>Users Impacted</span><span className="wpp-analytics__val">{incident.analytics.usersImpacted}</span></div>
                <div className="wpp-analytics__row"><span>Pipelines Affected</span><span className="wpp-analytics__val">{incident.analytics.pipelinesAffected}</span></div>
                <div className="wpp-analytics__row"><span>Resolved At</span><span className="wpp-analytics__val">{fmtTime(incident.analytics.resolvedAt)}</span></div>
              </div>
            </>
          )}

          {/* ── Timeline ── */}
          {timeline.length > 0 && (
            <>
              <div className="wpp-section-title" style={{ marginTop: 10 }}>📜 Incident Timeline</div>
              <div className="wpp-timeline">
                {[...timeline].reverse().map((e, i) => (
                  <div key={i} className="wpp-timeline__item">
                    <span className="wpp-timeline__icon">{e.icon}</span>
                    <div className="wpp-timeline__body">
                      <span className="wpp-timeline__time">{e.time}</span>
                      <span className="wpp-timeline__label">{e.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Assignment popup ──────────────────────────────────────── */}
      {showAssign && incident && (
        <div className="wpp-assign-overlay" onClick={() => setShowAssign(false)}>
          <div className="wpp-assign-popup" onClick={e => e.stopPropagation()}>
            <div className="wpp-assign-popup__header">
              <span>👷 Assign Maintenance Crew</span>
              <button className="wpp-assign-popup__close" onClick={() => setShowAssign(false)}>✕</button>
            </div>
            <div className="wpp-assign-popup__sub">Select a team member to dispatch</div>
            <div className="wpp-assign-popup__msg">
              📢 <em>"{`Pipeline ${incident.pipelineId} break — ${incident.severity} priority. ${incident.affectedUsers} users affected.`}"</em>
            </div>
            <div className="wpp-assign-list">
              {teamMembers.length === 0 && (
                <div className="wpp-empty">No team members online. Register via mobile app.</div>
              )}
              {/* Sort: Water Engineer + Maintenance first (priority roles), then others */}
              {[...teamMembers]
                .sort((a, b) => {
                  const priority = (r: string) =>
                    r === 'Water Engineer' ? 0 : r === 'Maintenance' ? 1 : 2;
                  return priority(a.role) - priority(b.role);
                })
                .slice(0, 12).map(m => {
                const dist = m.distKm?.toFixed(1) ?? '?';
                const eta  = m.distKm ? Math.round(m.distKm / 35 * 60) : null;
                const isPriority = m.role === 'Water Engineer' || m.role === 'Maintenance';
                return (
                  <div key={m.userId} className={`wpp-assign-member ${!m.online ? 'wpp-assign-member--offline' : ''}`}>
                    <div className={`wpp-assign-member__dot wpp-assign-member__dot--${m.online ? (m.status === 'available' ? 'available' : 'busy') : 'offline'}`} />
                    <div className="wpp-assign-member__info">
                      <div className="wpp-assign-member__name">
                        {m.name}
                        {isPriority && <span style={{ marginLeft: 6, fontSize: 10, color: '#4FC3F7', fontWeight: 700 }}>★ PRIORITY</span>}
                      </div>
                      <div className="wpp-assign-member__meta">{m.role} · {m.userId} · {dist} km{eta ? ` · ETA ${eta}m` : ''}</div>
                    </div>
                    <button
                      className="wpp-btn wpp-btn--sm wpp-btn--primary"
                      disabled={!m.online || m.status !== 'available'}
                      onClick={() => dispatchResponder(m)}
                    >Dispatch</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Loading shell ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="wpp-panel">
        <div className="wpp-panel__header">
          <div className="wpp-panel__header-left">
            <span className="wpp-panel__header-icon">💧</span>
            <div>
              <div className="wpp-panel__header-title">WATER PIPELINE MGMT</div>
              <div className="wpp-panel__header-sub">Loading network…</div>
            </div>
          </div>
          <button className="wpp-panel__close" onClick={onClose}>×</button>
        </div>
        <div className="wpp-content" style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          <div className="wpp-spinner" /> Connecting to API…
        </div>
      </div>
    );
  }

  // ── Main panel ───────────────────────────────────────────────────────────────
  return (
    <div className="wpp-panel">
      <div className="wpp-panel__header">
        <div className="wpp-panel__header-left">
          <span className="wpp-panel__header-icon">💧</span>
          <div>
            <div className="wpp-panel__header-title">WATER PIPELINE MGMT</div>
            <div className="wpp-panel__header-sub">DSO Infrastructure · Real-Time Monitoring</div>
          </div>
        </div>
        <button className="wpp-panel__close" onClick={onClose}>×</button>
      </div>

      <div className="wpp-panel__live">
        <span className="wpp-live-dot" />
        LIVE DATA · {network?.nodes.length ?? 0} nodes · {network?.pipelines.length ?? 0} pipelines
        {incident && incident.status !== 'resolved' && <span className="wpp-live-incident"> · 🚨 INCIDENT ACTIVE</span>}
      </div>

      <div className="wpp-panel__tabs">
        {VIEWS.map(v => (
          <button key={v.id} className={`wpp-tab ${activeView === v.id ? 'wpp-tab--active' : ''}`} onClick={() => onViewChange(v.id)}>
            <span className="wpp-tab__icon">{v.icon}</span>
            <span className="wpp-tab__label">{v.label}</span>
            {v.id === 'incident' && incident && incident.status !== 'resolved' && (
              <span className="wpp-tab__badge" />
            )}
          </button>
        ))}
      </div>

      <div className="wpp-panel__body">
        {activeView === 'network'    && renderNetwork()}
        {activeView === 'monitoring' && renderMonitoring()}
        {activeView === 'incident'   && renderIncident()}
      </div>
    </div>
  );
}
