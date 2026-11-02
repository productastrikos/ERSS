import { Bluetooth, ChevronRight, Heart, Smartphone, Waves } from 'lucide-react';
import { Button, Card, Chip, Field, Segmented, SimulatedChip } from '../../shared/ui';
import {
  CONCERN_SHORT, formatValue, hasBluetooth, hasPhoneHealth, type Finding, type Reading, type Rules, type SourceKind,
} from './health';
import type { HealthMonitor } from './useHealthMonitor';

type Tone = 'good' | 'warn' | 'bad' | 'idle';

function toneOf(m: HealthMonitor): Tone {
  if (m.status !== 'live' || m.finding.state === 'no_data') return 'idle';
  return m.finding.state === 'alert' ? 'bad' : m.finding.state === 'watch' ? 'warn' : 'good';
}

function statusText(m: HealthMonitor): string {
  if (m.status === 'connecting') return 'Connecting…';
  if (m.status !== 'live') return 'Monitor off — tap to connect';
  const f: Finding = m.finding;
  if (f.state === 'no_data') return 'Waiting for a reading…';
  if (f.state === 'normal') return `Normal · ${m.deviceName ?? ''}`;
  if (f.state === 'watch') return `${CONCERN_SHORT[f.concern]} · ${f.forSec} of ${f.needSec} s`;
  return `${CONCERN_SHORT[f.concern]} · ${formatValue(f.concern, f.value)}`;
}

const liveBpm = (m: HealthMonitor) => (m.status === 'live' && m.finding.state !== 'no_data' ? m.latest?.bpm ?? null : null);

/** Home: the one line that says the monitor is running, and how the heart is doing. */
export function VitalsStrip({ monitor, onOpen }: { monitor: HealthMonitor; onOpen: () => void }) {
  const bpm = liveBpm(monitor);
  const spo2 = bpm != null ? monitor.latest?.spo2 ?? null : null;
  return (
    <button type="button" className="c-vitals" data-tone={toneOf(monitor)} onClick={onOpen}>
      <span className="c-vitals__heart" data-beating={bpm != null}
            style={bpm ? { animationDuration: `${(60 / bpm).toFixed(2)}s` } : undefined}>
        <Heart aria-hidden />
      </span>
      <span className="c-vitals__main">
        <span className="c-vitals__value">{bpm ?? '—'}<small>BPM</small>{spo2 != null && <em>O₂ {spo2}%</em>}</span>
        <span className="c-vitals__status">{statusText(monitor)}</span>
      </span>
      <span className="c-vitals__side">
        <span className="c-vitals__auto" data-on={monitor.rules.autoSos}>Auto SOS {monitor.rules.autoSos ? 'on' : 'off'}</span>
        {monitor.source === 'demo' && monitor.status === 'live' && <SimulatedChip />}
      </span>
      <ChevronRight aria-hidden className="c-vitals__go" />
    </button>
  );
}

