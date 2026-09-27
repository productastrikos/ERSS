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
  CircleCheck, Play, Square, Timer, Building2,
} from 'lucide-react';
import type { Assignment, Incident, Unit, HospitalChoice, AssignmentAction, Hospital as HospitalRow, Priority } from '../../lib/types';
import { useSession, signOut, useBoot } from '../../lib/stores/session';
import { useNow } from '../../lib/stores/now';
import { api, ApiError } from '../../lib/api';
import { connectSocket, disconnectSocket, onSocket, reportPosition } from '../../lib/socket';
import { fetchRoadRoute } from '../../lib/routing';
import { t } from '../../lib/i18n';
import { tone } from '../../lib/sound';
import { distance as fmtDistance, duration, floorLabel, makani as fmtMakani, UNIT_STATUS_LABEL } from '../../lib/format';
import { Card, Chip, EmptyState, Button, Dot, ErrorState, Segmented } from '../../shared/ui';
import { TrackMap, type TrackUnit } from '../TrackMap';
import { responderMap, inDubai } from '../mobileMap';
import { useDemoDrive, pathLength, haversine, DRIVE_SPEED_MPS } from './demoDrive';

type Tab = 'home' | 'job' | 'shift' | 'more';
type LngLat = [number, number];

interface Offer { assignment: Assignment; incident: Incident; acknowledgeBy: string; route: LngLat[] | null }
interface Job { assignment: Assignment; incident: Incident }

const TARGET_FALLBACK: Record<Priority, number> = { P1: 480, P2: 720, P3: 1200, P4: 2400 };

