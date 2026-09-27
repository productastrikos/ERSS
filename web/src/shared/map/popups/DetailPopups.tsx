/**
 * Popups for detail geometry — replaces the inline-HTML `setHTML` popups in DSOMap.tsx
 * (road, POI) and the building/infrastructure side-panel hand-offs.
 */

import { ExternalLink } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { Chip } from '../../ui';
import { PopupBody } from '../MapPopup';
import type { PopupProps } from '../layerRegistry';
import type { DetailPoint } from '../layers/detail';

type Props = Record<string, string | number | null>;

const humanise = (s: unknown) => (s == null || s === '' ? '—' : String(s).replace(/_/g, ' '));
const present = (v: unknown): v is string | number => v != null && v !== '' && v !== 'null';

/** One descriptor draws four kinds of feature; each gets its own popup. */
export function DetailPopup(props: PopupProps) {
  switch (props.selection.kind) {
    case 'road': return <RoadPopup {...props} />;
    case 'building': return <BuildingPopup {...props} />;
    case 'poi': return <PoiPopup {...props} />;
    default: return <InfrastructurePopup {...props} />;
  }
}

function RoadPopup({ selection }: PopupProps) {
  const p = selection.data as Props;
  const structure = p.bridge === 'yes' ? t('map.detail.bridge') : p.tunnel === 'yes' ? t('map.detail.tunnel') : null;
  return (
    <PopupBody
      eyebrow={humanise(p.highway)}
      title={present(p.name) ? p.name : present(p.ref) ? p.ref : t('map.detail.unnamedRoad')}
      chips={<>
        {p.oneway === 'yes' && <Chip>{t('map.detail.oneWay')}</Chip>}
        {structure && <Chip>{structure}</Chip>}
      </>}
      rows={[
        present(p.ref) ? [t('map.detail.reference'), String(p.ref)] : null,
        present(p.maxspeed) ? [t('map.detail.speedLimit'), `${p.maxspeed} km/h`] : null,
        present(p.lanes) ? [t('map.detail.lanes'), String(p.lanes)] : null,
        present(p.surface) ? [t('map.detail.surface'), humanise(p.surface)] : null,
      ]}
    />
  );
}

function BuildingPopup({ selection }: PopupProps) {
  const p = selection.data as Props;
  const levels = present(p.levels) ? Number(p.levels) : null;
  const height = present(p.height) ? Number(p.height) : levels ? levels * 3 : null;
  const address = [p.housenumber, p.street].filter(present).join(' ');
  return (
    <PopupBody
      eyebrow={humanise(p.building_use ?? p.building)}
      title={present(p.name) ? p.name : address || t('map.detail.unnamedBuilding')}
      rows={[
        levels != null ? [t('map.field.floors'), String(levels)] : null,
        height != null ? [t('map.detail.height'), `${Math.round(height)} m`] : null,
        address && present(p.name) ? [t('map.detail.address'), address] : null,
        present(p.operator) ? [t('map.detail.operator'), String(p.operator)] : null,
      ]}
    />
  );
}

function PoiPopup({ selection }: PopupProps) {
  const point = selection.data as DetailPoint;
  const p = point.props;
  const website = present(p.website) ? String(p.website) : null;
  return (
    <PopupBody
      eyebrow={humanise(point.category)}
      title={present(p.name) ? p.name : humanise(point.category)}
      rows={[
        present(p.operator) ? [t('map.detail.operator'), String(p.operator)] : null,
        present(p.phone) ? [t('map.detail.phone'), String(p.phone)] : null,
        present(p.cuisine) ? [t('map.detail.cuisine'), humanise(p.cuisine)] : null,
        website ? [t('map.detail.website'), (
          <a href={website} target="_blank" rel="noopener noreferrer" className="map-popup__link">
            {website.replace(/^https?:\/\/(www\.)?/, '')} <ExternalLink aria-hidden />
          </a>
        )] : null,
      ]}
    />
  );
}

function InfrastructurePopup({ selection }: PopupProps) {
  const point = selection.data as DetailPoint;
  const p = point.props;
  return (
    <PopupBody
      eyebrow={t('map.detail.infrastructure')}
      title={present(p.name) ? p.name : humanise(point.category)}
      chips={<Chip>{humanise(point.category)}</Chip>}
      rows={[
        present(p.ref) ? [t('map.detail.reference'), String(p.ref)] : null,
        present(p.operator) ? [t('map.detail.operator'), String(p.operator)] : null,
        present(p.voltage) ? [t('map.detail.voltage'), `${p.voltage} V`] : null,
        present(p.height) ? [t('map.detail.height'), `${p.height} m`] : null,
        present(p.description) ? [t('map.detail.description'), String(p.description)] : null,
      ]}
    />
  );
}
