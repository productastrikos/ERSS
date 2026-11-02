/**
 * Health monitor — heart rate and blood oxygen from whichever source is connected, and the
 * rule that decides when a reading is bad enough, for long enough, to start an SOS.
 *
 * Three sources, one reading shape:
 *   demo       synthesised readings for the trial, always labelled as simulated
 *   bluetooth  any watch or chest strap exposing the standard Bluetooth Heart Rate service
 *   phone      the phone's built-in health store, reached through the installed app's native
 *              shell (window.ERSSHealthBridge below); a plain browser has no such bridge
 */

export interface Reading { ts: number; bpm: number | null; spo2: number | null }

export type SourceKind = 'demo' | 'bluetooth' | 'phone';

export interface Rules {
  autoSos: boolean;
  highBpm: number;
  lowBpm: number;
  lowSpo2: number;
  sustainSec: number;
  countdownSec: number;
}

export const DEFAULT_RULES: Rules = {
  autoSos: true, highBpm: 150, lowBpm: 40, lowSpo2: 90, sustainSec: 20, countdownSec: 10,
};

export type Concern = 'high_hr' | 'low_hr' | 'low_spo2';

export interface Alarm {
  state: 'watch' | 'alert';
  concern: Concern;
  /** The newest reading, and the worst one since the condition began. */
  value: number;
  peak: number;
  forSec: number;
  needSec: number;
}

export type Finding = { state: 'no_data' } | { state: 'normal' } | Alarm;

const STALE_MS = 10_000;
const GAP_MS = 6_000;

const TEST: Record<Concern, (r: Reading, rules: Rules) => number | null> = {
  low_hr: (r, x) => (r.bpm != null && r.bpm <= x.lowBpm ? r.bpm : null),
  high_hr: (r, x) => (r.bpm != null && r.bpm >= x.highBpm ? r.bpm : null),
  low_spo2: (r, x) => (r.spo2 != null && r.spo2 <= x.lowSpo2 ? r.spo2 : null),
};

/** How long each concern has held without a break up to the newest reading; the most
 *  advanced one wins. A gap in the readings breaks the run — no reading is not a bad one. */
export function evaluate(readings: Reading[], rules: Rules, now: number): Finding {
  const last = readings[readings.length - 1];
  if (!last || now - last.ts > STALE_MS) return { state: 'no_data' };

  let best: Alarm | null = null;
  for (const concern of Object.keys(TEST) as Concern[]) {
    const test = TEST[concern];
    const value = test(last, rules);
    if (value == null) continue;

    let since = last.ts;
    let peak = value;
    for (let i = readings.length - 2; i >= 0; i--) {
      const v = test(readings[i], rules);
      if (v == null || readings[i + 1].ts - readings[i].ts > GAP_MS) break;
      since = readings[i].ts;
      peak = concern === 'high_hr' ? Math.max(peak, v) : Math.min(peak, v);
    }

    const forSec = Math.round((last.ts - since) / 1000);
    const alarm: Alarm = {
      state: forSec >= rules.sustainSec ? 'alert' : 'watch',
      concern, value, peak, forSec, needSec: rules.sustainSec,
    };
    if (!best || (alarm.state === 'alert' && best.state === 'watch') || (alarm.state === best.state && alarm.forSec > best.forSec)) {
      best = alarm;
    }
  }
  return best ?? { state: 'normal' };
}

export const CONCERN_TITLE: Record<Concern, string> = {
  high_hr: 'Your heart rate is very high',
  low_hr: 'Your heart rate is very low',
  low_spo2: 'Your blood oxygen is low',
};

export const CONCERN_SHORT: Record<Concern, string> = {
  high_hr: 'High heart rate',
  low_hr: 'Low heart rate',
  low_spo2: 'Low blood oxygen',
};

/** The incident kind the dispatch engine should plan for. */
export const CONCERN_KIND: Record<Concern, string> = {
  high_hr: 'cardiac',
  low_hr: 'cardiac',
  low_spo2: 'respiratory',
};

export const formatValue = (concern: Concern, v: number) => (concern === 'low_spo2' ? `${v}%` : `${v} BPM`);

export const formatFor = (sec: number) =>
  sec < 90 ? `${sec} second${sec === 1 ? '' : 's'}` : `${Math.round(sec / 60)} minutes`;

/** What the crew reads on the incident — the server keeps the first 300 characters. */
export function sosNote(a: Alarm, rules: Rules, source: string): string {
  const limit = a.concern === 'high_hr' ? `above ${rules.highBpm} BPM`
    : a.concern === 'low_hr' ? `below ${rules.lowBpm} BPM` : `below ${rules.lowSpo2}%`;
  return `Automatic SOS from health monitor (${source}): ${CONCERN_SHORT[a.concern].toLowerCase()} ` +
    `${formatValue(a.concern, a.value)}, worst ${formatValue(a.concern, a.peak)}, ${limit} for ` +
    `${formatFor(a.forSec)}. No response to the on-screen countdown — caller may be unable to speak.`;
}

