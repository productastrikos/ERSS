/**
 * One ambulance — who is aboard, what it carries, where it is going, and its day so far.
 *
 * The crew and the plate come from the DEMO roster (server/data/reference/crews.js) and
 * say so; everything else is live: status and position from the fleet, speed and the road
 * ahead from the drive in progress, the day's jobs from the assignments table.
 *
 * Two cameras, as the trial specifies. The road camera is the sensor the trial is about and
 * can be opened here. The cab camera films staff: under the agreed privacy terms its feed is
 * blurred at source and is not opened from the console, so this panel says that instead of
 * offering a button nobody should press.
 */

import { useState } from 'react';
import {
  Activity, Ambulance, BadgeCheck, Camera, Cctv, Clock, Compass, EyeOff, Gauge, MapPin, Navigation, Package, Route, Siren, TrafficCone, Users,
} from 'lucide-react';
import type { UnitDetail } from '../../lib/types';
import { t } from '../../lib/i18n';
import { duration, durationUnit, UNIT_KIND_LABEL, UNIT_STATUS_LABEL } from '../../lib/format';
import { useNow } from '../../lib/stores/now';
import { useUnitDetail } from '../../lib/stores/unitDetail';
import { openDetail } from '../../lib/stores/detail';
import { requestFollow } from '../../lib/stores/director';
import { Button, CctvFeed, Chip, ErrorState, Skeleton } from '../../shared/ui';

const withUnit = (sec: number | null | undefined) => (sec == null ? '—' : `${duration(sec)} ${durationUnit(sec)}`);
const hours = (sec: number | null | undefined) => (sec == null ? '—' : `${(sec / 3600).toFixed(1)} h`);
const km = (m: number | null | undefined) => (m == null ? '—' : `${(Math.max(0, m) / 1000).toFixed(1)} km`);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A forward camera clip per vehicle, so eight ambulances do not all show one road. */
const ROAD_CLIPS = ['traffic_cctv_1', 'traffic_cctv_2', 'traffic_cctv_3', 'traffic_cctv_4', 'traffic_cctv_5', 'traffic_cctv_6', 'traffic_cctv_7', 'traffic_cctv_8'];
const clipFor = (ref: string) => `/media/${ROAD_CLIPS[[...ref].reduce((s, c) => s + c.charCodeAt(0), 0) % ROAD_CLIPS.length]}.mp4`;

const statusTone = (s: string) => (s === 'available' || s === 'standby' ? 'success'
  : s === 'responding' || s === 'assigned' ? 'accent' : s === 'transporting' || s === 'at_hospital' ? 'info'
    : s === 'on_scene' ? 'warning' : 'neutral');

export function UnitDetailView({ unitRef }: { unitRef: string }) {
  const { data, error } = useUnitDetail(unitRef, 3000);
  if (!data && error) return <ErrorState title={t('detail.unit.error')} body={error} />;
  if (!data) return <div className="dtl__loading"><Skeleton height={100} /><Skeleton height={200} /></div>;
  return <Loaded d={data} />;
}

