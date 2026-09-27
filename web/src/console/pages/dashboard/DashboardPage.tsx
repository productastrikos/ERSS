/**
 * Dashboard — the DCAS live picture at a glance. docs/06 §1, re-cut for the road-watch trial.
 *
 *   response-time band (the one number the service is judged on, against its target)
 *   live map: the trial's ambulances, the road still ahead of each one on a job, every alert
 *   right rail: automatic dispatch · live feed
 *   bottom: live responses with ticking clocks · emergency department load · today's trend
 *
 * There is no simulation panel. The trial (config/poc.js) is automatic dispatch of
 * camera-raised road incidents, and the live picture starts itself with the server — a
 * start button, a call-volume slider and a "random call" button would all be controls for
 * a system the client is not buying, sitting on the one screen they will look at longest.
 *
 * Every figure carries its unit on its face. "4:32" is a clock time to half the room and a
 * response time to the other half; "4:32 min" is not a question.
 *
 * Every card opens its detail in the RIGHT RAIL (console/detail, lib/stores/detail.ts):
 * the Automatic dispatch card opens its rules, advisory and predictions; an incident opens
 * the AI's log of how it is handling it; an ambulance opens its crew and vehicle. The rail
 * is replaced rather than covered, so the map never is. The map itself follows each new
 * incident by itself (shared/map/live/useIncidentDirector.ts) and opens it here.
 */

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Activity, Ambulance, BrainCircuit, Cctv, CheckCheck, ChevronRight, CircleCheck, Clock, HeartPulse, Hospital,
  ListChecks, MapPin, Navigation, PhoneIncoming, Send, Timer, XCircle,
} from 'lucide-react';
import type { DispatchRulesState, FeedItem, Incident, LiveSummary, Priority } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { api } from '../../../lib/api';
import { duration, durationUnit, plural } from '../../../lib/format';
import { navigate, openIncident } from '../../../lib/router';
import { onSocket } from '../../../lib/socket';
import { openDetail, useDetail, useIsOpen, type DetailTarget } from '../../../lib/stores/detail';
import { DetailPanel } from '../../detail/DetailPanel';
import { usePoc } from '../../../lib/stores/session';
import { useNow } from '../../../lib/stores/now';
import { loadIncidents, useQueue, wireIncidentFeed } from '../../../lib/stores/incidents';
import { loadUnits, wireFleetFeed } from '../../../lib/stores/fleet';
import { useFeed, useLivePolling, useSim, useSummary } from '../../../lib/stores/live';
import { useDecisionTrace } from '../../../lib/stores/decisions';
import { LiveOpsMap } from '../../../shared/map/live/LiveOpsMap';
import { AssignedCrewCard } from '../../detail/AssignedCrewCard';
import { Chip, Dot, EmptyState } from '../../../shared/ui';
import './dashboard.scss';

const RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
const KIND_LABEL = (k: string) => t(`kind.${k}`);

