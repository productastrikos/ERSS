/**
 * Executive — Pillar 6. docs/06 §8.
 *
 * One screen for a commander: today's KPI strip, the two trends the service is actually
 * judged on (volume and median response, each with the days ahead forecast), and one live
 * tile from each of the other five pillars.
 *
 * It reads the same universal filter as every other page, so an executive who filtered to
 * P1 on Performance sees the P1 picture here without setting anything again.
 */

import { useEffect, useState } from 'react';
import { LayoutDashboard, Crown } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, EmptyState, Skeleton, Chip, ErrorState } from '../../../shared/ui';
import { StatTile, LineChart, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortDay } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { useFilters, filterKey, toQuery, windowDays, horizonDays } from '../../../lib/filters';
import { duration, pct, decimal1, count as fmtCount, durationUnit } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import type { DailyResult, KpiToday, PerformanceResult } from '../../../lib/types';
import '../pillar.scss';

interface RankingZone { zoneName: string; composite: number | null; rank: number | null }
interface AdvisoryRow { severity: string; state: string }
interface CoverageResult { value: { currentPct: number; gapPp: number } | null }
interface PreemptResult { value: { grantPct: number; meanSavedSec: number } | null }
interface DemandAccuracy { accuracy: { mae: number; intervalCoveragePct: number } | null }

interface Loaded {
  request: string;
  kpi: KpiToday | null;
  daily: DailyResult | null;
  performance: PerformanceResult | null;
  ranking: RankingZone[] | null;
  advisories: AdvisoryRow[] | null;
  coverage: CoverageResult | null;
  preempt: PreemptResult | null;
  demand: DemandAccuracy | null;
  error: string | null;
}

