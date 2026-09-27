/**
 * Popups for operational layers. Incidents have none on purpose — selecting one opens
 * the page's detail panel. A unit gets a card with its assignment and a follow toggle
 * (docs/06 §2.2).
 */

import { Crosshair, LocateOff, Navigation } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { count, duration, relative, UNIT_KIND_LABEL, UNIT_STATUS_LABEL } from '../../../lib/format';
import { openIncident } from '../../../lib/router';
import { Button, Chip } from '../../ui';
import { PopupBody } from '../MapPopup';
import { setFollow, useMapView, type PopupProps } from '../layerRegistry';
import type { UnitPoint } from '../layers/units';
import type { LiveAlert, LiveResponse } from '../layers/liveResponse';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'info' | 'accent' | 'neutral' | 'danger'> = {
  available: 'success', standby: 'success', relocating: 'info',
  assigned: 'warning', responding: 'warning', on_scene: 'info',
  transporting: 'accent', at_hospital: 'accent', out_of_service: 'danger', off_duty: 'neutral',
};

export function UnitPopup({ selection, view }: PopupProps) {
  const u = selection.data as UnitPoint;
  const follow = useMapView(view).follow;
  const following = follow?.layerId === 'units' && follow.id === u.ref;

  return (
    <PopupBody
      eyebrow={`${u.agencyName} · ${UNIT_KIND_LABEL[u.kind] ?? u.kind}`}
      title={u.callsign}
      chips={<Chip tone={STATUS_TONE[u.status] ?? 'neutral'}>{UNIT_STATUS_LABEL[u.status] ?? u.status}</Chip>}
      rows={[
        u.currentAssignmentRef ? [t('map.field.assignment'), <span className="map-popup__mono">{u.currentAssignmentRef}</span>] : null,
        [t('map.field.crew'), count(u.crewSize)],
        u.speed != null && [t('map.field.speed'), `${count(u.speed)} km/h`],
        u.lastSeenAt ? [t('map.field.lastSeen'), relative(u.lastSeenAt)] : null,
      ]}
    >
      <Button size="sm" variant={following ? 'primary' : 'secondary'} block
              onClick={() => setFollow(view, following ? null : { layerId: 'units', id: u.ref })}>
        {following ? <LocateOff aria-hidden /> : <Crosshair aria-hidden />}
        {following ? t('map.action.unfollow') : t('map.action.follow')}
      </Button>
    </PopupBody>
  );
}

/**
 * A live response, or a call still waiting for one.
 *
 * The same popup serves both because they are the same question at two stages: this is
 * the call, this is who is going, this is when they get there. When nobody is going yet,
 * the popup says so in the place the ETA would have been — an absence the operator has to
 * see, not infer from a missing row.
 */
export function LiveResponsePopup({ selection, view }: PopupProps) {
  const follow = useMapView(view).follow;

  if (selection.kind === 'alert') {
    const a = selection.data as LiveAlert;
    return (
      <PopupBody
        eyebrow={a.zoneName ?? t('map.popup.liveCall')}
        title={t(`kind.${a.kind}`)}
        chips={<Chip tone={a.priority === 'P1' ? 'danger' : a.priority === 'P2' ? 'warning' : 'neutral'}>{a.priority}</Chip>}
        rows={[
          [t('map.field.incident'), <span className="map-popup__mono">{a.ref}</span>],
          [t('map.popup.waiting'), duration(a.waitingSec)],
          [t('map.popup.assigned'), <span className="is-bad">{t('map.popup.nobody')}</span>],
        ]}
      >
        <Button size="sm" variant="primary" block onClick={() => openIncident(a.ref)}>
          {t('map.popup.dispatchIt')}
        </Button>
      </PopupBody>
    );
  }

  const r = selection.data as LiveResponse;
  const following = follow?.layerId === 'live' && follow.id === r.ref;
  const eta = r.onsceneAt ? t('map.popup.arrived')
    : r.etaSec == null ? '—'
      : r.etaSec < 0 ? `${duration(-r.etaSec)} ${t('map.popup.overdue')}` : duration(r.etaSec);

  return (
    <PopupBody
      eyebrow={`${r.callsign} · ${UNIT_KIND_LABEL[r.unitKind] ?? r.unitKind}`}
      title={t(`kind.${r.kind}`)}
      chips={<Chip tone={r.priority === 'P1' ? 'danger' : r.priority === 'P2' ? 'warning' : 'neutral'}>{r.priority}</Chip>}
      rows={[
        [t('map.field.incident'), <span className="map-popup__mono">{r.incidentRef}</span>],
        r.zoneName ? [t('map.field.zone'), r.zoneName] : null,
        [t('map.popup.eta'), <span className={r.etaSec != null && r.etaSec < 0 ? 'is-bad' : undefined}>{eta}</span>],
        r.leg === 'hospital' && r.hospital ? [t('map.popup.toHospital'), r.hospital.name] : null,
      ]}
    >
      <Button size="sm" variant={following ? 'primary' : 'secondary'} block
              onClick={() => setFollow(view, following ? null : { layerId: 'live', id: r.ref })}>
        {following ? <LocateOff aria-hidden /> : <Navigation aria-hidden />}
        {following ? t('map.action.unfollow') : t('map.action.followVehicle')}
      </Button>
      <Button size="sm" variant="ghost" block onClick={() => openIncident(r.incidentRef)}>
        {t('map.popup.openIncident')}
      </Button>
    </PopupBody>
  );
}
