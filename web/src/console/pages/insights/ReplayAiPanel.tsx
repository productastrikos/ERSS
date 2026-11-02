/**
 * The replay's AI record — what every screen's AI said, played back against the clock.
 *
 * Two voices, kept as they happened (server services/aiLog.js):
 *
 *   Dispatch AI   the console's reasoning: what the camera saw, which ambulances it
 *                 weighed, the roads it drove for each, why it chose the one it sent, and
 *                 a checkpoint of the drive every fifteen seconds
 *   Crew co-pilot the crew app's AI on the phone: the briefing, the road advice, scene
 *                 safety, the handover it drafted
 *
 * The log follows the scrubber: lines already said are full strength, the one being said
 * now is highlighted, and lines still to come are dimmed — so a team watching the replay
 * reads the reasoning at the moment it was made, not as a finished transcript. A click on
 * a line jumps the replay to it.
 *
 * Beside it: the roads the AI compared, and the after-action review — what went well,
 * what to improve, and what to change.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Check, CheckCircle2, ChevronDown, ChevronUp, Lightbulb, Route, Smartphone, TriangleAlert } from 'lucide-react';
import type { AiLogEntry, ReplayAi, ReviewFinding } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { Card, EmptyState } from '../../../shared/ui';
import { timeGst } from '../../../lib/format';
import './replay-ai.scss';

type Source = 'all' | 'console' | 'crew';

const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

export function ReplayAiLog({ ai, atMs, playing, onSeek }: {
  ai: ReplayAi;
  /** Where the playback is, wall-clock ms; null before a trip is loaded. */
  atMs: number | null;
  playing: boolean;
  onSeek: (ms: number) => void;
}) {
  const [source, setSource] = useState<Source>('all');
  const listRef = useRef<HTMLOListElement>(null);
  const entries = useMemo(
    () => ai.log.filter((e) => source === 'all' || e.source === source),
    [ai.log, source],
  );
  // The line being said now: the last one at or before the playback position.
  const nowIdx = useMemo(() => {
    if (atMs == null) return -1;
    let idx = -1;
    entries.forEach((e, i) => { if (Date.parse(e.ts) <= atMs) idx = i; });
    return idx;
  }, [entries, atMs]);

  // While playing, keep the current line in view — scrolling the LIST, never the page.
  useEffect(() => {
    if (!playing || nowIdx < 0) return;
    const list = listRef.current;
    const el = list?.children[nowIdx] as HTMLElement | undefined;
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop - list.clientHeight * 0.35;
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [nowIdx, playing]);

  const counts = { console: ai.log.filter((e) => e.source === 'console').length, crew: ai.log.filter((e) => e.source === 'crew').length };

  return (
    <Card title={t('insights.replay.ai.title')} subtitle={ai.kept ? t('insights.replay.ai.kept') : t('insights.replay.ai.rebuilt')} flush>
      <div className="rai">
        <div className="rai__tabs" role="tablist" aria-label={t('insights.replay.ai.title')}>
          {(['all', 'console', 'crew'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => setSource(s)}>
              {s === 'console' ? <BrainCircuit aria-hidden /> : s === 'crew' ? <Smartphone aria-hidden /> : null}
              {t(`insights.replay.ai.src.${s}`)}
              <em>{s === 'all' ? ai.log.length : counts[s]}</em>
            </button>
          ))}
        </div>
        {!entries.length ? (
          <EmptyState title={t('insights.replay.ai.none')} />
        ) : (
          <ol className="rai__list" ref={listRef}>
            {entries.map((e, i) => (
              <AiLine key={`${e.source}:${e.key}`} entry={e}
                      state={nowIdx < 0 ? 'future' : i < nowIdx ? 'past' : i === nowIdx ? 'now' : 'future'}
                      onSeek={() => onSeek(Date.parse(e.ts))} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function AiLine({ entry: e, state, onSeek }: { entry: AiLogEntry; state: 'past' | 'now' | 'future'; onSeek: () => void }) {
  const [open, setOpen] = useState(false);
  const items = open ? e.items : e.items.slice(0, 3);
  const isDrive = e.key.startsWith('drive@');
  return (
    <li className={`rai__line is-${state}${isDrive ? ' is-drive' : ''}`} data-source={e.source} data-tone={e.tone ?? 'info'}>
      <button type="button" className="rai__when" onClick={onSeek} title={t('insights.replay.ai.jump')}>
        {timeGst(e.ts)}
      </button>
      <div className="rai__body">
        <div className="rai__head">
          <span className="rai__src">{e.source === 'crew' ? <Smartphone aria-hidden /> : <BrainCircuit aria-hidden />}
            {e.source === 'crew' ? t('insights.replay.ai.crew') : t('insights.replay.ai.console')}</span>
          <strong>{e.title}</strong>
        </div>
        {e.detail && <p>{e.detail}</p>}
        {items.length > 0 && (
          <ul>
            {items.map((it, k) => <li key={`${it.label}:${k}`} data-tone={it.tone ?? 'info'}><span>{it.label}</span><b>{it.value}</b></li>)}
          </ul>
        )}
        {e.items.length > 3 && (
          <button type="button" className="rai__more" onClick={() => setOpen((v) => !v)}>
            {open ? <><ChevronUp aria-hidden /> {t('detail.showLess')}</> : <><ChevronDown aria-hidden /> {t('detail.showAll', { n: e.items.length })}</>}
          </button>
        )}
      </div>
    </li>
  );
}

/** The roads the AI drove for each leading ambulance, and the alternatives for the one it sent. */
export function ReplayRoads({ ai }: { ai: ReplayAi }) {
  const d = ai.decision;
  if (!d?.candidates?.length) return null;
  const chosen = d.candidates.find((c) => c.unitRef === d.chosen) ?? d.candidates[0];
  return (
    <Card title={t('insights.replay.roads.title')} subtitle={t('insights.replay.roads.sub')} flush>
      <div className="rroads">
        <table className="rroads__table">
          <thead>
            <tr>
              <th>#</th><th>{t('detail.inc.col.ambulance')}</th><th>{t('insights.replay.roads.road')}</th>
              <th className="numeric">{t('insights.replay.roads.turns')}</th><th className="numeric">{t('insights.replay.roads.main')}</th>
              <th className="numeric">{t('insights.replay.roads.drive')}</th><th className="numeric">{t('detail.inc.col.arrives')}</th>
            </tr>
          </thead>
          <tbody>
            {d.candidates.map((c) => {
              const s = c.route?.stats;
              return (
                <tr key={c.unitRef} className={c.unitRef === chosen.unitRef ? 'is-chosen' : ''}>
                  <td className="mono">{c.rank}</td>
                  <td><strong>{c.callsign}</strong> <span className="muted">{c.kind}</span></td>
                  <td>{s ? `${km(s.distanceM)}${s.via ? ` · ${s.via}` : ''}` : <span className="muted">{t('insights.replay.roads.unrouted')}</span>}</td>
                  <td className="numeric mono">{s ? s.counts.manoeuvres : '—'}</td>
                  <td className="numeric mono">{s ? `${Math.round(s.majorShare * 100)}%` : '—'}</td>
                  <td className="numeric mono">{s ? mmss(s.timeSec) : '—'}</td>
                  <td className="numeric mono">{mmss(c.arrivalSec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d.nearest?.excluded && (
          <p className="rroads__note"><TriangleAlert aria-hidden /> {t('insights.replay.roads.excluded', { unit: d.nearest.callsign, reason: d.nearest.excluded })}</p>
        )}
        {chosen.route && chosen.route.options.length > 1 && (
          <div className="rroads__options">
            <h5><Route aria-hidden /> {t('insights.replay.roads.options', { unit: chosen.callsign })}</h5>
            <ul>
              {chosen.route.options.map((o) => (
                <li key={o.label} className={o.chosen ? 'is-chosen' : ''}>
                  <em>{o.chosen && <Check aria-hidden />} {t('insights.replay.roads.option', { label: o.label ?? '' })}</em>
                  <span>{o.via ?? '—'}</span>
                  <span className="mono">{km(o.distanceM)} · {o.counts.manoeuvres} {t('insights.replay.roads.turnsShort')} · {mmss(o.timeSec)}</span>
                </li>
              ))}
            </ul>
            {chosen.route.why.length > 0 && <p className="rroads__why">{chosen.route.why.join(' · ')}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

const KIND_ICON = { good: CheckCircle2, improve: TriangleAlert, suggest: Lightbulb } as const;

/** What went well, what to improve, and what to change. */
export function ReplayReview({ ai }: { ai: ReplayAi }) {
  if (!ai.review.length) return null;
  const groups: Array<{ kind: ReviewFinding['kind']; items: ReviewFinding[] }> = (['good', 'improve', 'suggest'] as const)
    .map((kind) => ({ kind, items: ai.review.filter((f) => f.kind === kind) }))
    .filter((g) => g.items.length);
  return (
    <Card title={t('insights.replay.review.title')} subtitle={t('insights.replay.review.sub')} flush>
      <div className="rreview">
        {groups.map((g) => {
          const Icon = KIND_ICON[g.kind];
          return (
            <section key={g.kind} className="rreview__group" data-kind={g.kind}>
              <h5><Icon aria-hidden /> {t(`insights.replay.review.${g.kind}`)} <em>{g.items.length}</em></h5>
              <ul>
                {g.items.map((f) => (
                  <li key={f.id}>
                    <div>
                      <strong>{f.title}</strong>
                      {f.detail && <span>{f.detail}</span>}
                    </div>
                    {f.metric && <b className="mono">{f.metric.value}</b>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className="rreview__note">{ai.reviewNote}</p>
      </div>
    </Card>
  );
}
