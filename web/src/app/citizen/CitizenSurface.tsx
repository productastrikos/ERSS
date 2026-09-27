/**
 * Citizen surface — the public SOS application. docs/07 §4.
 *
 * Press-and-hold for two seconds prevents pocket dialling. The four direct-dial
 * buttons are ALWAYS present: the app must never be the only way to get help.
 *
 * Raw pass: SOS creation and live tracking, a real medical profile, silent-SOS as a
 * toggle rather than the full text-exchange flow, and a static offline-readable
 * first-aid guide. Accessibility mode beyond the silent toggle is not built this pass.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Home, HeartPulse, Menu, BookOpen, X, VolumeX, Ambulance } from 'lucide-react';
import type { SosStatus } from '../../lib/types';
import { useSession, signOut } from '../../lib/stores/session';
import { api, ApiError } from '../../lib/api';
import { t } from '../../lib/i18n';
import { makani as fmtMakani, relative, distance as fmtDistance, UNIT_KIND_LABEL } from '../../lib/format';
import { Card, Button, Field, ErrorState, Skeleton } from '../../shared/ui';
import { EmergencyNumbers } from '../MobileApp';
import { TrackMap, type TrackUnit } from '../TrackMap';
import { citizenMap, inDubai } from '../mobileMap';

type Tab = 'home' | 'medical' | 'guide' | 'more';

const HOLD_MS = 2000;

export function CitizenSurface() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [activeSos, setActiveSos] = useState<{ ref: string; kind: string } | null>(null);

  return (
    <div className="m-shell">
      <header className="m-topbar">
        <div className="m-topbar__id">{t('app.name')}</div>
        <div className="m-topbar__spacer" />
        <span className="m-topbar__status">{user?.name}</span>
      </header>

      <main className="m-content">
        {tab === 'home' && (
          activeSos
            ? <TrackingPanel sosRef={activeSos.ref} kind={activeSos.kind} onDone={() => setActiveSos(null)} />
            : <SosPanel onCreated={(ref, kind) => setActiveSos({ ref, kind })} />
        )}

        {tab === 'medical' && <MedicalProfilePanel />}
        {tab === 'guide' && <FirstAidGuide />}

        {tab === 'more' && (
          <Card title="More">
            <Button variant="secondary" size="lg" block onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </Card>
        )}
      </main>

      <nav className="m-tabs" aria-label="Sections">
        <TabButton current={tab} value="home"    onSelect={setTab} icon={Home}       label="Home" />
        <TabButton current={tab} value="medical" onSelect={setTab} icon={HeartPulse} label="Medical" />
        <TabButton current={tab} value="guide"   onSelect={setTab} icon={BookOpen}   label="Guide" />
        <TabButton current={tab} value="more"    onSelect={setTab} icon={Menu}       label="More" />
      </nav>
    </div>
  );
}

// ── SOS ──────────────────────────────────────────────────────────────────────

const HAS_GEOLOCATION = typeof navigator !== 'undefined' && 'geolocation' in navigator;

/** Where a tester outside Dubai can place themselves. A phone in Dubai uses its GPS. */
const DEMO_PLACES = [
  { key: 'mall', label: 'The Dubai Mall, Downtown', lng: 55.2796, lat: 25.1985 },
  { key: 'jbr', label: 'JBR Walk, Dubai Marina', lng: 55.1339, lat: 25.0780 },
  { key: 'deira', label: 'Deira City Centre', lng: 55.3304, lat: 25.2524 },
  { key: 'dso', label: 'Dubai Silicon Oasis', lng: 55.3790, lat: 25.1180 },
  { key: 'moe', label: 'Mall of the Emirates, Al Barsha', lng: 55.2003, lat: 25.1181 },
  { key: 'karama', label: 'Al Karama', lng: 55.3030, lat: 25.2440 },
];

/** "What is happening?" — four plain choices a frightened caller can make in a second. */
const SOS_KINDS = [
  { key: 'medical_general', label: 'Unwell' },
  { key: 'cardiac', label: 'Chest pain' },
  { key: 'cardiac_arrest', label: 'Not breathing' },
  { key: 'trauma_fall', label: 'Injury / fall' },
] as const;