/** Health tab. */
export function HealthPanel({ monitor }: { monitor: HealthMonitor }) {
  const { rules, setRules } = monitor;
  const bpm = liveBpm(monitor);
  const spo2 = bpm != null ? monitor.latest?.spo2 ?? null : null;
  const tone = toneOf(monitor);
  const set = (patch: Partial<Rules>) => setRules({ ...rules, ...patch });

  return (
    <>
      <Card title="Heart rate" subtitle={statusText(monitor)} simulated={monitor.source === 'demo' && monitor.status === 'live'}>
        <div className="c-health__now" data-tone={tone}>
          <span className="c-health__heart" data-beating={bpm != null}
                style={bpm ? { animationDuration: `${(60 / bpm).toFixed(2)}s` } : undefined}>
            <Heart aria-hidden />
          </span>
          <span className="c-health__bpm">{bpm ?? '—'}</span>
          <span className="c-health__unit">BPM</span>
          <span className="c-health__spo2">
            <small>Blood oxygen</small>
            <b>{spo2 != null ? `${spo2}%` : '—'}</b>
          </span>
        </div>
        <HeartChart readings={monitor.readings} rules={rules} />
        <div className="c-health__legend">
          <span>Last 2 minutes</span>
          <span>Limits {rules.lowBpm}–{rules.highBpm} BPM</span>
        </div>
      </Card>

      {monitor.scenario && (
        <Card title="Simulate" subtitle="Drive the demo sensor to see the automatic SOS." actions={<SimulatedChip />}>
          <div className="c-health__demo">
            <Button variant="danger" onClick={() => monitor.scenario?.('spike')}>Heart-rate spike</Button>
            <Button variant="secondary" onClick={() => monitor.scenario?.('low_oxygen')}>Low oxygen</Button>
            <Button variant="ghost" onClick={() => monitor.scenario?.('normal')}>Back to normal</Button>
          </div>
        </Card>
      )}

      <Card title="Automatic SOS"
            subtitle="If a reading stays past a limit, a countdown starts. Say you're OK, or an ambulance is requested with your location and medical info.">
        <div className="c-health__rules">
          <label className="r-switch">
            <input type="checkbox" checked={rules.autoSos} onChange={(e) => set({ autoSos: e.target.checked })} />
            <span aria-hidden />
            Start an SOS automatically
          </label>
          <div className="c-health__grid">
            <Field label="Heart rate above (BPM)">
              <input type="number" inputMode="numeric" min={100} max={220} value={rules.highBpm}
                     onChange={(e) => set({ highBpm: clamp(e.target.valueAsNumber, 100, 220, rules.highBpm) })} />
            </Field>
            <Field label="Heart rate below (BPM)">
              <input type="number" inputMode="numeric" min={25} max={60} value={rules.lowBpm}
                     onChange={(e) => set({ lowBpm: clamp(e.target.valueAsNumber, 25, 60, rules.lowBpm) })} />
            </Field>
            <Field label="Blood oxygen below (%)">
              <input type="number" inputMode="numeric" min={80} max={95} value={rules.lowSpo2}
                     onChange={(e) => set({ lowSpo2: clamp(e.target.valueAsNumber, 80, 95, rules.lowSpo2) })} />
            </Field>
          </div>
          <div className="c-health__seg">
            <span>For at least</span>
            <Segmented ariaLabel="For at least" value={String(rules.sustainSec)}
                       options={[{ value: '10', label: '10 s' }, { value: '20', label: '20 s' }, { value: '60', label: '1 min' }, { value: '300', label: '5 min' }]}
                       onChange={(v) => set({ sustainSec: Number(v) })} />
          </div>
          <div className="c-health__seg">
            <span>Countdown</span>
            <Segmented ariaLabel="Countdown" value={String(rules.countdownSec)}
                       options={[{ value: '5', label: '5 s' }, { value: '10', label: '10 s' }, { value: '20', label: '20 s' }]}
                       onChange={(v) => set({ countdownSec: Number(v) })} />
          </div>
        </div>
      </Card>

      <Card title="Health source">
        <div className="c-health__sources">
          <SourceRow monitor={monitor} kind="phone" icon={Smartphone}
                     title="This phone's health data"
                     body="Heart rate and blood oxygen from the phone's built-in health store, including a paired watch."
                     unavailable={!hasPhoneHealth() ? 'Available in the installed app' : null} />
          <SourceRow monitor={monitor} kind="bluetooth" icon={Bluetooth}
                     title="Watch or chest strap"
                     body="Any Bluetooth monitor that broadcasts heart rate."
                     unavailable={!hasBluetooth() ? 'This browser has no Bluetooth' : null} />
          <SourceRow monitor={monitor} kind="demo" icon={Waves}
                     title="Demo sensor"
                     body="Synthesised readings for the trial."
                     unavailable={null} />
        </div>
        {monitor.status === 'error' && monitor.error && <p className="c-health__error">{monitor.error}</p>}
      </Card>

      <p className="c-health__privacy">
        Readings stay on this phone. Only the reading that started an SOS is sent, with the SOS.
      </p>
    </>
  );
}

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

function SourceRow({ monitor, kind, icon: Icon, title, body, unavailable }: {
  monitor: HealthMonitor; kind: SourceKind; icon: typeof Heart; title: string; body: string; unavailable: string | null;
}) {
  const current = monitor.source === kind;
  const live = current && monitor.status === 'live';
  return (
    <div className="c-source" data-current={current}>
      <Icon aria-hidden className="c-source__icon" />
      <div className="c-source__text">
        <strong>{title}</strong>
        <span>{live && monitor.deviceName && kind === 'bluetooth' ? monitor.deviceName : body}</span>
      </div>
      {live ? (
        <Chip tone="success">Connected</Chip>
      ) : unavailable ? (
        <span className="c-source__na">{unavailable}</span>
      ) : (
        <Button size="sm" variant={current ? 'primary' : 'secondary'}
                loading={current && monitor.status === 'connecting'}
                onClick={() => void monitor.connect(kind)}>
          Connect
        </Button>
      )}
    </div>
  );
}

const WINDOW_MS = 120_000;
const Y_MIN = 30;
const Y_MAX = 200;

/** The last two minutes against the two limits. Gaps in the readings stay gaps. */
function HeartChart({ readings, rules }: { readings: Reading[]; rules: Rules }) {
  const last = readings[readings.length - 1];
  if (!last) return <div className="c-chart c-chart--empty">No readings yet</div>;

  const W = 300;
  const H = 110;
  const x = (ts: number) => W - ((last.ts - ts) / WINDOW_MS) * W;
  const y = (v: number) => H - ((Math.min(Y_MAX, Math.max(Y_MIN, v)) - Y_MIN) / (Y_MAX - Y_MIN)) * H;

  const runs: string[] = [];
  let run: string[] = [];
  let prev: Reading | null = null;
  for (const r of readings) {
    if (last.ts - r.ts > WINDOW_MS) continue;
    if (r.bpm == null || (prev && r.ts - prev.ts > 6000)) {
      if (run.length > 1) runs.push(run.join(' '));
      run = [];
    }
    if (r.bpm != null) run.push(`${x(r.ts).toFixed(1)},${y(r.bpm).toFixed(1)}`);
    prev = r;
  }
  if (run.length > 1) runs.push(run.join(' '));

  return (
    <svg className="c-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
         aria-label={`Heart rate over the last two minutes, now ${last.bpm ?? 'unknown'} BPM`}>
      <line className="c-chart__limit" x1={0} x2={W} y1={y(rules.highBpm)} y2={y(rules.highBpm)} vectorEffect="non-scaling-stroke" />
      <line className="c-chart__limit" x1={0} x2={W} y1={y(rules.lowBpm)} y2={y(rules.lowBpm)} vectorEffect="non-scaling-stroke" />
      {runs.map((pts, i) => <polyline key={i} className="c-chart__line" points={pts} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
