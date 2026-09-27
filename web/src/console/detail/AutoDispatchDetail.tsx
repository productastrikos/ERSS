/**
 * Automatic dispatch, in full — everything behind the dashboard's card.
 *
 *   status        on, and under whose rules: the AI's own, or a duty officer's
 *   AI advisory   what the room should know about the automatic dispatcher right now
 *   predictions   the fleet over the next 20 minutes, and the demand history expects
 *   queue         what it is about to send, with the countdown
 *   rules         what it may do by itself — AI-managed (it adapts them to the moment)
 *                 or custom (fixed exactly as a duty officer sets them)
 *   today         its decisions and what they saved, each one a click from its reasoning
 *
 * The rules are REAL: saved on the server, applied by the dispatch loop and the scoring
 * engine on the next incident (server/services/dispatchRules.js), and audited.
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle, BrainCircuit, CheckCircle2, CircleDot, Clock, Gauge, Info, ListChecks, RotateCcw, Save, Scale, Send, Sparkles, TrendingUp, Users,
} from 'lucide-react';
import type { AutoDispatchReport, DispatchRules, Priority } from '../../lib/types';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { duration, durationUnit } from '../../lib/format';
import { onSocket } from '../../lib/socket';
import { useCan } from '../../lib/stores/session';
import { useNow } from '../../lib/stores/now';
import { useSim } from '../../lib/stores/live';
import { openDetail } from '../../lib/stores/detail';
import { toast } from '../../lib/stores/toast';
import { Button, Chip, ErrorState, Segmented, Skeleton } from '../../shared/ui';

const PRIOS: Priority[] = ['P1', 'P2', 'P3', 'P4'];
const withUnit = (sec: number | null | undefined) => (sec == null ? '—' : `${duration(sec)} ${durationUnit(sec)}`);
const WEIGHT_KEYS = ['travel', 'capability', 'coverage', 'crew'] as const;

interface State { request: number; data: AutoDispatchReport | null; error: string | null }

function useReport(): { data: AutoDispatchReport | null; error: string | null; reload: () => void } {
  const [state, setState] = useState<State>({ request: -1, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.live.autoDispatch()
      .then((data) => { if (!cancelled) setState({ request: tick, data, error: null }); })
      .catch((err: Error) => { if (!cancelled) setState((s) => ({ request: tick, data: s.data, error: err.message })); });
    return () => { cancelled = true; };
  }, [tick]);
  useEffect(() => {
    const every = setInterval(() => setTick((n) => n + 1), 5000);
    const offs = [onSocket('dispatch:rules', () => setTick((n) => n + 1)), onSocket('assignment:update', () => setTick((n) => n + 1))];
    return () => { clearInterval(every); for (const off of offs) off(); };
  }, []);
  return { data: state.data, error: state.error, reload: () => setTick((n) => n + 1) };
}

export function AutoDispatchDetail() {
  const { data, error, reload } = useReport();
  if (!data && error) return <ErrorState title={t('detail.auto.error')} body={error} onRetry={reload} />;
  if (!data) return <div className="dtl__loading"><Skeleton height={80} /><Skeleton height={220} /></div>;
  return <Loaded r={data} reload={reload} />;
}

function Loaded({ r, reload }: { r: AutoDispatchReport; reload: () => void }) {
  const { state: sim } = useSim();
  const now = useNow();
  const rules = r.rules;
  return (
    <div className="dtl-auto">
      <header className="dtl-auto__head">
        <span className="dtl-auto__badge"><BrainCircuit aria-hidden /></span>
        <div>
          <h3>{t('auto.title')}</h3>
          <span>{rules.mode === 'ai'
            ? t('detail.auto.modeAi')
            : t('detail.auto.modeCustom', { who: rules.updatedBy ?? '—', at: rules.updatedAt ? new Date(rules.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—' })}</span>
        </div>
        <Chip tone={sim?.running ? 'success' : 'neutral'}><CircleDot aria-hidden /> {sim?.running ? t('detail.auto.on') : t('auto.starting')}</Chip>
      </header>

      {/* ── AI advisory ── */}
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Sparkles aria-hidden /> {t('detail.auto.advisory')}</h4>
        {!r.findings.length && <p className="dtl-sec__lede">{t('detail.auto.noFindings')}</p>}
        <ul className="dtl-findings">
          {r.findings.map((f) => (
            <li key={f.title} data-sev={f.severity}>
              {f.severity === 'high' ? <AlertTriangle aria-hidden /> : f.severity === 'good' ? <CheckCircle2 aria-hidden /> : f.severity === 'medium' ? <AlertTriangle aria-hidden /> : <Info aria-hidden />}
              <div><strong>{f.title}</strong><span>{f.detail}</span></div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Predictions ── */}
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><TrendingUp aria-hidden /> {t('detail.auto.predictions')}</h4>
        <div className="dtl-kv dtl-kv--3">
          <div><span>{t('detail.auto.freeNow')}</span><strong>{r.outlook.freeNow}<small> / {r.outlook.units.length}</small></strong></div>
          <div><span>{t('detail.auto.freeIn10')}</span><strong>{r.outlook.freeIn10}<small> / {r.outlook.units.length}</small></strong></div>
          <div><span>{t('detail.auto.freeIn20')}</span><strong>{r.outlook.freeIn20}<small> / {r.outlook.units.length}</small></strong></div>
        </div>
        <ul className="dtl-outlook">
          {r.outlook.units.map((u) => {
            const mins = u.freeInSec != null ? Math.max(1, Math.round(u.freeInSec / 60)) : null;
            return (
              <li key={u.ref}>
                <button type="button" onClick={() => openDetail({ kind: 'unit', ref: u.ref })}>
                  <span className="dtl-outlook__name"><strong>{u.callsign}</strong> <span className="muted">{u.kind}</span></span>
                  <span className="dtl-outlook__bar" data-free={u.free}>
                    <span style={{ width: u.free ? '100%' : mins != null ? `${Math.max(6, 100 - Math.min(100, (mins / 20) * 100))}%` : '0%' }} />
                  </span>
                  <span className="dtl-outlook__when">{u.free ? t('detail.auto.free') : mins != null ? t('detail.auto.freeIn', { m: mins }) : t('detail.auto.unknown')}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="dtl-sec__note">{t('detail.auto.outlookBasis', { basis: r.outlook.basis })}</p>
        {r.demand && (
          <div className="dtl-demand">
            <TrendingUp aria-hidden />
            <div>
              <strong>{t('detail.auto.demand', { n: r.demand.perHour })}</strong>
              <span>{t('detail.auto.demandBasis', { basis: r.demand.basis, n: r.demand.samples })}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── Queue ── */}
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Send aria-hidden /> {t('auto.queue')}</h4>
        {!(sim?.pending ?? []).length && <p className="dtl-sec__lede">{t('auto.queueEmpty')}</p>}
        <ul className="dtl-list">
          {(sim?.pending ?? []).map((p) => (
            <li key={p.incidentRef}>
              <button type="button" onClick={() => openDetail({ kind: 'incident', ref: p.incidentRef })}>
                <span className={`prio prio--${p.priority}`}>{p.priority}</span>
                <span className="dtl-list__main"><strong>{t(`kind.${p.kind}`)}</strong><span>{p.zoneName ?? p.incidentRef}</span></span>
                <span className="dtl-list__meta mono">{Math.max(0, Math.ceil((Date.parse(p.dueAt) - now) / 1000))} s</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <RulesSection r={r} reload={reload} />

      {/* ── Today ── */}
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Gauge aria-hidden /> {t('detail.auto.today')}</h4>
        <div className="dtl-kv dtl-kv--3">
          <div><span>{t('detail.auto.dispatches')}</span><strong>{r.stats.dispatches}</strong></div>
          <div><span>{t('detail.auto.decisionTime')}</span><strong>{withUnit(r.stats.medianDecisionSec)}</strong></div>
          <div><span>{t('detail.auto.response')}</span><strong>{withUnit(r.stats.medianResponseSec)}</strong></div>
          <div><span>{t('detail.auto.saved')}</span><strong className="is-good">{withUnit(r.stats.savedSec)}</strong></div>
          <div><span>{t('detail.auto.faster')}</span><strong>{r.stats.fasterThanNearest}<small> / {r.stats.dispatches}</small></strong></div>
          <div><span>{t('detail.auto.etaError')}</span><strong>{withUnit(r.stats.medianAbsEtaErrorSec)}</strong></div>
        </div>
        {r.decisions.length > 0 && (
          <ul className="dtl-list">
            {r.decisions.map((d) => (
              <li key={d.assignmentRef}>
                <button type="button" onClick={() => openDetail({ kind: 'incident', ref: d.incidentRef })}>
                  <span className={`prio prio--${d.priority}`}>{d.priority}</span>
                  <span className="dtl-list__main">
                    <strong>{d.callsign} → {t(`kind.${d.kind}`)}</strong>
                    <span>
                      {d.zoneName ?? d.incidentRef} · {d.byAi ? t('detail.auto.byAi', { s: d.decisionSec }) : t('detail.auto.byPerson')}
                      {d.savedSec > 0 ? ` · ${t('detail.auto.savedShort', { t: withUnit(d.savedSec) })}` : ''}
                    </span>
                  </span>
                  <span className="dtl-list__meta mono">{d.responseSec != null ? withUnit(d.responseSec) : '…'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────

function RulesSection({ r, reload }: { r: AutoDispatchReport; reload: () => void }) {
  const canEdit = useCan('dispatch.rules');
  const [draft, setDraft] = useState<DispatchRules | null>(null);
  const [busy, setBusy] = useState(false);
  const state = r.rules;
  const shown = draft ?? state.rules;
  const editing = draft != null;

  const save = () => {
    if (!draft) return;
    setBusy(true);
    api.dispatchRules.set(draft)
      .then(() => { toast({ level: 'success', title: t('detail.rules.saved') }); setDraft(null); reload(); })
      .catch((err: Error) => toast({ level: 'danger', title: t('detail.rules.failed'), body: err.message }))
      .finally(() => setBusy(false));
  };
  const handBack = () => {
    setBusy(true);
    api.dispatchRules.reset()
      .then(() => { toast({ level: 'success', title: t('detail.rules.backToAi') }); setDraft(null); reload(); })
      .catch((err: Error) => toast({ level: 'danger', title: t('detail.rules.failed'), body: err.message }))
      .finally(() => setBusy(false));
  };
  const onMode = (m: 'ai' | 'custom') => {
    if (m === 'custom' && !editing) setDraft(structuredClone(state.rules));
    if (m === 'ai') {
      if (state.mode === 'custom') handBack();
      else setDraft(null);
    }
  };
  const patch = (fn: (d: DispatchRules) => void) => setDraft((d) => {
    const next = structuredClone(d ?? state.rules);
    fn(next);
    return next;
  });
  const wSum = WEIGHT_KEYS.reduce((s, k) => s + shown.weights[k], 0) || 1;

  return (
    <section className="dtl-sec dtl-rules">
      <h4 className="dtl-sec__title"><ListChecks aria-hidden /> {t('detail.rules.title')}</h4>
      {canEdit ? (
        <Segmented<'ai' | 'custom'>
          ariaLabel={t('detail.rules.mode')}
          value={editing || state.mode === 'custom' ? 'custom' : 'ai'}
          options={[{ value: 'ai', label: t('detail.rules.ai') }, { value: 'custom', label: t('detail.rules.custom') }]}
          onChange={onMode}
        />
      ) : <p className="dtl-sec__note">{t('detail.rules.readOnly')}</p>}

      {state.mode === 'ai' && !editing && (
        <ul className="dtl-why">
          {state.notes.map((n) => <li key={n}><BrainCircuit aria-hidden /> {n}</li>)}
        </ul>
      )}

      <fieldset className="dtl-rules__group" disabled={!editing || busy}>
        <legend>{t('detail.rules.byPriority')}</legend>
        <table className="dtl-rules__table">
          <thead><tr><th /><th>{t('detail.rules.auto')}</th><th>{t('detail.rules.window')}</th></tr></thead>
          <tbody>
            {PRIOS.map((p) => (
              <tr key={p}>
                <td><span className={`prio prio--${p}`}>{p}</span></td>
                <td>
                  <label className="dtl-switch">
                    <input type="checkbox" checked={shown.autoDispatch[p]} onChange={(e) => patch((d) => { d.autoDispatch[p] = e.target.checked; })} />
                    <span>{shown.autoDispatch[p] ? t('detail.rules.autoOn') : t('detail.rules.manual')}</span>
                  </label>
                </td>
                <td>
                  <input type="range" min={0} max={90} step={5} value={shown.windowSec[p]} aria-label={t('detail.rules.windowFor', { p })}
                         onChange={(e) => patch((d) => { d.windowSec[p] = Number(e.target.value); })} />
                  <span className="mono dtl-rules__val">{shown.windowSec[p]} s</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dtl-sec__note">{t('detail.rules.windowHelp')}</p>
      </fieldset>

      <fieldset className="dtl-rules__group" disabled={!editing || busy}>
        <legend><Scale aria-hidden /> {t('detail.rules.weights')}</legend>
        {WEIGHT_KEYS.map((k) => (
          <div key={k} className="dtl-rules__weight">
            <span>{t(`detail.rules.w.${k}`)}</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(shown.weights[k] * 100)} aria-label={t(`detail.rules.w.${k}`)}
                   onChange={(e) => patch((d) => { d.weights[k] = Number(e.target.value) / 100; })} />
            <span className="mono dtl-rules__val">{Math.round((shown.weights[k] / wSum) * 100)}%</span>
          </div>
        ))}
        <p className="dtl-sec__note">{t('detail.rules.weightsHelp')}</p>
      </fieldset>

      <fieldset className="dtl-rules__group" disabled={!editing || busy}>
        <legend><Users aria-hidden /> {t('detail.rules.guards')}</legend>
        <label className="dtl-switch dtl-switch--row">
          <input type="checkbox" checked={shown.avoidTraffic} onChange={(e) => patch((d) => { d.avoidTraffic = e.target.checked; })} />
          <span><strong>{t('detail.rules.traffic')}</strong>{t('detail.rules.trafficHelp')}</span>
        </label>
        <label className="dtl-switch dtl-switch--row">
          <input type="checkbox" checked={shown.requireAlsForP1} onChange={(e) => patch((d) => { d.requireAlsForP1 = e.target.checked; })} />
          <span><strong>{t('detail.rules.als')}</strong>{t('detail.rules.alsHelp')}</span>
        </label>
        <div className="dtl-rules__weight">
          <span>{t('detail.rules.reserve')}</span>
          <input type="range" min={state.limits.reserveMin[0]} max={state.limits.reserveMin[1]} step={1} value={shown.reserveMin}
                 aria-label={t('detail.rules.reserve')} onChange={(e) => patch((d) => { d.reserveMin = Number(e.target.value); })} />
          <span className="mono dtl-rules__val">{shown.reserveMin}</span>
        </div>
        <p className="dtl-sec__note">{t('detail.rules.reserveHelp')}</p>
        <div className="dtl-rules__weight">
          <span><Clock aria-hidden /> {t('detail.rules.escalate')}</span>
          <input type="range" min={state.limits.escalateArrivalSec[0]} max={state.limits.escalateArrivalSec[1]} step={60} value={shown.escalateArrivalSec}
                 aria-label={t('detail.rules.escalate')} onChange={(e) => patch((d) => { d.escalateArrivalSec = Number(e.target.value); })} />
          <span className="mono dtl-rules__val">{Math.round(shown.escalateArrivalSec / 60)} min</span>
        </div>
      </fieldset>

      {canEdit && (
        <div className="dtl-actions dtl-actions--inline">
          {editing && <Button size="sm" variant="primary" loading={busy} onClick={save}><Save aria-hidden /> {t('detail.rules.save')}</Button>}
          {editing && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{t('detail.rules.discard')}</Button>}
          {!editing && state.mode === 'custom' && <Button size="sm" variant="secondary" onClick={() => setDraft(structuredClone(state.rules))}>{t('detail.rules.edit')}</Button>}
          {state.mode === 'custom' && <Button size="sm" variant="advisory" loading={busy && !editing} onClick={handBack}><RotateCcw aria-hidden /> {t('detail.rules.reset')}</Button>}
        </div>
      )}
    </section>
  );
}