function Loaded({ d }: { d: UnitDetail }) {
  const now = useNow();
  const [camera, setCamera] = useState(false);
  const u = d.unit;
  const p = d.profile;
  const job = d.job;
  const etaLeft = job?.etaPredictedAt && ['offered', 'acknowledged', 'enroute'].includes(job.state)
    ? Math.round((Date.parse(job.etaPredictedAt) - now) / 1000) : null;
  const jam = job?.trafficAhead?.[0] ?? null;
  const road = p?.cameras.find((c) => c.facing === 'road');
  const cab = p?.cameras.find((c) => c.facing === 'cab');

  return (
    <div className="dtl-unit">
      <header className="dtl-unit__head">
        <span className="dtl-unit__badge"><Ambulance aria-hidden /></span>
        <div className="dtl-unit__id">
          <h3>{u.callsign}</h3>
          <span>{UNIT_KIND_LABEL[u.kind] ?? u.kind} · {u.ref}{p ? ` · ${p.plate}` : ''}</span>
        </div>
        <Chip tone={statusTone(u.status)}>{UNIT_STATUS_LABEL[u.status] ?? u.status}</Chip>
      </header>
      {u.stationName && <div className="dtl-unit__station"><MapPin aria-hidden /> {t('detail.unit.station', { name: u.stationName })}</div>}

      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Activity aria-hidden /> {t('detail.unit.live')} <span className="dtl-live"><span aria-hidden /> {t('detail.live')}</span></h4>
        <div className="dtl-kv dtl-kv--4">
          <div><span><Gauge aria-hidden /> {t('detail.unit.speed')}</span><strong>{d.telemetry.speedKmh}<small> km/h</small></strong></div>
          <div><span><Compass aria-hidden /> {t('detail.unit.heading')}</span><strong>{d.telemetry.heading != null ? `${COMPASS[Math.round(d.telemetry.heading / 45) % 8]} · ${d.telemetry.heading}°` : '—'}</strong></div>
          <div><span><Siren aria-hidden /> {t('detail.unit.lights')}</span><strong className={d.telemetry.lightsAndSiren ? 'is-accent' : ''}>{d.telemetry.lightsAndSiren ? t('detail.unit.on') : t('detail.unit.off')}</strong></div>
          <div>
            <span><Clock aria-hidden /> {d.telemetry.lightsAndSiren ? t('detail.unit.fix') : t('detail.unit.moved')}</span>
            <strong>{d.telemetry.lastFixSecAgo == null ? '—'
              // A parked ambulance does not move, so "last moved 7 min ago" is the honest
              // figure — "last GPS fix 434 s ago" read as a vehicle that had dropped off.
              : !d.telemetry.lightsAndSiren && d.telemetry.lastFixSecAgo > 90 ? t('detail.unit.parked', { m: Math.round(d.telemetry.lastFixSecAgo / 60) })
                : t('detail.unit.ago', { s: d.telemetry.lastFixSecAgo })}</strong>
          </div>
        </div>
      </section>

      {job && (
        <section className="dtl-sec">
          <h4 className="dtl-sec__title"><Navigation aria-hidden /> {t('detail.unit.job')}</h4>
          <button type="button" className="dtl-job" onClick={() => openDetail({ kind: 'incident', ref: job.incidentRef })}>
            <span className={`prio prio--${job.priority}`}>{job.priority}</span>
            <span className="dtl-job__what">
              <strong>{t(`kind.${job.kind}`)}</strong>
              <span>{job.zoneName ?? job.incidentRef} · {t(`asg.state.${job.state}`)}</span>
            </span>
            <span className="dtl-job__ref mono">{job.incidentRef}</span>
          </button>
          <div className="dtl-kv">
            <div><span>{t('detail.inc.eta')}</span><strong className={etaLeft != null && etaLeft < 0 ? 'is-bad' : ''}>{etaLeft == null ? '—' : etaLeft < 0 ? t('detail.inc.late', { t: withUnit(-etaLeft) }) : withUnit(etaLeft)}</strong></div>
            <div><span><Route aria-hidden /> {t('detail.inc.toGo')}</span><strong>{km(job.remainingM)}</strong></div>
            <div>
              <span><TrafficCone aria-hidden /> {t('detail.inc.trafficAhead')}</span>
              <strong className={jam ? 'is-bad' : ''}>{jam ? `${jam.level === 'heavy' ? t('detail.inc.heavy') : t('detail.inc.slow')} · ${Math.round(jam.lengthM)} m · +${duration(jam.delaySec)}` : job.remainingM != null ? t('detail.inc.clear') : '—'}</strong>
            </div>
            {job.hospitalName && <div><span>{t('detail.inc.hospital')}</span><strong>{job.hospitalName}</strong></div>}
          </div>
          {job.remainingM != null && (
            <div className="dtl-actions dtl-actions--inline">
              <Button size="sm" variant="primary" onClick={() => requestFollow(job.assignmentRef)}><Navigation aria-hidden /> {t('detail.followOnMap')}</Button>
            </div>
          )}
        </section>
      )}

      {p && (
        <section className="dtl-sec">
          <h4 className="dtl-sec__title"><Users aria-hidden /> {t('detail.unit.crew')} <Chip tone="neutral">{t('detail.unit.demo')}</Chip></h4>
          <ul className="dtl-people">
            {p.crew.map((m) => (
              <li key={m.staffId}>
                <div className="dtl-people__who">
                  <strong>{m.name}</strong>
                  <span>{m.title} · {m.staffId}</span>
                </div>
                <span className="dtl-people__role">{t(`detail.unit.role.${m.role}`)}</span>
                <div className="dtl-people__certs">
                  {m.certs.map((c) => <span key={c}><BadgeCheck aria-hidden /> {c}</span>)}
                  <span className="muted">{t('detail.unit.years', { n: m.yearsService })}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="dtl-kv">
            <div><span>{t('detail.unit.onShift')}</span><strong>{u.shiftStart ? `${new Date(u.shiftStart).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })} · ${hours(d.today.onShiftSec)}` : '—'}</strong></div>
            <div><span>{t('detail.unit.busy')}</span><strong>{d.today.busyPct == null ? '—' : `${d.today.busyPct}%`}</strong></div>
          </div>
        </section>
      )}

      {p && (
        <section className="dtl-sec">
          <h4 className="dtl-sec__title"><Package aria-hidden /> {t('detail.unit.vehicle')}</h4>
          <div className="dtl-kv dtl-kv--wrap">
            <div><span>{t('detail.unit.model')}</span><strong>{p.vehicle} · {p.year}</strong></div>
            <div><span>{t('detail.unit.plate')}</span><strong className="mono">{p.plate}</strong></div>
          </div>
          <div className="dtl-tags">
            {u.capabilities.map((c) => <span key={c} className="dtl-tags__cap">{c.toUpperCase()}</span>)}
            {p.equipment.map((e) => <span key={e}>{e}</span>)}
          </div>
        </section>
      )}

      {p && (
        <section className="dtl-sec">
          <h4 className="dtl-sec__title"><Cctv aria-hidden /> {t('detail.unit.cameras')}</h4>
          {road && (
            <div className="dtl-cam">
              <div className="dtl-cam__row">
                <Camera aria-hidden />
                <div><strong>{road.name}</strong><span>{road.note}</span></div>
                <Button size="sm" variant="secondary" onClick={() => setCamera((v) => !v)}>{camera ? t('detail.unit.hideCam') : t('detail.unit.viewCam')}</Button>
              </div>
              {camera && <CctvFeed src={clipFor(u.ref)} label={`${u.callsign} · ${road.name}`} className="dtl-cam__feed" />}
            </div>
          )}
          {cab && (
            <div className="dtl-cam is-private">
              <div className="dtl-cam__row">
                <EyeOff aria-hidden />
                <div><strong>{cab.name}</strong><span>{cab.note}</span></div>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Clock aria-hidden /> {t('detail.unit.today')}</h4>
        <div className="dtl-kv dtl-kv--4">
          <div><span>{t('detail.unit.jobs')}</span><strong>{d.today.jobs}</strong></div>
          <div><span>{t('detail.unit.completed')}</span><strong>{d.today.completed}</strong></div>
          <div><span>{t('detail.unit.medianResponse')}</span><strong>{withUnit(d.today.medianResponseSec)}</strong></div>
          <div><span>{t('detail.unit.driven')}</span><strong>{d.today.distanceKm.toFixed(1)}<small> km</small></strong></div>
        </div>
        {d.today.recent.length > 0 && (
          <ul className="dtl-list">
            {d.today.recent.map((j) => (
              <li key={j.assignmentRef}>
                <button type="button" onClick={() => openDetail({ kind: 'incident', ref: j.incidentRef })}>
                  <span className={`prio prio--${j.priority}`}>{j.priority}</span>
                  <span className="dtl-list__main"><strong>{t(`kind.${j.kind}`)}</strong><span>{j.zoneName ?? j.incidentRef}</span></span>
                  <span className="dtl-list__meta mono">{j.responseSec != null ? withUnit(j.responseSec) : t(`asg.state.${j.state}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
