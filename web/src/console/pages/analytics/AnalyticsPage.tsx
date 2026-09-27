/**
 * Analytics — Pillar 3. docs/06 §4, docs/08 §2.2 / §3.1 / §3.3 / §3.9.
 *
 * Seven tabs over the Phase 6 engines. Each takes the universal filter and honours the
 * part of it that is meaningful for that engine — coverage is a computation about the fleet
 * NOW, so a historical window means nothing to it. What an engine cannot slice by it
 * reports in `filters.ignored`, and the bar greys those dimensions out rather than
 * appearing to apply them: a filter that looks applied and is not is worse than no filter.
 *
 * Every number here is either a direct measurement or clearly marked as a forecast.
 */

import { useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, Segmented, EmptyState, ErrorState, Skeleton, Chip } from '../../../shared/ui';
import { BarList, LineChart, StatTile, FactorBars, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue } from '../../../shared/filters/actions';
import { type ChartFilters, useFilters, filterKey, toQuery, windowDays, horizonDays } from '../../../lib/filters';
import { duration, durationLong, pct, decimal1, count as fmtCount, time as fmtTime } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import '../pillar.scss';

type Tab = 'demand' | 'risk' | 'anomaly' | 'equity' | 'coverage' | 'crowd' | 'preempt';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'demand', label: 'Demand' }, { value: 'risk', label: 'Risk' }, { value: 'anomaly', label: 'Anomaly' },
  { value: 'equity', label: 'Equity' }, { value: 'coverage', label: 'Coverage' }, { value: 'crowd', label: 'Crowd' },
  { value: 'preempt', label: 'Pre-empt' },
];

/**
 * What each engine can actually slice by. Everything else is hidden from the bar while
 * that tab is open, with the reason printed under it.
 */
const HONOURS: Record<Tab, { keeps: Array<keyof ChartFilters>; why: string }> = {
  demand: { keeps: ['zone', 'zoneClass'], why: 'analytics.only.demand' },
  risk: { keeps: ['zone', 'zoneClass'], why: 'analytics.only.risk' },
  anomaly: { keeps: ['zone', 'zoneClass'], why: 'analytics.only.anomaly' },
  equity: { keeps: [], why: 'analytics.only.equity' },
  coverage: { keeps: [], why: 'analytics.only.coverage' },
  crowd: { keeps: ['zone'], why: 'analytics.only.crowd' },
  preempt: { keeps: [], why: 'analytics.only.preempt' },
};

const ALL_DIMENSIONS: Array<keyof ChartFilters> = [
  'kind', 'priority', 'source', 'outcome', 'zone', 'zoneClass', 'unitKind', 'agency', 'station',
  'complaint', 'escalation', 'dow', 'hourFrom', 'floorMin', 'acuityMin', 'responseMinSec',
  'withinTarget', 'highrise', 'transported', 'multiAgency',
];

interface TabState { data: unknown; error: string | null }

