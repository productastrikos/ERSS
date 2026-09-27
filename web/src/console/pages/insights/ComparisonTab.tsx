/**
 * Period-over-period comparison (Concept Note §07): this window against the one before it,
 * and — because the client's rule is a prediction on every panel — an extrapolation of the
 * window after it, from three equal windows.
 *
 * The breakdown tables carry a predicted column per row, so "which call types are growing"
 * is answered directly rather than left as arithmetic for the reader.
 */

import { MapPin, TrendingDown, TrendingUp, Timer } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Card, ErrorState, Skeleton, Chip, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { StatTile, BarList, LineChart, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue } from '../../../shared/filters/actions';
import { useFilters, filterKey, toQuery, windowDays } from '../../../lib/filters';
import { count, duration, pct, UNIT_KIND_LABEL, durationUnit } from '../../../lib/format';
import { navigate } from '../../../lib/router';
import type { CompareNext, CompareResult, CompareRow } from '../../../lib/types';
import { useInsight } from './useInsight';

const kindLabel = (k: string) => { const s = t(`kind.${k}`); return s === `kind.${k}` ? k.replace(/_/g, ' ') : s; };

/** Arithmetic over the comparison payload the page already holds — no extra query. */
function comparisonFindings(r: CompareResult, days: number): Finding[] {
  const out: Finding[] = [];

  const movers = [...r.byKind].filter((k) => k.deltaPct != null)
    .sort((a, b) => Math.abs(b.deltaPct as number) - Math.abs(a.deltaPct as number));
  const top = movers[0];
  if (top && Math.abs(top.deltaPct as number) >= 10) {
    const rising = (top.deltaPct as number) > 0;
    out.push({
      id: 'biggest-mover',
      tone: rising ? 'warning' : 'success',
      icon: rising ? TrendingUp : TrendingDown,
      headline: `${kindLabel(top.key)} ${rising ? 'up' : 'down'} ${Math.abs(top.deltaPct as number)}% — the largest move.`,
      detail: `${count(top.calls)} against ${count(top.priorCalls)} in the previous ${days} days.`,
    });
  }

  // A zone moving hard matters more than a call type: it is where crews get placed.
  const zones = [...r.byZone].filter((z) => z.deltaPct != null)
    .sort((a, b) => (b.deltaPct as number) - (a.deltaPct as number));
  const hottest = zones[0];
  if (hottest && (hottest.deltaPct as number) >= 10) {
    out.push({
      id: 'zone-surge',
      tone: 'warning',
      icon: MapPin,
      headline: `${hottest.key} is up ${hottest.deltaPct}% on the prior window.`,
      detail: `${count(hottest.calls)} calls, median response ${duration(hottest.p50Sec)}.`,
      action: { label: 'Search this area', run: () => navigate('/insights/radial') },
    });
  }

  // Volume and speed moving in opposite directions is the finding a delta table hides.
  if (r.delta.p50Sec != null && r.delta.callsPct != null && r.delta.p50Sec > 0 && r.delta.callsPct < 0) {
    out.push({
      id: 'slower-on-less',
      tone: 'critical',
      icon: Timer,
      headline: `Response slowed ${r.delta.p50Sec}s while demand fell ${Math.abs(r.delta.callsPct)}%.`,
      detail: 'Fewer calls did not buy faster responses — the cause is unlikely to be workload.',
      action: { label: 'Open performance', run: () => navigate('/insights/performance') },
    });
  }

  return out;
}

