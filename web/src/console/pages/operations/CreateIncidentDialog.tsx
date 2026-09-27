/**
 * Create an incident — "right-click anywhere → create incident here", which is how a demo
 * starts an unscripted call (docs/06 §2.2).
 *
 * An incident is attached to an EXISTING Makani entrance, never a minted one: the nearest
 * entrances to the clicked point are offered first, because "entrance 4 of 11" is the
 * whole point of Makani for an ambulance.
 */

import { useEffect, useState } from 'react';
import type { Incident, MakaniPoint, Priority } from '../../../lib/types';
import { api, ApiError, idempotencyKey } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { coords, distance, SOURCE_LABEL } from '../../../lib/format';
import { toast } from '../../../lib/stores/toast';
import { Button, Field, Modal, Segmented, Skeleton } from '../../../shared/ui';

const KINDS = [
  'cardiac_arrest', 'cardiac', 'stroke', 'respiratory', 'rta', 'trauma_fall', 'medical_general',
  'heat_illness', 'workplace_injury', 'obstetric', 'paediatric', 'psychiatric', 'drowning',
  'fire_related', 'mass_casualty', 'non_emergency',
];
const SOURCES = ['call_998', 'call_999', 'call_997', 'call_996', 'app_sos', 'aed_activation', 'cad_feed', 'sensor', 'field_unit', 'transfer'];
const CALLER_ROLES = ['self', 'bystander', 'family', 'security', 'staff'];

type Nearby = MakaniPoint & { distanceM?: number };

/** An entrance further than this from the click is not "here" — offering it would attach
 *  the call to the wrong building. */
const ATTACH_RADIUS_M = 250;

/** Mounted fresh for every opening (see OperationsPage), so the form starts empty without
 *  resetting a dozen fields by hand. */
