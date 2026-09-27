/**
 * The resting surfaces of the Operations screen: the fleet status board shown when no
 * incident is selected (docs/06 §2.3), the fleet summary under the queue, and the KPI
 * strip (docs/06 §2.4).
 */

import { useEffect, useMemo, useState } from 'react';
import type { Unit, UnitStatus } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { api } from '../../../lib/api';
import { count, decimal1, duration, pct, timeGst, UNIT_KIND_LABEL, durationUnit } from '../../../lib/format';
import { useFleet } from '../../../lib/stores/fleet';
import { useKpis } from '../../../lib/stores/kpis';
import { Card, Dot, ErrorState, Meter, Predicted, Skeleton } from '../../../shared/ui';

const COMMITTED: ReadonlySet<UnitStatus> = new Set(['assigned', 'responding', 'on_scene', 'transporting', 'at_hospital']);

function tally(units: Unit[]) {
  const t0 = { available: 0, standby: 0, committed: 0, off: 0, total: units.length };
  for (const u of units) {
    if (u.status === 'available') t0.available++;
    else if (u.status === 'standby' || u.status === 'relocating') t0.standby++;
    else if (COMMITTED.has(u.status)) t0.committed++;
    else t0.off++;
  }
  return t0;
}

export function FleetSummary() {
  const { units, status } = useFleet();
  const dcas = units.filter((u) => u.agencyCode === 'DCAS');
  const n = (s: UnitStatus[]) => dcas.filter((u) => s.includes(u.status)).length;
  return (
    <Card title={t('fleet.title')} subtitle={t('agency.DCAS')}>
      {status !== 'ready' && !units.length ? <Skeleton height={80} /> : (
        <dl className="ops__fleet">
          <div><dt><Dot tone="success" /> {t('fleet.available')}</dt><dd className="numeric">{n(['available', 'standby'])}</dd></div>
          <div><dt><Dot tone="warning" /> {t('fleet.responding')}</dt><dd className="numeric">{n(['assigned', 'responding'])}</dd></div>
          <div><dt><Dot tone="info" /> {t('fleet.onScene')}</dt><dd className="numeric">{n(['on_scene'])}</dd></div>
          <div><dt><Dot tone="accent" /> {t('fleet.transporting')}</dt><dd className="numeric">{n(['transporting', 'at_hospital'])}</dd></div>
        </dl>
      )}
    </Card>
  );
}

/** DCAS ambulances only: partner agencies' fleets are not this console's to watch. */
export function FleetBoard() {
  const { units, status, error } = useFleet();

  const byKind = useMemo(() => {
    const m = new Map<string, Unit[]>();
    for (const u of units.filter((x) => x.agencyCode === 'DCAS')) {
      if (!m.has(u.kind)) m.set(u.kind, []);
      m.get(u.kind)!.push(u);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [units]);

  if (status === 'error' && !units.length) return <Card title={t('fleet.board')}><ErrorState body={error ?? undefined} /></Card>;
  if (!units.length) return <Card title={t('fleet.board')}><Skeleton height={220} /></Card>;

  const header = (
    <thead>
      <tr>
        <th>{t('fleet.kind')}</th>
        <th className="numeric">{t('fleet.available')}</th>
        <th className="numeric">{t('fleet.standby')}</th>
        <th className="numeric">{t('fleet.busy')}</th>
        <th className="numeric">{t('fleet.total')}</th>
      </tr>
    </thead>
  );

  return (
    <>
      <Card title={t('fleet.board')} subtitle={t('fleet.boardBody')} flush>
        <div className="board__scroll">
          <table className="u-table board">
            {header}
            <tbody>
              {byKind.map(([kind, list]) => {
                const c = tally(list);
                return (
                  <tr key={kind}>
                    <td><span className="mono">{kind}</span> <span className="board__muted">{UNIT_KIND_LABEL[kind] ?? ''}</span></td>
                    <td className="numeric">{c.available}</td>
                    <td className="numeric">{c.standby}</td>
                    <td className="numeric">{c.committed}</td>
                    <td className="numeric">{c.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CoverageCard />
    </>
  );
}

/** Wired to engines/coverage.js (Phase 6.4) now that it exists — a small, honest read
 *  rather than the "not shown until it is real" placeholder this card started as. */
function CoverageCard() {
  const [state, setState] = useState<{ currentPct: number; optimalPct: number; gapPp: number } | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    api.analytics.coverage()
      .then((r) => {
        if (cancelled) return;
        const v = (r as unknown as { value: { currentPct: number; optimalPct: number; gapPp: number } | null }).value;
        setState(v ?? 'error');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card title={t('fleet.coverage')} variant="flat">
      {state === null ? <Skeleton height={40} /> : state === 'error' ? (
        <div className="muted-line">{t('fleet.coverageSoon')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
          <Meter value={state.currentPct / 100} />
          <div className="board__muted">
            {decimal1(state.currentPct)}% current, {decimal1(state.optimalPct)}% achievable with one relocation — gap {decimal1(state.gapPp)}pp.
          </div>
        </div>
      )}
    </Card>
  );
}

export function KpiStrip() {
  const { data, status, error } = useKpis();

  if (status === 'error' && !data) return <footer className="ops__kpis"><ErrorState body={error ?? undefined} /></footer>;

  // Every figure with its unit on its face: "4:32" alone is a clock time to half the room.
  const tiles: Array<{ label: string; value: string; unit?: string; title?: string; predicted?: boolean }> = data ? [
    { label: t('kpi.incidentsToday'), value: count(data.calls), unit: 'incidents' },
    { label: t('kpi.responseP50'), value: duration(data.responseP50Sec), unit: durationUnit(data.responseP50Sec) },
    { label: t('kpi.responseP90'), value: duration(data.responseP90Sec), unit: durationUnit(data.responseP90Sec) },
    { label: t('kpi.withinTarget'), value: pct(data.withinTargetPct, 1), unit: 'on time', title: `${count(data.responded)} responses, each against its priority's target` },
    { label: t('kpi.ackP50'), value: duration(data.acknowledgeP50Sec), unit: durationUnit(data.acknowledgeP50Sec) },
    { label: t('kpi.turnout'), value: duration(data.turnoutMeanSec), unit: durationUnit(data.turnoutMeanSec) },
    { label: t('kpi.vrt'), value: duration(data.vrtP50Sec), unit: durationUnit(data.vrtP50Sec), title: t('kpi.ackSample', { n: data.vrtSamples }) },
    { label: t('kpi.unitsOnDuty'), value: `${count(data.unitsOnDuty)} / ${count(data.unitsTotal)}`, unit: 'ambulances' },
  ] : [];

  return (
    <footer className="ops__kpis">
      <div className="kpis">
        {!data
          ? Array.from({ length: 8 }, (_, i) => <div className="kpi" key={i}><Skeleton height={10} width={70} /><Skeleton height={24} width={60} /></div>)
          : tiles.map((tile) => (
            <div className="kpi" key={tile.label} title={tile.title}>
              <div className="kpi__label">{tile.label}</div>
              <div className="kpi__value numeric">
                {tile.predicted ? <Predicted>{tile.value}</Predicted> : tile.value}
                {tile.unit && tile.value !== '—' && <span className="kpi__unit">{tile.unit}</span>}
              </div>
            </div>
          ))}
      </div>
      {data && <div className="kpis__asof">{t('kpi.asOf', { time: timeGst(data.window.to).replace(' GST', '') })}</div>}
    </footer>
  );
}
