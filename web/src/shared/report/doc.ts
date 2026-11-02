/**
 * The report as a document — ONE model that the on-screen preview, the PDF and the Excel
 * workbook all render from, so what a person reads before downloading is exactly what they
 * get. Builders turn an incident report (server services/reports.js), a table of data from
 * any screen, or the citizen's own health readings into a `ReportDoc`; `applyEdits` lays a
 * person's edits over it.
 */

import type { IncidentReport, ReportDraft, VitalsAnalysis, VitalsPoint } from '../../lib/types';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'ai';
export type EditKey = 'summary' | 'clinicalNotes' | 'recommendations' | 'notes';
export type DocCell = string | number | null;

export interface DocColumn { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: number }

export type DocSection =
  | { id: string; kind: 'text'; title: string; text: string; edit?: EditKey; placeholder?: string }
  | { id: string; kind: 'facts'; title: string; facts: Array<{ label: string; value: string; tone?: Tone }> }
  | { id: string; kind: 'table'; title: string; columns: DocColumn[]; rows: Array<Record<string, DocCell>>; tones?: Array<Tone | null>; note?: string }
  | { id: string; kind: 'findings'; title: string; items: Array<{ tone: Tone; label?: string; title: string; detail?: string | null }> }
  | { id: string; kind: 'chart'; title: string; series: VitalsPoint[]; caption?: string }
  | { id: string; kind: 'list'; title: string; items: string[]; note?: string };

export interface DataSheet { name: string; columns: DocColumn[]; rows: Array<Record<string, DocCell>> }

export interface ReportDoc {
  /** The file-name stem. */
  key: string;
  kind: 'incident' | 'table' | 'vitals';
  /** What sits above the title: "Incident report", "Data export"… */
  eyebrow: string;
  title: string;
  subtitle: string;
  ref: string | null;
  classification: string | null;
  /** Says the document holds patient information (PDPL) — printed in every footer. */
  confidential: boolean;
  generatedAt: string;
  generatedBy: string | null;
  sections: DocSection[];
  /** Which text fields a person may edit before downloading. */
  edits: EditKey[];
  /** Extra sheets for the Excel workbook — the raw data behind the report. */
  sheets: DataSheet[];
}

export const EDIT_LABEL: Record<EditKey, string> = {
  summary: 'Summary', clinicalNotes: 'Clinical notes', recommendations: 'Recommendations', notes: 'Notes',
};

// ── Formatting, in Dubai time ────────────────────────────────────────────────

const TZ = 'Asia/Dubai';
export const gstTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }) : '—';
export const gstDateTime = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ })}, ${gstTime(iso)} GST` : '—';
export const gstDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) : '—';
export const mmss = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const km = (m: number | null | undefined) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const list = (xs: string[] | undefined | null) => (xs?.length ? xs.join(', ') : '—');
const stamp = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString();
  return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 16).replace(':', '')}`;
};

// ── Edits ────────────────────────────────────────────────────────────────────

/** A person's edits laid over the drafted document. */
export function applyEdits(doc: ReportDoc, edits: ReportDraft | null | undefined): ReportDoc {
  if (!edits) return doc;
  const hidden = new Set(edits.hidden ?? []);
  let sections = doc.sections
    .filter((s) => !hidden.has(s.id))
    .map((s) => (s.kind === 'text' && s.edit && edits[s.edit] != null ? { ...s, text: edits[s.edit] as string } : s));
  if (doc.edits.includes('notes') && edits.notes?.trim() && !sections.some((s) => s.kind === 'text' && s.edit === 'notes')) {
    sections = [...sections, { id: 'notes', kind: 'text', title: 'Notes', text: edits.notes, edit: 'notes' }];
  }
  return { ...doc, title: edits.title?.trim() || doc.title, sections };
}

