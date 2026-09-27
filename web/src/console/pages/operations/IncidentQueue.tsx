/**
 * The incident queue — docs/06 §2.1, card anatomy per docs/05 §7.1.
 *
 * Sorted by priority then time waiting. A card that arrived over the socket pulses once;
 * a P1 can also play a short tone — off by default, remembered per device.
 */

import { useEffect, useState } from 'react';
import { Inbox, Plus, Timer, Volume2, VolumeX } from 'lucide-react';
import type { Incident, Priority } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { count, duration, floorLabel, makani } from '../../../lib/format';
import { useNow } from '../../../lib/stores/now';
import { onIncidentArrival, type QueueScope } from '../../../lib/stores/incidents';
import { Button, Card, Chip, EmptyState, ErrorState, Predicted, Segmented, Skeleton } from '../../../shared/ui';
import { AgencyMark } from './opsUi';
import { EN_ROUTE, kindLabel, useAgencies } from './opsModel';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
const TONE_KEY = 'erss.ops.p1tone';


function readTone(): boolean {
  try { return localStorage.getItem(TONE_KEY) === 'on'; } catch { return false; }
}

/** A short two-note alert, synthesised — no audio file to ship or fail to load. */
function playTone() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.18);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch { /* no audio device — the pulse still shows */ }
}

export function IncidentQueue({
  items, status, error, scope, onScope, priorities, onPriorities, selectedRef, onChoose,
  arrived, canCreate, onCreate, onRetry,
}: {
  items: Incident[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  scope: QueueScope;
  onScope: (s: QueueScope) => void;
  priorities: Priority[];
  onPriorities: (p: Priority[]) => void;
  selectedRef: string | null;
  onChoose: (i: Incident) => void;
  arrived: Record<string, number>;
  canCreate: boolean;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const now = useNow();
  const agencies = useAgencies();
  const [tone, setTone] = useState(readTone);

  useEffect(() => onIncidentArrival((inc) => { if (tone && inc.priority === 'P1') playTone(); }), [tone]);

  const toggleTone = () => {
    const next = !tone;
    setTone(next);
    try { localStorage.setItem(TONE_KEY, next ? 'on' : 'off'); } catch { /* a preference only */ }
  };

  const shown = priorities.length ? items.filter((i) => priorities.includes(i.priority)) : items;
  const togglePriority = (p: Priority) =>
    onPriorities(priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p].sort());

  return (
    <Card
      className="ops__queue-card"
      title={t('incident.queue')}
      flush
      actions={(
        <>
          <Button variant="ghost" size="sm" iconOnly onClick={toggleTone}
                  aria-label={tone ? t('incident.toneOn') : t('incident.toneOff')}
                  title={tone ? t('incident.toneOn') : t('incident.toneOff')}>
            {tone ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
          </Button>
          {canCreate && (
            <Button variant="secondary" size="sm" iconOnly onClick={onCreate} aria-label={t('incident.new')} title={t('incident.new')}>
              <Plus aria-hidden />
            </Button>
          )}
        </>
      )}
    >
      <div className="queue__filters">
        <Segmented<QueueScope>
          value={scope}
          onChange={onScope}
          ariaLabel={t('incident.queue')}
          options={[
            { value: 'active', label: `${t('incident.active')}${scope === 'active' && status === 'ready' ? ` ${count(items.length)}` : ''}` },
            { value: 'all', label: t('incident.today') },
          ]}
        />
        <div className="queue__prio" role="group" aria-label={t('incident.filterPriority')}>
          {PRIORITIES.map((p) => (
            <button key={p} type="button" className="queue__prio-btn" data-priority={p}
                    aria-pressed={priorities.includes(p)} onClick={() => togglePriority(p)}
                    title={t(`priority.${p}`)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' || status === 'idle' ? (
        <div className="queue__skeleton">
          <Skeleton height={76} /><Skeleton height={76} /><Skeleton height={76} />
        </div>
      ) : status === 'error' ? (
        <ErrorState body={error ?? undefined} onRetry={onRetry} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Inbox aria-hidden />}
                    title={scope === 'active' ? t('incident.none') : t('incident.noneToday')}
                    body={t('incident.noneBody')} />
      ) : (
        <ul className="ops__list">
          {shown.map((inc) => (
            <IncidentCard key={inc.ref} incident={inc} now={now} agencies={agencies}
                          selected={inc.ref === selectedRef}
                          fresh={arrived[inc.ref] !== undefined}
                          onChoose={() => onChoose(inc)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function IncidentCard({ incident, now, agencies, selected, fresh, onChoose }: {
  incident: Incident;
  now: number;
  agencies: ReturnType<typeof useAgencies>;
  selected: boolean;
  fresh: boolean;
  onChoose: () => void;
}) {
  const p = incident.primary;
  const closed = incident.state === 'closed';
  const elapsed = (now - Date.parse(incident.reportedAt)) / 1000;
  const etaSec = p?.etaPredictedAt && EN_ROUTE.has(p.state) ? (Date.parse(p.etaPredictedAt) - now) / 1000 : null;
  const awaiting = !p && !closed;
  const place = incident.building?.name ?? incident.zoneName ?? '—';

  return (
    <li className="inc" data-priority={incident.priority} data-selected={selected || undefined} data-fresh={fresh || undefined}
        role="button" tabIndex={0} aria-pressed={selected} onClick={onChoose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(); } }}>
      <div className="inc__rail" aria-hidden />
      <div className="inc__body">
        <div className="inc__top">
          <span className="inc__prio">{incident.priority}</span>
          <span className="inc__kind">{kindLabel(incident.kind)}</span>
          <span className="inc__ref">{incident.ref}</span>
        </div>

        <div className="inc__place">
          {place}
          {incident.floor != null && <span className="inc__floor"> · {floorLabel(incident.floor)}</span>}
        </div>

        {incident.makani && (
          <div className="inc__makani">
            {t('incident.makani')} {makani(incident.makani)}
            {incident.building && ` · ${t('incident.entranceOf', { n: incident.building.entranceNo, count: incident.building.entranceCount })}`}
          </div>
        )}

        <div className="inc__meta">
          <span className="inc__elapsed numeric" title={closed ? t('incident.response') : t('incident.elapsed')}>
            <Timer aria-hidden />
            {closed ? duration(incident.responseSec) : duration(elapsed)}
          </span>
          {p ? (
            <span className="inc__unit">
              <span className="mono">{p.unitRef}</span> {t(`asg.state.${p.state}`).toLowerCase()}
              {incident.activeUnits > 1 && ` ${t('incident.moreUnits', { n: incident.activeUnits - 1 })}`}
            </span>
          ) : awaiting ? (
            <span className="inc__awaiting">{t('incident.awaiting')}</span>
          ) : (
            <span>{t(`outcome.${incident.outcome}`)}</span>
          )}
          {etaSec !== null && (
            <Predicted method={p?.etaMethod ?? undefined}>
              {t('incident.eta')} {etaSec >= 0 ? duration(etaSec) : `+${duration(-etaSec)}`}
            </Predicted>
          )}
        </div>

        {(incident.agenciesInvolved.length > 0 || incident.isResting) && (
          <div className="inc__foot">
            <span className="inc__agencies">
              {incident.agenciesInvolved.map((code) => <AgencyMark key={code} code={code} agencies={agencies} size={13} />)}
            </span>
            {incident.isResting && <Chip tone="neutral" className="inc__resting" title={t('incident.restingTitle')}>{t('incident.resting')}</Chip>}
          </div>
        )}
      </div>
    </li>
  );
}
