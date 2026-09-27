/**
 * Recommend and dispatch — docs/06 §2.3, "the screen that matters most".
 *
 * The dispatcher APPROVES a recommendation; they do not re-derive it. Every unit shows
 * its predicted arrival and an expandable "why" rendering the stored factor breakdown.
 * Sending anything other than the top recommendation needs a reason, recorded forever.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, Send } from 'lucide-react';
import type { Incident, Recommendation, DispatchRecommendation } from '../../../lib/types';
import { api, ApiError, idempotencyKey } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { confidence, date, distance, duration } from '../../../lib/format';
import { useFleet } from '../../../lib/stores/fleet';
import { refreshDetail } from '../../../lib/stores/incidents';
import { toast } from '../../../lib/stores/toast';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Meter, Predicted, Skeleton } from '../../../shared/ui';

export function DispatchPanel({ incident, excludeRefs = [], title, onDone, onCancel }: {
  incident: Incident;
  excludeRefs?: string[];
  title?: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ request: string; rec: Recommendation | null; error: string | null } | null>(null);
  const [pick, setPick] = useState<{ request: string; unit: string | null; override: string } | null>(null);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<{ unit: string; key: string } | null>(null);
  const fleet = useFleet();

  const exclude = excludeRefs.join(',');
  // Re-run when anything the engine reads about the incident changes, or on demand.
  const request = `${incident.ref}|${incident.priority}|${incident.kind}|${incident.lng}|${incident.lat}|${incident.floor}|${exclude}#${reload}`;

  useEffect(() => {
    let cancelled = false;
    api.incidents.recommendation(incident.ref, exclude ? exclude.split(',') : undefined)
      .then((rec) => { if (!cancelled) setResult({ request, rec, error: null }); })
      .catch((err: ApiError) => { if (!cancelled) setResult({ request, rec: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [request, incident.ref, exclude]);

  const load = () => setReload((n) => n + 1);
  const loading = result?.request !== request;
  // Keep showing the previous ranking while a re-run is in flight.
  const rec = result?.rec ?? null;
  const status: 'loading' | 'ready' | 'error' = loading && !rec ? 'loading' : result?.error ? 'error' : 'ready';
  const error = result?.error ?? null;

  const recs = useMemo(() => rec?.value?.recommendations ?? [], [rec]);
  const top = recs[0] ?? null;
  // A choice made against an older ranking falls back to the new top recommendation.
  const current = pick && pick.request === result?.request ? pick : null;
  const chosen = current ? current.unit : top?.unitRef ?? null;
  const override = current?.override ?? '';
  const setChosen = (unit: string | null) => setPick({ request: result?.request ?? '', unit, override: '' });
  const setOverride = (unit: string) => setPick({ request: result?.request ?? '', unit: chosen, override: unit });
  const unitRef = override || chosen;
  const needsReason = Boolean(unitRef && top && unitRef !== top.unitRef) || Boolean(override);
  const canSend = Boolean(unitRef) && (!needsReason || reason.trim().length > 2) && !busy;

  const recRefs = new Set(recs.map((r) => r.unitRef));
  const others = fleet.units
    .filter((u) => (u.status === 'available' || u.status === 'standby') && !recRefs.has(u.ref) && !excludeRefs.includes(u.ref))
    .sort((a, b) => a.agencyCode.localeCompare(b.agencyCode) || a.ref.localeCompare(b.ref));

  const dispatch = async () => {
    if (!unitRef) return;
    if (key.current?.unit !== unitRef) key.current = { unit: unitRef, key: idempotencyKey() };
    setBusy(true);
    try {
      await api.incidents.dispatch(incident.ref, { unitRef, overrideReason: needsReason ? reason.trim() : undefined }, key.current.key);
      toast({ level: 'success', title: t('dispatch.offered', { unit: unitRef, ref: incident.ref }) });
      key.current = null;
      await refreshDetail(incident.ref);
      onDone?.();
    } catch (err) {
      const e = err as ApiError;
      const detail = e.detail && typeof e.detail === 'object' ? Object.values(e.detail as Record<string, string[]>).flat().join(' ') : '';
      toast({ level: 'danger', title: t('dispatch.failed'), body: detail || e.message });
      key.current = null;
      if (e.status === 409) load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={title ?? t('dispatch.recommended')}
      subtitle={rec?.value ? requirementLine(rec) : undefined}
      actions={(
        <>
          {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>{t('dispatch.cancelAdd')}</Button>}
          <Button variant="ghost" size="sm" iconOnly onClick={load} aria-label={t('dispatch.refresh')} title={t('dispatch.refresh')}
                  disabled={loading}>
            <RefreshCw aria-hidden className={loading ? 'u-spin' : undefined} />
          </Button>
        </>
      )}
    >
      {status === 'loading' && !rec ? (
        <div className="rec__skeleton"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></div>
      ) : status === 'error' ? (
        <ErrorState body={error ?? undefined} onRetry={load} />
      ) : !recs.length ? (
        <EmptyState icon={<AlertTriangle aria-hidden />} title={t('dispatch.none')} body={rec?.caveats?.[0]} />
      ) : (
        <div className="dispatch">
          {rec?.value?.transport && top && !top.canTransport && (
            <div className="dispatch__note dispatch__note--warning">
              {t('dispatch.transportNote', { unit: top.unitRef, transport: rec.value.transport.unitRef })}
            </div>
          )}

          <ul className="rec" role="radiogroup" aria-label={t('dispatch.recommended')}>
            {recs.map((r) => (
              <RecommendationRow key={r.unitRef} r={r} name={`rec-${incident.ref}`}
                                 selected={unitRef === r.unitRef}
                                 expanded={open === r.unitRef}
                                 onSelect={() => setChosen(r.unitRef)}
                                 onToggle={() => setOpen(open === r.unitRef ? null : r.unitRef)} />
            ))}
          </ul>

          {rec?.value?.vrt?.value && incident.floor != null && (
            <div className="dispatch__vrt" title={t('dispatch.vrtTitle')}>
              <Predicted method={rec.value.vrt.method} confidence={rec.value.vrt.confidence}>
                {t('dispatch.vrt', { time: duration(rec.value.vrt.value.seconds), floor: incident.floor })}
              </Predicted>
            </div>
          )}

          {rec?.value && rec.value.excluded.length > 0 && (
            <details className="dispatch__excluded">
              <summary>{t('dispatch.excluded', { n: rec.value.excluded.length })}</summary>
              <ul>
                {rec.value.excluded.map((x) => (
                  <li key={x.unitRef}><span className="mono">{x.unitRef}</span> {x.kind} · {distance(x.straightM)} — {x.reason}</li>
                ))}
              </ul>
            </details>
          )}

          <Field label={t('dispatch.overrideAny')}>
            <select value={override} onChange={(e) => setOverride(e.target.value)}>
              <option value="">—</option>
              {others.map((u) => (
                <option key={u.ref} value={u.ref}>{u.ref} · {u.kind} · {t(`agency.${u.agencyCode}`)}</option>
              ))}
            </select>
          </Field>

          {needsReason && unitRef && (
            <Field label={t('dispatch.overrideReason')} help={t('dispatch.overrideRequired', { unit: unitRef })}>
              <textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
                        placeholder={t('dispatch.overridePlaceholder')} />
            </Field>
          )}

          <Button variant="primary" size="lg" block onClick={() => void dispatch()} disabled={!canSend} loading={busy}>
            {!busy && <Send aria-hidden />}
            {unitRef ? t('dispatch.dispatchUnit', { unit: unitRef }) : t('dispatch.chooseUnit')}
          </Button>

          {rec && <Evidence rec={rec} />}
        </div>
      )}
    </Card>
  );
}

function requirementLine(rec: Recommendation): string {
  const req = rec.value!.requirement;
  const hard = req.required.length ? req.required.join(' + ').toUpperCase() : t('dispatch.noHardRequirement');
  return `${t('dispatch.requirement')}: ${hard} · ${t('dispatch.prefers', { kinds: req.preferred.join(' › ') })}`;
}

function RecommendationRow({ r, name, selected, expanded, onSelect, onToggle }: {
  r: DispatchRecommendation;
  name: string;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <li className="rec__item" data-selected={selected || undefined}>
      <label className="rec__row">
        <input type="radio" name={name} checked={selected} onChange={onSelect} />
        <span className="rec__rank numeric">{r.rank}</span>
        <span className="rec__unit">
          <span className="rec__callsign">{r.callsign}</span>
          <span className="rec__ref">{r.unitRef} · {r.kind}{r.status === 'standby' ? ' · standby' : ''}</span>
        </span>
        <span className="rec__eta">
          <Predicted method={r.etaMethod} confidence={r.etaConfidence}
                     title={`${r.etaMethod} · ${confidence(r.etaConfidence)} · middle half ${duration(r.etaInterval.p25)}–${duration(r.etaInterval.p75)} driving`}>
            <span className="numeric">{duration(r.arrivalSec)}</span>
          </Predicted>
          <span className="rec__sub">{distance(r.distanceM)}</span>
        </span>
        <span className="rec__score" title={t('dispatch.score')}>
          <Meter value={r.rationale.score} label={`${t('dispatch.score')} ${r.rationale.score.toFixed(2)}`} />
          <span className="numeric">{r.rationale.score.toFixed(2)}</span>
        </span>
      </label>
      <div className="rec__tags">
        {!r.canTransport && <Chip tone="warning">{t('dispatch.noTransport')}</Chip>}
        <button type="button" className="rec__why" aria-expanded={expanded} onClick={onToggle}>
          {t('dispatch.why')} <ChevronDown aria-hidden />
        </button>
      </div>
      {expanded && (
        <div className="why">
          {r.rationale.factors.map((f) => (
            <div className="why__factor" key={f.key}>
              <div className="why__head">
                <span className="why__name">{t(`dispatch.factor.${f.key}`)}</span>
                <span className="why__weight">{t('dispatch.weight', { w: f.weight.toFixed(2) })}</span>
                <span className="why__value numeric">+{f.contribution.toFixed(3)}</span>
              </div>
              <Meter value={f.score} tone={f.key === 'equity' ? 'neutral' : 'accent'} label={`${f.name} ${f.score.toFixed(2)}`} />
              <div className="why__detail">{f.detail}</div>
            </div>
          ))}
          {r.rationale.travel.factors.length > 0 && (
            <div className="why__travel">
              {r.rationale.travel.factors.map((f) => (
                <div key={f.name}><span>{f.name}</span> <span className="numeric">{f.contribution >= 0 ? '+' : ''}{duration(Math.abs(f.contribution))}</span> — {f.detail}</div>
              ))}
              {r.rationale.travel.caveats.map((c) => <div key={c} className="why__caveat">{c}</div>)}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The envelope, rendered: method, window, inputs, confidence, caveats. Explainability is
 *  structural — this is shown under every recommendation, not behind a debug toggle. */
export function Evidence({ rec }: { rec: Recommendation }) {
  return (
    <details className="evidence">
      <summary>{t('advisory.evidence')}</summary>
      <dl>
        <div><dt>{t('dispatch.method')}</dt><dd className="mono">{rec.method}</dd></div>
        <div><dt>{t('dispatch.window')}</dt><dd>{rec.window.from ? `${date(rec.window.from)} – ${date(rec.window.to)}` : '—'}</dd></div>
        <div><dt>{t('dispatch.inputs')}</dt><dd>{rec.inputs.map((i) => `${i.source} (${i.rows.toLocaleString('en-GB')})`).join(' · ')}</dd></div>
        <div><dt>{t('dispatch.confidence')}</dt><dd>{confidence(rec.confidence)}</dd></div>
        {rec.caveats.length > 0 && (
          <div><dt>{t('dispatch.caveats')}</dt><dd><ul>{rec.caveats.map((c) => <li key={c}>{c}</li>)}</ul></dd></div>
        )}
      </dl>
    </details>
  );
}

