/**
 * Citizen surface — the public SOS application. docs/07 §4.
 *
 * Sliding to send prevents pocket dialling. The four direct-dial buttons are ALWAYS
 * present: the app must never be the only way to get help.
 *
 * The health monitor runs under every tab: when a reading stays past a limit, a countdown
 * takes the screen, and if nobody says they're OK the SOS goes by itself.
 *
 * LIVE. Once an SOS is sent, the caller's phone joins its own room on the socket: the
 * ambulance answering it is pushed here as it moves, and every change to the job (assigned,
 * on the way, arrived, to hospital) is a ping that refetches the status — the same moments
 * the console and the paramedic app see, at the same time. A "Restart PoC" on the console
 * clears the SOS here too.
 *
 * In the demonstration the caller stands a short drive from the PAIRED crew — the paramedic
 * app signed in, else the trial's crew-demo ambulance (server services/sos.js demoPlace) — and
 * an SOS from here goes to that crew's phone when it is online (services/dispatch.js).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Activity, Asterisk, BookOpen, ClipboardPlus, FileText, Home, MapPin, Menu, Smartphone, VolumeX, X, Ambulance } from 'lucide-react';
import type { NearestAmbulance, ReportRow, SosDemoPlace, SosStatus } from '../../lib/types';
import { useSession, signOut } from '../../lib/stores/session';
import { api, ApiError } from '../../lib/api';
import { connectSocket, disconnectSocket, onSocket, watchSos } from '../../lib/socket';
import { toast } from '../../lib/stores/toast';
import { t } from '../../lib/i18n';
import { makani as fmtMakani, relative, distance as fmtDistance, UNIT_KIND_LABEL } from '../../lib/format';
import { Card, Button, Field, ErrorState, Skeleton } from '../../shared/ui';
import { EmergencyNumbers } from '../MobileApp';
import { TrackMap, type TrackUnit } from '../TrackMap';
import { citizenMap, inDubai } from '../mobileMap';
import { CONCERN_KIND, CONCERN_SHORT, formatFor, formatValue, sosNote } from './health';
import { useHealthMonitor } from './useHealthMonitor';
import { HealthPanel, VitalsStrip } from './HealthPanel';
import { SosAlert } from './SosAlert';
import { SosSlider } from './SosSlider';
import { AppearanceSetting, LiveBadge, MobileLogoBand, ThemeToggle } from '../common/MobileChrome';
import { openReport } from '../../shared/report/store';
import { ExportButton } from '../../shared/report/ExportButton';
import { gstDateTime, vitalsDoc } from '../../shared/report/doc';
import './citizen.scss';

type Tab = 'home' | 'health' | 'medical' | 'guide' | 'more';

interface ActiveSos { ref: string; kind: string; auto: string | null }

interface SendRequest { kind: string; silent: boolean; note?: string; auto?: string }

export function CitizenSurface() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [activeSos, setActiveSos] = useState<ActiveSos | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Bumped by a PoC restart: everything derived from the old run is fetched again. */
  const [resetKey, setResetKey] = useState(0);
  const demo = useDemoPlace(resetKey);
  const [location, posRef] = useSosLocation(demo);
  const monitor = useHealthMonitor(activeSos != null);
  const monitorRef = useRef(monitor);
  useEffect(() => { monitorRef.current = monitor; });
  /** The newest reading already sent to the server for the active SOS. */
  const lastVitalTs = useRef(0);

  // Re-opened mid-emergency (a reload, a locked phone, a dropped app): pick the live SOS
  // back up rather than showing the slider as if nothing were happening.
  useEffect(() => {
    let cancelled = false;
    api.reports.register(1)
      .then((rows) => {
        const live = rows.find((r) => r.live && r.source === 'app_sos');
        if (!cancelled && live) setActiveSos((cur) => cur ?? { ref: live.ref, kind: live.kind, auto: null });
      })
      .catch(() => { /* nothing to resume */ });
    return () => { cancelled = true; };
  }, [resetKey]);

  // Live from sign-in: the SOS room is joined the moment one is sent, and a restart on the
  // console reaches this phone even when no SOS is running.
  useEffect(() => {
    connectSocket();
    const off = onSocket('sim:reset', () => {
      setActiveSos(null);
      setSendError(null);
      setTab('home');
      setResetKey((k) => k + 1);
      if (monitorRef.current.trigger) monitorRef.current.dismiss(60_000);
      toast({ level: 'info', title: 'The demo was restarted', body: 'Ready for a new SOS.' });
    });
    return () => { off(); disconnectSocket(); };
  }, []);

  const send = useCallback(async (req: SendRequest): Promise<boolean> => {
    const p = posRef.current;
    if (!p) { setSendError('No location fix yet — try again in a moment, or call 998.'); return false; }
    setSending(true);
    setSendError(null);
    // The readings that led up to the SOS go with it — the crew, the hospital pre-alert and
    // the report all read them (server services/vitals.js).
    const m = monitorRef.current;
    const readings = m.status === 'live' ? m.readings.map((x) => ({ ts: x.ts, bpm: x.bpm, spo2: x.spo2 })) : [];
    try {
      const r = await api.sos.create({
        kind: req.kind, lng: p.lng, lat: p.lat, accuracy: p.accuracy, silent: req.silent, note: req.note,
        ...(readings.length ? { vitals: readings, vitalsDevice: deviceLabel(m) ?? undefined } : {}),
      });
      lastVitalTs.current = readings.length ? readings[readings.length - 1].ts : Date.now();
      navigator.vibrate?.(req.silent ? 40 : [80, 60, 80]);
      setActiveSos({ ref: r.ref, kind: req.kind, auto: req.auto ?? null });
      setTab('home');
      return true;
    } catch (e) {
      setSendError((e as ApiError).message ?? 'Could not send — call 998 directly.');
      return false;
    } finally {
      setSending(false);
    }
  }, [posRef]);

  const alarm = activeSos ? null : monitor.trigger;

  // While help is on the way the wearable keeps reporting: every few seconds, whatever is
  // new goes to the crew answering the call (live on their screen) and into the record.
  const sosRef = activeSos?.ref ?? null;
  useEffect(() => {
    if (!sosRef) return;
    const id = window.setInterval(() => {
      const m = monitorRef.current;
      if (m.status !== 'live') return;
      const fresh = m.readings.filter((x) => x.ts > lastVitalTs.current);
      if (!fresh.length) return;
      lastVitalTs.current = fresh[fresh.length - 1].ts;
      void api.sos.vitals(sosRef, fresh.map((x) => ({ ts: x.ts, bpm: x.bpm, spo2: x.spo2 })), deviceLabel(m) ?? undefined).catch(() => { /* the next batch carries on */ });
    }, 4000);
    return () => window.clearInterval(id);
  }, [sosRef]);

  async function sendAutomatic() {
    if (!alarm) return;
    const ok = await send({
      kind: CONCERN_KIND[alarm.concern],
      silent: true,
      note: sosNote(alarm, monitor.rules, monitor.deviceName ?? 'health monitor'),
      auto: `${CONCERN_SHORT[alarm.concern]}, ${formatValue(alarm.concern, alarm.value)} for ${formatFor(alarm.forSec)}`,
    });
    if (ok) monitor.consume(10 * 60_000);
  }

  return (
    <div className="m-shell">
      <MobileLogoBand />
      <header className="m-topbar">
        <div>
          <div className="m-topbar__id">{t('app.name')}</div>
          <div className="m-topbar__status">{user?.name}</div>
        </div>
        <div className="m-topbar__spacer" />
        <LiveBadge />
        <ThemeToggle />
      </header>

      <main className="m-content">
        {tab === 'home' && (
          activeSos
            ? <TrackingPanel sosRef={activeSos.ref} kind={activeSos.kind} auto={activeSos.auto} onDone={() => setActiveSos(null)} />
            : <SosPanel location={location} sending={sending} error={sendError} crew={demo?.crew ?? null}
                        vitals={<VitalsStrip monitor={monitor} onOpen={() => setTab('health')} />}
                        onSend={(kind, silent) => void send({ kind, silent })}
                        onMedical={() => setTab('medical')} />
        )}

        {tab === 'health' && (
          <>
            <HealthPanel monitor={monitor} />
            {monitor.readings.length > 1 && (
              <div className="c-export">
                <ExportButton label="Export my readings" build={() => vitalsDoc({ readings: monitor.readings, device: deviceLabel(monitor), person: user?.name ?? null })} />
                <span>Heart rate and SpO₂ as PDF or Excel — to share with your doctor.</span>
              </div>
            )}
          </>
        )}
        {tab === 'medical' && <MedicalProfilePanel />}
        {tab === 'guide' && <FirstAidGuide />}

        {tab === 'more' && (
          <>
            <MyReports resetKey={resetKey} />
            <Card title="More">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-12)' }}>
                <AppearanceSetting />
                <Button variant="secondary" size="lg" block onClick={() => void signOut()}>
                  {t('auth.signOut')}
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>

      <nav className="m-tabs" aria-label="Sections">
        <TabButton current={tab} value="home"    onSelect={setTab} icon={Home}          label="Home" />
        <TabButton current={tab} value="health"  onSelect={setTab} icon={Activity}      label="Health" />
        <TabButton current={tab} value="medical" onSelect={setTab} icon={ClipboardPlus} label="Medical" />
        <TabButton current={tab} value="guide"   onSelect={setTab} icon={BookOpen}      label="Guide" />
        <TabButton current={tab} value="more"    onSelect={setTab} icon={Menu}          label="More" />
      </nav>

      {alarm && (
        <SosAlert key={`${alarm.concern}:${alarm.forSec}`} alarm={alarm} seconds={monitor.rules.countdownSec}
                  sending={sending} error={sendError}
                  onSend={() => void sendAutomatic()}
                  onCancel={() => { setSendError(null); monitor.dismiss(5 * 60_000); }} />
      )}
    </div>
  );
}