export function ResponderSurface() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { drive, start, stop, reset } = useDemoDrive();
  const driving = useRef(false);
  useEffect(() => { driving.current = drive.running; }, [drive.running]);

  const load = useCallback(() => {
    api.me.unit()
      .then((r) => {
        setUnit(r.unit);
        setJob(r.assignment && r.incident ? { assignment: r.assignment, incident: r.incident } : null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: the offer, and anything that changes the job from elsewhere ────
  useEffect(() => {
    connectSocket();
    const offs = [
      onSocket('assignment:offer', (payload) => {
        setOffer({ assignment: payload.assignment, incident: payload.incident, acknowledgeBy: payload.acknowledgeBy, route: payload.route });
        setTab('job');
        navigator.vibrate?.([200, 100, 200, 100, 200]);
        tone('critical');
      }),
      onSocket('assignment:update', (p) => {
        // Stood down or timed out from the console: the offer screen must not linger.
        if (p.state === 'cancelled' || p.state === 'timed_out') setOffer((o) => (o?.assignment.ref === p.ref ? null : o));
        load();
      }),
    ];
    return () => { for (const off of offs) off(); disconnectSocket(); };
  }, [load]);

  // ── Real GPS while on duty — inside Dubai only, and never while demo-driving ──
  const [gps, setGps] = useState<'off' | 'live' | 'outside' | 'denied'>('off');
  const onDuty = !!unit && unit.status !== 'off_duty';
  useEffect(() => {
    if (!onDuty || !('geolocation' in navigator)) return;
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
  }, [onDuty]);

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
    if (!offer) return;
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

  if (offer) {
    return <OfferScreen offer={offer} unit={unit} busy={busy} onAccept={() => void respondToOffer(true)} onDecline={() => void respondToOffer(false)} />;
  }

  const flush = tab === 'job' && !!job;

  return (
    <div className="m-shell">
      <header className="m-topbar">
        <Dot tone={unit?.status === 'off_duty' ? 'neutral' : job ? 'danger' : 'success'} />
        <div>
          <div className="m-topbar__id">{unit ? `${unit.callsign} · ${unit.ref}` : user?.ref ?? '—'}</div>
          <div className="m-topbar__status">{unit ? UNIT_STATUS_LABEL[unit.status] : '—'}{drive.running ? ' · demo drive' : ''}</div>
        </div>
        <div className="m-topbar__spacer" />
        <Chip tone="danger">DCAS</Chip>
      </header>

      <main className={`m-content ${flush ? 'm-content--flush' : ''}`}>
        {error && !flush && <ErrorState body={error} onRetry={load} />}

        {tab === 'home' && (
          <HomeTab unit={unit} job={job} gps={gps} busy={busy} onOpenJob={() => setTab('job')} onToggleDuty={async () => {
            if (!unit) return;
            setBusy(true); setError(null);
            try { await api.me.setUnitStatus(unit.status === 'off_duty' ? 'available' : 'off_duty'); load(); }
            catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
          }} />
        )}

        {tab === 'job' && (job
          ? <JobView job={job} unit={unit} busy={busy} error={error} drive={drive} onAct={act}
                     onStartDrive={start} onStopDrive={stop} />
          : <Card title="Current job">
              <EmptyState icon={<Flag aria-hidden />} title="No active job"
                body="Stay on duty. A new assignment arrives as a full-screen alert with sound and vibration, and must be acknowledged within 45 seconds." />
            </Card>)}

        {tab === 'shift' && <ShiftTab unit={unit} />}

        {tab === 'more' && (
          <Card title="More">
            <Button variant="secondary" size="lg" block onClick={() => void signOut()}>{t('auth.signOut')}</Button>
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
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────

function HomeTab({ unit, job, gps, busy, onToggleDuty, onOpenJob }: {
  unit: Unit | null; job: Job | null; gps: string; busy: boolean; onToggleDuty: () => void; onOpenJob: () => void;
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
          <div><dt>Home station</dt><dd>{unit.homeStationRef ?? '—'}</dd></div>
          <div><dt>Position</dt><dd>{
            !onDuty ? 'Not reporting (off duty)'
              : gps === 'live' ? 'Live GPS'
              : gps === 'outside' ? 'GPS outside Dubai — paused (use demo drive)'
              : gps === 'denied' ? 'GPS permission off — demo drive available'
              : 'Waiting for GPS…'
          }</dd></div>
        </dl>
      </Card>
    </>
  );
}

// ── Job ──────────────────────────────────────────────────────────────────────

const LEG_OF: Partial<Record<Assignment['state'], 'scene' | 'hospital'>> = {
  offered: 'scene', acknowledged: 'scene', enroute: 'scene', transporting: 'hospital',
};

function JobView({ job, unit, busy, error, drive, onAct, onStartDrive, onStopDrive }: {
  job: Job; unit: Unit | null; busy: boolean; error: string | null;
  drive: ReturnType<typeof useDemoDrive>['drive'];
  onAct: (ref: string, action: AssignmentAction, body?: Record<string, unknown>) => Promise<unknown>;
  onStartDrive: ReturnType<typeof useDemoDrive>['start'];
  onStopDrive: () => void;
}) {
  const { assignment: a, incident: inc } = job;
  const boot = useBoot();
  const now = useNow();
  const [demo, setDemo] = useState(true);
  const [speed, setSpeed] = useState<'1' | '3' | '8'>('3');
  const [hospitals, setHospitals] = useState<HospitalChoice[] | null>(null);
  const [hospitalRows, setHospitalRows] = useState<HospitalRow[] | null>(null);
  const [planned, setPlanned] = useState<{ key: string; path: LngLat[]; distanceM: number } | null>(null);

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
      .then((r) => setPlanned({ key: planKey, path: r.path, distanceM: r.distanceM ?? pathLength(r.path) }))
      .catch(() => {});
    return () => controller.abort();
    // The plan is keyed on the leg and its destination, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const proposed = leg === 'scene' && a.routeProposed && a.routeProposed.length > 1 && unitLng != null && unitLat != null
    && haversine(a.routeProposed[0], [unitLng, unitLat]) < 300 ? a.routeProposed : null;
  const plan = planned?.key === planKey ? planned
    : proposed ? { key: planKey, path: proposed, distanceM: pathLength(proposed) } : null;
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

  let primary: React.ReactNode = null;
  const btn = (label: React.ReactNode, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'primary') => (
    <Button variant={variant} size="lg" block loading={busy} onClick={onClick}>{label}</Button>
  );
  if (a.state === 'acknowledged') {
    primary = btn(<><Play aria-hidden /> Go — en route{demo ? ' (demo drive)' : ''}</>, async () => {
      const r = await onAct(a.ref, 'enroute');
      if (r && plan) beginDrive(plan.path, 'scene');
    });
  } else if (a.state === 'enroute') {
    primary = (
      <>
        {!drive.running && plan && demo && btn(<><Play aria-hidden /> Demo drive to the patient</>, () => beginDrive(plan.path, 'scene'), 'secondary')}
        {btn(<><MapPin aria-hidden /> Arrived — on scene</>, () => { onStopDrive(); void onAct(a.ref, 'onscene'); }, drive.running ? 'secondary' : 'primary')}
      </>
    );
  } else if (a.state === 'onscene' && !a.atPatientAt) {
    primary = btn(<><HeartPulse aria-hidden /> With the patient{inc.floor != null ? ` (${floorLabel(inc.floor)})` : ''}</>, () => void onAct(a.ref, 'at_patient'));
  } else if (a.state === 'onscene') {
    primary = (
      <div className="r-hospitals">
        <div className="r-hospitals__label">Transport to — ranked by capability, drive time and ED load</div>
        {hospitals === null && wantsTransport ? <div className="m-topbar__status">Ranking hospitals…</div>
          : (hospitals ?? []).map((h, i) => (
            <Button key={h.ref} variant={i === 0 ? 'primary' : 'secondary'} size="lg" block loading={busy}
              onClick={() => void onAct(a.ref, 'transporting', { hospitalRef: h.ref })}>
              <Hospital aria-hidden /> <span className="r-hospitals__name">{h.name}</span> <span className="r-hospitals__eta">{duration(h.etaSec)} · ED {h.edLoadPct}%</span>
            </Button>
          ))}
        {btn(<><CircleCheck aria-hidden /> Treated on scene — no transport</>, () => void onAct(a.ref, 'resolve'), 'secondary')}
      </div>
    );
  } else if (a.state === 'transporting') {
    primary = (
      <>
        {!drive.running && plan && demo && btn(<><Play aria-hidden /> Demo drive to {hospital?.name ?? 'hospital'}</>, () => beginDrive(plan.path, 'hospital'), 'secondary')}
        {btn(<><Building2 aria-hidden /> At hospital — hand over</>, () => { onStopDrive(); void onAct(a.ref, 'at_hospital'); }, drive.running ? 'secondary' : 'primary')}
      </>
    );
  } else if (a.state === 'at_hospital' || a.state === 'resolved_on_scene') {
    primary = btn(<><CircleCheck aria-hidden /> Clear — back in service</>, () => void onAct(a.ref, 'clear'));
  }

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
                  leg={leg ?? 'scene'} follow={drive.running} fitKey={fitKey}>
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

      <section className="r-sheet">
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

        <div className="r-sheet__secondary">
          {mapsHref && (
            <a className="u-btn u-btn--ghost u-btn--sm" href={mapsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden /> Navigate</a>
          )}
          {inc.callerPhone && (
            <a className="u-btn u-btn--ghost u-btn--sm" href={`tel:${inc.callerPhone}`}><Phone aria-hidden /> Call caller</a>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Shift ────────────────────────────────────────────────────────────────────

function ShiftTab({ unit }: { unit: Unit | null }) {
  return (
    <Card title={t('responder.shift')}>
      {!unit ? <EmptyState title="Loading…" /> : (
        <dl className="m-kv">
          <div><dt>Unit</dt><dd>{unit.ref} — {unit.callsign}</dd></div>
          <div><dt>Status</dt><dd>{UNIT_STATUS_LABEL[unit.status]}</dd></div>
        </dl>
      )}
      <p style={{ fontSize: 12, color: 'var(--app-text-faint)', marginTop: 'var(--sp-12)' }}>
        Jobs completed, turnout and response times for this crew are the next addition: a crew seeing its own numbers is the feedback loop that moves the service's numbers.
      </p>
    </Card>
  );
}

// ── The full-screen offer ────────────────────────────────────────────────────

function OfferScreen({ offer, unit, busy, onAccept, onDecline }: { offer: Offer; unit: Unit | null; busy: boolean; onAccept: () => void; onDecline: () => void }) {
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
      <div className="m-offer__countdown" data-urgent={remaining <= 15}>
        {remaining > 0 ? `Acknowledge within ${remaining}s` : 'Timing out — respond now'}
      </div>

      <div className="m-offer__actions">
        <Button variant="primary" loading={busy} onClick={onAccept}>Acknowledge</Button>
        <Button variant="ghost" loading={busy} onClick={onDecline}>Decline</Button>
      </div>
    </div>
  );
}

function TabButton({ current, value, onSelect, icon: Icon, label, badge }: {
  current: Tab; value: Tab; onSelect: (t: Tab) => void; icon: typeof Home; label: string; badge?: boolean;
}) {
  return (
    <button type="button" aria-current={current === value ? 'page' : undefined} onClick={() => onSelect(value)} className="m-tabs__btn">
      <Icon aria-hidden />
      <span>{label}</span>
      {badge && <span className="m-tabs__badge" aria-hidden />}
    </button>
  );
}