/** What a person can change, pre-filled from the document as drafted. */
export function editableFrom(doc: ReportDoc, draft: ReportDraft | null | undefined): ReportDraft {
  const out: ReportDraft = { title: draft?.title ?? doc.title, hidden: draft?.hidden ?? [] };
  for (const k of doc.edits) {
    const s = doc.sections.find((x) => x.kind === 'text' && x.edit === k) as Extract<DocSection, { kind: 'text' }> | undefined;
    out[k] = draft?.[k] ?? s?.text ?? '';
  }
  return out;
}

export const fileName = (doc: ReportDoc, ext: 'pdf' | 'xlsx') =>
  `DCAS-ERSS_${doc.key}_${stamp(doc.generatedAt)}.${ext}`.replace(/[^\w.-]+/g, '-');

// ── Incident report ──────────────────────────────────────────────────────────

const AUDIENCE = {
  full: { eyebrow: 'Incident report', title: (r: IncidentReport) => `${r.incident.priority} ${r.incident.kindLabel} — ${r.incident.ref}`, suffix: 'incident-report' },
  crew: { eyebrow: 'Patient care & hand-over report', title: (r: IncidentReport) => `${r.incident.kindLabel} — ${r.incident.ref}`, suffix: 'handover-report' },
  citizen: { eyebrow: 'Your emergency — summary', title: (r: IncidentReport) => `${r.incident.kindLabel} on ${gstDate(r.incident.reportedAt)}`, suffix: 'my-emergency' },
} as const;

const toneOf = (t: string | null | undefined): Tone =>
  t === 'good' ? 'good' : t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : t === 'ai' ? 'ai' : 'info';

function vitalsSections(r: IncidentReport, citizen: boolean): DocSection[] {
  const v = r.vitals;
  if (!v?.series.length) return [];
  const a = v.analysis?.value as VitalsAnalysis | null;
  const out: DocSection[] = [{
    id: 'vitals-chart', kind: 'chart', title: 'Wearable vitals — heart rate and SpO₂',
    series: v.series,
    caption: `${v.device ? `${v.device} · ` : ''}${v.series.length} readings from ${gstTime(v.series[0].ts)} to ${gstTime(v.series[v.series.length - 1].ts)} GST. Shaded bands: SpO₂ below 90% and heart rate above 120 bpm.`,
  }];
  if (a) {
    out.push({
      id: 'vitals-facts', kind: 'facts', title: 'Vitals at a glance',
      facts: [
        { label: 'Pattern', value: a.headline, tone: a.severity === 'bad' ? 'bad' : a.severity === 'warn' ? 'warn' : 'good' },
        ...(a.spo2 ? [
          { label: 'SpO₂ baseline → lowest', value: `${a.spo2.baseline}% → ${a.spo2.min}% (at ${gstTime(a.spo2.minAt)})`, tone: (a.spo2.min < 90 ? 'bad' : a.spo2.min < 94 ? 'warn' : 'good') as Tone },
          { label: 'Time below 90% / 94%', value: `${mmss(a.spo2.below90Sec)} / ${mmss(a.spo2.below94Sec)}` },
          { label: 'Steepest SpO₂ fall', value: `${a.spo2.maxFallPerMin} % per minute` },
        ] : []),
        ...(a.hr ? [
          { label: 'Heart rate baseline → peak', value: `${a.hr.baseline} → ${a.hr.max} bpm (at ${gstTime(a.hr.maxAt)})`, tone: (a.hr.max >= 150 ? 'bad' : a.hr.max >= 120 ? 'warn' : 'good') as Tone },
          { label: 'Time above 120 bpm', value: mmss(a.hr.above120Sec) },
          { label: 'Steepest heart-rate rise', value: `${a.hr.maxRisePerMin} bpm per minute` },
        ] : []),
        { label: 'Which changed first', value: a.sequence.first === 'spo2' ? `Oxygen — ${mmss(a.sequence.leadSec)} before the heart rate` : a.sequence.first === 'hr' ? `Heart rate — ${mmss(a.sequence.leadSec)} before the oxygen` : a.sequence.first === 'together' ? 'Together' : '—' },
        { label: 'Record', value: `${a.samples} readings over ${mmss(a.window.durationSec)}${a.gaps ? ` · ${a.gaps} gap${a.gaps > 1 ? 's' : ''}` : ''}${a.device ? ` · ${a.device}` : ''}` },
      ],
    });
    out.push({
      id: 'vitals-findings', kind: 'findings', title: 'What the readings show',
      items: a.findings.map((f) => ({ tone: f.tone, label: f.tone === 'bad' ? 'Alert' : f.tone === 'warn' ? 'Watch' : f.tone === 'good' ? 'Normal' : 'Pattern', title: f.text })),
    });
    if (!citizen && (a.considerations.length || a.prepare.length)) {
      out.push({
        id: 'vitals-considerations', kind: 'list', title: 'For the receiving team',
        items: [...a.considerations, ...(a.prepare.length ? [`Have ready: ${a.prepare.join(' · ')}`] : [])],
        note: v.analysis.caveats.join(' '),
      });
    } else {
      out.push({ id: 'vitals-note', kind: 'list', title: 'About these readings', items: v.analysis.caveats, note: 'You can share this summary with your doctor.' });
    }
  }
  return out;
}

