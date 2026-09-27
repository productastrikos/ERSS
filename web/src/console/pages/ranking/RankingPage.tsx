/**
 * Ranking — Pillar 2. docs/06 §5, docs/08 §2.3.
 *
 * The league table, the published weights as factor bars, a composite-score chart, and a
 * one-zone re-baseline preview.
 *
 * The prediction here is earned rather than invented: the same engine is run twice, over
 * this window and over the window immediately before it, and each zone's composite is
 * projected forward by its own damped window-over-window change. That is a real
 * out-of-sample statement ("on this trajectory, this zone scores X next window") and it is
 * labelled as exactly that, with no pretence of a fitted model behind it.
 */

import { useEffect, useState } from 'react';
import { Trophy, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, Segmented, Meter, Chip, EmptyState, ErrorState, Skeleton, Button } from '../../../shared/ui';
import { BarList, FactorBars, ForecastNote, PredictionLegend } from '../../../shared/charts';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue } from '../../../shared/filters/actions';
import { type ChartFilters, useFilters, filterKey, windowDays } from '../../../lib/filters';
import { decimal1 } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import '../pillar.scss';

type Level = 'emirate' | 'sector' | 'community' | 'beat';

interface ZoneRow {
  zoneId: string; zoneRef: string; zoneName: string; level: string; class: string;
  sampleN: number; composite: number | null; rank: number | null; peerGroupSize?: number;
  rankDelta?: number | null; insufficientData: boolean;
  components: Record<string, { value: number; norm: number; weight: number }>;
}
interface RankingResult {
  value: { zones: ZoneRow[]; weights: Record<string, number> };
  factors: Array<{ name: string; contribution: number; direction?: 'up' | 'down'; detail?: string }>;
  window: { from: string; to: string };
  caveats: string[];
}

/** Each zone's projected composite, from its own damped change between the two windows. */
interface Projection { predicted: number | null; changePct: number | null }

const DAMPING = 0.7;

