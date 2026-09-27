/**
 * The demand surface — the geospatial half of radial search.
 *
 * The radial search answers "what happens inside this circle". This is the screen that
 * decides where to put the circle: two years of calls, binned into hexagons over the
 * emirate and raised into the third dimension, so the ridges of demand along Sheikh Zayed
 * Road and the spikes over individual towers are visible as shapes rather than inferred
 * from a table.
 *
 * Four dials, and they are all VIEW controls, not filters — the filter bar above still owns
 * what data this is (docs/00 D-11):
 *
 *   MODE      3D hexagons · heatmap · the individual calls
 *   MEASURE   volume · urgent share · mean response · share inside target
 *   SIZE      how coarse the hexagons are, 150 m to 1.5 km
 *   HOUR      a time-lapse through the day, from a histogram that arrives with the surface
 *
 * The hour dial is the one that needs saying out loud: it re-weights the SAME window
 * rather than narrowing it, so "02:00" means "the share of this window's calls that came
 * in at 02:00", not "last night". Clicking a hexagon moves the search circle to it, which
 * is the whole point of having both halves on one screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Building2, Crosshair, Flame, Grid3x3, MapPin, Pause, Play } from 'lucide-react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { count, duration, pct } from '../../../lib/format';
import { Skeleton, ErrorState } from '../../../shared/ui';
import { MapCanvas, type MapCanvasHandle } from '../../../shared/map/MapCanvas';
import { createMapView, setLayerData, setVisible, type MapSelection } from '../../../shared/map/layerRegistry';
import { buildingsLayer, radialLayer } from '../../../shared/map/layers';
import { geoDensityLayer, GEO_RAMP, type GeoMode } from '../../../shared/map/layers/geoDensity';
import { bandOf, formatMeasure, hexbin, type GeoMeasure, type HexCell, type HexSurface } from '../../../shared/map/geo/hexbin';
import { useFilters, filterKey, toQuery, windowMonths } from '../../../lib/filters';
import { useInsight } from './useInsight';

const surfaceMap = createMapView('insights-geo', [geoDensityLayer, radialLayer, buildingsLayer], {
  persist: false,
  visible: { buildings: false },
});

const MODES: Array<{ key: GeoMode; label: string; icon: typeof Box }> = [
  { key: 'columns', label: 'insights.geo.mode.columns', icon: Box },
  { key: 'heatmap', label: 'insights.geo.mode.heatmap', icon: Flame },
  { key: 'points', label: 'insights.geo.mode.points', icon: MapPin },
];

const MEASURES: Array<{ key: GeoMeasure; label: string }> = [
  { key: 'calls', label: 'insights.geo.measure.calls' },
  { key: 'urgent', label: 'insights.geo.measure.urgent' },
  { key: 'response', label: 'insights.geo.measure.response' },
  { key: 'target', label: 'insights.geo.measure.target' },
];

const SIZES = [150, 250, 400, 650, 1000, 1500];
/**
 * Height of the TALLEST column, in SCREEN PIXELS (the layer turns it into metres for the
 * current zoom). Everything else is drawn in proportion, so only the ratios carry meaning;
 * this figure is what makes a busy hexagon stand clear of the city without the columns
 * becoming a forest that hides the map they stand on.
 */
const COLUMN_HEIGHT = 130;

export interface DemandSurfaceProps {
  /** The search circle drawn over the surface, when one is set. */
  centre: { lng: number; lat: number } | null;
  radiusM: number;
  /** The DCAS stations that would answer a call in the circle, drawn as arcs onto it. */
  stations?: Array<{ ref: string; name: string; distanceM: number; lng: number; lat: number }>;
  /** The calls inside the circle, for `points` mode. */
  points: Array<{ ref: string; priority: 'P1' | 'P2' | 'P3' | 'P4'; lng: number; lat: number }>;
  /** Clicking a hexagon moves the search here. */
  onPickPlace: (place: { lng: number; lat: number; label: string }) => void;
}

