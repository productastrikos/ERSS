/**
 * Call centre (Concept Note §04, UP-112's Call-Centre Dashboard, in DCAS terms): 998
 * volume by hour against tomorrow's forecast profile, where the calls come from, how they
 * resolved, and the top complaints.
 *
 * The hourly forecast is the one prediction a control room actually rosters against, so it
 * is the headline here: a 24-step-seasonal fit over the day × hour history, with the band,
 * and the predicted peak hour called out as a number.
 */

import { Clock, Filter, PhoneOff, Smartphone } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Card, ErrorState, Skeleton, EmptyState, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { BarList, LineChart, StatTile, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortDay } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue, pickHour } from '../../../shared/filters/actions';
import { useFilters, filterKey, toQuery, windowDays, horizonHours } from '../../../lib/filters';
import { count, decimal1, duration, pct, SOURCE_LABEL, durationUnit } from '../../../lib/format';
import type { CallCentreResult } from '../../../lib/types';
import { useInsight } from './useInsight';

const CLASS_LABEL: Record<string, string> = {
  transported: 'Transported', treated_on_scene: 'Treated on scene', refused_care: 'Refused care',
  non_actionable: 'Non-actionable (false alarm, duplicate, cancelled)', non_emergency: 'Non-emergency',
  in_progress: 'In progress',
};
/** The complaints list is chief-complaint free text, falling back to the kind key when a
 *  call has none recorded — translate only the latter, so free text never round-trips
 *  through the i18n dictionary (and never spams its dev-mode "missing key" warning). */
const complaintLabel = (c: string) => (/^[a-z_]+$/.test(c) ? t(`kind.${c}`) : c);

/** Findings over the intake payload the page already holds. */
function callCentreFindings(r: CallCentreResult): Finding[] {
  const out: Finding[] = [];
  const total = r.totals.calls || 1;

  // App vs voice decides how much address interrogation a call-taker has to do.
  const app = r.sources.find((s) => s.source === 'app_sos')?.calls ?? 0;
  const appShare = (app / total) * 100;
  if (r.sources.length > 1) {
    out.push({
      id: 'channel-mix',
      tone: appShare < 20 ? 'warning' : 'success',
      icon: Smartphone,
      headline: `Only ${Math.round(appShare)}% of calls arrive through the app.`,
      detail: 'Voice calls need the location established by interrogation; app calls carry exact coordinates.',
    });
  }

  // Work that consumed a call-taker and a queue slot but produced no patient.
  const dead = r.classes.find((c) => c.bucket === 'non_actionable')?.calls ?? 0;
  if (dead > 0) {
    out.push({
      id: 'non-actionable',
      tone: (dead / total) * 100 >= 10 ? 'warning' : 'info',
      icon: PhoneOff,
      headline: `${pct((dead / total) * 100)} of calls ended with no patient to treat.`,
      detail: `${count(dead)} false alarms, duplicates and cancellations still occupied a call-taker.`,
    });
  }

  // The handling tail, not the median — the median hides the calls that hurt.
  if (r.totals.callHandlingP90Sec != null && r.totals.callHandlingP50Sec != null) {
    const tail = r.totals.callHandlingP90Sec - r.totals.callHandlingP50Sec;
    out.push({
      id: 'handling-tail',
      tone: r.totals.callHandlingP90Sec > 180 ? 'warning' : 'info',
      icon: Clock,
      headline: `The slowest tenth of calls take ${duration(r.totals.callHandlingP90Sec)} to triage.`,
      detail: `${duration(tail)} longer than the median — every second here is before an ambulance moves.`,
    });
  }

  const peak = [...r.hourly].sort((a, b) => b.calls - a.calls)[0];
  if (peak) {
    out.push({
      id: 'intake-peak',
      tone: 'info',
      icon: Filter,
      headline: `Intake peaks at ${String(peak.hour).padStart(2, '0')}:00 with ${count(peak.calls)} calls.`,
      detail: `${count(peak.urgent)} of them P1 or P2 — the hour that decides call-taker rostering.`,
    });
  }

  return out;
}