export function RankingPage() {
  const f = useFilters();
  const [level, setLevel] = useState<Level>('community');
  const [result, setResult] = useState<{ request: string; data: RankingResult | null; prior: RankingResult | null; error: string | null } | null>(null);
  const [rebaselineZone, setRebaselineZone] = useState('');
  const [availPreview, setAvailPreview] = useState(80);
  const [rebaseline, setRebaseline] = useState<{ before: number | null; after: number | null; delta: number | null } | null>(null);
  const [rebaselineError, setRebaselineError] = useState<string | null>(null);

  const days = windowDays(f);
  const request = `${level}#${filterKey(f)}`;

  useEffect(() => {
    let cancelled = false;
    // The ranking engine takes an explicit window, so the filter's window is resolved to
    // instants here; the prior window is the same length, immediately before it.
    const to = f.to ? new Date(`${f.to}T23:59:59+04:00`) : new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const priorTo = from;
    const priorFrom = new Date(from.getTime() - days * 86_400_000);
    Promise.all([
      api.ranking.get({ level, from: from.toISOString(), to: to.toISOString() }),
      api.ranking.get({ level, from: priorFrom.toISOString(), to: priorTo.toISOString() }).catch(() => null),
    ])
      .then(([now, was]) => {
        if (!cancelled) setResult({ request, data: now as unknown as RankingResult, prior: was as unknown as RankingResult | null, error: null });
      })
      .catch((e: { message?: string }) => { if (!cancelled) setResult({ request, data: null, prior: null, error: e.message ?? 'Failed to load ranking' }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const data = result?.data ?? null;
  const prior = result?.prior ?? null;
  const loading = result?.request !== request && data == null;
  const stale = result?.request !== request && data != null;
  const error = result?.request === request ? result.error : null;

  const zones = data?.value.zones ?? [];
  // Rank is scoped to a peer group (same level, same zone class) — grouping by class
  // before rank keeps every "#1" visually together with its own peer group, rather than
  // six unrelated #1s appearing to tie.
  const ranked = zones.filter((z) => !z.insufficientData)
    .sort((a, b) => a.class.localeCompare(b.class) || (a.rank ?? 999) - (b.rank ?? 999));
  const unranked = zones.filter((z) => z.insufficientData);

  const priorByZone = new Map((prior?.value.zones ?? []).map((z) => [z.zoneId, z]));
  const project = (z: ZoneRow): Projection => {
    const was = priorByZone.get(z.zoneId)?.composite ?? null;
    if (z.composite == null || was == null || was === 0) return { predicted: null, changePct: null };
    const damped = 1 + ((z.composite / was) - 1) * DAMPING;
    return {
      predicted: Math.max(0, Math.min(100, Math.round(z.composite * damped * 10) / 10)),
      changePct: Math.round((damped - 1) * 1000) / 10,
    };
  };

  async function runRebaseline() {
    if (!rebaselineZone || !data) return;
    try {
      const r = await api.ranking.rebaseline({
        level, from: data.window.from, to: data.window.to, zoneId: rebaselineZone,
        overrides: { unitAvailabilityPct: availPreview / 100 },
      }) as unknown as { before: number | null; after: number | null; delta: number | null };
      setRebaseline(r);
      setRebaselineError(null);
    } catch (e) {
      setRebaseline(null);
      setRebaselineError((e as Error).message ?? 'Re-baseline failed');
    }
  }

  return (
    <div className={`pillar${stale ? ' is-stale' : ''}`}>
      <div className="pillar__head">
        <h1 className="pillar__title"><Trophy aria-hidden /> {t('ranking.title')}</h1>
        <Segmented value={level} onChange={setLevel} ariaLabel="Zone level"
          options={[{ value: 'sector', label: 'Sector' }, { value: 'community', label: 'Community' }, { value: 'beat', label: 'Beat' }]} />
      </div>
      <p className="pillar__sub">{t('ranking.sub', { days })}</p>

      <FilterBar hidden={RANKING_HIDDEN} note={t('ranking.filterNote')} />

      {error && <ErrorState body={error} onRetry={() => setLevel((l) => l)} />}

      <div className="pillar__grid">
        <Card title={t('ranking.scores')} subtitle={t('chart.clickToFilter')} className="pillar__span2"
              actions={<PredictionLegend interval={0} />} simulated>
          {loading ? <Skeleton height={200} /> : ranked.length === 0 ? (
            <EmptyState title={t('ranking.noRanked')} body={t('ranking.noRankedBody')} />
          ) : (
            <>
              <BarList
                items={ranked.slice(0, 15).map((z) => {
                  const p = project(z);
                  return {
                    key: z.zoneRef,
                    label: `${z.rank ? `#${z.rank} ` : ''}${z.zoneName}`,
                    value: z.composite ?? 0,
                    predicted: f.predict ? p.predicted : null,
                    changePct: f.predict ? p.changePct : null,
                    detail: `${z.class} · n=${z.sampleN}${priorByZone.has(z.zoneId) ? ` · was ${decimal1(priorByZone.get(z.zoneId)!.composite)}` : ''}`,
                  };
                })}
                format={(v) => decimal1(v)}
                showPredicted={f.predict}
                selected={f.zone}
                onSelect={(v) => toggleValue(f, 'zone', v)} />
              <ForecastNote meta={{
                method: prior
                  ? t('ranking.method', { days, damping: DAMPING })
                  : t('ranking.methodNoPrior'),
                caveats: prior ? [] : [t('ranking.noPriorCaveat')],
              }}  show={f.predict} />
            </>
          )}
        </Card>

        <Card title={t('ranking.league')} className="pillar__span2" simulated>
          {loading ? <Skeleton height={280} /> : ranked.length === 0 ? (
            <EmptyState title={t('ranking.noRanked')} />
          ) : (
            <table className="pillar__table">
              <thead>
                <tr>
                  <th>#</th><th>Zone</th><th>Class</th><th>Score</th>
                  {f.predict && <th>{t('ranking.projected')}</th>}
                  <th>Trend</th><th>n</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((z) => {
                  const p = project(z);
                  return (
                    <tr key={z.zoneId} onClick={() => setRebaselineZone(z.zoneId)} className={rebaselineZone === z.zoneId ? 'is-selected' : ''}>
                      <td className="mono">{z.rank}</td>
                      <td>{z.zoneName}</td>
                      <td><Chip tone="neutral">{z.class}</Chip></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' }}>
                          <Meter value={(z.composite ?? 0) / 100} />
                          <span className="mono">{decimal1(z.composite)}</span>
                        </div>
                      </td>
                      {f.predict && (
                        <td className="mono is-predicted" title={t('ranking.projectedTitle', { days })}>
                          {p.predicted != null ? decimal1(p.predicted) : '—'}
                          {p.changePct != null && <span className="pillar__muted"> ({p.changePct >= 0 ? '+' : ''}{p.changePct}%)</span>}
                        </td>
                      )}
                      <td>
                        {z.rankDelta == null ? <Minus size={14} aria-hidden /> : z.rankDelta > 0
                          ? <span className="is-good"><ArrowUp size={14} aria-hidden /> {z.rankDelta}</span>
                          : z.rankDelta < 0 ? <span className="is-bad"><ArrowDown size={14} aria-hidden /> {Math.abs(z.rankDelta)}</span>
                            : <Minus size={14} aria-hidden />}
                      </td>
                      <td className="mono">{z.sampleN}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {unranked.length > 0 && (
            <p className="pillar__footnote">{t('ranking.belowFloor', { n: unranked.length, zones: unranked.map((z) => z.zoneName).join(', ') })}</p>
          )}
        </Card>

        <Card title={t('ranking.weights')}>
          {data ? <FactorBars factors={data.factors} /> : <Skeleton height={140} />}
          <p className="pillar__footnote">{t('ranking.weightsNote')}</p>
        </Card>

        <Card title={t('ranking.rebaseline')} subtitle={t('ranking.rebaselineSub')}>
          {ranked.length === 0 ? <EmptyState title={t('ranking.pickZone')} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-10)' }}>
              <div>Zone: <strong>{ranked.find((z) => z.zoneId === rebaselineZone)?.zoneName ?? t('ranking.clickRow')}</strong></div>
              <label className="pillar__slider">
                {t('ranking.availability')} <span className="mono">{availPreview}%</span>
                <input type="range" min={30} max={100} value={availPreview} onChange={(e) => setAvailPreview(+e.target.value)} />
              </label>
              <Button variant="primary" size="sm" disabled={!rebaselineZone} onClick={() => void runRebaseline()}>{t('ranking.preview')}</Button>
              {rebaseline && (
                <div className="pillar__result">
                  <Chip tone="neutral">before {decimal1(rebaseline.before)}</Chip>
                  <Chip tone={((rebaseline.delta ?? 0) >= 0) ? 'success' : 'danger'}>
                    after {decimal1(rebaseline.after)} ({(rebaseline.delta ?? 0) >= 0 ? '+' : ''}{decimal1(rebaseline.delta)})
                  </Chip>
                </div>
              )}
              {rebaselineError && <ErrorState body={rebaselineError} />}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The ranking engine takes a window and a level; it does not slice by call attributes. */
const RANKING_HIDDEN: Array<keyof ChartFilters> = [
  'kind', 'priority', 'source', 'outcome', 'zoneClass', 'unitKind', 'agency', 'station',
  'complaint', 'escalation', 'dow', 'hourFrom', 'floorMin', 'acuityMin', 'responseMinSec',
  'withinTarget', 'highrise', 'transported', 'multiAgency',
];
