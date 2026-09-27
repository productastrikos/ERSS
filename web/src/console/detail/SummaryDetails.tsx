/**
 * The smaller details behind the dashboard's cards: an emergency department, a headline
 * figure, the whole live feed.
 *
 * Each reads what the dashboard already loaded (the live summary, the routes, the feed) —
 * never its own query — so a panel can never contradict the card that opened it.
 */

import { useMemo, useState } from 'react';
import { Activity, Ambulance, BrainCircuit, CircleCheck, Clock, Hospital, Timer } from 'lucide-react';
import type { FeedItem } from '../../lib/types';
import { t } from '../../lib/i18n';
import { duration, durationUnit, UNIT_STATUS_LABEL } from '../../lib/format';
import { useNow } from '../../lib/stores/now';
import { useFeed, useLiveRoutes, useSummary } from '../../lib/stores/live';
import { useFleet } from '../../lib/stores/fleet';
import { useQueue } from '../../lib/stores/incidents';
import { usePoc } from '../../lib/stores/session';
import { openDetail, type KpiKey } from '../../lib/stores/detail';
import { Chip, EmptyState, Segmented, Skeleton } from '../../shared/ui';

const withUnit = (sec: number | null | undefined) => (sec == null ? '—' : `${duration(sec)} ${durationUnit(sec)}`);

// ── An emergency department ──────────────────────────────────────────────────

