/**
 * What the dashboard's download buttons hand to the report studio — each one the data the
 * card is showing, as a document (shared/report/doc.ts tableDoc).
 */

import type { FeedItem, Incident, LiveSummary } from '../../../lib/types';
import { gstTime, mmss, tableDoc, type ReportDoc, type Tone } from '../../../shared/report/doc';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);

export function todayDoc(summary: LiveSummary | null, by: string | null): ReportDoc {
  const k = summary?.kpi;
  const f = summary?.fleet;
  const ai = summary?.aiDispatch;
  const a = summary?.active;
  return tableDoc({
    key: 'daily-summary',
    eyebrow: 'Daily operations summary',
    title: "Today's response performance",
    generatedBy: by,
    facts: [
      { label: 'Median response (alert to on scene)', value: mmss(k?.responseP50Sec), tone: k?.responseP50Sec != null && k.responseP50Sec <= (k.targetSec ?? 480) ? 'good' : 'warn' },
      { label: '90th percentile response', value: mmss(k?.responseP90Sec) },
      { label: 'Reached within target', value: `${pct(k?.withinTargetPct)} of ${k?.responded ?? 0} responses` },
      { label: 'Median acknowledge time', value: mmss(k?.acknowledgeP50Sec) },
      { label: 'Mean turn-out time', value: mmss(k?.turnoutMeanSec) },
      { label: 'Live emergencies', value: `${a?.total ?? 0} (${a?.waiting ?? 0} waiting for an ambulance)` },
      { label: 'Ambulances ready', value: f ? `${f.available + f.standby} of ${f.total}` : '—' },
      { label: 'AI dispatch today', value: ai ? `${ai.dispatches} dispatches · ${mmss(ai.savedSec)} saved · ${ai.faster} sent a faster unit than the nearest` : '—' },
    ],
    columns: [
      { key: 'hour', label: 'Hour (GST)' }, { key: 'n', label: 'Responses', align: 'right' },
      { key: 'p50', label: 'Median response', align: 'right' }, { key: 'vs', label: 'Against target', align: 'right' },
    ],
    rows: (summary?.trend ?? []).filter((h) => h.n > 0).map((h) => ({
      hour: `${String(h.hour).padStart(2, '0')}:00`, n: h.n, p50: mmss(h.p50Sec),
      vs: h.p50Sec == null ? '—' : h.p50Sec <= (summary?.targets.P1 ?? 480) ? 'Within' : 'Over',
    })),
    tones: (summary?.trend ?? []).filter((h) => h.n > 0).map((h) => (h.p50Sec == null ? null : h.p50Sec <= (summary?.targets.P1 ?? 480) ? 'good' : 'warn') as Tone | null),
    note: 'Hourly medians for responses that reached the scene today (Dubai time).',
  });
}

export function feedDoc(items: FeedItem[], by: string | null): ReportDoc {
  return tableDoc({
    key: 'live-feed',
    eyebrow: 'Live feed',
    title: 'Every ambulance stage, as it happened',
    generatedBy: by,
    columns: [
      { key: 'ts', label: 'Time (GST)', width: 0.9 }, { key: 'incident', label: 'Incident', width: 1.3 },
      { key: 'priority', label: 'Priority', width: 0.6 }, { key: 'where', label: 'Where', width: 1.3 }, { key: 'event', label: 'Event', width: 4 },
    ],
    rows: items.map((i) => ({ ts: gstTime(i.ts), incident: i.incidentRef, priority: i.priority ?? '', where: i.zoneName ?? '', event: i.label })),
    tones: items.map((i) => (i.stage === 'closed' ? 'good' : i.stage.startsWith('prealert') ? 'ai' : null)),
  });
}

export function hospitalsDoc(hospitals: LiveSummary['hospitals'], by: string | null): ReportDoc {
  return tableDoc({
    key: 'emergency-departments',
    eyebrow: 'Emergency departments',
    title: 'Emergency department load',
    generatedBy: by,
    columns: [
      { key: 'name', label: 'Hospital', width: 3 }, { key: 'beds', label: 'ED beds', align: 'right' }, { key: 'occupied', label: 'Occupied', align: 'right' },
      { key: 'pct', label: 'Occupancy', align: 'right' }, { key: 'inbound', label: 'Ambulances inbound', align: 'right' }, { key: 'status', label: 'Status' },
    ],
    rows: hospitals.map((h) => ({ name: h.name, beds: h.edBeds, occupied: h.edOccupied, pct: pct(h.occupancyPct), inbound: h.inbound, status: h.onDiversion ? 'On diversion' : 'Open' })),
    tones: hospitals.map((h) => (h.onDiversion || (h.occupancyPct ?? 0) >= 90 ? 'bad' : (h.occupancyPct ?? 0) >= 75 ? 'warn' : 'good')),
    note: 'Emergency-department occupancy is a simulated source in this trial.',
    classification: 'Simulated source',
  });
}

export function liveDoc(incidents: Incident[], by: string | null): ReportDoc {
  return tableDoc({
    key: 'live-responses',
    eyebrow: 'Live responses',
    title: 'Live emergencies and the ambulances on them',
    generatedBy: by,
    columns: [
      { key: 'ref', label: 'Incident', width: 1.3 }, { key: 'priority', label: 'Priority', width: 0.6 }, { key: 'kind', label: 'Type', width: 1.4 },
      { key: 'where', label: 'Where', width: 1.4 }, { key: 'reported', label: 'Reported (GST)', width: 1 }, { key: 'unit', label: 'Ambulance', width: 1.2 }, { key: 'state', label: 'Stage', width: 1 },
    ],
    rows: incidents.map((i) => ({
      ref: i.ref, priority: i.priority, kind: i.kind.replace(/_/g, ' '), where: i.zoneName ?? '', reported: gstTime(i.reportedAt),
      unit: i.primary?.callsign ?? 'Not yet sent', state: i.primary?.state?.replace(/_/g, ' ') ?? 'awaiting',
    })),
    tones: incidents.map((i) => (i.priority === 'P1' ? 'bad' : i.primary ? null : 'warn')),
  });
}
