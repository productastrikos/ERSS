/**
 * Responder surface — the DCAS ambulance crew's phone. docs/07 §3.
 *
 * The job screen is a map: where the ambulance is, where the patient is, and the road
 * between them, with the response clock running against the priority's target. One big
 * button always shows the next step (go, arrived, with patient, transport, at hospital,
 * clear), so a crew never hunts for it in a moving vehicle.
 *
 * Position: real GPS while on duty — but only inside Dubai, so a tester's laptop in another
 * country never teleports an ambulance. "Demo drive" drives the real road route through
 * the same position pipeline instead (demoDrive.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Home, Flag, Clock, Menu, Navigation, Phone, AlertTriangle, MapPin, HeartPulse, Hospital,
  CircleCheck, Play, Square, Timer, Building2, Siren, Bot, Sparkles, FileText,
} from 'lucide-react';
import type { Assignment, Incident, Unit, HospitalChoice, AssignmentAction, Hospital as HospitalRow, Priority, ReportRow } from '../../lib/types';
import { useSession, signOut, useBoot } from '../../lib/stores/session';
import { useNow } from '../../lib/stores/now';
import { api, ApiError } from '../../lib/api';
import { connectSocket, disconnectSocket, onSocket, reportPosition } from '../../lib/socket';
import { fetchRoadRoute } from '../../lib/routing';
import { t } from '../../lib/i18n';
import { tone } from '../../lib/sound';
import { toast } from '../../lib/stores/toast';
import { distance as fmtDistance, duration, floorLabel, makani as fmtMakani, UNIT_STATUS_LABEL } from '../../lib/format';
import { Card, Chip, EmptyState, Button, Dot, ErrorState, Segmented } from '../../shared/ui';
import { TrackMap, type TrackUnit } from '../TrackMap';
import { responderMap, inDubai } from '../mobileMap';
import { useDemoDrive, pathLength, haversine, DRIVE_SPEED_MPS, type DriveState } from './demoDrive';
import { usePilot, type Pilot, type PilotPace } from './usePilot';
import { PilotLayer } from './PilotLayer';
import { AiCopilot } from './AiCopilot';
import { AppearanceSetting, LiveBadge, MobileLogoBand, ThemeToggle } from '../common/MobileChrome';
import { VitalsCard } from '../../shared/vitals/VitalsCard';
import { openReport } from '../../shared/report/store';
import { ExportButton } from '../../shared/report/ExportButton';
import { gstDateTime, gstTime, mmss, tableDoc } from '../../shared/report/doc';
import './pilot.scss';

type Tab = 'home' | 'job' | 'shift' | 'more';
type LngLat = [number, number];

interface Offer { assignment: Assignment; incident: Incident; acknowledgeBy: string; route: LngLat[] | null }
interface Job { assignment: Assignment; incident: Incident }

const TARGET_FALLBACK: Record<Priority, number> = { P1: 480, P2: 720, P3: 1200, P4: 2400 };

/**
 * One offer, uniquely. An assignment ref alone is not enough: a PoC restart deletes the
 * incidents and the next ones can be numbered again from where the deleted ones began, so
 * "ASG-…-1" can be a new job that only LOOKS like one this phone has already answered. With
 * the offer time beside it, a new offer is never mistaken for an old one.
 */
const offerKey = (a: Pick<Assignment, 'ref' | 'offeredAt'>) => `${a.ref}@${a.offeredAt}`;