export function DashboardPage() {
  useLivePolling();
  const queue = useQueue();
  const summary = useSummary().data;

  useEffect(() => {
    wireIncidentFeed();
    wireFleetFeed();
    void loadIncidents();
    void loadUnits();
  }, []);

  // Live calls only: the demo resting-state incidents are hours old by now, and a clock
  // reading 5:12:40 would say something false about the service.
  const live = useMemo(() => queue.items.filter((i) => i.state !== 'closed' && !i.isResting), [queue.items]);

  // Live, non-demo emergencies: what a duty officer is watching right now. Waiting calls
  // first — they are the ones losing seconds — then by priority/report time.
  const responses = useMemo(() => [...live].sort((a, b) =>
    Number(!a.primary && !a.firstOnsceneAt ? 0 : 1) - Number(!b.primary && !b.firstOnsceneAt ? 0 : 1)
    || RANK[a.priority] - RANK[b.priority] || a.reportedAt.localeCompare(b.reportedAt)),
  [live]);

  // The PoC tells one story at a time — the dashboard surfaces just that one incident
  // (the most urgent live one) rather than a fan-out of every open call.
  const primary = responses[0] ?? null;

  // A card below the map opens the incident's AI log in the rail; its ref chip still goes
  // to the dispatch board.
  const focusIncident = (inc: Incident) => openDetail({ kind: 'incident', ref: inc.ref });
  const detail = useDetail();

  return (
    <div className="dash">
      <HeroBand summary={summary} />

      {/*
        The live operations map, shared with the full-screen wall view (/live) so the two
        can never drift. It used to be a bare canvas with forty identical dots on it: the
        map filled half the dashboard and answered nothing. Now it carries the response
        picture itself — alerts, the ambulances going to them, their routes and their
        countdowns — and hands off to the wall view when someone wants the whole screen.
      */}
      <section className="dash__map" aria-label={t('ops.map')}>
        <LiveOpsMap variant="embedded" onExpand={() => navigate('/live')} />
      </section>

      <aside className="dash__rail">
        {detail ? <DetailPanel /> : (
          <>
            <AutoDispatch />
            <LiveFeed />
          </>
        )}
      </aside>

      <section className="dash__bottom">
        <ResponsesStrip incident={primary} count={responses.length} targets={summary?.targets} onFocus={focusIncident} />
        <AssignedStrip incidentRef={primary?.ref ?? null} />
        <HospitalLoad hospitals={summary?.hospitals ?? []} />
      </section>
    </div>
  );
}

// ── Response-time band ───────────────────────────────────────────────────────

/** A card that opens its detail in the rail: click or Enter/Space. */
function opener(target: DetailTarget) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => openDetail(target, { toggle: true }),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(target, { toggle: true }); }
    },
  };
}

