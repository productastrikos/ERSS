/**
 * The right-hand panel for a selected incident — docs/06 §2.3.
 *
 *   undispatched   facts (Makani, entrance, floor first) → recommendation → dispatch
 *   dispatched     units and their lifecycle → agencies and SLA → context → timeline → notes → close
 *
 * The vertical-city detail is second only to priority: in a 60-storey tower, the entrance
 * and the floor decide the response as much as the drive does.
 */

import { useState } from 'react';
import { BrainCircuit, Hand, MapPin, Plus, X } from 'lucide-react';
import type { Incident, IncidentDetail } from '../../../lib/types';
import { api, ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { duration, floorLabel, makani, SOURCE_LABEL, timeSec, INCIDENT_STATE_LABEL } from '../../../lib/format';
import { useNow } from '../../../lib/stores/now';
import { refreshDetail } from '../../../lib/stores/incidents';
import { useCan } from '../../../lib/stores/session';
import { toast } from '../../../lib/stores/toast';
import { Button, Card, Chip, ErrorState, Field, Modal, Skeleton } from '../../../shared/ui';
import { AssignmentCard } from './AssignmentCard';
import { DispatchPanel } from './DispatchPanel';
import { NotesCard, TimelineCard } from './IncidentContext';
import { simControl, useSim } from '../../../lib/stores/live';
import { PriorityChip } from './opsUi';
import { ACTIVE_ASSIGNMENT, kindLabel } from './opsModel';

const OUTCOMES = ['transported', 'treated_released', 'refused', 'deceased', 'false_alarm', 'duplicate', 'cancelled_by_caller', 'no_patient_found'];

export function IncidentPanel({ summary, entry, onClose }: {
  summary: Incident | null;
  entry: { data: IncidentDetail | null; status: string; error: string | null } | undefined;
  onClose: () => void;
}) {
  const now = useNow();
  const canDispatch = useCan('operations.dispatch');
  const canClose = useCan('incident.close');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);

  const detail = entry?.data ?? null;
  const incident = detail?.incident ?? summary;

  if (!incident) {
    return entry?.status === 'error'
      ? <Card><ErrorState title={t('incident.loadFailed')} body={entry.error ?? undefined} /></Card>
      : <Card><div className="panel__skeleton"><Skeleton height={24} /><Skeleton height={90} /><Skeleton height={160} /></div></Card>;
  }

  const closed = incident.state === 'closed';
  const assignments = detail?.assignments ?? [];
  const active = assignments.filter((a) => ACTIVE_ASSIGNMENT.has(a.state));
  // A unit that attended and cleared belongs with the incident; "earlier offers" are the
  // ones that never did — declined, timed out, stood down.
  const attended = assignments.filter((a) => a.state === 'cleared');
  const earlier = assignments.filter((a) => a.state === 'declined' || a.state === 'timed_out' || a.state === 'cancelled');
  const undispatched = !closed && active.length === 0;
  const elapsed = (now - Date.parse(incident.reportedAt)) / 1000;

  return (
    <div className="panel">
      <Card variant="raised" className="panel__head">
        <div className="panel__title-row">
          <PriorityChip priority={incident.priority} />
          <h2 className="panel__title">{kindLabel(incident.kind)}</h2>
          <button type="button" className="panel__close" onClick={onClose} aria-label={t('incident.deselect')}><X aria-hidden /></button>
        </div>
        <div className="panel__sub">
          <span className="mono">{incident.ref}</span>
          <Chip tone={closed ? 'neutral' : undispatched ? 'warning' : 'info'}>
            {undispatched ? t('incident.awaiting') : INCIDENT_STATE_LABEL[incident.state] ?? incident.state}
          </Chip>
          <span className="numeric panel__elapsed">
            {closed ? `${t('incident.response')} ${duration(incident.responseSec)}` : duration(elapsed)}
          </span>
          {incident.isResting && <Chip tone="neutral" title={t('incident.restingTitle')}>{t('incident.resting')}</Chip>}
        </div>

        <Facts incident={incident} />
      </Card>

      {!detail && entry?.status !== 'error' && <Card><Skeleton height={120} /></Card>}
      {entry?.status === 'error' && !detail && <Card><ErrorState body={entry.error ?? undefined} onRetry={() => void refreshDetail(incident.ref)} /></Card>}

      {detail && (
        <>
          {undispatched && <AiCountdown incidentRef={incident.ref} now={now} canDispatch={canDispatch} />}
          {canDispatch && undispatched && <DispatchPanel incident={incident} excludeRefs={earlier.map((a) => a.unitRef)} />}

          {(active.length > 0 || attended.length > 0) && (
            <Card title={t('asg.title')}
                  actions={canDispatch && !closed && !adding && active.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus aria-hidden /> {t('dispatch.addUnit')}</Button>
                  )}>
              <div className="asg-list">
                {[...active, ...attended].map((a) => (
                  <AssignmentCard key={a.ref} a={a} incident={incident} now={now}
                                  timeoutSec={detail.acknowledgeTimeoutSec} canAct={canDispatch && ACTIVE_ASSIGNMENT.has(a.state)} />
                ))}
              </div>
            </Card>
          )}

          {adding && canDispatch && !closed && (
            <DispatchPanel incident={incident} title={t('dispatch.addUnit')}
                           excludeRefs={assignments.map((a) => a.unitRef)}
                           onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          )}

          {earlier.length > 0 && (
            <Card title={t('asg.history')} variant="flat">
              <div className="asg-list">
                {earlier.map((a) => (
                  <AssignmentCard key={a.ref} a={a} incident={incident} now={now} timeoutSec={detail.acknowledgeTimeoutSec} canAct={false} />
                ))}
              </div>
            </Card>
          )}

          {/* The partner-agency SLA and correlation cards (IncidentContext.tsx) are left out
              of the DCAS console; the ambulance story is units, timeline and notes. */}
          <TimelineCard timeline={detail.timeline} />
          <NotesCard incidentRef={incident.ref} notes={detail.notes} closed={closed} />

          {canClose && !closed && (
            <Button variant="secondary" block onClick={() => setClosing(true)}>{t('incident.close')}</Button>
          )}
          <CloseDialog incident={incident} open={closing} onClose={() => setClosing(false)} />
        </>
      )}
    </div>
  );
}

