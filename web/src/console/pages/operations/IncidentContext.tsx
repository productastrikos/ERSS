/**
 * The multi-agency side of an incident: the SLA strip (docs/05 §7.3), the correlation card
 * (BoQ-1 F9), the timeline and the shared notes (BoQ-1 F6).
 */

import { useEffect, useState } from 'react';
import { Navigation, Send } from 'lucide-react';
import type { AgencyCode, AgencyNotification, Correlation, Incident, IncidentDetail } from '../../../lib/types';
import { api, ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { compact, distance, duration, timeSec } from '../../../lib/format';
import { refreshDetail } from '../../../lib/stores/incidents';
import { useCan } from '../../../lib/stores/session';
import { toast } from '../../../lib/stores/toast';
import { Button, Card, Chip, EmptyState, ErrorState, Field, SimulatedChip, Skeleton } from '../../../shared/ui';
import { AgencyMark } from './opsUi';
import { useAgencies } from './opsModel';

// ── SLA strip ───────────────────────────────────────────────────────────────

export function AgencySla({ incident, notifications, now }: { incident: Incident; notifications: AgencyNotification[]; now: number }) {
  const agencies = useAgencies();
  const canDispatch = useCan('operations.dispatch');
  const [busy, setBusy] = useState<string | null>(null);
  const [add, setAdd] = useState<AgencyCode | ''>('');

  const notified = new Set(notifications.map((n) => n.agencyCode));
  const addable = [...agencies.values()].filter((a) => a.code !== 'DCAS' && !notified.has(a.code));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await refreshDetail(incident.ref); } catch (err) {
      toast({ level: 'danger', title: label, body: (err as ApiError).message });
    } finally { setBusy(null); }
  };

  return (
    <Card title={t('sla.title')}>
      {notifications.length === 0 ? (
        <div className="muted-line">{t('sla.none')}</div>
      ) : (
        <ul className="sla">
          {notifications.map((n) => {
            const elapsed = n.acknowledgedAt ? n.elapsedSec : (now - Date.parse(n.notifiedAt)) / 1000;
            const met = n.acknowledgedAt ? n.met : elapsed > n.slaSec ? false : null;
            return (
              <li key={n.agencyCode} className="sla__lane" data-state={met === true ? 'met' : met === false ? 'breached' : 'pending'}>
                <AgencyMark code={n.agencyCode} agencies={agencies} size={15} />
                <div className="sla__body">
                  <div className="sla__name">{n.agencyName}</div>
                  <div className="sla__times numeric">
                    {timeSec(n.notifiedAt)} · {n.acknowledgedAt
                      ? t('sla.acknowledgedIn', { time: duration(n.elapsedSec) })
                      : t('sla.elapsed', { time: duration(elapsed), sla: duration(n.slaSec) })}
                  </div>
                </div>
                {/* Met or breached is said in words, never by colour alone. */}
                <Chip tone={met === true ? 'success' : met === false ? 'danger' : 'warning'}>
                  {met === true ? t('sla.met') : met === false ? t('sla.breached') : t('sla.pending')}
                </Chip>
                {!n.acknowledgedAt && canDispatch && incident.state !== 'closed' && (
                  <Button size="sm" variant="ghost" loading={busy === n.agencyCode}
                          onClick={() => void run(t('sla.logAck'), () => api.incidents.acknowledgeNotification(incident.ref, n.agencyCode))}>
                    {t('sla.logAck')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canDispatch && incident.state !== 'closed' && addable.length > 0 && (
        <div className="sla__add">
          <select value={add} onChange={(e) => setAdd(e.target.value as AgencyCode)} aria-label={t('sla.notifyChoose')}>
            <option value="">{t('sla.notifyChoose')}</option>
            {addable.map((a) => <option key={a.code} value={a.code}>{a.short_name}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!add} loading={busy === 'notify'}
                  onClick={() => add && void run(t('sla.notify'), () => api.incidents.notify(incident.ref, [add])).then(() => setAdd(''))}>
            {t('sla.notify')}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Correlation ─────────────────────────────────────────────────────────────

export function CorrelationCard({ incident, notified }: { incident: Incident; notified: AgencyCode[] }) {
  const [result, setResult] = useState<{ request: string; corr: Correlation | null; error: string | null } | null>(null);
  const agencies = useAgencies();
  // Re-read when anything the rules look at changes.
  const request = `${incident.ref}|${incident.kind}|${incident.priority}|${incident.floor}|${incident.patientsCount}|${incident.lng}`;

  useEffect(() => {
    let cancelled = false;
    api.incidents.correlation(incident.ref)
      .then((corr) => { if (!cancelled) setResult({ request, corr, error: null }); })
      .catch((err: ApiError) => { if (!cancelled) setResult({ request, corr: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [request, incident.ref]);

  const error = result?.request === request ? result.error : null;
  const v = result?.corr?.value;
  return (
    <Card title={t('corr.title')} actions={<Chip tone="neutral">{t('corr.rules')}</Chip>}>
      {error ? <ErrorState body={error} /> : !v ? (
        <div className="corr"><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /></div>
      ) : (
        <div className="corr">
          <section>
            <h4 className="corr__h">{t('corr.agencies')}</h4>
            {v.recommendedAgencies.length === 0 ? <div className="muted-line">{t('corr.agenciesNone')}</div> : (
              <ul className="corr__list">
                {v.recommendedAgencies.map((a) => (
                  <li key={a.code}>
                    <AgencyMark code={a.code} agencies={agencies} />
                    <span className="corr__agency">{agencies.get(a.code)?.short_name ?? a.code}</span>
                    {notified.includes(a.code) && <Chip tone="info">{t('corr.notified')}</Chip>}
                    <div className="corr__reason">{a.reasons.join('; ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {v.wind && (
            <section className="corr__wind">
              <h4 className="corr__h">{t('corr.wind')}</h4>
              <div>
                {/* The arrow points where the wind is blowing TO. */}
                <Navigation aria-hidden className="corr__arrow" style={{ transform: `rotate(${v.wind.towardDeg}deg)` }} />
                <span>{t('corr.windFrom', { deg: v.wind.fromDeg, kph: Math.round(v.wind.speedKph) })}</span>
                {v.wind.tempC != null && <span className="corr__muted"> · {Math.round(v.wind.tempC)} °C</span>}
                <SimulatedChip />
              </div>
              {v.wind.plume && <div className="corr__plume">{t('corr.plume', { from: v.wind.plume.fromDeg, to: v.wind.plume.toDeg })}</div>}
            </section>
          )}

          {v.populationWithin.length > 0 && (
            <section>
              <h4 className="corr__h">{t('corr.population')} <span className="corr__muted">({t('corr.estimate')})</span></h4>
              <div className="corr__pop" title={v.populationWithin[0].basis}>
                {v.populationWithin.map((p) => (
                  <span key={p.radiusM}><span className="numeric">{compact(p.estimate)}</span> {t('corr.populationRadius', { m: distance(p.radiusM) })}</span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="corr__h">{t('corr.sites')}</h4>
            {v.sensitiveSites.length === 0 ? <div className="muted-line">{t('corr.sitesNone')}</div> : (
              <ul className="corr__sites">
                {v.sensitiveSites.map((s) => (
                  <li key={`${s.kind}:${s.name}`}><span className="corr__muted">{s.label}</span> {s.name} <span className="numeric corr__muted">{distance(s.distanceM)}</span></li>
                ))}
              </ul>
            )}
          </section>

          {v.feeds.length > 0 && (
            <section>
              <h4 className="corr__h">{t('corr.feeds')}</h4>
              <ul className="corr__sites">
                {v.feeds.map((f) => (
                  <li key={f.key}>
                    <AgencyMark code={f.agencyCode} agencies={agencies} size={12} /> {f.name} — <span className="corr__muted">{f.relevance}</span>
                    {f.isSimulated && <SimulatedChip />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Timeline and notes ──────────────────────────────────────────────────────

export function TimelineCard({ timeline }: { timeline: IncidentDetail['timeline'] }) {
  return (
    <Card title={t('timeline.title')}>
      <ol className="tl">
        {timeline.map((row) => (
          <li key={row.id} className="tl__row" data-stage={row.stage} data-actor={row.actorKind ?? undefined}>
            <span className="tl__time numeric">{timeSec(row.ts)}</span>
            <span className="tl__label">{row.label}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function NotesCard({ incidentRef, notes, closed }: { incidentRef: string; notes: IncidentDetail['notes']; closed: boolean }) {
  const canNote = useCan('incident.note');
  const agencies = useAgencies();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.incidents.note(incidentRef, body.trim());
      setBody('');
      await refreshDetail(incidentRef);
    } catch (err) {
      toast({ level: 'danger', title: t('notes.add'), body: (err as ApiError).message });
    } finally { setBusy(false); }
  };

  return (
    <Card title={t('notes.title')}>
      {notes.length === 0 ? <EmptyState title={t('notes.none')} /> : (
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="notes__who">
                {n.agencyCode && <AgencyMark code={n.agencyCode} agencies={agencies} size={12} />}
                <span>{n.authorName}</span>
                <span className="numeric corr__muted">{timeSec(n.createdAt)}</span>
              </div>
              <div className="notes__body">{n.body}</div>
            </li>
          ))}
        </ul>
      )}
      {canNote && !closed && (
        <div className="notes__add">
          <Field>
            <textarea rows={2} maxLength={2000} value={body} placeholder={t('notes.placeholder')} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button size="sm" variant="secondary" disabled={!body.trim()} loading={busy} onClick={() => void submit()}>
            <Send aria-hidden /> {t('notes.add')}
          </Button>
        </div>
      )}
    </Card>
  );
}
