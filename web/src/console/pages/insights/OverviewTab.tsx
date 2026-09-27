/**
 * Overview — the Concept Note's Analytics view (§05): the call mix top-to-bottom, monthly
 * counts against a fitted forecast, daily counts with the week ahead, and the hour ×
 * weekday almanac that can be flipped from measured to forecast.
 *
 * Every panel here reads the universal filter (lib/filters.ts) and every series carries a
 * prediction with its interval and its backtest error. The charts are also filter
 * controls: click a call type to filter to it, click an almanac cell to filter to that
 * weekday and hour.
 */

import { useState } from 'react';
import { Clock, HeartPulse, Layers, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, Skeleton, ErrorState, EmptyState, Segmented, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { BarList, HeatGrid, LineChart, StatTile, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortDay, shortMonth } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue, pickCell } from '../../../shared/filters/actions';
import {
  useFilters, filterKey, toQuery, windowDays, windowMonths, windowWeeks,
  horizonDays, horizonMonths, horizonWeeks,
} from '../../../lib/filters';
import { count, duration, pct } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { navigate } from '../../../lib/router';
import { useInsight } from './useInsight';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const kindLabel = (k: string) => { const s = t(`kind.${k}`); return s === `kind.${k}` ? k.replace(/_/g, ' ') : s; };

