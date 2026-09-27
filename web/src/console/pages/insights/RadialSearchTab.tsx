/**
 * Radial search — everything within a circle of any point (Concept Note §07).
 *
 * Search by community, by a Makani number, or right-click the map — the same "right-click
 * to act here" convention Operations already uses for creating an incident. The result
 * compares the circle against the emirate: is this address worse than the average, and by
 * how much.
 */

import { useEffect, useMemo, useState } from 'react';
import { Building2, Crosshair, Route, Timer } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { Card, ErrorState, Field, Skeleton, EmptyState, AdvisoryStrip, type Finding } from '../../../shared/ui';
import { BarList, Histogram, LineChart, StatTile, ForecastNote, FilterNote, PredictionLegend } from '../../../shared/charts';
import { buildTrend, shortMonth } from '../../../shared/charts/series';
import { FilterBar } from '../../../shared/filters/FilterBar';
import { toggleValue, pickHour } from '../../../shared/filters/actions';
import { useFilters, filterKey, toQuery, windowMonths, horizonMonths } from '../../../lib/filters';
import { count, duration, floorLabel, makani as fmtMakani, pct, timeGst, SOURCE_LABEL, durationUnit } from '../../../lib/format';
import type { RadialResult } from '../../../lib/types';
import { DemandSurface } from './DemandSurface';
import { PriorityPanel } from './PriorityPanel';
import { useInsight } from './useInsight';

const RADII = [250, 500, 750, 1000, 1500, 2000];
const kindLabel = (k: string) => { const s = t(`kind.${k}`); return s === `kind.${k}` ? k.replace(/_/g, ' ') : s; };

/** Findings over the circle the operator has drawn — everything relative to the emirate. */
function radialFindings(r: RadialResult): Finding[] {
  const out: Finding[] = [];

  // A single address generating repeat calls is the most actionable thing on this page.
  const worst = r.buildings[0];
  if (worst && worst.calls >= 5) {
    out.push({
      id: 'building-hotspot',
      tone: 'warning',
      icon: Building2,
      headline: `${worst.name} generated ${count(worst.calls)} calls on its own.`,
      detail: `${count(worst.urgent)} urgent${worst.floors ? ` · ${floorLabel(worst.floors)}` : ''} — one address worth a site visit.`,
    });
  }

  // Is this circle genuinely slower than the city, or does it only feel that way?
  if (r.totals.p50Sec != null && r.emirate.p50Sec != null) {
    const diff = r.totals.p50Sec - r.emirate.p50Sec;
    if (Math.abs(diff) >= 20) {
      out.push({
        id: 'vs-emirate',
        tone: diff > 0 ? 'critical' : 'success',
        icon: Timer,
        headline: `Responses here run ${duration(Math.abs(diff))} ${diff > 0 ? 'slower' : 'faster'} than the emirate.`,
        detail: `${duration(r.totals.p50Sec)} median against ${duration(r.emirate.p50Sec)} city-wide.`,
      });
    }
  }

  // High-rise share explains a slow circle that road distance cannot.
  if (r.totals.calls > 0 && r.totals.highriseCalls > 0) {
    const share = (r.totals.highriseCalls / r.totals.calls) * 100;
    if (share >= 20) {
      out.push({
        id: 'highrise-share',
        tone: 'warning',
        icon: Building2,
        headline: `${pct(share)} of calls here are above the 20th floor.`,
        detail: 'Vertical access lands after the response clock has already stopped.',
      });
    }
  }

  const nearest = r.nearestStations[0];
  if (nearest) {
    out.push({
      id: 'nearest-station',
      tone: 'info',
      icon: Route,
      headline: `Nearest station is ${nearest.name}, ${(nearest.distanceM / 1000).toFixed(1)} km out.`,
      detail: `${r.nearestStations.length} stations within reach of this circle.`,
    });
  }

  return out;
}

interface Community { ref: string; name: string; lng: number; lat: number }