export function AnalyticsPage() {
  const f = useFilters();
  const [tab, setTab] = useState<Tab>('demand');
  const [cache, setCache] = useState<Record<string, TabState>>({});
  const request = `${tab}#${filterKey(f)}`;

  useEffect(() => {
    if (cache[request] !== undefined) return;
    let cancelled = false;
    fetchTab(tab, f)
      .then((r) => { if (!cancelled) setCache((c) => ({ ...c, [request]: { data: r, error: null } })); })
      .catch((e: { message?: string }) => { if (!cancelled) setCache((c) => ({ ...c, [request]: { data: null, error: e.message ?? 'Failed to load' } })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const state = cache[request];
  // Every tab × filter combination is cached, so switching back is instant; while a new
  // combination loads, the last one stays on screen dimmed rather than blanking.
  const lastKey = [...Object.keys(cache)].filter((k) => k.startsWith(`${tab}#`)).at(-1);
  const shown = state ?? (lastKey ? cache[lastKey] : undefined);
  const loading = shown === undefined;
  const stale = state === undefined && shown !== undefined;
  const error = shown?.error ?? null;
  const hidden = ALL_DIMENSIONS.filter((k) => !HONOURS[tab].keeps.includes(k));

  return (
    <div className={`pillar${stale ? ' is-stale' : ''}`}>
      <div className="pillar__head">
        <h1 className="pillar__title"><MapIcon aria-hidden /> {t('analytics.title')}</h1>
        <Segmented value={tab} onChange={setTab} ariaLabel="Analytics tab" options={TABS} />
      </div>

      <FilterBar hidden={hidden} note={t(HONOURS[tab].why)} />

      {error && <ErrorState body={error} />}
      {loading && <Skeleton height={240} />}
      {!loading && !error && (
        <>
          {tab === 'demand' && <DemandTab data={shown!.data as DemandData} f={f} />}
          {tab === 'risk' && <RiskTab data={shown!.data as RiskData} f={f} />}
          {tab === 'anomaly' && <AnomalyTab data={shown!.data as AnomalyData} f={f} />}
          {tab === 'equity' && <EquityTab data={shown!.data as EquityData} />}
          {tab === 'coverage' && <CoverageTab data={shown!.data as CoverageData} />}
          {tab === 'crowd' && <CrowdTab data={shown!.data as CrowdData} />}
          {tab === 'preempt' && <PreemptTab data={shown!.data as PreemptData} />}
        </>
      )}
    </div>
  );
}

function fetchTab(tab: Tab, f: ChartFilters): Promise<unknown> {
  const q = toQuery(f);
  switch (tab) {
    // The horizon control drives the demand model's own lookahead, in hours.
    case 'demand': return api.analytics.demand({ hours: Math.min(336, Math.max(6, horizonDays(f) * 24 || 24)), days: 30 }, q);
    case 'risk': return api.analytics.risk({ limit: 60 }, q);
    case 'anomaly': return api.analytics.anomaly({ hours: Math.min(2160, Math.max(48, windowDays(f) * 24)), ahead: Math.min(72, horizonDays(f) * 24 || 12) }, q);
    case 'equity': return api.analytics.equity(q);
    case 'coverage': return api.analytics.coverage(q);
    case 'crowd': return api.analytics.crowd(q);
    case 'preempt': return api.analytics.preempt(q);
  }
}

type Envelope = { describe: Array<{ label: string; value: string }>; active: boolean; summary: string; ignored?: string[] };

// ── Demand ───────────────────────────────────────────────────────────────────

interface DemandData {
  accuracy: { n: number; mae: number; bias: number; intervalCoveragePct: number } | null;
  forecast: Array<{ zoneRef: string; zoneName: string; bucketStart: string; predicted: number; lower80: number; upper80: number }>;
  byZone: Array<{ zoneRef: string; zoneName: string; zoneClass: string; predicted: number; lower80: number; upper80: number; buckets: number }>;
  byBucket: Array<{ bucketStart: string; predicted: number; lower80: number; upper80: number }>;
  horizonHours: number;
  accuracyWindowDays: number;
  method: string;
  filters: Envelope;
}

function DemandTab({ data, f }: { data: DemandData; f: ChartFilters }) {
  if (!data) return null;
  const top = data.byZone.slice(0, 12).map((z) => ({
    key: z.zoneRef,
    label: z.zoneName,
    value: z.predicted,
    detail: `80% interval ${decimal1(z.lower80)} – ${decimal1(z.upper80)} calls over ${z.buckets} hourly buckets`,
  }));

  // The whole forecast is the future, so there is no measured segment: the line is dashed
  // from end to end and the band is the point of the chart.
  const curve = [{
    name: t('analytics.demand.expected'),
    dashed: true,
    points: data.byBucket.map((b, i) => ({ x: i, y: b.predicted })),
    band: f.interval ? data.byBucket.map((b, i) => ({ x: i, lower: b.lower80, upper: b.upper80 })) : undefined,
  }];
  const labels = data.byBucket.map((b) => fmtTime(b.bucketStart));

  return (
    <>
      <div className="pillar__grid">
        <Card title={t('analytics.demand.heldToAccount')} subtitle={t('analytics.demand.heldSub', { days: data.accuracyWindowDays })} simulated>
          {data.accuracy ? (
            <div className="pillar__kpirow">
              <StatTile label="MAE" value={decimal1(data.accuracy.mae)} unit="calls/hr" />
              <StatTile label={t('analytics.demand.bias')} value={decimal1(data.accuracy.bias)} unit="calls/hr" deltaGood={Math.abs(data.accuracy.bias) < 0.5} />
              <StatTile label={t('analytics.demand.coverage')} value={pct(data.accuracy.intervalCoveragePct)} unit="inside interval"
                sub={t('analytics.demand.coverageSub')} />
              <StatTile label="Sample" value={fmtCount(data.accuracy.n)} unit="zone-hours" />
            </div>
          ) : (
            <EmptyState title={t('analytics.demand.noHistory')} body={t('analytics.demand.noHistoryBody')} />
          )}
        </Card>
        <Card title={t('analytics.demand.topZones', { hours: data.horizonHours })} subtitle={t('chart.clickToFilter')}
              actions={<PredictionLegend interval={f.interval} />}>
          {top.length === 0 ? <EmptyState title={t('analytics.demand.noForecast')} /> : (
            <BarList items={top} format={(v) => decimal1(v)}
                     selected={f.zone} onSelect={(v) => toggleValue(f, 'zone', v)} />
          )}
          <FilterNote filters={data.filters} />
        </Card>
      </div>

      <Card title={t('analytics.demand.curve', { hours: data.horizonHours })} subtitle={t('analytics.demand.curveSub')}>
        {data.byBucket.length === 0 ? <EmptyState title={t('analytics.demand.noForecast')} /> : (
          <LineChart series={curve} height={150} xLabels={(x) => labels[x] ?? ''}
                     forecastFromX={0} yFormat={(v) => decimal1(v)} />
        )}
        {/* Not gated on the prediction switch: this tab's ENTIRE content is the demand
            model's output, so the line is drawn either way and the note is what keeps it
            honest. Switching prediction off cannot empty a forecast tab. */}
        <ForecastNote meta={{ method: data.method, caveats: [], mae: data.accuracy?.mae ?? null, coverage80Pct: data.accuracy?.intervalCoveragePct ?? null }}
                      horizon={data.horizonHours} unit={t('insights.callcentre.hours')} />
      </Card>
    </>
  );
}

// ── Risk ─────────────────────────────────────────────────────────────────────

interface RiskCell { cellRef: string; zoneRef: string; zoneName: string; hourBand: number; score: number; factors: Record<string, number> }
interface RiskData { cells: RiskCell[]; filters: Envelope; hourBand: number | null }

const HOUR_BAND_LABEL = ['Weekday night', 'Weekday morning', 'Weekday day', 'Weekday evening', 'Weekend day', 'Weekend night'];

function RiskTab({ data, f }: { data: RiskData; f: ChartFilters }) {
  if (!data) return null;
  const byZone = new Map<string, { ref: string; score: number }>();
  for (const c of data.cells) {
    const cur = byZone.get(c.zoneName);
    if (!cur || c.score > cur.score) byZone.set(c.zoneName, { ref: c.zoneRef, score: c.score });
  }
  const top = [...byZone.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 12)
    .map(([label, v]) => ({ key: v.ref, label, value: v.score }));
  const bandNow = data.cells[0]?.hourBand;

  return (
    <div className="pillar__grid">
      <Card title={t('analytics.risk.top')} subtitle={bandNow != null ? HOUR_BAND_LABEL[bandNow] : undefined} simulated>
        {top.length === 0 ? <EmptyState title={t('analytics.risk.none')} /> : (
          <BarList items={top} format={(v) => decimal1(v)}
                   selected={f.zone} onSelect={(v) => toggleValue(f, 'zone', v)} />
        )}
        <FilterNote filters={data.filters} />
      </Card>
      <Card title={t('analytics.risk.factors')}>
        {data.cells[0] ? (
          <FactorBars factors={Object.entries(data.cells[0].factors).map(([name, v]) => ({ name, contribution: v }))} />
        ) : <EmptyState title={t('common.noData')} />}
        <p className="pillar__footnote">{t('analytics.risk.method')}</p>
      </Card>
    </div>
  );
}

// ── Anomaly ──────────────────────────────────────────────────────────────────

interface AnomalyZone {
  zoneRef: string; zoneName: string;
  result: { value: { latestZ: number; sustained: boolean; direction: string; latestValue: number; median: number } | null; meta?: { insufficient?: boolean } };
  series: Array<{ bucket: string; calls: number }>;
  forecast: Array<{ h: number; calls: number; lower80: number; upper80: number }>;
  forecastMeta: { method: string; mae: number | null; mape: number | null; coverage80Pct: number | null; caveats: string[] };
}
interface AnomalyData { zones: AnomalyZone[]; hours: number; filters: Envelope }

function AnomalyTab({ data, f }: { data: AnomalyData; f: ChartFilters }) {
  if (!data) return null;
  const scored = data.zones.filter((z) => z.result.value);
  const sustained = scored.filter((z) => z.result.value!.sustained);
  const items = scored.slice(0, 12).map((z) => ({
    key: z.zoneRef,
    label: z.zoneName,
    value: z.result.value!.latestZ,
    tone: z.result.value!.sustained ? 'var(--app-danger)' : undefined,
    detail: `now ${decimal1(z.result.value!.latestValue)} against a baseline of ${decimal1(z.result.value!.median)} calls/hour`,
  }));

  // The worst-deviating zone gets its own series and forecast: "is this about to persist"
  // is the question an anomaly raises, and only a forecast answers it.
  const focus = sustained[0] ?? scored[0] ?? null;
  const focusSeries = focus ? [
    {
      name: t('analytics.anomaly.measured'),
      points: focus.series.map((p, i) => ({ x: i, y: p.calls })),
    },
    ...(f.predict && focus.forecast.length ? [{
      name: t('chart.forecast'),
      dashed: true,
      points: [
        { x: focus.series.length - 1, y: focus.series.at(-1)?.calls ?? 0 },
        ...focus.forecast.map((p) => ({ x: focus.series.length - 1 + p.h, y: p.calls })),
      ],
      band: f.interval ? [
        { x: focus.series.length - 1, lower: focus.series.at(-1)?.calls ?? 0, upper: focus.series.at(-1)?.calls ?? 0 },
        ...focus.forecast.map((p) => ({ x: focus.series.length - 1 + p.h, lower: p.lower80, upper: p.upper80 })),
      ] : undefined,
    }] : []),
  ] : [];

  return (
    <>
      <div className="pillar__grid">
        <Card title={t('analytics.anomaly.sustained')} subtitle={t('analytics.anomaly.sustainedSub')} simulated>
          {sustained.length === 0 ? (
            <EmptyState title={t('analytics.anomaly.nothing')} body={t('analytics.anomaly.nothingBody')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
              {sustained.map((z) => (
                <Chip key={z.zoneRef} tone={Math.abs(z.result.value!.latestZ) > 5 ? 'danger' : 'warning'}>
                  {z.zoneName}: {z.result.value!.direction === 'up' ? '↑' : '↓'} z={decimal1(z.result.value!.latestZ)} (now {decimal1(z.result.value!.latestValue)}, baseline {decimal1(z.result.value!.median)})
                </Chip>
              ))}
            </div>
          )}
        </Card>
        <Card title={t('analytics.anomaly.byZone')} subtitle={t('chart.clickToFilter')}>
          <BarList items={items} format={(v) => decimal1(v)}
                   selected={f.zone} onSelect={(v) => toggleValue(f, 'zone', v)} />
          <FilterNote filters={data.filters} />
        </Card>
      </div>

      {focus && (
        <Card title={t('analytics.anomaly.focus', { zone: focus.zoneName })} subtitle={t('analytics.anomaly.focusSub')}
              actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
          <LineChart series={focusSeries} height={150} xTickEvery={12}
                     xLabels={(x) => (x < focus.series.length ? fmtTime(focus.series[x]?.bucket) : `+${x - focus.series.length + 1}h`)}
                     forecastFromX={f.predict && focus.forecast.length ? focus.series.length - 1 : null} />
          <ForecastNote meta={focus.forecastMeta} horizon={focus.forecast.length} unit={t('insights.callcentre.hours')}  show={f.predict} />
        </Card>
      )}
    </>
  );
}

// ── Equity ───────────────────────────────────────────────────────────────────

interface EquityZone { zoneRef: string; zoneName: string; p90ResponseSec: number; expectedP90Sec: number; residualSec: number; excessOverEmiratePct: number; flagged: boolean; classification: string }
interface EquityData { value: { zones: EquityZone[]; emirateP90Sec: number } | null; meta?: { insufficient?: boolean }; filters: Envelope }

function EquityTab({ data }: { data: EquityData }) {
  if (!data) return null;
  if (!data.value) return <EmptyState title={t('analytics.equity.insufficient')} />;
  const flagged = data.value.zones.filter((z) => z.flagged).sort((a, b) => b.residualSec - a.residualSec);
  return (
    <div className="pillar__grid pillar__span2">
      <Card title={t('analytics.equity.title')} subtitle={t('analytics.equity.sub', { time: duration(data.value.emirateP90Sec) })} className="pillar__span2" simulated>
        {flagged.length === 0 ? (
          <EmptyState title={t('analytics.equity.none')} body={t('analytics.equity.noneBody')} />
        ) : (
          <table className="pillar__table">
            <thead><tr><th>Zone</th><th>Actual p90</th><th>Expected (by distance)</th><th>Excess</th></tr></thead>
            <tbody>
              {flagged.map((z) => (
                <tr key={z.zoneRef}>
                  <td>{z.zoneName}</td>
                  <td className="mono">{duration(z.p90ResponseSec)}</td>
                  <td className="mono">{duration(z.expectedP90Sec)}</td>
                  <td><Chip tone="warning">+{Math.round(z.residualSec)}s ({pct(z.excessOverEmiratePct)})</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <FilterNote filters={data.filters} />
      </Card>
    </div>
  );
}

// ── Coverage ─────────────────────────────────────────────────────────────────

interface CoverageData {
  value: { currentPct: number; optimalPct: number; gapPp: number; perZone: Array<{ zoneRef: string; coverageFrac: number; unitsInRange: number }>; recommendedMove: { unitRef: string; toZoneRef: string; gain: number; costMin: number } | null } | null;
  filters: Envelope;
}

function CoverageTab({ data }: { data: CoverageData }) {
  if (!data?.value) return <EmptyState title={t('analytics.coverage.insufficient')} />;
  const v = data.value;
  const worst = [...v.perZone].sort((a, b) => a.coverageFrac - b.coverageFrac).slice(0, 12)
    .map((z) => ({ key: z.zoneRef, label: z.zoneRef, value: z.coverageFrac * 100, detail: `${z.unitsInRange} unit(s) in range` }));
  return (
    <div className="pillar__grid">
      <Card title={t('analytics.coverage.title')} simulated>
        <div className="pillar__kpirow">
          <StatTile label={t('analytics.coverage.current')} value={pct(v.currentPct)} unit="of demand" />
          <StatTile label={t('analytics.coverage.achievable')} value={pct(v.optimalPct)} unit="of demand"
            predicted={pct(v.optimalPct)} predictedLabel={t('analytics.coverage.afterMove')} />
          <StatTile label={t('analytics.coverage.gap')} value={`${decimal1(v.gapPp)} pp`} deltaGood={v.gapPp < 5} />
        </div>
        {v.recommendedMove && (
          <p className="pillar__footnote">
            {t('analytics.coverage.move', {
              unit: v.recommendedMove.unitRef, zone: v.recommendedMove.toZoneRef,
              min: decimal1(v.recommendedMove.costMin), gain: decimal1(v.recommendedMove.gain),
            })}
          </p>
        )}
        <FilterNote filters={data.filters} />
      </Card>
      <Card title={t('analytics.coverage.weakest')}>
        <BarList items={worst} format={(v2) => pct(v2)} />
      </Card>
    </div>
  );
}

// ── Crowd ────────────────────────────────────────────────────────────────────

interface CrowdEvent { ref: string; name: string; zoneRef: string; result: { value: { los: string; losLabel: string; densityPersonsPerM2: number; leadTimeMin: number | null; emergency: boolean } | null } }
interface CrowdData { events: CrowdEvent[]; filters: Envelope }

function CrowdTab({ data }: { data: CrowdData }) {
  if (!data) return null;
  if (data.events.length === 0) return <EmptyState title={t('analytics.crowd.none')} body={t('analytics.crowd.noneBody')} />;
  return (
    <div className="pillar__grid">
      {data.events.map((e) => (
        <Card key={e.ref} title={e.name} subtitle={e.zoneRef} simulated>
          {e.result.value ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
              <Chip tone={e.result.value.emergency ? 'danger' : e.result.value.los >= 'D' ? 'warning' : 'success'}>
                LoS {e.result.value.los} — {e.result.value.losLabel}
              </Chip>
              <div>{decimal1(e.result.value.densityPersonsPerM2)} persons/m²</div>
              {e.result.value.leadTimeMin != null && (
                <div className="is-bad">{t('analytics.crowd.lead', { min: decimal1(e.result.value.leadTimeMin) })}</div>
              )}
            </div>
          ) : <EmptyState title={t('analytics.crowd.noFootfall')} />}
        </Card>
      ))}
    </div>
  );
}

// ── Pre-empt ─────────────────────────────────────────────────────────────────

interface PreemptData {
  value: { requests: number; granted: number; grantPct: number; meanSavedSec: number; pctOfTotal: number | null; byCorridor: Array<{ corridor: string | null; signalRef: string; requests: number; grantPct: number; meanSavedSec: number }> } | null;
  filters: Envelope;
}

function PreemptTab({ data }: { data: PreemptData }) {
  if (!data?.value) return <EmptyState title={t('analytics.preempt.none')} body={t('analytics.preempt.noneBody')} />;
  const v = data.value;
  const items = v.byCorridor.slice(0, 12).map((c) => ({
    label: c.corridor ?? c.signalRef,
    value: c.meanSavedSec,
    detail: `${c.grantPct.toFixed(0)}% granted, ${c.requests} requests`,
  }));
  return (
    <div className="pillar__grid">
      <Card title={t('analytics.preempt.title')} subtitle={t('analytics.preempt.sub')} simulated>
        <div className="pillar__kpirow">
          <StatTile label={t('analytics.preempt.requests')} value={fmtCount(v.requests)} unit="requests" sub={v.pctOfTotal != null ? `${decimal1(v.pctOfTotal)}% of assignments` : undefined} />
          <StatTile label={t('analytics.preempt.grantRate')} value={pct(v.grantPct)} unit="granted" />
          <StatTile label={t('analytics.preempt.meanSaved')} value={durationLong(v.meanSavedSec)} />
        </div>
        <FilterNote filters={data.filters} />
      </Card>
      <Card title={t('analytics.preempt.corridors')}>
        <BarList items={items} format={(x) => durationLong(x)} />
      </Card>
    </div>
  );
}
