/**
 * Performance (Concept Note §04's UP-112 Performance Dashboard, and §08's pre-empt and
 * ETA-accuracy claims): the response stages measured, the trend of the headline numbers
 * with the week ahead forecast, how the service performs by zone class, priority, unit
 * type, hour and station, what signal pre-emption is recovering, and the arrival model
 * held to account.
 *
 * Every breakdown here is also a filter: clicking a bar narrows every chart in the console
 * to that slice.
 */

import { Building2, Crosshair, Radio, Target } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Card, ErrorState, Skeleton, EmptyState, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { BarList, Histogram, LineChart, StatTile, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortDay } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue, pickHour } from '../../../shared/filters/actions';
import { useFilters, filterKey, toQuery, windowDays, horizonDays, setFilters } from '../../../lib/filters';
import { count, duration, durationLong, pct, UNIT_KIND_LABEL, durationUnit } from '../../../lib/format';
import { useInsight } from './useInsight';
import type { PerformanceResult } from '../../../lib/types';

/** Findings over the performance payload the page already holds. */
function performanceFindings(r: PerformanceResult): Finding[] {
  const out: Finding[] = [];

  // Which stage is actually carrying the response time — the question a total can't answer.
  const stages = r.stages.filter((s) => s.meanSec != null) as Array<{ key: string; label: string; meanSec: number }>;
  const sum = stages.reduce((s, x) => s + x.meanSec, 0);
  const worst = [...stages].sort((a, b) => b.meanSec - a.meanSec)[0];
  if (worst && sum > 0) {
    const share = Math.round((worst.meanSec / sum) * 100);
    out.push({
      id: 'dominant-stage',
      tone: share >= 45 ? 'warning' : 'info',
      icon: Target,
      headline: `${worst.label} is ${share}% of the response — the largest stage.`,
      detail: `${durationLong(worst.meanSec)} of ${durationLong(sum)} measured end to end.`,
    });
  }

  // Vertical access is invisible to the standard clock, which stops at the entrance.
  const vertical = stages.find((s) => s.key === 'vertical');
  if (vertical && vertical.meanSec >= 120) {
    out.push({
      id: 'vertical-access',
      tone: 'critical',
      icon: Building2,
      headline: `Lobby-to-patient adds ${durationLong(vertical.meanSec)} after the ambulance arrives.`,
      detail: 'The standard response clock stops at the entrance, so this time is invisible in compliance reporting.',
    });
  }

  // Pre-emption held to its measured effect, not its theoretical one.
  if (r.preempt.requests > 0) {
    const saved = r.preempt.meanSavedSec ?? 0;
    const grant = r.preempt.grantPct ?? 0;
    out.push({
      id: 'preempt',
      tone: saved < 5 ? 'critical' : 'success',
      icon: Radio,
      headline: saved < 5
        ? `${count(r.preempt.requests)} pre-empt requests returned ${Math.round(saved)}s of measured saving.`
        : `Signal pre-emption recovered ${Math.round(saved)}s per granted run.`,
      detail: `${pct(grant)} of requests granted · ${durationLong(r.preempt.totalSavedSec)} recovered in total.`,
    });
  }

  // The arrival model, held to account against what actually happened.
  if (r.eta.samples > 0 && r.eta.maeSec != null) {
    out.push({
      id: 'eta-accuracy',
      tone: r.eta.maeSec > 90 ? 'warning' : 'success',
      icon: Crosshair,
      headline: `ETA predictions are out by ${Math.round(r.eta.maeSec)}s on average.`,
      detail: `${pct(r.eta.within60Pct)} land inside a minute, measured across ${count(r.eta.samples)} arrivals.`,
    });
  }

  return out;
}

