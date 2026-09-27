/**
 * Popups for analytical layers. Each shows the EVIDENCE for what the map is drawing —
 * factor contributions, the interval, the significance test — because an analytic the
 * operator cannot interrogate is one they should not act on (docs/00 D-07).
 */

import { t } from '../../../lib/i18n';
import { confidence, count, dateTime, decimal1, decimal2 } from '../../../lib/format';
import { Chip, Predicted } from '../../ui';
import { PopupBody } from '../MapPopup';
import type { PopupProps } from '../layerRegistry';
import type { RankedRiskCell } from '../layers/risk';
import type { DemandSelection } from '../layers/demand';
import type { ChokePoint } from '../layers/crowd';
import type { HotspotCluster } from '../layers/hotspot';

const humanise = (s: string) => s.replace(/_/g, ' ');

export function RiskCellPopup({ selection }: PopupProps) {
  const c = selection.data as RankedRiskCell;
  const factors = [...c.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 5);
  const total = factors.reduce((s, f) => s + Math.abs(f.contribution), 0) || 1;
  const significant = !!c.gi && c.gi.z > 0 && c.gi.p < 0.05;

  return (
    <PopupBody
      eyebrow={`${t('map.layer.risk')} · ${c.cellRef}`}
      title={t('map.risk.percentile', { pct: Math.round(c.rank * 100) })}
      chips={significant && <Chip tone="danger">{t('map.risk.significant')}</Chip>}
      rows={[
        c.gi ? [t('map.field.giZ'), decimal2(c.gi.z)] : null,
        c.gi ? [t('map.field.pValue'), decimal2(c.gi.p)] : null,
        [t('advisory.confidence'), confidence(c.confidence)],
      ]}
    >
      <div className="map-popup__eyebrow">{t('advisory.factors')}</div>
      {factors.map((f) => (
        <div key={f.name} className="map-popup__factor">
          <div className="map-popup__factor-head">
            <span>{humanise(f.name)}</span>
            <span className="numeric">{decimal2(f.contribution)}</span>
          </div>
          <div className="map-popup__meter">
            <span style={{ width: `${(Math.abs(f.contribution) / total) * 100}%` }} />
          </div>
        </div>
      ))}
      {c.method && <div className="map-popup__note">{c.method}</div>}
    </PopupBody>
  );
}

export function DemandPopup({ selection }: PopupProps) {
  const d = selection.data as DemandSelection;
  return (
    <PopupBody
      eyebrow={`${t('map.layer.demand')} · ${dateTime(d.from)}–${dateTime(d.to)}`}
      title={d.zoneName ?? d.zoneRef}
      rows={[
        [t('map.demand.expected'), <Predicted method={d.method} confidence={d.confidence}>{decimal1(d.predicted)}</Predicted>],
        d.lower80 != null && d.upper80 != null
          ? [t('map.demand.interval'), `${decimal1(d.lower80)} – ${decimal1(d.upper80)}`]
          : null,
        [t('advisory.confidence'), confidence(d.confidence)],
      ]}
    />
  );
}

export function ChokePointPopup({ selection }: PopupProps) {
  const c = selection.data as ChokePoint;
  const tone = c.los === 'F' ? 'danger' : c.los === 'E' ? 'warning' : 'info';
  return (
    <PopupBody
      eyebrow={t('map.crowd.chokePoint')}
      title={c.name}
      chips={<Chip tone={tone}>{t('map.crowd.los', { los: c.los })}</Chip>}
      rows={[
        c.leadTimeMin != null && c.los !== 'F'
          ? [t('map.crowd.leadTime'), <Predicted>{`${Math.round(c.leadTimeMin)} min`}</Predicted>]
          : null,
        c.inflowPerMin != null ? [t('map.crowd.inflow'), `${count(c.inflowPerMin)} /min`] : null,
        c.capacityPerMin != null ? [t('map.crowd.capacity'), `${count(c.capacityPerMin)} /min`] : null,
      ]}
    />
  );
}

export function HotspotPopup({ selection }: PopupProps) {
  const h = selection.data as HotspotCluster;
  const significant = h.p < 0.05;
  return (
    <PopupBody
      eyebrow={t('map.layer.hotspot')}
      title={h.z >= 0 ? t('map.legend.hotSpot') : t('map.legend.coldSpot')}
      chips={<Chip tone={significant ? (h.z >= 0 ? 'danger' : 'info') : 'neutral'}>
        {significant ? t('map.hotspot.significant') : t('map.hotspot.notSignificant')}
      </Chip>}
      rows={[
        [t('map.field.incidents'), count(h.count)],
        [t('map.field.giZ'), decimal2(h.z)],
        [t('map.field.pValue'), decimal2(h.p)],
        [t('map.field.radius'), `${count(h.radiusM)} m`],
      ]}
    />
  );
}