export function HospitalDetail({ hospitalRef }: { hospitalRef: string }) {
  const summary = useSummary().data;
  const routes = useLiveRoutes();
  const now = useNow();
  const h = summary?.hospitals.find((x) => x.ref === hospitalRef);
  if (!summary) return <div className="dtl__loading"><Skeleton height={140} /></div>;
  if (!h) return <EmptyState icon={<Hospital aria-hidden />} title={t('detail.hosp.none')} body="" />;
  const pct = h.occupancyPct ?? 0;
  const tone = h.onDiversion || pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good';
  const inbound = (routes?.assignments ?? []).filter((a) => a.hospital?.ref === hospitalRef);
  return (
    <div className="dtl-hosp">
      <header className="dtl-unit__head">
        <span className="dtl-unit__badge"><Hospital aria-hidden /></span>
        <div className="dtl-unit__id"><h3>{h.name}</h3><span>{h.ref}</span></div>
        {h.onDiversion ? <Chip tone="danger">{t('dash.diversion')}</Chip> : <Chip tone={tone === 'good' ? 'success' : 'warning'}>{t('detail.hosp.accepting')}</Chip>}
      </header>
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Activity aria-hidden /> {t('detail.hosp.load')}</h4>
        <div className="dtl-meter" data-tone={tone}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="dtl-kv dtl-kv--3">
          <div><span>{t('detail.hosp.occupied')}</span><strong>{h.edOccupied}<small> / {h.edBeds} {t('detail.hosp.beds')}</small></strong></div>
          <div><span>{t('detail.hosp.full')}</span><strong>{pct}%</strong></div>
          <div><span>{t('detail.hosp.inbound')}</span><strong>{h.inbound}</strong></div>
        </div>
        <p className="dtl-sec__note">{t('dash.occupancyHelp')}</p>
      </section>
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Ambulance aria-hidden /> {t('detail.hosp.coming')}</h4>
        {!inbound.length && <p className="dtl-sec__lede">{t('detail.hosp.noneComing')}</p>}
        <ul className="dtl-list">
          {inbound.map((a) => (
            <li key={a.ref}>
              <button type="button" onClick={() => openDetail({ kind: 'incident', ref: a.incidentRef })}>
                <span className={`prio prio--${a.priority}`}>{a.priority}</span>
                <span className="dtl-list__main"><strong>{a.callsign}</strong><span>{t(`kind.${a.kind}`)} · {a.zoneName ?? a.incidentRef}</span></span>
                <span className="dtl-list__meta mono">{a.remainingM != null ? `${(a.remainingM / 1000).toFixed(1)} km` : t(`asg.state.${a.state}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dtl-sec__note">{t('detail.hosp.engine', { at: new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) })}</p>
      </section>
    </div>
  );
}

// ── A headline figure ────────────────────────────────────────────────────────

const KPI_META: Record<KpiKey, { title: string; icon: typeof Timer; def: string }> = {
  response: { title: 'dash.responseToday', icon: Timer, def: 'detail.kpi.def.response' },
  within: { title: 'dash.withinTarget', icon: CircleCheck, def: 'detail.kpi.def.within' },
  active: { title: 'dash.active', icon: Activity, def: 'detail.kpi.def.active' },
  fleet: { title: 'dash.fleet', icon: Ambulance, def: 'detail.kpi.def.fleet' },
  ai: { title: 'dash.ai', icon: BrainCircuit, def: 'detail.kpi.def.ai' },
};

export function KpiDetail({ kpi }: { kpi: KpiKey }) {
  const summary = useSummary().data;
  const meta = KPI_META[kpi];
  const Icon = meta.icon;
  if (!summary) return <div className="dtl__loading"><Skeleton height={140} /></div>;
  return (
    <div className="dtl-kpi">
      <header className="dtl-unit__head">
        <span className="dtl-unit__badge"><Icon aria-hidden /></span>
        <div className="dtl-unit__id"><h3>{t(meta.title)}</h3><span>{t('detail.kpi.today')}</span></div>
      </header>
      <p className="dtl-sec__lede">{t(meta.def)}</p>
      {kpi === 'response' || kpi === 'within' ? <ResponseKpi /> : kpi === 'active' ? <ActiveKpi /> : kpi === 'fleet' ? <FleetKpi /> : <AiKpi />}
      <p className="dtl-sec__note">{t('detail.kpi.source')}</p>
    </div>
  );
}

function ResponseKpi() {
  const summary = useSummary().data!;
  const k = summary.kpi;
  const target = summary.targets?.P1 ?? k?.targetSec ?? 480;
  const max = Math.max(target * 1.4, ...summary.trend.map((r) => r.p50Sec ?? 0));
  return (
    <>
      <div className="dtl-kv dtl-kv--3">
        <div><span>{t('detail.kpi.median')}</span><strong className={(k?.responseP50Sec ?? 0) <= target ? 'is-good' : 'is-bad'}>{withUnit(k?.responseP50Sec)}</strong></div>
        <div><span>{t('detail.kpi.p90')}</span><strong>{withUnit(k?.responseP90Sec)}</strong></div>
        <div><span>{t('detail.kpi.target')}</span><strong>{withUnit(target)}</strong></div>
        <div><span>{t('dash.withinTarget')}</span><strong>{k?.withinTargetPct == null ? '—' : `${Math.round(k.withinTargetPct)}%`}</strong></div>
        <div><span>{t('detail.kpi.responses')}</span><strong>{k?.responded ?? 0}</strong></div>
      </div>
      <section className="dtl-sec">
        <h4 className="dtl-sec__title"><Clock aria-hidden /> {t('dash.todayByHour')}</h4>
        <ul className="dtl-hours">
          {summary.trend.map((r) => (
            <li key={r.hour} title={`${String(r.hour).padStart(2, '0')}:00 — ${withUnit(r.p50Sec)} · ${r.n}`}>
              <span className="dtl-hours__bar" data-over={(r.p50Sec ?? 0) > target}><span style={{ height: `${((r.p50Sec ?? 0) / max) * 100}%` }} /></span>
              <span className="dtl-hours__h">{String(r.hour).padStart(2, '0')}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function ActiveKpi() {
  const queue = useQueue();
  const live = queue.items.filter((i) => i.state !== 'closed' && !i.isResting);
  if (!live.length) return <EmptyState icon={<Activity aria-hidden />} title={t('dash.responsesNone')} body={t('dash.responsesNoneBody')} />;
  return (
    <ul className="dtl-list">
      {live.map((i) => (
        <li key={i.ref}>
          <button type="button" onClick={() => openDetail({ kind: 'incident', ref: i.ref })}>
            <span className={`prio prio--${i.priority}`}>{i.priority}</span>
            <span className="dtl-list__main"><strong>{t(`kind.${i.kind}`)}</strong><span>{i.zoneName ?? i.ref}</span></span>
            <span className="dtl-list__meta mono">{i.ref}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FleetKpi() {
  const fleet = useFleet();
  const poc = usePoc();
  const units = fleet.units.filter((u) => u.agencyCode === 'DCAS');
  return (
    <>
      <p className="dtl-sec__note">{t('detail.kpi.fleetScope', { n: poc.fleetSize })}</p>
      <ul className="dtl-list">
        {units.map((u) => (
          <li key={u.ref}>
            <button type="button" onClick={() => openDetail({ kind: 'unit', ref: u.ref })}>
              <Ambulance aria-hidden className="dtl-list__icon" />
              <span className="dtl-list__main"><strong>{u.callsign}</strong><span>{u.kind} · {u.ref}</span></span>
              <span className="dtl-list__meta">{UNIT_STATUS_LABEL[u.status] ?? u.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function AiKpi() {
  const ai = useSummary().data?.aiDispatch;
  return (
    <>
      <div className="dtl-kv dtl-kv--3">
        <div><span>{t('detail.auto.dispatches')}</span><strong>{ai?.dispatches ?? 0}</strong></div>
        <div><span>{t('detail.auto.saved')}</span><strong className="is-good">{withUnit(ai?.savedSec ?? 0)}</strong></div>
        <div><span>{t('detail.auto.faster')}</span><strong>{ai?.faster ?? 0}</strong></div>
      </div>
      {ai?.basis && <p className="dtl-sec__note">{ai.basis}</p>}
      <button type="button" className="dtl-linkrow" onClick={() => openDetail({ kind: 'auto' })}>
        <BrainCircuit aria-hidden /> {t('detail.kpi.openAuto')}
      </button>
    </>
  );
}

// ── The whole live feed ──────────────────────────────────────────────────────

type FeedFilter = 'all' | 'ai' | 'arrivals' | 'problems';
const IS: Record<FeedFilter, (f: FeedItem) => boolean> = {
  all: () => true,
  ai: (f) => f.stage === 'dispatched' || f.stage === 'redispatched',
  arrivals: (f) => ['onscene', 'unit_onscene', 'crew_at_patient', 'at_hospital'].includes(f.stage),
  problems: (f) => ['unit_declined', 'offer_timed_out', 'redispatched', 'unit_stood_down'].includes(f.stage),
};

export function FeedDetail() {
  const { items } = useFeed();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const shown = useMemo(() => items.filter(IS[filter]), [items, filter]);
  return (
    <div className="dtl-feed">
      <Segmented<FeedFilter> ariaLabel={t('dash.feed')} value={filter} onChange={setFilter} options={[
        { value: 'all', label: t('detail.feed.all') }, { value: 'ai', label: t('detail.feed.ai') },
        { value: 'arrivals', label: t('detail.feed.arrivals') }, { value: 'problems', label: t('detail.feed.problems') },
      ]} />
      <ul className="dtl-list">
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => openDetail({ kind: 'incident', ref: f.incidentRef })}>
              {f.priority && <span className={`prio prio--${f.priority}`}>{f.priority}</span>}
              <span className="dtl-list__main"><strong>{f.label}</strong><span>{f.kind ? t(`kind.${f.kind}`) : ''}{f.zoneName ? ` · ${f.zoneName}` : ''}</span></span>
              <span className="dtl-list__meta mono">{new Date(f.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' })}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