function HeroBand({ summary }: { summary: LiveSummary | null }) {
  const hourProfile = useHourProfile();
  const poc = usePoc();
  const kpi = summary?.kpi;
  const target = summary?.targets?.P1 ?? kpi?.targetSec ?? 480;
  const p50 = kpi?.responseP50Sec ?? null;
  const within = kpi?.withinTargetPct ?? null;
  const f = summary?.fleet;
  const ready = f ? f.available + f.standby : null;
  const busy = f ? f.assigned + f.responding + f.onScene + f.transporting + f.atHospital : null;
  const ai = summary?.aiDispatch;
  const active = summary?.active;

  return (
    <section className="dash__hero" aria-label="Today">
      <div className="hero-tile hero-tile--primary is-openable" {...opener({ kind: 'kpi', key: 'response' })}>
        <div className="hero-tile__label"><Timer aria-hidden /> {t('dash.responseToday')}</div>
        <div className="hero-tile__split">
          <div className="hero-tile__main">
            <div className="hero-tile__row">
              <span className={`hero-tile__value ${p50 == null ? '' : p50 <= target ? 'is-good' : 'is-bad'}`}>
                {duration(p50)}{p50 != null && <small className="hero-tile__suffix">{durationUnit(p50)}</small>}
              </span>
              <span className="hero-tile__unit">{t('dash.target', { time: `${duration(target)} ${durationUnit(target)}` })}</span>
            </div>
            <ResponseGauge valueSec={p50} targetSec={target} p90Sec={kpi?.responseP90Sec ?? null} />
          </div>
          <TrendBars trend={summary?.trend ?? []} target={target} expected={hourProfile} />
        </div>
      </div>

      <div className="hero-tile is-openable" {...opener({ kind: 'kpi', key: 'within' })}>
        <div className="hero-tile__label"><CircleCheck aria-hidden /> {t('dash.withinTarget')}</div>
        <div className="hero-tile__row">
          <span className={`hero-tile__value ${within == null ? '' : within >= 90 ? 'is-good' : within >= 75 ? 'is-warn' : 'is-bad'}`}>
            {within == null ? '—' : <>{Math.round(within)}<small className="hero-tile__suffix">%</small></>}
          </span>
          <span className="hero-tile__unit">{t('dash.ofResponsesUnit')}</span>
        </div>
        <div className="hero-tile__sub">{t('dash.ofResponses', { n: kpi?.responded ?? 0, what: plural(kpi?.responded ?? 0, 'response', 'responses') })}</div>
      </div>

      <div className="hero-tile is-openable" {...opener({ kind: 'kpi', key: 'active' })}>
        <div className="hero-tile__label"><Activity aria-hidden /> {t('dash.active')}</div>
        <div className="hero-tile__row">
          <span className="hero-tile__value">
            {active?.total ?? '—'}
            {active && <small className="hero-tile__suffix">{plural(active.total, 'incident', 'incidents')}</small>}
          </span>
          {!!active?.P1 && <Chip tone="danger">{active.P1} P1</Chip>}
          {!!active?.P2 && <Chip tone="warning">{active.P2} P2</Chip>}
        </div>
        <div className={`hero-tile__sub ${active?.waiting ? 'is-bad' : ''}`}>
          {active?.waiting ? t('dash.waiting', { n: active.waiting }) : t('dash.noneWaiting')}
        </div>
      </div>

      <div className="hero-tile is-openable" {...opener({ kind: 'kpi', key: 'fleet' })}>
        <div className="hero-tile__label"><Ambulance aria-hidden /> {t('dash.fleet')}</div>
        <div className="hero-tile__row">
          <span className="hero-tile__value">
            {ready ?? '—'}
            {ready != null && <small className="hero-tile__suffix">{t('dash.ofFleet', { total: poc.enabled ? poc.fleetSize : f!.total })}</small>}
          </span>
          {/* "1 / 8 ambulances": the noun belongs to the fleet, not to the one that is ready. */}
          <span className="hero-tile__unit">{plural(poc.enabled ? poc.fleetSize : f?.total ?? 0, 'ambulance', 'ambulances')}</span>
        </div>
        <div className="hero-tile__sub">{f ? t('dash.fleetBusy', { busy: busy ?? 0, what: plural(busy ?? 0, 'ambulance', 'ambulances') }) : '—'}</div>
      </div>

      <div className="hero-tile is-openable" {...opener({ kind: 'kpi', key: 'ai' })}>
        <div className="hero-tile__label"><BrainCircuit aria-hidden /> {t('dash.ai')}</div>
        {ai && ai.dispatches > 0 ? (
          <>
            <div className="hero-tile__row">
              <span className={`hero-tile__value ${ai.savedSec > 0 ? 'is-good' : ''}`}>
                {minutesValue(ai.savedSec)}<small className="hero-tile__suffix">min</small>
              </span>
              <span className="hero-tile__unit">{t(ai.dispatches === 1 ? 'dash.aiDispatch' : 'dash.aiDispatches', { n: ai.dispatches })}</span>
            </div>
            <div className="hero-tile__sub" title={ai.basis}>
              {ai.faster > 0 ? t('dash.aiSaved', { n: ai.faster }) : t('dash.aiNearest')}
            </div>
          </>
        ) : (
          <div className="hero-tile__sub">{t('dash.aiNone')}</div>
        )}
      </div>
    </section>
  );
}

/** Minutes saved, as the number alone — the tile prints "min" beside it. */
function minutesValue(sec: number): string {
  if (sec <= 0) return '0';
  return sec >= 600 ? String(Math.round(sec / 60)) : (sec / 60).toFixed(1);
}

/** The median and the 90th percentile against the target, on one scale. */
function ResponseGauge({ valueSec, targetSec, p90Sec }: { valueSec: number | null; targetSec: number; p90Sec: number | null }) {
  const scale = targetSec * 1.5;
  const at = (s: number) => `${Math.min(100, (s / scale) * 100)}%`;
  return (
    <div className="gauge" role="img" aria-label={`Median ${duration(valueSec)} against a ${duration(targetSec)} target`}>
      <div className="gauge__track">
        {valueSec != null && <div className={`gauge__fill ${valueSec <= targetSec ? 'is-good' : 'is-bad'}`} style={{ width: at(valueSec) }} />}
        {p90Sec != null && <div className="gauge__p90" style={{ insetInlineStart: at(p90Sec) }} title={`90th percentile ${duration(p90Sec)}`} />}
        <div className="gauge__target" style={{ insetInlineStart: at(targetSec) }} />
      </div>
      <div className="gauge__scale">
        {/* The axis carries the unit once, as a chart axis does; the marks stay short
            enough that the target and the 90th percentile never run into each other. */}
        <span>0 min</span>
        <span style={{ insetInlineStart: at(targetSec) }} className="gauge__target-label">{duration(targetSec)}</span>
        {p90Sec != null && <span className="gauge__p90-label" style={{ insetInlineStart: at(p90Sec) }}>p90 {duration(p90Sec)}</span>}
      </div>
    </div>
  );
}