export function ComparisonTab() {
  const f = useFilters();
  const q = toQuery(f);
  const days = windowDays(f);
  const result = useInsight(`compare:${filterKey(f)}`, () => api.insights.compare({ days }, q));
  const r = result.data;

  /** The three windows, then the extrapolated fourth — the whole point of this page. */
  const trendOf = (pick: (w: typeof r extends null ? never : NonNullable<typeof r>['current']) => number | null, next: CompareNext | null, name: string, tone?: string) => {
    if (!r) return [];
    const measured = [pick(r.before), pick(r.prior), pick(r.current)]
      .map((y, x) => ({ x, y }))
      .filter((p) => p.y != null);
    const series = [{ name, points: measured, tone }];
    if (f.predict && next) {
      series.push({
        name: `${name} · ${t('chart.forecast')}`,
        tone,
        dashed: true,
        points: [measured.at(-1)!, { x: 3, y: next.predicted }],
        band: f.interval
          ? [
            { x: 2, lower: measured.at(-1)!.y as number, upper: measured.at(-1)!.y as number },
            { x: 3, lower: next.lower80, upper: next.upper80 },
          ]
          : undefined,
      } as typeof series[number]);
    }
    return series;
  };

  const WINDOW_LABELS = [
    t('insights.compare.twoBack', { days }),
    t('insights.compare.oneBack', { days }),
    t('insights.compare.now'),
    t('insights.compare.next'),
  ];

  return (
    <div className={`insights__compare${result.stale ? ' is-stale' : ''}`}>
      <p className="pillar__sub">{t('insights.compare.sub')}</p>
      <FilterBar note={t('insights.compare.windowNote', { days })} />

      {result.loading && <Skeleton height={300} />}
      {result.error && <ErrorState body={result.error} />}

      {r && (
        <>
          <div className="insights__kpirow">
            <Card><StatTile label={t('insights.compare.calls')} value={count(r.current.calls)} unit="calls"
              delta={`${r.delta.calls >= 0 ? '+' : ''}${count(r.delta.calls)} (${r.delta.callsPct != null ? `${r.delta.callsPct >= 0 ? '+' : ''}${r.delta.callsPct}%` : '—'})`}
              sub={`was ${count(r.prior.calls)} calls`}
              predicted={f.predict && r.next.calls ? `${count(r.next.calls.predicted)} calls` : undefined}
              predictedLabel={t('chart.nextWindow', { days })} /></Card>
            <Card><StatTile label={t('kpi.responseP50')} value={duration(r.current.p50Sec)} unit={durationUnit(r.current.p50Sec)}
              delta={r.delta.p50Sec != null ? `${r.delta.p50Sec >= 0 ? '+' : ''}${r.delta.p50Sec} sec` : null}
              deltaGood={r.delta.p50Sec != null ? r.delta.p50Sec <= 0 : null}
              sub={`was ${duration(r.prior.p50Sec)} ${durationUnit(r.prior.p50Sec)}`}
              predicted={f.predict && r.next.p50Sec ? duration(r.next.p50Sec.predicted) : undefined}
              predictedLabel={t('chart.nextWindow', { days })} /></Card>
            <Card><StatTile label={t('kpi.withinTarget')} value={pct(r.current.withinTargetPct)} unit="of responses"
              delta={r.delta.withinTargetPp != null ? `${r.delta.withinTargetPp >= 0 ? '+' : ''}${r.delta.withinTargetPp}pt` : null}
              deltaGood={r.delta.withinTargetPp != null ? r.delta.withinTargetPp >= 0 : null}
              sub={`was ${pct(r.prior.withinTargetPct)}`}
              predicted={f.predict && r.next.withinTargetPct ? pct(r.next.withinTargetPct.predicted) : undefined}
              predictedLabel={t('chart.nextWindow', { days })} /></Card>
            <Card><StatTile label="P1 calls" value={count(r.current.p1)} unit="calls" sub={`was ${count(r.prior.p1)} calls`}
              predicted={f.predict && r.next.p1 ? `${count(r.next.p1.predicted)} calls` : undefined}
              predictedLabel={t('chart.nextWindow', { days })} /></Card>
          </div>

          <AdvisoryStrip findings={comparisonFindings(r, days)}
                         note={`This ${days}-day window against the one before it.`} />

          <div className="pillar__grid">
            <Card title={t('insights.compare.callsTrend')} subtitle={t('insights.compare.threeWindows', { days })}
                  actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
              <LineChart series={trendOf((w) => w.calls, r.next.calls, t('kpi.calls'))} height={140}
                         xLabels={(x) => WINDOW_LABELS[x] ?? ''} xTickEvery={1}
                         forecastFromX={f.predict && r.next.calls ? 3 : null} />
              <ForecastNote meta={{ method: r.next.method, caveats: [] }}  show={f.predict} />
            </Card>
            <Card title={t('insights.compare.responseTrend')} subtitle={t('insights.compare.threeWindows', { days })}>
              <LineChart series={trendOf((w) => w.p50Sec, r.next.p50Sec, t('kpi.responseP50'), 'var(--series-3)')} height={140}
                         yFormat={(v) => duration(Math.round(v))}
                         xLabels={(x) => WINDOW_LABELS[x] ?? ''} xTickEvery={1}
                         forecastFromX={f.predict && r.next.p50Sec ? 3 : null} />
            </Card>
          </div>

          <div className="pillar__grid">
            <Card title={t('insights.compare.byKind')} subtitle={t('insights.compare.byKindSub')} flush>
              <CompareTable rows={r.byKind} label={kindLabel} predict={f.predict} />
            </Card>
            <Card title={t('insights.compare.byZone')} subtitle={t('insights.compare.byZoneSub')} flush>
              <CompareTable rows={r.byZone} label={(k) => k} predict={f.predict} />
            </Card>
            <Card title={t('insights.compare.byUnitKind')} subtitle={t('chart.clickToFilter')}>
              <BarList items={r.byUnitKind.filter((x) => x.key).map((u) => ({
                key: u.key, label: UNIT_KIND_LABEL[u.key] ?? u.key, value: u.calls,
                predicted: f.predict ? u.predictedCalls : null,
                changePct: f.predict ? u.predictedChangePct : null,
                detail: `was ${count(u.priorCalls)} · ${duration(u.p50Sec)} median`,
              }))} format={count} showPredicted={f.predict}
                selected={f.unitKind} onSelect={(v) => toggleValue(f, 'unitKind', v)} />
            </Card>
            <Card title={t('insights.compare.byHour')} subtitle={t('insights.compare.byHourSub')}>
              <LineChart
                series={[
                  { name: t('insights.compare.now'), points: r.byHour.map((h) => ({ x: Number(h.key), y: h.calls })) },
                  { name: t('insights.compare.oneBack', { days }), points: r.byHour.map((h) => ({ x: Number(h.key), y: h.priorCalls })), tone: 'var(--series-4)' },
                  ...(f.predict ? [{
                    name: t('chart.forecast'),
                    points: r.byHour.map((h) => ({ x: Number(h.key), y: h.predictedCalls })),
                    tone: 'var(--series-3)', dashed: true,
                  }] : []),
                ]}
                height={140} xTickEvery={2} xLabels={(x) => `${String(x).padStart(2, '0')}:00`} />
            </Card>
          </div>

          <FilterNote filters={r.filters} />
        </>
      )}
    </div>
  );
}

