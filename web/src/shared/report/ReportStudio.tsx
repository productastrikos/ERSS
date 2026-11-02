/**
 * The report studio — every download in the product goes through here, so a person always
 * SEES the document before taking it: read it as drafted, edit the parts a person should
 * own (title, summary, clinical notes, recommendations, notes, which sections to include),
 * then download it as a branded PDF or Excel workbook. For an incident the edits can be
 * saved, so a report can be finished later — by the same person or someone else with access.
 *
 * Mounted once per surface (ReportStudioHost). Not portalled: on the mobile surface the
 * studio stays inside the phone-width column like every other overlay there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, FileText, Loader2, PenLine, RotateCcw, Save, X } from 'lucide-react';
import type { ReportDraft } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/stores/toast';
import { Button, ErrorState } from '../ui';
import { docPalette, saveBlob } from './brand';
import { vitalsChartPng } from './chart';
import {
  applyEdits, EDIT_LABEL, editableFrom, fileName, gstDateTime, incidentDoc,
  type DocSection, type ReportDoc, type Tone,
} from './doc';
import { closeReport, useReportSource, type StudioSource } from './store';
import './report.scss';

export function ReportStudioHost() {
  const { source, opened } = useReportSource();
  if (!source) return null;
  return <ReportStudio key={opened} source={source} onClose={closeReport} />;
}

function ReportStudio({ source, onClose }: { source: StudioSource; onClose: () => void }) {
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [savedDraft, setSavedDraft] = useState<ReportDraft | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | 'save' | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (source.kind === 'incident') {
          const r = await api.reports.get(source.ref);
          if (cancelled) return;
          const d = incidentDoc(r);
          setDoc(d);
          setSavedDraft(r.draft);
          setDraft(editableFrom(d, r.draft));
        } else {
          const d = await source.build();
          if (cancelled) return;
          setDoc(d);
          setDraft(editableFrom(d, null));
        }
      } catch (e) {
        if (!cancelled) setError((e as ApiError).message ?? 'Could not prepare the report');
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  // Escape closes; focus starts in the studio and goes back where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);

  const applied = useMemo(() => (doc ? applyEdits(doc, draft) : null), [doc, draft]);
  const canSave = source.kind === 'incident';
  const dirty = canSave && doc && draft ? JSON.stringify(draft) !== JSON.stringify(editableFrom(doc, savedDraft)) : false;

  async function download(format: 'pdf' | 'xlsx') {
    if (!applied) return;
    setBusy(format);
    try {
      const blob = format === 'pdf'
        ? await (await import('./pdf')).renderPdf(applied)
        : await (await import('./xlsx')).renderXlsx(applied);
      saveBlob(blob, fileName(applied, format));
      toast({ level: 'success', title: format === 'pdf' ? 'PDF downloaded' : 'Excel workbook downloaded', body: fileName(applied, format) });
    } catch (e) {
      toast({ level: 'danger', title: 'Could not create the file', body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (source.kind !== 'incident' || !draft) return;
    setBusy('save');
    try {
      const { updatedBy, updatedAt, ...edits } = draft;
      void updatedBy; void updatedAt;
      const saved = await api.reports.saveDraft(source.ref, edits);
      setSavedDraft(saved);
      toast({ level: 'success', title: 'Draft saved', body: 'Your edits are kept with the incident.' });
    } catch (e) {
      toast({ level: 'danger', title: 'Could not save the draft', body: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  const set = (patch: Partial<ReportDraft>) => setDraft((d) => ({ ...(d ?? {}), ...patch }));
  const toggleSection = (id: string, include: boolean) => set({
    hidden: include ? (draft?.hidden ?? []).filter((x) => x !== id) : [...(draft?.hidden ?? []), id],
  });

  return (
    <div className="rs" role="dialog" aria-modal="true" aria-label={doc ? `${doc.eyebrow}: ${doc.title}` : 'Report'}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rs__panel" ref={panel} tabIndex={-1}>
        <header className="rs__bar">
          <div className="rs__heading">
            <span className="rs__eyebrow"><FileText aria-hidden /> {doc?.eyebrow ?? 'Report'}</span>
            <strong className="rs__title">{applied?.title ?? 'Preparing…'}</strong>
          </div>
          <div className="rs__tools">
            {doc && (
              <Button variant={editing ? 'primary' : 'secondary'} size="sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
                {editing ? <Check aria-hidden /> : <PenLine aria-hidden />} {editing ? 'Done' : 'Edit'}
              </Button>
            )}
            {canSave && doc && (
              <Button variant="ghost" size="sm" loading={busy === 'save'} disabled={!dirty} onClick={() => void save()} title={dirty ? 'Keep these edits with the incident' : 'No unsaved edits'}>
                <Save aria-hidden /> <span className="rs__hide-sm">Save draft</span>
              </Button>
            )}
            <Button variant="primary" size="sm" loading={busy === 'pdf'} disabled={!applied || !!busy} onClick={() => void download('pdf')}>
              <Download aria-hidden /> PDF
            </Button>
            <Button variant="secondary" size="sm" loading={busy === 'xlsx'} disabled={!applied || !!busy} onClick={() => void download('xlsx')}>
              <FileSpreadsheet aria-hidden /> Excel
            </Button>
            <button type="button" className="rs__close" onClick={onClose} aria-label="Close the report"><X aria-hidden /></button>
          </div>
        </header>

        <div className={`rs__body${editing ? ' is-editing' : ''}`}>
          {editing && doc && draft && (
            <aside className="rs__edit" aria-label="Edit the report">
              <p className="rs__hint">Edits change this document only. The record it was drafted from is not changed.</p>
              <label className="rs__field">
                <span>Title</span>
                <input value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value })} maxLength={160} />
              </label>
              {doc.edits.map((k) => {
                const sec = doc.sections.find((s) => s.kind === 'text' && s.edit === k) as Extract<DocSection, { kind: 'text' }> | undefined;
                return (
                  <label key={k} className="rs__field">
                    <span>{EDIT_LABEL[k]}</span>
                    <textarea value={draft[k] ?? ''} rows={k === 'summary' ? 7 : 5} maxLength={4000}
                              placeholder={sec?.placeholder ?? 'Add notes to include in the document'}
                              onChange={(e) => set({ [k]: e.target.value })} />
                  </label>
                );
              })}
              <fieldset className="rs__sections">
                <legend>Include</legend>
                {doc.sections.filter((s) => s.kind !== 'text' || !s.edit).map((s) => (
                  <label key={s.id}>
                    <input type="checkbox" checked={!(draft.hidden ?? []).includes(s.id)} onChange={(e) => toggleSection(s.id, e.target.checked)} />
                    {s.title}
                  </label>
                ))}
              </fieldset>
              <Button variant="ghost" size="sm" onClick={() => setDraft(editableFrom(doc, null))}>
                <RotateCcw aria-hidden /> Back to the drafted version
              </Button>
              {savedDraft?.updatedAt && <p className="rs__hint">Last saved {gstDateTime(savedDraft.updatedAt)}{savedDraft.updatedBy ? ` by ${savedDraft.updatedBy}` : ''}.</p>}
            </aside>
          )}

          <div className="rs__desk">
            {error ? <ErrorState title="Could not prepare the report" body={error} />
              : !applied ? <div className="rs__loading"><Loader2 className="u-spin" aria-hidden /> Drafting the report…</div>
                : <Paper doc={applied} editing={editing} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The preview: the same document the PDF and the workbook are made from ──────

function Paper({ doc, editing }: { doc: ReportDoc; editing: boolean }) {
  return (
    <article className="rs-paper">
      <div className="rs-paper__sweep" aria-hidden />
      <div className="rs-paper__head">
        <img className="rs-paper__logo" src="/dcas_logo.png" alt="Dubai Corporation for Ambulance Services" />
        {doc.classification && <span className="rs-paper__class">{doc.classification}</span>}
      </div>
      <div className="rs-paper__eyebrow">{doc.eyebrow}</div>
      <h1 className="rs-paper__title">{doc.title}</h1>
      <div className="rs-paper__sub">{doc.subtitle}</div>
      <div className="rs-paper__meta">
        {doc.ref ? `${doc.ref} · ` : ''}Generated {gstDateTime(doc.generatedAt)}{doc.generatedBy ? ` by ${doc.generatedBy}` : ''}
      </div>
      {doc.sections.map((s) => <PaperSection key={s.id} s={s} editing={editing} />)}
      <footer className="rs-paper__foot">
        <span><b>Dubai Corporation for Ambulance Services</b> · Emergency Response Support System (ERSS)</span>
        {(doc.confidential || doc.classification) && (
          <span className="rs-paper__flags">{[doc.confidential ? 'Confidential — contains patient information' : null, doc.classification].filter(Boolean).join(' · ')}</span>
        )}
      </footer>
    </article>
  );
}

function PaperSection({ s, editing }: { s: DocSection; editing: boolean }) {
  switch (s.kind) {
    case 'text':
      if (!s.text.trim()) {
        return editing && s.placeholder ? (
          <section className="rs-sec"><h2>{s.title}</h2><p className="rs-sec__placeholder">{s.placeholder}</p></section>
        ) : null;
      }
      return <section className="rs-sec"><h2>{s.title}</h2>{s.text.split('\n').map((p, i) => <p key={i}>{p}</p>)}</section>;
    case 'facts':
      return (
        <section className="rs-sec">
          <h2>{s.title}</h2>
          <dl className="rs-facts">
            {s.facts.map((f, i) => (
              <div key={i}><dt>{f.label}</dt><dd data-tone={f.tone}>{f.value}</dd></div>
            ))}
          </dl>
        </section>
      );
    case 'table':
      return (
        <section className="rs-sec">
          <h2>{s.title}</h2>
          {s.rows.length === 0 ? <p className="rs-sec__placeholder">No rows.</p> : (
            <div className="rs-table__wrap">
              <table className="rs-table">
                <thead><tr>{s.columns.map((c) => <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={i}>
                      {s.columns.map((c, k) => (
                        <td key={c.key} style={{ textAlign: c.align ?? 'left' }} data-tone={k === 0 ? s.tones?.[i] ?? undefined : undefined}>{r[c.key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.note && <p className="rs-sec__note">{s.note}</p>}
        </section>
      );
    case 'findings':
      return (
        <section className="rs-sec">
          <h2>{s.title}</h2>
          <ul className="rs-findings">
            {s.items.map((f, i) => (
              <li key={i}>
                <span className="rs-findings__tag" data-tone={f.tone as Tone}>{f.label ?? f.tone}</span>
                <span><b>{f.title}</b>{f.detail && <small>{f.detail}</small>}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'chart':
      return <ChartSection s={s} />;
    case 'list':
      return (
        <section className="rs-sec">
          <h2>{s.title}</h2>
          <ul className="rs-list">{s.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {s.note && <p className="rs-sec__note">{s.note}</p>}
        </section>
      );
    default:
      return null;
  }
}

function ChartSection({ s }: { s: Extract<DocSection, { kind: 'chart' }> }) {
  const png = useMemo(() => vitalsChartPng(s.series, docPalette(), { width: 1600, height: 560 }), [s.series]);
  if (!png) return null;
  return (
    <section className="rs-sec">
      <h2>{s.title}</h2>
      <img className="rs-chart" src={png} alt="Heart rate and SpO₂ over time" />
      {s.caption && <p className="rs-sec__note">{s.caption}</p>}
    </section>
  );
}
