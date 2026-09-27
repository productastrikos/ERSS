/**
 * How this place performs BY PRIORITY — the panel the radial search is really for.
 *
 * The old card was four bars of call counts, which answers "is it busy" and nothing else.
 * The question a standby point is argued from is whether the urgent calls here are being
 * reached in time, and that cannot be read from a count: each priority is judged against
 * its own clock (P1 8:00, P2 12:00, P3 20:00, P4 40:00), so the four rows are not
 * comparable with each other — only with their own targets.
 *
 * So every row carries the same four things, in the same places:
 *
 *   WHICH        the priority and what it means, with its share of the calls here
 *   HOW MANY     the count, as a bar against the busiest priority in this circle
 *   HOW FAST     median response as a BULLET against that priority's target, with the
 *                same priority across the rest of the emirate as a hollow tick
 *   HOW OFTEN    attainment, and the points it is above or below the emirate
 *
 * Nothing is carried by colour alone: the state is written in words, the numbers are
 * printed, and the target is a rule on the track rather than a change of hue. Clicking a
 * row filters the whole page to that priority — the same behaviour the bar list had.
 */

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { t } from '../../../lib/i18n';
import { count, duration, pct } from '../../../lib/format';
import { Bullet } from '../../../shared/charts';
import type { RadialPriority } from '../../../lib/types';

export interface PriorityPanelProps {
  rows: RadialPriority[];
  /** Priorities currently in the filter, for the pressed state. */
  selected: string[];
  onSelect: (priority: string) => void;
}

export function PriorityPanel({ rows, selected, onSelect }: PriorityPanelProps) {
  const total = rows.reduce((a, r) => a + r.calls, 0) || 1;
  const busiest = Math.max(1, ...rows.map((r) => r.calls));

  return (
    <div className="priperf">
      <div className="priperf__head" aria-hidden>
        <span>{t('insights.prio.priority')}</span>
        <span>{t('insights.prio.volume')}</span>
        <span>{t('insights.prio.speed')}</span>
        <span>{t('insights.prio.attainment')}</span>
      </div>

      {rows.map((r) => {
        const on = selected.includes(r.priority);
        const share = (r.calls / total) * 100;
        const delta = r.withinTargetPct != null && r.emirate.withinTargetPct != null
          ? r.withinTargetPct - r.emirate.withinTargetPct
          : null;
        const met = r.p50Sec != null ? r.p50Sec <= r.targetSec : null;

        return (
          <button key={r.priority} type="button" className={`priperf__row${on ? ' is-on' : ''}`}
                  data-priority={r.priority} aria-pressed={on} onClick={() => onSelect(r.priority)}
                  title={on ? t('chart.clickToClear') : t('chart.clickToFilter')}>
            <span className="priperf__who">
              <span className="priperf__chip">{r.priority}</span>
              <span className="priperf__label">
                <strong>{r.label}</strong>
                <span>{t('insights.prio.target', { target: duration(r.targetSec) })}</span>
              </span>
            </span>

            <span className="priperf__volume">
              <span className="priperf__bar" aria-hidden>
                <i style={{ width: `${(r.calls / busiest) * 100}%` }} />
              </span>
              <span className="priperf__nums">
                <strong>{count(r.calls)}</strong>
                <span>{share.toFixed(0)}%</span>
              </span>
            </span>

            <span className="priperf__speed">
              <Bullet value={r.p50Sec} target={r.targetSec} compare={r.emirate.p50Sec}
                      format={(v) => duration(Math.round(v))}
                      compareLabel={t('insights.prio.emirate')}
                      targetLabel={t('insights.prio.targetLabel')} />
              <span className={`priperf__state${met === false ? ' is-bad' : met ? ' is-good' : ''}`}>
                {met == null ? t('insights.prio.noData')
                  : met ? t('insights.prio.inTarget') : t('insights.prio.overTarget')}
              </span>
            </span>

            <span className="priperf__attain">
              <strong>{pct(r.withinTargetPct, 1)}</strong>
              {delta != null && (
                <span className={`priperf__delta${delta > 0.5 ? ' is-good' : delta < -0.5 ? ' is-bad' : ''}`}>
                  {delta > 0.5 ? <ArrowUp aria-hidden /> : delta < -0.5 ? <ArrowDown aria-hidden /> : <Minus aria-hidden />}
                  {Math.abs(delta).toFixed(1)}pt {t('insights.prio.vsEmirate')}
                </span>
              )}
            </span>
          </button>
        );
      })}

      <p className="priperf__foot">{t('insights.prio.foot')}</p>
    </div>
  );
}
