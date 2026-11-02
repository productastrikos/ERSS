/**
 * The detail drawer — every dashboard card, map click and the incident director open here
 * (lib/stores/detail.ts).
 *
 * A full-height slide-over from the right edge, between the header and the status bar. It
 * OVERLAPS the page rather than taking a slot in it: the rail and the edge of the map stay
 * where they are underneath, and closing the drawer slides it away to reveal them. While it
 * is closed, a tab on the right edge brings back what was last open — or, if nothing was,
 * the incident the map is following — so the AI's reasoning is always one click away.
 *
 * One host, so every detail reads the same: a header that says what is open and how to
 * get back, and a scrolling body.
 */

import { useEffect } from 'react';
import { ArrowLeft, BrainCircuit, ChevronLeft, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import {
  backDetail, closeDetail, closedDetail, reopenDetail, useDetailDrawer, type DetailTarget,
} from '../../lib/stores/detail';
import { useDirector } from '../../lib/stores/director';
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

const idOf = (target: DetailTarget) => (target.kind === 'incident' || target.kind === 'unit' || target.kind === 'hospital' ? target.ref
  : target.kind === 'kpi' ? target.key : target.kind);

function tabLabel(target: DetailTarget): string {
  if (target.kind === 'incident') return `${t('detail.tab.incident')} · ${target.ref.replace(/^INC-\d{6}-/, '#')}`;
  return heading(target);
}

export function DetailDrawer() {
  const { target, depth, closing, last } = useDetailDrawer();
  const director = useDirector();
  const shown = target ?? closing;

  // Esc closes the drawer, as it closes every side panel.
  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  // What the edge tab brings back: the last thing open, else the incident being followed.
  const reopen: DetailTarget | null = last ?? (director.ref ? { kind: 'incident', ref: director.ref } : null);

  return (
    <>
      {shown && (
        <aside
          className={`dtl dtl-drawer ${target ? 'is-open' : 'is-closing'}`}
          data-map-occluder="right"
          aria-label={heading(shown)}
          onAnimationEnd={(e) => { if (!target && e.target === e.currentTarget) closedDetail(); }}
        >
          <header className="dtl__bar">
            <button type="button" className="dtl__icon-btn" onClick={backDetail} disabled={!target}
                    title={depth > 1 ? t('detail.back') : t('detail.hide')} aria-label={depth > 1 ? t('detail.back') : t('detail.hide')}>
              <ArrowLeft aria-hidden />
            </button>
            <span className="dtl__heading">
              {shown.kind === 'incident' && <BrainCircuit aria-hidden className="dtl__heading-icon" />}
              {heading(shown)}
            </span>
            <button type="button" className="dtl__icon-btn" onClick={closeDetail} disabled={!target}
                    title={t('detail.hide')} aria-label={t('detail.hide')}>
              <X aria-hidden />
            </button>
          </header>
          {/* Keyed by what is open, so moving between two incidents starts each panel fresh. */}
          <div className="dtl__body" key={`${shown.kind}:${idOf(shown)}`}>
            {shown.kind === 'incident' && <IncidentDetail incidentRef={shown.ref} />}
            {shown.kind === 'unit' && <UnitDetailView unitRef={shown.ref} />}
            {shown.kind === 'auto' && <AutoDispatchDetail />}
            {shown.kind === 'hospital' && <HospitalDetail hospitalRef={shown.ref} />}
            {shown.kind === 'kpi' && <KpiDetail kpi={shown.key} />}
            {shown.kind === 'feed' && <FeedDetail />}
          </div>
        </aside>
      )}

      {!target && !closing && reopen && (
        <button type="button" className="dtl-tab" onClick={() => reopenDetail(reopen)} title={t('detail.reopen')}>
          <ChevronLeft aria-hidden />
          <BrainCircuit aria-hidden className="dtl-tab__ai" />
          <span>{tabLabel(reopen)}</span>
        </button>
      )}
    </>
  );
}