function CompareTable({ rows, label, predict }: { rows: CompareRow[]; label: (key: string) => string; predict: boolean }) {
  if (!rows.length) return <div style={{ padding: 'var(--sp-16)' }}><em>—</em></div>;
  return (
    <table className="pillar__table">
      <thead>
        <tr>
          <th>{t('common.filter')}</th>
          <th className="numeric">{t('insights.compare.now')}</th>
          <th className="numeric">{t('insights.compare.before')}</th>
          <th className="numeric">{t('insights.compare.change')}</th>
          {predict && <th className="numeric">{t('chart.forecast')}</th>}
          <th className="numeric">{t('kpi.responseP50')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 14).map((row) => (
          <tr key={row.key}>
            <td>{label(row.key)}</td>
            <td className="numeric">{count(row.calls)}</td>
            <td className="numeric">{count(row.priorCalls)}</td>
            <td className="numeric">
              <Chip tone={row.delta > 0 ? 'warning' : row.delta < 0 ? 'success' : 'neutral'}>
                {row.delta >= 0 ? '+' : ''}{row.delta}{row.deltaPct != null ? ` (${row.deltaPct >= 0 ? '+' : ''}${row.deltaPct}%)` : ''}
              </Chip>
            </td>
            {predict && (
              <td className="numeric is-predicted" title={t('insights.compare.predictedTitle')}>
                {count(row.predictedCalls)}
                {row.predictedChangePct != null && <span className="pillar__muted"> ({row.predictedChangePct >= 0 ? '+' : ''}{row.predictedChangePct}%)</span>}
              </td>
            )}
            <td className="numeric">{duration(row.p50Sec)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
