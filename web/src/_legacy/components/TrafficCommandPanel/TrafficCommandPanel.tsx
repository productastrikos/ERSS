import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type {
  TrafficState, TrafficIncident,
} from '../../types';
import TrafficCommandCenter from '../TrafficCommandCenter/TrafficCommandCenter';
import './TrafficCommandPanel.scss';

// ── Response team status tracking ──────────────────────────────────────────
export type ResponseStatus = 'SENT' | 'DELIVERED' | 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED';

export interface ResponseTeam {
  id:           string;
  type:         'police' | 'ambulance' | 'maintenance' | 'fire';
  name:         string;
  status:       ResponseStatus;
  eta:          number | null; // seconds
  distance:     number | null; // km
  dispatchedAt: number | null; // timestamp
}

// ── Incident detail state (extended from TrafficIncident) ──────────────────
export interface IncidentDetail extends TrafficIncident {
  affectedRoads:    string[];
  impactRadius:     number; // meters
  vehiclesAffected: number;
  currentSpeed:     number; // km/h
  signalStatus:     string;
  detectedAt:       number; // timestamp
  responseStarted:  number | null;
  responseEnded:    number | null;
}

// ── Workflow status ────────────────────────────────────────────────────────
export type IncidentStatus = 'ACTIVE' | 'IN_RESPONSE' | 'RESOLVED';

interface TrafficCommandPanelProps {
  trafficState: TrafficState | null;
  onFocusIncident?: (coords: [number, number]) => void;
  onApproveAIPlan?: (incident: TrafficIncident) => void;
  onModifyPlan?: (incident: TrafficIncident) => void;
  onManualOverride?: (incident: TrafficIncident) => void;
  onResolveIncident?: (incident: TrafficIncident) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onSignalControl?: (signalId: string, newState: 'RED' | 'YELLOW' | 'GREEN') => void;
}

const TrafficCommandPanel = ({
  trafficState,
  onSignalControl,
}: TrafficCommandPanelProps) => {
  const [showCommandCenter, setShowCommandCenter] = useState(false);

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER: Only Command Center button and modal
  // ══════════════════════════════════════════════════════════════════════════════
  
  // Don't render if no traffic state
  if (!trafficState) return null;

  return (
    <>
      {/* ── Standalone Command Center button — always visible when traffic is active ── */}
      <div className="cmd-center-standalone">
        <button
          className="command-center-btn"
          onClick={() => setShowCommandCenter(true)}
        >
          <span className="btn-icon">🖥️</span>
          <div className="btn-content">
            <div className="btn-title">OPEN COMMAND CENTER</div>
            <div className="btn-subtitle">Full control interface with live feeds</div>
          </div>
        </button>
      </div>

      {/* Command Center Modal — rendered via portal to escape backdrop-filter stacking context */}
      {showCommandCenter && trafficState && createPortal(
        <TrafficCommandCenter
          trafficState={trafficState}
          onClose={() => setShowCommandCenter(false)}
          onSignalControl={onSignalControl}
        />,
        document.body
      )}
    </>
  );
};

export default TrafficCommandPanel;

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTED: Traffic Command Content — for embedding in congestion tab
// ══════════════════════════════════════════════════════════════════════════════
export interface TrafficCommandContentProps {
  trafficState: TrafficState;
  onFocusIncident?: (coords: [number, number]) => void;
  onApproveAIPlan?: (incident: TrafficIncident) => void;
  onResolveIncident?: (incident: TrafficIncident) => void;
}

