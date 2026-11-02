/**
 * The patient's own wearable, live — on the crew's job screen and the console's incident
 * panel. When a citizen's SOS came from the app (often sent BY the health monitor), the
 * readings that led up to it travel with it and keep streaming while the ambulance is on its
 * way (server services/vitals.js). A crew that knows the oxygen has been falling for three
 * minutes walks in with the oxygen ready.
 *
 * Renders nothing when the incident has no readings: most incidents (a camera-raised
 * collision) never will.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import type { VitalsPack, VitalsPoint } from '../../lib/types';
import { api } from '../../lib/api';
import { onSocket, watchIncident } from '../../lib/socket';
import { ExportButton } from '../report/ExportButton';
import { tableDoc } from '../report/doc';
import './vitals.scss';

const WINDOW_MS = 5 * 60_000;

export function VitalsCard({ incidentRef, compact = false, exportable = false }: { incidentRef: string; compact?: boolean; exportable?: boolean }) {
  const [pack, setPack] = useState<VitalsPack | null | undefined>(undefined);
  const [live, setLive] = useState<VitalsPoint[]>([]);
  const refetch = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.incidentVitals(incidentRef)
      .then((p) => { if (!cancelled) { setPack(p); setLive([]); } })
      .catch(() => { if (!cancelled) setPack((x) => x ?? null); });
    load();
    const id = window.setInterval(load, 20_000);
    const unwatch = watchIncident(incidentRef);
    const off = onSocket('patient:vitals', (p) => {
      if (p.incidentRef !== incidentRef) return;
      setLive((xs) => [...xs, ...p.readings].slice(-600));
      // The analysis is the server's: ask for it again once a few readings have landed.
      if (refetch.current == null) refetch.current = window.setTimeout(() => { refetch.current = null; load(); }, 8000);
    });
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (refetch.current != null) window.clearTimeout(refetch.current);
      refetch.current = null;
      unwatch();
      off();
    };
  }, [incidentRef]);

  const series = useMemo(() => {
    const all = [...(pack?.series ?? []), ...live];
    const seen = new Set<string>();
    return all.filter((p) => (seen.has(p.ts) ? false : (seen.add(p.ts), true))).sort((a, b) => a.ts.localeCompare(b.ts));
  }, [pack, live]);

  if (!pack && !live.length) return null;
  const latest = [...series].reverse();
  const hr = latest.find((p) => p.hr != null)?.hr ?? null;
  const spo2 = latest.find((p) => p.spo2 != null)?.spo2 ?? null;
  const a = pack?.analysis?.value ?? null;
  const hrTone = hr == null ? undefined : hr >= 150 || hr <= 40 ? 'bad' : hr >= 120 || hr <= 50 ? 'warn' : 'good';
  const spTone = spo2 == null ? undefined : spo2 < 90 ? 'bad' : spo2 < 94 ? 'warn' : 'good';
  const lastAt = latest[0]?.ts ? Date.parse(latest[0].ts) : 0;
  const recent = series.filter((p) => Date.parse(p.ts) >= lastAt - WINDOW_MS);
  const streaming = live.length > 0;
  const worst = a?.findings.find((f) => f.tone === 'bad') ?? a?.findings.find((f) => f.tone === 'warn') ?? null;

  return (
    <section className={`vit${compact ? ' vit--compact' : ''}`} aria-label="Patient's wearable readings">
      <header className="vit__head">
        <HeartPulse aria-hidden />
        <span className="vit__title">Patient's wearable</span>
        {streaming && <span className="vit__live"><span aria-hidden /> Live</span>}
        <span className="vit__device">{pack?.device ?? ''}</span>
        {exportable && <ExportButton iconOnly label="Download the vitals" build={() => tableDoc({
            key: `${incidentRef}_vitals`, eyebrow: 'Patient vitals', title: `Wearable readings — ${incidentRef}`,
            columns: [{ key: 'ts', label: 'Time' }, { key: 'hr', label: 'Heart rate (bpm)', align: 'right' }, { key: 'spo2', label: 'SpO₂ (%)', align: 'right' }],
            rows: series.map((p) => ({ ts: new Date(p.ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai' }), hr: p.hr, spo2: p.spo2 })),
            facts: a ? [{ label: 'Pattern', value: a.headline }] : undefined, confidential: true,
          })} />}
      </header>
      <div className="vit__now">
        <div className="vit__num" data-tone={hrTone}>
          <span className="vit__value">{hr ?? '—'}</span>
          <span className="vit__unit">bpm{a?.hr ? ` · from ${a.hr.baseline}` : ''}</span>
        </div>
        <div className="vit__num vit__num--spo2" data-tone={spTone}>
          <span className="vit__value">{spo2 ?? '—'}<small>%</small></span>
          <span className="vit__unit">SpO₂{a?.spo2 ? ` · from ${a.spo2.baseline}%` : ''}</span>
        </div>
        <Sparkline points={recent} />
      </div>
      {a?.headline && <p className="vit__headline" data-tone={a.severity}>{a.headline}</p>}
      {!compact && a?.sequence.text && <p className="vit__text">{a.sequence.text}</p>}
      {!compact && !a?.sequence.text && worst && <p className="vit__text">{worst.text}</p>}
      {!compact && a?.prepare.length ? <p className="vit__prepare"><b>Have ready:</b> {a.prepare.join(' · ')}</p> : null}
      <p className="vit__caveat">Consumer wearable — for context, not a diagnosis.</p>
    </section>
  );
}

function Sparkline({ points }: { points: VitalsPoint[] }) {
  if (points.length < 2) return <div className="vit__spark" />;
  const t0 = Date.parse(points[0].ts);
  const t1 = Math.max(Date.parse(points[points.length - 1].ts), t0 + 1);
  const x = (ts: string) => ((Date.parse(ts) - t0) / (t1 - t0)) * 100;
  const path = (key: 'hr' | 'spo2', lo: number, hi: number) => points
    .filter((p) => p[key] != null)
    .map((p) => `${x(p.ts).toFixed(1)},${(40 - ((Math.min(hi, Math.max(lo, p[key] as number)) - lo) / (hi - lo)) * 36 - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="vit__spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline className="vit__line vit__line--spo2" points={path('spo2', 80, 100)} />
      <polyline className="vit__line vit__line--hr" points={path('hr', 40, 180)} />
    </svg>
  );
}