// ── Automatic dispatch ──────────────────────────────────────────────────────

/** The automatic-dispatch policy in force, kept current over the socket. */
function useRulesMode(): DispatchRulesState | null {
  const [rules, setRules] = useState<DispatchRulesState | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.dispatchRules.get().then((r) => { if (!cancelled) setRules(r); }).catch(() => { /* the card still renders */ });
    const off = onSocket('dispatch:rules', (r) => setRules(r));
    return () => { cancelled = true; off(); };
  }, []);
  return rules;
}

/**
 * What the AI is about to do — and the way into how it decides.
 *
 * This card replaced the simulation panel. The trial is automatic dispatch — every camera
 * alert goes to the engine's top recommendation after a short window — so what the room
 * needs to see is the queue itself: which alerts are about to be dispatched, and in how many
 * seconds. The card opens its detail in the rail: the rules (the AI's own, or a duty
 * officer's), the AI's advisory, the fleet outlook and today's decisions. A queue row opens
 * that incident's AI log.
 */
function AutoDispatch() {
  const { state } = useSim();
  const poc = usePoc();
  const now = useNow();
  const rules = useRulesMode();
  const open = useIsOpen({ kind: 'auto' });
  const pending = state?.pending ?? [];
  const running = state?.running ?? false;

  return (
    <div className={`dash-card autodispatch is-openable${open ? ' is-open' : ''}`} {...opener({ kind: 'auto' })}>
      <div className="dash-card__head">
        <div className="dash-card__title"><BrainCircuit aria-hidden /> {t('auto.title')}</div>
        <span className={`autodispatch__status ${running ? 'is-on' : ''}`}>
          <Dot tone={running ? 'success' : 'neutral'} />
          {running ? t('auto.on') : t('auto.starting')}
        </span>
      </div>

      <dl className="autodispatch__facts">
        <div>
          <dt><ListChecks aria-hidden /> {t('auto.rules')}</dt>
          <dd>{!rules ? '—' : rules.mode === 'ai' ? t('auto.rulesAi') : t('auto.rulesCustom')}</dd>
        </div>
        <div>
          <dt><Cctv aria-hidden /> {t('auto.source')}</dt>
          <dd>{t('auto.sourceValue', { n: poc.camerasPerUnit })}</dd>
        </div>
        <div>
          <dt><Ambulance aria-hidden /> {t('auto.fleet')}</dt>
          <dd>{t('auto.fleetValue', { n: poc.fleetSize })}</dd>
        </div>
        <div>
          <dt><Send aria-hidden /> {t('auto.today')}</dt>
          <dd>{t('auto.todayValue', { n: state?.autoDispatched ?? 0, what: plural(state?.autoDispatched ?? 0, 'dispatch', 'dispatches') })}</dd>
        </div>
      </dl>

      <div className="autodispatch__queue">
        <div className="autodispatch__label">{t('auto.queue')}</div>
        {!pending.length && <div className="autodispatch__empty">{t('auto.queueEmpty')}</div>}
        {pending.slice(0, 4).map((p) => {
          const left = Math.max(0, Math.ceil((Date.parse(p.dueAt) - now) / 1000));
          return (
            <button type="button" className="countdown" key={p.incidentRef}
                    onClick={(e) => { e.stopPropagation(); openDetail({ kind: 'incident', ref: p.incidentRef }); }}
                    title={t('auto.openHelp')}>
              <span className={`prio prio--${p.priority}`}>{p.priority}</span>
              <span className="countdown__what">
                {KIND_LABEL(p.kind)}<span>{p.zoneName ?? p.incidentRef}</span>
              </span>
              <span className="countdown__clock">{left}<small> s</small></span>
            </button>
          );
        })}
      </div>
      <div className="autodispatch__more">{t('auto.more')} <ChevronRight aria-hidden /></div>
    </div>
  );
}

