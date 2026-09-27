/**
 * Collaborate — Pillar 1. docs/06 §2, docs/08 §2.1.
 *
 * Response-time stage decomposition: where the minutes go, which stages are statistically
 * distinguishable from the emirate baseline, and — the client's universal rule — where each
 * stage is heading, forecast day by day with its interval and its backtest error.
 *
 * The priority segmented control that used to live here is gone: priority is a dimension of
 * the universal filter now (shared/filters/FilterBar.tsx), so filtering to P1 here means
 * the same thing, and carries over, everywhere else.
 */

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, Segmented, EmptyState, ErrorState, Skeleton, Chip } from '../../../shared/ui';
import { BarList, LineChart, StatTile, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortDay } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { useFilters, filterKey, toQuery, windowDays, horizonDays } from '../../../lib/filters';
import { t } from '../../../lib/i18n';
import { duration, durationLong, count, durationUnit } from '../../../lib/format';
import '../pillar.scss';

interface StageStat { n: number; p50: number; p90: number; p95: number; mean: number; confidence: number | null }
interface StageForecast {
  label: string;
  points: Array<{ day: string; value: number; lower80: number; upper80: number }>;
  method: string; mae: number | null; mape: number | null; coverage80Pct: number | null; caveats: string[];
}
interface ResponseTimeResult {
  value: {
    stages: Record<string, StageStat>;
    response: StageStat | null;
    decomposedTotalP50: number;
    biggestContributors: Array<{ stage: string; label: string; excessSec: number; baselineP50: number; p: number }>;
  };
  factors: Array<{ name: string; contribution: number; detail?: string }>;
  confidence: number | null;
  caveats: string[];
  filters: { describe: Array<{ label: string; value: string }>; active: boolean; summary: string };
  sampleN: number;
  baselineN: number;
  trend: Array<Record<string, number | string | null>>;
  forecast: Record<string, StageForecast>;
  meta?: { insufficient?: boolean };
}

/** The camelCase keys the engine returns, against the snake_case trend columns. */
const STAGES: Array<{ engine: string; trend: string; label: string }> = [
  { engine: 'callHandling', trend: 'call_handling', label: 'Call handling' },
  { engine: 'dispatch', trend: 'dispatch', label: 'Dispatch decision' },
  { engine: 'acknowledge', trend: 'acknowledge', label: 'Acknowledge' },
  { engine: 'turnout', trend: 'turnout', label: 'Turnout' },
  { engine: 'travel', trend: 'travel', label: 'En-route travel' },
];

interface RtState { request: string; data: ResponseTimeResult | null; insufficient: boolean; error: string | null }