export function PerformanceTab() {
  const f = useFilters();
  const q = toQuery(f);
  const result = useInsight(`performance:${filterKey(f)}`, () =>
    api.insights.performance({ days: windowDays(f), ahead: horizonDays(f) }, q));
  const r = result.data;

  return (
    <div className={`insights__performance${result.stale ? ' is-stale' : ''}`}>
      <p className="pillar__sub">{t('insights.performance.sub')}</p>
      <FilterBar />

      {result.loading && <Skeleton height={300} />}
      {result.error && <ErrorState body={result.error} />}

      {r && (() => {
        const histBins = r.eta.histogram.map((b) => ({
          label: b.fromSec <= 0 && b.toSec > 0 ? '0' : b.fromSec >= 0 ? `+${b.fromSec}` : `${b.fromSec}`,
          value: b.n,
        }));

        const headline = buildTrend([
          {
            name: t('kpi.responseP50'), actual: r.trend,
            forecast: f.predict ? r.forecast.p50Sec : undefined,
            labelKey: 'day', valueKey: 'p50Sec', interval: f.interval,
          },
        ]);
        const attainment = buildTrend([
          {
            name: t('kpi.withinTarget'), actual: r.trend,
            forecast: f.predict ? r.forecast.withinTargetPct : undefined,
            labelKey: 'day', valueKey: 'withinTargetPct', tone: 'var(--series-3)', interval: f.interval,
          },
        ]);
        const volume = buildTrend([
          {
            name: t('kpi.calls'), actual: r.trend,
            forecast: f.predict ? r.forecast.calls : undefined,
            labelKey: 'day', valueKey: 'calls', tone: 'var(--series-2)', interval: f.interval,
          },
        ]);

        const nextP50 = r.forecast.p50Sec.at(-1);
        const nextWithin = r.forecast.withinTargetPct.at(-1);

        return (
          <>
            <div className="insights__kpirow">
              <Card><StatTile label={t('kpi.calls')} value={count(r.totals.calls)} unit="calls"
                spark={r.trend.map((x) => x.calls)}
                sparkForecast={f.predict ? r.forecast.calls.map((x) => x.calls) : undefined} /></Card>
              <Card><StatTile label={t('kpi.responseP50')} value={duration(r.totals.p50Sec)} unit={durationUnit(r.totals.p50Sec)}
                predicted={f.predict && nextP50 ? `${duration(nextP50.p50Sec)} ${durationUnit(nextP50.p50Sec)}` : undefined}
                predictedLabel={nextP50 ? t('chart.by', { day: shortDay(nextP50.day) }) : undefined} /></Card>
              <Card><StatTile label={t('kpi.responseP90')} value={duration(r.totals.p90Sec)} unit={durationUnit(r.totals.p90Sec)} /></Card>
              <Card><StatTile label={t('kpi.withinTarget')} value={pct(r.totals.withinTargetPct)} unit="of responses"
                predicted={f.predict && nextWithin ? pct(nextWithin.withinTargetPct) : undefined}
                predictedLabel={nextWithin ? t('chart.by', { day: shortDay(nextWithin.day) }) : undefined} /></Card>
            </div>

            <AdvisoryStrip findings={performanceFindings(r)}
                           note={`Stage decomposition over the last ${windowDays(f)} days.`} />

            <Card title={t('insights.performance.trend')}
                  subtitle={r.partialDay
                    ? t('insights.performance.trendPartial', { time: duration(r.partialDay.p50Sec), n: count(r.partialDay.calls) })
                    : t('insights.performance.trendSub')}
                  actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
              <LineChart series={headline.series} height={150} yFormat={(v) => duration(Math.round(v))}
                         xLabels={(x) => shortDay(headline.labels[x] ?? '')}
                         forecastFromX={f.predict ? headline.forecastFromX : null} />
              <ForecastNote meta={r.forecast.meta} horizon={r.forecast.p50Sec.length} unit={t('insights.overview.days')}  show={f.predict} />
              <FilterNote filters={r.filters} />
            </Card>

            <div className="pillar__grid">
              <Card title={t('kpi.withinTarget')} subtitle={t('insights.performance.attainmentSub')}>
                <LineChart series={attainment.series} height={130} yFormat={(v) => `${Math.round(v)}%`}
                           xLabels={(x) => shortDay(attainment.labels[x] ?? '')}
                           forecastFromX={f.predict ? attainment.forecastFromX : null}
                           target={90} targetLabel={t('insights.performance.target90')} yMaxHint={100} />
              </Card>
              <Card title={t('kpi.calls')} subtitle={t('insights.performance.volumeSub')}>
                <LineChart series={volume.series} height={130} xLabels={(x) => shortDay(volume.labels[x] ?? '')}
                           forecastFromX={f.predict ? volume.forecastFromX : null} />
              </Card>

              <Card title={t('insights.performance.stages')} subtitle={t('insights.performance.stagesSub')}>
                <BarList items={r.stages.filter((s) => s.meanSec != null).map((s) => ({ label: s.label, value: s.meanSec as number }))}
                         format={durationLong} />
                <p className="pillar__footnote">{t('insights.performance.closeMean', { time: durationLong(r.closeMeanSec ?? 0) })}</p>
              </Card>

              <Card title={t('insights.performance.byPriority')} subtitle={t('chart.clickToFilter')}>
                <BarList items={r.byPriority.map((p) => ({
                  key: p.priority, label: p.priority, value: p.p50Sec ?? 0,
                  detail: `${count(p.calls)} calls · ${pct(p.withinTargetPct)} within target`,
                }))} format={(v) => duration(v)} selected={f.priority} onSelect={(v) => toggleValue(f, 'priority', v)} />
              </Card>

              <Card title={t('insights.performance.byZoneClass')} subtitle={t('chart.clickToFilter')}>
                {r.byZoneClass.length === 0 ? <EmptyState title={t('common.noData')} /> : (
                  <BarList items={r.byZoneClass.map((z) => ({
                    key: z.class, label: z.class, value: z.p50Sec ?? 0,
                    detail: `${count(z.calls)} calls · p90 ${duration(z.p90Sec)} · ${pct(z.withinTargetPct)} within target`,
                  }))} format={(v) => duration(v)} tone="var(--series-4)"
                    selected={f.zoneClass} onSelect={(v) => toggleValue(f, 'zoneClass', v)} />
                )}
              </Card>

              <Card title={t('insights.performance.byUnitKind')} subtitle={t('chart.clickToFilter')}>
                {r.byUnitKind.length === 0 ? <EmptyState title={t('common.noData')} /> : (
                  <BarList items={r.byUnitKind.map((u) => ({
                    key: u.unitKind, label: UNIT_KIND_LABEL[u.unitKind] ?? u.unitKind, value: u.p50Sec ?? 0,
                    detail: `${count(u.calls)} calls · ${pct(u.withinTargetPct)} within target`,
                  }))} format={(v) => duration(v)} tone="var(--series-5)"
                    selected={f.unitKind} onSelect={(v) => toggleValue(f, 'unitKind', v)} />
                )}
              </Card>

              <Card title={t('insights.performance.byStation')} subtitle={t('chart.clickToFilter')} className="pillar__span2">
                {r.byStation.length === 0 ? <EmptyState title={t('common.noData')} /> : (
                  <BarList items={r.byStation.map((s) => ({
                    key: s.stationRef, label: s.station, value: s.p50Sec ?? 0,
                    detail: `${count(s.calls)} calls · ${pct(s.withinTargetPct)} within target`,
                  }))} format={(v) => duration(v)} tone="var(--series-6)"
                    selected={f.station} onSelect={(v) => toggleValue(f, 'station', v)} />
                )}
              </Card>

              {/* Response seconds and call counts are different measures on different
                  scales, so they get a chart each rather than one plot with two
                  meanings — a shared axis between them would invent a relationship. */}
              <Card title={t('insights.performance.byHour')} subtitle={t('insights.performance.byHourSub')}>
                <LineChart
                  series={[{ name: t('kpi.responseP50'), points: r.byHour.map((h) => ({ x: h.hour, y: h.p50Sec })) }]}
                  height={140} xTickEvery={3} yFormat={(v) => duration(Math.round(v))}
                  xLabels={(x) => `${String(x).padStart(2, '0')}:00`}
                  onSelectX={(hour) => pickHour(f, hour)} />
              </Card>

              <Card title={t('insights.performance.volumeByHour')} subtitle={t('insights.performance.byHourSub')}>
                <LineChart
                  series={[{ name: t('kpi.calls'), points: r.byHour.map((h) => ({ x: h.hour, y: h.calls })), tone: 'var(--series-2)' }]}
                  height={140} xTickEvery={3} xLabels={(x) => `${String(x).padStart(2, '0')}:00`}
                  onSelectX={(hour) => pickHour(f, hour)} />
              </Card>

              <Card title={t('insights.performance.preempt')} subtitle={t('insights.performance.preemptSub')}>
                {r.preempt.requests === 0 ? <EmptyState title={t('common.noData')} /> : (
                  <div className="insights__kpirow insights__kpirow--tight">
                    <StatTile label={t('insights.performance.preemptRequests')} value={count(r.preempt.requests)} unit="requests" />
                    <StatTile label={t('insights.performance.preemptGranted')} value={pct(r.preempt.grantPct)} unit="granted" sub={`${count(r.preempt.granted)} of ${count(r.preempt.requests)} requests`} />
                    <StatTile label={t('insights.performance.preemptSaved')} value={r.preempt.meanSavedSec != null ? String(r.preempt.meanSavedSec) : '—'} unit={r.preempt.meanSavedSec != null ? 'sec' : undefined} sub={t('insights.performance.preemptSavedSub')} />
                    <StatTile label={t('insights.performance.preemptTotal')} value={durationLong(r.preempt.totalSavedSec)} />
                  </div>
                )}
              </Card>

              <Card title={t('insights.performance.eta')} subtitle={t('insights.performance.etaSub', { n: r.eta.samples })}>
                {r.eta.samples === 0 ? <EmptyState title={t('common.noData')} /> : (
                  <>
                    <div className="insights__kpirow insights__kpirow--tight">
                      <StatTile label={t('insights.performance.etaMae')} value={String(r.eta.maeSec)} unit="sec"
                        spark={r.eta.trend.map((x) => x.maeSec ?? 0)}
                        sparkForecast={f.predict ? r.eta.forecast.map((x) => x.maeSec) : undefined}
                        predicted={f.predict && r.eta.forecast.at(-1) ? `${r.eta.forecast.at(-1)!.maeSec} sec` : undefined}
                        predictedLabel={r.eta.forecast.at(-1) ? t('chart.by', { day: shortDay(r.eta.forecast.at(-1)!.day) }) : undefined} />
                      <StatTile label={t('insights.performance.etaWithin1')} value={pct(r.eta.within60Pct)} unit="of arrivals" />
                      <StatTile label={t('insights.performance.etaWithin2')} value={pct(r.eta.within120Pct)} unit="of arrivals" />
                      <StatTile label={t('insights.performance.etaEarly')} value={pct(r.eta.earlyPct)} unit="of arrivals" />
                    </div>
                    <Histogram bins={histBins} zeroLabel="0" />
                    <p className="pillar__footnote">{t('insights.performance.etaAxis')}</p>
                    <ForecastNote meta={r.eta.forecastMeta} horizon={r.eta.forecast.length} unit={t('insights.overview.days')}  show={f.predict} />
                  </>
                )}
              </Card>
            </div>

            <p className="pillar__footnote">
              {t('insights.performance.resetHint')}{' '}
              <button type="button" className="pillar__linkbtn" onClick={() => setFilters({ station: [], unitKind: [], zoneClass: [] })}>
                {t('insights.performance.clearBreakdowns')}
              </button>
            </p>
          </>
        );
      })()}
    </div>
  );
}