// ── Live feed ────────────────────────────────────────────────────────────────

const STAGE_ICON: Record<string, typeof Clock> = {
  // A road incident is reported by a camera; the phone is kept for anything that did
  // arrive by phone (a resting incident transferred from 999), so the icon never lies.
  reported: Cctv, triaged: Activity, dispatched: Send, redispatched: Send,
  unit_acknowledged: CheckCheck, unit_enroute: Navigation, onscene: MapPin, unit_onscene: MapPin,
  crew_at_patient: HeartPulse, transporting: Ambulance, at_hospital: Hospital, resolved_on_scene: CircleCheck,
  unit_cleared: CircleCheck, closed: CircleCheck, unit_declined: XCircle, offer_timed_out: Clock,
  unit_stood_down: XCircle,
};
const STAGE_TONE: Record<string, string> = {
  reported: 'call', dispatched: 'ai', redispatched: 'warn', unit_declined: 'warn', offer_timed_out: 'warn',
  onscene: 'good', unit_onscene: 'good', crew_at_patient: 'good', transporting: 'info', at_hospital: 'info',
};

function LiveFeed() {
  const { items, fresh, status } = useFeed();
  return (
    <div className="dash-card feed">
      <div className="dash-card__head">
        <button type="button" className="dash-card__title dash-card__title--btn" onClick={() => openDetail({ kind: 'feed' })} title={t('dash.feedAll')}>
          <Activity aria-hidden /> {t('dash.feed')} <ChevronRight aria-hidden />
        </button>
        <span className="feed__live"><span className="feed__pulse" aria-hidden /> LIVE</span>
      </div>
      <ol className="feed__list" aria-live="polite">
        {status === 'ready' && !items.length && <li className="feed__empty">{t('dash.feedNone')}</li>}
        {items.map((item) => <FeedRow key={item.id} item={item} fresh={!!fresh[item.id]} />)}
      </ol>
    </div>
  );
}

