import { useState, useEffect, useCallback } from 'react';
import { INCIDENTS, SEVERITY_COLOR, EFFECT_COLOR } from '../../data/incidents';
import { fetchIncidentLiveData } from '../../api/incidentsAPI';
import { getTechnician, calcDistance, calcETA, buildRoute } from '../../data/technicians';
import type {
  Incident, ActiveIncidentState, WorkflowStage,
  TechnicianProfile, TimelineEvent,
} from '../../types';
import './IncidentSimulator.scss';

// ── Props ─────────────────────────────────────────────────────────────────────
interface IncidentSimulatorProps {
  activeIncident:   ActiveIncidentState | null;
  onIncidentChange: (state: ActiveIncidentState | null) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SEV_COLOR = SEVERITY_COLOR;

const AI_RISK_COLOR: Record<string, string> = {
  LOW:      '#00CC66',
  MEDIUM:   '#FFAA00',
  HIGH:     '#FF6600',
  CRITICAL: '#FF2222',
};

const PRIORITY_COLOR: Record<string, string> = {
  P1: '#FF2222',
  P2: '#FF6600',
  P3: '#FFAA00',
  P4: '#00CC66',
};

const FIELD_STEPS = ['En Route', 'Arrived at Site', 'Inspection Complete'];

function timeNow(): string {
  return new Date().toLocaleTimeString('en-AE', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function elapsedMinutes(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 60000);
}

// ── Stage config ──────────────────────────────────────────────────────────────
const STAGE_ORDER: WorkflowStage[] = [
  'detected', 'validated', 'classified', 'advisory',
  'dispatched', 'enroute', 'repairing', 'resolved',
];

const STAGE_BADGE: Record<WorkflowStage, { label: string; color: string }> = {
  detected:   { label: '⚠ DETECTED',    color: '#FF4444' },
  validated:  { label: '🔬 VALIDATED',   color: '#FF8800' },
  classified: { label: '📂 CLASSIFIED',  color: '#FFAA00' },
  advisory:   { label: '🤖 AI ADVISORY', color: '#AA44FF' },
  dispatched: { label: '🚐 DISPATCHED',  color: '#00AAFF' },
  enroute:    { label: '🔧 ON SITE',     color: '#00AAFF' },
  repairing:  { label: '⚙ REPAIRING',   color: '#FF6600' },
  resolved:   { label: '✅ RESOLVED',    color: '#00CC66' },
};

function getStepClass(
  stepIdx: number, total: number, stage: WorkflowStage,
): 'done' | 'current' | 'pending' {
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const pct = stageIdx / (STAGE_ORDER.length - 1);
  const threshold = Math.round(total * pct);
  if (stage === 'resolved') return 'done';
  if (stepIdx < threshold)  return 'done';
  if (stepIdx === threshold) return 'current';
  return 'pending';
}

// ── Sub-component: Incident list (idle) ───────────────────────────────────────
// @ts-expect-error — unused but kept for future feature
function _IncidentList({ onSelect }: { onSelect: (i: Incident) => void }) {
  return (
    <div className="isim-list">
      {INCIDENTS.map((inc) => (
        <button
          key={inc.id}
          className="isim-list__btn"
          data-severity={inc.severity}
          onClick={() => onSelect(inc)}
          title={inc.description}
        >
          <span className="isim-list__btn-icon">{inc.icon}</span>
          <div className="isim-list__btn-info">
            <span className="isim-list__btn-title">{inc.shortTitle}</span>
            <span className="isim-list__btn-cat">{inc.category}</span>
          </div>
          <span className="isim-list__btn-badge" style={{ background: SEV_COLOR[inc.severity] }}>
            {inc.severity.toUpperCase()}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Sub-component: Alert waiting view ────────────────────────────────────────
// @ts-expect-error — unused but kept for future feature
function _AlertWaitingView({ incident }: { incident: Incident }) {
  const effectColor = EFFECT_COLOR[incident.mapEffect.type] ?? '#00E5FF';
  return (
    <div className="isim-alert-waiting">
      <div className="isim-alert-waiting__icon"
        style={{ filter: `drop-shadow(0 0 10px ${effectColor})` }}>
        {incident.icon}
      </div>
      <div className="isim-alert-waiting__title">{incident.title}</div>
      <span className="isim-alert-waiting__badge"
        style={{ background: SEV_COLOR[incident.severity] }}>
        {incident.severity.toUpperCase()} ALERT
      </span>
      <p className="isim-alert-waiting__hint">
        🗺️ Alert deployed on the map.
        <br />
        <strong>Click the blinking marker</strong> to view details &
        begin the incident response.
      </p>
      <div className="isim-alert-waiting__pulse" style={{ background: effectColor }} />
    </div>
  );
}

// ── Panel 1: Sensor Validation ────────────────────────────────────────────────
interface ValidationPanelProps {
  incident: Incident;
  liveData?: { sensor_id: string; sensor_value: number; sensor_unit: string; threshold: number } | null;
  onConfirm: () => void;
}
function ValidationPanel({ incident, liveData, onConfirm }: ValidationPanelProps) {
  const value     = liveData?.sensor_value ?? 95;
  const threshold = liveData?.threshold    ?? 80;
  const unit      = liveData?.sensor_unit  ?? '°C';
  const sensorId  = liveData?.sensor_id    ?? incident.sensors[0];
  const exceeded  = value > threshold;
  return (
    <div className="isim-validation">
      <div className="isim-validation__heading">🔬 SENSOR DATA VALIDATION</div>
      <div className="isim-validation__sensor-box">
        <div className="isim-validation__sensor-row">
          <span className="isim-validation__sensor-key">SENSOR</span>
          <span className="isim-validation__sensor-val">{sensorId}</span>
        </div>
        <div className="isim-validation__sensor-row">
          <span className="isim-validation__sensor-key">READING</span>
          <span className="isim-validation__sensor-val isim-validation__sensor-val--alert">
            {value} {unit}
          </span>
        </div>
        <div className="isim-validation__sensor-row">
          <span className="isim-validation__sensor-key">THRESHOLD</span>
          <span className="isim-validation__sensor-val">{threshold} {unit}</span>
        </div>
        <div className="isim-validation__sensor-row">
          <span className="isim-validation__sensor-key">DELTA</span>
          <span className="isim-validation__sensor-val isim-validation__sensor-val--alert">
            +{value - threshold} {unit} ({Math.round(((value - threshold)/threshold)*100)}% over)
          </span>
        </div>
      </div>
      <div className="isim-validation__secondary">
        <div className="isim-validation__secondary-label">Secondary sensors checked:</div>
        {incident.sensors.slice(1, 3).map((s, i) => (
          <div key={i} className="isim-validation__secondary-item">
            <span className="isim-validation__dot isim-validation__dot--ok" />
            <span>{s}</span>
            <span className="isim-validation__ok">✓ Confirmed anomaly</span>
          </div>
        ))}
      </div>
      <div className={`isim-validation__status isim-validation__status--${exceeded ? 'alert' : 'ok'}`}>
        {exceeded ? '⚠ ANOMALY CONFIRMED — Multi-sensor corroboration positive' : '✓ Readings within normal range'}
      </div>
      <button className="isim-action-btn isim-action--validate" onClick={onConfirm}>
        ✓ CONFIRM — VALID INCIDENT
      </button>
    </div>
  );
}

// ── Panel 2: Incident Classification ─────────────────────────────────────────
interface ClassificationPanelProps {
  incident: Incident;
  onGenerate: () => void;
}
function ClassificationPanel({ incident, onGenerate }: ClassificationPanelProps) {
  const { classification } = incident;
  return (
    <div className="isim-classify">
      <div className="isim-classify__heading">📂 INCIDENT CLASSIFICATION</div>
      <div className="isim-classify__grid">
        <div className="isim-classify__row">
          <span className="isim-classify__key">TYPE</span>
          <span className="isim-classify__val">{classification.type}</span>
        </div>
        <div className="isim-classify__row">
          <span className="isim-classify__key">CATEGORY</span>
          <span className="isim-classify__val">{classification.category}</span>
        </div>
        <div className="isim-classify__row">
          <span className="isim-classify__key">SEVERITY</span>
          <span className="isim-classify__val">
            <span className="isim-classify__badge"
              style={{ background: SEV_COLOR[incident.severity] }}>
              {incident.severity.toUpperCase()}
            </span>
          </span>
        </div>
        <div className="isim-classify__row">
          <span className="isim-classify__key">PRIORITY</span>
          <span className="isim-classify__val">
            <span className="isim-classify__badge"
              style={{ background: PRIORITY_COLOR[classification.priority] }}>
              {classification.priority}
            </span>
            <span className="isim-classify__score"> — Score {classification.score}/100</span>
          </span>
        </div>
      </div>
      <div className="isim-classify__formula">
        Priority Score = Severity × Population Impact × Infrastructure Risk
      </div>
      <button className="isim-action-btn isim-action--advisory" onClick={onGenerate}>
        🤖 GENERATE AI ADVISORY
      </button>
    </div>
  );
}

// ── Panel 3: AI Advisory ──────────────────────────────────────────────────────
interface AIAdvisoryPanelProps {
  incident:  Incident;
  onApprove: () => void;
}
function AIAdvisoryPanel({ incident, onApprove }: AIAdvisoryPanelProps) {
  const { aiAdvisory } = incident;
  return (
    <div className="isim-advisory">
      <div className="isim-advisory__heading">🤖 AI COMMAND ASSISTANT</div>
      <div className="isim-advisory__header-row">
        <span className="isim-advisory__incident-name">{incident.icon} {incident.shortTitle}</span>
        <span className="isim-advisory__risk"
          style={{ background: AI_RISK_COLOR[aiAdvisory.riskLevel] }}>
          {aiAdvisory.riskLevel} RISK
        </span>
      </div>
      <div className="isim-advisory__section">
        <div className="isim-advisory__section-label">⚠ Potential Impacts</div>
        <ul className="isim-advisory__list">
          {aiAdvisory.impacts.map((imp, i) => (
            <li key={i} className="isim-advisory__list-item isim-advisory__list-item--impact">
              {imp}
            </li>
          ))}
        </ul>
      </div>
      <div className="isim-advisory__section">
        <div className="isim-advisory__section-label">✅ Recommended Actions</div>
        <ol className="isim-advisory__list isim-advisory__list--numbered">
          {aiAdvisory.actions.map((act, i) => (
            <li key={i} className="isim-advisory__list-item isim-advisory__list-item--action">
              {act}
            </li>
          ))}
        </ol>
      </div>
      <div className="isim-advisory__meta">
        <div className="isim-advisory__meta-row">
          <span>⏱ Estimated Resolution</span>
          <span className="isim-advisory__meta-val">{aiAdvisory.etaMinutes} minutes</span>
        </div>
        <div className="isim-advisory__meta-row">
          <span>🎯 AI Confidence</span>
          <span className="isim-advisory__meta-val">{aiAdvisory.confidence}%</span>
        </div>
      </div>
      <div className="isim-advisory__confidence-bar">
        <div className="isim-advisory__confidence-fill"
          style={{ width: `${aiAdvisory.confidence}%` }} />
      </div>
      <div className="isim-advisory__actions">
        <button className="isim-advisory__approve" onClick={onApprove}>
          ✓ APPROVE PLAN
        </button>
        <button className="isim-advisory__approve isim-advisory__approve--custom" onClick={onApprove}>
          ✎ CUSTOMIZE
        </button>
      </div>
    </div>
  );
}

// ── Panel 4: Dispatch Team ────────────────────────────────────────────────────
interface DispatchPanelProps {
  incident:     Incident;
  selectedRole: string;
  onRoleChange: (r: string) => void;
  onDispatch:   () => void;
}
function DispatchPanel({ incident, selectedRole, onRoleChange, onDispatch }: DispatchPanelProps) {
  return (
    <div className="isim-dispatch">
      <div className="isim-dispatch__heading">🚐 TEAM DISPATCH</div>
      <p className="isim-dispatch__label">Select responsible team & dispatch:</p>
      <div className="isim-notify__roles">
        {incident.roles.map((r) => (
          <label
            key={r.role}
            className={`isim-notify__role${selectedRole === r.role ? ' isim-notify__role--active' : ''}`}
          >
            <input
              type="radio" name="dispatch-role" value={r.role}
              checked={selectedRole === r.role}
              onChange={() => onRoleChange(r.role)}
            />
            <div className="isim-notify__role-info">
              <span className="isim-notify__role-name">{r.role}</span>
              <span className="isim-notify__role-resp">{r.responsibility}</span>
            </div>
          </label>
        ))}
      </div>
      <button
        className="isim-action-btn isim-action--dispatch"
        onClick={onDispatch}
        disabled={!selectedRole}
      >
        🚐 DISPATCH TEAM
      </button>
    </div>
  );
}

// ── Panel 5: Field Status Tracker (enroute) ───────────────────────────────────
interface FieldStatusPanelProps {
  technician:      TechnicianProfile;
  incident:        Incident;
  fieldStatusStep: number;
  onAdvanceField:  () => void;
}
function FieldStatusPanel({
  technician, incident, fieldStatusStep, onAdvanceField,
}: FieldStatusPanelProps) {
  const dist = calcDistance(technician.coordinates, incident.mapEffect.epicenter);
  const eta  = calcETA(dist);
  const nextLabel = [
    '✓ CONFIRM ARRIVAL',
    '🔍 START INSPECTION',
    '🔧 BEGIN REPAIR',
  ][fieldStatusStep] ?? null;

  return (
    <div className="isim-field">
      <div className="isim-field__heading">🚐 FIELD RESPONSE STATUS</div>
      <div className="isim-field__tech-row">
        <div className="isim-field__tech-icon">👷</div>
        <div className="isim-field__tech-info">
          <span className="isim-field__tech-name">{technician.name}</span>
          <span className="isim-field__tech-role">{technician.role}</span>
          <span className="isim-field__tech-phone">{technician.phone}</span>
        </div>
      </div>
      {/* Sub-step tracker */}
      <div className="isim-field__steps">
        {FIELD_STEPS.map((label, i) => {
          const done    = i < fieldStatusStep;
          const current = i === fieldStatusStep;
          return (
            <div
              key={i}
              className={`isim-field__step${done ? ' --done' : ''}${current ? ' --current' : ''}`}
            >
              <div className="isim-field__step-dot">
                {done ? '✓' : current ? '●' : '○'}
              </div>
              <span className="isim-field__step-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="isim-field__meta">
        <span>📏 {dist.toFixed(1)} km from site</span>
        <span>⏱ ETA {eta} min</span>
      </div>
      <p className="isim-field__hint">🗺️ Technician route displayed on map</p>
      {nextLabel && (
        <button className="isim-action-btn isim-action--field" onClick={onAdvanceField}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}

// ── Panel 6: Active Repair ────────────────────────────────────────────────────
interface RepairPanelProps {
  technician: TechnicianProfile;
  incident:   Incident;
  onResolve:  () => void;
}
function RepairPanel({ technician, incident, onResolve }: RepairPanelProps) {
  return (
    <div className="isim-repair">
      <div className="isim-repair__heading">⚙ ACTIVE REPAIR</div>
      <div className="isim-repair__status-badge">● REPAIR IN PROGRESS</div>
      <div className="isim-repair__rows">
        <div className="isim-repair__row">
          <span>🔧 Technician</span>
          <span>{technician.name}</span>
        </div>
        <div className="isim-repair__row">
          <span>📍 Site</span>
          <span>{incident.zone.split('—').pop()?.trim()}</span>
        </div>
        <div className="isim-repair__row">
          <span>📋 Fault</span>
          <span>{incident.analytics.cause.split('—')[0].trim()}</span>
        </div>
      </div>
      <div className="isim-repair__log">
        <div className="isim-repair__log-label">TECHNICIAN FIELD LOG</div>
        <div className="isim-repair__log-entry">🔍 Fault inspection complete</div>
        <div className="isim-repair__log-entry">⚙ Component identified — replacement initiated</div>
        <div className="isim-repair__log-entry isim-repair__log-entry--active">
          🔧 Repair in progress...
        </div>
      </div>
      <button className="isim-action-btn isim-action--resolve" onClick={onResolve}>
        ✅ CONFIRM SYSTEM RECOVERY
      </button>
    </div>
  );
}

// ── Panel 7: Post-Incident Analytics ─────────────────────────────────────────
interface AnalyticsPanelProps {
  incident:        Incident;
  startedAt:       number;
  timeline:        TimelineEvent[];
}
function AnalyticsPanel({ incident, startedAt, timeline }: AnalyticsPanelProps) {
  const elapsed  = elapsedMinutes(startedAt);
  const { analytics } = incident;
  return (
    <div className="isim-analytics">
      <div className="isim-analytics__banner">
        <span className="isim-analytics__banner-icon">✅</span>
        <span className="isim-analytics__banner-text">INCIDENT CLOSED</span>
      </div>
      <div className="isim-analytics__heading">📊 POST-INCIDENT ANALYTICS</div>
      <div className="isim-analytics__grid">
        <div className="isim-analytics__card">
          <div className="isim-analytics__card-label">INCIDENT ID</div>
          <div className="isim-analytics__card-val isim-analytics__card-val--id">
            {incident.id.toUpperCase().replace(/_/g, '-')}
          </div>
        </div>
        <div className="isim-analytics__card">
          <div className="isim-analytics__card-label">DURATION</div>
          <div className="isim-analytics__card-val isim-analytics__card-val--time">
            {elapsed > 0 ? elapsed : analytics.responseMinutes} min
          </div>
        </div>
        <div className="isim-analytics__card">
          <div className="isim-analytics__card-label">PRIORITY SCORE</div>
          <div className="isim-analytics__card-val">{analytics.priorityScore}/100</div>
        </div>
        <div className="isim-analytics__card">
          <div className="isim-analytics__card-label">TIMELINE EVENTS</div>
          <div className="isim-analytics__card-val">{timeline.length}</div>
        </div>
      </div>
      <div className="isim-analytics__section">
        <div className="isim-analytics__row">
          <span className="isim-analytics__key">ROOT CAUSE</span>
          <span className="isim-analytics__val">{analytics.cause}</span>
        </div>
        <div className="isim-analytics__row">
          <span className="isim-analytics__key">IMPACT</span>
          <span className="isim-analytics__val">{analytics.impact}</span>
        </div>
        <div className="isim-analytics__row">
          <span className="isim-analytics__key">RECOMMENDATION</span>
          <span className="isim-analytics__val isim-analytics__val--rec">{analytics.recommendation}</span>
        </div>
      </div>
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="isim-timeline">
      <div className="isim-timeline__label">INCIDENT TIMELINE</div>
      <ul className="isim-timeline__list">
        {events.map((e, i) => (
          <li key={i} className="isim-timeline__item">
            <span className="isim-timeline__time">{e.time}</span>
            <span className="isim-timeline__icon">{e.icon}</span>
            <span className="isim-timeline__text">{e.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Command Centre orchestrator ───────────────────────────────────────────────
interface CmdProps {
  state:           ActiveIncidentState;
  selectedRole:    string;
  onRoleChange:    (r: string) => void;
  onValidate:      () => void;
  onClassify:      () => void;
  onApproveAdvisory: () => void;
  onDispatch:      () => void;
  onAdvanceField:  () => void;
  onResolve:       () => void;
  onStop:          () => void;
}

function CommandCentreView({
  state, selectedRole, onRoleChange,
  onValidate: _onValidate, onClassify, onApproveAdvisory,
  onDispatch, onAdvanceField, onResolve, onStop,
}: CmdProps) {
  const { incident, workflowStage, liveData, assignedTechnician, timeline, fieldStatusStep } = state;
  const effectColor = EFFECT_COLOR[incident.mapEffect.type] ?? '#00E5FF';
  const stageBadge  = STAGE_BADGE[workflowStage];
  const stageIdx    = STAGE_ORDER.indexOf(workflowStage);

  return (
    <div className="isim-cmd">
      {/* Incident header */}
      <div className="isim-cmd__iheader" style={{ borderLeftColor: effectColor }}>
        <span className="isim-cmd__iheader-icon">{incident.icon}</span>
        <div>
          <div className="isim-cmd__iheader-title">{incident.title}</div>
          <span className="isim-cmd__iheader-sev" style={{ background: SEV_COLOR[incident.severity] }}>
            {incident.severity.toUpperCase()}
          </span>
          <span className="isim-cmd__iheader-stage" style={{ background: stageBadge.color }}>
            {stageBadge.label}
          </span>
        </div>
      </div>

      {/* Info grid */}
      <div className="isim-cmd__grid">
        <div className="isim-cmd__grid-row">
          <span className="isim-cmd__grid-key">INCIDENT ID</span>
          <span className="isim-cmd__grid-val isim-cmd__grid-val--id">
            {liveData?.incident_id ?? incident.id.replace(/_/g, '-').toUpperCase()}
          </span>
        </div>
        <div className="isim-cmd__grid-row">
          <span className="isim-cmd__grid-key">LOCATION</span>
          <span className="isim-cmd__grid-val">📍 {incident.zone}</span>
        </div>
        {liveData?.sensor_id && (
          <div className="isim-cmd__grid-row">
            <span className="isim-cmd__grid-key">SENSOR</span>
            <span className="isim-cmd__grid-val isim-cmd__grid-val--sensor">
              {liveData.sensor_id}: {liveData.sensor_value} {liveData.sensor_unit} (τ:{liveData.threshold})
            </span>
          </div>
        )}
        {liveData?.work_order_id && (
          <div className="isim-cmd__grid-row">
            <span className="isim-cmd__grid-key">WORK ORDER</span>
            <span className="isim-cmd__grid-val isim-cmd__grid-val--wo">
              {liveData.work_order_id}
            </span>
          </div>
        )}
        {assignedTechnician && (
          <div className="isim-cmd__grid-row">
            <span className="isim-cmd__grid-key">TECHNICIAN</span>
            <span className="isim-cmd__grid-val isim-cmd__grid-val--team">
              {assignedTechnician.name}
            </span>
          </div>
        )}
      </div>

      {/* Stage-specific panels */}
      {workflowStage === 'validated'  && <ValidationPanel  incident={incident} liveData={liveData}  onConfirm={onClassify} />}
      {workflowStage === 'classified' && <ClassificationPanel incident={incident} onGenerate={onApproveAdvisory} />}
      {workflowStage === 'advisory'   && <AIAdvisoryPanel   incident={incident} onApprove={onDispatch} />}
      {workflowStage === 'dispatched' && (
        <DispatchPanel
          incident={incident}
          selectedRole={selectedRole}
          onRoleChange={onRoleChange}
          onDispatch={onDispatch}
        />
      )}
      {workflowStage === 'enroute' && assignedTechnician && (
        <FieldStatusPanel
          technician={assignedTechnician}
          incident={incident}
          fieldStatusStep={fieldStatusStep}
          onAdvanceField={onAdvanceField}
        />
      )}
      {workflowStage === 'repairing' && assignedTechnician && (
        <RepairPanel
          technician={assignedTechnician}
          incident={incident}
          onResolve={onResolve}
        />
      )}
      {workflowStage === 'resolved' && (
        <AnalyticsPanel
          incident={incident}
          startedAt={state.startedAt}
          timeline={timeline}
        />
      )}

      {/* Response steps */}
      <div className="isim-cmd__section-label" style={{ marginTop: 10 }}>Response Flow</div>
      <ol className="isim-steps">
        {incident.steps.map((step, i) => {
          const cls = getStepClass(i, incident.steps.length, workflowStage);
          return (
            <li key={i} className={`isim-steps__item isim-steps__item--${cls}`}>
              <span className="isim-steps__icon">{cls === 'done' ? '✓' : step.icon}</span>
              <span className="isim-steps__label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      {/* 8-dot stage progress */}
      <div className="isim-stage-progress">
        {STAGE_ORDER.map((s) => {
          const done    = STAGE_ORDER.indexOf(s) < stageIdx;
          const current = s === workflowStage;
          return (
            <div
              key={s}
              className={`isim-stage-progress__dot${done ? ' --done' : ''}${current ? ' --current' : ''}`}
              style={current ? { borderColor: effectColor } : undefined}
              title={s.toUpperCase()}
            />
          );
        })}
      </div>

      {/* Timeline */}
      {timeline.length > 0 && <Timeline events={timeline} />}

      {/* Stop / Run Another */}
      <button className="isim-stop-btn" onClick={onStop}>
        {workflowStage === 'resolved' ? '↩ Run Another Incident' : '⏹ Stop Simulation'}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IncidentSimulator({
  activeIncident,
  onIncidentChange,
}: IncidentSimulatorProps) {
  const [selectedRole, setSelectedRole] = useState('');

  // Fetch live data enrichment when a new incident is first set
  useEffect(() => {
    if (!activeIncident || activeIncident.liveData) return;
    fetchIncidentLiveData(activeIncident.incident.id)
      .then((liveData) => {
        if (liveData) onIncidentChange({ ...activeIncident, liveData });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIncident?.incident.id]);

  // Auto-select first role on dispatched stage
  useEffect(() => {
    if (activeIncident?.workflowStage === 'dispatched' && !selectedRole) {
      setSelectedRole(activeIncident.incident.roles[0]?.role ?? '');
    }
    if (!activeIncident) setSelectedRole('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIncident?.workflowStage, activeIncident?.incident.id]);

  // Stage: detected → validated (from map popup click, done in App.tsx)
  // Stage: validated → classified
  const handleValidate = useCallback(() => {
    if (!activeIncident) return;
    onIncidentChange({
      ...activeIncident,
      workflowStage: 'classified',
      timeline: [
        ...activeIncident.timeline,
        { time: timeNow(), label: 'Sensor anomaly confirmed — multi-sensor corroboration positive', icon: '🔬' },
      ],
    });
  }, [activeIncident, onIncidentChange]);

  // Stage: classified → advisory
  const handleClassify = useCallback(() => {
    if (!activeIncident) return;
    const { classification } = activeIncident.incident;
    onIncidentChange({
      ...activeIncident,
      workflowStage: 'advisory',
      timeline: [
        ...activeIncident.timeline,
        { time: timeNow(), label: `Classified: ${classification.type} — Priority ${classification.priority} (Score ${classification.score})`, icon: '📂' },
        { time: timeNow(), label: 'AI advisory engine analysing incident context…', icon: '🤖' },
      ],
    });
  }, [activeIncident, onIncidentChange]);

  // Stage: advisory → dispatched (AI plan approved)
  const handleApproveAdvisory = useCallback(() => {
    if (!activeIncident) return;
    onIncidentChange({
      ...activeIncident,
      workflowStage: 'dispatched',
      timeline: [
        ...activeIncident.timeline,
        { time: timeNow(), label: 'AI advisory reviewed and approved by operator', icon: '✅' },
        { time: timeNow(), label: `Work order auto-generated: ${activeIncident.liveData?.work_order_id ?? 'WO-AUTO'}`, icon: '🎫' },
      ],
    });
  }, [activeIncident, onIncidentChange]);

  // Stage: dispatched (button) → enroute (assign tech, build route)
  const handleDispatch = useCallback(async () => {
    if (!activeIncident || !selectedRole) return;
    const now  = timeNow();
    const tech = getTechnician(activeIncident.incident.id);
    const dist = calcDistance(tech.coordinates, activeIncident.incident.mapEffect.epicenter);
    const eta  = calcETA(dist);
    const route = await buildRoute(tech.coordinates, activeIncident.incident.mapEffect.epicenter);
    onIncidentChange({
      ...activeIncident,
      workflowStage:      'enroute',
      assignedTechnician: tech,
      routePath:          route,
      fieldStatusStep:    0,
      timeline: [
        ...activeIncident.timeline,
        { time: now, label: `Team dispatched: ${selectedRole}`, icon: '📨' },
        { time: now, label: `${tech.name} assigned — ${dist.toFixed(1)} km away, ETA ${eta} min`, icon: '🚐' },
      ],
    });
  }, [activeIncident, selectedRole, onIncidentChange]);

  // Field sub-step advance (enroute sub-steps → then trigger repairing)
  const handleAdvanceField = useCallback(() => {
    if (!activeIncident) return;
    const nextStep = activeIncident.fieldStatusStep + 1;
    const fieldLabels = [
      'Arrived at site — beginning inspection',
      'Inspection complete — fault confirmed, repair starting',
      'Repair in progress',
    ];
    if (nextStep >= FIELD_STEPS.length) {
      // Move to repairing stage
      onIncidentChange({
        ...activeIncident,
        workflowStage: 'repairing',
        fieldStatusStep: nextStep,
        timeline: [
          ...activeIncident.timeline,
          { time: timeNow(), label: fieldLabels[FIELD_STEPS.length - 1], icon: '🔧' },
        ],
      });
    } else {
      onIncidentChange({
        ...activeIncident,
        fieldStatusStep: nextStep,
        timeline: [
          ...activeIncident.timeline,
          { time: timeNow(), label: fieldLabels[nextStep - 1], icon: nextStep === 1 ? '📍' : '🔍' },
        ],
      });
    }
  }, [activeIncident, onIncidentChange]);

  // Confirm system recovery → resolved
  const handleResolve = useCallback(() => {
    if (!activeIncident) return;
    const now = timeNow();
    onIncidentChange({
      ...activeIncident,
      status:        'resolved',
      workflowStage: 'resolved',
      routePath:     undefined,
      timeline: [
        ...activeIncident.timeline,
        { time: now, label: 'System recovery confirmed — sensors nominal', icon: '📊' },
        { time: now, label: 'Incident closed — post-incident report generated', icon: '✅' },
      ],
    });
  }, [activeIncident, onIncidentChange]);

  const stopIncident = useCallback(() => {
    onIncidentChange(null);
    setSelectedRole('');
  }, [onIncidentChange]);

  // Idle or alert state: nothing to show (map handles the blinking marker)
  const status = activeIncident?.status;
  if (!activeIncident || status === 'alert') return null;

  return (
    <div className="isim-modal-overlay">
      <div className="isim-workflow-modal">
        <CommandCentreView
          state={activeIncident}
          selectedRole={selectedRole}
          onRoleChange={setSelectedRole}
          onValidate={handleValidate}
          onClassify={handleValidate}
          onApproveAdvisory={handleClassify}
          onDispatch={workflowStage_is(activeIncident, 'advisory') ? handleApproveAdvisory : handleDispatch}
          onAdvanceField={handleAdvanceField}
          onResolve={handleResolve}
          onStop={stopIncident}
        />
      </div>
    </div>
  );
}

function workflowStage_is(state: ActiveIncidentState, stage: WorkflowStage): boolean {
  return state.workflowStage === stage;
}
