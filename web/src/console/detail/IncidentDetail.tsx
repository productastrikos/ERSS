/**
 * One incident, as the AI is handling it — the panel the whole trial is built to show.
 *
 * Top to bottom:
 *
 *   what happened      priority, what the camera saw, where, and the response clock
 *   what happens next  the AI's send window, while it is open — the one moment a person
 *                      might step in (send now, or hold)
 *   what the AI did    THE AI LOG, LEADING THE PANEL: every step of its reasoning,
 *                      timestamped, written from the engine's own output
 *                      (server/services/decisions.js) — the scan of the fleet, the roads
 *                      and traffic it compared, the scores, the choice and why, the
 *                      notification, the crew's acknowledgement, the drive
 *   how far along      detected → AI decision → job sent → en route → on scene → hospital
 *   the evidence       the camera that raised it, still recording
 *   what it compared   the ranked candidates, side by side
 *   who is going       the crew and the vehicle, live
 *
 * The AI log sits DIRECTLY under the header, above everything else, and tails itself as
 * steps land. The map opens this panel by itself the moment a camera raises an incident
 * (shared/map/live/useIncidentDirector.ts) — so the question the room asks at that exact
 * second, "what is it doing?", must already be answered on screen. It used to be the
 * fourth section down, which on a 360px rail meant the answer was below the fold and the
 * room watched a stepper instead. The stepper, the footage and the candidate table are all
 * context for the log, so they read after it.
 *
 * The only controls are the ones a dispatcher needs while the AI's window is open: send
 * its choice now, or hold it. Everything else is watching.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Ambulance, BrainCircuit, Building2, Camera, CheckCircle2, ChevronDown, ChevronUp, Clock, Cpu, Gauge,
  HeartPulse, Hospital, MapPin, Navigation, PauseCircle, Route, Send, ShieldAlert, Siren, Timer, TrafficCone, Users,
} from 'lucide-react';
import type { DecisionPhase, DecisionStep, DecisionTrace, StepTone } from '../../lib/types';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { duration, durationUnit } from '../../lib/format';
import { openIncident } from '../../lib/router';
import { useCan } from '../../lib/stores/session';
import { useNow } from '../../lib/stores/now';
import { useDecisionTrace } from '../../lib/stores/decisions';
import { openDetail } from '../../lib/stores/detail';
import { openDetection, useDetectionFor } from '../../lib/stores/live';
import { Button, CctvFeed, Chip, Dot, ErrorState, SimulatedChip, Skeleton } from '../../shared/ui';
import { toast } from '../../lib/stores/toast';
import { AssignedCrewCard } from './AssignedCrewCard';

const withUnit = (sec: number | null | undefined) => (sec == null ? '—' : `${duration(sec)} ${durationUnit(sec)}`);
const gst = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' });

export function IncidentDetail({ incidentRef }: { incidentRef: string }) {
  const { data, error, loading } = useDecisionTrace(incidentRef);
  if (loading) return <div className="dtl__loading"><Skeleton height={90} /><Skeleton height={240} /></div>;
  if (!data) return <ErrorState title={t('detail.inc.error')} body={error ?? ''} />;
  // Keyed so switching incidents remounts fresh — the AI log's staged reveal (below)
  // must restart at step one for the new incident, not resume wherever the last one left off.
  return <Loaded key={data.incident.ref} trace={data} />;
}

function Loaded({ trace }: { trace: DecisionTrace }) {
  const now = useNow();
  const inc = trace.incident;
  const arrived = inc.firstOnsceneAt != null;
  const elapsed = Math.max(0, Math.round(((arrived ? Date.parse(inc.firstOnsceneAt!) : now) - Date.parse(inc.reportedAt)) / 1000));
  const ratio = elapsed / inc.targetSec;
  const tone = ratio > 1 ? 'bad' : ratio > 0.75 ? 'warn' : 'good';

  return (
    <div className="dtl-inc">
      <header className="dtl-inc__head">
        <div className="dtl-inc__title">
          <span className={`prio prio--${inc.priority}`}>{inc.priority}</span>
          <h3>{inc.kindLabel}</h3>
          {inc.closedAt && <Chip tone="neutral">{t('detail.inc.closed')}</Chip>}
        </div>
        <div className="dtl-inc__where"><MapPin aria-hidden /> {inc.place}{inc.zoneName && inc.zoneName !== inc.place ? ` · ${inc.zoneName}` : ''}</div>
        <div className="dtl-inc__chips">
          {inc.source === 'sensor' && <Chip tone="accent"><Camera aria-hidden /> {inc.detectedBy ?? t('detail.inc.camera')}</Chip>}
          {inc.source === 'sensor' && <Chip tone="neutral">{t('detail.inc.noCall')}</Chip>}
          <Chip tone="neutral"><Users aria-hidden /> {inc.patients} {inc.patients === 1 ? t('detail.inc.patient') : t('detail.inc.patients')}</Chip>
          <SimulatedChip />
        </div>
        <div className="dtl-inc__clock" data-tone={tone}>
          <div>
            <span className="dtl-inc__elapsed">{duration(elapsed)}<small> {durationUnit(elapsed)}</small></span>
            <span className="dtl-inc__target">
              {arrived ? t('detail.inc.arrivedAgainst', { target: withUnit(inc.targetSec) }) : t('detail.inc.ofTarget', { target: withUnit(inc.targetSec) })}
            </span>
          </div>
          <div className="dtl-inc__bar"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
        </div>
      </header>

      {!trace.assignment && <DispatchWindow trace={trace} now={now} />}

      <AiLog steps={trace.steps} closed={!!inc.closedAt} />

      <PhaseStepper phase={trace.phase} />

      {inc.source === 'sensor' && <LiveCctv incidentRef={inc.ref} />}

      {trace.candidates.length > 0 && <Candidates trace={trace} />}
      {trace.assignment && <AssignedCrewCard trace={trace} now={now} />}

      <footer className="dtl-actions">
        {inc.detectionId && (
          <Button size="sm" variant="secondary" onClick={() => openDetection(inc.detectionId)}>
            <Camera aria-hidden /> {t('detail.inc.evidence')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => openIncident(inc.ref)}>
          {t('detail.inc.openOps')} · {inc.ref}
        </Button>
      </footer>
    </div>
  );
}

// ── CCTV, live ─────────────────────────────────────────────────────────────
//
// The evidence, right where the story is — not one click away behind "Camera evidence"
// below. `useDetectionFor` reads the same detection feed the DetectionPanel does
// (lib/stores/live.ts), so the instant a camera raises this incident, its footage is
// already sitting in the store waiting to be shown here; nothing extra to fetch.

function LiveCctv({ incidentRef }: { incidentRef: string }) {
  const d = useDetectionFor(incidentRef);
  if (!d || !d.cameras.length) return null;
  return (
    <section className="dtl-sec dtl-cctv">
      <h4 className="dtl-sec__title"><Camera aria-hidden /> {t('detail.inc.evidence')}</h4>
      <div className="dtl-cctv__wall">
        {d.cameras.map((c) => (
          <figure key={c.id} className={c.primary ? 'is-primary' : ''}>
            <CctvFeed src={c.clipUrl} label={c.name} />
            <span className="dtl-cctv__rec"><Dot tone="danger" /> {t('detection.rec')}</span>
            <figcaption>{c.id}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ── The AI log, revealed a step at a time ───────────────────────────────────
//
// `trace.steps` often arrives several deep in one poll — the engine decides in one tick,
// not one step per second — so rendering the array straight would dump the whole
// reasoning on screen at once. This holds each step back until its turn, so a first-time
// viewer reads "detected → assessed → scanned → scored → decided" as a sequence someone
// is narrating rather than a wall of text that was already finished. Steps that genuinely
// arrive over real time (ack, en route, on scene…) are shown the moment they land — the
// pacing only ever holds a step BACK, never rushes one that hasn't happened yet.

const REVEAL_FIRST_MS = 350;
const REVEAL_STEP_MS = 1100;
/** How long a just-revealed step stays visibly highlighted. */
const REVEAL_HIGHLIGHT_MS = 1300;