function FeedRow({ item, fresh }: { item: FeedItem; fresh: boolean }) {
  const Icon = item.stage === 'reported' && /call received/i.test(item.label) ? PhoneIncoming : STAGE_ICON[item.stage] ?? Clock;
  const time = new Date(item.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' });
  return (
    <li className={`feed__row ${fresh ? 'is-fresh' : ''}`} data-tone={STAGE_TONE[item.stage] ?? 'plain'}>
      <button type="button" onClick={() => openDetail({ kind: 'incident', ref: item.incidentRef })}>
        <span className="feed__icon"><Icon aria-hidden /></span>
        <span className="feed__body">
          <span className="feed__label">{item.label}</span>
          <span className="feed__meta">
            {item.priority && <span className={`prio prio--${item.priority}`}>{item.priority}</span>}
            {item.kind && <span>{KIND_LABEL(item.kind)}</span>}
            {item.zoneName && <span>· {item.zoneName}</span>}
          </span>
        </span>
        <span className="feed__time">{time}</span>
      </button>
    </li>
  );
}

// ── Live responses ───────────────────────────────────────────────────────────

/**
 * The one incident the PoC's paced demo is telling right now — not a fan-out strip of
 * every open call. `count` still reports how many are technically live, in case more
 * than one ever is, but only the most urgent (waiting calls first) gets a card.
 */
function ResponsesStrip({ incident, count, targets, onFocus }: {
  incident: Incident | null; count: number; targets: Record<Priority, number> | undefined; onFocus: (inc: Incident) => void;
}) {
  const pending = useSim().state?.pending;
  const now = useNow();
  const dueBy = new Map((pending ?? []).map((p) => [p.incidentRef, Date.parse(p.dueAt)]));

  return (
    <div className="dash-card responses">
      <div className="dash-card__head">
        <div className="dash-card__title"><Timer aria-hidden /> {t('dash.responses')}</div>
        <span className="dash-card__count">{count}</span>
      </div>
      {!incident ? (
        <EmptyState icon={<Ambulance aria-hidden />} title={t('dash.responsesNone')} body={t('dash.responsesNoneBody')} />
      ) : (
        <div className="responses__row">
          {(() => {
            const inc = incident;
            const target = targets?.[inc.priority] ?? 480;
            const arrived = inc.firstOnsceneAt != null;
            const elapsed = arrived && inc.responseSec != null
              ? inc.responseSec
              : Math.max(0, Math.round((now - Date.parse(inc.reportedAt)) / 1000));
            const ratio = elapsed / target;
            const tone = ratio > 1 ? 'bad' : ratio > 0.75 ? 'warn' : 'good';
            const due = dueBy.get(inc.ref);
            const p = inc.primary;
            const etaLeft = p?.etaPredictedAt ? Math.round((Date.parse(p.etaPredictedAt) - now) / 1000) : null;

            const waiting = !p && !arrived;
            let stage: string;
            if (!p) stage = arrived ? t('dash.cleared') : due ? t('dash.aiIn', { s: Math.max(0, Math.ceil((due - now) / 1000)) }) : t('dash.awaiting');
            else if (arrived) stage = `${p.callsign} · ${t(`asg.state.${p.state}`)}`;
            else stage = `${p.callsign} · ${t(`asg.state.${p.state}`)}${etaLeft != null && etaLeft > 0 ? ` · ${t('dash.eta', { time: `${duration(etaLeft)} ${durationUnit(etaLeft)}` })}` : ''}`;

            return (
              <article key={inc.ref} className={`rcard rcard--${inc.priority} ${waiting ? 'is-waiting' : ''}`} data-tone={tone}>
                <button type="button" className="rcard__main" onClick={() => onFocus(inc)}>
                  <div className="rcard__top">
                    <span className={`prio prio--${inc.priority}`}>{inc.priority}</span>
                    <span className="rcard__kind">{KIND_LABEL(inc.kind)}</span>
                  </div>
                  <div className="rcard__where">
                    {inc.zoneName ?? inc.ref}
                  </div>
                  <div className="rcard__stage">{stage}</div>
                  <div className="rcard__clock">
                    <span className="rcard__elapsed">{duration(elapsed)}<small> {durationUnit(elapsed)}</small></span>
                    <span className="rcard__target">
                      {arrived
                        ? (elapsed > target
                          ? t('dash.overTarget', { time: `${duration(elapsed - target)} ${durationUnit(elapsed - target)}` })
                          : t('dash.arrivedIn', { time: `${duration(elapsed)} ${durationUnit(elapsed)}` }))
                        : t('dash.ofTarget', { time: `${duration(target)} ${durationUnit(target)}` })}
                    </span>
                  </div>
                  <div className="rcard__bar"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                </button>
                <button type="button" className="rcard__open" onClick={() => openIncident(inc.ref)}>{inc.ref}</button>
              </article>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * "Ambulance on this incident" — sits right beside Live responses, not buried in the
 * rail. Fed by the same `useDecisionTrace` poll the rail's AI log uses, so ETA/speed/
 * traffic keep updating live straight through arrival with no gap in the demo.
 */
function AssignedStrip({ incidentRef }: { incidentRef: string | null }) {
  const { data } = useDecisionTrace(incidentRef);
  const now = useNow();

  return (
    <div className="dash-card assigned">
      <div className="dash-card__head">
        <div className="dash-card__title"><Ambulance aria-hidden /> {t('detail.inc.assigned')}</div>
      </div>
      {data?.assignment ? (
        <div className="assigned__body"><AssignedCrewCard trace={data} now={now} showTitle={false} compact /></div>
      ) : (
        <EmptyState icon={<Ambulance aria-hidden />} title={t('dash.assignedNone')} body={t('dash.assignedNoneBody')} />
      )}
    </div>
  );
}


// ── Hospitals ────────────────────────────────────────────────────────────────

function HospitalLoad({ hospitals }: { hospitals: LiveSummary['hospitals'] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? hospitals : hospitals.slice(0, 6);
  return (
    <div className="dash-card hospitals">
      <div className="dash-card__head">
        <div className="dash-card__title"><Hospital aria-hidden /> {t('dash.hospitals')}</div>
        {hospitals.length > 6 && (
          <button type="button" className="dash-card__link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Top 6' : `All ${hospitals.length}`}
          </button>
        )}
      </div>
      <ul className="hospitals__list">
        {shown.map((h) => {
          const pct = h.occupancyPct ?? 0;
          const tone = h.onDiversion || pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good';
          return (
            <li key={h.ref} className="hospitals__row is-openable" data-tone={tone} {...opener({ kind: 'hospital', ref: h.ref })}>
              <span className="hospitals__name" title={h.name}>{h.name}</span>
              <span className="hospitals__bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
              <span className="hospitals__pct" title={t('dash.occupancyHelp')}>{h.onDiversion ? t('dash.diversion') : t('dash.occupancy', { pct })}</span>
              <span className="hospitals__inbound" title={t('dash.inboundHelp')}>{h.inbound ? <><Ambulance aria-hidden />{t('dash.inbound', { n: h.inbound })}</> : ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Today's trend ────────────────────────────────────────────────────────────

/** Today's median response, hour by hour, against the target line — small, beside the number. */
function TrendBars({ trend, target, expected }: {
  trend: LiveSummary['trend'];
  target: number;
  /** Median response by hour over the trailing fortnight — the rest of today, expected. */
  expected: Map<number, number>;
}) {
  const byHour = new Map(trend.map((r) => [r.hour, r]));
  const currentHour = trend.length ? Math.max(...trend.map((r) => r.hour)) : 0;
  const max = Math.max(target * 1.4, ...trend.map((r) => r.p50Sec ?? 0), ...expected.values());
  const W = 24 * 12;
  const H = 70;
  const y = (s: number) => H - (s / max) * H;
  return (
    <div className="trend" title={t('dash.trend')}>
      <div className="trend__label">
        <Clock aria-hidden /> {t('dash.todayByHour')}
        {expected.size > 0 && <span className="trend__legend" title={t('dash.expectedHelp')}>{t('dash.expected')}</span>}
      </div>
      <svg className="trend__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('dash.trend')}>
        {Array.from({ length: 24 }, (_, h) => {
          const r = byHour.get(h);
          const v = r?.p50Sec;
          if (v == null) {
            // Hours still ahead are drawn as the expectation, hollow and dashed: a
            // prediction on the live picture must never look like a measurement.
            const e = h > currentHour ? expected.get(h) : undefined;
            if (e != null) {
              return (
                <rect key={h} x={h * 12 + 2} y={y(e)} width={8} height={H - y(e)} className="trend__expected"
                      vectorEffect="non-scaling-stroke">
                  <title>{t('dash.expectedAt', { hour: String(h).padStart(2, '0'), time: duration(e) })}</title>
                </rect>
              );
            }
            return h <= currentHour ? <rect key={h} x={h * 12 + 2} y={H - 1} width={8} height={1} className="trend__empty" /> : null;
          }
          return (
            <rect key={h} x={h * 12 + 2} y={y(v)} width={8} height={H - y(v)}
              className={v > target ? 'trend__bar is-over' : 'trend__bar'}>
              <title>{`${String(h).padStart(2, '0')}:00 — median ${duration(v)} from ${r!.n} responses`}</title>
            </rect>
          );
        })}
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="trend__target" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="trend__axis" aria-hidden>
        {['00', '06', '12', '18', '24'].map((h) => <span key={h}>{h}</span>)}
      </div>
    </div>
  );
}

/**
 * The hourly response profile over the trailing fortnight, loaded once per session.
 *
 * This is what makes the dashboard's one chart carry a prediction: the hours of today that
 * have not happened yet are drawn as what the same hours have actually been running at.
 * Deliberately NOT the forecasting engine — an hour-of-day profile is the honest statement
 * here, and it is labelled as a profile rather than dressed up as a model.
 */
function useHourProfile(): Map<number, number> {
  const [profile, setProfile] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api.insights.performance({ days: 14, ahead: 0 })
      .then((r) => {
        if (cancelled) return;
        setProfile(new Map(r.byHour.filter((h) => h.p50Sec != null).map((h) => [h.hour, h.p50Sec as number])));
      })
      .catch(() => { /* the band renders without it */ });
    return () => { cancelled = true; };
  }, []);
  return profile;
}
