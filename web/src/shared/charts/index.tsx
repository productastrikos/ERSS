/**
 * The chart set. Hand-rolled inline SVG — no charting library.
 *
 * Every colour is a token; series colours are assigned in the FIXED order the design
 * system defines (--series-1..8), never cycled or picked by rank.
 *
 * Two things are true of EVERY chart here, because the client asked for them everywhere:
 *
 *  1. It can show a PREDICTION. A prediction is drawn dashed, inside a shaded interval,
 *     with hollow markers, and never without its method and its measured error beside it
 *     (`ForecastNote`). docs/00 D-09: a forecast is never presented as a measurement.
 *
 *  2. It can BE a filter. A bar, a heat cell, an hour column — clicking it narrows the
 *     universal filter (lib/filters.ts). The fastest filter control is the chart itself,
 *     and it is the one the operator is already looking at.
 *
 * Interaction beyond that stays deliberately small: a hover crosshair with one shared
 * tooltip on the line chart, and a title attribute everywhere else.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { seriesColor } from './palette';
import './charts.scss';

// ── Stat tile — a headline number is usually the right chart ────────────────

export function StatTile({ label, value, unit, delta, deltaGood, sub, simulated, predicted, predictedLabel, spark, sparkForecast }: {
  label: string; value: ReactNode; unit?: string;
  delta?: string | null; deltaGood?: boolean | null; sub?: ReactNode; simulated?: boolean;
  /** The forecast for the same measure — shown beneath, always marked as a prediction. */
  predicted?: ReactNode;
  predictedLabel?: string;
  spark?: number[];
  sparkForecast?: number[];
}) {
  return (
    <div className="c-stat">
      <div className="c-stat__label">{label}{simulated && <span className="c-stat__sim" title="Simulated data">•</span>}</div>
      <div className="c-stat__value">{value}{unit && <span className="c-stat__unit">{unit}</span>}</div>
      {delta != null && (
        <div className={`c-stat__delta ${deltaGood == null ? '' : deltaGood ? 'is-good' : 'is-bad'}`}>{delta}</div>
      )}
      {spark && spark.length > 1 && <Sparkline values={spark} forecast={sparkForecast} width={120} height={26} />}
      {predicted != null && (
        <div className="c-stat__pred" title="A forecast, not a measurement">
          <span className="c-stat__pred-dash" aria-hidden />
          {predictedLabel ?? 'forecast'} {predicted}
        </div>
      )}
      {sub && <div className="c-stat__sub">{sub}</div>}
    </div>
  );
}

// ── Sparkline — a trend, no axes, no legend ──────────────────────────────────