export function RadialSearchTab() {
  const f = useFilters();
  const q = toQuery(f);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [centre, setCentre] = useState<{ lng: number; lat: number; label: string } | null>(null);
  const [radius, setRadius] = useState(750);
  const [makaniInput, setMakaniInput] = useState('');
  const [makaniError, setMakaniError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.zones({ level: 'community', geometry: 'centroid' }).then((fc) => {
      if (cancelled) return;
      const list = fc.features
        .map((f) => {
          const g = f.geometry as { type: string; coordinates: [number, number] } | null;
          if (g?.type !== 'Point') return null;
          return { ref: String(f.properties.ref), name: String(f.properties.name), lng: g.coordinates[0], lat: g.coordinates[1] };
        })
        .filter((x): x is Community => !!x)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCommunities(list);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The filter is part of the request key: changing a filter has to re-run the circle,
  // otherwise the map and the panels below it would disagree about what is being shown.
  const key = centre ? `${centre.lng.toFixed(5)},${centre.lat.toFixed(5)}:${radius}:${filterKey(f)}` : '';
  const result = useInsight(key, () => (centre
    ? api.insights.radial({
      lng: centre.lng, lat: centre.lat, radius,
      months: windowMonths(f, 1, 36), ahead: horizonMonths(f),
    }, q)
    : Promise.resolve(null)));

  // The calls inside the circle, for the surface's "individual calls" mode.
  const circlePoints = useMemo(
    () => (result.data?.incidents ?? []).map((i) => ({ ref: i.ref, priority: i.priority, lng: i.lng, lat: i.lat })),
    [result.data],
  );

  async function locateMakani() {
    setMakaniError(null);
    setLocating(true);
    try {
      const p = await api.makani(makaniInput);
      setCentre({ lng: p.lng, lat: p.lat, label: p.buildingName ?? fmtMakani(p.makani) });
    } catch (e) {
      setMakaniError((e as ApiError).message);
    } finally {
      setLocating(false);
    }
  }

  const r = result.data;
  /** The busiest hour here — named in the card's subtitle and marked in the bars. */
  const peak = useMemo(
    () => (r?.hourly ?? []).reduce<{ hour: number; calls: number } | null>(
      (best, h) => (best == null || h.calls > best.calls ? { hour: h.hour, calls: h.calls } : best), null),
    [r],
  );
  const peakHour = peak && peak.calls > 0 ? peak.hour : null;
  const peakCalls = peak?.calls ?? 0;
  const topBuilding = Math.max(1, ...(r?.buildings ?? []).map((b) => b.calls));

  const trend = useMemo(() => buildTrend([{
    name: t('kpi.calls'),
    actual: r?.trend ?? [],
    forecast: f.predict ? r?.forecast : undefined,
    labelKey: 'month', valueKey: 'calls', interval: f.interval,
  }]), [r, f.predict, f.interval]);

  return (
    <div className={`insights__radial${result.stale ? ' is-stale' : ''}`}>
      <FilterBar note={t('insights.radial.emirateNote')} />

      <Card title={t('insights.radial.where')} flush>
        <div className="insights__radial-controls">
          <Field label={t('insights.radial.community')}>
            <select value="" onChange={(e) => {
              const c = communities.find((x) => x.ref === e.target.value);
              if (c) setCentre({ lng: c.lng, lat: c.lat, label: c.name });
            }}>
              <option value="">{t('insights.radial.pick')}</option>
              {communities.map((c) => <option key={c.ref} value={c.ref}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t('create.makani')} error={makaniError ?? undefined}>
            <div className="insights__radial-makani">
              <input value={makaniInput} onChange={(e) => setMakaniInput(e.target.value)} placeholder="e.g. 2797875860" inputMode="numeric" />
              <button type="button" className="u-btn u-btn--secondary u-btn--sm" disabled={locating || makaniInput.length < 8} onClick={() => void locateMakani()}>
                {t('insights.radial.locate')}
              </button>
            </div>
          </Field>
          <div className="insights__radial-radii">
            <span className="insights__radial-radii-label">{t('insights.radial.radius')}</span>
            {RADII.map((m) => (
              <button key={m} type="button" aria-pressed={radius === m} onClick={() => setRadius(m)}>
                {m >= 1000 ? `${m / 1000}km` : `${m}m`}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title={t('insights.geo.title')} subtitle={t('insights.geo.subtitle')} flush>
        <DemandSurface centre={centre} radiusM={radius} points={circlePoints}
                       stations={r?.nearestStations} onPickPlace={setCentre} />
      </Card>

      {!centre && <EmptyState icon={<Crosshair aria-hidden />} title={t('insights.radial.empty')} body={t('insights.radial.emptyBody')} />}
      {centre && result.loading && <Skeleton height={200} />}
      {centre && result.error && <ErrorState body={result.error} />}

      {centre && r && (
        <>
          <div className="insights__kpirow">
            <Card><StatTile label={t('insights.radial.calls')} value={count(r.totals.calls)} unit="calls" sub={t('insights.radial.perWeek', { n: r.totals.perWeek })}
              spark={r.trend.map((x) => x.calls)}
              sparkForecast={f.predict ? r.forecast.map((x) => x.calls) : undefined}
              predicted={f.predict && r.forecast.at(-1) ? `${count(r.forecast.at(-1)!.calls)} calls` : undefined}
              predictedLabel={t('chart.nextMonths', { n: r.forecast.length })} /></Card>
            <Card><StatTile label={t('kpi.responseP50')} value={duration(r.totals.p50Sec)} unit={durationUnit(r.totals.p50Sec)}
              delta={r.totals.p50Sec != null && r.emirate.p50Sec != null ? `${r.totals.p50Sec > r.emirate.p50Sec ? '+' : ''}${r.totals.p50Sec - r.emirate.p50Sec} sec ${t('insights.radial.vsSlice')}` : null}
              deltaGood={r.totals.p50Sec != null && r.emirate.p50Sec != null ? r.totals.p50Sec <= r.emirate.p50Sec : null} /></Card>
            <Card><StatTile label={t('kpi.withinTarget')} value={pct(r.totals.withinTargetPct)} unit="of responses"
              delta={r.totals.withinTargetPct != null && r.emirate.withinTargetPct != null ? `${r.totals.withinTargetPct - r.emirate.withinTargetPct >= 0 ? '+' : ''}${(r.totals.withinTargetPct - r.emirate.withinTargetPct).toFixed(1)}pt ${t('insights.radial.vsSlice')}` : null}
              deltaGood={r.totals.withinTargetPct != null && r.emirate.withinTargetPct != null ? r.totals.withinTargetPct >= r.emirate.withinTargetPct : null} /></Card>
            <Card><StatTile label={t('insights.radial.highrise')} value={count(r.totals.highriseCalls)} unit="calls" sub={t('insights.radial.highriseSub')} /></Card>
          </div>

          <AdvisoryStrip findings={radialFindings(r)} note="Computed from this circle against the emirate." />

          <Card title={t('insights.prio.title')} subtitle={t('insights.prio.subtitle')} flush>
            <PriorityPanel rows={r.byPriority} selected={f.priority}
                           onSelect={(v) => toggleValue(f, 'priority', v)} />
          </Card>

          <div className="pillar__grid">
            <Card title={t('insights.radial.byKind')} subtitle={t('chart.clickToFilter')}>
              <BarList items={r.byKind.map((k) => ({ key: k.kind, label: kindLabel(k.kind), value: k.calls }))} format={count}
                       selected={f.kind} onSelect={(v) => toggleValue(f, 'kind', v)} />
            </Card>
            <Card title={t('insights.radial.bySource')} subtitle={t('chart.clickToFilter')}>
              <BarList items={r.bySource.map((x) => ({ key: x.source, label: SOURCE_LABEL[x.source] ?? x.source, value: x.calls }))}
                       format={count} tone="var(--series-3)"
                       selected={f.source} onSelect={(v) => toggleValue(f, 'source', v)} />
            </Card>
            <Card title={t('insights.radial.trend')} subtitle={t('insights.radial.trendSub', { months: r.window.months })}
                  actions={<PredictionLegend interval={f.predict ? f.interval : 0} />}>
              <LineChart series={trend.series} height={130} xLabels={(x) => shortMonth(trend.labels[x] ?? '')}
                         forecastFromX={f.predict ? trend.forecastFromX : null} />
              <ForecastNote meta={r.forecastMeta} horizon={r.forecast.length} unit={t('insights.radial.months')}  show={f.predict} />
            </Card>
            <Card title={t('insights.radial.hourly')}
                  subtitle={peakHour == null ? t('insights.radial.hourlySub')
                    : t('insights.radial.hourlyPeak', { hour: String(peakHour).padStart(2, '0'), n: count(peakCalls) })}
                  className="pillar__span2">
              {/* An hour of the day is a category, not a position on a continuum: bars can
                  be compared and clicked one by one, and the busiest hour is marked rather
                  than left to be found by eye. */}
              <Histogram bins={r.hourly.map((h) => ({
                key: String(h.hour),
                label: String(h.hour).padStart(2, '0'),
                value: h.calls,
                highlight: h.hour === peakHour,
              }))} format={count} onSelect={(hour) => pickHour(f, Number(hour))} />
            </Card>
            <Card title={t('insights.radial.stations')}>
              {r.nearestStations.length ? (
                <ul className="insights__list">
                  {r.nearestStations.map((s) => <li key={s.ref}><span>{s.name}</span><span className="mono">{(s.distanceM / 1000).toFixed(1)} km</span></li>)}
                </ul>
              ) : <EmptyState title={t('insights.radial.noStations')} />}
            </Card>
          </div>

          <Card title={t('insights.radial.buildings')} subtitle={t('insights.radial.buildingsSub')} flush>
            {r.buildings.length === 0 ? <EmptyState title={t('insights.radial.noBuildings')} /> : (
              <table className="pillar__table">
                <thead><tr><th>{t('incident.building')}</th><th className="numeric">{t('insights.radial.calls')}</th><th className="numeric">P1/P2</th><th>{t('incident.floor')}</th></tr></thead>
                <tbody>
                  {r.buildings.map((b) => (
                    <tr key={b.name}>
                      <td>{b.name}</td>
                      <td className="numeric">
                        {/* The bar is the comparison; the number is the value. Reading a
                            ranked table without one means comparing digits. */}
                        <span className="insights__cellbar" aria-hidden>
                          <i style={{ width: `${(b.calls / topBuilding) * 100}%` }} />
                        </span>
                        {count(b.calls)}
                      </td>
                      <td className="numeric">{count(b.urgent)}</td>
                      <td>{b.floors ? floorLabel(b.floors) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <FilterNote filters={r.filters} />
          <p className="pillar__footnote">{t('insights.radial.asOf', { time: timeGst(r.at) })}</p>
        </>
      )}
    </div>
  );
}