export function OverviewTab() {
  const f = useFilters();
  const q = toQuery(f);
  const key = filterKey(f);
  const [gridMode, setGridMode] = useState<'measured' | 'forecast'>('measured');

  const monthly = useInsight(`monthly:${key}`, () => api.insights.monthly({ months: windowMonths(f), ahead: horizonMonths(f) }, q));
  const almanac = useInsight(`almanac:${key}`, () => api.insights.almanac({ weeks: windowWeeks(f), ahead: horizonWeeks(f) || 1 }, q));
  const daily = useInsight(`daily:${key}`, () => api.insights.daily({ days: windowDays(f), ahead: horizonDays(f) }, q));
  const types = useInsight(`call-types:${key}`, () => api.insights.callTypes({ days: windowDays(f), limit: 10 }, q));

  const loading = monthly.loading || almanac.loading || daily.loading || types.loading;
  const stale = monthly.stale || almanac.stale || daily.stale || types.stale;
  const error = monthly.error ?? almanac.error ?? daily.error ?? types.error;

  return (
    <div className={`insights__overview${stale ? ' is-stale' : ''}`}>
      <FilterBar />

      {loading && <Skeleton height={420} />}
      {error && <ErrorState body={error} />}

      {!loading && !error && monthly.data && almanac.data && daily.data && types.data && (() => {
        const m = monthly.data!;
        const alm = almanac.data!;
        const d = daily.data!;
        const ty = types.data!;

        // The current month is partial: it is shown as its own point so the forecast for
        // the same month can be read against what has actually landed so far.
        const monthTrend = buildTrend([
          {
            name: t('kpi.calls'),
            actual: m.actual,
            forecast: f.predict ? m.forecast : undefined,
            labelKey: 'month', valueKey: 'calls', interval: f.interval,
          },
          {
            name: 'P1/P2',
            actual: m.actual,
            forecast: f.predict ? m.forecastUrgent : undefined,
            labelKey: 'month', valueKey: 'urgent', forecastValueKey: 'urgent',
            tone: 'var(--app-danger)', interval: f.interval,
          },
        ]);
        if (f.showNaive && f.predict && m.seasonalNaive.length) {
          monthTrend.series.push({
            name: t('insights.overview.naive'),
            tone: 'var(--series-6)',
            dashed: true,
            points: m.seasonalNaive
              .filter((x) => x.calls != null)
              .map((x) => ({ x: monthTrend.labels.indexOf(x.month), y: x.calls }))
              .filter((p) => p.x >= 0),
          });
        }

        const dayTrend = buildTrend([
          {
            name: t('kpi.calls'), actual: d.series,
            forecast: f.predict ? d.forecast : undefined,
            labelKey: 'day', valueKey: 'calls', interval: f.interval,
          },
          {
            name: 'P1', actual: d.series,
            forecast: f.predict ? d.forecastP1 : undefined,
            labelKey: 'day', valueKey: 'p1', forecastValueKey: 'p1',
            tone: 'var(--app-danger)', interval: f.interval,
          },
        ]);

        const cells = alm.grid.map((g) => ({
          row: g.dow, col: g.hour, value: g.calls, predicted: g.predicted,
          detail: g.p50Sec != null ? `${duration(g.p50Sec)} median response` : undefined,
        }));

        const bars = (rows: typeof ty.top, tone?: string) => rows.map((r) => ({
          key: r.kind,
          label: kindLabel(r.kind),
          value: r.calls,
          predicted: f.predict ? r.predictedCalls : null,
          changePct: f.predict ? r.predictedChangePct : null,
          tone,
          detail: `${pct(r.sharePct)} of calls · ${duration(r.p50Sec)} median · ${pct(r.withinTargetPct)} within target · was ${count(r.priorCalls)} last window`,
        }));

        // ── What the AI is seeing ──────────────────────────────────────────────
        // Every finding below is arithmetic over the four datasets this page already
        // loaded. Nothing is fetched, nothing is modelled, nothing is asserted that the
        // charts underneath would contradict.
        const findings: Finding[] = [];

        const top3 = ty.top.slice(0, 3);
        const top3Share = top3.reduce((s, r) => s + r.sharePct, 0);
        if (top3.length === 3) {
          findings.push({
            id: 'concentration',
            tone: top3Share > 55 ? 'warning' : 'info',
            icon: Layers,
            headline: `${top3.map((r) => kindLabel(r.kind)).join(', ')} are ${Math.round(top3Share)}% of all calls.`,
            detail: `Three protocols cover most of ${ty.window.days}-day demand — crew competency and stock planning hinge on these before anything else.`,
            action: { label: 'Compare by zone', run: () => navigate('/insights/compare') },
          });
        }

        // Peak-to-typical: the hour to crew against, versus the hour a mean would suggest.
        if (alm.busiest && alm.grid.length > 0) {
          const mean = alm.grid.reduce((s, g) => s + g.calls, 0) / alm.grid.length;
          const ratio = mean > 0 ? alm.busiest.calls / mean : 0;
          if (ratio >= 1.5) {
            findings.push({
              id: 'peak',
              tone: 'warning',
              icon: Clock,
              headline: `${DOW[alm.busiest.dow]} ${String(alm.busiest.hour).padStart(2, '0')}:00 runs ${ratio.toFixed(1)}× a typical hour.`,
              detail: `${count(alm.busiest.calls)} calls against a ${Math.round(mean)}-call average. Crewing to the mean leaves this hour structurally short.`,
              action: { label: 'See response at peak', run: () => navigate('/insights/performance') },
            });
          }
        }

        // Direction of travel, measured on the two most recent complete weeks.
        if (d.series.length >= 14) {
          const last7 = d.series.slice(-7).reduce((s, x) => s + x.calls, 0);
          const prior7 = d.series.slice(-14, -7).reduce((s, x) => s + x.calls, 0);
          const deltaPct = prior7 > 0 ? ((last7 - prior7) / prior7) * 100 : 0;
          if (Math.abs(deltaPct) >= 5) {
            const rising = deltaPct > 0;
            findings.push({
              id: 'week-shift',
              tone: rising ? 'warning' : 'success',
              icon: rising ? TrendingUp : TrendingDown,
              headline: `Demand ${rising ? 'rose' : 'fell'} ${Math.abs(deltaPct).toFixed(1)}% this week against last.`,
              detail: `${count(last7)} calls in the last seven days versus ${count(prior7)} in the seven before — a shift the monthly line is still too coarse to show.`,
              action: { label: 'Open comparison', run: () => navigate('/insights/compare') },
            });
          }
        }

        // The rare-but-unforgiving case, if it is genuinely in the tail.
        const arrest = ty.bottom.find((r) => /arrest/i.test(r.kind));
        if (arrest) {
          findings.push({
            id: 'rare-critical',
            tone: 'critical',
            icon: HeartPulse,
            headline: `Cardiac arrest is only ${pct(arrest.sharePct)} of calls — and the least forgiving of them.`,
            detail: `${count(arrest.calls)} in ${ty.window.days} days. Volume-led planning will always rank it last; survival is decided in the first minutes.`,
            action: { label: 'Review response times', run: () => navigate('/insights/performance') },
          });
        }

        return (
          <>
            <div className="insights__kpirow">
              <Card><StatTile label={t('insights.overview.callsWindow', { days: ty.window.days })} value={count(ty.total)} unit="calls"
                predicted={f.predict ? `${count(ty.forecast.predictedTotal)} calls${ty.forecast.predictedChangePct != null ? ` (${ty.forecast.predictedChangePct >= 0 ? '+' : ''}${ty.forecast.predictedChangePct}%)` : ''}` : undefined}
                predictedLabel={t('chart.nextWindow', { days: ty.forecast.horizonDays })}
                sub={`was ${count(ty.priorTotal)} calls`} /></Card>
              <Card><StatTile label={t('insights.overview.thisMonth')} value={count(m.partialMonth?.calls ?? 0)} unit="calls"
                sub={m.partialMonth ? `${m.partialMonth.elapsedDays} of ${m.partialMonth.daysInMonth} days · on pace for ~${count(m.partialMonth.projectedCalls)} calls` : undefined}
                predicted={f.predict && m.forecast[0] ? `${count(m.forecast[0].calls)} calls` : undefined}
                predictedLabel={t('insights.overview.fullMonth')} /></Card>
              <Card><StatTile label={t('insights.overview.busiest')}
                value={alm.busiest ? `${DOW[alm.busiest.dow]} ${String(alm.busiest.hour).padStart(2, '0')}:00` : '—'} unit={alm.busiest ? 'GST' : undefined}
                sub={alm.busiest ? `${count(alm.busiest.calls)} calls over ${alm.weeks} weeks` : undefined}
                predicted={f.predict && alm.predictedBusiest
                  ? `${DOW[alm.predictedBusiest.dow]} ${String(alm.predictedBusiest.hour).padStart(2, '0')}:00`
                  : undefined}
                predictedLabel={t('insights.overview.nextPeak')} /></Card>
              <Card><StatTile label={t('insights.overview.yoy')} value={`${m.yoy >= 1 ? '+' : ''}${Math.round((m.yoy - 1) * 100)}%`} unit="calls vs last year"
                sub={m.forecastMeta.mape != null ? t('insights.overview.backtest', { pct: m.forecastMeta.mape.toFixed(1) }) : undefined} /></Card>
            </div>

            <AdvisoryStrip findings={findings} note="Computed from this page's window — no model call." />

            <div className="insights__split">
              <div className="insights__main">
                <Card title={t('insights.overview.top10')} subtitle={t('insights.overview.callMixSub', { days: ty.window.days })}
                      actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
                  <BarList items={bars(ty.top)} format={count} showPredicted={f.predict}
                           selected={f.kind} onSelect={(k) => toggleValue(f, 'kind', k)} />
                  <FilterNote filters={ty.filters} />
                  <ForecastNote meta={{ method: ty.forecast.method, caveats: ty.forecast.caveats }}  show={f.predict} />
                </Card>
                <Card title={t('insights.overview.bottom10')} subtitle={t('insights.overview.bottomSub')}>
                  {ty.bottom.length ? (
                    <BarList items={bars(ty.bottom, 'var(--series-4)')} format={count} showPredicted={f.predict}
                             selected={f.kind} onSelect={(k) => toggleValue(f, 'kind', k)} />
                  ) : <EmptyState title={t('insights.overview.nothingRare')} />}
                </Card>
              </div>

              <div className="insights__rail">
                <Card title={t('insights.overview.monthly')} subtitle={m.window.months + ' months'}>
                  <LineChart series={monthTrend.series} xLabels={(x) => shortMonth(monthTrend.labels[x] ?? '')}
                             forecastFromX={f.predict ? monthTrend.forecastFromX : null} />
                  <ForecastNote meta={m.forecastMeta} horizon={m.forecast.length} unit={t('insights.overview.months')}  show={f.predict} />
                </Card>
                <Card title={t('insights.overview.daily')}
                      subtitle={d.partialDay
                        ? t('insights.overview.dailyPartial', { days: d.window.days, n: count(d.partialDay.calls) })
                        : t('insights.overview.dailySub', { days: d.window.days })}>
                  <LineChart series={dayTrend.series} height={140} xLabels={(x) => shortDay(dayTrend.labels[x] ?? '')}
                             forecastFromX={f.predict ? dayTrend.forecastFromX : null} />
                  <ForecastNote meta={d.forecastMeta} horizon={d.forecast.length} unit={t('insights.overview.days')}  show={f.predict} />
                </Card>
              </div>
            </div>

            <Card title={t('insights.overview.almanac')} subtitle={t('insights.overview.almanacSub', { weeks: alm.weeks })}
                  actions={(
                    <Segmented value={gridMode} ariaLabel={t('chart.showForecastGrid')} onChange={setGridMode}
                      options={[
                        { value: 'measured' as const, label: t('chart.measured') },
                        { value: 'forecast' as const, label: t('chart.forecast') },
                      ]} />
                  )}>
              <HeatGrid rows={DOW} cols={Array.from({ length: 24 }, (_, h) => String(h))} cells={cells}
                        colLabel={(h) => (h % 3 === 0 ? String(h).padStart(2, '0') : '')}
                        format={(v) => (gridMode === 'forecast' ? v.toFixed(1) : count(v))}
                        showPredicted={gridMode === 'forecast'}
                        onSelectCell={(row, col) => pickCell(f, row, col)}
                        selected={(row, col) => f.dow.includes(row) && f.hourFrom === col && f.hourTo === col} />
              <FilterNote filters={alm.filters} />
              <ForecastNote meta={{ method: alm.forecast.method, caveats: alm.forecast.caveats }}
                            horizon={alm.forecast.horizonWeeks} unit={t('insights.overview.weeks')}  show={f.predict} />
              <p className="pillar__footnote">{t('insights.overview.almanacClick')}</p>
            </Card>
          </>
        );
      })()}
    </div>
  );
}