export function incidentDoc(r: IncidentReport): ReportDoc {
  const aud = AUDIENCE[r.audience];
  const i = r.incident;
  const citizen = r.audience === 'citizen';
  const full = r.audience === 'full';
  const sections: DocSection[] = [];

  sections.push({ id: 'summary', kind: 'text', title: 'Summary', text: r.narrative, edit: 'summary' });

  sections.push({
    id: 'incident', kind: 'facts', title: 'Incident',
    facts: [
      { label: 'Reference', value: i.ref },
      { label: 'Type', value: `${i.kindLabel}${i.chiefComplaint ? ` — ${i.chiefComplaint}` : ''}` },
      { label: 'Priority', value: i.priority, tone: i.priority === 'P1' ? 'bad' : i.priority === 'P2' ? 'warn' : 'info' },
      { label: 'Raised by', value: `${i.sourceLabel}${i.reportedBy ? ` — ${i.reportedBy}` : ''}` },
      { label: 'Location', value: [i.place, i.zoneName].filter((x, k, arr) => x && arr.indexOf(x) === k).join(', ') || '—' },
      ...(!citizen ? [{ label: 'Coordinates', value: `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}${i.makani ? ` · Makani ${i.makani}` : ''}` }] : []),
      { label: 'Reported', value: gstDateTime(i.reportedAt) },
      { label: 'First ambulance on scene', value: gstDateTime(i.firstOnsceneAt) },
      { label: 'Closed', value: i.closedAt ? gstDateTime(i.closedAt) : 'Still open' },
      { label: 'Outcome', value: i.outcomeLabel ?? (i.closedAt ? '—' : 'In progress') },
      ...(i.patients > 1 ? [{ label: 'Patients', value: String(i.patients) }] : []),
    ],
  });

  // The patient's own record comes early for the crew and the citizen — it is what they need.
  const p = r.patient.profile;
  const patientSection: DocSection | null = p || r.patient.triageTag ? {
    id: 'patient', kind: 'facts', title: citizen ? 'Your medical profile (as sent with the SOS)' : 'Patient record',
    facts: [
      ...(p ? [
        { label: 'Blood group', value: p.bloodGroup || '—' },
        { label: 'Allergies', value: list(p.allergies), tone: (p.allergies?.length ? 'bad' : undefined) as Tone | undefined },
        { label: 'Conditions', value: list(p.conditions) },
        { label: 'Medications', value: list(p.medications) },
        ...(p.emergencyContact?.name ? [{ label: 'Emergency contact', value: `${p.emergencyContact.name}${p.emergencyContact.phone ? ` · ${p.emergencyContact.phone}` : ''}` }] : []),
      ] : []),
      ...(r.patient.triageTag ? [{ label: 'Triage tag', value: r.patient.triageTag }] : []),
    ],
  } : null;
  if (patientSection && !full) sections.push(patientSection);
  if (!full) sections.push(...vitalsSections(r, citizen));

  if (r.totals.responseSec != null || r.intervals.length) {
    sections.push({
      id: 'response-glance', kind: 'facts', title: 'The response at a glance',
      facts: [
        { label: 'Alert to ambulance on scene', value: mmss(r.totals.responseSec), tone: r.totals.withinTarget == null ? undefined : r.totals.withinTarget ? 'good' : 'bad' },
        { label: `${i.priority} target`, value: `${mmss(r.totals.targetSec)} — ${r.totals.withinTarget == null ? 'not yet reached' : r.totals.withinTarget ? 'met' : 'missed'}` },
        ...(r.totals.totalSec != null ? [{ label: 'Alert to crew clear', value: mmss(r.totals.totalSec) }] : []),
        ...(r.route?.toScene?.distanceM ? [{ label: 'Drive to the scene', value: `${km(r.route.toScene.distanceM)}${r.route.toScene.sec ? ` in ${mmss(r.route.toScene.sec)}` : ''}` }] : []),
        ...(r.route?.toHospital?.sec ? [{ label: 'Drive to hospital', value: r.route.toHospital.distanceM ? `${km(r.route.toHospital.distanceM)} in ${mmss(r.route.toHospital.sec)}` : mmss(r.route.toHospital.sec) }] : []),
      ],
    });
    if (!citizen && r.intervals.length) {
      sections.push({
        id: 'response', kind: 'table', title: 'Stage by stage',
        columns: [
          { key: 'stage', label: 'Stage', width: 3 }, { key: 'from', label: 'Start (GST)', width: 1.3 }, { key: 'to', label: 'End (GST)', width: 1.3 },
          { key: 'sec', label: 'Duration', align: 'right', width: 1 }, { key: 'target', label: 'Standard', align: 'right', width: 1 }, { key: 'result', label: 'Result', width: 1 },
        ],
        rows: r.intervals.map((x) => ({ stage: x.label, from: gstTime(x.from), to: gstTime(x.to), sec: mmss(x.sec), target: x.targetSec == null ? '—' : mmss(x.targetSec), result: x.ok == null ? '—' : x.ok ? 'Within' : 'Over' })),
        tones: r.intervals.map((x) => (x.ok == null ? null : x.ok ? 'good' : 'warn')),
        note: 'Standards are this trial\'s working assumptions, not published DCAS figures. Scene and hand-over times are shortened in the demonstration.',
      });
    }
  }

  if (r.unit) {
    sections.push({
      id: 'unit', kind: 'facts', title: citizen ? 'The ambulance that came' : 'Ambulance and crew',
      facts: [
        { label: 'Ambulance', value: `${r.unit.callsign} · ${r.unit.ref} · ${r.unit.kind}` },
        ...(r.unit.vehicle ? [{ label: 'Vehicle', value: `${r.unit.vehicle}${r.unit.plate ? ` · ${r.unit.plate}` : ''}` }] : []),
        ...r.unit.crew.map((c) => ({ label: c.title, value: `${c.name} · ${c.staffId}` })),
      ],
    });
  }

  if (r.dispatch) {
    sections.push({
      id: 'dispatch', kind: 'table', title: 'How the AI chose the ambulance',
      columns: [
        { key: 'rank', label: '#', align: 'right', width: 0.5 }, { key: 'unit', label: 'Ambulance', width: 1.6 },
        { key: 'arrival', label: 'Predicted arrival', align: 'right', width: 1.2 }, { key: 'distance', label: 'Distance', align: 'right', width: 1 },
        { key: 'traffic', label: 'Traffic delay', align: 'right', width: 1 }, { key: 'score', label: 'Score', align: 'right', width: 0.8 }, { key: 'chosen', label: 'Sent', width: 0.7 },
      ],
      rows: r.dispatch.alternatives.map((x) => ({
        rank: x.rank, unit: `${x.callsign} (${x.kind})`, arrival: mmss(x.arrivalSec), distance: km(x.distanceM),
        traffic: x.trafficDelaySec ? `+${mmss(x.trafficDelaySec)}` : '—', score: Math.round((x.score ?? 0) * 100) / 100, chosen: x.chosen ? 'Sent' : '',
      })),
      tones: r.dispatch.alternatives.map((x) => (x.chosen ? 'good' : null)),
      note: [
        `Decision: ${r.dispatch.by}${r.dispatch.rank ? `, rank ${r.dispatch.rank} of ${r.dispatch.of}` : ''}${r.dispatch.confidence != null ? `, confidence ${Math.round(r.dispatch.confidence * 100)}%` : ''}.`,
        ...(r.dispatch.predictionErrorSec != null ? [`Arrival prediction was ${mmss(Math.abs(r.dispatch.predictionErrorSec))} ${r.dispatch.predictionErrorSec > 0 ? 'early (the crew took longer)' : 'late (the crew was quicker)'}.`] : []),
        ...r.dispatch.notes,
      ].join(' '),
    });
  }

  if (r.hospital) {
    const h = r.hospital;
    sections.push({
      id: 'hospital', kind: 'facts', title: citizen ? 'Where you were taken' : 'Receiving hospital and pre-alert',
      facts: [
        { label: 'Hospital', value: `${h.name}${!citizen && h.edLoadPct != null ? ` · emergency department ${h.edLoadPct}% full` : ''}` },
        ...(!citizen ? [
          { label: 'Pre-alert sent', value: h.prealertSentAt ? `${gstTime(h.prealertSentAt)} GST — automatically, as the crew left` : 'Not sent', tone: (h.prealertSentAt ? 'good' : 'warn') as Tone },
          { label: 'Emergency department', value: h.prealertAckAt ? `Acknowledged at ${gstTime(h.prealertAckAt)}${h.bay ? ` · ${h.bay}` : ''} (simulated hospital response)` : '—' },
          ...(h.ready.length ? [{ label: 'Asked to have ready', value: h.ready.join(' · ') }] : []),
          ...(h.etaGivenSec != null ? [{ label: 'ETA given / actual', value: `${mmss(h.etaGivenSec)} / ${mmss(h.actualSec)}` }] : []),
        ] : []),
        { label: 'Arrived at hospital', value: gstDateTime(h.arrivedAt) },
      ],
    });
  }

  if (full && patientSection) sections.push(patientSection);
  if (full) sections.push(...vitalsSections(r, false));

  if (!citizen) {
    sections.push({ id: 'clinical', kind: 'text', title: 'Clinical notes', text: '', edit: 'clinicalNotes', placeholder: 'Add clinical notes for the receiving team — observations, interventions, response to treatment.' });
  }

  if (full && r.review.length) {
    sections.push({
      id: 'review', kind: 'findings', title: 'After-action review',
      items: r.review.map((f) => ({ tone: f.kind === 'good' ? 'good' : f.kind === 'improve' ? 'warn' : 'ai', label: f.kind === 'good' ? 'Went well' : f.kind === 'improve' ? 'Improve' : 'Suggest', title: f.title, detail: f.detail })),
    });
  }
  if (!citizen) {
    sections.push({ id: 'recommendations', kind: 'text', title: 'Recommendations', text: r.recommendations.map((x) => `• ${x}`).join('\n'), edit: 'recommendations', placeholder: 'What should change next time?' });
  }

  sections.push({
    id: 'timeline', kind: 'table', title: 'Timeline',
    columns: [{ key: 'ts', label: 'Time (GST)', width: 1 }, { key: 'event', label: 'Event', width: 5 }],
    rows: r.timeline.map((t) => ({ ts: gstTime(t.ts), event: t.label })),
    tones: r.timeline.map((t) => (t.stage.startsWith('prealert') ? 'ai' : null)),
  });

  if (full && r.aiLog.length) {
    sections.push({
      id: 'aiLog', kind: 'table', title: 'AI log — what the console and the crew co-pilot said',
      columns: [{ key: 'ts', label: 'Time (GST)', width: 1 }, { key: 'source', label: 'Source', width: 0.9 }, { key: 'entry', label: 'Entry', width: 5 }],
      rows: r.aiLog.map((l) => ({ ts: gstTime(l.ts), source: l.source === 'crew' ? 'Crew co-pilot' : l.source === 'review' ? 'Review' : 'Console AI', entry: `${l.title}${l.detail ? ` — ${l.detail}` : ''}` })),
      tones: r.aiLog.map((l) => (l.tone ? toneOf(l.tone) : null)),
    });
  }

  const sheets: DataSheet[] = [
    { name: 'Timeline', columns: [{ key: 'ts', label: 'Time (GST)' }, { key: 'stage', label: 'Stage' }, { key: 'event', label: 'Event' }], rows: r.timeline.map((t) => ({ ts: gstDateTime(t.ts), stage: t.stage, event: t.label })) },
  ];
  if (r.vitals?.series.length) {
    const t0 = Date.parse(r.vitals.series[0].ts);
    sheets.push({
      name: 'Vitals',
      columns: [{ key: 'ts', label: 'Time (GST)' }, { key: 'since', label: 'Elapsed (m:ss)' }, { key: 'hr', label: 'Heart rate (bpm)', align: 'right' }, { key: 'spo2', label: 'SpO₂ (%)', align: 'right' }],
      rows: r.vitals.series.map((v) => ({ ts: gstDateTime(v.ts), since: mmss((Date.parse(v.ts) - t0) / 1000), hr: v.hr, spo2: v.spo2 })),
    });
  }
  if (r.dispatch?.alternatives.length) {
    sheets.push({
      name: 'AI dispatch',
      columns: [{ key: 'rank', label: 'Rank' }, { key: 'unit', label: 'Ambulance' }, { key: 'kind', label: 'Type' }, { key: 'arrival', label: 'Predicted arrival (s)', align: 'right' }, { key: 'distance', label: 'Distance (m)', align: 'right' }, { key: 'traffic', label: 'Traffic delay (s)', align: 'right' }, { key: 'score', label: 'Score', align: 'right' }, { key: 'chosen', label: 'Sent' }],
      rows: r.dispatch.alternatives.map((x) => ({ rank: x.rank, unit: x.callsign, kind: x.kind, arrival: x.arrivalSec, distance: x.distanceM, traffic: x.trafficDelaySec, score: x.score, chosen: x.chosen ? 'Yes' : '' })),
    });
  }

  return {
    key: `${i.ref}_${aud.suffix}`,
    kind: 'incident',
    eyebrow: aud.eyebrow,
    title: aud.title(r),
    subtitle: `${i.sourceLabel} · ${[i.place, i.zoneName].filter(Boolean)[0] ?? 'Dubai'} · ${gstDateTime(i.reportedAt)}`,
    ref: i.ref,
    classification: r.classification,
    confidential: Boolean(r.patient.profile || r.vitals),
    generatedAt: r.generatedAt,
    generatedBy: r.generatedBy,
    sections,
    edits: citizen ? ['summary'] : ['summary', 'clinicalNotes', 'recommendations'],
    sheets,
  };
}