export function CallCentreTab() {
  const f = useFilters();
  const q = toQuery(f);
  const result = useInsight(`callcentre:${filterKey(f)}`, () =>
    api.insights.callCentre({ days: windowDays(f), ahead: horizonHours(f) || 24 }, q));
  const r = result.data;

  return (
    <div className={`insights__callcentre${result.stale ? ' is-stale' : ''}`}>
      <p className="pillar__sub">{t('insights.callcentre.sub')}</p>
      <FilterBar />

      {result.loading && <Skeleton height={300} />}
      {result.error && <ErrorState body={result.error} />}

      {r && (() => {
        // The hourly profile: measured across the whole window against the same hours
        // forecast for tomorrow. Two series on one axis, because "is tomorrow's 19:00
        // going to be worse than the 19:00s we have seen" is the actual question.
        // Per day on both sides: the measured profile averaged over the window, against
        // the same hours forecast for tomorrow.
        const hourly = [
          { name: t('insights.callcentre.allCalls'), points: r.hourly.map((h) => ({ x: h.hour, y: h.callsPerDay })) },
          { name: 'P1/P2', points: r.hourly.map((h) => ({ x: h.hour, y: h.urgentPerDay })), tone: 'var(--app-danger)' },
        ];
        if (f.predict) {
          const pred = r.hourly.filter((h) => h.predictedCalls != null);
          if (pred.length) {
            hourly.push({
              name: t('insights.callcentre.tomorrow'),
              tone: 'var(--series-3)',
              dashed: true,
              points: pred.map((h) => ({ x: h.hour, y: h.predictedCalls })),
              band: f.interval
                ? pred.map((h) => ({ x: h.hour, lower: h.lower80 ?? h.predictedCalls!, upper: h.upper80 ?? h.predictedCalls! }))
                : undefined,
            } as typeof hourly[number]);
          }
        }

        const dayTrend = buildTrend([{
          name: t('kpi.calls'), actual: r.daily,
          forecast: f.predict ? r.forecastDaily : undefined,
          labelKey: 'day', valueKey: 'calls', interval: f.interval,
        }]);

        return (
          <>
            <div className="insights__kpirow">
              <Card><StatTile label={t('insights.callcentre.total')} value={count(r.totals.calls)} unit="calls" sub={`${count(r.totals.perDay)} calls a day`}
                spark={r.daily.map((x) => x.calls)}
                sparkForecast={f.predict ? r.forecastDaily.map((x) => x.calls) : undefined}
                predicted={f.predict && r.forecastDaily[0] ? `${count(r.forecastDaily[0].calls)} calls` : undefined}
                predictedLabel={t('insights.callcentre.fullDay')} /></Card>
              <Card><StatTile label={t('insights.callcentre.dispatched')} value={count(r.totals.dispatched)} unit="calls"
                sub={r.totals.untriaged ? t('insights.callcentre.untriaged', { n: r.totals.untriaged }) : undefined} /></Card>
              <Card><StatTile label={t('insights.callcentre.handlingP50')} value={duration(r.totals.callHandlingP50Sec)} unit={durationUnit(r.totals.callHandlingP50Sec)} /></Card>
              <Card><StatTile label={t('insights.callcentre.peakHour')}
                value={r.predictedPeakHour ? `${String(r.predictedPeakHour.hour).padStart(2, '0')}:00` : '—'} unit={r.predictedPeakHour ? 'GST' : undefined}
                sub={r.predictedPeakHour ? t('insights.callcentre.peakSub', { n: r.predictedPeakHour.calls }) : undefined}
                predictedLabel={t('chart.tomorrow')} /></Card>
            </div>

            <AdvisoryStrip findings={callCentreFindings(r)} note="Computed from this page's own intake mix." />

            <Card title={t('insights.callcentre.hourly')} subtitle={t('insights.callcentre.hourlySub')}
                  actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
              <LineChart series={hourly} xLabels={(x) => `${String(x).padStart(2, '0')}:00`} xTickEvery={2}
                         yFormat={(v) => decimal1(v)}
                         onSelectX={(hour) => pickHour(f, hour)} />
              <FilterNote filters={r.filters} />
              <ForecastNote meta={r.forecastMeta} horizon={r.forecastHourly.length} unit={t('insights.callcentre.hours')}  show={f.predict} />
              <p className="pillar__footnote">{t('insights.callcentre.clickHour')}</p>
            </Card>

            <Card title={t('insights.callcentre.daily')}
                  subtitle={r.partialDay
                    ? t('insights.callcentre.dailyPartial', { days: r.window.days, n: count(r.partialDay.calls) })
                    : t('insights.callcentre.dailySub', { days: r.window.days })}>
              <LineChart series={dayTrend.series} height={140} xLabels={(x) => shortDay(dayTrend.labels[x] ?? '')}
                         forecastFromX={f.predict ? dayTrend.forecastFromX : null} />
              <ForecastNote meta={{ ...r.forecastMeta.daily, caveats: [] }} horizon={r.forecastDaily.length} unit={t('insights.overview.days')}  show={f.predict} />
            </Card>

            <div className="pillar__grid">
              <Card title={t('insights.callcentre.sources')} subtitle={t('chart.clickToFilter')}>
                <BarList items={r.sources.map((s) => ({ key: s.source, label: SOURCE_LABEL[s.source] ?? s.source, value: s.calls }))}
                         format={count} selected={f.source} onSelect={(v) => toggleValue(f, 'source', v)} />
              </Card>
              <Card title={t('insights.callcentre.classes')} subtitle={t('insights.callcentre.classesSub')}>
                <BarList items={r.classes.map((c) => ({ label: CLASS_LABEL[c.bucket] ?? c.bucket, value: c.calls }))}
                         format={count} tone="var(--series-3)" />
              </Card>
              <Card title={t('insights.callcentre.complaints')} subtitle={t('chart.clickToFilter')} className="pillar__span2">
                {r.complaints.length ? (
                  <BarList items={r.complaints.map((c) => ({
                    key: c.complaint, label: complaintLabel(c.complaint), value: c.calls,
                    detail: t('insights.callcentre.complaintDetail', { n: c.urgent }),
                  }))} format={count} tone="var(--series-5)"
                    selected={f.complaint} onSelect={(v) => toggleValue(f, 'complaint', v)} />
                ) : <EmptyState title={t('common.noData')} />}
              </Card>
            </div>
          </>
        );
      })()}
    </div>
  );
}
