/**
 * IncidentAlertPopup
 * Appears on the map (absolutely positioned inside dso-map-wrapper) when a
 * blinking alert marker is clicked. Shows incident details and the primary
 * "BEGIN RESPONSE" action button that kicks off the manual workflow.
 */
import type { Incident } from '../../types';
import { EFFECT_COLOR, SEVERITY_COLOR } from '../../data/incidents';
import './IncidentAlertPopup.scss';

interface IncidentAlertPopupProps {
  incident:        Incident;
  /** Pixel position (from map.project) relative to the dso-map-wrapper */
  pos:             { x: number; y: number };
  /** Called when user clicks "Begin Response" */
  onBeginResponse: () => void;
  /** Called when user closes popup (incident stays in alert state on map) */
  onClose:         () => void;
}

export default function IncidentAlertPopup({
  incident,
  pos,
  onBeginResponse,
  onClose,
}: IncidentAlertPopupProps) {
  const effectColor   = EFFECT_COLOR[incident.mapEffect.type] ?? '#00E5FF';
  const severityColor = SEVERITY_COLOR[incident.severity];

  // Keep popup within visible map area (approximate popup dimensions: 300×430 px)
  const POPUP_W = 300;
  const POPUP_H = 430;
  const PAD     = 12;

  const rawLeft = pos.x + 28;
  const rawTop  = pos.y - POPUP_H / 2;

  const style: React.CSSProperties = {
    left:             `${rawLeft}px`,
    top:              `${rawTop}px`,
    maxWidth:         `${POPUP_W}px`,
    '--effect-color': effectColor,
    '--sev-color':    severityColor,
    // CSS clamp keeps it inside the wrapper
    transform:
      `translateX(clamp(calc(${PAD}px - ${rawLeft}px), 0px, calc(100vw - ${rawLeft + POPUP_W + PAD}px))) ` +
      `translateY(clamp(calc(${PAD}px - ${rawTop}px), 0px, calc(100vh - ${rawTop + POPUP_H + PAD}px)))`,
  } as React.CSSProperties;

  return (
    <div className="ialert" style={style}>
      {/* Close button */}
      <button className="ialert__close" onClick={onClose} title="Close">✕</button>

      {/* Header */}
      <div className="ialert__header">
        <span className="ialert__icon">{incident.icon}</span>
        <div className="ialert__header-info">
          <div className="ialert__title">{incident.title}</div>
          <div className="ialert__meta">
            <span className="ialert__severity">{incident.severity.toUpperCase()}</span>
            <span className="ialert__category">{incident.category}</span>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="ialert__location">
        <span className="ialert__location-icon">📍</span>
        <span className="ialert__location-text">{incident.zone}</span>
      </div>

      {/* Description */}
      <p className="ialert__desc">{incident.description}</p>

      {/* Triggered sensors */}
      <div className="ialert__sensors-label">Triggered Sensors</div>
      <div className="ialert__sensors">
        {incident.sensors.map((s) => (
          <span key={s} className="ialert__sensor-tag">📟 {s}</span>
        ))}
      </div>

      {/* Step count hint */}
      <div className="ialert__steps-hint">
        <span className="ialert__steps-hint-icon">📋</span>
        {incident.steps.length}-step response workflow ready
      </div>

      {/* Primary action */}
      <button className="ialert__begin-btn" onClick={onBeginResponse}>
        <span>🚨</span>
        Begin Incident Response
      </button>
    </div>
  );
}
