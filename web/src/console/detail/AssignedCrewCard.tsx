/**
 * "Ambulance on this incident" — crew, vehicle and live ETA/speed/traffic.
 *
 * Extracted out of IncidentDetail's `Assigned` section so the same card can sit in the
 * rail (its original home) AND next to "Live responses" on the dashboard bottom strip —
 * both are fed by the same `useDecisionTrace` poll, so both stay live through arrival
 * with no separate fetch and no gap once the crew reaches the scene.
 */

import { Ambulance, Navigation, Users } from 'lucide-react';
import type { DecisionTrace } from '../../lib/types';
import { t } from '../../lib/i18n';
import { duration, durationUnit } from '../../lib/format';
import { openDetail } from '../../lib/stores/detail';
import { requestFollow } from '../../lib/stores/director';
import { Button, Chip } from '../../shared/ui';

const withUnit = (sec: number | null | undefined) => (sec == null ? '—' : `${duration(sec)} ${durationUnit(sec)}`);
const km = (m: number | null | undefined) => (m == null ? '—' : `${(Math.max(0, m) / 1000).toFixed(1)} km`);

export function AssignedCrewCard({ trace, now, showTitle = true, compact = false }: {
  trace: DecisionTrace; now: number; showTitle?: boolean;
  /** The dashboard's bottom strip has a fixed height with no room to scroll — drop the
   *  crew list, actions and the demo-roster note and keep only the live facts (state,
   *  ETA, speed, traffic, hospital) that make this card worth glancing at. */
  compact?: boolean;
}) {
  const a = trace.assignment;
  if (!a) return null;
  const p = a.profile;
  const live = a.live;
  const etaLeft = a.etaPredictedAt && !trace.incident.firstOnsceneAt ? Math.round((Date.parse(a.etaPredictedAt) - now) / 1000) : null;
  const jam = live?.trafficAhead?.[0] ?? null;
  return (
    <section className="dtl-sec">
      {showTitle && <h4 className="dtl-sec__title"><Ambulance aria-hidden /> {t('detail.inc.assigned')}</h4>}
      <div className="dtl-crew">
        <div className="dtl-crew__head">
          <div>
            <strong>{a.callsign}</strong>
            <span>{a.unitKind}{p ? ` · ${p.plate} · ${p.vehicle}` : ''}</span>
          </div>
          <Chip tone={trace.phase === 'enroute' ? 'accent' : trace.phase === 'onscene' ? 'success' : 'neutral'}>{t(`asg.state.${a.state}`)}</Chip>
        </div>
        {p && !compact && (
          <ul className="dtl-crew__people">
            {p.crew.map((m) => (
              <li key={m.staffId}><span>{m.title}</span><strong>{m.name}</strong></li>
            ))}
          </ul>
        )}
        <div className={`dtl-kv${compact ? ' dtl-kv--3' : ''}`}>
          <div><span>{t('detail.inc.eta')}</span><strong className={etaLeft != null && etaLeft < 0 ? 'is-bad' : ''}>{etaLeft == null ? (trace.incident.firstOnsceneAt ? t('detail.inc.onScene') : '—') : etaLeft < 0 ? t('detail.inc.late', { t: withUnit(-etaLeft) }) : withUnit(etaLeft)}</strong></div>
          <div><span>{t('detail.inc.toGo')}</span><strong>{km(live?.remainingM)}</strong></div>
          <div><span>{t('detail.inc.speed')}</span><strong>{live?.speedKmh != null ? `${live.speedKmh} km/h` : '—'}</strong></div>
          <div>
            <span>{t('detail.inc.trafficAhead')}</span>
            <strong className={jam ? 'is-bad' : ''}>
              {jam ? `${jam.level === 'heavy' ? t('detail.inc.heavy') : t('detail.inc.slow')} · ${Math.round(jam.lengthM)} m · +${duration(jam.delaySec)}` : live ? t('detail.inc.clear') : '—'}
            </strong>
          </div>
          {a.hospital && <div><span>{t('detail.inc.hospital')}</span><strong>{a.hospital.name}</strong></div>}
        </div>
        <div className="dtl-actions dtl-actions--inline">
          {live && <Button size="sm" variant="primary" onClick={() => requestFollow(a.ref)}><Navigation aria-hidden /> {t('detail.followOnMap')}</Button>}
          {!compact && <Button size="sm" variant="secondary" onClick={() => openDetail({ kind: 'unit', ref: a.unitRef })}><Users aria-hidden /> {t('detail.inc.crewVehicle')}</Button>}
        </div>
        {p && !compact && <p className="dtl-sec__note">{t('detail.demoRoster')}</p>}
      </div>
    </section>
  );
}