function SosPanel({ onCreated }: { onCreated: (ref: string, kind: string) => void }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [gpsPos, setGpsPos] = useState<{ lng: number; lat: number; accuracy: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [demoPlace, setDemoPlace] = useState<string | null>(null);
  const [kind, setKind] = useState<string>('medical_general');
  const [silent, setSilent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  // A fix outside Dubai (a tester elsewhere) cannot be served by DCAS: use a Dubai place.
  const gpsUsable = gpsPos != null && inDubai(gpsPos.lng, gpsPos.lat);
  const place = DEMO_PLACES.find((p) => p.key === demoPlace) ?? (!gpsUsable ? DEMO_PLACES[0] : null);
  const pos = place ? { lng: place.lng, lat: place.lat, accuracy: 10 } : gpsPos;
  const posRef = useRef(pos);
  const kindRef = useRef(kind);

  useEffect(() => { posRef.current = pos; kindRef.current = kind; });

  // Location is captured continuously while the SOS screen is open, so that a hold
  // does not have to wait for a GPS fix at the worst possible moment.
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

  const stop = useCallback(() => {
    setHolding(false);
    setProgress(0);
    if (timer.current) cancelAnimationFrame(timer.current);
    timer.current = null;
  }, []);

  const send = useCallback(async () => {
    const p = posRef.current;
    if (!p) { setError('No location fix yet — hold again in a moment, or call 998.'); return; }
    setSending(true); setError(null);
    try {
      const r = await api.sos.create({ kind: kindRef.current, lng: p.lng, lat: p.lat, accuracy: p.accuracy, silent });
      navigator.vibrate?.(silent ? 40 : [80, 60, 80]);
      onCreated(r.ref, kindRef.current);
    } catch (e) {
      setError((e as ApiError).message ?? 'Could not send — call 998 directly.');
    } finally {
      setSending(false);
    }
  }, [silent, onCreated]);

  const start = useCallback(() => {
    started.current = Date.now();
    setHolding(true);
    navigator.vibrate?.(20);
    // A plain recursive closure, not a memoized hook value — requestAnimationFrame loops
    // read their own identifier by construction, which the hook-purity rules otherwise flag.
    function loop() {
      const elapsed = Date.now() - started.current;
      setProgress(Math.min(1, elapsed / HOLD_MS));
      if (elapsed >= HOLD_MS) {
        stop();
        void send();
        return;
      }
      timer.current = requestAnimationFrame(loop);
    }
    timer.current = requestAnimationFrame(loop);
  }, [stop, send]);

  const circumference = 2 * Math.PI * 122;
  const locationMessage = place ? null : !HAS_GEOLOCATION ? 'This device cannot provide a location.' : geoError;

  return (
    <>
      {error && <ErrorState body={error} />}
      <div className="c-kinds" role="group" aria-label="What is happening?">
        {SOS_KINDS.map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>
      <div className="m-sos">
        <button
          type="button"
          className="m-sos__btn"
          data-holding={holding}
          aria-label={t('citizen.sos')}
          disabled={sending}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          {sending ? '…' : t('citizen.sos')}
          <svg className="m-sos__ring" viewBox="0 0 252 252" aria-hidden>
            <circle cx="126" cy="126" r="122" fill="none"
                    stroke="var(--app-accent-strong)" strokeWidth="4"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress)}
                    strokeLinecap="round"
                    transform="rotate(-90 126 126)" />
          </svg>
        </button>

        <div className="m-sos__hint">{t('citizen.holdToSend')}</div>

        <button type="button" onClick={() => setSilent((s) => !s)}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)', background: 'none', color: silent ? 'var(--app-accent)' : 'var(--app-text-muted)', fontSize: 12, fontWeight: 700 }}>
          <VolumeX size={14} aria-hidden /> {silent ? 'Silent SOS — on' : 'Silent SOS — off'}
        </button>

        <div className="m-sos__where">
          {locationMessage ? (
            <span>{locationMessage}</span>
          ) : pos ? (
            <>
              <span>{t('citizen.yourLocation')}{place ? ' (demo)' : ''}</span>
              <span className="mono">{place ? place.label : `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`}</span>
              {!place && <span>±{Math.round(pos.accuracy)} m · Makani {fmtMakani(null)}</span>}
            </>
          ) : (
            <span>Getting your location…</span>
          )}
          <label className="c-place">
            <span>{gpsUsable ? 'Location' : 'Outside Dubai — send from'}</span>
            <select value={place?.key ?? 'gps'} onChange={(e) => setDemoPlace(e.target.value === 'gps' ? null : e.target.value)}>
              {gpsUsable && <option value="gps">My GPS position</option>}
              {DEMO_PLACES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <EmergencyNumbers />
    </>
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

function TrackingPanel({ sosRef, kind, onDone }: { sosRef: string; kind: string; onDone: () => void }) {
  const [status, setStatus] = useState<SosStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => api.sos.status(sosRef)
      .then((r) => { if (!cancelled) { setStatus(r); setError(null); } })
      .catch((e: ApiError) => { if (!cancelled) setError(e.message); });
    poll();
    // Fast enough that the ambulance visibly moves toward the caller.
    const id = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [sosRef]);

  async function cancel() {
    setCancelling(true);
    try { await api.sos.cancel(sosRef); onDone(); } catch (e) { setError((e as ApiError).message); } finally { setCancelling(false); }
  }

  const closed = status?.state === 'closed';
  const asg = status?.assignmentState ?? null;
  const arrived = asg === 'onscene' || asg === 'transporting' || asg === 'at_hospital' || asg === 'resolved_on_scene' || asg === 'cleared' || !!status?.onsceneAt;
  const onWay = asg === 'enroute';
  const step = !status ? 0 : arrived ? 3 : onWay ? 2 : asg ? 1 : 0;

  const headline = !status ? 'Sending your SOS…'
    : closed ? 'This request is closed'
    : asg === 'transporting' ? 'On the way to hospital'
    : arrived ? 'The ambulance is with you'
    : onWay ? 'Ambulance on the way'
    : asg ? 'Ambulance assigned — preparing to leave'
    : 'Finding the nearest ambulance…';

  const unit: TrackUnit | null = status?.unitRef && status.unitLng != null && status.unitLat != null && !closed ? {
    ref: status.unitRef, callsign: status.unitCallsign ?? status.unitRef, kind: status.unitKind ?? 'ALS',
    status: arrived ? 'on_scene' : onWay ? 'responding' : 'assigned',
    lng: status.unitLng, lat: status.unitLat, heading: status.unitHeading != null ? Number(status.unitHeading) : null,
  } : null;
  const me = status?.incidentLng != null && status.incidentLat != null ? { lng: status.incidentLng, lat: status.incidentLat } : null;

  return (
    <>
      <div className="c-track">
        <div className="c-track__map">
          <TrackMap view={citizenMap} target={me} unit={unit} route={status?.route ?? null}
                    fitKey={`${sosRef}:${status?.unitRef ?? 'none'}:${step}`} />
        </div>

        <div className="c-track__card">
          <div className="c-track__headline">{headline}</div>
          {status && !closed && !arrived && status.etaSec != null && (
            <div className="c-track__eta">
              <span className="c-track__eta-value">{Math.max(1, Math.round(status.etaSec / 60))}</span>
              <span className="c-track__eta-unit">min</span>
              {status.distanceM != null && <span className="c-track__eta-dist">{fmtDistance(status.distanceM)} away</span>}
            </div>
          )}
          {status?.unitCallsign && (
            <div className="c-track__unit">
              <Ambulance aria-hidden /> <strong>{status.unitCallsign}</strong>
              <span>{UNIT_KIND_LABEL[status.unitKind ?? ''] ?? status.unitKind}</span>
            </div>
          )}
          {!status && <Skeleton height={40} />}

          <ol className="c-steps">
            {STEPS.map((s, i) => (
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
      {closed && <Button variant="secondary" size="lg" block onClick={onDone}>Done</Button>}

      <EmergencyNumbers />
    </>
  );
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