/** What the readings came from, said the way a person would. */
function deviceLabel(m: { deviceName: string | null; source: string }): string | null {
  return m.deviceName ?? (m.source === 'demo' ? 'Demo sensor' : m.source === 'phone' ? 'Phone health data' : null);
}

/** The caller's own SOS history — each one's report, to keep or share with a doctor. */
function MyReports({ resetKey }: { resetKey: number }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.reports.register(30).then((r) => { if (!cancelled) setRows(r); }).catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [resetKey]);
  if (!rows?.length) return null;
  return (
    <Card title="My emergency reports" subtitle="What happened, who came, where you were taken — and your wearable readings.">
      <ul className="c-reports">
        {rows.slice(0, 8).map((r) => (
          <li key={r.ref}>
            <button type="button" onClick={() => openReport({ kind: 'incident', ref: r.ref })}>
              <FileText aria-hidden />
              <span>
                <strong>{r.kindLabel}</strong>
                <small>{gstDateTime(r.reportedAt)}{r.hospital ? ` · ${r.hospital}` : r.live ? ' · in progress' : ''}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Location — watched from sign-in, so an SOS never waits for a first fix ─────

const HAS_GEOLOCATION = typeof navigator !== 'undefined' && 'geolocation' in navigator;

/** Other places a tester can stand — inside the trial catchment, where the eight trial
 *  ambulances are (server config/poc.js). The default is beside the paired crew (below). */
const DEMO_PLACES = [
  { key: 'dso', label: 'Dubai Silicon Oasis', lng: 55.3790, lat: 25.1180 },
  { key: 'intl', label: 'International City', lng: 55.4100, lat: 25.1600 },
  { key: 'academic', label: 'Academic City', lng: 55.4040, lat: 25.1130 },
  { key: 'mirdif', label: 'Mirdif', lng: 55.4200, lat: 25.2150 },
];

/** "What is happening?" — four plain choices a frightened caller can make in a second. */
const SOS_KINDS = [
  { key: 'medical_general', label: 'Unwell' },
  { key: 'cardiac', label: 'Chest pain' },
  { key: 'cardiac_arrest', label: 'Not breathing' },
  { key: 'trauma_fall', label: 'Injury / fall' },
] as const;

interface Position { lng: number; lat: number; accuracy: number }

interface DemoSpot { key: string; label: string; lng: number; lat: number }

interface SosLocation {
  pos: Position | null;
  /** The phone's own fix, whether or not it is the one in use. */
  gps: Position | null;
  /** The demonstration place in use, or null when this phone's GPS is. */
  place: DemoSpot | null;
  /** The place beside the paired crew, when the server has chosen one. */
  crewPlace: DemoSpot | null;
  crew: SosDemoPlace['crew'] | null;
  gpsUsable: boolean;
  message: string | null;
  /** A place key, 'crew', 'gps', or null for the default. */
  choose: (key: string | null) => void;
}

/**
 * Where the demonstration caller stands: on a road a short drive from the paired crew, chosen
 * by the server, and whether that crew's phone is signed in. Polled, because the paramedic may
 * sign in after the citizen does; the place itself is stable server-side.
 */
function useDemoPlace(resetKey: number): SosDemoPlace | null {
  const [place, setPlace] = useState<SosDemoPlace | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.sos.demoPlace()
      .then((p) => { if (!cancelled) setPlace(p); })
      .catch(() => { /* the other places still work */ });
    load();
    const id = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [resetKey]);
  return place;
}

/** The current position, and a ref to it for the send path, which may run from a timer. */
function useSosLocation(demo: SosDemoPlace | null): [SosLocation, React.RefObject<Position | null>] {
  const [gpsPos, setGpsPos] = useState<Position | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);

  // A fix outside Dubai (a tester elsewhere) cannot be served by DCAS: use a Dubai place.
  const gpsUsable = gpsPos != null && inDubai(gpsPos.lng, gpsPos.lat);
  const crewPlace: DemoSpot | null = demo
    ? { key: 'crew', label: demo.road ?? `Near ${demo.crew.callsign}`, lng: demo.lng, lat: demo.lat }
    : null;
  // The default is beside the paired crew: the demonstration's two phones are each other's
  // call, and the response the room watches is a short one. Then this phone's GPS, if it is
  // in Dubai; then Silicon Oasis.
  const key = choice ?? (crewPlace ? 'crew' : gpsUsable ? 'gps' : DEMO_PLACES[0].key);
  const place: DemoSpot | null = key === 'gps'
    ? (gpsUsable ? null : crewPlace ?? DEMO_PLACES[0])
    : key === 'crew' ? crewPlace ?? DEMO_PLACES[0]
      : DEMO_PLACES.find((p) => p.key === key) ?? DEMO_PLACES[0];
  const pos = place ? { lng: place.lng, lat: place.lat, accuracy: 10 } : gpsPos;
  const posRef = useRef<Position | null>(pos);

  useEffect(() => { posRef.current = pos; });

  useEffect(() => {
    if (!HAS_GEOLOCATION) return;
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsPos({ lng: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy }); setGeoError(null); },
      (err) => setGeoError(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission is off. Turn it on, or call 998 directly.'
          : 'Waiting for a location fix…',
      ),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const message = place ? null : !HAS_GEOLOCATION ? 'This device cannot provide a location.' : geoError;
  return [{ pos, gps: gpsPos, place, crewPlace, crew: demo?.crew ?? null, gpsUsable, message, choose: setChoice }, posRef];
}

// ── SOS ──────────────────────────────────────────────────────────────────────

function SosPanel({ location, sending, error, crew, vitals, onSend, onMedical }: {
  location: SosLocation;
  sending: boolean;
  error: string | null;
  crew: SosDemoPlace['crew'] | null;
  vitals: React.ReactNode;
  onSend: (kind: string, silent: boolean) => void;
  onMedical: () => void;
}) {
  const [kind, setKind] = useState<string>('medical_general');
  const [silent, setSilent] = useState(false);

  return (
    <>
      {vitals}
      {error && <ErrorState body={error} />}

      <div className="c-kinds" role="group" aria-label="What is happening?">
        {SOS_KINDS.map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>

      <section className="c-sos" aria-label="Emergency">
        <SosSlider label={sending ? 'Sending…' : 'Emergency SOS'} knob="SOS" disabled={sending}
                   onComplete={() => onSend(kind, silent)} />
        <SosSlider tone="light" label="Medical info" knob={<Asterisk aria-hidden />} onComplete={onMedical} />
        <div className="c-sos__foot">
          <span>Slide to call an ambulance. Your location and medical info go with it.</span>
          <button type="button" className="c-sos__silent" aria-pressed={silent} onClick={() => setSilent((s) => !s)}>
            <VolumeX aria-hidden /> Silent SOS {silent ? 'on' : 'off'}
          </button>
        </div>
      </section>

      <PlacePicker location={location} />

      <CrewPairing crew={crew} pairedHere={location.place?.key === 'crew'} />

      <EmergencyNumbers />
    </>
  );
}

/**
 * Who answers an SOS from here, in the demonstration: the paramedic app's crew when that phone
 * is signed in (the server pairs the two), otherwise the nearest free ambulance the AI picks.
 * Stated, so the room knows which phone to watch before the slider moves.
 */
function CrewPairing({ crew, pairedHere }: { crew: SosDemoPlace['crew'] | null; pairedHere: boolean }) {
  if (!crew) return null;
  return (
    <div className={`c-pair${crew.online ? ' is-online' : ''}`} role="status">
      <Smartphone aria-hidden />
      <span className="c-pair__text">
        {crew.online ? (
          <>
            <strong>Paramedic app online · {crew.callsign}</strong>
            <span>{pairedHere ? 'You are a short drive away — ' : ''}your SOS goes straight to their phone.</span>
          </>
        ) : (
          <>
            <strong>Paramedic app offline</strong>
            <span>The AI sends the nearest free ambulance.</span>
          </>
        )}
      </span>
      <span className="c-pair__tag">Demo</span>
    </div>
  );
}

// ── Where the SOS goes from — every option says who would come, and how soon ────

interface PlaceOption { key: string; label: string; detail: string | null; lng: number; lat: number }

/** The nearest free ambulance to each place, refreshed while the picker is on screen. */
function useNearest(places: PlaceOption[]): Map<string, NearestAmbulance | null> {
  const [out, setOut] = useState<Map<string, NearestAmbulance | null>>(new Map());
  const key = places.map((p) => `${p.key}:${p.lng.toFixed(4)},${p.lat.toFixed(4)}`).join('|');
  const placesRef = useRef(places);
  useEffect(() => { placesRef.current = places; });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const list = placesRef.current;
      if (!list.length) return;
      api.sos.nearest(list.map((p) => [p.lng, p.lat]))
        .then((rows) => { if (!cancelled) setOut(new Map(list.map((p, i) => [p.key, rows[i] ?? null]))); })
        .catch(() => { /* the picker still works without the estimates */ });
    };
    load();
    const id = window.setInterval(load, 20_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [key]);
  return out;
}

const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;

function PlacePicker({ location }: { location: SosLocation }) {
  const [open, setOpen] = useState(false);
  const { pos, place, gpsUsable, message, crewPlace, crew } = location;
  const options: PlaceOption[] = [
    ...(crewPlace && crew ? [{ key: 'crew', label: `Near ${crew.callsign}${crew.online ? ' (paramedic app)' : ''}`, detail: crewPlace.label, lng: crewPlace.lng, lat: crewPlace.lat }] : []),
    ...(gpsUsable && location.gps ? [{ key: 'gps', label: 'My GPS position', detail: `±${Math.round(location.gps.accuracy)} m`, lng: location.gps.lng, lat: location.gps.lat }] : []),
    ...DEMO_PLACES.map((p) => ({ key: p.key, label: p.label, detail: null, lng: p.lng, lat: p.lat })),
  ];
  const nearest = useNearest(options);
  const currentKey = place?.key ?? 'gps';
  const current = nearest.get(currentKey);

  return (
    <div className="c-where">
      {message ? (
        <span>{message}</span>
      ) : pos ? (
        <div className="c-where__now">
          <div className="c-where__place">
            <MapPin aria-hidden />
            <span>
              <small>{t('citizen.yourLocation')}{place ? ' (demo)' : ''}</small>
              <strong>{place ? place.label : `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`}</strong>
              {place?.key === 'crew' && crew && <small>A short drive from {crew.callsign}</small>}
              {!place && <small>±{Math.round(pos.accuracy)} m · Makani {fmtMakani(null)}</small>}
            </span>
            <button type="button" className="c-where__change" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Done' : 'Change'}
            </button>
          </div>
          <NearestLine n={current} />
        </div>
      ) : (
        <span>Getting your location…</span>
      )}

      {open && (
        <ul className="c-places" role="listbox" aria-label="Send the SOS from">
          {options.map((o) => {
            const n = nearest.get(o.key);
            return (
              <li key={o.key}>
                <button type="button" role="option" aria-selected={o.key === currentKey}
                        onClick={() => { location.choose(o.key); setOpen(false); }}>
                  <span className="c-places__name">{o.label}{o.detail && <small> · {o.detail}</small>}</span>
                  <NearestLine n={n} compact />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NearestLine({ n, compact }: { n: NearestAmbulance | null | undefined; compact?: boolean }) {
  if (n === undefined) return <span className="c-near is-loading">Finding the nearest ambulance…</span>;
  if (n === null) return <span className="c-near is-none">No free ambulance nearby — call 998</span>;
  return (
    <span className={`c-near${compact ? ' is-compact' : ''}`}>
      <Ambulance aria-hidden />
      {!compact && <span>{n.paired ? 'Ambulance for you' : 'Nearest ambulance'}</span>}
      <strong>{n.callsign}</strong>
      <span>{fmtDistance(n.distanceM)}</span>
      <span className="c-near__eta">~{minutes(n.etaSec)}</span>
    </span>
  );
}

// ── Tracking ─────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'received', label: 'Received' },
  { key: 'assigned', label: 'Ambulance assigned' },
  { key: 'onway', label: 'On the way' },
  { key: 'arrived', label: 'Arrived' },
] as const;

/** While-you-wait advice, matched to what the caller said is happening. */
const WAIT_TIP: Record<string, string> = {
  cardiac_arrest: 'Push hard and fast in the centre of the chest — 100 to 120 a minute. Do not stop until the crew takes over.',
  cardiac: 'Sit the person down and keep them still. Loosen tight clothing. If they stop breathing, start CPR.',
  trauma_fall: 'Do not move them unless they are in danger. Press firmly on any bleeding with a clean cloth.',
  medical_general: 'Stay with the person. Unlock the door and switch on a light so the crew finds you fast.',
};

interface LivePosition { unitRef: string; lng: number; lat: number; heading: number | null }

function TrackingPanel({ sosRef, kind, auto, onDone }: { sosRef: string; kind: string; auto: string | null; onDone: () => void }) {
  const [status, setStatus] = useState<SosStatus | null>(null);
  const [live, setLive] = useState<LivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let soon: number | null = null;
    const poll = () => api.sos.status(sosRef)
      .then((r) => { if (!cancelled) { setStatus(r); setError(null); } })
      .catch((e: ApiError) => { if (!cancelled) setError(e.message); });
    poll();
    // The socket says WHEN something changed and where the ambulance is; REST says what the
    // job's state is. The slow poll is the floor under a dropped connection.
    const id = window.setInterval(poll, 6000);
    const unwatch = watchSos(sosRef);
    const offs = [
      onSocket('sos:update', (p) => {
        if (p.ref !== sosRef || soon != null) return;
        soon = window.setTimeout(() => { soon = null; void poll(); }, 200);
      }),
      onSocket('sos:position', (p) => {
        if (p.ref === sosRef) setLive({ unitRef: p.unitRef, lng: p.lng, lat: p.lat, heading: p.heading });
      }),
    ];
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (soon != null) window.clearTimeout(soon);
      unwatch();
      for (const off of offs) off();
    };
  }, [sosRef]);

  async function cancel() {
    setCancelling(true);
    try { await api.sos.cancel(sosRef); onDone(); } catch (e) { setError((e as ApiError).message); } finally { setCancelling(false); }
  }

  const closed = status?.state === 'closed';
  const asg = status?.assignmentState ?? null;
  const hospital = status?.hospital ?? null;
  const arrived = asg === 'onscene' || asg === 'transporting' || asg === 'at_hospital' || asg === 'resolved_on_scene' || asg === 'cleared' || !!status?.onsceneAt;
  const onWay = asg === 'enroute';
  const toHospital = asg === 'transporting';
  const atHospital = !!hospital && (asg === 'at_hospital' || !!status?.atHospitalAt);
  // Two more steps once the patient is going in: the road to hospital, and the arrival.
  const steps = hospital ? [...STEPS, { key: 'transport', label: 'To hospital' }, { key: 'hospital', label: 'At hospital' }] : STEPS;
  const step = !status ? 0 : atHospital ? 5 : toHospital ? 4 : arrived ? 3 : onWay ? 2 : asg ? 1 : 0;

  const headline = !status ? 'Sending your SOS…'
    : atHospital ? `Arrived at ${hospital.name}`
    : closed ? 'This request is closed'
    : toHospital ? `On the way to ${hospital?.name ?? 'hospital'}`
    : arrived ? 'The ambulance is with you'
    : onWay ? 'Ambulance on the way'
    : asg ? 'Ambulance assigned — preparing to leave'
    : 'Finding the nearest ambulance…';

  // The pushed position wins over the polled one — it is at most a second old.
  const here = live && live.unitRef === status?.unitRef ? live : null;
  const unitLng = here?.lng ?? status?.unitLng ?? null;
  const unitLat = here?.lat ?? status?.unitLat ?? null;
  const unit: TrackUnit | null = status?.unitRef && unitLng != null && unitLat != null && !closed ? {
    ref: status.unitRef, callsign: status.unitCallsign ?? status.unitRef, kind: status.unitKind ?? 'ALS',
    status: toHospital ? 'transporting' : atHospital ? 'at_hospital' : arrived ? 'on_scene' : onWay ? 'responding' : 'assigned',
    lng: unitLng, lat: unitLat,
    heading: here?.heading ?? (status.unitHeading != null ? Number(status.unitHeading) : null),
  } : null;
  // The road still ahead, from where the ambulance is NOW; the ETA scaled to match, so the
  // minutes count down between status reads instead of in six-second steps.
  const polledRoute = status?.route ?? null;
  const route = here && polledRoute ? aheadOf(polledRoute, [here.lng, here.lat]) : polledRoute;
  const routeM = route ? pathMetres(route) : null;
  const polledM = polledRoute ? pathMetres(polledRoute) : null;
  const etaSec = status?.etaSec != null && routeM != null && polledM ? status.etaSec * Math.min(1, routeM / polledM) : status?.etaSec ?? null;
  const distM = here && routeM != null ? routeM : status?.distanceM ?? null;

  // A phone in a pocket: a buzz when the ambulance is assigned, and a longer one when it arrives.
  const lastStep = useRef(step);
  useEffect(() => {
    if (step > lastStep.current) navigator.vibrate?.(step === 3 || step === 5 ? [160, 80, 160] : 70);
    lastStep.current = step;
  }, [step]);
  const me = status?.incidentLng != null && status.incidentLat != null ? { lng: status.incidentLng, lat: status.incidentLat } : null;
  // The red pulse is the patient. Once they have actually reached the hospital it moves there;
  // on the way in, the hospital is the destination marker at the end of the road.
  const target = atHospital && hospital ? { lng: hospital.lng, lat: hospital.lat } : me;

  return (
    <>
      <div className="c-track">
        <div className="c-track__map">
          <TrackMap view={citizenMap} target={target} unit={unit} route={route} leg={toHospital ? 'hospital' : 'scene'}
                    hospital={toHospital ? hospital : null}
                    fitKey={`${sosRef}:${status?.unitRef ?? 'none'}:${step}`} />
        </div>

        <div className="c-track__card">
          {auto && (
            <div className="c-track__auto"><Activity aria-hidden /> Sent automatically · {auto}</div>
          )}
          <div className="c-track__headline">{headline}</div>
          {status && !closed && (!arrived || toHospital) && etaSec != null && (
            <div className="c-track__eta" aria-live="polite">
              <span className="c-track__eta-value">{Math.max(1, Math.round(etaSec / 60))}</span>
              <span className="c-track__eta-unit">min</span>
              {distM != null && <span className="c-track__eta-dist">{fmtDistance(distM)} {toHospital ? 'to the hospital' : 'away'}</span>}
            </div>
          )}
          {status?.unitCallsign && (
            <div className="c-track__unit">
              <Ambulance aria-hidden /> <strong>{status.unitCallsign}</strong>
              <span>{UNIT_KIND_LABEL[status.unitKind ?? ''] ?? status.unitKind}</span>
            </div>
          )}
          {!status && <Skeleton height={40} />}

          <ol className="c-steps" style={{ '--steps': steps.length } as React.CSSProperties}>
            {steps.map((s, i) => (
              <li key={s.key} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
                <span className="c-steps__dot" aria-hidden />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="c-track__ref mono">{sosRef}</div>
        </div>
      </div>

      {error && <ErrorState body={error} />}

      {!closed && !arrived && (
        <Card title="While you wait" variant="flat">
          <p className="c-track__tip">{WAIT_TIP[kind] ?? WAIT_TIP.medical_general}</p>
        </Card>
      )}

      {status?.timeline && status.timeline.length > 0 && (
        <Card title="Timeline">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
            {status.timeline.slice().reverse().map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-10)', fontSize: 12.5 }}>
                <span>{row.label}</span>
                <span style={{ color: 'var(--app-text-faint)', whiteSpace: 'nowrap' }}>{relative(row.ts)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!closed && (
        <Button variant="danger" size="lg" block loading={cancelling} onClick={() => void cancel()}>
          <X aria-hidden /> Cancel SOS
        </Button>
      )}
      {(arrived || closed) && (
        <Button variant="secondary" size="lg" block onClick={() => openReport({ kind: 'incident', ref: sosRef })}>
          <FileText aria-hidden /> View &amp; download my report
        </Button>
      )}
      {closed && <Button variant="secondary" size="lg" block onClick={onDone}>Done</Button>}

      <EmergencyNumbers />
    </>
  );
}

/** The part of a road still ahead of a vehicle: from the vertex nearest to it. */
function aheadOf(coords: Array<[number, number]>, at: [number, number]): Array<[number, number]> | null {
  if (coords.length < 2) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = (coords[i][0] - at[0]) ** 2 + (coords[i][1] - at[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const rest = coords.slice(best + 1);
  return rest.length ? [at, ...rest] : null;
}

function pathMetres(coords: Array<[number, number]>): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    m += 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }
  return m;
}

// ── Medical profile ──────────────────────────────────────────────────────────

interface MedicalProfile {
  [key: string]: unknown;
  bloodGroup?: string | null; allergies?: string[]; conditions?: string[]; medications?: string[];
  emergencyContact?: { name: string; phone: string } | null;
}

function MedicalProfilePanel() {
  const [profile, setProfile] = useState<MedicalProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.me.medicalProfile().then((p) => { if (!cancelled) setProfile(p as MedicalProfile); }).catch((e: ApiError) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!profile) return;
    setSaving(true); setSaved(false); setError(null);
    try { await api.me.setMedicalProfile(profile); setSaved(true); }
    catch (e) { setError((e as ApiError).message); }
    finally { setSaving(false); }
  }

  const csv = (v?: string[]) => (v ?? []).join(', ');
  const fromCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <Card title={t('citizen.medicalProfile')} subtitle="Sent with an SOS, shown only to the responding crew.">
      {error && <ErrorState body={error} />}
      {!profile ? <Skeleton height={200} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-12)' }}>
          <Field label="Blood group">
            <input value={profile.bloodGroup ?? ''} placeholder="e.g. O+"
                   onChange={(e) => setProfile({ ...profile, bloodGroup: e.target.value })} />
          </Field>
          <Field label="Allergies" help="Comma-separated">
            <input value={csv(profile.allergies)} onChange={(e) => setProfile({ ...profile, allergies: fromCsv(e.target.value) })} />
          </Field>
          <Field label="Conditions" help="Comma-separated">
            <input value={csv(profile.conditions)} onChange={(e) => setProfile({ ...profile, conditions: fromCsv(e.target.value) })} />
          </Field>
          <Field label="Medications" help="Comma-separated">
            <input value={csv(profile.medications)} onChange={(e) => setProfile({ ...profile, medications: fromCsv(e.target.value) })} />
          </Field>
          <Field label="Emergency contact name">
            <input value={profile.emergencyContact?.name ?? ''}
                   onChange={(e) => setProfile({ ...profile, emergencyContact: { name: e.target.value, phone: profile.emergencyContact?.phone ?? '' } })} />
          </Field>
          <Field label="Emergency contact phone">
            <input value={profile.emergencyContact?.phone ?? ''}
                   onChange={(e) => setProfile({ ...profile, emergencyContact: { name: profile.emergencyContact?.name ?? '', phone: e.target.value } })} />
          </Field>
          <Button variant="primary" size="lg" block loading={saving} onClick={() => void save()}>{saved ? 'Saved' : 'Save'}</Button>
        </div>
      )}
    </Card>
  );
}

// ── First-aid guide — static, offline-readable ──────────────────────────────

const GUIDE = [
  { title: 'Cardiac arrest / CPR', body: 'Call 998. Push hard and fast in the centre of the chest, 100–120 compressions per minute, at least 5cm deep. Let the chest fully rise between compressions. Continue until help arrives or an AED is available.' },
  { title: 'Choking (adult)', body: '5 back blows between the shoulder blades, then 5 abdominal thrusts (Heimlich). Repeat until the object clears or the person becomes unresponsive — then begin CPR.' },
  { title: 'Severe bleeding', body: 'Apply firm, direct pressure with a clean cloth. Do not remove an embedded object. Keep pressure until help arrives; elevate the limb if possible.' },
  { title: 'Stroke — F.A.S.T.', body: 'Face drooping, Arm weakness, Speech difficulty — Time to call 998. Note the time symptoms started; it changes treatment options.' },
  { title: 'Heat illness', body: 'Move to shade or cooling, remove excess clothing, cool with water or ice packs at neck/armpits/groin. Call 998 if confusion, no sweating, or loss of consciousness.' },
];

function FirstAidGuide() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card title="First aid" subtitle="Available without a connection — read while help is on the way.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
        {GUIDE.map((g, i) => (
          <div key={g.title}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)}
              style={{ width: '100%', textAlign: 'start', background: 'var(--app-surface-raised)', borderRadius: 'var(--r-10)', padding: 'var(--sp-12)', fontWeight: 700 }}>
              {g.title}
            </button>
            {open === i && <p style={{ padding: 'var(--sp-10) var(--sp-4)', fontSize: 13.5, color: 'var(--app-text-muted)' }}>{g.body}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TabButton({ current, value, onSelect, icon: Icon, label }: {
  current: Tab; value: Tab; onSelect: (t: Tab) => void;
  icon: typeof Home; label: string;
}) {
  return (
    <button type="button" aria-current={current === value ? 'page' : undefined}
            onClick={() => onSelect(value)}>
      <Icon aria-hidden />
      <span>{label}</span>
    </button>
  );
}
