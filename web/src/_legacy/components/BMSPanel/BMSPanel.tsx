import { useState, useMemo } from 'react';
import type { BMSSubView, BMSLayerMode } from '../../types';
import { bmsBuildings, getBMSCityStats } from '../../data/bmsBuildings';
import type { BMSBuilding } from '../../data/bmsBuildings';
import './BMSPanel.scss';

interface BMSPanelProps {
  activeView: BMSSubView;
  onViewChange: (v: BMSSubView) => void;
  onLayerModeChange: (mode: BMSLayerMode) => void;
  layerMode: BMSLayerMode;
  onBuildingSelect: (b: BMSBuilding | null) => void;
  selectedBuildingId: string | null;
  onClose: () => void;
  onSimulate: (type: 'power' | 'hvac' | 'fire' | 'occupancy') => void;
}

const VIEWS: { id: BMSSubView; icon: string; label: string }[] = [
  { id: 'overview',  icon: '🏙️', label: 'Overview' },
  { id: 'energy',    icon: '⚡',  label: 'Energy' },
  { id: 'hvac',      icon: '🌡️', label: 'HVAC' },
  { id: 'fire',      icon: '🔥',  label: 'Fire' },
  { id: 'occupancy', icon: '👥',  label: 'Occupancy' },
  { id: 'water',     icon: '🚰',  label: 'Water' },
  { id: 'alerts',    icon: '🚨',  label: 'Alerts' },
];

const LAYER_MODES: { id: BMSLayerMode; icon: string; label: string; color: string }[] = [
  { id: 'status',    icon: '🔴', label: 'Status',    color: '#00E5FF' },
  { id: 'power',     icon: '⚡',  label: 'Power',     color: '#4FC3F7' },
  { id: 'hvac',      icon: '🌡️', label: 'HVAC',      color: '#81C784' },
  { id: 'occupancy', icon: '👥',  label: 'Occupancy', color: '#FFB74D' },
  { id: 'water',     icon: '🚰',  label: 'Water',     color: '#4DD0E1' },
];

// Status dot
function StatusDot({ status }: { status: BMSBuilding['status'] }) {
  return <span className={`bms-dot bms-dot--${status}`} />;
}

// Gauge arc
function ArcGauge({ value, max, color, label, unit }: {
  value: number; max: number; color: string; label: string; unit: string;
}) {
  const r = 28; const circ = 2 * Math.PI * r; const dash = (value / max) * circ;
  return (
    <div className="bms-gauge">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: 'stroke-dasharray 0.6s ease' }} />
        <text x="36" y="33" textAnchor="middle" fill="white" fontSize="12" fontWeight="700">{value}</text>
        <text x="36" y="44" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7">{unit}</text>
      </svg>
      <span className="bms-gauge__label">{label}</span>
    </div>
  );
}

