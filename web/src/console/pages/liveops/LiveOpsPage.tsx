/**
 * Live operations — the wall view.
 *
 * The map fills the window and everything else overlays it. This is the screen a control
 * room leaves up: no charts, no navigation to read, nothing that needs a mouse to
 * understand. The same `LiveOpsMap` the Dashboard embeds, given the whole viewport.
 *
 * The one panel it adds is the recorded corpus (`/api/insights/playbook`): how many
 * responses have been captured, and how complete the record of each one is. It sits here
 * rather than on an analytics page because this is where responses are being generated —
 * the number going up while the operator watches is the point, and a claim that the
 * platform "learns from every response" should be checkable on the screen that makes them.
 */

import { useEffect, useState } from 'react';
import { Database, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { count, decimal1, relative } from '../../../lib/format';
import { navigate } from '../../../lib/router';
import { useLivePolling } from '../../../lib/stores/live';
import { loadIncidents, useQueue, wireIncidentFeed } from '../../../lib/stores/incidents';
import { loadUnits, wireFleetFeed } from '../../../lib/stores/fleet';
import { LiveOpsMap } from '../../../shared/map/live/LiveOpsMap';
import { useDetail } from '../../../lib/stores/detail';
import { DetailPanel } from '../../detail/DetailPanel';
import { Skeleton } from '../../../shared/ui';
import './liveops-page.scss';

interface PlaybookSignal { key: string; label: string; n: number; coveragePct: number | null; note: string }
interface Playbook {
  totals: { responses: number; closed: number; medianRouteDeltaSec: number | null; medianEtaErrorSec: number | null };
  signals: PlaybookSignal[];
  gaps: string[];
  recent: Array<{ ref: string; kind: string; priority: string; reportedAt: string; responseSec: number | null }>;
}

export function LiveOpsPage() {
  useLivePolling();
  const queue = useQueue();
  const [corpus, setCorpus] = useState<Playbook | null>(null);
  const [showCorpus, setShowCorpus] = useState(false);
  const detail = useDetail();

  useEffect(() => {
    wireIncidentFeed();
    wireFleetFeed();
    void loadIncidents();
    void loadUnits();
  }, []);

  // Re-read the corpus as responses close, so the count visibly grows during a demo.
  const closed = queue.items.filter((i) => i.state === 'closed').length;
  useEffect(() => {
    let cancelled = false;
    api.insights.playbook({ limit: 6 })
      .then((p) => { if (!cancelled) setCorpus(p as unknown as Playbook); })
      .catch(() => { /* the map is the page; the corpus panel is extra */ });
    return () => { cancelled = true; };
  }, [closed]);

  return (
    <div className="liveops-page">
      <LiveOpsMap variant="full" onCollapse={() => navigate('/dashboard')} hideRail={!!detail} />
      {detail && <DetailPanel className="liveops-page__detail" />}

      <button type="button" className={`liveops-page__corpus-toggle${showCorpus ? ' is-on' : ''}`}
              onClick={() => setShowCorpus((v) => !v)} title={t('liveops.corpus.toggle')}>
        <Database aria-hidden />
        {corpus ? count(corpus.totals.responses) : '—'}
        <span>{t('liveops.corpus.recorded')}</span>
      </button>

      {showCorpus && (
        <aside className="liveops-page__corpus" aria-label={t('liveops.corpus.title')}>
          <header>
            <Database aria-hidden /> {t('liveops.corpus.title')}
            <button type="button" onClick={() => setShowCorpus(false)} title={t('common.close')}>
              <X aria-hidden />
            </button>
          </header>

          {!corpus ? <Skeleton height={180} /> : (
            <>
              <p className="liveops-page__corpus-lede">{t('liveops.corpus.lede')}</p>

              <ul className="liveops-page__signals">
                {corpus.signals.map((s) => (
                  <li key={s.key} title={s.note}>
                    <span className="liveops-page__signal-label">{s.label}</span>
                    <span className="liveops-page__signal-bar">
                      <span style={{ width: `${Math.min(100, s.coveragePct ?? 100)}%` }}
                            data-thin={s.coveragePct != null && s.coveragePct < 50 ? 'true' : undefined} />
                    </span>
                    <span className="liveops-page__signal-n">
                      {s.coveragePct != null ? `${decimal1(s.coveragePct)}%` : count(s.n)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Named, not buried: a thin signal is a limit on what can be learned from
                  the corpus, and hiding it would make the panel a decoration. */}
              {corpus.gaps.length > 0 && (
                <p className="liveops-page__gaps">
                  <strong>{t('liveops.corpus.gaps')}</strong> {corpus.gaps.join(' · ')}
                </p>
              )}

              <dl className="liveops-page__corpus-stats">
                <div>
                  <dt>{t('liveops.corpus.routeDelta')}</dt>
                  <dd>{corpus.totals.medianRouteDeltaSec != null ? `${corpus.totals.medianRouteDeltaSec}s` : '—'}</dd>
                </div>
                <div>
                  <dt>{t('liveops.corpus.etaError')}</dt>
                  <dd>{corpus.totals.medianEtaErrorSec != null ? `${corpus.totals.medianEtaErrorSec}s` : '—'}</dd>
                </div>
              </dl>

              <div className="liveops-page__recent">
                <span>{t('liveops.corpus.recent')}</span>
                {corpus.recent.map((r) => (
                  <button key={r.ref} type="button" onClick={() => navigate(`/insights/replay?incident=${r.ref}`)}>
                    <em>{r.priority}</em>
                    {t(`kind.${r.kind}`)}
                    <span>{relative(r.reportedAt)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
