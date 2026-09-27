/**
 * The response rail — every live call, and who is going to it.
 *
 * This is the part the user asked for first: "where the event alerts are, and if there are
 * any en route already, so to monitor that". A map alone cannot answer it, because the
 * answer is a LIST with an order — most urgent, soonest arriving, longest waiting — and a
 * map has no order.
 *
 * It sits ON the map rather than beside it, so it costs no layout and can be dismissed
 * when the picture itself is the point. Each row is a control: click to frame that
 * response, click the vehicle button to ride with it.
 *
 * Rows that need an ambulance and do not have one are visually the loudest thing on the
 * screen. That is deliberate. Everything else here is monitoring; those rows are a job.
 */

import { AlertTriangle, Ambulance, Building2, Navigation, Timer } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { duration, durationUnit } from '../../../lib/format';
import { openIncident } from '../../../lib/router';
import type { LiveAlert, LiveResponse } from '../layers/liveResponse';
import type { LiveOpsModel } from './useLiveOps';

type LngLat = [number, number];

const kindLabel = (k: string) => { const s = t(`kind.${k}`); return s === `kind.${k}` ? k.replace(/_/g, ' ') : s; };

export interface ResponseRailProps {
  live: LiveOpsModel;
  /** Assignment ref the camera is currently riding with, if any. */
  chasing: string | null;
  onPick: (id: string, points: LngLat[]) => void;
  onChase: (id: string) => void;
  variant: 'embedded' | 'full';
}

export function ResponseRail({ live, chasing, onPick, onChase, variant }: ResponseRailProps) {
  if (!live.ordered.length) return null;

  return (
    <div className={`resprail resprail--${variant}`} aria-label={t('liveops.rail')}>
      <div className="resprail__head">
        <Ambulance aria-hidden />
        {t('liveops.rail')}
        <span className="resprail__count">{live.ordered.length}</span>
      </div>

      <ul className="resprail__list">
        {live.ordered.map((row) => (
          row.kind === 'response'
            ? (
              <ResponseRow
                key={row.id}
                r={row.response}
                chasing={chasing === row.id}
                onPick={onPick}
                onChase={onChase}
              />
            )
            : <AlertRow key={row.id} a={row.alert} onPick={onPick} />
        ))}
      </ul>
    </div>
  );
}

/** An ambulance on its way, or already there. */
function ResponseRow({ r, chasing, onPick, onChase }: {
  r: LiveResponse;
  chasing: boolean;
  onPick: (id: string, points: LngLat[]) => void;
  onChase: (id: string) => void;
}) {
  const arrived = !!r.onsceneAt && r.leg !== 'hospital';
  const overdue = r.etaSec != null && r.etaSec < 0;
  const points: LngLat[] = r.unit ? [r.unit, r.incident] : [r.incident];

  const state = arrived ? t('liveops.row.onScene')
    : r.leg === 'hospital' ? t('liveops.row.toHospital')
      : r.etaSec == null ? t('liveops.row.enroute')
        : overdue ? t('liveops.row.overdue', { time: `${duration(-r.etaSec)} ${durationUnit(-r.etaSec)}` })
          : t('liveops.row.eta', { time: `${duration(r.etaSec)} ${durationUnit(r.etaSec)}` });

  return (
    <li className={`resprail__row${chasing ? ' is-chasing' : ''}${overdue ? ' is-overdue' : ''}`}
        data-priority={r.priority}>
      <button type="button" className="resprail__main" onClick={() => onPick(r.ref, points)}
              title={t('liveops.row.frame')}>
        <span className="resprail__prio">{r.priority}</span>
        <span className="resprail__body">
          <span className="resprail__title">{kindLabel(r.kind)}</span>
          <span className="resprail__sub">
            {r.callsign}
            {r.zoneName && <> · {r.zoneName}</>}
          </span>
        </span>
        <span className={`resprail__eta${overdue ? ' is-bad' : ''}${arrived ? ' is-good' : ''}`}>
          {arrived ? <Building2 aria-hidden /> : <Timer aria-hidden />}
          {state}
        </span>
      </button>

      <button type="button" className={`resprail__chase${chasing ? ' is-on' : ''}`}
              aria-pressed={chasing}
              title={chasing ? t('liveops.row.release') : t('liveops.row.ride')}
              onClick={() => onChase(r.ref)}>
        <Navigation aria-hidden />
      </button>
    </li>
  );
}

/**
 * A call with nobody assigned.
 *
 * The waiting clock is the whole point: it is the number that only gets worse, and the one
 * the service is judged on. A row here is an instruction, so it opens the dispatch board
 * rather than just moving the camera.
 */
function AlertRow({ a, onPick }: { a: LiveAlert; onPick: (id: string, points: LngLat[]) => void }) {
  return (
    <li className="resprail__row resprail__row--alert" data-priority={a.priority}>
      <button type="button" className="resprail__main" onClick={() => onPick(a.ref, [a.position])}
              title={t('liveops.row.frame')}>
        <span className="resprail__prio">{a.priority}</span>
        <span className="resprail__body">
          <span className="resprail__title">{kindLabel(a.kind)}</span>
          <span className="resprail__sub">
            {a.zoneName ?? t('liveops.row.unknownZone')}
          </span>
        </span>
        <span className="resprail__eta is-bad">
          <AlertTriangle aria-hidden />
          {t('liveops.row.waiting', { time: `${duration(a.waitingSec)} ${durationUnit(a.waitingSec)}` })}
        </span>
      </button>

      <button type="button" className="resprail__chase resprail__chase--dispatch"
              title={t('liveops.row.dispatch')} onClick={() => openIncident(a.ref)}>
        <Ambulance aria-hidden />
      </button>
    </li>
  );
}
