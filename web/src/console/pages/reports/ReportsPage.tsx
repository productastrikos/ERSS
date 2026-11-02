/**
 * Reports — every incident the trial has handled, kept and reportable.
 *
 * Live incidents and completed ones alike (a PoC restart archives every COMPLETED response
 * rather than deleting it, sim/live.js reset), from the camera and from the citizen app.
 * Each row opens its incident report in the studio — preview, edit, then PDF or Excel — and
 * the register itself downloads the same way. Scoped by the server to what this person may
 * see (services/reports.js register).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, Search } from 'lucide-react';
import type { ReportRow } from '../../../lib/types';
import { api, ApiError } from '../../../lib/api';
import { onSocket } from '../../../lib/socket';
import { useUser } from '../../../lib/stores/session';
import { Button, EmptyState, ErrorState, Segmented, Skeleton } from '../../../shared/ui';
import { ExportButton } from '../../../shared/report/ExportButton';
import { openReport } from '../../../shared/report/store';
import { gstDateTime, mmss, tableDoc, type Tone } from '../../../shared/report/doc';
import './reports.scss';

type Period = '1' | '7' | '30';
type Source = 'all' | 'sensor' | 'app_sos';

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function ReportsPage() {
  const user = useUser();
  const [period, setPeriod] = useState<Period>('7');
  const [source, setSource] = useState<Source>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => api.reports.register(Number(period))
    .then((r) => { setRows(r); setError(null); })
    .catch((e: ApiError) => setError(e.message)), [period]);
  const refresh = () => { setLoading(true); void load().finally(() => setLoading(false)); };

  useEffect(() => {
    void load();
    const again = () => { void load(); };
    const id = window.setInterval(again, 30_000);
    const offs = [onSocket('incident:closed', again), onSocket('incident:new', again), onSocket('sim:reset', again)];
    return () => { window.clearInterval(id); for (const off of offs) off(); };
  }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (source === 'all' || r.source === source)
    && (!q.trim() || `${r.ref} ${r.kindLabel} ${r.place ?? ''} ${r.callsign ?? ''} ${r.hospital ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))),
  [rows, source, q]);

  const responded = shown.filter((r) => r.responseSec != null);
  const within = responded.filter((r) => r.withinTarget).length;
  const facts: Array<{ label: string; value: string; tone?: Tone }> = [
    { label: 'Incidents', value: String(shown.length) },
    { label: 'Reached within target', value: responded.length ? `${Math.round((within / responded.length) * 100)}% (${within} of ${responded.length})` : '—', tone: responded.length && within / responded.length >= 0.9 ? 'good' : 'warn' },
    { label: 'Median response', value: mmss(median(responded.map((r) => r.responseSec as number))) },
    { label: 'Hospital pre-alerts sent', value: String(shown.filter((r) => r.prealerted).length) },
    { label: 'With patient wearable data', value: String(shown.filter((r) => r.hasVitals).length) },
  ];

  const register = () => tableDoc({
    key: `incident-register_${period}d`,
    eyebrow: 'Incident register',
    title: `Incidents — last ${period === '1' ? '24 hours' : `${period} days`}`,
    subtitle: `${source === 'all' ? 'All sources' : source === 'sensor' ? 'Raised by road cameras' : 'Raised from the citizen app'}${q.trim() ? ` · matching “${q.trim()}”` : ''} · as at ${gstDateTime(new Date().toISOString())}`,
    generatedBy: user?.name ?? null,
    facts,
    classification: 'Trial data — simulated incidents',
    columns: [
      { key: 'ref', label: 'Incident', width: 1.4 }, { key: 'reported', label: 'Raised (GST)', width: 1.6 }, { key: 'kind', label: 'Type', width: 1.4 },
      { key: 'priority', label: 'Priority', width: 0.6 }, { key: 'source', label: 'Raised by', width: 1.3 }, { key: 'place', label: 'Place', width: 1.6 },
      { key: 'unit', label: 'Ambulance', width: 1.1 }, { key: 'response', label: 'Response', align: 'right', width: 0.8 }, { key: 'hospital', label: 'Hospital', width: 1.6 }, { key: 'status', label: 'Status', width: 0.9 },
    ],
    rows: shown.map((r) => ({
      ref: r.ref, reported: gstDateTime(r.reportedAt), kind: r.kindLabel, priority: r.priority, source: r.sourceLabel, place: r.place ?? '',
      unit: r.callsign ?? '', response: mmss(r.responseSec), hospital: r.hospital ?? '', status: r.live ? 'Live' : 'Closed',
    })),
    tones: shown.map((r) => (r.withinTarget == null ? null : r.withinTarget ? 'good' : 'warn')),
  });

  return (
    <div className="page reports">
      <div className="page__head">
        <div>
          <h2 className="page__title"><FileText aria-hidden /> Reports</h2>
          <div className="page__sub">Every incident, kept. Open one to preview its report, edit it, and download it as PDF or Excel.</div>
        </div>
        <div className="page__actions">
          <Button variant="ghost" size="sm" onClick={refresh} loading={loading}><RefreshCw aria-hidden /> Refresh</Button>
          <ExportButton label="Export register" build={register} />
        </div>
      </div>

      <div className="reports__filters">
        <Segmented<Period> value={period} ariaLabel="Period" onChange={setPeriod}
          options={[{ value: '1', label: '24 h' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
        <Segmented<Source> value={source} ariaLabel="Raised by" onChange={setSource}
          options={[{ value: 'all', label: 'All' }, { value: 'sensor', label: 'Camera' }, { value: 'app_sos', label: 'Citizen SOS' }]} />
        <label className="reports__search">
          <Search aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incident, place, ambulance, hospital" aria-label="Search incidents" />
        </label>
      </div>

      <div className="reports__facts">
        {facts.map((f) => (
          <div key={f.label} className="reports__fact" data-tone={f.tone}>
            <span>{f.label}</span><strong>{f.value}</strong>
          </div>
        ))}
      </div>

      {error ? <ErrorState title="Could not load the register" body={error} onRetry={refresh} />
        : !rows ? <Skeleton height={320} />
          : shown.length === 0 ? <EmptyState icon={<FileText aria-hidden />} title="No incidents in this period" body="Incidents appear here as they are raised — from a road camera or the citizen app — and stay after a PoC restart once completed." />
            : (
              <div className="reports__table-wrap">
                <table className="reports__table">
                  <thead>
                    <tr>
                      <th>Incident</th><th>Raised</th><th>Type</th><th>Raised by</th><th>Place</th><th>Ambulance</th>
                      <th className="is-num">Response</th><th>Hospital</th><th>Status</th><th aria-label="Report" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.ref}>
                        <td className="mono">{r.ref}</td>
                        <td>{gstDateTime(r.reportedAt).replace(' GST', '')}</td>
                        <td><span className={`prio prio--${r.priority}`}>{r.priority}</span> {r.kindLabel}</td>
                        <td>{r.sourceLabel}</td>
                        <td>{r.place ?? '—'}</td>
                        <td>{r.callsign ?? '—'}</td>
                        <td className="is-num" data-tone={r.withinTarget == null ? undefined : r.withinTarget ? 'good' : 'bad'}>{mmss(r.responseSec)}</td>
                        <td>{r.hospital ?? '—'}{r.prealerted && <span className="reports__tag" title="The ED was pre-alerted automatically">pre-alerted</span>}</td>
                        <td>{r.live ? <span className="reports__live">Live</span> : 'Closed'}{r.hasVitals && <span className="reports__tag" title="The patient's wearable readings are in the report">vitals</span>}</td>
                        <td>
                          <Button size="sm" variant="secondary" onClick={() => openReport({ kind: 'incident', ref: r.ref })}>
                            <FileText aria-hidden /> Report
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </div>
  );
}