export function ExecutivePage() {
  const f = useFilters();
  const [state, setState] = useState<Loaded | null>(null);
  const request = filterKey(f);

  useEffect(() => {
    let cancelled = false;
    const q = toQuery(f);
    const days = windowDays(f);
    const ahead = horizonDays(f);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const soft = <T,>(p: Promise<T>) => p.then((v) => v).catch(() => null);

    Promise.all([
      soft(api.kpiToday()),
      soft(api.insights.daily({ days, ahead }, q)),
      soft(api.insights.performance({ days, ahead }, q)),
      soft(api.ranking.get({ level: 'community', from, to })),
      soft(api.advisories.list()),
      soft(api.analytics.coverage(q)),
      soft(api.analytics.preempt(q)),
      soft(api.analytics.demand({ hours: 24, days: 30 }, q)),
    ]).then(([kpi, daily, performance, ranking, advisories, coverage, preempt, demand]) => {
      if (cancelled) return;
      const zones = ranking ? (ranking as unknown as { value: { zones: RankingZone[] } }).value.zones : null;
      setState({
        request,
        kpi,
        daily: daily as DailyResult | null,
        performance: performance as PerformanceResult | null,
        ranking: zones ? zones.filter((z) => z.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)) : null,
        advisories: advisories as unknown as AdvisoryRow[] | null,
        coverage: coverage as unknown as CoverageResult | null,
        preempt: preempt as unknown as PreemptResult | null,
        demand: demand as unknown as DemandAccuracy | null,
        error: null,
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // The previous answer stays visible (dimmed) while a filter change is in flight.
  const s = state;
  const loading = state?.request !== request && state == null;
  const stale = state != null && state.request !== request;

  const openCount = (s?.advisories ?? []).filter((a) => !['closed', 'dismissed'].includes(a.state)).length;
  const emergencyCount = (s?.advisories ?? []).filter((a) => a.severity === 'emergency' && !['closed', 'dismissed'].includes(a.state)).length;

  const volume = buildTrend([{
    name: t('kpi.calls'),
    actual: s?.daily?.series ?? [],
    forecast: f.predict ? s?.daily?.forecast : undefined,
    labelKey: 'day', valueKey: 'calls', interval: f.interval,
  }]);
  const response = buildTrend([{
    name: t('kpi.responseP50'),
    actual: s?.performance?.trend ?? [],
    forecast: f.predict ? s?.performance?.forecast.p50Sec : undefined,
    labelKey: 'day', valueKey: 'p50Sec', tone: 'var(--series-3)', interval: f.interval,
  }]);

  return (
    <div className={`pillar${stale ? ' is-stale' : ''}`}>
      <div className="pillar__head">
        <h1 className="pillar__title"><LayoutDashboard aria-hidden /> {t('exec.title')}</h1>
      </div>
      <p className="pillar__sub">{t('exec.sub')}</p>

      <FilterBar />

      {s?.error && <ErrorState body={s.error} />}

      {/* The KPI row reads from the SAME filtered window as the charts below it. It used
          to read `kpiToday`, which ignores the filter — under a filter bar that is a lie,
          because the row and the chart beneath it would disagree about what is being
          shown. Today's own standing is the `sub` line, and units on duty is explicitly
          marked live, because a fleet count has no historical window to be filtered by. */}
      {loading || !s?.performance ? <Skeleton height={90} /> : (
        <div className="pillar__kpirow">
          <Card><StatTile label={t('exec.calls')} value={fmtCount(s.performance.totals.calls)} unit="calls"
            sub={s.daily?.partialDay ? t('exec.todaySoFar', { n: fmtCount(s.daily.partialDay.calls) }) : undefined}
            spark={s.daily?.series.map((x) => x.calls)}
            sparkForecast={f.predict ? s.daily?.forecast.map((x) => x.calls) : undefined} /></Card>
          <Card><StatTile label={t('collab.medianResponse')} value={duration(s.performance.totals.p50Sec)} unit={durationUnit(s.performance.totals.p50Sec)}
            sub={s.performance.partialDay ? t('exec.todayRunning', { time: `${duration(s.performance.partialDay.p50Sec)} ${durationUnit(s.performance.partialDay.p50Sec)}` }) : undefined}
            predicted={f.predict && s.performance.forecast.p50Sec.at(-1) ? `${duration(s.performance.forecast.p50Sec.at(-1)!.p50Sec)} ${durationUnit(s.performance.forecast.p50Sec.at(-1)!.p50Sec)}` : undefined}
            predictedLabel={s.performance.forecast.p50Sec.at(-1) ? t('chart.by', { day: shortDay(s.performance.forecast.p50Sec.at(-1)!.day) }) : undefined} /></Card>
          <Card><StatTile label={t('kpi.withinTarget')} value={pct(s.performance.totals.withinTargetPct)} unit="of responses"
            predicted={f.predict && s.performance.forecast.withinTargetPct.at(-1) ? pct(s.performance.forecast.withinTargetPct.at(-1)!.withinTargetPct) : undefined}
            predictedLabel={s.performance.forecast.withinTargetPct.at(-1) ? t('chart.by', { day: shortDay(s.performance.forecast.withinTargetPct.at(-1)!.day) }) : undefined} /></Card>
          <Card><StatTile label={t('exec.unitsOnDuty')} value={fmtCount(s.kpi?.unitsOnDuty ?? 0)} unit={`of ${fmtCount(s.kpi?.unitsTotal ?? 0)} ambulances`} sub={t('exec.liveNow')} /></Card>
        </div>
      )}

      <div className="pillar__grid">
        <Card title={t('exec.volumeTrend')} subtitle={t('exec.volumeSub')}
              actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
          {loading || !s?.daily ? <Skeleton height={150} /> : (
            <>
              <LineChart series={volume.series} height={150} xLabels={(x) => shortDay(volume.labels[x] ?? '')}
                         forecastFromX={f.predict ? volume.forecastFromX : null} />
              <ForecastNote meta={s.daily.forecastMeta} horizon={s.daily.forecast.length} unit={t('insights.overview.days')}  show={f.predict} />
              <FilterNote filters={s.daily.filters} />
            </>
          )}
        </Card>

        <Card title={t('exec.responseTrend')} subtitle={t('exec.responseSub')}>
          {loading || !s?.performance ? <Skeleton height={150} /> : (
            <>
              <LineChart series={response.series} height={150} yFormat={(v) => duration(Math.round(v))}
                         xLabels={(x) => shortDay(response.labels[x] ?? '')}
                         forecastFromX={f.predict ? response.forecastFromX : null}
                         target={480} targetLabel={t('exec.p1Target')} />
              <ForecastNote meta={s.performance.forecast.meta} horizon={s.performance.forecast.p50Sec.length} unit={t('insights.overview.days')}  show={f.predict} />
            </>
          )}
        </Card>

        <Card title={t('exec.advisories')} subtitle={t('exec.advisoriesSub')}>
          {loading ? <Skeleton height={80} /> : (
            <div style={{ display: 'flex', gap: 'var(--sp-8)', alignItems: 'center' }}>
              <StatTile label={t('exec.open')} value={fmtCount(openCount)} unit="advisories" />
              {emergencyCount > 0 && <Chip tone="danger">{emergencyCount} emergency</Chip>}
            </div>
          )}
        </Card>

        <Card title={t('exec.ranking')} subtitle={t('exec.rankingSub')}>
          {loading ? <Skeleton height={100} /> : !s?.ranking?.length ? <EmptyState title={t('ranking.noRanked')} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)' }}>
                <Crown size={14} aria-hidden style={{ color: 'var(--app-accent)' }} /> {s.ranking[0]?.zoneName} — {decimal1(s.ranking[0]?.composite ?? null)}
              </div>
              <div style={{ color: 'var(--app-text-faint)' }}>▾ {s.ranking.at(-1)?.zoneName} — {decimal1(s.ranking.at(-1)?.composite ?? null)}</div>
            </div>
          )}
        </Card>

        <Card title={t('exec.coverage')} subtitle={t('exec.coverageSub')}>
          {loading ? <Skeleton height={80} /> : !s?.coverage?.value ? <EmptyState title={t('analytics.coverage.insufficient')} /> : (
            <StatTile label={t('exec.currentVsAchievable')} value={pct(s.coverage.value.currentPct)} unit="of demand covered"
                      sub={`gap ${decimal1(s.coverage.value.gapPp)}pp`} deltaGood={s.coverage.value.gapPp < 5} />
          )}
        </Card>

        <Card title={t('exec.preempt')} subtitle={t('exec.preemptSub')}>
          {loading ? <Skeleton height={80} /> : !s?.preempt?.value ? <EmptyState title={t('analytics.preempt.none')} /> : (
            <StatTile label={t('analytics.preempt.grantRate')} value={pct(s.preempt.value.grantPct)} unit="granted"
                      sub={t('exec.meanSaving', { n: Math.round(s.preempt.value.meanSavedSec) })} />
          )}
        </Card>

        <Card title={t('exec.demand')} subtitle={t('exec.demandSub')}>
          {loading ? <Skeleton height={80} /> : !s?.demand?.accuracy ? <EmptyState title={t('analytics.demand.noHistory')} /> : (
            <StatTile label={t('analytics.demand.coverage')} value={pct(s.demand.accuracy.intervalCoveragePct)} unit="inside interval"
                      sub={`MAE ${decimal1(s.demand.accuracy.mae)} calls/hr`} />
          )}
        </Card>
      </div>

      <p className="pillar__footnote">{t('exec.notBuilt')}</p>
    </div>
  );
}