export default function BMSPanel({
  activeView, onViewChange, onLayerModeChange, layerMode,
  onBuildingSelect, selectedBuildingId, onClose, onSimulate,
}: BMSPanelProps) {
  const [simRunning, setSimRunning] = useState<string | null>(null);
  const stats = useMemo(() => getBMSCityStats(), []);

  const criticalBuildings = useMemo(() =>
    bmsBuildings.filter(b => b.status === 'critical').slice(0, 5), []);
  const allAlerts = useMemo(() =>
    bmsBuildings.flatMap(b => b.alerts.map(a => ({ ...a, buildingName: b.name, buildingId: b.id })))
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      }),
  []);

  const handleSim = (type: 'power' | 'hvac' | 'fire' | 'occupancy') => {
    setSimRunning(type);
    onSimulate(type);
    setTimeout(() => setSimRunning(null), 3000);
  };

  const renderOverview = () => (
    <div className="bms-content">
      {/* City KPIs */}
      <div className="bms-section-title">City BMS — Live KPIs</div>
      <div className="bms-kpi-grid">
        <div className="bms-kpi">
          <span className="bms-kpi__val">{stats.total}</span>
          <span className="bms-kpi__lbl">Buildings</span>
        </div>
        <div className="bms-kpi bms-kpi--critical">
          <span className="bms-kpi__val">{stats.critical}</span>
          <span className="bms-kpi__lbl">Critical</span>
        </div>
        <div className="bms-kpi bms-kpi--warning">
          <span className="bms-kpi__val">{stats.warning}</span>
          <span className="bms-kpi__lbl">Warning</span>
        </div>
        <div className="bms-kpi bms-kpi--normal">
          <span className="bms-kpi__val">{stats.normal}</span>
          <span className="bms-kpi__lbl">Healthy</span>
        </div>
      </div>

      {/* System gauges */}
      <div className="bms-section-title">System Health</div>
      <div className="bms-gauges">
        <ArcGauge value={stats.avgPower}  max={100} color="#4FC3F7" label="Avg Power" unit="%" />
        <ArcGauge value={stats.avgHVAC}   max={100} color="#81C784" label="HVAC Eff"  unit="%" />
        <ArcGauge value={stats.avgOccup}  max={100} color="#FFB74D" label="Occupancy" unit="%" />
      </div>

      {/* Total energy */}
      <div className="bms-stat-row">
        <span className="bms-stat-row__label">Total Power Draw</span>
        <span className="bms-stat-row__val" style={{ color: '#4FC3F7' }}>{(stats.totalKW / 1000).toFixed(1)} MW</span>
      </div>
      <div className="bms-stat-row">
        <span className="bms-stat-row__label">Active Alerts</span>
        <span className="bms-stat-row__val" style={{ color: '#FF5252' }}>{stats.totalAlerts}</span>
      </div>
      <div className="bms-stat-row">
        <span className="bms-stat-row__label">Buildings with Fire Alarms</span>
        <span className="bms-stat-row__val" style={{ color: stats.fireBuildings > 0 ? '#FF5252' : '#00E400' }}>
          {stats.fireBuildings}
        </span>
      </div>

      {/* Map layer selector */}
      <div className="bms-section-title">Map Layer</div>
      <div className="bms-layer-btns">
        {LAYER_MODES.map(lm => (
          <button
            key={lm.id}
            className={`bms-layer-btn ${layerMode === lm.id ? 'bms-layer-btn--active' : ''}`}
            style={layerMode === lm.id ? { borderColor: lm.color, color: lm.color } : {}}
            onClick={() => onLayerModeChange(lm.id)}
          >
            <span>{lm.icon}</span>
            <span>{lm.label}</span>
          </button>
        ))}
      </div>

      {/* Critical buildings */}
      {criticalBuildings.length > 0 && (
        <>
          <div className="bms-section-title" style={{ color: '#FF5252' }}>🔴 Critical Buildings</div>
          <div className="bms-building-list">
            {criticalBuildings.map(b => (
              <button key={b.id} className={`bms-building-row bms-building-row--critical ${selectedBuildingId === b.id ? 'bms-building-row--selected' : ''}`}
                onClick={() => onBuildingSelect(b)}>
                <StatusDot status={b.status} />
                <div className="bms-building-row__info">
                  <span className="bms-building-row__name">{b.name}</span>
                  <span className="bms-building-row__meta">{b.zone} · {b.alerts.length} alert{b.alerts.length !== 1 ? 's' : ''}</span>
                </div>
                <span className="bms-building-row__power">{b.powerLoad}%</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Simulation controls */}
      <div className="bms-section-title">Simulation Controls</div>
      <div className="bms-sim-grid">
        {(['power', 'hvac', 'fire', 'occupancy'] as const).map(type => {
          const meta = { power: { icon: '⚡', label: 'Power Failure', color: '#4FC3F7' }, hvac: { icon: '🌡️', label: 'HVAC Issue', color: '#81C784' }, fire: { icon: '🔥', label: 'Fire Alarm', color: '#FF5252' }, occupancy: { icon: '👥', label: 'Occupancy Spike', color: '#FFB74D' } }[type];
          return (
            <button key={type} className={`bms-sim-btn ${simRunning === type ? 'bms-sim-btn--running' : ''}`}
              style={{ borderColor: `${meta.color}44` }}
              onClick={() => handleSim(type)}>
              <span className="bms-sim-btn__icon">{meta.icon}</span>
              <span className="bms-sim-btn__label">{simRunning === type ? 'Simulating…' : meta.label}</span>
              {simRunning === type && <span className="bms-sim-btn__pulse" style={{ background: meta.color }} />}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderEnergy = () => {
    const sorted = [...bmsBuildings].sort((a, b) => b.powerLoad - a.powerLoad).slice(0, 15);
    return (
      <div className="bms-content">
        <div className="bms-section-title">Energy Monitoring</div>
        <div className="bms-gauges">
          <ArcGauge value={stats.avgPower} max={100} color="#4FC3F7" label="Avg Load" unit="%" />
          <ArcGauge value={Math.round(stats.totalKW / 1000 * 10) / 10} max={30} color="#FF9800" label="Total MW" unit="MW" />
          <ArcGauge value={bmsBuildings.filter(b => b.powerLoad > 80).length} max={stats.total} color="#FF5252" label="Overload" unit="bldgs" />
        </div>
        <div className="bms-stat-row">
          <span className="bms-stat-row__label">Peak Consuming Building</span>
          <span className="bms-stat-row__val" style={{ color: '#FF5252' }}>{bmsBuildings.sort((a,b) => b.powerKW - a.powerKW)[0].name}</span>
        </div>
        <div className="bms-section-title">Top Energy Consumers</div>
        <div className="bms-table">
          <div className="bms-table__head">
            <span>Building</span><span>Load%</span><span>kW</span>
          </div>
          {sorted.map(b => (
            <button key={b.id} className={`bms-table__row ${b.status !== 'normal' ? `bms-table__row--${b.status}` : ''} ${selectedBuildingId === b.id ? 'bms-table__row--selected' : ''}`}
              onClick={() => onBuildingSelect(b)}>
              <span className="bms-table__name"><StatusDot status={b.status}/>{b.name}</span>
              <span className="bms-table__metric" style={{ color: b.powerLoad > 85 ? '#FF5252' : b.powerLoad > 75 ? '#FF9800' : '#4FC3F7' }}>{b.powerLoad}%</span>
              <span className="bms-table__metric">{b.powerKW > 999 ? `${(b.powerKW/1000).toFixed(1)}M` : b.powerKW}<span style={{fontSize:'8px',opacity:0.5}}>kW</span></span>
            </button>
          ))}
        </div>
        <div className="bms-section-title">AI Advisory</div>
        <div className="bms-ai-box">
          <span className="bms-ai-box__icon">🤖</span>
          <div>
            <div className="bms-ai-box__title">Energy Optimization Suggestion</div>
            <div className="bms-ai-box__body">Buildings {bmsBuildings.filter(b=>b.powerLoad>80).slice(0,2).map(b=>b.id).join(', ')} are approaching critical load. Recommend shifting non-critical HVAC cycles to off-peak (22:00–06:00) to reduce demand by ~15%.</div>
          </div>
        </div>
      </div>
    );
  };

  const renderHVAC = () => {
    const sorted = [...bmsBuildings].sort((a, b) => a.hvacEfficiency - b.hvacEfficiency).slice(0, 15);
    return (
      <div className="bms-content">
        <div className="bms-section-title">HVAC Monitoring</div>
        <div className="bms-gauges">
          <ArcGauge value={stats.avgHVAC} max={100} color="#81C784" label="Avg Eff." unit="%" />
          <ArcGauge value={bmsBuildings.filter(b=>b.hvacEfficiency<70).length} max={stats.total} color="#FF5252" label="Low Eff." unit="bldgs" />
          <ArcGauge value={Math.round(bmsBuildings.reduce((s,b)=>s+b.temperatureAvg,0)/bmsBuildings.length)} max={35} color="#FF9800" label="Avg Temp" unit="°C" />
        </div>
        <div className="bms-section-title">Lowest HVAC Efficiency</div>
        <div className="bms-table">
          <div className="bms-table__head"><span>Building</span><span>Eff.%</span><span>°C</span></div>
          {sorted.map(b => (
            <button key={b.id} className={`bms-table__row ${b.status !== 'normal' ? `bms-table__row--${b.status}` : ''} ${selectedBuildingId === b.id ? 'bms-table__row--selected' : ''}`}
              onClick={() => onBuildingSelect(b)}>
              <span className="bms-table__name"><StatusDot status={b.status}/>{b.name}</span>
              <span className="bms-table__metric" style={{color: b.hvacEfficiency<65?'#FF5252':b.hvacEfficiency<78?'#FF9800':'#81C784'}}>{b.hvacEfficiency}%</span>
              <span className="bms-table__metric" style={{color: b.temperatureAvg>26?'#FF9800':'#81C784'}}>{b.temperatureAvg}°</span>
            </button>
          ))}
        </div>
        <div className="bms-section-title">AI Advisory</div>
        <div className="bms-ai-box">
          <span className="bms-ai-box__icon">🤖</span>
          <div>
            <div className="bms-ai-box__title">Predictive HVAC Maintenance</div>
            <div className="bms-ai-box__body">Based on current efficiency trends, {bmsBuildings.filter(b=>b.hvacEfficiency<65)[0]?.name ?? 'Data Center DSO-2'} is predicted to face HVAC failure within 2–4 hours. Dispatch maintenance team immediately.</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFire = () => {
    const fireBuildings = bmsBuildings.filter(b => b.fireAlarms > 0);
    const highRisk = bmsBuildings.filter(b => b.alerts.some(a => a.system === 'fire')).slice(0, 8);
    return (
      <div className="bms-content">
        <div className="bms-section-title">Fire & Safety Status</div>
        <div className="bms-kpi-grid">
          <div className={`bms-kpi ${fireBuildings.length > 0 ? 'bms-kpi--critical' : 'bms-kpi--normal'}`}>
            <span className="bms-kpi__val">{fireBuildings.length}</span>
            <span className="bms-kpi__lbl">Active Fire Alarms</span>
          </div>
          <div className="bms-kpi">
            <span className="bms-kpi__val">{bmsBuildings.reduce((s,b)=>s+b.smokeDetectors,0)}</span>
            <span className="bms-kpi__lbl">Smoke Detectors</span>
          </div>
          <div className="bms-kpi">
            <span className="bms-kpi__val">{bmsBuildings.length}</span>
            <span className="bms-kpi__lbl">Buildings Monitored</span>
          </div>
        </div>
        {fireBuildings.length > 0 && (
          <>
            <div className="bms-section-title" style={{color:'#FF5252'}}>🔥 Active Fire Alerts</div>
            {fireBuildings.map(b => (
              <div key={b.id} className="bms-fire-card">
                <div className="bms-fire-card__header">
                  <span className="bms-fire-card__icon">🔥</span>
                  <span className="bms-fire-card__name">{b.name}</span>
                  <span className="bms-fire-card__badge">CRITICAL</span>
                </div>
                {b.alerts.filter(a=>a.system==='fire').map(a=>(
                  <div key={a.id} className="bms-fire-card__msg">{a.message}</div>
                ))}
                <div className="bms-fire-card__actions">
                  <button className="bms-fire-card__btn bms-fire-card__btn--dispatch">Dispatch Emergency</button>
                  <button className="bms-fire-card__btn bms-fire-card__btn--view" onClick={()=>onBuildingSelect(b)}>View Building</button>
                </div>
              </div>
            ))}
          </>
        )}
        <div className="bms-section-title">High Risk Buildings</div>
        <div className="bms-table">
          <div className="bms-table__head"><span>Building</span><span>Alarms</span><span>Detectors</span></div>
          {highRisk.map(b=>(
            <button key={b.id} className={`bms-table__row bms-table__row--${b.status} ${selectedBuildingId===b.id?'bms-table__row--selected':''}`}
              onClick={()=>onBuildingSelect(b)}>
              <span className="bms-table__name"><StatusDot status={b.status}/>{b.name}</span>
              <span className="bms-table__metric" style={{color:b.fireAlarms>0?'#FF5252':'#FF9800'}}>{b.fireAlarms}</span>
              <span className="bms-table__metric">{b.smokeDetectors}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderOccupancy = () => {
    const sorted = [...bmsBuildings].sort((a,b)=>b.occupancy-a.occupancy).slice(0,12);
    return (
      <div className="bms-content">
        <div className="bms-section-title">Occupancy Overview</div>
        <div className="bms-gauges">
          <ArcGauge value={stats.avgOccup} max={100} color="#FFB74D" label="Avg Occ." unit="%" />
          <ArcGauge value={bmsBuildings.filter(b=>b.occupancy>85).length} max={stats.total} color="#FF5252" label="Near Full" unit="bldgs" />
          <ArcGauge value={Math.round(bmsBuildings.reduce((s,b)=>s+b.occupancyCount,0)/1000)} max={50} color="#4FC3F7" label="Total People" unit="K" />
        </div>
        <div className="bms-stat-row">
          <span className="bms-stat-row__label">Total Occupants Tracked</span>
          <span className="bms-stat-row__val" style={{color:'#FFB74D'}}>{bmsBuildings.reduce((s,b)=>s+b.occupancyCount,0).toLocaleString()}</span>
        </div>
        <div className="bms-section-title">Highest Occupancy Buildings</div>
        <div className="bms-table">
          <div className="bms-table__head"><span>Building</span><span>Occ.%</span><span>Count</span></div>
          {sorted.map(b=>(
            <button key={b.id} className={`bms-table__row ${b.status!=='normal'?`bms-table__row--${b.status}`:''} ${selectedBuildingId===b.id?'bms-table__row--selected':''}`}
              onClick={()=>onBuildingSelect(b)}>
              <span className="bms-table__name"><StatusDot status={b.status}/>{b.name}</span>
              <span className="bms-table__metric" style={{color:b.occupancy>88?'#FF5252':b.occupancy>75?'#FF9800':'#81C784'}}>{b.occupancy}%</span>
              <span className="bms-table__metric">{b.occupancyCount.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="bms-section-title">AI Advisory</div>
        <div className="bms-ai-box">
          <span className="bms-ai-box__icon">🤖</span>
          <div>
            <div className="bms-ai-box__title">Occupancy Redistribution</div>
            <div className="bms-ai-box__body">{bmsBuildings.filter(b=>b.occupancy>88).length} buildings at near-capacity. AI recommends directing overflow occupants to {bmsBuildings.filter(b=>b.occupancy<50).slice(0,2).map(b=>b.name).join(' or ')}, which currently have availability.</div>
          </div>
        </div>
      </div>
    );
  };

  const renderWater = () => {
    const lowPressure = bmsBuildings.filter(b=>b.waterPressure>0&&b.waterPressure<3.0).slice(0,8);
    const sorted = [...bmsBuildings].filter(b=>b.waterUsage>0).sort((a,b)=>b.waterUsage-a.waterUsage).slice(0,12);
    return (
      <div className="bms-content">
        <div className="bms-section-title">Water Systems</div>
        <div className="bms-gauges">
          <ArcGauge value={Math.round(bmsBuildings.reduce((s,b)=>s+b.waterUsage,0)/1000)} max={120} color="#4DD0E1" label="Total L/hr" unit="KL" />
          <ArcGauge value={lowPressure.length} max={stats.total} color="#FF9800" label="Low Press." unit="bldgs" />
          <ArcGauge value={Math.round(bmsBuildings.filter(b=>b.waterPressure>0).reduce((s,b)=>s+b.waterPressure,0)/bmsBuildings.filter(b=>b.waterPressure>0).length*10)/10} max={5} color="#4FC3F7" label="Avg Press." unit="bar" />
        </div>
        {lowPressure.length > 0 && (
          <>
            <div className="bms-section-title" style={{color:'#FF9800'}}>⚠️ Low Pressure Alerts</div>
            {lowPressure.map(b=>(
              <div key={b.id} className="bms-alert-row">
                <StatusDot status={b.status}/>
                <span className="bms-alert-row__name">{b.name}</span>
                <span className="bms-alert-row__val" style={{color:'#FF9800'}}>{b.waterPressure} bar</span>
              </div>
            ))}
          </>
        )}
        <div className="bms-section-title">Highest Water Usage</div>
        <div className="bms-table">
          <div className="bms-table__head"><span>Building</span><span>L/hr</span><span>Bar</span></div>
          {sorted.map(b=>(
            <button key={b.id} className={`bms-table__row ${b.status!=='normal'?`bms-table__row--${b.status}`:''} ${selectedBuildingId===b.id?'bms-table__row--selected':''}`}
              onClick={()=>onBuildingSelect(b)}>
              <span className="bms-table__name"><StatusDot status={b.status}/>{b.name}</span>
              <span className="bms-table__metric" style={{color:'#4DD0E1'}}>{b.waterUsage.toLocaleString()}</span>
              <span className="bms-table__metric" style={{color:b.waterPressure<3.0?'#FF9800':'#4DD0E1'}}>{b.waterPressure}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderAlerts = () => (
    <div className="bms-content">
      <div className="bms-section-title">Active Alerts — All Systems</div>
      <div className="bms-kpi-grid">
        <div className="bms-kpi bms-kpi--critical">
          <span className="bms-kpi__val">{allAlerts.filter(a=>a.severity==='critical').length}</span>
          <span className="bms-kpi__lbl">Critical</span>
        </div>
        <div className="bms-kpi bms-kpi--warning">
          <span className="bms-kpi__val">{allAlerts.filter(a=>a.severity==='warning').length}</span>
          <span className="bms-kpi__lbl">Warning</span>
        </div>
        <div className="bms-kpi">
          <span className="bms-kpi__val">{allAlerts.length}</span>
          <span className="bms-kpi__lbl">Total</span>
        </div>
      </div>
      <div className="bms-alerts-list">
        {allAlerts.map(a => {
          const sysIcon = { power: '⚡', hvac: '🌡️', fire: '🔥', occupancy: '👥', water: '🚰' }[a.system];
          const age = Math.floor((Date.now() - a.timestamp) / 60000);
          return (
            <div key={a.id} className={`bms-alert-card bms-alert-card--${a.severity}`}>
              <div className="bms-alert-card__header">
                <span className="bms-alert-card__icon">{sysIcon}</span>
                <div className="bms-alert-card__title">
                  <span className="bms-alert-card__bldg">{a.buildingName}</span>
                  <span className="bms-alert-card__badge bms-alert-card__badge--${a.severity}">{a.severity.toUpperCase()}</span>
                </div>
                <span className="bms-alert-card__time">{age}m ago</span>
              </div>
              <div className="bms-alert-card__msg">{a.message}</div>
              <div className="bms-alert-card__footer">
                <span>{a.system.toUpperCase()}</span>
                <button className="bms-alert-card__ack">Acknowledge</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeView) {
      case 'overview':  return renderOverview();
      case 'energy':    return renderEnergy();
      case 'hvac':      return renderHVAC();
      case 'fire':      return renderFire();
      case 'occupancy': return renderOccupancy();
      case 'water':     return renderWater();
      case 'alerts':    return renderAlerts();
    }
  };

  return (
    <div className="bms-panel">
      {/* Header */}
      <div className="bms-panel__header">
        <div className="bms-panel__header-left">
          <span className="bms-panel__header-icon">🏢</span>
          <div>
            <div className="bms-panel__header-title">Building Management System</div>
            <div className="bms-panel__header-sub">DSO City-Wide · {stats.total} Buildings</div>
          </div>
        </div>
        <button className="bms-panel__close" onClick={onClose}>✕</button>
      </div>

      {/* Live bar */}
      <div className="bms-panel__live">
        <span className="bms-panel__live-dot" />
        <span>LIVE · {new Date().toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'})}</span>
        <span className="bms-panel__live-sep">|</span>
        <span className={`bms-panel__live-status ${stats.critical > 0 ? 'bms-panel__live-status--critical' : ''}`}>
          {stats.critical > 0 ? `${stats.critical} CRITICAL` : 'ALL SYSTEMS MONITORED'}
        </span>
      </div>

      {/* Tab nav */}
      <div className="bms-panel__tabs">
        {VIEWS.map(v => (
          <button key={v.id} className={`bms-panel__tab ${activeView === v.id ? 'bms-panel__tab--active' : ''}`}
            onClick={() => onViewChange(v.id)}>
            <span>{v.icon}</span>
            <span>{v.label}</span>
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="bms-panel__body">{renderContent()}</div>
    </div>
  );
}
