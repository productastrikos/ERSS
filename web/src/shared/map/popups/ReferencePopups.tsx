/**
 * Popups for reference layers: zones, stations, hospitals, AEDs, Makani entrances.
 * One component per popup kind (docs/02 §5), all on the shared PopupBody layout.
 */

import { t } from '../../../lib/i18n';
import { compact, count, decimal1, makani, pct } from '../../../lib/format';
import type { Aed, Hospital, MakaniPoint } from '../../../lib/types';
import { Chip, SimulatedChip } from '../../ui';
import { PopupBody } from '../MapPopup';
import type { PopupProps } from '../layerRegistry';
import type { ZoneSelection } from '../layers/zones';
import type { StationPoint } from '../layers/facilities';

const humanise = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');

export function ZonePopup({ selection }: PopupProps) {
  const z = selection.data as ZoneSelection;
  return (
    <PopupBody
      eyebrow={`${humanise(z.level)} · ${z.ref}`}
      title={z.name}
      chips={<Chip>{humanise(z.class)}</Chip>}
      rows={[
        z.metricLabel ? [z.metricLabel, `${decimal1(z.metricValue)}${z.metricUnit ?? ''}`] : null,
        [t('map.field.population'), compact(z.population)],
        [t('map.field.populationDaytime'), compact(z.populationDaytime)],
        [t('map.field.area'), z.areaKm2 == null ? '—' : `${decimal1(z.areaKm2)} km²`],
        [t('map.field.highrise'), count(z.highriseCount)],
      ]}
    />
  );
}

export function StationPopup({ selection }: PopupProps) {
  const s = selection.data as StationPoint;
  return (
    <PopupBody
      eyebrow={`${s.agencyName} · ${s.ref}`}
      title={s.name}
      chips={!s.dispatchable && <Chip tone="warning">{t('map.field.unmanned')}</Chip>}
      rows={[
        [t('map.field.kind'), humanise(s.kind)],
        s.bays != null && [t('map.field.bays'), count(s.bays)],
        s.makani ? [t('map.field.makani'), <span className="map-popup__mono">{makani(s.makani)}</span>] : null,
      ]}
    />
  );
}

export function HospitalPopup({ selection }: PopupProps) {
  const h = selection.data as Hospital;
  const load = h.edLoadPct;
  const tone = h.onDiversion ? 'danger' : load != null && load >= 85 ? 'warning' : 'success';
  return (
    <PopupBody
      eyebrow={`${h.operatorClass === 'public' ? t('map.field.public') : t('map.field.private')} · ${h.area ?? h.ref}`}
      title={h.name}
      chips={h.onDiversion && <Chip tone="danger">{t('map.field.onDiversion')}</Chip>}
      rows={[
        [t('map.field.edLoad'), <Chip tone={tone}>{pct(load)}</Chip>],
        [t('map.field.edBeds'), `${count(h.edOccupied)} / ${count(h.edBeds)}`],
      ]}
    >
      {h.capabilities.length > 0 && (
        <div className="map-popup__chips">
          {h.capabilities.map((c) => <Chip key={c}>{humanise(c)}</Chip>)}
        </div>
      )}
    </PopupBody>
  );
}

export function AedPopup({ selection }: PopupProps) {
  const a = selection.data as Aed;
  return (
    <PopupBody
      eyebrow={`${t('map.layer.aeds')} · ${a.ref}`}
      title={a.siteName}
      chips={
        <>
          <Chip tone={a.available ? 'success' : 'neutral'}>
            {a.available ? t('map.legend.aedAvailable') : t('map.legend.aedUnavailable')}
          </Chip>
          {a.telemetry && <Chip tone="info">{t('map.field.telemetry')}</Chip>}
        </>
      }
      rows={[
        [t('map.field.site'), humanise(a.siteKind)],
        a.makani ? [t('map.field.makani'), <span className="map-popup__mono">{makani(a.makani)}</span>] : null,
      ]}
    />
  );
}

export function MakaniPopup({ selection }: PopupProps) {
  const m = selection.data as MakaniPoint;
  return (
    <PopupBody
      eyebrow={t('map.layer.makani')}
      title={<span className="map-popup__mono">{m.formatted || makani(m.makani)}</span>}
      chips={m.simulated && <SimulatedChip />}
      rows={[
        m.buildingName ? [t('map.field.building'), m.buildingName] : null,
        [t('map.field.entrance'), `${count(m.entranceNo)} / ${count(m.entranceCount)}`],
        m.entranceRole ? [t('map.field.entranceRole'), humanise(m.entranceRole)] : null,
        m.floors != null && [t('map.field.floors'), count(m.floors)],
      ]}
    />
  );
}
