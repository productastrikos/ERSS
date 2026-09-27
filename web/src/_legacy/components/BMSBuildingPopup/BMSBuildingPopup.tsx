import type { BMSBuilding } from '../../data/bmsBuildings';
import './BMSBuildingPopup.scss';

interface BMSBuildingPopupProps {
  building: BMSBuilding;
  onClose: () => void;
  onOpenNest?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  commercial: 'Commercial', residential: 'Residential',
  tech: 'Tech Hub', villa: 'Villa', mixed: 'Mixed-Use', industrial: 'Industrial',
};

function MetricBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="bms-popup__metric">
      <div className="bms-popup__metric-header">
        <span className="bms-popup__metric-label">{label}</span>
        <span className="bms-popup__metric-val" style={{ color }}>{value}<span style={{ fontSize: '8px', opacity: 0.6 }}>%</span></span>
      </div>
      <div className="bms-popup__bar">
        <div className="bms-popup__bar-fill"
          style={{ width: `${(value / max) * 100}%`, background: color,
          boxShadow: `0 0 6px ${color}88` }} />
      </div>
    </div>
  );
}

export default function BMSBuildingPopup({ building, onClose, onOpenNest: _onOpenNest }: BMSBuildingPopupProps) {
  const criticalAlerts = building.alerts.filter(a => a.severity === 'critical');
  const warningAlerts  = building.alerts.filter(a => a.severity === 'warning');

  return (
    <div className="bms-popup">
      {/* Severity top stripe */}
      <div className={`bms-popup__stripe bms-popup__stripe--${building.status}`} />

      <button className="bms-popup__close" onClick={onClose}>✕</button>

      {/* Building identity */}
      <div className="bms-popup__identity">
        <div>
          <div className="bms-popup__name">{building.name}</div>
          <div className="bms-popup__meta">
            <span className="bms-popup__type">{TYPE_LABELS[building.type] ?? building.type}</span>
            <span className="bms-popup__sep">·</span>
            <span>{building.zone}</span>
            <span className="bms-popup__sep">·</span>
            <span>{building.floors}F</span>
          </div>
        </div>
        <div className={`bms-popup__status bms-popup__status--${building.status}`}>
          {building.status.toUpperCase()}
        </div>
      </div>

      {/* Metrics */}
      <div className="bms-popup__metrics">
        <MetricBar value={building.powerLoad}      max={100} color="#4FC3F7" label="Power Load" />
        <MetricBar value={building.hvacEfficiency} max={100} color="#81C784" label="HVAC Eff." />
        <MetricBar value={building.occupancy}      max={100} color="#FFB74D" label="Occupancy" />
      </div>

      {/* Quick stats */}
      <div className="bms-popup__stats">
        <div className="bms-popup__stat">
          <span className="bms-popup__stat-icon">⚡</span>
          <div>
            <div className="bms-popup__stat-val">{building.powerKW} kW</div>
            <div className="bms-popup__stat-lbl">Power Draw</div>
          </div>
        </div>
        <div className="bms-popup__stat">
          <span className="bms-popup__stat-icon">🌡️</span>
          <div>
            <div className="bms-popup__stat-val">{building.temperatureAvg}°C</div>
            <div className="bms-popup__stat-lbl">Indoor Temp</div>
          </div>
        </div>
        <div className="bms-popup__stat">
          <span className="bms-popup__stat-icon">👥</span>
          <div>
            <div className="bms-popup__stat-val">{building.occupancyCount.toLocaleString()}</div>
            <div className="bms-popup__stat-lbl">Occupants</div>
          </div>
        </div>
        {building.waterUsage > 0 && (
          <div className="bms-popup__stat">
            <span className="bms-popup__stat-icon">🚰</span>
            <div>
              <div className="bms-popup__stat-val">{building.waterUsage} L/hr</div>
              <div className="bms-popup__stat-lbl">Water Use</div>
            </div>
          </div>
        )}
      </div>

      {/* Fire alarms  */}
      {building.fireAlarms > 0 && (
        <div className="bms-popup__fire-alert">
          🔥 {building.fireAlarms} active fire alarm{building.fireAlarms !== 1 ? 's' : ''} — emergency response required
        </div>
      )}

      {/* Alerts */}
      {building.alerts.length > 0 && (
        <div className="bms-popup__alerts">
          {criticalAlerts.length > 0 && (
            <div className="bms-popup__alert-count bms-popup__alert-count--critical">
              🔴 {criticalAlerts.length} critical alert{criticalAlerts.length !== 1 ? 's' : ''}
            </div>
          )}
          {warningAlerts.length > 0 && (
            <div className="bms-popup__alert-count bms-popup__alert-count--warning">
              🟡 {warningAlerts.length} warning{warningAlerts.length !== 1 ? 's' : ''}
            </div>
          )}
          {building.alerts.slice(0, 2).map(a => (
            <div key={a.id} className={`bms-popup__alert bms-popup__alert--${a.severity}`}>
              <span className="bms-popup__alert-sys">{a.system.toUpperCase()}</span>
              <span className="bms-popup__alert-msg">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="bms-popup__footer">
        {/* {isNest && onOpenNest ? (
          <button className="bms-popup__btn bms-popup__btn--nest" onClick={onOpenNest}>
            🏢 Open Digital Twin
          </button>
        ) : (
          <button className="bms-popup__btn bms-popup__btn--details" onClick={onClose}>
            View in BMS Panel
          </button>
        )} */}
        <div className="bms-popup__footer-meta">
          Built {building.yearBuilt} · {building.area.toLocaleString()} m²
        </div>
      </div>
    </div>
  );
}
