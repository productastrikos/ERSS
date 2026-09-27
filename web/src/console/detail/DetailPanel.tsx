/**
 * The detail panel — every dashboard card opens here (lib/stores/detail.ts).
 *
 * One host, so every detail reads the same: a header that says what is open and how to
 * get back, and a scrolling body. On the Dashboard it takes the right rail's place (the map
 * is never covered); on the wall view it docks over the right edge of the map.
 */

import { ArrowLeft, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import { backDetail, closeDetail, useDetail, useDetailDepth, type DetailTarget } from '../../lib/stores/detail';
import { IncidentDetail } from './IncidentDetail';
import { UnitDetailView } from './UnitDetailView';
import { AutoDispatchDetail } from './AutoDispatchDetail';
import { FeedDetail, HospitalDetail, KpiDetail } from './SummaryDetails';
import './detail.scss';

function heading(target: DetailTarget): string {
  switch (target.kind) {
    case 'incident': return t('detail.head.incident');
    case 'unit': return t('detail.head.unit');
    case 'auto': return t('detail.head.auto');
    case 'hospital': return t('detail.head.hospital');
    case 'kpi': return t('detail.head.kpi');
    case 'feed': return t('detail.head.feed');
    default: return '';
  }
}

export function DetailPanel({ className = '' }: { className?: string }) {
  const target = useDetail();
  const depth = useDetailDepth();
  if (!target) return null;
  const id = target.kind === 'incident' || target.kind === 'unit' || target.kind === 'hospital' ? target.ref
    : target.kind === 'kpi' ? target.key : target.kind;
  return (
    <aside className={`dtl ${className}`} aria-label={heading(target)}>
      <header className="dtl__bar">
        <button type="button" className="dtl__icon-btn" onClick={depth > 1 ? backDetail : closeDetail}
                title={depth > 1 ? t('detail.back') : t('detail.backToRail')} aria-label={depth > 1 ? t('detail.back') : t('detail.backToRail')}>
          <ArrowLeft aria-hidden />
        </button>
        <span className="dtl__heading">{heading(target)}</span>
        <button type="button" className="dtl__icon-btn" onClick={closeDetail} title={t('common.close')} aria-label={t('common.close')}>
          <X aria-hidden />
        </button>
      </header>
      {/* Keyed by what is open, so moving between two incidents starts each panel fresh. */}
      <div className="dtl__body" key={`${target.kind}:${id}`}>
        {target.kind === 'incident' && <IncidentDetail incidentRef={target.ref} />}
        {target.kind === 'unit' && <UnitDetailView unitRef={target.ref} />}
        {target.kind === 'auto' && <AutoDispatchDetail />}
        {target.kind === 'hospital' && <HospitalDetail hospitalRef={target.ref} />}
        {target.kind === 'kpi' && <KpiDetail kpi={target.key} />}
        {target.kind === 'feed' && <FeedDetail />}
      </div>
    </aside>
  );
}
