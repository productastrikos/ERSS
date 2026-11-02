import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluate, hasPhoneHealth, loadRules, loadSource, saveRules, saveSource, startBluetooth, startDemo, startPhone,
  type Alarm, type Connection, type DemoConnection, type DemoScenario, type Finding, type Reading, type Rules,
  type SourceKind,
} from './health';

const KEEP_MS = 5 * 60_000;

const autoStarts = (kind: SourceKind) => kind === 'demo' || (kind === 'phone' && hasPhoneHealth());

export interface HealthMonitor {
  source: SourceKind;
  status: 'off' | 'connecting' | 'live' | 'error';
  deviceName: string | null;
  error: string | null;
  readings: Reading[];
  latest: Reading | null;
  finding: Finding;
  rules: Rules;
  setRules: (r: Rules) => void;
  connect: (kind: SourceKind) => Promise<void>;
  disconnect: () => void;
  /** Only while the demo sensor is connected. */
  scenario: ((s: DemoScenario) => void) | null;
  /** An alert that should start the SOS countdown, until dismissed or consumed. */
  trigger: Alarm | null;
  dismiss: (snoozeMs: number) => void;
  consume: (snoozeMs: number) => void;
}

/** `paused` holds back new alerts — while an SOS is already running, say. */
export function useHealthMonitor(paused: boolean): HealthMonitor {
  const [source, setSource] = useState<SourceKind>(loadSource);
  const [status, setStatus] = useState<HealthMonitor['status']>(() => (autoStarts(loadSource()) ? 'connecting' : 'off'));
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [rules, setRulesState] = useState<Rules>(loadRules);
  const [now, setNow] = useState(() => Date.now());
  const [trigger, setTrigger] = useState<Alarm | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const conn = useRef<Connection | null>(null);
  const generation = useRef(0);
  const snoozeUntil = useRef(0);
  const buffer = useRef<Reading[]>([]);
  const rulesRef = useRef(rules);
  const triggerRef = useRef<Alarm | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const emit = useCallback((r: Reading) => {
    const next = [...buffer.current.filter((x) => r.ts - x.ts < KEEP_MS), r];
    buffer.current = next;
    setReadings(next);
    setNow(r.ts);

    const f = evaluate(next, rulesRef.current, r.ts);
    if (f.state === 'alert' && rulesRef.current.autoSos && !pausedRef.current && !triggerRef.current && r.ts >= snoozeUntil.current) {
      triggerRef.current = f;
      setTrigger(f);
    }
  }, []);

  const stop = useCallback(() => {
    generation.current++;
    conn.current?.stop();
    conn.current = null;
  }, []);

  /** Start a source; every state change lands after it answers. A picker or permission
   *  prompt can outlive a switch to another source, hence the generation check. */
  const open = useCallback(async (kind: SourceKind, gen: number) => {
    try {
      const c = await (kind === 'demo' ? Promise.resolve(startDemo(emit))
        : kind === 'bluetooth' ? startBluetooth(emit, (why) => { if (generation.current === gen) { setStatus('error'); setError(why); } })
        : startPhone(emit));
      if (generation.current !== gen) { c.stop(); return; }
      conn.current = c;
      setIsDemo(kind === 'demo');
      setDeviceName(c.name);
      setStatus('live');
    } catch (e) {
      if (generation.current !== gen) return;
      setStatus('error');
      setError(e instanceof Error && e.name !== 'NotFoundError' ? e.message : 'No monitor was chosen.');
    }
  }, [emit]);

  const disconnect = useCallback(() => {
    stop();
    setIsDemo(false);
    setStatus('off');
    setDeviceName(null);
  }, [stop]);

  const connect = useCallback((kind: SourceKind) => {
    disconnect();
    setSource(kind);
    saveSource(kind);
    buffer.current = [];
    setReadings([]);
    setError(null);
    setStatus('connecting');
    return open(kind, generation.current);
  }, [disconnect, open]);

  // Reconnect what this phone used last. Bluetooth waits for a tap: the browser will only
  // open its device picker from one.
  useEffect(() => {
    if (!autoStarts(loadSource())) return;
    void open(loadSource(), generation.current);
    return stop;
  }, [open, stop]);

  // A source that goes quiet must read as "no data", not as the last good number.
  useEffect(() => {
    if (status !== 'live') return;
    const id = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, [status]);

  const finding = useMemo(() => evaluate(readings, rules, now), [readings, rules, now]);

  const setRules = useCallback((r: Rules) => {
    rulesRef.current = r;
    setRulesState(r);
    saveRules(r);
  }, []);

  const release = useCallback((snoozeMs: number) => {
    snoozeUntil.current = Date.now() + snoozeMs;
    triggerRef.current = null;
    setTrigger(null);
  }, []);

  const scenario = useCallback((s: DemoScenario) => (conn.current as DemoConnection | null)?.setScenario(s), []);

  return {
    source, status, deviceName, error, readings,
    latest: readings[readings.length - 1] ?? null,
    finding, rules, setRules, connect, disconnect,
    scenario: isDemo ? scenario : null,
    trigger, dismiss: release, consume: release,
  };
}