function useRevealedSteps(steps: DecisionStep[]): { shown: DecisionStep[]; freshKey: string | null } {
  const [count, setCount] = useState(0);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (reduced || count >= steps.length) return undefined;
    const nextStep = steps[count];
    const timer = setTimeout(() => {
      setCount((c) => c + 1);
      setFreshKey(nextStep?.key ?? null);
    }, count === 0 ? REVEAL_FIRST_MS : REVEAL_STEP_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, steps.length, reduced]);

  useEffect(() => {
    if (!freshKey) return undefined;
    const timer = setTimeout(() => setFreshKey(null), REVEAL_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [freshKey]);

  return { shown: reduced ? steps : steps.slice(0, count), freshKey };
}

/**
 * The log leads the panel, so it gets its OWN scroll region rather than growing the
 * panel's: a job that reaches hospital has fifteen or so steps, and letting them grow the
 * page would push the newest reasoning off the bottom of the rail and the stepper, footage
 * and crew off the screen entirely. Inside its window the log tails itself — what the AI
 * did LAST is what the room is asking about — and the section heading never moves, so
 * "AI log · LIVE" stays legible while the steps under it advance.
 */
function AiLog({ steps, closed }: { steps: DecisionStep[]; closed: boolean }) {
  const { shown, freshKey } = useRevealedSteps(steps);
  const listRef = useRef<HTMLOListElement>(null);

  // Tail the newest step. Scrolling the LIST, never the panel — a reader part-way down
  // the candidate table must not be yanked back up because a step landed. Smooth, so the
  // movement reads as the story advancing; instant under prefers-reduced-motion.
  useEffect(() => {
    const el = listRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [shown.length]);

  return (
    <section className="dtl-sec dtl-sec--ailog">
      <h4 className="dtl-sec__title">
        <BrainCircuit aria-hidden /> {t('detail.inc.aiLog')}
        {!closed && <span className="dtl-live"><span aria-hidden /> {t('detail.live')}</span>}
      </h4>
      <p className="dtl-sec__lede">{t('detail.inc.aiLogLede')}</p>
      <ol className="ailog" ref={listRef} aria-live="polite">
        {shown.map((s) => <AiStep key={s.key} step={s} fresh={s.key === freshKey} />)}
      </ol>
    </section>
  );
}

// ── Where it is in its life ──────────────────────────────────────────────────

const PHASES: Array<{ key: string; label: string; icon: typeof Clock }> = [
  { key: 'detected', label: 'detail.phase.detected', icon: Camera },
  { key: 'decision', label: 'detail.phase.decision', icon: BrainCircuit },
  { key: 'sent', label: 'detail.phase.sent', icon: Send },
  { key: 'enroute', label: 'detail.phase.enroute', icon: Siren },
  { key: 'onscene', label: 'detail.phase.onscene', icon: HeartPulse },
  { key: 'hospital', label: 'detail.phase.hospital', icon: Hospital },
  { key: 'closed', label: 'detail.phase.closed', icon: CheckCircle2 },
];
const PHASE_INDEX: Record<DecisionPhase, number> = {
  detected: 1, thinking: 1, decided: 1, dispatched: 2, enroute: 3, onscene: 4, transport: 5, closed: 6,
};

function PhaseStepper({ phase }: { phase: DecisionPhase }) {
  const at = PHASE_INDEX[phase];
  return (
    <ol className="dtl-steps" aria-label={t('detail.inc.progress')}>
      {PHASES.map((p, i) => {
        const Icon = p.icon;
        const state = i < at ? 'done' : i === at ? (phase === 'closed' ? 'done' : 'now') : 'next';
        return (
          <li key={p.key} className={`dtl-steps__item is-${state}`}>
            <span className="dtl-steps__dot"><Icon aria-hidden /></span>
            <span className="dtl-steps__label">{t(p.label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── The AI's window: the only moment a person might step in ──────────────────

function DispatchWindow({ trace, now }: { trace: DecisionTrace; now: number }) {
  const canDispatch = useCan('operations.dispatch');
  const [busy, setBusy] = useState(false);
  const chosen = trace.candidates.find((c) => c.unitRef === trace.chosenRef) ?? null;
  const pending = trace.pending;
  const left = pending ? Math.max(0, Math.ceil((Date.parse(pending.dueAt) - now) / 1000)) : null;
  const win = pending?.windowSec ?? null;
  const progress = win && left != null ? Math.min(100, ((win - left) / win) * 100) : 0;
  const waiting = !pending && trace.steps.some((s) => s.key.startsWith('note:') && s.state === 'active');

  const run = (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    fn().then(() => toast({ level: 'success', title: done })).catch((err: Error) => toast({ level: 'danger', title: t('detail.inc.actionFailed'), body: err.message }))
      .finally(() => setBusy(false));
  };

  if (!pending && !waiting) return null;
  return (
    <div className={`dtl-window${pending ? '' : ' is-waiting'}`}>
      <div className="dtl-window__row">
        <Timer aria-hidden />
        <div className="dtl-window__text">
          {pending
            ? <strong>{chosen ? t('detail.inc.sendingIn', { unit: chosen.callsign, s: left ?? 0 }) : t('detail.inc.dispatchIn', { s: left ?? 0 })}</strong>
            : <strong>{t('detail.inc.waitingPerson')}</strong>}
          <span>{pending ? t('detail.inc.windowWhy', { s: win ?? 0 }) : t('detail.inc.waitingWhy')}</span>
        </div>
      </div>
      {pending && <div className="dtl-window__bar"><span style={{ width: `${progress}%` }} /></div>}
      {canDispatch && (
        <div className="dtl-window__actions">
          <Button size="sm" variant="primary" loading={busy} onClick={() => run(() => api.live.dispatchNow(trace.incident.ref), t('detail.inc.sentNow'))}>
            <Send aria-hidden /> {chosen ? t('detail.inc.sendNamed', { unit: chosen.callsign }) : t('detail.inc.sendNow')}
          </Button>
          {pending && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.sim.hold(trace.incident.ref), t('detail.inc.heldDone'))}>
              <PauseCircle aria-hidden /> {t('detail.inc.hold')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── One step of the log ──────────────────────────────────────────────────────

const STEP_ICON: Record<string, typeof Clock> = {
  detected: Camera, assessed: ShieldAlert, scanned: Ambulance, routed: Route, scored: Gauge, decided: BrainCircuit,
  thinking: Cpu, countdown: Timer, dispatched: Send, ack: CheckCircle2, enroute: Siren, driving: Navigation,
  onscene: MapPin, patient: HeartPulse, transport: Hospital, hospital: Building2, note: TrafficCone,
};

const COLLAPSE_AT = 4;

function AiStep({ step, fresh }: { step: DecisionStep; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICON[step.key.split(':')[0]] ?? Clock;
  const items = open ? step.items : step.items.slice(0, COLLAPSE_AT);
  const hidden = step.items.length - items.length;
  return (
    <li className={`ailog__step is-${step.state}${fresh ? ' is-fresh' : ''}`} data-tone={step.tone as StepTone}>
      <span className="ailog__icon"><Icon aria-hidden /></span>
      <div className="ailog__body">
        <div className="ailog__head">
          <span className="ailog__title">{step.title}</span>
          <time className="ailog__time" dateTime={step.at}>{step.state === 'active' ? t('detail.now') : gst(step.at)}</time>
        </div>
        {step.detail && <p className="ailog__detail">{step.detail}</p>}
        {items.length > 0 && (
          <ul className="ailog__items">
            {items.map((it, i) => (
              <li key={`${it.label}:${i}`} data-tone={it.tone ?? 'info'}>
                <span>{it.label}</span><strong>{it.value}</strong>
              </li>
            ))}
          </ul>
        )}
        {(hidden > 0 || open) && step.items.length > COLLAPSE_AT && (
          <button type="button" className="ailog__more" onClick={() => setOpen((v) => !v)}>
            {open ? <><ChevronUp aria-hidden /> {t('detail.showLess')}</> : <><ChevronDown aria-hidden /> {t('detail.showAll', { n: step.items.length })}</>}
          </button>
        )}
      </div>
    </li>
  );
}

// ── What it compared ─────────────────────────────────────────────────────────

function Candidates({ trace }: { trace: DecisionTrace }) {
  const top = trace.candidates.slice(0, 5);
  const best = Math.max(...top.map((c) => c.score), 0.001);
  return (
    <section className="dtl-sec">
      <h4 className="dtl-sec__title"><Gauge aria-hidden /> {t('detail.inc.compared')}</h4>
      <table className="dtl-cands">
        <thead>
          <tr>
            <th>#</th><th>{t('detail.inc.col.ambulance')}</th><th>{t('detail.inc.col.arrives')}</th>
            <th>{t('detail.inc.col.traffic')}</th><th>{t('detail.inc.col.score')}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((c) => (
            <tr key={c.unitRef} className={c.unitRef === trace.chosenRef ? 'is-chosen' : ''}
                onClick={() => openDetail({ kind: 'unit', ref: c.unitRef })} title={t('detail.inc.openUnit')}>
              <td className="mono">{c.rank}</td>
              <td><strong>{c.callsign}</strong> <span className="muted">{c.kind}</span>{c.unitRef === trace.chosenRef && <span className="dtl-cands__pick">{t('detail.inc.aiPick')}</span>}</td>
              <td className="mono">{withUnit(c.arrivalSec)}</td>
              <td className={`mono${c.trafficDelaySec >= 45 ? ' is-bad' : c.trafficDelaySec > 0 ? ' is-warn' : ''}`}>{c.trafficDelaySec > 0 ? `+${duration(c.trafficDelaySec)}` : '—'}</td>
              <td><span className="dtl-cands__score"><span style={{ width: `${(c.score / best) * 100}%` }} /></span><span className="mono">{c.score.toFixed(2)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dtl-sec__note">{t('detail.inc.comparedNote')}</p>
    </section>
  );
}

// "Who is going" — AssignedCrewCard, imported from ./AssignedCrewCard.tsx (shared with
// the dashboard's bottom strip so both stay in sync off the same live trace).