// ── Any table of data, from any screen ───────────────────────────────────────

export function tableDoc(o: {
  key: string; title: string; subtitle?: string; eyebrow?: string;
  columns: DocColumn[]; rows: Array<Record<string, DocCell>>; tones?: Array<Tone | null>;
  facts?: Array<{ label: string; value: string; tone?: Tone }>; note?: string;
  generatedBy?: string | null; classification?: string | null; confidential?: boolean;
}): ReportDoc {
  const at = new Date().toISOString();
  return {
    key: o.key,
    kind: 'table',
    eyebrow: o.eyebrow ?? 'Data export',
    title: o.title,
    subtitle: o.subtitle ?? `As at ${gstDateTime(at)}`,
    ref: null,
    classification: o.classification ?? null,
    confidential: o.confidential ?? false,
    generatedAt: at,
    generatedBy: o.generatedBy ?? null,
    sections: [
      ...(o.facts?.length ? [{ id: 'facts', kind: 'facts' as const, title: 'At a glance', facts: o.facts }] : []),
      { id: 'data', kind: 'table', title: o.title, columns: o.columns, rows: o.rows, tones: o.tones, note: o.note },
    ],
    edits: ['notes'],
    sheets: [],
  };
}

// ── The citizen's own health readings ────────────────────────────────────────