export const TrafficCommandContent = ({
  trafficState,
  onFocusIncident,
  onApproveAIPlan,
  onResolveIncident,
}: TrafficCommandContentProps) => {
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null);
  const [responseTeams, setResponseTeams]       = useState<ResponseTeam[]>([]);
  const [incidentStatus, setIncidentStatus]     = useState<IncidentStatus>('ACTIVE');
  const [showModifyPanel, setShowModifyPanel]   = useState(false);
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [showWhyExplanation, setShowWhyExplanation] = useState(false);
  const notificationSound = true;

  // ── Reset panel state when traffic mode changes ─
  useEffect(() => {
    setSelectedIncident(null);
    setResponseTeams([]);
    setIncidentStatus('ACTIVE');
    setShowModifyPanel(false);
    setShowManualOverride(false);
  }, [trafficState?.mode]);

  // ── Initialize response teams when congestion mode starts ─────────────────
  useEffect(() => {
    if (trafficState?.mode === 'congestion' && trafficState.incidents.length > 0) {
      const incident = trafficState.incidents[0];
      
      // Auto-select first unresolved incident
      if (!selectedIncident || selectedIncident.resolved) {
        const detail: IncidentDetail = {
          ...incident,
          affectedRoads:    ['Dubai Silicon Oasis Blvd', 'Academic City Rd', 'Innovation Boulevard'],
          impactRadius:     300,
          vehiclesAffected: 47,
          currentSpeed:     12,
          signalStatus:     'LOCKED RED',
          detectedAt:       incident.timestamp,
          responseStarted:  null,
          responseEnded:    null,
        };
        setSelectedIncident(detail);
        setIncidentStatus('ACTIVE');
      }

      // Initialize response teams
      if (responseTeams.length === 0) {
        const teams: ResponseTeam[] = [
          {
            id: 'team-police',
            type: 'police',
            name: 'Dubai Police Command',
            status: 'SENT',
            eta: 240,
            distance: 2.1,
            dispatchedAt: Date.now(),
          },
          {
            id: 'team-ambulance',
            type: 'ambulance',
            name: 'Dubai Ambulance DSO',
            status: 'SENT',
            eta: 180,
            distance: 1.5,
            dispatchedAt: Date.now(),
          },
          {
            id: 'team-fire',
            type: 'fire',
            name: 'DCDF Fire & Rescue',
            status: 'SENT',
            eta: 300,
            distance: 2.8,
            dispatchedAt: Date.now(),
          },
          {
            id: 'team-maintenance',
            type: 'maintenance',
            name: 'RTA Maintenance Team',
            status: 'SENT',
            eta: 420,
            distance: 3.2,
            dispatchedAt: Date.now(),
          },
        ];
        setResponseTeams(teams);
      }
    }
  }, [trafficState, selectedIncident, responseTeams.length]);

  // ── Auto-progress response team statuses ────────────────────────────────
  useEffect(() => {
    if (responseTeams.length === 0) return;

    const timer = setInterval(() => {
      setResponseTeams((prev) => {
        let anyChanged = false;
        const updated = prev.map((team) => {
          if (team.status === 'ARRIVED') return team;

          const elapsed = team.dispatchedAt ? (Date.now() - team.dispatchedAt) / 1000 : 0;

          if (team.status === 'SENT' && elapsed > 3) {
            anyChanged = true;
            return { ...team, status: 'DELIVERED' as ResponseStatus };
          }
          if (team.status === 'DELIVERED' && elapsed > 8) {
            anyChanged = true;
            return { ...team, status: 'ACCEPTED' as ResponseStatus };
          }
          if (team.status === 'ACCEPTED' && elapsed > 15) {
            anyChanged = true;
            setIncidentStatus('IN_RESPONSE');
            return { ...team, status: 'EN_ROUTE' as ResponseStatus };
          }
          if (team.status === 'EN_ROUTE' && team.eta && elapsed > team.eta) {
            anyChanged = true;
            return { ...team, status: 'ARRIVED' as ResponseStatus, eta: 0 };
          }

          if (team.status === 'EN_ROUTE' && team.eta) {
            const remaining = Math.max(0, team.eta - elapsed);
            return { ...team, eta: remaining };
          }

          return team;
        });

        if (updated.every((t) => t.status === 'ARRIVED')) {
          setTimeout(() => {
            setIncidentStatus('RESOLVED');
            if (selectedIncident) {
              setSelectedIncident((prev) => prev ? {
                ...prev,
                resolved: true,
                responseEnded: Date.now(),
              } : null);
            }
          }, 10000);
        }

        return anyChanged ? updated : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [responseTeams, selectedIncident]);

  // ── Handle incident card click ───────────────────────────────────────────
  const handleSelectIncident = useCallback((incident: TrafficIncident) => {
    const detail: IncidentDetail = {
      ...incident,
      affectedRoads:    ['Dubai Silicon Oasis Blvd', 'Academic City Rd', 'Innovation Boulevard'],
      impactRadius:     300,
      vehiclesAffected: 47,
      currentSpeed:     12,
      signalStatus:     'LOCKED RED',
      detectedAt:       incident.timestamp,
      responseStarted:  Date.now(),
      responseEnded:    null,
    };
    setSelectedIncident(detail);

    if (onFocusIncident) {
      onFocusIncident(incident.location);
    }

    if (notificationSound) {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBziL0fPTgjMGHWu3692aSwkMP6Dp8axdFw1Jotnyt2EYDz+O0/3dQwAA');
      audio.volume = 0.3;
      audio.play().catch(() => {});
    }
  }, [onFocusIncident, notificationSound]);

  // ── Format helper functions ───────────────────────────────────────────────
  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const formatETA = (seconds: number | null): string => {
    if (seconds === null || seconds === 0) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleApproveAIPlan = () => {
    if (!selectedIncident) return;
    if (onApproveAIPlan) {
      const incident = trafficState?.incidents.find((i) => i.id === selectedIncident.id);
      if (incident) onApproveAIPlan(incident);
    }
    setIncidentStatus('IN_RESPONSE');
  };

  const handleCloseIncident = () => {
    if (!selectedIncident) return;
    if (onResolveIncident) {
      const incident = trafficState?.incidents.find((i) => i.id === selectedIncident.id);
      if (incident) onResolveIncident(incident);
    }
    setTimeout(() => {
      setSelectedIncident(null);
      setResponseTeams([]);
      setIncidentStatus('ACTIVE');
    }, 2000);
  };

  const getTeamIcon = (type: ResponseTeam['type']): string => {
    switch (type) {
      case 'police':      return '🚔';
      case 'ambulance':   return '🚑';
      case 'fire':        return '🚒';
      case 'maintenance': return '🔧';
      default:            return '🚗';
    }
  };

  const getStatusColor = (status: ResponseStatus): string => {
    switch (status) {
      case 'SENT':      return '#888';
      case 'DELIVERED': return '#60a5fa';
      case 'ACCEPTED':  return '#facc15';
      case 'EN_ROUTE':  return '#fb923c';
      case 'ARRIVED':   return '#4ade80';
      default:          return '#888';
    }
  };

  const getStatusLabel = (status: ResponseStatus): string => {
    switch (status) {
      case 'SENT':      return 'Sent';
      case 'DELIVERED': return 'Delivered';
      case 'ACCEPTED':  return 'Accepted';
      case 'EN_ROUTE':  return 'En Route';
      case 'ARRIVED':   return 'Arrived';
      default:          return status;
    }
  };

  const getSeverityColor = (severity: 'LOW' | 'MEDIUM' | 'HIGH'): string => {
    switch (severity) {
      case 'LOW':    return '#4ade80';
      case 'MEDIUM': return '#fbbf24';
      case 'HIGH':   return '#ef4444';
      default:       return '#888';
    }
  };

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: LIVE INCIDENT FEED
          ═══════════════════════════════════════════════════════════════ */}
      <div className="section incident-feed">
        <h3 className="section-title">
          <span className="section-icon">📡</span>
          Live Incident Feed
        </h3>
        <div className="incident-list">
          {trafficState.incidents.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">✓</span>
              <p>No active incidents</p>
            </div>
          ) : (
            trafficState.incidents.map((incident) => (
              <div
                key={incident.id}
                className={`incident-card ${selectedIncident?.id === incident.id ? 'selected' : ''} ${incident.resolved ? 'resolved' : ''}`}
                onClick={() => handleSelectIncident(incident)}
              >
                <div className="incident-header">
                  <div className="incident-type">
                    <span className="type-icon">
                      {incident.type === 'accident' ? '🚨' : incident.type === 'congestion' ? '🚧' : '🔧'}
                    </span>
                    <span className="type-label">{incident.type.toUpperCase()}</span>
                  </div>
                  <div
                    className="severity-badge"
                    style={{ borderColor: getSeverityColor(incident.severity), color: getSeverityColor(incident.severity) }}
                  >
                    {incident.severity}
                  </div>
                </div>
                <div className="incident-name">{incident.name}</div>
                <div className="incident-meta">
                  <span className="meta-item">
                    <span className="meta-icon">📍</span>
                    {incident.description}
                  </span>
                  <span className="meta-item">
                    <span className="meta-icon">🕐</span>
                    {formatTimeAgo(incident.timestamp)}
                  </span>
                </div>
                {incident.resolved && (
                  <div className="resolved-badge">✓ RESOLVED</div>
                )}
                {!incident.resolved && (
                  <div className="status-badge-inline">
                    <span className="status-indicator-inline"></span>
                    ACTIVE
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2: INCIDENT DETAIL VIEW
          ═══════════════════════════════════════════════════════════════ */}
      {selectedIncident && (
        <div className="section incident-detail">
          <h3 className="section-title">
            <span className="section-icon">🔍</span>
            Incident Details
          </h3>

          <div className="detail-content">
            <div className="detail-title">{selectedIncident.name}</div>
            
            <div className="detail-grid">
              <div className="detail-item">
                <div className="detail-label">Coordinates</div>
                <div className="detail-value">
                  {selectedIncident.location[1].toFixed(4)}, {selectedIncident.location[0].toFixed(4)}
                </div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Impact Radius</div>
                <div className="detail-value">{selectedIncident.impactRadius}m</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Vehicles Affected</div>
                <div className="detail-value">{selectedIncident.vehiclesAffected}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Current Speed</div>
                <div className="detail-value">{selectedIncident.currentSpeed} km/h</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Signal Status</div>
                <div className="detail-value status-red">{selectedIncident.signalStatus}</div>
              </div>
              <div className="detail-item">
                <div className="detail-label">Detected</div>
                <div className="detail-value">{formatTimeAgo(selectedIncident.detectedAt)}</div>
              </div>
            </div>

            <div className="affected-roads">
              <div className="detail-label">Affected Roads</div>
              <ul className="road-list">
                {selectedIncident.affectedRoads.map((road, idx) => (
                  <li key={idx} className="road-item">
                    <span className="road-icon">🛣️</span>
                    {road}
                  </li>
                ))}
              </ul>
            </div>

            <div className="incident-timeline">
              <div className="detail-label">Timeline</div>
              <div className="timeline-steps">
                <div className="timeline-step completed">
                  <div className="step-dot"></div>
                  <div className="step-label">Detected</div>
                </div>
                <div className={`timeline-step ${incidentStatus !== 'ACTIVE' ? 'completed' : 'active'}`}>
                  <div className="step-dot"></div>
                  <div className="step-label">Confirmed</div>
                </div>
                <div className={`timeline-step ${incidentStatus === 'IN_RESPONSE' ? 'active' : incidentStatus === 'RESOLVED' ? 'completed' : ''}`}>
                  <div className="step-dot"></div>
                  <div className="step-label">Responding</div>
                </div>
                <div className={`timeline-step ${incidentStatus === 'RESOLVED' ? 'completed' : ''}`}>
                  <div className="step-dot"></div>
                  <div className="step-label">Resolved</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3: AI ADVISORY PANEL
          ═══════════════════════════════════════════════════════════════ */}
      {selectedIncident && trafficState.aiAdvisory && (
        <div className="section ai-advisory">
          <h3 className="section-title">
            <span className="section-icon">🤖</span>
            AI Command Assistant
          </h3>

          <div className="advisory-content">
            <div className="advisory-header">
              <div className="advisory-title">{trafficState.aiAdvisory.title}</div>
              <div className="advisory-subtitle">{trafficState.aiAdvisory.subtitle}</div>
            </div>

            <div className="advisory-recommendations">
              <div className="recommendations-label">Recommended Actions</div>
              <ol className="recommendations-list">
                {trafficState.aiAdvisory.items.map((item, idx) => (
                  <li key={idx} className="recommendation-item">
                    {item}
                  </li>
                ))}
              </ol>
            </div>

            <div className="advisory-metrics">
              {trafficState.aiAdvisory.metric && (
                <div className="metric-item">
                  <span className="metric-icon">📊</span>
                  {trafficState.aiAdvisory.metric}
                </div>
              )}
              {trafficState.aiAdvisory.clearTime && (
                <div className="metric-item">
                  <span className="metric-icon">⏱️</span>
                  {trafficState.aiAdvisory.clearTime}
                </div>
              )}
              <div className="metric-item confidence">
                <span className="metric-icon">🎯</span>
                Confidence: 94%
              </div>
            </div>

            <button
              className="why-button"
              onClick={() => setShowWhyExplanation(!showWhyExplanation)}
            >
              {showWhyExplanation ? '▼' : '▶'} Why this suggestion?
            </button>

            {showWhyExplanation && (
              <div className="explanation-panel">
                <p>Based on historical incident data and real-time traffic analysis:</p>
                <ul>
                  <li>Similar incidents resolved 35% faster with this approach</li>
                  <li>Alternate route capacity sufficient for diverted traffic</li>
                  <li>Emergency vehicle access optimized via signal coordination</li>
                  <li>Predicted congestion spread prevented by proactive measures</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: OPERATOR ACTION PANEL
          ═══════════════════════════════════════════════════════════════ */}
      {selectedIncident && !selectedIncident.resolved && (
        <div className="section operator-actions">
          <h3 className="section-title">
            <span className="section-icon">⚡</span>
            Operator Actions
          </h3>

          <div className="action-buttons">
            <button
              className="action-btn approve"
              onClick={handleApproveAIPlan}
              disabled={incidentStatus !== 'ACTIVE'}
            >
              <span className="btn-icon">✓</span>
              Approve AI Plan
            </button>
            <button
              className="action-btn modify"
              onClick={() => setShowModifyPanel(!showModifyPanel)}
            >
              <span className="btn-icon">✏️</span>
              Modify Plan
            </button>
            <button
              className="action-btn override"
              onClick={() => setShowManualOverride(!showManualOverride)}
            >
              <span className="btn-icon">🎛️</span>
              Manual Override
            </button>
          </div>

          {showModifyPanel && (
            <div className="modify-panel">
              <h4>Modify Signal Timing</h4>
              <div className="control-group">
                <label>Green Time Extension (sec)</label>
                <input type="range" min="0" max="60" defaultValue="20" className="slider" />
                <span className="slider-value">+20s</span>
              </div>
              <div className="control-group">
                <label>Alternate Route</label>
                <select className="route-select">
                  <option>Academic City Road (Recommended)</option>
                  <option>Innovation Boulevard</option>
                  <option>Silicon Oasis South Exit</option>
                </select>
              </div>
              <button className="confirm-btn" onClick={() => { handleApproveAIPlan(); setShowModifyPanel(false); }}>
                Apply Changes
              </button>
            </div>
          )}

          {showManualOverride && (
            <div className="override-panel">
              <h4>Manual Signal Control</h4>
              <div className="signal-controls">
                <div className="signal-control-item">
                  <span>DSO-SIG-101</span>
                  <div className="signal-state-buttons">
                    <button className="state-btn red">RED</button>
                    <button className="state-btn yellow">YELLOW</button>
                    <button className="state-btn green">GREEN</button>
                  </div>
                </div>
                <div className="signal-control-item">
                  <span>DSO-SIG-102</span>
                  <div className="signal-state-buttons">
                    <button className="state-btn red">RED</button>
                    <button className="state-btn yellow">YELLOW</button>
                    <button className="state-btn green">GREEN</button>
                  </div>
                </div>
              </div>
              <div className="warning-message">
                ⚠️ Manual override disables AI automation. Confirm before execution.
              </div>
              <button className="confirm-btn danger" onClick={() => setShowManualOverride(false)}>
                Confirm Override
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: NOTIFICATION & RESPONSE TRACKER
          ═══════════════════════════════════════════════════════════════ */}
      {selectedIncident && responseTeams.length > 0 && (
        <div className="section response-tracker">
          <h3 className="section-title">
            <span className="section-icon">📡</span>
            Response Units Tracker
          </h3>

          <div className="response-list">
            {responseTeams.map((team) => (
              <div key={team.id} className="response-team">
                <div className="team-header">
                  <div className="team-info">
                    <span className="team-icon">{getTeamIcon(team.type)}</span>
                    <div className="team-details">
                      <div className="team-name">{team.name}</div>
                      <div className="team-meta">
                        {team.distance !== null && <span>📍 {team.distance.toFixed(1)} km</span>}
                        {team.eta !== null && team.status === 'EN_ROUTE' && (
                          <span>⏱️ ETA {formatETA(team.eta)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div
                    className="team-status"
                    style={{ color: getStatusColor(team.status) }}
                  >
                    {getStatusLabel(team.status)}
                  </div>
                </div>

                <div className="team-progress">
                  <div className="progress-steps">
                    <div className={`progress-step ${['DELIVERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(team.status) ? 'completed' : team.status === 'SENT' ? 'active' : ''}`}>
                      <div className="progress-dot"></div>
                      <div className="progress-label">Sent</div>
                    </div>
                    <div className={`progress-step ${['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(team.status) ? 'completed' : team.status === 'DELIVERED' ? 'active' : ''}`}>
                      <div className="progress-dot"></div>
                      <div className="progress-label">Received</div>
                    </div>
                    <div className={`progress-step ${['EN_ROUTE', 'ARRIVED'].includes(team.status) ? 'completed' : team.status === 'ACCEPTED' ? 'active' : ''}`}>
                      <div className="progress-dot"></div>
                      <div className="progress-label">Accepted</div>
                    </div>
                    <div className={`progress-step ${team.status === 'ARRIVED' ? 'completed' : team.status === 'EN_ROUTE' ? 'active' : ''}`}>
                      <div className="progress-dot"></div>
                      <div className="progress-label">En Route</div>
                    </div>
                    <div className={`progress-step ${team.status === 'ARRIVED' ? 'completed' : ''}`}>
                      <div className="progress-dot"></div>
                      <div className="progress-label">Arrived</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          INCIDENT RESOLUTION SUMMARY
          ═══════════════════════════════════════════════════════════════ */}
      {selectedIncident && incidentStatus === 'RESOLVED' && (
        <div className="section resolution-summary">
          <h3 className="section-title">
            <span className="section-icon">✓</span>
            Incident Resolved
          </h3>

          <div className="summary-content">
            <div className="summary-stats">
              <div className="stat-item">
                <div className="stat-label">Total Time</div>
                <div className="stat-value">
                  {selectedIncident.responseEnded && selectedIncident.responseStarted
                    ? `${Math.floor((selectedIncident.responseEnded - selectedIncident.responseStarted) / 60000)} min`
                    : '--'}
                </div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Vehicles Impacted</div>
                <div className="stat-value">{selectedIncident.vehiclesAffected}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Response Efficiency</div>
                <div className="stat-value success">98%</div>
              </div>
            </div>

            <button className="close-incident-btn" onClick={handleCloseIncident}>
              <span className="btn-icon">✓</span>
              Close Incident
            </button>
          </div>
        </div>
      )}
    </>
  );
};