/**
 * The AI will dispatch this call on its own when the countdown ends. The dispatcher can
 * dispatch sooner from the recommendation below (which ends the countdown), or hold the
 * call to decide themselves.
 */
function AiCountdown({ incidentRef, now, canDispatch }: { incidentRef: string; now: number; canDispatch: boolean }) {
  const { state, busy } = useSim();
  const pending = state?.pending.find((p) => p.incidentRef === incidentRef);
  if (!pending) return null;
  const left = Math.max(0, Math.ceil((Date.parse(pending.dueAt) - now) / 1000));
  return (
    <div className="ai-countdown" role="status">
      <BrainCircuit aria-hidden />
      <div className="ai-countdown__text">
        <strong>AI auto-dispatch in <span className="numeric">{left}s</span></strong>
        <span>The top recommendation below is dispatched automatically. Dispatch now to save the wait, or hold to decide yourself.</span>
      </div>
      {canDispatch && (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void simControl(() => api.sim.hold(incidentRef))}>
          <Hand aria-hidden /> Hold
        </Button>
      )}
    </div>
  );
}

function Facts({ incident }: { incident: Incident }) {
  const b = incident.building;
  return (
    <dl className="facts">
      {incident.makani && (
        <div className="facts__key">
          <dt>{t('incident.makani')}</dt>
          <dd>
            <span className="mono facts__makani">{makani(incident.makani)}</span>
            {b && <span> · {t('incident.entranceOf', { n: b.entranceNo, count: b.entranceCount })}{b.entranceRole ? ` (${b.entranceRole})` : ''}</span>}
          </dd>
        </div>
      )}
      {incident.floor != null && (
        <div className="facts__key">
          <dt>{t('incident.floor')}</dt>
          <dd className="facts__floor">
            {floorLabel(incident.floor)}{incident.unitNo ? ` · ${t('incident.unitNo')} ${incident.unitNo}` : ''}
            {b?.floors ? <span className="facts__muted"> · {t('incident.floorsTotal', { n: b.floors })}</span> : null}
          </dd>
        </div>
      )}
      {incident.accessNote && (
        <div className="facts__key"><dt>{t('incident.accessNote')}</dt><dd>{incident.accessNote}</dd></div>
      )}
      <div>
        <dt><MapPin aria-hidden /></dt>
        <dd>{[b?.name, incident.zoneName].filter(Boolean).join(', ') || '—'}</dd>
      </div>
      {incident.chiefComplaint && <div><dt>{t('incident.complaint')}</dt><dd>{incident.chiefComplaint}</dd></div>}
      <div>
        <dt>{t('incident.source')}</dt>
        <dd>
          {SOURCE_LABEL[incident.source] ?? incident.source} · {timeSec(incident.reportedAt)} GST
          {incident.callerName && <span className="facts__muted"> · {incident.callerName}{incident.callerRole ? ` (${t(`callerRole.${incident.callerRole}`)})` : ''}</span>}
        </dd>
      </div>
      {incident.patientsCount > 1 && <div><dt>{t('incident.patients')}</dt><dd className="numeric">{incident.patientsCount}</dd></div>}
      {incident.triageCode?.startsWith('AUTO') && !incident.closedAt && (
        <div><dt /><dd><TriageConfirm incident={incident} /></dd></div>
      )}
    </dl>
  );
}

/** Auto-triage is a starting point; one click confirms it as the dispatcher's decision. */
function TriageConfirm({ incident }: { incident: Incident }) {
  const canDispatch = useCan('operations.dispatch');
  const [busy, setBusy] = useState(false);
  if (!canDispatch) return <span className="facts__muted">{t('incident.autoTriaged')}</span>;
  return (
    <span className="facts__triage">
      <span className="facts__muted">{t('incident.autoTriaged')}</span>
      <Button size="sm" variant="ghost" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.incidents.triage(incident.ref, { priority: incident.priority, triageCode: `CONFIRMED-${incident.priority}` });
          await refreshDetail(incident.ref);
        } catch (err) {
          toast({ level: 'danger', title: t('incident.confirmTriage', { p: incident.priority }), body: (err as ApiError).message });
        } finally { setBusy(false); }
      }}>
        {t('incident.confirmTriage', { p: incident.priority })}
      </Button>
    </span>
  );
}

function CloseDialog({ incident, open, onClose }: { incident: Incident; open: boolean; onClose: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.incidents.close(incident.ref, outcome);
      await refreshDetail(incident.ref);
      toast({ level: 'success', title: `${incident.ref} — ${t(`outcome.${outcome}`)}` });
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('close.title', { ref: incident.ref })} subtitle={t('close.body')}
           footer={(
             <>
               <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
               <Button variant="primary" disabled={!outcome} loading={busy} onClick={() => void submit()}>{t('close.confirm')}</Button>
             </>
           )}>
      <Field label={t('incident.outcome')} error={error ?? undefined}>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">—</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{t(`outcome.${o}`)}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