export function Sparkline({ values, forecast, tone = 'var(--app-accent)', height = 32, width = 120 }: {
  values: number[];
  /** Drawn dashed, continuing from the last observation. */
  forecast?: number[];
  tone?: string; height?: number; width?: number;
}) {
  if (!values.length) return <span className="c-spark c-spark--empty" style={{ width, height }} />;
  const all = [...values, ...(forecast ?? [])];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const step = width / Math.max(1, all.length - 1);
  const at = (v: number, i: number) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`;
  const solid = values.map(at);
  // The dashed tail starts ON the last observation, so the two lines meet.
  const dashed = forecast?.length
    ? [at(values[values.length - 1], values.length - 1), ...forecast.map((v, i) => at(v, values.length + i))]
    : [];
  return (
    <svg className="c-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
         aria-label={`Trend from ${values[0]} to ${values.at(-1)}${forecast?.length ? `, forecast to ${forecast.at(-1)}` : ''}`}>
      <polyline points={solid.join(' ')} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {dashed.length > 1 && (
        <polyline points={dashed.join(' ')} fill="none" stroke={tone} strokeWidth={1.75} strokeDasharray="3 3"
                  strokeLinecap="round" opacity={0.8} />
      )}
    </svg>
  );
}

// ── Bar list — magnitude across a short, named, discrete set ────────────────

export interface BarItem {
  label: string;
  value: number;
  tone?: string;
  detail?: string;
  /** The forecast for the next window — drawn as a hollow extension of the same bar. */
  predicted?: number | null;
  /** Percentage change the prediction implies, shown beside the value. */
  changePct?: number | null;
  /** The value this bar filters to, when the list is click-to-filter. */
  key?: string;
}

/**
 * A bar per named thing, with an optional forecast ghost.
 *
 * `onSelect` turns the list into a filter control: the operator clicks the call type they
 * are asking about instead of hunting for it in a dropdown.
 */
export function BarList({ items, format = (v: number) => String(v), tone, showPredicted = false, onSelect, selected }: {
  items: BarItem[];
  format?: (v: number) => string;
  tone?: string;
  showPredicted?: boolean;
  onSelect?: (key: string) => void;
  selected?: string[];
}) {
  const withPred = showPredicted && items.some((i) => i.predicted != null);
  // The scale has to cover the forecast too, or a rising bar would overflow its track.
  const max = Math.max(1e-9, ...items.map((i) => Math.max(Math.abs(i.value), withPred ? Math.abs(i.predicted ?? 0) : 0)));

  return (
    <div className={`c-barlist${onSelect ? ' c-barlist--pickable' : ''}`} role="table">
      {items.map((it) => {
        const key = it.key ?? it.label;
        const on = selected?.includes(key) ?? false;
        const pct = (Math.abs(it.value) / max) * 100;
        const predPct = it.predicted != null ? (Math.abs(it.predicted) / max) * 100 : null;
        const row = (
          <>
            <div className="c-barlist__label" role="cell">{it.label}</div>
            <div className="c-barlist__track" role="cell">
              {withPred && predPct != null && predPct > pct && (
                <div className="c-barlist__ghost" style={{ width: `${predPct}%`, borderColor: it.tone ?? tone ?? 'var(--app-accent)' }} />
              )}
              <div className="c-barlist__fill" style={{ width: `${pct}%`, background: it.tone ?? tone ?? 'var(--app-accent)' }} />
              {withPred && predPct != null && predPct < pct && (
                <div className="c-barlist__mark" style={{ insetInlineStart: `${predPct}%` }} />
              )}
            </div>
            <div className="c-barlist__value" role="cell">
              {format(it.value)}
              {withPred && it.changePct != null && (
                <span className={`c-barlist__delta ${it.changePct >= 0 ? 'is-up' : 'is-down'}`}>
                  {it.changePct >= 0 ? '↑' : '↓'}{Math.abs(it.changePct).toFixed(0)}%
                </span>
              )}
            </div>
          </>
        );
        const title = [
          it.detail,
          withPred && it.predicted != null ? `Forecast next window: ${format(it.predicted)}` : null,
          onSelect ? (on ? 'Click to remove this filter' : 'Click to filter to this') : null,
        ].filter(Boolean).join(' · ');

        return onSelect ? (
          <button type="button" className={`c-barlist__row${on ? ' is-on' : ''}`} key={key} title={title}
                  aria-pressed={on} onClick={() => onSelect(key)}>
            {row}
          </button>
        ) : (
          <div className="c-barlist__row" key={key} role="row" title={title}>{row}</div>
        );
      })}
    </div>
  );
}

// ── Bullet — one measurement against the target it is judged by ──────────────

export interface BulletProps {
  /** The measurement. Null draws an empty track rather than a zero. */
  value: number | null;
  /** The target this measurement is held to. */
  target: number;
  /** A quieter second measurement, drawn as a tick — usually the wider comparison. */
  compare?: number | null;
  /** Response times are better LOW; attainment is better HIGH. */
  lowerIsBetter?: boolean;
  format: (value: number) => string;
  /** Scale maximum; by default the target with room to overshoot it. */
  max?: number;
  compareLabel?: string;
  targetLabel?: string;
}

/**
 * A bullet chart: the bar is the measurement, the vertical rule is the target, the hollow
 * tick is the comparison — one line per measure instead of a gauge each.
 *
 * Why this rather than a bar and a number: "3:48" means nothing until you know the target
 * is 8:00, and a bar with no target on it invites the reader to compare priorities against
 * each other when each is judged against its own clock. Here the target sits ON the track,
 * so the question "did we meet it" is answered by which side of the rule the bar ends.
 *
 * Status colour is used (the bar is the service passing or failing a commitment), and it
 * is never the only carrier: the value is printed, the state is written in words beside
 * it, and the target rule is where it is.
 */
export function Bullet({
  value, target, compare = null, lowerIsBetter = true, format, max, compareLabel, targetLabel,
}: BulletProps) {
  const ceiling = Math.max(1e-9, max ?? Math.max(target * 1.35, (value ?? 0) * 1.1, compare ?? 0));
  const clamp = (v: number) => Math.min(100, Math.max(0, (v / ceiling) * 100));
  const met = value == null ? null : lowerIsBetter ? value <= target : value >= target;
  const title = [
    value == null ? null : `${format(value)} against a target of ${format(target)}`,
    compare != null ? `${compareLabel ?? 'Comparison'}: ${format(compare)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="c-bullet" title={title}>
      <div className="c-bullet__track">
        {/* The band inside target — the room the service has, shown as ground rather
            than as another bar competing with the measurement. */}
        <div className="c-bullet__band" style={{ width: `${clamp(target)}%` }} />
        {value != null && (
          <div className={`c-bullet__fill${met === false ? ' is-over' : ''}`} style={{ width: `${clamp(value)}%` }} />
        )}
        {compare != null && (
          <div className="c-bullet__compare" style={{ insetInlineStart: `${clamp(compare)}%` }}
               aria-label={compareLabel} />
        )}
        <div className="c-bullet__target" style={{ insetInlineStart: `${clamp(target)}%` }} aria-label={targetLabel} />
      </div>
      <div className="c-bullet__value">
        <strong>{value == null ? '—' : format(value)}</strong>
        <span className="c-bullet__target-text">/ {format(target)}</span>
      </div>
    </div>
  );
}