export function vitalsDoc(o: { readings: Array<{ ts: number; bpm: number | null; spo2: number | null }>; device: string | null; person: string | null }): ReportDoc {
  const at = new Date().toISOString();
  const series: VitalsPoint[] = o.readings.map((r) => ({ ts: new Date(r.ts).toISOString(), hr: r.bpm, spo2: r.spo2 }));
  const hr = series.map((s) => s.hr).filter((v): v is number => v != null);
  const sp = series.map((s) => s.spo2).filter((v): v is number => v != null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const t0 = series.length ? Date.parse(series[0].ts) : Date.now();
  return {
    key: 'my-health-readings',
    kind: 'vitals',
    eyebrow: 'Health monitor — readings',
    title: `Heart rate and SpO₂${o.person ? ` — ${o.person}` : ''}`,
    subtitle: series.length ? `${series.length} readings · ${gstDateTime(series[0].ts)} to ${gstTime(series[series.length - 1].ts)} GST` : 'No readings yet',
    ref: null,
    classification: o.device === 'Demo sensor' ? 'Demo sensor — simulated readings' : null,
    confidential: true,
    generatedAt: at,
    generatedBy: o.person,
    sections: [
      { id: 'chart', kind: 'chart', title: 'Heart rate and SpO₂', series, caption: `${o.device ?? 'Health monitor'} · shaded bands mark SpO₂ below 90% and heart rate above 120 bpm.` },
      {
        id: 'glance', kind: 'facts', title: 'At a glance',
        facts: [
          { label: 'Heart rate (min / average / max)', value: hr.length ? `${Math.min(...hr)} / ${avg(hr)} / ${Math.max(...hr)} bpm` : '—', tone: hr.length && Math.max(...hr) >= 120 ? 'warn' : undefined },
          { label: 'SpO₂ (min / average / max)', value: sp.length ? `${Math.min(...sp)} / ${avg(sp)} / ${Math.max(...sp)} %` : '—', tone: sp.length && Math.min(...sp) < 90 ? 'bad' : sp.length && Math.min(...sp) < 94 ? 'warn' : undefined },
          { label: 'Device', value: o.device ?? '—' },
        ],
      },
      { id: 'about', kind: 'list', title: 'About these readings', items: ['Readings from a consumer health monitor — not a medical-grade device. For information only; not a diagnosis.'], note: 'You can share this with your doctor.' },
    ],
    edits: ['notes'],
    sheets: [{
      name: 'Readings',
      columns: [{ key: 'ts', label: 'Time (GST)' }, { key: 'since', label: 'Elapsed (m:ss)' }, { key: 'hr', label: 'Heart rate (bpm)', align: 'right' }, { key: 'spo2', label: 'SpO₂ (%)', align: 'right' }],
      rows: series.map((v) => ({ ts: gstDateTime(v.ts), since: mmss((Date.parse(v.ts) - t0) / 1000), hr: v.hr, spo2: v.spo2 })),
    }],
  };
}