// ── Settings — a per-device convenience, so browser storage is enough ──────────

const RULES_KEY = 'erss.health.rules';
const SOURCE_KEY = 'erss.health.source';

export function loadRules(): Rules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<Rules>) } : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: Rules): void {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch { /* storage blocked */ }
}

export function loadSource(): SourceKind {
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    return v === 'bluetooth' || v === 'phone' ? v : 'demo';
  } catch {
    return 'demo';
  }
}

export function saveSource(kind: SourceKind): void {
  try { localStorage.setItem(SOURCE_KEY, kind); } catch { /* storage blocked */ }
}

// ── Sources ───────────────────────────────────────────────────────────────────

export interface Connection { name: string; stop(): void }
type Emit = (r: Reading) => void;

export type DemoScenario = 'normal' | 'spike' | 'low_oxygen';

export interface DemoConnection extends Connection { setScenario(s: DemoScenario): void }

/** A resting heart that can be told to race or to desaturate, one reading a second. */
export function startDemo(emit: Emit): DemoConnection {
  let scenario: DemoScenario = 'normal';
  let bpm = 72;
  let spo2 = 98;
  const id = window.setInterval(() => {
    const targetBpm = scenario === 'spike' ? 168 : 72;
    const targetSpo2 = scenario === 'low_oxygen' ? 85 : 98;
    bpm += (targetBpm - bpm) * 0.25 + (Math.random() - 0.5) * 3;
    spo2 += (targetSpo2 - spo2) * 0.3 + (Math.random() - 0.5) * 0.6;
    emit({ ts: Date.now(), bpm: Math.round(bpm), spo2: Math.round(Math.min(100, spo2)) });
  }, 1000);
  return { name: 'Demo sensor', stop: () => window.clearInterval(id), setScenario: (s) => { scenario = s; } };
}

// Web Bluetooth is not in TypeScript's DOM library; these are the parts used here.
interface BtCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<BtCharacteristic>;
}
interface BtDevice extends EventTarget {
  name?: string;
  gatt?: {
    connect(): Promise<{ getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<BtCharacteristic> }> }>;
    disconnect(): void;
  };
}
interface BtApi { requestDevice(o: { filters: Array<{ services: string[] }> }): Promise<BtDevice> }

export const hasBluetooth = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** The standard Heart Rate Measurement: a flags byte, then the rate as uint8, or uint16
 *  when bit 0 of the flags is set. */
export function parseHeartRate(v: DataView): number {
  return v.getUint8(0) & 0x01 ? v.getUint16(1, true) : v.getUint8(1);
}

/** Must run from a tap: the browser only opens its device picker for a user gesture. */
export async function startBluetooth(emit: Emit, onLost: (why: string) => void): Promise<Connection> {
  const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth;
  const device = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }] });
  if (!device.gatt) throw new Error('This device does not report heart rate.');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('heart_rate');
  const ch = await service.getCharacteristic('heart_rate_measurement');

  const onValue = () => { if (ch.value) emit({ ts: Date.now(), bpm: parseHeartRate(ch.value), spo2: null }); };
  const onGone = () => onLost('The heart-rate monitor disconnected.');
  ch.addEventListener('characteristicvaluechanged', onValue);
  device.addEventListener('gattserverdisconnected', onGone);
  await ch.startNotifications();

  return {
    name: device.name || 'Heart-rate monitor',
    stop: () => {
      ch.removeEventListener('characteristicvaluechanged', onValue);
      device.removeEventListener('gattserverdisconnected', onGone);
      device.gatt?.disconnect();
    },
  };
}

/**
 * The installed app's native shell reads the phone's own health store (heart rate and
 * blood oxygen, including what a paired watch writes into it) and exposes it here:
 *
 *   window.ERSSHealthBridge = {
 *     requestPermission(): Promise<boolean>,
 *     subscribe(onReading: ({ bpm?, spo2?, ts? }) => void): () => void,   // returns unsubscribe
 *   }
 */
interface HealthBridge {
  requestPermission(): Promise<boolean>;
  subscribe(onReading: (r: { bpm?: number | null; spo2?: number | null; ts?: number }) => void): () => void;
}

const bridge = () => (window as unknown as { ERSSHealthBridge?: HealthBridge }).ERSSHealthBridge;

export const hasPhoneHealth = () => typeof window !== 'undefined' && !!bridge();

export async function startPhone(emit: Emit): Promise<Connection> {
  const b = bridge();
  if (!b) throw new Error('Phone health data is available in the installed app.');
  if (!(await b.requestPermission())) throw new Error('Permission to read health data was not given.');
  const off = b.subscribe((r) => emit({ ts: r.ts ?? Date.now(), bpm: r.bpm ?? null, spo2: r.spo2 ?? null }));
  return { name: "This phone's health data", stop: off };
}