// ── Line chart — change over time, one or a few named series ────────────────

export interface LineSeries {
  name: string;
  points: Array<{ x: number; y: number | null }>;
  tone?: string;
  /** A prediction: dashed, hollow markers, and excluded from "measured" readings. */
  dashed?: boolean;
  /** The prediction interval, same x scale. Drawn as a soft band under the line. */
  band?: Array<{ x: number; lower: number; upper: number }>;
}

/**
 * One or a few series over a shared x axis, with prediction bands, a forecast divider and
 * one shared hover tooltip.
 *
 * Series can be toggled from the legend: on a card showing measured and predicted P1, P2
 * and total, being able to mute four of six lines is the difference between a chart and a
 * thicket.
 */
export function LineChart({
  series, height = 180, yFormat = (v: number) => String(Math.round(v)), xLabels,
  forecastFromX, target, targetLabel, xTickEvery, onSelectX, yMaxHint,
}: {
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xLabels?: (x: number) => string;
  /** Everything at or after this x is the future: a divider and a faint wash. */
  forecastFromX?: number | null;
  /** A reference line — the response-time target, a capacity ceiling. */
  target?: number | null;
  targetLabel?: string;
  xTickEvery?: number;
  /** Click the plot to filter to that x (an hour, a weekday). */
  onSelectX?: (x: number) => void;
  yMaxHint?: number;
}) {
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ x: number; frac: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 640;
  const padL = 44, padB = 22, padT = 10, padR = 10;

  const shown = series.filter((s) => !muted[s.name]);
  const geometry = useMemo(() => {
    const pts = shown.flatMap((s) => s.points.filter((p) => p.y != null) as Array<{ x: number; y: number }>);
    const bandPts = shown.flatMap((s) => s.band ?? []);
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x).concat(bandPts.map((b) => b.x));
    const ys = pts.map((p) => p.y).concat(bandPts.flatMap((b) => [b.lower, b.upper]));
    if (target != null) ys.push(target);
    if (yMaxHint != null) ys.push(yMaxHint);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(0, ...ys), yMax = Math.max(...ys) || 1;
    return {
      xMin, xMax, yMin, yMax,
      sx: (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * (width - padL - padR),
      sy: (y: number) => height - padB - ((y - yMin) / (yMax - yMin || 1)) * (height - padT - padB),
    };
  }, [shown, height, target, yMaxHint]);

  if (!geometry) return null;
  const { xMin, xMax, yMin, yMax, sx, sy } = geometry;

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);
  const step = xTickEvery ?? Math.max(1, Math.ceil((xMax - xMin + 1) / 8));
  const xTicks: number[] = [];
  for (let x = xMin; x <= xMax; x += step) xTicks.push(Math.round(x));

  /** Map a pointer position to the nearest integer x. preserveAspectRatio="none" means the
   *  x scale is the width fraction, which is exactly what makes this arithmetic simple. */
  const xFromPointer = (clientX: number): { x: number; frac: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const vb = frac * width;
    const plot = Math.min(1, Math.max(0, (vb - padL) / (width - padL - padR)));
    const x = Math.round(xMin + plot * (xMax - xMin));
    return { x, frac: (sx(x) / width) };
  };

  const readings = hover
    ? series.map((s) => {
      const p = s.points.find((q) => q.x === hover.x);
      return p && p.y != null ? { name: s.name, y: p.y, tone: s.tone, dashed: s.dashed, muted: !!muted[s.name] } : null;
    }).filter(Boolean) as Array<{ name: string; y: number; tone?: string; dashed?: boolean; muted: boolean }>
    : [];

  return (
    <div className="c-line">
      <div className="c-line__plot">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img"
             aria-label={series.map((s) => s.name).join(', ')} preserveAspectRatio="none"
             className={onSelectX ? 'is-pickable' : undefined}
             onPointerMove={(e) => setHover(xFromPointer(e.clientX))}
             onPointerLeave={() => setHover(null)}
             onClick={(e) => { if (onSelectX) { const h = xFromPointer(e.clientX); if (h) onSelectX(h.x); } }}>

          {/* The future, washed — so "measured" and "predicted" are legible at a glance */}
          {forecastFromX != null && forecastFromX <= xMax && (
            <rect x={sx(forecastFromX)} y={padT} width={Math.max(0, sx(xMax) - sx(forecastFromX))}
                  height={height - padT - padB} className="c-line__future" />
          )}

          {ticks.map((t) => (
            <line key={t} x1={padL} x2={width - padR} y1={sy(t)} y2={sy(t)} className="c-line__grid" />
          ))}

          {/* Prediction intervals go under the lines, never over them */}
          {shown.map((s, i) => {
            if (!s.band?.length) return null;
            const tone = s.tone ?? seriesColor(i);
            const up = s.band.map((b) => `${sx(b.x).toFixed(1)},${sy(b.upper).toFixed(1)}`);
            const down = [...s.band].reverse().map((b) => `${sx(b.x).toFixed(1)},${sy(b.lower).toFixed(1)}`);
            return <polygon key={`band-${s.name}`} points={[...up, ...down].join(' ')} fill={tone} className="c-line__band" />;
          })}

          {target != null && (
            <line x1={padL} x2={width - padR} y1={sy(target)} y2={sy(target)} className="c-line__target" />
          )}

          {forecastFromX != null && forecastFromX <= xMax && forecastFromX >= xMin && (
            <line x1={sx(forecastFromX)} x2={sx(forecastFromX)} y1={padT} y2={height - padB} className="c-line__divider" />
          )}

          {shown.map((s) => {
            const tone = s.tone ?? seriesColor(series.indexOf(s));
            const drawn = s.points.filter((p) => p.y != null) as Array<{ x: number; y: number }>;
            if (!drawn.length) return null;
            const pts = drawn.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
            const dense = drawn.length > 45;
            return (
              <g key={s.name} opacity={s.dashed ? 0.9 : 1}>
                <polyline points={pts} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                          strokeDasharray={s.dashed ? '5 4' : undefined} />
                {!dense && drawn.map((p, j) => (
                  <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r={s.dashed ? 2 : 2.5} fill={s.dashed ? 'var(--app-surface)' : tone}
                          stroke={tone} strokeWidth={s.dashed ? 1.5 : 0}>
                    <title>{`${s.name}: ${yFormat(p.y)}${xLabels ? ` at ${xLabels(p.x)}` : ''}${s.dashed ? ' (forecast)' : ''}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {hover && readings.length > 0 && (
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={padT} y2={height - padB} className="c-line__crosshair" />
          )}
        </svg>

        {/* Tick labels live in HTML, not in the SVG.
            The plot uses preserveAspectRatio="none" so the geometry fills whatever width
            the card gives it — which also stretches any <text> inside it horizontally, and
            in a narrow rail the labels came out visibly squashed. Because the stretch is
            linear on each axis, a percentage position in an overlay lands on exactly the
            same spot, with the type rendered at its true proportions. */}
        <div className="c-line__axes" aria-hidden>
          {ticks.map((t) => (
            <span key={`y${t}`} className="c-line__ytick" style={{ top: `${(sy(t) / height) * 100}%`, width: `${(padL / width) * 100}%` }}>
              {yFormat(t)}
            </span>
          ))}
          {xLabels && xTicks.map((x) => (
            <span key={`x${x}`} className="c-line__xtick" style={{ insetInlineStart: `${(sx(x) / width) * 100}%` }}>
              {xLabels(x)}
            </span>
          ))}
          {target != null && (
            <span className="c-line__target-label" style={{ top: `${(sy(target) / height) * 100}%` }}>
              {targetLabel ?? yFormat(target)}
            </span>
          )}
        </div>

        {hover && readings.length > 0 && (
          <div className={`c-line__tip${hover.frac > 0.62 ? ' is-left' : ''}`} style={{ insetInlineStart: `${hover.frac * 100}%` }}>
            <div className="c-line__tip-head">{xLabels ? xLabels(hover.x) : hover.x}</div>
            {readings.map((r, i) => (
              <div className={`c-line__tip-row${r.muted ? ' is-muted' : ''}`} key={r.name}>
                <span className="c-line__swatch" style={{ background: r.tone ?? seriesColor(i) }} />
                <span className="c-line__tip-name">{r.name}</span>
                <span className="c-line__tip-val">{yFormat(r.y)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {series.length > 1 && (
        <div className="c-line__legend" role="list">
          {series.map((s, i) => (
            <button type="button" className={`c-line__legend-item${muted[s.name] ? ' is-muted' : ''}`} role="listitem" key={s.name}
                    aria-pressed={!muted[s.name]}
                    title={muted[s.name] ? 'Show this series' : 'Hide this series'}
                    onClick={() => setMuted((m) => ({ ...m, [s.name]: !m[s.name] }))}>
              <span className={`c-line__swatch${s.dashed ? ' is-dashed' : ''}`} style={{ background: s.tone ?? seriesColor(i) }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Heat grid — hour × weekday, or any two small discrete axes ──────────────

const SEQUENTIAL = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700'];

export interface HeatCell {
  row: number;
  col: number;
  value: number;
  /** The forecast for the same cell — the grid can be switched to show it. */
  predicted?: number | null;
  detail?: string;
}

/**
 * One hue, light → dark, never a rainbow.
 *
 * `showPredicted` colours by the forecast instead of the measurement; the tooltip always
 * carries both, so switching never hides what was actually recorded. Clicking a cell
 * filters to that weekday and hour.
 */
export function HeatGrid({
  rows, cols, cells, rowLabel, colLabel, format = (v: number) => String(Math.round(v)),
  showPredicted = false, onSelectCell, selected,
}: {
  rows: string[]; cols: string[]; cells: HeatCell[];
  rowLabel?: (i: number) => string; colLabel?: (i: number) => string;
  format?: (v: number) => string;
  showPredicted?: boolean;
  onSelectCell?: (row: number, col: number) => void;
  selected?: (row: number, col: number) => boolean;
}) {
  const byKey = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  const read = (c: HeatCell | undefined) => (showPredicted ? (c?.predicted ?? 0) : (c?.value ?? 0));
  const max = Math.max(1e-9, ...cells.map((c) => read(c)));
  const stepOf = (v: number) => SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.floor((v / max) * SEQUENTIAL.length))];

  return (
    <div className={`c-heatgrid${showPredicted ? ' is-predicted' : ''}`} role="img"
         aria-label={`${showPredicted ? 'Forecast' : 'Measured'} grid of ${rows.length} by ${cols.length}`}>
      <div className="c-heatgrid__grid" style={{ gridTemplateColumns: `auto repeat(${cols.length}, 1fr)` }}>
        <div className="c-heatgrid__corner" />
        {cols.map((c, ci) => <div key={c} className="c-heatgrid__collabel">{colLabel ? colLabel(ci) : c}</div>)}
        {rows.map((r, ri) => (
          <div className="c-heatgrid__rowgroup" key={r} style={{ display: 'contents' }}>
            <div className="c-heatgrid__rowlabel">{rowLabel ? rowLabel(ri) : r}</div>
            {cols.map((c, ci) => {
              const cell = byKey.get(`${ri}:${ci}`);
              const v = read(cell);
              const title = [
                `${r} · ${c}`,
                `measured ${format(cell?.value ?? 0)}`,
                cell?.predicted != null ? `forecast ${format(cell.predicted)}` : null,
                cell?.detail,
              ].filter(Boolean).join(' · ');
              const on = selected?.(ri, ci) ?? false;
              const style = { background: v ? `var(${stepOf(v)})` : undefined };
              return onSelectCell ? (
                <button type="button" key={c} className={`c-heatgrid__cell${on ? ' is-on' : ''}`} style={style}
                        title={`${title} · click to filter`} onClick={() => onSelectCell(ri, ci)} />
              ) : (
                <div key={c} className={`c-heatgrid__cell${on ? ' is-on' : ''}`} style={style} title={title} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Histogram — a distribution across fixed buckets ─────────────────────────

export function Histogram({ bins, format = (v: number) => String(v), tone = 'var(--app-accent)', zeroLabel, showPredicted = false, onSelect }: {
  bins: Array<{ label: string; value: number; highlight?: boolean; predicted?: number | null; key?: string }>;
  format?: (v: number) => string;
  tone?: string;
  /** The bin straddling zero (or the target) — drawn in the neutral ink, not the accent. */
  zeroLabel?: string;
  showPredicted?: boolean;
  onSelect?: (key: string) => void;
}) {
  const withPred = showPredicted && bins.some((b) => b.predicted != null);
  const max = Math.max(1e-9, ...bins.map((b) => Math.max(b.value, withPred ? (b.predicted ?? 0) : 0)));
  return (
    <div className="c-hist" role="img" aria-label="Distribution">
      {bins.map((b) => {
        const title = [
          `${b.label}: ${format(b.value)}`,
          withPred && b.predicted != null ? `forecast ${format(b.predicted)}` : null,
        ].filter(Boolean).join(' · ');
        const body = (
          <>
            <div className="c-hist__stack">
              {withPred && b.predicted != null && (
                <div className="c-hist__ghost" style={{ height: `${(b.predicted / max) * 100}%`, borderColor: tone }} />
              )}
              {/* One direct label, on the bin that matters — a number over every bar is
                  noise, and a highlighted bar with no number makes the reader hunt. */}
              {b.highlight && <div className="c-hist__peak" style={{ bottom: `${(b.value / max) * 100}%` }}>{format(b.value)}</div>}
              <div className={`c-hist__bar${b.highlight ? ' is-peak' : ''}`}
                   style={{ height: `${(b.value / max) * 100}%`, background: b.label === zeroLabel ? 'var(--app-text-muted)' : tone }} />
            </div>
            <div className={`c-hist__label${b.highlight ? ' is-peak' : ''}`}>{b.label}</div>
          </>
        );
        return onSelect ? (
          <button type="button" className="c-hist__col" key={b.label} title={`${title} · click to filter`}
                  onClick={() => onSelect(b.key ?? b.label)}>{body}</button>
        ) : (
          <div className="c-hist__col" key={b.label} title={title}>{body}</div>
        );
      })}
    </div>
  );
}

// ── Factor bars — the explainability panel every engine result feeds ────────

export function FactorBars({ factors }: {
  factors: Array<{ name: string; contribution: number; direction?: 'up' | 'down'; detail?: string }>;
}) {
  if (!factors?.length) return null;
  const max = Math.max(1e-9, ...factors.map((f) => Math.abs(f.contribution)));
  return (
    <div className="c-factors">
      {factors.map((f) => (
        <div className="c-factors__row" key={f.name} title={f.detail}>
          <span className="c-factors__name">{f.name}</span>
          <span className="c-factors__track">
            <span
              className={`c-factors__fill ${f.direction === 'down' ? 'is-down' : 'is-up'}`}
              style={{ width: `${(Math.abs(f.contribution) / max) * 100}%` }}
            />
          </span>
          {f.detail && <span className="c-factors__detail">{f.detail}</span>}
        </div>
      ))}
    </div>
  );
}

// ── The honesty furniture every chart carries ───────────────────────────────

export interface ForecastMetaLike {
  method: string;
  mae?: number | null;
  mape?: number | null;
  coverage80Pct?: number | null;
  caveats?: string[];
  n?: number;
}

/**
 * What a prediction is, and how wrong it has been.
 *
 * This is not decoration. A forecast whose backtest error the screen refuses to show is a
 * number nobody can act on, and an authority is right to distrust it. `mape` is the
 * walk-forward one-step error on the same series; `coverage80Pct` is how often the 80%
 * band actually contained the next observation — 80 is the honest answer, far from it
 * means the band is lying.
 */
export function ForecastNote({ meta, horizon, unit = 'steps', show = true }: {
  meta?: ForecastMetaLike | null;
  horizon?: number;
  unit?: string;
  /** False when prediction is switched off — the note describes a line that is not drawn. */
  show?: boolean;
}) {
  if (!meta || !show) return null;
  const bits: string[] = [];
  if (horizon) bits.push(`${horizon} ${unit} ahead`);
  bits.push(meta.method);
  if (meta.mape != null) bits.push(`backtest error ${meta.mape.toFixed(1)}% (MAE ${meta.mae?.toFixed(1) ?? '—'})`);
  if (meta.coverage80Pct != null) bits.push(`80% band held ${meta.coverage80Pct.toFixed(0)}% of the time`);
  if (meta.n != null) bits.push(`fitted on ${meta.n} points`);
  return (
    <p className="c-note c-note--forecast">
      <span className="c-note__dash" aria-hidden /> Forecast · {bits.join(' · ')}
      {!!meta.caveats?.length && <span className="c-note__caveat"> ⚠ {meta.caveats.join(' · ')}</span>}
    </p>
  );
}

/** The slice a chart is showing, in words. An unnamed subset of the data is a trap. */
export function FilterNote({ filters }: {
  filters?: { describe: Array<{ label: string; value: string }>; active: boolean; summary: string; ignored?: string[] } | null;
}) {
  if (!filters) return null;
  const hasIgnored = !!filters.ignored?.length;
  if (!filters.active && !hasIgnored) return null;
  return (
    <p className="c-note c-note--filter">
      {filters.active && <>Filtered · {filters.describe.map((d) => `${d.label}: ${d.value}`).join(' · ')}</>}
      {hasIgnored && (
        <span className="c-note__caveat">
          {filters.active ? ' · ' : ''}Not applicable on this panel: {filters.ignored!.join(', ')}
        </span>
      )}
    </p>
  );
}

/** Legend for what dashing and shading mean, shown once per page rather than per card. */
export function PredictionLegend({ interval }: { interval?: number }) {
  return (
    <span className="c-predlegend">
      <span className="c-predlegend__item"><span className="c-predlegend__solid" aria-hidden /> measured</span>
      <span className="c-predlegend__item"><span className="c-predlegend__dash" aria-hidden /> forecast</span>
      {!!interval && <span className="c-predlegend__item"><span className="c-predlegend__band" aria-hidden /> {interval}% interval</span>}
    </span>
  );
}
