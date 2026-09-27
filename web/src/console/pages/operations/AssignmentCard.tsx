/**
 * One unit on one incident: where it is in its lifecycle, every stamp with the time each
 * stage took, the prediction held against what happened, and the next thing the crew
 * can do.
 *
 * The buttons are `allowedActions` from the server — the console cannot offer a
 * transition the server would refuse. From the console they are LOGGED on the crew's
 * behalf, as from a radio call; the server stamps the time either way.
 */

import { useEffect, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import type { Assignment, AssignmentAction, HospitalRanking, Incident } from '../../../lib/types';
import { api, ApiError, idempotencyKey } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { duration, timeSec, durationUnit } from '../../../lib/format';
import { refreshDetail } from '../../../lib/stores/incidents';
import { toast } from '../../../lib/stores/toast';
import { Button, Chip, ErrorState, Field, Meter, Predicted, Skeleton } from '../../../shared/ui';
import { ASSIGNMENT_TONE, signedDuration } from './opsModel';

const STAMPS: Array<{ key: keyof Assignment; label: string }> = [
  { key: 'offeredAt', label: 'asg.stage.offered' },
  { key: 'acknowledgedAt', label: 'asg.stage.acknowledged' },
  { key: 'enrouteAt', label: 'asg.stage.enroute' },
  { key: 'onsceneAt', label: 'asg.stage.onscene' },
  { key: 'atPatientAt', label: 'asg.stage.atPatient' },
  { key: 'transportingAt', label: 'asg.stage.transporting' },
  { key: 'atHospitalAt', label: 'asg.stage.atHospital' },
  { key: 'clearedAt', label: 'asg.stage.cleared' },
];

/** The stamps an assignment has, each with how long its stage took. */
function stageRows(a: Assignment) {
  const rows: Array<{ key: string; label: string; at: string; took: number | null }> = [];
  let previous: number | null = null;
  for (const { key, label } of STAMPS) {
    const at = a[key] as string | null;
    if (!at) continue;
    const ms = Date.parse(at);
    rows.push({ key, label, at, took: previous === null ? null : (ms - previous) / 1000 });
    previous = ms;
  }
  return rows;
}

const NEEDS_REASON: ReadonlySet<AssignmentAction> = new Set(['decline', 'cancel']);
const PRIMARY_ACTION: ReadonlySet<AssignmentAction> = new Set(['acknowledge', 'enroute', 'onscene', 'at_patient', 'at_hospital']);

export function AssignmentCard({ a, incident, now, timeoutSec, canAct }: {
  a: Assignment;
  incident: Incident;
  now: number;
  timeoutSec: number;
  canAct: boolean;
}) {
  const [pending, setPending] = useState<AssignmentAction | null>(null);
  const [form, setForm] = useState<AssignmentAction | null>(null);
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState(false);

  const act = async (action: AssignmentAction, body?: { reason?: string; hospitalRef?: string }) => {
    setPending(action);
    try {
      await api.assignments.act(a.ref, action, body, idempotencyKey());
      setForm(null);
      setReason('');
      await refreshDetail(incident.ref);
    } catch (err) {
      toast({ level: 'danger', title: `${a.unitRef}: ${t(`asg.action.${action}`).replace('…', '')}`, body: (err as ApiError).message });
      void refreshDetail(incident.ref);
    } finally {
      setPending(null);
    }
  };

  const onAction = (action: AssignmentAction) => {
    if (NEEDS_REASON.has(action) || action === 'transporting') setForm(form === action ? null : action);
    else void act(action);
  };

  const offered = a.state === 'offered';
  const ackLeft = offered ? timeoutSec - (now - Date.parse(a.offeredAt)) / 1000 : null;
  const moving = a.state === 'offered' || a.state === 'acknowledged' || a.state === 'enroute';
  const etaLeft = moving && a.etaPredictedAt ? (Date.parse(a.etaPredictedAt) - now) / 1000 : null;
  const r = a.dispatchRationale;
  const ended = a.state === 'cleared' || a.state === 'declined' || a.state === 'timed_out' || a.state === 'cancelled';
  const stamps = stageRows(a);

  return (
    <div className="asg" data-ended={ended || undefined}>
      <div className="asg__head">
        <div className="asg__who">
          <span className="asg__callsign">{a.callsign}</span>
          <span className="asg__ref mono">{a.unitRef} · {a.unitKind}</span>
        </div>
        <Chip tone={ASSIGNMENT_TONE[a.state]}>{t(`asg.state.${a.state}`)}</Chip>
      </div>

      {ackLeft !== null && (
        <div className="asg__ack">
          <Meter value={Math.max(0, ackLeft) / timeoutSec} tone={ackLeft > 15 ? 'warning' : 'danger'} />
          <span className="numeric">{ackLeft > 0 ? t('asg.ackWindow', { time: duration(ackLeft) }) : t('asg.ackOverdue')}</span>
        </div>
      )}

      {etaLeft !== null && (
        <div className="asg__line">
          <span className="asg__label">{t('asg.eta')}</span>
          <Predicted method={a.etaMethod ?? undefined}>
            <span className="numeric">{etaLeft >= 0 ? duration(etaLeft) : `+${duration(-etaLeft)}`}</span>
          </Predicted>
        </div>
      )}

      <ol className="asg__stamps">
        {stamps.map(({ key, label, at, took }) => (
          <li key={key}>
            <span className="asg__stage">{t(label)}</span>
            <span className="asg__time numeric">{timeSec(at)}</span>
            <span className="asg__took numeric">{took === null ? '' : `+${duration(took)}`}</span>
          </li>
        ))}
        {a.declinedAt && (
          <li><span className="asg__stage">{t('asg.state.declined')}</span><span className="asg__time numeric">{timeSec(a.declinedAt)}</span><span className="asg__took">{a.declineReason}</span></li>
        )}
      </ol>

      {a.onsceneAt && a.etaErrorSec != null && (
        <div className="asg__line">
          <span className="asg__label">{t('asg.eta')}</span>
          <span>{t('asg.etaError', { delta: signedDuration(a.etaErrorSec) })}</span>
        </div>
      )}
      {a.vrtSec != null && (
        <div className="asg__line">
          <span className="asg__label">{t('asg.vrt')}</span>
          <span className="numeric">{duration(a.vrtSec)} {durationUnit(a.vrtSec)}</span>
          {a.vrtBreakdown?.predictedSec != null && (
            <span className="asg__muted">{t('asg.vrtPredicted', { time: duration(a.vrtBreakdown.predictedSec) })}</span>
          )}
        </div>
      )}
      {a.routeTakenSec != null && (
        <div className="asg__line">
          <span className="asg__label">{t('asg.route')}</span>
          <span className="numeric">{t('asg.routeVs', { taken: duration(a.routeTakenSec), proposed: duration(a.routeProposedSec) })}</span>
        </div>
      )}
      {a.hospitalName && (
        <div className="asg__line">
          <span className="asg__label"><Building2 aria-hidden /></span>
          <span>{a.hospitalName}</span>
        </div>
      )}

      {r && (
        <div className="asg__rationale">
          <button type="button" className="rec__why" aria-expanded={why} onClick={() => setWhy(!why)}>
            {r.selected.rank
              ? t('asg.rationale', { rank: r.selected.rank, of: r.selected.of, score: (r.selected.score ?? 0).toFixed(2) })
              : t('asg.manual')}
            <ChevronDown aria-hidden />
          </button>
          {r.override && <div className="asg__muted">{t('asg.override', { reason: r.override.reason })}</div>}
          {r.redispatch && <div className="asg__muted">{t('asg.redispatch', { reason: r.redispatch.reason })}</div>}
          {why && r.selected.factors && (
            <div className="why">
              {r.selected.factors.map((f) => (
                <div className="why__factor" key={f.key}>
                  <div className="why__head">
                    <span className="why__name">{t(`dispatch.factor.${f.key}`)}</span>
                    <span className="why__weight">{t('dispatch.weight', { w: f.weight.toFixed(2) })}</span>
                    <span className="why__value numeric">+{f.contribution.toFixed(3)}</span>
                  </div>
                  <Meter value={f.score} tone={f.key === 'equity' ? 'neutral' : 'accent'} />
                  <div className="why__detail">{f.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canAct && a.allowedActions.length > 0 && (
        <>
          <div className="asg__actions" title={t('asg.loggedNote')}>
            {a.allowedActions.map((action) => (
              <Button key={action} size="sm"
                      variant={NEEDS_REASON.has(action) ? 'ghost' : PRIMARY_ACTION.has(action) ? 'primary' : 'secondary'}
                      loading={pending === action} disabled={pending !== null && pending !== action}
                      aria-expanded={NEEDS_REASON.has(action) || action === 'transporting' ? form === action : undefined}
                      onClick={() => onAction(action)}>
                {t(`asg.action.${action}`)}
              </Button>
            ))}
          </div>

          {form && NEEDS_REASON.has(form) && (
            <div className="asg__form">
              <Field label={t('asg.reason')}>
                <textarea rows={2} maxLength={300} value={reason} placeholder={t('asg.reasonPlaceholder')}
                          onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button size="sm" variant="danger" disabled={reason.trim().length < 3} loading={pending === form}
                      onClick={() => void act(form, { reason: reason.trim() })}>
                {t('asg.confirm')}
              </Button>
            </div>
          )}

          {form === 'transporting' && (
            <HospitalChooser incidentRef={incident.ref} busy={pending === 'transporting'}
                             onChoose={(hospitalRef) => void act('transporting', { hospitalRef })} />
          )}
        </>
      )}
    </div>
  );
}

/** Destination, ranked by the hospital engine with its clinical reasoning. */
function HospitalChooser({ incidentRef, busy, onChoose }: { incidentRef: string; busy: boolean; onChoose: (ref: string) => void }) {
  const [ranking, setRanking] = useState<HospitalRanking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.hospitalRecommend(incidentRef)
      .then((r) => { if (!cancelled) { setRanking(r); setChosen(r.value?.hospitals[0]?.ref ?? null); } })
      .catch((err: ApiError) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [incidentRef]);

  if (error) return <ErrorState body={error} />;
  if (!ranking) return <div className="asg__form"><Skeleton height={40} /><Skeleton height={40} /></div>;

  const hospitals = ranking.value?.hospitals.slice(0, 5) ?? [];
  return (
    <div className="asg__form">
      <div className="asg__muted">
        {ranking.value?.requirement ? ranking.value.requirement.why : t('asg.hospitalRecommended')}
      </div>
      <ul className="hosp" role="radiogroup" aria-label={t('asg.hospital')}>
        {hospitals.map((h) => (
          <li key={h.ref} data-selected={chosen === h.ref || undefined}>
            <label>
              <input type="radio" name={`hosp-${incidentRef}`} checked={chosen === h.ref} onChange={() => setChosen(h.ref)} />
              <span className="hosp__name">{h.name}</span>
              <Predicted confidence={h.etaConfidence}><span className="numeric">{duration(h.etaSec)}</span></Predicted>
              <span className="hosp__load numeric">ED {h.edLoadPct}%</span>
            </label>
            <div className="hosp__why">{h.reasoning}</div>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="primary" disabled={!chosen} loading={busy} onClick={() => chosen && onChoose(chosen)}>
        {t('asg.confirm')}
      </Button>
    </div>
  );
}