export function DemandSurface({ centre, radiusM, points, stations = [], onPickPlace }: DemandSurfaceProps) {
  const f = useFilters();
  const q = toQuery(f);
  const mapRef = useRef<MapCanvasHandle>(null);

  const [mode, setMode] = useState<GeoMode>('columns');
  const [measure, setMeasure] = useState<GeoMeasure>('calls');
  const [size, setSize] = useState(400);
  const [raised, setRaised] = useState(true);
  const [hour, setHour] = useState<number | null>(null);
  const [buildings, setBuildings] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<{ cell: HexCell; surface: HexSurface } | null>(null);
  const [hover, setHover] = useState<{ cell: HexCell; surface: HexSurface; x: number; y: number } | null>(null);

  // The hour histogram roughly triples the payload, so it is only fetched once the
  // time-lapse is actually wanted.
  const [wantHours, setWantHours] = useState(false);
  const months = windowMonths(f, 1, 36);
  const key = `${filterKey(f)}:${months}:${wantHours ? 'h' : ''}`;
  const geo = useInsight(key, () => api.insights.geo({ months, hours: wantHours }, q));

  const surface = useMemo(
    () => (geo.data ? hexbin(geo.data, { radiusM: size, measure, hour: geo.data.hours ? hour : null }) : null),
    [geo.data, size, measure, hour],
  );

  useEffect(() => {
    setLayerData(surfaceMap, 'geo', {
      surface,
      mode,
      elevation: raised && mode === 'columns' ? COLUMN_HEIGHT : 0,
      points,
      hour: geo.data?.hours ? hour : null,
    });
  }, [surface, mode, raised, points, hour, geo.data?.hours]);

  useEffect(() => {
    setLayerData(surfaceMap, 'radial', {
      centre: centre ? [centre.lng, centre.lat] : null,
      radiusM,
      points: [],
      stations,
    });
  }, [centre, radiusM, stations]);

  // Frame the circle when one is chosen, without taking the emirate view away from an
  // analyst who is reading the whole surface.
  useEffect(() => {
    if (!centre) return;
    const map = mapRef.current?.map();
    const pad = (radiusM * 4) / 111_320;
    map?.fitBounds(
      [[centre.lng - pad, centre.lat - pad], [centre.lng + pad, centre.lat + pad]],
      { duration: 600, maxZoom: 15 },
    );
  }, [centre?.lng, centre?.lat, radiusM]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The city the demand stands in. Off by default — at emirate zoom it is noise, and the
  // surface is the subject; on when the analyst has zoomed into a district and wants to
  // know which tower the column is standing on.
  useEffect(() => { setVisible(surfaceMap, 'buildings', buildings); }, [buildings]);

  // The time-lapse: one hour of the day per step, looping.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setHour((h) => ((h ?? -1) + 1) % 24), 850);
    return () => clearInterval(id);
  }, [playing]);

  const startLapse = () => {
    if (!wantHours) setWantHours(true);
    setPlaying(true);
    if (hour == null) setHour(0);
  };

  const onHover = (h: { selection: MapSelection; point: { x: number; y: number } } | null) => {
    if (!h || h.selection.layerId !== 'geo' || h.selection.kind !== 'hex') { setHover(null); return; }
    const { cell, surface: s } = h.selection.data as { cell: HexCell; surface: HexSurface };
    setHover({ cell, surface: s, x: h.point.x, y: h.point.y });
  };

  const onSelect = (selection: MapSelection | null) => {
    if (!selection || selection.layerId !== 'geo' || selection.kind !== 'hex') { setPicked(null); return; }
    const { cell, surface: s } = selection.data as { cell: HexCell; surface: HexSurface };
    setPicked({ cell, surface: s });
  };

  const loading = geo.loading && !geo.data;

  return (
    <div className={`geo${geo.stale ? ' is-stale' : ''}`}>
      <div className="geo__controls">
        <div className="geo__group" role="group" aria-label={t('insights.geo.mode')}>
          {MODES.map((m) => (
            <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>
              <m.icon aria-hidden /> {t(m.label)}
            </button>
          ))}
        </div>

        <label className="geo__field">
          <span>{t('insights.geo.measure')}</span>
          <select value={measure} onChange={(e) => setMeasure(e.target.value as GeoMeasure)} disabled={mode === 'points'}>
            {MEASURES.map((m) => <option key={m.key} value={m.key}>{t(m.label)}</option>)}
          </select>
        </label>

        <label className="geo__field">
          <span>{t('insights.geo.size')}</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={mode === 'points'}>
            {SIZES.map((m) => <option key={m} value={m}>{m >= 1000 ? `${m / 1000} km` : `${m} m`}</option>)}
          </select>
        </label>

        <button type="button" className="geo__toggle" aria-pressed={raised}
                disabled={mode !== 'columns'} onClick={() => setRaised((v) => !v)}>
          <Grid3x3 aria-hidden /> {raised ? t('insights.geo.flatten') : t('insights.geo.raise')}
        </button>

        <button type="button" className="geo__toggle" aria-pressed={buildings}
                onClick={() => setBuildings((v) => !v)}>
          <Building2 aria-hidden /> {t('insights.geo.buildings')}
        </button>

        <div className="geo__lapse">
          <button type="button" className="geo__toggle" aria-pressed={playing}
                  onClick={() => (playing ? setPlaying(false) : startLapse())}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />} {t('insights.geo.timelapse')}
          </button>
          {hour != null && (
            <span className="geo__hour">
              {String(hour).padStart(2, '0')}:00
              <button type="button" onClick={() => { setPlaying(false); setHour(null); }}>{t('insights.geo.allDay')}</button>
            </span>
          )}
        </div>
      </div>

      <div className="geo__map">
        {loading && <Skeleton height={440} />}
        {geo.error && <ErrorState body={geo.error} />}
        <MapCanvas view={surfaceMap} ref={mapRef} onSelect={onSelect} onHover={onHover}
                   camera={{ center: [55.3, 25.16], zoom: 9.7, pitch: 48, bearing: -14 }}
                   onContextMenu={(lngLat) => onPickPlace({ lng: lngLat[0], lat: lngLat[1], label: t('insights.radial.pointOnMap') })}>
          <div className="map-control map-control--top-left geo__hint">
            <Crosshair aria-hidden /> {t('insights.geo.hint')}
          </div>

          {surface && mode !== 'points' && (
            <div className="map-control map-control--bottom-left geo__legend">
              <span className="geo__legend-title">{t(MEASURES.find((m) => m.key === measure)!.label)}</span>
              <ol>
                {GEO_RAMP.map((token, i) => {
                  const shown = measure === 'target' ? GEO_RAMP[GEO_RAMP.length - 1 - i] : token;
                  // Band one starts at the surface's own minimum, not at zero — on mean
                  // response "0:00" would be a time nobody achieved.
                  const from = i === 0 ? surface.min : surface.breaks[i - 1];
                  return (
                    <li key={token}>
                      <i style={{ background: `var(${shown})` }} aria-hidden />
                      <span>{surface.breaks.length ? formatMeasure(measure, from) : '—'}</span>
                    </li>
                  );
                })}
              </ol>
              <span className="geo__legend-foot">
                {t('insights.geo.hexes', { n: count(surface.totals.hexes), size: surface.radiusM >= 1000 ? `${surface.radiusM / 1000} km` : `${surface.radiusM} m` })}
              </span>
            </div>
          )}

          {picked && (
            <div className="map-control map-control--top-right geo__inspect">
              <header>
                <strong>{formatMeasure(picked.surface.measure, picked.cell.value)}</strong>
                <span>{t(MEASURES.find((m) => m.key === picked.surface.measure)!.label)}</span>
                <button type="button" onClick={() => setPicked(null)} aria-label={t('common.close')}>×</button>
              </header>
              <dl>
                <div><dt>{t('kpi.calls')}</dt><dd>{count(Math.round(picked.cell.calls))}</dd></div>
                <div><dt>{t('insights.geo.measure.urgent')}</dt><dd>{pct(picked.cell.calls ? (100 * picked.cell.urgent) / picked.cell.calls : null)}</dd></div>
                <div><dt>{t('insights.geo.measure.response')}</dt><dd>{picked.cell.respN ? duration(Math.round(picked.cell.respSec / picked.cell.respN)) : '—'}</dd></div>
                <div><dt>{t('kpi.withinTarget')}</dt><dd>{picked.cell.respN ? pct((100 * picked.cell.withinN) / picked.cell.respN) : '—'}</dd></div>
                <div><dt>{t('insights.geo.band')}</dt><dd>{bandOf(picked.cell.value, picked.surface.breaks) + 1} / {GEO_RAMP.length}</dd></div>
              </dl>
              <button type="button" className="u-btn u-btn--secondary u-btn--sm"
                      onClick={() => onPickPlace({ lng: picked.cell.centre[0], lat: picked.cell.centre[1], label: t('insights.geo.thisHex') })}>
                {t('insights.geo.searchHere')}
              </button>
            </div>
          )}
        </MapCanvas>

        {/* Reading a cell should not cost a click. The tooltip follows the pointer and
            says the same four numbers the inspector does, in the same order. */}
        {hover && (
          <div className="geo__tip" style={{ insetInlineStart: hover.x, insetBlockStart: hover.y }} aria-hidden>
            <strong>{formatMeasure(hover.surface.measure, hover.cell.value)}</strong>
            <span>{t(MEASURES.find((m) => m.key === hover.surface.measure)!.label)}</span>
            <dl>
              <div><dt>{t('kpi.calls')}</dt><dd>{count(Math.round(hover.cell.calls))}</dd></div>
              <div><dt>{t('insights.geo.measure.urgent')}</dt><dd>{pct(hover.cell.calls ? (100 * hover.cell.urgent) / hover.cell.calls : null)}</dd></div>
              <div><dt>{t('insights.geo.measure.response')}</dt><dd>{hover.cell.respN ? duration(Math.round(hover.cell.respSec / hover.cell.respN)) : '—'}</dd></div>
            </dl>
            <span className="geo__tip-hint">{t('insights.geo.clickHint')}</span>
          </div>
        )}
      </div>

      {geo.data && (
        <p className="pillar__footnote">
          {t('insights.geo.footnote', {
            calls: count(geo.data.totals.calls),
            cells: count(geo.data.count),
            window: geo.data.window.months === 1 ? t('insights.geo.month') : t('insights.geo.months', { n: geo.data.window.months }),
          })}
          {hour != null && ` · ${t('insights.geo.hourNote', { hour: String(hour).padStart(2, '0') })}`}
        </p>
      )}
    </div>
  );
}