export function CollaboratePage() {
  const f = useFilters();
  const [result, setResult] = useState<RtState | null>(null);
  const [focus, setFocus] = useState<string>('response');
  const request = filterKey(f);

  // The same fetch shape every Insights tab uses: state set only inside then/catch, never
  // synchronously in the effect body, which is what deadlocks under React 19 StrictMode's
  // dev-mode double-invoke (see DispatchPanel.tsx for the pattern this follows).
  useEffect(() => {
    let cancelled = false;
    api.responseTime({ days: windowDays(f), ahead: horizonDays(f) }, toQuery(f))
      .then((r) => {
        if (cancelled) return;
        const res = r as unknown as ResponseTimeResult;
        setResult(res.meta?.insufficient
          ? { request, data: null, insufficient: true, error: null }
          : { request, data: res, insufficient: false, error: null });
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setResult({ request, data: null, insufficient: false, error: e.message ?? 'Failed to load' });
      });
    return () => { cancelled = true; };
    // `request` is this component's own summary of everything the closure depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Same two states as useInsight: a skeleton only before the first answer, a dimmed
  // previous render while a filter change is in flight.
  const data = result?.data ?? null;
  const loading = result?.request !== request && data == null;
  const stale = result?.request !== request && data != null;
  const insufficient = result?.request === request && result.insufficient;
  const error = result?.request === request ? result.error : null;

  const stageBars = data ? STAGES.filter((s) => data.value.stages[s.engine]).map((s) => ({
    label: s.label,
    value: data.value.stages[s.engine].p50,
    detail: `p90 ${data.value.stages[s.engine].p90}s, n=${data.value.stages[s.engine].n}`,
  })) : [];

  const focusKey = focus === 'response' ? 'response' : STAGES.find((s) => s.engine === focus)?.trend ?? 'response';
  const focusForecast = data?.forecast?.[focusKey] ?? null;
  const trend = buildTrend([{
    name: focusForecast?.label ?? t('collab.response'),
    actual: data?.trend ?? [],
    forecast: f.predict ? focusForecast?.points : undefined,
    labelKey: 'day', valueKey: focusKey, forecastValueKey: 'value',
    interval: f.interval,
  }]);

  return (
    <div className={`pillar${stale ? ' is-stale' : ''}`}>
      <div className="pillar__head">
        <h1 className="pillar__title"><Users aria-hidden /> {t('collab.title')}</h1>
      </div>
      <p className="pillar__sub">{t('collab.sub')}</p>

      <FilterBar />

      {error && <ErrorState body={error} />}
      {insufficient && <EmptyState title={t('collab.insufficient')} body={t('collab.insufficientBody')} />}

      {loading ? <Skeleton height={240} /> : data && (
        <>
          <div className="pillar__kpirow">
            <Card><StatTile label={t('collab.medianResponse')} value={duration(data.value.response?.p50 ?? null)} unit={durationUnit(data.value.response?.p50 ?? null)} sub={`from ${count(data.value.response?.n ?? 0)} responses`} /></Card>
            <Card><StatTile label={t('kpi.responseP90')} value={duration(data.value.response?.p90 ?? null)} unit={durationUnit(data.value.response?.p90 ?? null)} /></Card>
            <Card><StatTile label={t('collab.mean')} value={duration(data.value.response?.mean ?? null)} unit={durationUnit(data.value.response?.mean ?? null)} /></Card>
            <Card><StatTile label={t('collab.confidence')} value={data.confidence != null ? `${Math.round(data.confidence * 100)}%` : '—'}
              sub={data.confidence == null ? t('collab.notEnough') : t('collab.baselineN', { n: count(data.baselineN) })} /></Card>
          </div>

          <Card
            title={t('collab.trendTitle')}
            subtitle={t('collab.trendSub')}
            actions={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-10)' }}>
                <PredictionLegend interval={f.predict ? f.interval : 0} />
                <Segmented value={focus} ariaLabel={t('collab.pickStage')} onChange={setFocus}
                  options={[
                    { value: 'response', label: t('collab.response') },
                    ...STAGES.map((s) => ({ value: s.engine, label: s.label })),
                  ]} />
              </div>
            )}>
            <LineChart series={trend.series} height={160} yFormat={(v) => duration(Math.round(v))}
                       xLabels={(x) => shortDay(trend.labels[x] ?? '')}
                       forecastFromX={f.predict ? trend.forecastFromX : null} />
            <ForecastNote meta={focusForecast ?? undefined} horizon={focusForecast?.points.length} unit={t('insights.overview.days')}  show={f.predict} />
            <FilterNote filters={data.filters} />
          </Card>

          <div className="pillar__grid">
            <Card title={t('collab.stageContribution')} subtitle={t('collab.decomposedTotal', { time: durationLong(data.value.decomposedTotalP50) })}>
              <BarList items={stageBars} format={(v) => durationLong(v)} />
            </Card>

            <Card title={t('collab.biggest')}>
              {data.value.biggestContributors.length === 0 ? (
                <EmptyState title={t('collab.noneDistinguishable')} body={t('collab.noneBody')} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-10)' }}>
                  {data.value.biggestContributors.map((c) => (
                    <div key={c.stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-8)' }}>
                      <span>{c.label}</span>
                      <Chip tone={c.excessSec > 0 ? 'warning' : 'success'}>
                        {c.excessSec > 0 ? '+' : ''}{Math.round(c.excessSec)}s vs baseline {Math.round(c.baselineP50)}s
                      </Chip>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {data.caveats.length > 0 && <p className="pillar__footnote">{data.caveats.join(' · ')}</p>}
        </>
      )}
    </div>
  );
}