export function ResponderSurface() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Auto-run is ON by default: the demo shows the whole job run itself. "Take over" (or
  // the switch on Home) hands it back for the rest of the session.
  const [auto, setAuto] = useState(true);
  /** Bumped by a PoC restart: the pilot starts over with no memory of the old jobs. */
  const [pilotEpoch, setPilotEpoch] = useState(0);
  /** Slow by default: an audience follows each AI suggestion and each tap. */
  const [pace, setPace] = useState<PilotPace>('slow');
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const { drive, start, stop, reset } = useDemoDrive();
  const driving = useRef(false);
  useEffect(() => { driving.current = drive.running; }, [drive.running]);

  // Every update refetches; only the newest request may land, or a slow answer from before
  // the last step would put the job back a step.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    api.me.unit()
      .then((r) => {
        if (seq !== loadSeq.current) return;
        setUnit(r.unit);
        setJob(r.assignment && r.incident ? { assignment: r.assignment, incident: r.incident } : null);
      })
      .catch((e: ApiError) => { if (seq === loadSeq.current) setError(e.message); });
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Offers already answered here: a repeated delivery must not bring the screen back. */
  const answered = useRef(new Set<string>());

  // ── Realtime: the offer, and anything that changes the job from elsewhere ────
  useEffect(() => {
    connectSocket();
    const offs = [
      onSocket('assignment:offer', (payload) => {
        if (answered.current.has(offerKey(payload.assignment))) return;
        setOffer({ assignment: payload.assignment, incident: payload.incident, acknowledgeBy: payload.acknowledgeBy, route: payload.route });
        setTab('job');
        navigator.vibrate?.([200, 100, 200, 100, 200]);
        tone('critical');
      }),
      // What the platform tells the crew while it works — the hospital pre-alert going out,
      // the emergency department confirming the bay.
      onSocket('notify', (n) => toast({ level: n.level, title: n.title, body: n.body })),
      onSocket('assignment:update', (p) => {
        // Stood down or timed out from the console: the offer screen must not linger.
        if (p.state === 'cancelled' || p.state === 'timed_out') setOffer((o) => (o?.assignment.ref === p.ref ? null : o));
        load();
      }),
      // "Restart PoC" on the console: the job this phone holds has been deleted. Drop the
      // offer, the job and any drive in progress, hand the controls back from auto-run, and
      // reload — the ambulance is back on its station and on duty, ready for the next call.
      onSocket('sim:reset', () => {
        answered.current.clear();
        setPilotEpoch((n) => n + 1);
        setOffer(null);
        setJob(null);
        setError(null);
        setSimError(null);
        setTab('home');
        reset();
        load();
        toast({ level: 'info', title: 'The demo was restarted', body: 'Back on station and ready for the next call.' });
      }),
    ];
    return () => { for (const off of offs) off(); disconnectSocket(); };
  }, [load, reset]);

  // ── Real GPS while on duty — inside Dubai only, never while demo-driving, and only when
  // asked for: a demonstration phone is not in the ambulance, and reporting where the
  // presenter is standing would move the ambulance away from where the console shows it.
  const [useGps, setUseGps] = useState(false);
  const [gps, setGps] = useState<'off' | 'live' | 'outside' | 'denied'>('off');
  const onDuty = !!unit && unit.status !== 'off_duty';
  const gpsState = useGps ? gps : 'off';
  useEffect(() => {
    if (!onDuty || !useGps || !('geolocation' in navigator)) return;
    let lastSent = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude: lng, latitude: lat } = pos.coords;
        if (!inDubai(lng, lat)) { setGps('outside'); return; }
        setGps('live');
        const now = Date.now();
        if (driving.current || now - lastSent < 4000) return;
        lastSent = now;
        // The device reports m/s; the platform stores km/h.
        reportPosition({ lng, lat, speed: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null, heading: pos.coords.heading });
      },
      () => setGps('denied'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [onDuty, useGps]);

  // A job that ends (cleared, stood down) ends any drive with it.
  const jobRef = job?.assignment.ref ?? null;
  useEffect(() => { if (!jobRef) reset(); }, [jobRef, reset]);

  async function act(ref: string, action: AssignmentAction, body?: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const r = await api.assignments.act(ref, action, body);
      if (action === 'clear' || action === 'decline') { setJob(null); setOffer(null); setTab('home'); stop(); }
      else setJob({ assignment: r.assignment, incident: r.incident });
      load();
      return r;
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function respondToOffer(accept: boolean) {
    if (!offer || answered.current.has(offerKey(offer.assignment))) return;
    answered.current.add(offerKey(offer.assignment));
    setBusy(true); setError(null);
    try {
      const r = await api.assignments.act(offer.assignment.ref, accept ? 'acknowledge' : 'decline', accept ? undefined : { reason: 'Unable to respond' });
      setOffer(null);
      if (accept) { setJob({ assignment: r.assignment, incident: r.incident }); setTab('job'); }
      load();
    } catch (e) {
      setError((e as ApiError).message ?? 'Failed to respond');
      setOffer(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  // The offer arrives over the socket like any real dispatch.
  async function simulate() {
    setSimulating(true); setSimError(null);
    try { await api.me.demoJob(); }
    catch (e) { setSimError((e as ApiError).message ?? 'Could not simulate a call'); }
    finally { setSimulating(false); }
  }

  // ── Auto-run: a finger that taps the real controls, at the pace a crew would ────
  const { finger, layer, pilot } = usePilot();
  const view = useRef<PilotView>({ offer, job, drive, tab, busy });
  useEffect(() => { view.current = { offer, job, drive, tab, busy }; });
  useEffect(() => { pilot.setPace(pace); }, [pilot, pace]);
  useEffect(() => {
    pilot.setActive(auto);
    if (!auto) { pilot.hide(); return; }
    let stopped = false;
    const done = new Set<string>();
    void (async () => {
      while (!stopped) {
        const acted = await pilotStep(view.current, pilot, done).catch(() => false);
        await pilot.sleep(acted ? 400 : 800);
      }
    })();
    return () => { stopped = true; pilot.setActive(false); pilot.hide(); };
  }, [auto, pilot, pilotEpoch]);

  const demoBlocked = !unit ? 'Loading…'
    : unit.status === 'off_duty' ? 'Go on duty to receive a call.'
    : job ? 'Finish the current job first.'
    : null;

  const flush = tab === 'job' && !!job;

  return (
    <>
    {offer ? (
      <OfferScreen offer={offer} unit={unit} busy={busy} auto={auto}
                   onAccept={() => void respondToOffer(true)} onDecline={() => void respondToOffer(false)} />
    ) : (
    <div className="m-shell">
      <MobileLogoBand />
      <header className="m-topbar">
        <Dot tone={unit?.status === 'off_duty' ? 'neutral' : job ? 'danger' : 'success'} />
        <div>
          <div className="m-topbar__id">{unit ? `${unit.callsign} · ${unit.ref}` : user?.ref ?? '—'}</div>
          <div className="m-topbar__status">{unit ? UNIT_STATUS_LABEL[unit.status] : '—'}{drive.running ? ' · demo drive' : ''}</div>
        </div>
        <div className="m-topbar__spacer" />
        <LiveBadge />
        <ThemeToggle />
      </header>

      <main className={`m-content ${flush ? 'm-content--flush' : ''}`}>
        {error && !flush && <ErrorState body={error} onRetry={load} />}

        {tab === 'home' && (
          <>
            <HomeTab unit={unit} job={job} gps={gpsState} useGps={useGps} onUseGps={setUseGps} busy={busy}
                     onOpenJob={() => setTab('job')} onToggleDuty={async () => {
              if (!unit) return;
              setBusy(true); setError(null);
              try { await api.me.setUnitStatus(unit.status === 'off_duty' ? 'available' : 'off_duty'); load(); }
              catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
            }} />
            <DemoControls auto={auto} onAuto={setAuto} pace={pace} onPace={setPace} busy={simulating} blocked={demoBlocked} error={simError}
                          onSimulate={() => void simulate()} />
          </>
        )}

        {tab === 'job' && (job
          ? <JobView key={job.assignment.ref} job={job} unit={unit} busy={busy} error={error} drive={drive} onAct={act}
                     onStartDrive={start} onStopDrive={stop} auto={auto} onAutoOff={() => setAuto(false)} />
          : <Card title="Current job">
              <EmptyState icon={<Flag aria-hidden />} title="No active job"
                body="Stay on duty. A new assignment arrives as a full-screen alert with sound and vibration, and must be acknowledged within 45 seconds." />
            </Card>)}

        {tab === 'shift' && <ShiftTab unit={unit} />}

        {tab === 'more' && (
          <Card title="More">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-12)' }}>
              <AppearanceSetting />
              <Button variant="secondary" size="lg" block onClick={() => void signOut()}>{t('auth.signOut')}</Button>
            </div>
          </Card>
        )}
      </main>

      <nav className="m-tabs" aria-label="Sections">
        <TabButton current={tab} value="home" onSelect={setTab} icon={Home} label="Home" />
        <TabButton current={tab} value="job" onSelect={setTab} icon={Flag} label="Job" badge={!!job} />
        <TabButton current={tab} value="shift" onSelect={setTab} icon={Clock} label="Shift" />
        <TabButton current={tab} value="more" onSelect={setTab} icon={Menu} label="More" />
      </nav>
    </div>
    )}
    {auto && <PilotLayer finger={finger} layerRef={layer} />}
    </>
  );
}

// ── The pilot's script ───────────────────────────────────────────────────────

interface PilotView {
  offer: Offer | null;
  job: Job | null;
  drive: DriveState;
  tab: Tab;
  busy: boolean;
}

/**
 * One step of what a crew member would do next, performed with the finger. Reading steps
 * (the AI briefing, the route, the handover) come before the tap they inform, so the room
 * sees the decision being made, not only the button being pressed. Each step runs once
 * per job; a tap that finds no control is tried again on the next pass.
 */
async function pilotStep(v: PilotView, p: Pilot, done: Set<string>): Promise<boolean> {
  if (v.busy) return false;
  const first = (key: string) => !done.has(key);
  const once = async (key: string, run: () => Promise<boolean>) => {
    if (done.has(key)) return false;
    const ok = await run();
    if (ok) done.add(key);
    return ok;
  };
  const read = async (key: string, name: string, caption: string, ms: number) => {
    if (!first(key)) return false;
    done.add(key);
    return p.look(name, caption, ms);
  };

  if (v.offer) {
    const ref = offerKey(v.offer.assignment);
    if (await read(`${ref}:read`, 'briefing', 'New job — reading the AI briefing first', 4200)) return true;
    return once(`${ref}:ack`, () => p.tap('acknowledge', 'Accept — the AI says this crew is the right one'));
  }

  const job = v.job;
  if (!job) { p.hide(); return false; }
  const a = job.assignment;
  const ref = offerKey(a);

  if (v.tab !== 'job') return p.tap('tab-job', 'Open the job');

  switch (a.state) {
    case 'acknowledged':
      if (await read(`${ref}:route`, 'copilot', 'Checking the AI route and what to prepare', 3500)) return true;
      if (p.exists('go')) return once(`${ref}:go`, () => p.tap('go', 'Go — lights and siren'));
      return false;

    case 'enroute':
      if (v.drive.leg === 'scene' && v.drive.arrived) return once(`${ref}:onscene`, () => p.tap('onscene', 'Arrived — mark on scene'));
      if (!v.drive.running && p.exists('drive-scene')) return once(`${ref}:drive`, () => p.tap('drive-scene', 'Start driving to the patient'));
      if (v.drive.running && p.exists('vitals') && first(`${ref}:vitals`)) {
        done.add(`${ref}:vitals`);
        await p.look('vitals', "The patient's own wearable — the trend before the call, live", 4200);
        return true;
      }
      if (v.drive.running && first(`${ref}:tip`)) {
        done.add(`${ref}:tip`);
        await p.look('copilot', 'While driving, the AI watches the road ahead', 4000);
        await p.toTop('sheet');
        p.say('Driving at road speed on the AI route');
        return true;
      }
      return false;

    case 'onscene':
      if (!a.atPatientAt) {
        if (await read(`${ref}:scene`, 'copilot', 'On scene — AI safety and backup advice', 3500)) return true;
        return once(`${ref}:patient`, () => p.tap('patient', 'With the patient'));
      }
      if (p.exists('hospital-0')) {
        const name = p.label('hospital-0') ?? 'the top hospital';
        if (await read(`${ref}:hospitals`, 'hospital-0', `AI ranks hospitals — ${name} comes first`, 3500)) return true;
        return once(`${ref}:transport`, () => p.tap('hospital-0', `Transport to ${name}`));
      }
      p.say('The AI is ranking hospitals…');
      return false;

    case 'transporting':
      if (v.drive.leg === 'hospital' && v.drive.arrived) return once(`${ref}:athospital`, () => p.tap('athospital', 'At hospital — hand over'));
      if (!v.drive.running && p.exists('drive-hospital')) return once(`${ref}:drive-h`, () => p.tap('drive-hospital', 'Start driving to hospital'));
      if (v.drive.running && first(`${ref}:handover`)) {
        done.add(`${ref}:handover`);
        await p.look('handover', 'The AI has drafted the handover on the way in', 4500);
        await p.toTop('sheet');
        p.say('Transporting at road speed');
        return true;
      }
      return false;

    case 'at_hospital':
    case 'resolved_on_scene':
      if (await read(`${ref}:final`, 'handover', 'Hand over with the AI-drafted note', 3000)) return true;
      return once(`${ref}:clear`, () => p.tap('clear', 'Clear — back in service'));

    default:
      return false;
  }
}

// ── Home ─────────────────────────────────────────────────────────────────────

function HomeTab({ unit, job, gps, useGps, onUseGps, busy, onToggleDuty, onOpenJob }: {
  unit: Unit | null; job: Job | null; gps: string; useGps: boolean; onUseGps: (v: boolean) => void;
  busy: boolean; onToggleDuty: () => void; onOpenJob: () => void;
}) {
  if (!unit) return <Card title={t('responder.duty')}><EmptyState title="Loading…" /></Card>;
  const onDuty = unit.status !== 'off_duty';
  return (
    <>
      {job && (
        <button type="button" className="r-jobcard" onClick={onOpenJob}>
          <span className={`r-prio r-prio--${job.incident.priority}`}>{job.incident.priority}</span>
          <span className="r-jobcard__text">
            <strong>{t(`kind.${job.incident.kind}`)}</strong>
            <span>{job.incident.building?.name ?? job.incident.zoneName} · {t(`asg.state.${job.assignment.state}`)}</span>
          </span>
          <Navigation aria-hidden />
        </button>
      )}

      <Card title={t('responder.duty')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' }}>
            <Dot tone={onDuty ? 'success' : 'neutral'} />
            <strong>{UNIT_STATUS_LABEL[unit.status]}</strong>
          </div>
          <Button variant={onDuty ? 'secondary' : 'primary'} size="lg" block loading={busy} onClick={onToggleDuty} disabled={!!job}>
            {onDuty ? 'Go off duty' : 'Go on duty'}
          </Button>
        </div>
      </Card>

      <Card title="Ambulance">
        <dl className="m-kv">
          <div><dt>Callsign</dt><dd>{unit.callsign}</dd></div>
          <div><dt>Unit</dt><dd>{unit.ref} · {unit.kind}</dd></div>
          <div><dt>Crew</dt><dd>{unit.crewSize}</dd></div>
          <div><dt>Home station</dt><dd>{unit.homeStationName ?? unit.homeStationRef ?? '—'}</dd></div>
          <div><dt>Position</dt><dd>{
            !onDuty ? 'Not reporting (off duty)'
              : !useGps ? 'As on the console map'
              : gps === 'live' ? 'Live GPS'
              : gps === 'outside' ? 'GPS outside Dubai — paused (use demo drive)'
              : gps === 'denied' ? 'GPS permission off — demo drive available'
              : 'Waiting for GPS…'
          }</dd></div>
        </dl>
        <label className="r-switch r-gps">
          <input type="checkbox" checked={useGps} onChange={(e) => onUseGps(e.target.checked)} />
          <span aria-hidden />
          Report this phone's GPS
        </label>
        <p className="r-demo__note">Turn on only when the phone is in the ambulance — it moves the ambulance on every screen to where the phone is.</p>
      </Card>
    </>
  );
}

// ── Job ──────────────────────────────────────────────────────────────────────

const LEG_OF: Partial<Record<Assignment['state'], 'scene' | 'hospital'>> = {
  offered: 'scene', acknowledged: 'scene', enroute: 'scene', transporting: 'hospital',
};

function JobView({ job, unit, busy, error, drive, onAct, onStartDrive, onStopDrive, auto, onAutoOff }: {
  job: Job; unit: Unit | null; busy: boolean; error: string | null;
  drive: ReturnType<typeof useDemoDrive>['drive'];
  onAct: (ref: string, action: AssignmentAction, body?: Record<string, unknown>) => Promise<unknown>;
  onStartDrive: ReturnType<typeof useDemoDrive>['start'];
  onStopDrive: () => void;
  auto: boolean;
  onAutoOff: () => void;
}) {
  const { assignment: a, incident: inc } = job;
  const boot = useBoot();
  const now = useNow();
  const [demo, setDemo] = useState(true);
  // Road speed by default: a demonstration should show the drive a crew actually makes.
  const [speed, setSpeed] = useState<'1' | '3' | '8'>('1');
  const [hospitals, setHospitals] = useState<HospitalChoice[] | null>(null);
  const [hospitalRows, setHospitalRows] = useState<HospitalRow[] | null>(null);
  const [planned, setPlanned] = useState<{ key: string; path: LngLat[]; distanceM: number; onRoad: boolean } | null>(null);

  const leg = LEG_OF[a.state] ?? null;
  const target = boot?.jurisdiction.priorities.find((p) => p.code === inc.priority)?.targetSec ?? TARGET_FALLBACK[inc.priority];

  // Where this leg ends: the patient's entrance, or the chosen hospital.
  const hospital = a.hospitalRef ? hospitalRows?.find((h) => h.ref === a.hospitalRef) ?? null : null;
  const destination = leg === 'hospital' ? (hospital ? { lng: hospital.lng, lat: hospital.lat } : null) : { lng: inc.lng, lat: inc.lat };

  useEffect(() => {
    if (!a.hospitalRef || hospitalRows) return;
    let cancelled = false;
    api.hospitals().then((rows) => { if (!cancelled) setHospitalRows(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [a.hospitalRef, hospitalRows]);

  const wantsTransport = a.allowedActions.includes('transporting') && !!a.atPatientAt;
  useEffect(() => {
    if (!wantsTransport) return;
    let cancelled = false;
    api.hospitalRecommend(a.incidentRef)
      .then((r) => { if (!cancelled) setHospitals(r.value?.hospitals?.filter((h) => !h.onDiversion).slice(0, 3) ?? []); })
      .catch(() => { if (!cancelled) setHospitals([]); });
    return () => { cancelled = true; };
  }, [wantsTransport, a.incidentRef]);

  // The road for this leg, fetched from where the ambulance is when the leg begins. Until
  // it arrives, the dispatch engine's proposed route stands in for the drive to the patient.
  const unitLng = unit?.lng ?? null;
  const unitLat = unit?.lat ?? null;
  const planKey = leg && destination && unitLng != null && unitLat != null ? `${a.ref}:${leg}:${destination.lng.toFixed(5)},${destination.lat.toFixed(5)}` : null;
  useEffect(() => {
    if (!planKey || !destination || unitLng == null || unitLat == null) return;
    const controller = new AbortController();
    fetchRoadRoute([unitLng, unitLat], [destination.lng, destination.lat], controller.signal)
      .then((r) => setPlanned({ key: planKey, path: r.path, distanceM: r.distanceM ?? pathLength(r.path), onRoad: r.onRoad }))
      .catch(() => {});
    return () => controller.abort();
    // The plan is keyed on the leg and its destination, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // A road: the dispatch engine's (only ever stored as a real road, and the one the console
  // draws — so both screens follow the same streets), else this phone's own route. A
  // straight line only when neither exists.
  const proposed = leg === 'scene' && a.routeProposed && a.routeProposed.length > 1 && unitLng != null && unitLat != null
    && haversine(a.routeProposed[0], [unitLng, unitLat]) < 300 ? a.routeProposed : null;
  const own = planned?.key === planKey ? planned : null;
  const plan = proposed ? { key: planKey, path: proposed, distanceM: pathLength(proposed), onRoad: true } : own;
  const drivingThisLeg = drive.leg === leg && (drive.running || drive.arrived);

  const beginDrive = (path: LngLat[], thisLeg: 'scene' | 'hospital') => {
    if (!demo) return;
    onStartDrive(path, thisLeg, Number(speed));
  };

  // ── The one next step ──────────────────────────────────────────────────────
  const arrivedAt = a.onsceneAt ?? inc.firstOnsceneAt;
  const clockSec = arrivedAt
    ? Math.round((Date.parse(arrivedAt) - Date.parse(inc.reportedAt)) / 1000)
    : Math.max(0, Math.round((now - Date.parse(inc.reportedAt)) / 1000));
  const clockTone = clockSec > target ? 'bad' : clockSec > target * 0.75 ? 'warn' : 'good';

  const remainingM = drivingThisLeg ? drive.remainingM : plan?.distanceM ?? null;
  const etaSec = remainingM != null ? remainingM / (DRIVE_SPEED_MPS * (drivingThisLeg && demo ? Number(speed) : 1)) : null;

  const route = drivingThisLeg ? drive.ahead : leg ? plan?.path ?? null : null;
  const trackUnit: TrackUnit | null = unit && unitLng != null && unitLat != null ? {
    ref: unit.ref, callsign: unit.callsign, kind: unit.kind, status: unit.status,
    lng: drive.running && drive.at ? drive.at[0] : unitLng,
    lat: drive.running && drive.at ? drive.at[1] : unitLat,
    heading: drive.running ? drive.heading : unit.heading,
  } : null;

  const place = inc.building?.name
    ? `${inc.building.name}, entrance ${inc.building.entranceNo}${inc.building.entranceCount > 1 ? ` of ${inc.building.entranceCount}` : ''}`
    : inc.zoneName ?? 'On the map';
  const mapsHref = destination ? `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}` : null;

  // Choosing a hospital sets off for it (demo drive on) as soon as its road is known.
  const driveWhenReady = useRef<'hospital' | null>(null);

  let primary: React.ReactNode = null;
  const btn = (label: React.ReactNode, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'primary', demoName?: string) => (
    <Button variant={variant} size="lg" block loading={busy} onClick={onClick} data-demo={demoName}>{label}</Button>
  );
  if (a.state === 'acknowledged') {
    primary = btn(<><Play aria-hidden /> Go — en route{demo ? ' (demo drive)' : ''}</>, async () => {
      const r = await onAct(a.ref, 'enroute');
      if (r && plan) beginDrive(plan.path, 'scene');
    }, 'primary', 'go');
  } else if (a.state === 'enroute') {
    primary = (
      <>
        {!drive.running && plan && demo && btn(<><Play aria-hidden /> Demo drive to the patient</>, () => beginDrive(plan.path, 'scene'), 'secondary', 'drive-scene')}
        {btn(<><MapPin aria-hidden /> Arrived — on scene</>, () => { onStopDrive(); void onAct(a.ref, 'onscene'); }, drive.running ? 'secondary' : 'primary', 'onscene')}
      </>
    );
  } else if (a.state === 'onscene' && !a.atPatientAt) {
    primary = btn(<><HeartPulse aria-hidden /> With the patient{inc.floor != null ? ` (${floorLabel(inc.floor)})` : ''}</>, () => void onAct(a.ref, 'at_patient'), 'primary', 'patient');
  } else if (a.state === 'onscene') {
    primary = (
      <div className="r-hospitals">
        <div className="r-hospitals__label"><Sparkles aria-hidden /> Transport to — the AI ranks by capability, drive time and ED load</div>
        {hospitals === null && wantsTransport ? <div className="m-topbar__status">Ranking hospitals…</div>
          : (hospitals ?? []).map((h, i) => (
            <Button key={h.ref} variant={i === 0 ? 'primary' : 'secondary'} size="lg" block loading={busy}
              className="r-hosp" data-demo={`hospital-${i}`} data-demo-label={h.name}
              onClick={() => {
                driveWhenReady.current = demo ? 'hospital' : null;
                void onAct(a.ref, 'transporting', { hospitalRef: h.ref });
              }}>
              <span className="r-hosp__body">
                <span className="r-hosp__top">
                  <Hospital aria-hidden /> <span className="r-hosp__name">{h.name}</span>
                  {i === 0 && <span className="r-hosp__ai"><Sparkles aria-hidden /> AI pick</span>}
                </span>
                <span className="r-hosp__facts">
                  {fmtDistance(h.distanceM)} · {h.etaSec < 90 ? `${Math.round(h.etaSec)} s` : `${Math.round(h.etaSec / 60)} min`} · ED {h.edLoadPct}% full{h.inbound ? ` · ${h.inbound} inbound` : ''}
                </span>
              </span>
            </Button>
          ))}
        {hospitals?.[0] && <p className="r-hospitals__why"><Sparkles aria-hidden /> {hospitals[0].reasoning}</p>}
        {btn(<><CircleCheck aria-hidden /> Treated on scene — no transport</>, () => void onAct(a.ref, 'resolve'), 'secondary', 'resolve')}
      </div>
    );
  } else if (a.state === 'transporting') {
    primary = (
      <>
        {!drive.running && plan && demo && btn(<><Play aria-hidden /> Demo drive to {hospital?.name ?? 'hospital'}</>, () => beginDrive(plan.path, 'hospital'), 'secondary', 'drive-hospital')}
        {btn(<><Building2 aria-hidden /> At hospital — hand over</>, () => { onStopDrive(); void onAct(a.ref, 'at_hospital'); }, drive.running ? 'secondary' : 'primary', 'athospital')}
      </>
    );
  } else if (a.state === 'at_hospital' || a.state === 'resolved_on_scene') {
    primary = btn(<><CircleCheck aria-hidden /> Clear — back in service</>, () => void onAct(a.ref, 'clear'), 'primary', 'clear');
  }

  const hospitalPlan = leg === 'hospital' ? plan?.path ?? null : null;
  useEffect(() => {
    if (driveWhenReady.current !== 'hospital' || !hospitalPlan || drive.running) return;
    driveWhenReady.current = null;
    onStartDrive(hospitalPlan, 'hospital', Number(speed));
  }, [hospitalPlan, drive.running, onStartDrive, speed]);

  // Arriving on a demo drive prompts the next step with the tone a crew would hear.
  const arrivedOnce = useRef<string | null>(null);
  useEffect(() => {
    const key = `${a.ref}:${drive.leg}`;
    if (drive.arrived && arrivedOnce.current !== key) { arrivedOnce.current = key; tone('offer'); navigator.vibrate?.(200); }
  }, [drive.arrived, drive.leg, a.ref]);

  const fitKey = useMemo(() => `${a.ref}:${leg ?? a.state}`, [a.ref, leg, a.state]);

  return (
    <div className="r-job">
      <div className="r-job__map">
        <TrackMap view={responderMap} target={destination} priority={inc.priority} unit={trackUnit} route={route}
                  leg={leg ?? 'scene'} follow={drive.running || a.state === 'enroute' || a.state === 'transporting'} fitKey={fitKey}>
          <div className="r-job__chips">
            <div className="r-chip r-clock" data-tone={clockTone}>
              <Timer aria-hidden />
              <span className="r-clock__value">{duration(clockSec)}</span>
              <span className="r-clock__target">{arrivedAt ? 'response' : `/ ${duration(target)}`}</span>
            </div>
            {leg && remainingM != null && (
              <div className="r-chip">
                <Navigation aria-hidden />
                <span className="r-clock__value">{fmtDistance(remainingM)}</span>
                <span className="r-clock__target">{etaSec != null ? `~${duration(etaSec)}` : ''}</span>
              </div>
            )}
          </div>
        </TrackMap>
      </div>

      <section className="r-sheet" data-demo="sheet">
        <div className="r-sheet__head">
          <span className={`r-prio r-prio--${inc.priority}`}>{inc.priority}</span>
          <strong className="r-sheet__kind">{t(`kind.${inc.kind}`)}</strong>
          <Chip tone={a.state === 'onscene' ? 'danger' : a.state === 'transporting' ? 'info' : 'warning'}>{t(`asg.state.${a.state}`)}</Chip>
        </div>
        <div className="r-sheet__place">{leg === 'hospital' ? <><Hospital aria-hidden /> {a.hospitalName ?? hospital?.name ?? 'Hospital'}</> : <><MapPin aria-hidden /> {place}</>}</div>
        {leg !== 'hospital' && (
          <div className="r-sheet__facts">
            {inc.floor != null && <span className="r-sheet__floor">{floorLabel(inc.floor)}{inc.building?.floors ? ` of ${inc.building.floors}` : ''}</span>}
            {inc.makani && <span className="mono">Makani {fmtMakani(inc.makani)}</span>}
          </div>
        )}
        {inc.chiefComplaint && <div className="r-sheet__complaint">{inc.chiefComplaint}</div>}
        {inc.accessNote && <div className="m-offer__note"><AlertTriangle aria-hidden /> {inc.accessNote}</div>}
        {error && <div className="r-sheet__error">{error}</div>}

        {auto && (
          <div className="r-auto" role="status">
            <Bot aria-hidden />
            <span className="r-auto__text">Auto-run is tapping for the crew</span>
            <Button size="sm" variant="ghost" onClick={onAutoOff}>Take over</Button>
          </div>
        )}

        {leg && (
          <div className="r-sheet__demo">
            <label className="r-switch">
              <input type="checkbox" checked={demo} onChange={(e) => { setDemo(e.target.checked); if (!e.target.checked) onStopDrive(); }} />
              <span aria-hidden />
              Demo drive
            </label>
            {demo && (
              <Segmented value={speed} ariaLabel="Demo drive speed" onChange={setSpeed}
                options={[{ value: '1', label: '1×' }, { value: '3', label: '3×' }, { value: '8', label: '8×' }]} />
            )}
            {drive.running && <Button size="sm" variant="ghost" onClick={onStopDrive}><Square aria-hidden /> Pause</Button>}
          </div>
        )}

        <div className="r-sheet__actions">{primary}</div>

        {inc.source === 'app_sos' && (
          <div data-demo="vitals"><VitalsCard incidentRef={inc.ref} compact={leg === 'scene' && a.state !== 'enroute'} /></div>
        )}

        <AiCopilot state={a.state} atPatient={!!a.atPatientAt} />

        <div className="r-sheet__secondary">
          {mapsHref && (
            <a className="u-btn u-btn--ghost u-btn--sm" href={mapsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden /> Navigate</a>
          )}
          {inc.callerPhone && (
            <a className="u-btn u-btn--ghost u-btn--sm" href={`tel:${inc.callerPhone}`}><Phone aria-hidden /> Call caller</a>
          )}
          <button type="button" className="u-btn u-btn--ghost u-btn--sm" onClick={() => openReport({ kind: 'incident', ref: inc.ref })}>
            <FileText aria-hidden /> Hand-over report
          </button>
        </div>
      </section>
    </div>
  );
}

// ── Demonstration ────────────────────────────────────────────────────────────

/** Deliberately quiet: a demonstration aid, not part of a crew's working screen. It raises
 *  a camera-detected collision nearby and sends it here, as the AI dispatcher would. */
function DemoControls({ auto, onAuto, pace, onPace, busy, blocked, error, onSimulate }: {
  auto: boolean; onAuto: (v: boolean) => void; pace: PilotPace; onPace: (p: PilotPace) => void;
  busy: boolean; blocked: string | null; error: string | null; onSimulate: () => void;
}) {
  return (
    <div className="r-demo">
      <Button size="sm" variant="ghost" loading={busy} disabled={!!blocked} onClick={onSimulate}
              title={blocked ?? 'A road camera raises a collision nearby and it is sent to this ambulance'}>
        <Siren aria-hidden /> Simulate a call
      </Button>
      <label className="r-switch r-switch--sm" title="A finger taps through the job the way a crew would, at road speed">
        <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
        <span aria-hidden />
        Auto-run
      </label>
      {auto && (
        <Segmented<PilotPace> value={pace} ariaLabel="Auto-run pace" onChange={onPace}
          options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }]} />
      )}
      {error && <p className="r-demo__error">{error}</p>}
    </div>
  );
}

// ── Shift ────────────────────────────────────────────────────────────────────

function ShiftTab({ unit }: { unit: Unit | null }) {
  const { user } = useSession();
  const [jobs, setJobs] = useState<ReportRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.reports.register(1).then((r) => { if (!cancelled) setJobs(r); }).catch(() => { if (!cancelled) setJobs([]); });
    return () => { cancelled = true; };
  }, []);
  const done = (jobs ?? []).filter((j) => !j.live);
  const responded = (jobs ?? []).filter((j) => j.responseSec != null);
  const within = responded.filter((j) => j.withinTarget).length;
  const shiftLog = () => tableDoc({
    key: `${unit?.ref ?? 'crew'}_shift-log`,
    eyebrow: 'Shift log',
    title: `${unit?.callsign ?? 'Crew'} — jobs in the last 24 hours`,
    generatedBy: user?.name ?? null,
    facts: [
      { label: 'Jobs', value: String(jobs?.length ?? 0) },
      { label: 'Completed', value: String(done.length) },
      { label: 'Reached within target', value: responded.length ? `${within} of ${responded.length}` : '—', tone: responded.length && within === responded.length ? 'good' : undefined },
    ],
    columns: [
      { key: 'ref', label: 'Incident', width: 1.3 }, { key: 'at', label: 'Time (GST)', width: 0.9 }, { key: 'kind', label: 'Type', width: 1.5 },
      { key: 'place', label: 'Place', width: 1.6 }, { key: 'response', label: 'Response', align: 'right', width: 0.8 }, { key: 'hospital', label: 'Hospital', width: 1.6 },
    ],
    rows: (jobs ?? []).map((j) => ({ ref: j.ref, at: gstTime(j.reportedAt), kind: `${j.priority} ${j.kindLabel}`, place: j.place ?? '', response: mmss(j.responseSec), hospital: j.hospital ?? '—' })),
    tones: (jobs ?? []).map((j) => (j.withinTarget == null ? null : j.withinTarget ? 'good' : 'warn')),
    classification: 'Trial data — simulated incidents',
  });
  return (
    <>
      <Card title={t('responder.shift')}>
        {!unit ? <EmptyState title="Loading…" /> : (
          <dl className="m-kv">
            <div><dt>Unit</dt><dd>{unit.ref} — {unit.callsign}</dd></div>
            <div><dt>Status</dt><dd>{UNIT_STATUS_LABEL[unit.status]}</dd></div>
            <div><dt>Jobs (24 h)</dt><dd>{jobs ? `${jobs.length} · ${done.length} completed` : '…'}</dd></div>
            <div><dt>Within target</dt><dd>{responded.length ? `${within} of ${responded.length}` : '—'}</dd></div>
          </dl>
        )}
      </Card>
      <Card title="Jobs this shift" subtitle="Each job's hand-over report — preview, add clinical notes, download."
            actions={jobs?.length ? <ExportButton label="Shift log" build={shiftLog} /> : undefined}>
        {!jobs ? <EmptyState title="Loading…" /> : jobs.length === 0 ? (
          <EmptyState icon={<Flag aria-hidden />} title="No jobs yet" body="Jobs this crew attends appear here with their reports." />
        ) : (
          <ul className="r-jobs">
            {jobs.map((j) => (
              <li key={j.ref}>
                <button type="button" onClick={() => openReport({ kind: 'incident', ref: j.ref })}>
                  <span className={`r-prio r-prio--${j.priority}`}>{j.priority}</span>
                  <span className="r-jobs__text">
                    <strong>{j.kindLabel}</strong>
                    <small>{gstDateTime(j.reportedAt)}{j.hospital ? ` · ${j.hospital}` : ''}{j.live ? ' · live' : ''}</small>
                  </span>
                  <FileText aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ── The full-screen offer ────────────────────────────────────────────────────

function OfferScreen({ offer, unit, busy, auto, onAccept, onDecline }: {
  offer: Offer; unit: Unit | null; busy: boolean; auto: boolean; onAccept: () => void; onDecline: () => void;
}) {
  const { assignment: a, incident: inc } = offer;
  const now = useNow();
  const remaining = Math.max(0, Math.round((Date.parse(offer.acknowledgeBy) - now) / 1000));
  const km = offer.route && offer.route.length > 1 ? pathLength(offer.route) : null;
  const eta = a.etaPredictedAt ? Math.max(0, Math.round((Date.parse(a.etaPredictedAt) - now) / 1000)) : null;

  const place = inc.building?.name
    ? `${inc.building.name}, entrance ${inc.building.entranceNo}`
    : inc.zoneName ?? 'On the map';

  const trackUnit: TrackUnit | null = unit?.lng != null && unit.lat != null
    ? { ref: unit.ref, callsign: unit.callsign, kind: unit.kind, status: 'assigned', lng: unit.lng, lat: unit.lat, heading: unit.heading }
    : null;

  return (
    <div className="m-offer">
      <div className="m-offer__prio">{inc.priority} · NEW ASSIGNMENT</div>
      <div className="m-offer__kind">{t(`kind.${inc.kind}`)}</div>

      <div className="m-offer__map">
        <TrackMap view={responderMap} target={{ lng: inc.lng, lat: inc.lat }} priority={inc.priority}
                  unit={trackUnit} route={offer.route} fitKey={`offer:${a.ref}`} />
      </div>

      <div className="m-offer__where">
        <div className="m-offer__place">{place}</div>
        {inc.floor != null && <div className="m-offer__floor">{floorLabel(inc.floor)}</div>}
        {inc.makani && <div className="m-offer__makani">Makani {fmtMakani(inc.makani)}</div>}
      </div>

      {inc.accessNote && <div className="m-offer__note"><AlertTriangle aria-hidden /> {inc.accessNote}</div>}

      <div className="m-offer__eta">
        {km != null ? fmtDistance(km) : a.callsign}{eta != null ? ` · ETA ${Math.max(1, Math.round(eta / 60))} min` : ''}
      </div>

      <AiCopilot state="offered" atPatient={false} compact />

      <div className="m-offer__actions">
        <div className="m-offer__countdown" data-urgent={remaining <= 15}>
          {remaining > 0 ? `Acknowledge within ${remaining}s${auto ? ' · auto-run' : ''}` : 'Timing out — respond now'}
        </div>
        <Button variant="primary" loading={busy} onClick={onAccept} data-demo="acknowledge">Acknowledge</Button>
        <Button variant="ghost" loading={busy} onClick={onDecline} data-demo="decline">Decline</Button>
      </div>
    </div>
  );
}

function TabButton({ current, value, onSelect, icon: Icon, label, badge }: {
  current: Tab; value: Tab; onSelect: (t: Tab) => void; icon: typeof Home; label: string; badge?: boolean;
}) {
  return (
    <button type="button" aria-current={current === value ? 'page' : undefined} onClick={() => onSelect(value)} className="m-tabs__btn"
            data-demo={`tab-${value}`}>
      <Icon aria-hidden />
      <span>{label}</span>
      {badge && <span className="m-tabs__badge" aria-hidden />}
    </button>
  );
}
