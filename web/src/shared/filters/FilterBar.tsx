/**
 * The universal filter bar — ONE control, on every page that draws a chart.
 *
 * The client's requirement was "as many filters as possible, everywhere, with
 * predictions". The trap in that requirement is a wall of twenty dropdowns above every
 * chart, which is technically compliant and unusable. So:
 *
 *   - the row that is always visible holds the four things an operator changes
 *     constantly: the window, the priority, the prediction switch, and the horizon;
 *   - everything else lives behind "All filters", which opens a panel of every dimension
 *     the server can slice by, grouped the way an operator thinks (what happened / where /
 *     who responded / when / how it went);
 *   - whatever is on is echoed as a row of removable chips, so nothing is ever filtering
 *     invisibly — the single worst failure mode a filter bar has;
 *   - the options come from the server (`/api/insights/filter-options`) with counts, so a
 *     value that never occurs is never offered.
 *
 * The state lives in lib/filters.ts, not here: this component is the view onto it, and
 * charts read the same store. Clicking a bar in a chart and choosing a value here are the
 * same operation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, RotateCcw, Sparkles, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import type { FilterOptions } from '../../lib/types';
import { SOURCE_LABEL, UNIT_KIND_LABEL, count as fmtCount } from '../../lib/format';
import {
  type ChartFilters, type Tri, type Interval,
  DOW_LABELS, HOUR_BANDS, WINDOW_PRESETS,
  activeChips, clearKey, resetFilters, setFilters, useFilters, windowDays,
} from '../../lib/filters';
import { kindLabel, labelFor, titleCase, useFilterOptions } from './actions';
import { Button, Segmented } from '../ui';
import './filters.scss';

// ── The bar ───────────────────────────────────────────────────────────────────

export function FilterBar({ hidden = [], note }: {
  /** Dimensions a page cannot honour — greyed out with the reason, never silently absent. */
  hidden?: Array<keyof ChartFilters>;
  note?: string;
}) {
  const f = useFilters();
  const opts = useFilterOptions();
  const [open, setOpen] = useState(false);
  const chips = useMemo(() => activeChips(f, (k, v) => labelFor(k, v, opts)), [f, opts]);
  const off = (k: keyof ChartFilters) => hidden.includes(k);

  return (
    <section className="fbar" aria-label={t('filter.title')}>
      <div className="fbar__row">
        <Segmented
          value={f.window}
          ariaLabel={t('filter.window')}
          onChange={(v) => setFilters({ window: v })}
          options={[...WINDOW_PRESETS.map((p) => ({ value: p.value, label: p.label })), { value: 'custom' as const, label: t('filter.custom') }]}
        />

        {f.window === 'custom' && (
          <span className="fbar__dates">
            <input type="date" aria-label={t('filter.from')} value={f.from ?? ''}
                   max={f.to ?? undefined}
                   onChange={(e) => setFilters({ from: e.target.value || null })} />
            <span aria-hidden>→</span>
            <input type="date" aria-label={t('filter.to')} value={f.to ?? ''}
                   min={f.from ?? undefined}
                   onChange={(e) => setFilters({ to: e.target.value || null })} />
          </span>
        )}

        {!off('priority') && (
          <MultiChips
            label={t('filter.priority')}
            values={(opts?.priorities ?? [{ value: 'P1' }, { value: 'P2' }, { value: 'P3' }, { value: 'P4' }]).map((p) => ({ value: p.value, label: p.value }))}
            selected={f.priority}
            onChange={(priority) => setFilters({ priority })}
          />
        )}

        <span className="fbar__spacer" />

        <label className="fbar__switch" title={t('filter.predictHelp')}>
          <input type="checkbox" checked={f.predict} onChange={(e) => setFilters({ predict: e.target.checked })} />
          <span className="fbar__switch-track" aria-hidden />
          <Sparkles aria-hidden /> {t('filter.predict')}
        </label>

        {f.predict && (
          <>
            <label className="fbar__horizon">
              {t('filter.horizon')}
              <input type="number" min={1} max={60} value={f.horizon}
                     onChange={(e) => setFilters({ horizon: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
              <span className="fbar__unit">{t('filter.horizonUnit')}</span>
            </label>
            <Segmented
              value={String(f.interval)}
              ariaLabel={t('filter.interval')}
              onChange={(v) => setFilters({ interval: Number(v) as Interval })}
              options={[{ value: '80', label: '80%' }, { value: '95', label: '95%' }, { value: '0', label: t('filter.noBand') }]}
            />
          </>
        )}

        <Button size="sm" variant={open ? 'primary' : 'secondary'} onClick={() => setOpen((v) => !v)}
                aria-expanded={open} title={t('filter.allHelp')}>
          <Filter aria-hidden /> {t('filter.all')}
          {chips.length > 0 && <span className="fbar__badge">{chips.length}</span>}
          <ChevronDown aria-hidden className={open ? 'is-open' : undefined} />
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="fbar__chips">
          {chips.map((c) => (
            <button type="button" key={`${String(c.key)}:${c.value}`} className="fbar__chip"
                    title={t('filter.removeOne')} onClick={() => setFilters(clearKey(c.key))}>
              <strong>{c.label}</strong>{c.value && <>: {c.value}</>}<X aria-hidden />
            </button>
          ))}
          <button type="button" className="fbar__chip fbar__chip--reset" onClick={() => resetFilters()}>
            <RotateCcw aria-hidden /> {t('filter.reset')}
          </button>
        </div>
      )}

      {note && <p className="fbar__note">{note}</p>}

      {open && <AllFilters f={f} opts={opts} hidden={hidden} onClose={() => setOpen(false)} />}
    </section>
  );
}

// ── The full panel ────────────────────────────────────────────────────────────

function AllFilters({ f, opts, hidden, onClose }: {
  f: ChartFilters; opts: FilterOptions | null; hidden: Array<keyof ChartFilters>; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const off = (k: keyof ChartFilters) => hidden.includes(k);
  const sectors = opts?.zones.filter((z) => z.level === 'sector') ?? [];
  const communities = opts?.zones.filter((z) => z.level === 'community' && z.n > 0) ?? [];

  return (
    <div className="fbar__panel" ref={ref}>
      <FieldGroup title={t('filter.group.what')}>
        {!off('kind') && (
          <MultiSelect label={t('filter.kind')} placeholder={t('filter.anyKind')}
            options={(opts?.kinds ?? []).map((k) => ({ value: k.value, label: kindLabel(k.value), n: k.n }))}
            selected={f.kind} onChange={(kind) => setFilters({ kind })} />
        )}
        {!off('complaint') && (
          <MultiSelect label={t('filter.complaint')} placeholder={t('filter.anyComplaint')}
            options={(opts?.complaints ?? []).map((c) => ({ value: c.value, label: c.value, n: c.n }))}
            selected={f.complaint} onChange={(complaint) => setFilters({ complaint })} />
        )}
        {!off('source') && (
          <MultiSelect label={t('filter.source')} placeholder={t('filter.anySource')}
            options={(opts?.sources ?? []).map((s) => ({ value: s.value, label: SOURCE_LABEL[s.value] ?? titleCase(s.value), n: s.n }))}
            selected={f.source} onChange={(source) => setFilters({ source })} />
        )}
        {!off('escalation') && (
          <MultiSelect label={t('filter.escalation')} placeholder={t('filter.anyEscalation')}
            options={(opts?.escalation ?? []).map((e) => ({ value: e.value, label: e.value, n: e.n }))}
            selected={f.escalation} onChange={(escalation) => setFilters({ escalation })} />
        )}
      </FieldGroup>

      <FieldGroup title={t('filter.group.where')}>
        {!off('zone') && (
          <>
            <MultiSelect label={t('filter.sector')} placeholder={t('filter.anySector')} help={t('filter.sectorHelp')}
              options={sectors.map((z) => ({ value: z.value, label: z.label, n: z.n }))}
              selected={f.zone.filter((z) => sectors.some((s) => s.value === z))}
              onChange={(picked) => setFilters({ zone: [...f.zone.filter((z) => !sectors.some((s) => s.value === z)), ...picked] })} />
            <MultiSelect label={t('filter.community')} placeholder={t('filter.anyCommunity')}
              options={communities.map((z) => ({ value: z.value, label: z.label, n: z.n }))}
              selected={f.zone.filter((z) => communities.some((c) => c.value === z))}
              onChange={(picked) => setFilters({ zone: [...f.zone.filter((z) => !communities.some((c) => c.value === z)), ...picked] })} />
          </>
        )}
        {!off('zoneClass') && (
          <MultiSelect label={t('filter.zoneClass')} placeholder={t('filter.anyZoneClass')}
            options={(opts?.zoneClasses ?? []).map((c) => ({ value: c.value, label: titleCase(c.value), n: null }))}
            selected={f.zoneClass} onChange={(zoneClass) => setFilters({ zoneClass })} />
        )}
        {!off('floorMin') && (
          <BandField label={t('filter.floor')} help={t('filter.floorHelp')}
            min={f.floorMin} max={f.floorMax} lo={0} hi={opts?.floorMax ?? 200}
            onChange={(floorMin, floorMax) => setFilters({ floorMin, floorMax })} />
        )}
        {!off('highrise') && (
          <TriField label={t('filter.highrise')} value={f.highrise} yes={t('filter.highriseYes')} no={t('filter.highriseNo')}
            onChange={(highrise) => setFilters({ highrise })} />
        )}
      </FieldGroup>

      <FieldGroup title={t('filter.group.who')}>
        {!off('unitKind') && (
          <MultiSelect label={t('filter.unitKind')} placeholder={t('filter.anyUnitKind')}
            options={(opts?.unitKinds ?? []).map((u) => ({ value: u.value, label: UNIT_KIND_LABEL[u.value] ?? u.value, n: null }))}
            selected={f.unitKind} onChange={(unitKind) => setFilters({ unitKind })} />
        )}
        {!off('agency') && (
          <MultiSelect label={t('filter.agency')} placeholder={t('filter.anyAgency')}
            options={(opts?.agencies ?? []).map((a) => ({ value: a.value, label: a.label ?? a.value, n: null }))}
            selected={f.agency} onChange={(agency) => setFilters({ agency })} />
        )}
        {!off('station') && (
          <MultiSelect label={t('filter.station')} placeholder={t('filter.anyStation')}
            options={(opts?.stations ?? []).filter((s) => s.agency === 'DCAS').map((s) => ({ value: s.value, label: s.label, n: null }))}
            selected={f.station} onChange={(station) => setFilters({ station })} />
        )}
        {!off('multiAgency') && (
          <TriField label={t('filter.multiAgency')} value={f.multiAgency} yes={t('filter.multiYes')} no={t('filter.multiNo')}
            onChange={(multiAgency) => setFilters({ multiAgency })} />
        )}
      </FieldGroup>

      <FieldGroup title={t('filter.group.when')}>
        {!off('dow') && (
          <div className="ffield">
            <span className="ffield__label">{t('filter.dow')}</span>
            <div className="ffield__toggles">
              {DOW_LABELS.map((label, d) => (
                <button type="button" key={label} aria-pressed={f.dow.includes(d)}
                        onClick={() => setFilters({ dow: f.dow.includes(d) ? f.dow.filter((x) => x !== d) : [...f.dow, d].sort() })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!off('hourFrom') && (
          <div className="ffield">
            <span className="ffield__label">{t('filter.hours')}</span>
            <div className="ffield__hours">
              <input type="number" min={0} max={23} aria-label={t('filter.hourFrom')}
                     value={f.hourFrom ?? ''} placeholder="00"
                     onChange={(e) => setFilters({ hourFrom: e.target.value === '' ? null : clampHour(e.target.value) })} />
              <span aria-hidden>–</span>
              <input type="number" min={0} max={23} aria-label={t('filter.hourTo')}
                     value={f.hourTo ?? ''} placeholder="23"
                     onChange={(e) => setFilters({ hourTo: e.target.value === '' ? null : clampHour(e.target.value) })} />
              <span className="ffield__help">{t('filter.hoursHelp')}</span>
            </div>
            <div className="ffield__toggles">
              {HOUR_BANDS.map((b) => (
                <button type="button" key={b.key} aria-pressed={f.hourFrom === b.from && f.hourTo === b.to}
                        onClick={() => setFilters(f.hourFrom === b.from && f.hourTo === b.to
                          ? { hourFrom: null, hourTo: null }
                          : { hourFrom: b.from, hourTo: b.to })}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </FieldGroup>

      <FieldGroup title={t('filter.group.outcome')}>
        {!off('withinTarget') && (
          <TriField label={t('filter.withinTarget')} value={f.withinTarget} yes={t('filter.targetMet')} no={t('filter.targetMissed')}
            onChange={(withinTarget) => setFilters({ withinTarget })} />
        )}
        {!off('outcome') && (
          <MultiSelect label={t('filter.outcome')} placeholder={t('filter.anyOutcome')}
            options={(opts?.outcomes ?? []).map((o) => ({ value: o.value, label: titleCase(o.value), n: o.n }))}
            selected={f.outcome} onChange={(outcome) => setFilters({ outcome })} />
        )}
        {!off('transported') && (
          <TriField label={t('filter.transported')} value={f.transported} yes={t('filter.transYes')} no={t('filter.transNo')}
            onChange={(transported) => setFilters({ transported })} />
        )}
        {!off('responseMinSec') && (
          <BandField label={t('filter.responseBand')} help={t('filter.responseBandHelp')} step={30}
            min={f.responseMinSec} max={f.responseMaxSec} lo={0} hi={3600}
            onChange={(responseMinSec, responseMaxSec) => setFilters({ responseMinSec, responseMaxSec })} />
        )}
        {!off('acuityMin') && (
          <BandField label={t('filter.acuity')} help={t('filter.acuityHelp')}
            min={f.acuityMin} max={f.acuityMax} lo={1} hi={5}
            onChange={(acuityMin, acuityMax) => setFilters({ acuityMin, acuityMax })} />
        )}
      </FieldGroup>

      <FieldGroup title={t('filter.group.data')}>
        <TriField label={t('filter.seeded')} value={f.seeded} yes={t('filter.seededYes')} no={t('filter.seededNo')}
          onChange={(seeded) => setFilters({ seeded })} />
        <TriField label={t('filter.resting')} value={f.includeResting} yes={t('filter.restingYes')} no={t('filter.restingNo')}
          onChange={(includeResting) => setFilters({ includeResting })} />
        <label className="ffield ffield--inline">
          <input type="checkbox" checked={f.showNaive} onChange={(e) => setFilters({ showNaive: e.target.checked })} />
          <span>{t('filter.showNaive')}</span>
        </label>
        <p className="ffield__help">{t('filter.windowNote', { days: windowDays(f) })}</p>
      </FieldGroup>

      <div className="fbar__panel-foot">
        <Button size="sm" variant="ghost" onClick={() => resetFilters()}><RotateCcw aria-hidden /> {t('filter.resetAll')}</Button>
        <Button size="sm" onClick={onClose}>{t('common.done')}</Button>
      </div>
    </div>
  );
}

const clampHour = (v: string) => Math.max(0, Math.min(23, Number(v) || 0));

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fgroup">
      <h4 className="fgroup__title">{title}</h4>
      <div className="fgroup__body">{children}</div>
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

/**
 * A checkbox list behind a summary button. A native multi-select is unusable with a
 * hundred communities in it; this shows what is on, is searchable past ten options, and
 * keeps the count visible so "how much data is behind this" is never a surprise.
 */
function MultiSelect({ label, options, selected, onChange, placeholder, help }: {
  label: string;
  options: Array<{ value: string; label: string; n: number | null }>;
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase()))
    : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? placeholder
    : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
      : t('filter.nSelected', { n: selected.length });

  return (
    <div className="ffield" ref={box}>
      <span className="ffield__label">{label}</span>
      <button type="button" className={`fselect${selected.length ? ' is-on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="fselect__summary">{summary}</span>
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="fselect__menu">
          {options.length > 10 && (
            <input className="fselect__search" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder={t('filter.search')} autoFocus />
          )}
          <div className="fselect__list">
            {filtered.length === 0 && <div className="fselect__empty">{t('filter.noMatch')}</div>}
            {filtered.map((o) => (
              <label className="fselect__opt" key={o.value}>
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="fselect__opt-label">{o.label}</span>
                {o.n != null && <span className="fselect__opt-n">{fmtCount(o.n)}</span>}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button type="button" className="fselect__clear" onClick={() => onChange([])}>
              <X aria-hidden /> {t('filter.clear')}
            </button>
          )}
        </div>
      )}
      {help && <span className="ffield__help">{help}</span>}
    </div>
  );
}

/** A short, always-visible set — priority is four values and deserves no dropdown. */
function MultiChips({ label, values, selected, onChange }: {
  label: string;
  values: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="fbar__inline" role="group" aria-label={label}>
      <span className="fbar__inline-label">{label}</span>
      {values.map((v) => (
        <button type="button" key={v.value} aria-pressed={selected.includes(v.value)} className="fbar__toggle"
                onClick={() => onChange(selected.includes(v.value) ? selected.filter((x) => x !== v.value) : [...selected, v.value])}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Three states, because "either" is a real answer and a checkbox cannot express it. */
function TriField({ label, value, yes, no, onChange }: {
  label: string; value: Tri; yes: string; no: string; onChange: (v: Tri) => void;
}) {
  return (
    <div className="ffield">
      <span className="ffield__label">{label}</span>
      <Segmented value={value} ariaLabel={label} onChange={onChange}
        options={[{ value: 'any' as Tri, label: t('filter.either') }, { value: 'yes' as Tri, label: yes }, { value: 'no' as Tri, label: no }]} />
    </div>
  );
}

function BandField({ label, min, max, lo, hi, step = 1, help, onChange }: {
  label: string;
  min: number | null; max: number | null;
  lo: number; hi: number; step?: number;
  help?: string;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const num = (v: string) => (v === '' ? null : Math.max(lo, Math.min(hi, Number(v))));
  return (
    <div className="ffield">
      <span className="ffield__label">{label}</span>
      <div className="ffield__band">
        <input type="number" min={lo} max={hi} step={step} value={min ?? ''} placeholder={String(lo)}
               aria-label={`${label} minimum`} onChange={(e) => onChange(num(e.target.value), max)} />
        <span aria-hidden>–</span>
        <input type="number" min={lo} max={hi} step={step} value={max ?? ''} placeholder={String(hi)}
               aria-label={`${label} maximum`} onChange={(e) => onChange(min, num(e.target.value))} />
        {(min != null || max != null) && (
          <button type="button" className="ffield__clear" title={t('filter.clear')} onClick={() => onChange(null, null)}>
            <X aria-hidden />
          </button>
        )}
      </div>
      {help && <span className="ffield__help">{help}</span>}
    </div>
  );
}