export function CreateIncidentDialog({ at, onClose, onCreated }: {
  at: [number, number] | null;
  onClose: () => void;
  onCreated: (incident: Incident) => void;
}) {
  const [nearby, setNearby] = useState<Nearby[] | null>(at ? null : []);
  const [place, setPlace] = useState<string>('point');   // 'point' or a Makani number
  const [makaniInput, setMakaniInput] = useState('');
  const [kind, setKind] = useState('medical_general');
  const [priority, setPriority] = useState<Priority | 'auto'>('auto');
  const [complaint, setComplaint] = useState('');
  const [floor, setFloor] = useState('');
  const [unitNo, setUnitNo] = useState('');
  const [accessNote, setAccessNote] = useState('');
  const [source, setSource] = useState('call_998');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerRole, setCallerRole] = useState('');
  const [patients, setPatients] = useState('1');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One key per attempt: a retried click replays; a corrected form is a new request.
  const [submitKey, setSubmitKey] = useState(idempotencyKey);

  useEffect(() => {
    if (!at) return;
    let cancelled = false;
    api.makaniReverse(at[0], at[1], 5)
      .then((list) => {
        if (cancelled) return;
        const points = (list as Nearby[]).filter((m) => (m.distanceM ?? Infinity) <= ATTACH_RADIUS_M);
        setNearby(points);
        if (points[0] && (points[0].distanceM ?? Infinity) <= 60) setPlace(points[0].makani);
      })
      .catch(() => { if (!cancelled) setNearby([]); });
    return () => { cancelled = true; };
  }, [at]);

  const entrance = nearby?.find((m) => m.makani === place) ?? null;

  const submit = async () => {
    const typed = makaniInput.replace(/\s/g, '');
    const location = typed
      ? { makani: typed }
      : place === 'point' && at ? { lng: at[0], lat: at[1] }
        : place !== 'point' ? { makani: place } : null;
    if (!location) { setErrors({ location: t('create.needLocation') }); return; }

    setBusy(true);
    setErrors({});
    try {
      const result = await api.incidents.create({
        ...location,
        kind,
        priority: priority === 'auto' ? null : priority,
        source,
        chiefComplaint: complaint.trim() || undefined,
        floor: floor.trim() ? Number(floor) : null,
        unitNo: unitNo.trim() || undefined,
        accessNote: accessNote.trim() || undefined,
        callerName: callerName.trim() || undefined,
        callerPhone: callerPhone.trim() || undefined,
        callerRole: callerRole || undefined,
        patientsCount: Number(patients) || 1,
      }, submitKey);
      toast({ level: 'success', title: t('create.created', { ref: result.incident.ref }), body: result.triage ? t('incident.autoTriaged') : undefined });
      onCreated(result.incident);
      onClose();
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 422 && e.detail && typeof e.detail === 'object') {
        setErrors(Object.fromEntries(Object.entries(e.detail as Record<string, string[]>).map(([k, v]) => [k, v.join(' ')])));
      } else {
        setErrors({ form: e.message });
      }
      setSubmitKey(idempotencyKey());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width={560}
           title={t('create.title')}
           subtitle={at ? coords(at[0], at[1]) : undefined}
           footer={(
             <>
               {errors.form && <span className="create__error">{errors.form}</span>}
               <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
               <Button variant="primary" loading={busy} onClick={() => void submit()}>{t('create.submit')}</Button>
             </>
           )}>
      <fieldset className="create__place">
        <legend>{t('create.location')}</legend>
        {at && (nearby === null ? (
          <div className="create__searching"><Skeleton height={14} width={180} /><Skeleton height={32} /></div>
        ) : (
          <div className="create__entrances" role="radiogroup" aria-label={t('create.nearest')}>
            {nearby.map((m) => (
              <label key={m.makani} className="create__entrance" data-selected={place === m.makani || undefined}>
                <input type="radio" name="create-place" checked={place === m.makani} onChange={() => setPlace(m.makani)} />
                <span className="mono">{m.formatted}</span>
                <span>{m.buildingName ?? '—'} · {t('incident.entranceOf', { n: m.entranceNo, count: m.entranceCount })}{m.floors ? ` · ${t('incident.floorsTotal', { n: m.floors })}` : ''}</span>
                <span className="create__dist numeric">{distance(m.distanceM)}</span>
              </label>
            ))}
            {nearby.length === 0 && <div className="muted-line">{t('create.noneNearby', { m: ATTACH_RADIUS_M })}</div>}
            <label className="create__entrance" data-selected={place === 'point' || undefined}>
              <input type="radio" name="create-place" checked={place === 'point'} onChange={() => setPlace('point')} />
              <span>{t('create.asClicked')}</span>
            </label>
          </div>
        ))}
        <Field label={t('create.makani')} help={t('create.makaniHelp')} error={errors.makani ?? errors.location}>
          <input inputMode="numeric" value={makaniInput} maxLength={11} placeholder="00000 00000"
                 onChange={(e) => setMakaniInput(e.target.value)} />
        </Field>
      </fieldset>

      <div className="create__grid">
        <Field label={t('create.kind')} error={errors.kind}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t('create.source')}>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}
          </select>
        </Field>
      </div>

      <Field label={t('create.priority')} help={priority === 'auto' ? t('create.autoHelp') : t(`priority.${priority}`)}>
        <Segmented<Priority | 'auto'>
          value={priority}
          onChange={setPriority}
          ariaLabel={t('create.priority')}
          options={[{ value: 'auto', label: t('create.auto') }, ...(['P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => ({ value: p, label: p }))]}
        />
      </Field>

      <Field label={t('create.complaint')} error={errors.chiefComplaint}>
        <input value={complaint} maxLength={200} onChange={(e) => setComplaint(e.target.value)} />
      </Field>

      <div className="create__grid create__grid--3">
        <Field label={t('incident.floor')} error={errors.floor}
               help={entrance?.floors ? t('create.floorHelp', { n: entrance.floors }) : undefined}>
          <input type="number" min={-6} max={200} value={floor} onChange={(e) => setFloor(e.target.value)} />
        </Field>
        <Field label={t('incident.unitNo')}>
          <input value={unitNo} maxLength={40} onChange={(e) => setUnitNo(e.target.value)} />
        </Field>
        <Field label={t('create.patients')} error={errors.patientsCount}>
          <input type="number" min={1} max={500} value={patients} onChange={(e) => setPatients(e.target.value)} />
        </Field>
      </div>

      <Field label={t('incident.accessNote')}>
        <input value={accessNote} maxLength={300} onChange={(e) => setAccessNote(e.target.value)} />
      </Field>

      <div className="create__grid create__grid--3">
        <Field label={t('create.callerName')}>
          <input value={callerName} maxLength={120} onChange={(e) => setCallerName(e.target.value)} />
        </Field>
        <Field label={t('create.callerPhone')}>
          <input type="tel" value={callerPhone} maxLength={40} onChange={(e) => setCallerPhone(e.target.value)} />
        </Field>
        <Field label={t('create.callerRole')}>
          <select value={callerRole} onChange={(e) => setCallerRole(e.target.value)}>
            <option value="">—</option>
            {CALLER_ROLES.map((r) => <option key={r} value={r}>{t(`callerRole.${r}`)}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
